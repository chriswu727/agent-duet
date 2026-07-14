import { createHash, randomUUID } from "node:crypto";
import { reviewWithClaude } from "./claude.mjs";
import { probeCliHealth } from "./health.mjs";
import { gitSnapshot, repositoryHead, repositoryRoot } from "./git.mjs";
import { capText, estimateTokens, HARD_LIMITS, normalizeRunConfig } from "./limits.mjs";
import { codexToolResult, McpSession } from "./mcp.mjs";
import {
  implementationPrompt,
  LEAN_POLICY,
  parseReview,
  reviewPrompt,
  revisionPrompt
} from "./prompts.mjs";
import {
  beginReceipt,
  finalizeReceipt,
  recordReceiptRound,
  setReceiptProject
} from "./receipt.mjs";
import { runVerification } from "./verify.mjs";
import {
  createManagedWorkspace,
  defaultWorkspaceStorageRoot,
  markWorkspaceInterrupted,
  markWorkspacePending,
  workspaceSummary
} from "./workspace.mjs";

export const RUN_STATUS = Object.freeze({
  BLOCKED: "blocked",
  COMPLETED: "completed",
  STOPPED: "stopped"
});

export const STOP_REASON = Object.freeze({
  NO_PROGRESS: "no_progress",
  REPEATED_FINDINGS: "repeated_findings",
  REVIEW_BLOCKED: "review_blocked",
  ROUND_LIMIT: "round_limit",
  TIME_LIMIT: "time_limit",
  USER_CANCELLED: "user_cancelled",
  VERIFIED: "verified"
});

function digest(text) {
  return createHash("sha256").update(String(text || "").trim()).digest("hex");
}

function createDeadline(maxMinutes) {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`Duet reached the ${maxMinutes}-minute limit.`)),
    maxMinutes * 60_000
  );
  return {
    dispose: () => clearTimeout(timer),
    signal: controller.signal
  };
}

function combinedSignal(userSignal, deadlineSignal) {
  return userSignal
    ? AbortSignal.any([userSignal, deadlineSignal])
    : deadlineSignal;
}

function defaultCodexSession(options) {
  return new McpSession(options);
}

const defaults = Object.freeze({
  createCodexSession: defaultCodexSession,
  createDeadline,
  createId: randomUUID,
  createWorkspace: createManagedWorkspace,
  gitSnapshot,
  markWorkspaceInterrupted,
  markWorkspacePending,
  now: Date.now,
  probeCliHealth,
  repositoryHead,
  repositoryRoot,
  reviewWithClaude,
  runVerification,
  summarizeWorkspace: workspaceSummary
});

export async function runDuet(
  rawConfig,
  {
    dependencies: overrides = {},
    onEvent = () => {},
    signal,
    workspaceRoot = defaultWorkspaceStorageRoot()
  } = {}
) {
  const dependencies = { ...defaults, ...overrides };
  const config = normalizeRunConfig(rawConfig);
  const deadline = dependencies.createDeadline(config.maxMinutes);
  const runSignal = combinedSignal(signal, deadline.signal);
  const emit = (type, payload = {}) =>
    onEvent({ payload, time: dependencies.now(), type });
  const receipt = beginReceipt({
    config,
    id: dependencies.createId(),
    now: dependencies.now()
  });
  let codex;
  let handoffChars = 0;
  let lastSnapshot;
  let workspace;

  const finish = async (result) => {
    const completed = {
      ...result,
      receipt: finalizeReceipt(receipt, result, dependencies.now())
    };
    if (workspace) {
      completed.workspace = await dependencies.markWorkspacePending(
        workspace,
        completed
      );
    }
    return completed;
  };

  try {
    runSignal.throwIfAborted();
    emit("phase", { name: "preflight", message: "Checking CLIs, subscriptions, and Git." });
    const health = await dependencies.probeCliHealth();
    if (!health.codex.subscription) {
      throw new Error("Codex must be installed and logged in using ChatGPT.");
    }
    if (!health.claude.subscription) {
      throw new Error("Claude Code must be installed and logged in using Claude.ai.");
    }
    if (!health.codex.compatible) {
      throw new Error(
        health.codex.compatibilityError ||
          "Codex must support the local MCP server command. Update Codex and try again."
      );
    }
    if (!health.claude.compatible) {
      throw new Error(
        health.claude.compatibilityError ||
          "Claude Code is missing options required for isolated review. Update it and try again."
      );
    }

    const root = await dependencies.repositoryRoot(config.projectPath);
    const [baseCommit, initial] = await Promise.all([
      dependencies.repositoryHead(root),
      dependencies.gitSnapshot(root)
    ]);
    if (!initial.clean) {
      throw new Error("Duet requires a clean Git working tree to protect existing changes.");
    }
    setReceiptProject(receipt, { baseCommit, root });
    workspace = await dependencies.createWorkspace({
      baseCommit,
      id: receipt.id,
      projectRoot: root,
      storageRoot: workspaceRoot
    });
    const runRoot = workspace.workspacePath;
    emit("preflight", {
      baseCommit,
      health,
      root,
      workspace: dependencies.summarizeWorkspace(workspace)
    });
    runSignal.throwIfAborted();

    codex = dependencies.createCodexSession({
      args: ["mcp-server", "-c", "mcp_servers={}"],
      command: health.codex.path,
      cwd: runRoot,
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
          cwd: runRoot,
          prompt: firstPrompt,
          sandbox: "workspace-write"
        },
        { signal: runSignal }
      )
    );
    if (!first.threadId) throw new Error("Codex did not return a threadId.");
    emit("agent", { agent: "codex", round: 1, text: capText(first.content) });

    let previousDiffHash;
    let previousFindingHash;

    for (let round = 1; round <= config.maxRounds; round += 1) {
      runSignal.throwIfAborted();
      const snapshot = await dependencies.gitSnapshot(runRoot, baseCommit);
      lastSnapshot = snapshot;
      const verification = await dependencies.runVerification(
        config.verificationCommand,
        runRoot,
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
      const reviewText = await dependencies.reviewWithClaude({
        command: health.claude.path,
        cwd: runRoot,
        model: config.reviewModel,
        onLog: (message) => emit("log", { agent: "claude", message }),
        prompt: reviewerPrompt,
        signal: runSignal
      });
      const review = parseReview(reviewText);
      recordReceiptRound(receipt, { review, round, snapshot, verification });
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
        return await finish({
          changedFiles: snapshot.changed,
          reason: STOP_REASON.VERIFIED,
          round,
          status: RUN_STATUS.COMPLETED
        });
      }
      if (review.verdict === "BLOCKED") {
        return await finish({
          changedFiles: snapshot.changed,
          detail: review.findings,
          reason: STOP_REASON.REVIEW_BLOCKED,
          round,
          status: RUN_STATUS.BLOCKED
        });
      }
      if (round === config.maxRounds) {
        return await finish({
          changedFiles: snapshot.changed,
          reason: STOP_REASON.ROUND_LIMIT,
          round,
          status: RUN_STATUS.STOPPED
        });
      }

      const findingHash = digest(review.findings);
      if (previousFindingHash === findingHash) {
        return await finish({
          changedFiles: snapshot.changed,
          reason: STOP_REASON.REPEATED_FINDINGS,
          round,
          status: RUN_STATUS.STOPPED
        });
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

      const revisedSnapshot = await dependencies.gitSnapshot(runRoot, baseCommit);
      lastSnapshot = revisedSnapshot;
      if (revisedSnapshot.hash === previousDiffHash) {
        return await finish({
          changedFiles: revisedSnapshot.changed,
          reason: STOP_REASON.NO_PROGRESS,
          round: round + 1,
          status: RUN_STATUS.STOPPED
        });
      }
    }

    return await finish({
      changedFiles: lastSnapshot?.changed || [],
      reason: STOP_REASON.ROUND_LIMIT,
      round: config.maxRounds,
      status: RUN_STATUS.STOPPED
    });
  } catch (error) {
    if (runSignal.aborted) {
      return await finish({
        changedFiles: lastSnapshot?.changed || [],
        reason: deadline.signal.aborted
          ? STOP_REASON.TIME_LIMIT
          : STOP_REASON.USER_CANCELLED,
        status: RUN_STATUS.STOPPED
      });
    }
    if (workspace) {
      await dependencies.markWorkspaceInterrupted(workspace, error).catch(
        (stateError) =>
          emit("log", {
            agent: "duet",
            message: `Could not persist workspace error state: ${stateError.message}`
          })
      );
    }
    throw error;
  } finally {
    deadline.dispose();
    await codex?.close();
  }
}
