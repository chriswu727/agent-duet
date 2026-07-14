import { createHash } from "node:crypto";
import { reviewWithClaude } from "./claude.mjs";
import { probeCliHealth } from "./health.mjs";
import { gitSnapshot, repositoryRoot } from "./git.mjs";
import { capText, estimateTokens, HARD_LIMITS, normalizeRunConfig } from "./limits.mjs";
import { codexToolResult, McpSession } from "./mcp.mjs";
import {
  implementationPrompt,
  LEAN_POLICY,
  parseReview,
  reviewPrompt,
  revisionPrompt
} from "./prompts.mjs";
import { runVerification } from "./verify.mjs";

function digest(text) {
  return createHash("sha256").update(String(text || "").trim()).digest("hex");
}

function combinedSignal(userSignal, deadlineSignal) {
  return userSignal
    ? AbortSignal.any([userSignal, deadlineSignal])
    : deadlineSignal;
}

export async function runDuet(rawConfig, { onEvent = () => {}, signal }) {
  const config = normalizeRunConfig(rawConfig);
  const deadline = new AbortController();
  const timer = setTimeout(
    () => deadline.abort(new Error(`Duet reached the ${config.maxMinutes}-minute limit.`)),
    config.maxMinutes * 60_000
  );
  const runSignal = combinedSignal(signal, deadline.signal);
  const emit = (type, payload = {}) => onEvent({ payload, time: Date.now(), type });
  let codex;
  let handoffChars = 0;

  try {
    emit("phase", { name: "preflight", message: "Checking CLIs, subscriptions, and Git." });
    const health = await probeCliHealth();
    if (!health.codex.subscription) {
      throw new Error("Codex must be installed and logged in using ChatGPT.");
    }
    if (!health.claude.subscription) {
      throw new Error("Claude Code must be installed and logged in using Claude.ai.");
    }

    const root = await repositoryRoot(config.projectPath);
    const initial = await gitSnapshot(root);
    if (!initial.clean) {
      throw new Error("Duet 0.1 requires a clean Git working tree to protect existing changes.");
    }
    emit("preflight", { health, root });

    codex = new McpSession({
      args: ["mcp-server", "-c", "mcp_servers={}"],
      command: health.codex.path,
      cwd: root,
      name: "codex",
      onLog: (message) => emit("log", { agent: "codex", message })
    });
    await codex.connect(["codex", "codex-reply"]);

    emit("phase", { name: "implement", message: "Codex is implementing the task." });
    const firstPrompt = implementationPrompt(config);
    handoffChars += firstPrompt.length;
    const first = codexToolResult(
      await codex.call(
        "codex",
        {
          "approval-policy": "never",
          "developer-instructions": LEAN_POLICY,
          cwd: root,
          prompt: firstPrompt,
          sandbox: "workspace-write"
        },
        { signal: runSignal }
      )
    );
    if (!first.threadId) throw new Error("Codex did not return a threadId.");
    emit("agent", { agent: "codex", round: 1, text: capText(first.content) });

    let previousDiffHash = null;
    let previousFindingHash = null;
    let finalSnapshot = null;

    for (let round = 1; round <= config.maxRounds; round += 1) {
      runSignal.throwIfAborted();
      const snapshot = await gitSnapshot(root);
      const verification = await runVerification(
        config.verificationCommand,
        root,
        runSignal
      );
      emit("verification", {
        configured: Boolean(config.verificationCommand),
        result: verification,
        round
      });

      emit("phase", {
        name: "review",
        message: `Claude is independently reviewing round ${round}.`
      });
      const reviewerPrompt = reviewPrompt({
        snapshot,
        task: config.task,
        verification
      });
      handoffChars += reviewerPrompt.length;
      const reviewText = await reviewWithClaude({
        command: health.claude.path,
        cwd: root,
        model: config.reviewModel,
        onLog: (message) => emit("log", { agent: "claude", message }),
        prompt: reviewerPrompt,
        signal: runSignal
      });
      const review = parseReview(reviewText);
      emit("agent", {
        agent: "claude",
        round,
        text: capText(review.raw || review.findings),
        verdict: review.verdict
      });
      emit("metrics", {
        changedFiles: snapshot.changed.length,
        estimatedHandoffTokens: estimateTokens(handoffChars),
        handoffChars,
        maxRounds: config.maxRounds,
        round
      });

      const verificationPassed = !verification || verification.code === 0;
      if (review.verdict === "PASS" && verificationPassed) {
        finalSnapshot = snapshot;
        return {
          changedFiles: snapshot.changed,
          reason: "verified",
          round,
          status: "completed"
        };
      }
      if (review.verdict === "BLOCKED") {
        finalSnapshot = snapshot;
        return {
          changedFiles: snapshot.changed,
          reason: review.findings,
          round,
          status: "blocked"
        };
      }
      if (round === config.maxRounds) {
        finalSnapshot = snapshot;
        return {
          changedFiles: snapshot.changed,
          reason: "round_limit",
          round,
          status: "stopped"
        };
      }

      const findingHash = digest(review.findings);
      if (previousFindingHash === findingHash) {
        finalSnapshot = snapshot;
        return {
          changedFiles: snapshot.changed,
          reason: "repeated_findings",
          round,
          status: "stopped"
        };
      }
      previousFindingHash = findingHash;
      previousDiffHash = snapshot.hash;

      emit("phase", {
        name: "revise",
        message: `Codex is addressing verified findings from round ${round}.`
      });
      const feedback = revisionPrompt({ findings: review.findings, verification });
      handoffChars += Math.min(feedback.length, HARD_LIMITS.maxHandoffChars);
      const revision = codexToolResult(
        await codex.call(
          "codex-reply",
          { prompt: feedback, threadId: first.threadId },
          { signal: runSignal }
        )
      );
      emit("agent", {
        agent: "codex",
        round: round + 1,
        text: capText(revision.content)
      });

      const revisedSnapshot = await gitSnapshot(root);
      if (revisedSnapshot.hash === previousDiffHash) {
        finalSnapshot = revisedSnapshot;
        return {
          changedFiles: revisedSnapshot.changed,
          reason: "no_progress",
          round: round + 1,
          status: "stopped"
        };
      }
    }

    return {
      changedFiles: finalSnapshot?.changed || [],
      reason: "round_limit",
      round: config.maxRounds,
      status: "stopped"
    };
  } catch (error) {
    if (runSignal.aborted) {
      return { changedFiles: [], reason: "cancelled_or_timed_out", status: "stopped" };
    }
    throw error;
  } finally {
    clearTimeout(timer);
    await codex?.close();
  }
}
