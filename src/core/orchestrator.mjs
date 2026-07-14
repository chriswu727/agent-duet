import { createHash, randomUUID } from "node:crypto";
import { reviewWithClaude } from "./claude.mjs";
import {
  asDuetError,
  DuetError,
  ERROR_CATEGORY,
  ERROR_CODE,
  retryOperation,
  serializeDuetError
} from "./errors.mjs";
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
  recordReceiptRetry,
  recordReceiptWarning,
  setReceiptProject
} from "./receipt.mjs";
import { formatReview } from "./review.mjs";
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
  FAILED: "failed",
  STOPPED: "stopped"
});

export const STOP_REASON = Object.freeze({
  ERROR: "error",
  NO_PROGRESS: "no_progress",
  REPEATED_FINDINGS: "repeated_findings",
  REVIEW_BLOCKED: "review_blocked",
  ROUND_LIMIT: "round_limit",
  TIME_LIMIT: "time_limit",
  USER_CANCELLED: "user_cancelled",
  VERIFIED: "verified"
});

function digest(value) {
  const serialized = typeof value === "string" ? value.trim() : JSON.stringify(value);
  return createHash("sha256").update(serialized).digest("hex");
}

const phaseErrors = Object.freeze({
  codex_connect: {
    category: ERROR_CATEGORY.PROCESS,
    code: ERROR_CODE.CODEX_CONNECT_FAILED
  },
  implement: {
    category: ERROR_CATEGORY.EXTERNAL,
    code: ERROR_CODE.CODEX_FAILED
  },
  inspect: {
    category: ERROR_CATEGORY.GIT,
    code: ERROR_CODE.GIT_INSPECTION_FAILED
  },
  preflight: {
    category: ERROR_CATEGORY.PROCESS,
    code: ERROR_CODE.PREFLIGHT_FAILED
  },
  review: {
    category: ERROR_CATEGORY.EXTERNAL,
    code: ERROR_CODE.CLAUDE_REVIEW_FAILED
  },
  revise: {
    category: ERROR_CATEGORY.EXTERNAL,
    code: ERROR_CODE.CODEX_FAILED
  },
  verification: {
    category: ERROR_CATEGORY.VERIFICATION,
    code: ERROR_CODE.VERIFICATION_FAILED
  },
  workspace: {
    category: ERROR_CATEGORY.FILESYSTEM,
    code: ERROR_CODE.WORKSPACE_FAILED
  }
});

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
  retryOperation,
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
  let phase = "preflight";
  let workspace;

  const closeCodex = async () => {
    const session = codex;
    codex = null;
    if (!session) return;
    try {
      await session.close();
    } catch (error) {
      const warning = serializeDuetError(new DuetError(
        ERROR_CODE.CLEANUP_FAILED,
        `Could not fully close the Codex session: ${error.message}`,
        {
          category: ERROR_CATEGORY.PROCESS,
          cause: error,
          phase: "cleanup"
        }
      ));
      recordReceiptWarning(receipt, { ...warning, time: dependencies.now() });
      emit("warning", warning);
    }
  };

  const finish = async (result) => {
    await closeCodex();
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
      throw new DuetError(
        ERROR_CODE.CODEX_AUTH_REQUIRED,
        "Codex must be installed and logged in using ChatGPT.",
        { category: ERROR_CATEGORY.AUTH, phase }
      );
    }
    if (!health.claude.subscription) {
      throw new DuetError(
        ERROR_CODE.CLAUDE_AUTH_REQUIRED,
        "Claude Code must be installed and logged in using Claude.ai.",
        { category: ERROR_CATEGORY.AUTH, phase }
      );
    }
    if (!health.codex.compatible) {
      throw new DuetError(
        ERROR_CODE.CODEX_INCOMPATIBLE,
        health.codex.compatibilityError ||
          "Codex must support the local MCP server command. Update Codex and try again.",
        { category: ERROR_CATEGORY.COMPATIBILITY, phase }
      );
    }
    if (!health.claude.compatible) {
      throw new DuetError(
        ERROR_CODE.CLAUDE_INCOMPATIBLE,
        health.claude.compatibilityError ||
          "Claude Code is missing options required for isolated review. Update it and try again.",
        { category: ERROR_CATEGORY.COMPATIBILITY, phase }
      );
    }

    phase = "inspect";
    const root = await dependencies.repositoryRoot(config.projectPath);
    const [baseCommit, initial] = await Promise.all([
      dependencies.repositoryHead(root),
      dependencies.gitSnapshot(root)
    ]);
    if (!initial.clean) {
      throw new DuetError(
        ERROR_CODE.DIRTY_WORKTREE,
        "Duet requires a clean Git working tree to protect existing changes.",
        { category: ERROR_CATEGORY.GIT, phase }
      );
    }
    setReceiptProject(receipt, { baseCommit, root });
    phase = "workspace";
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

    phase = "codex_connect";
    codex = dependencies.createCodexSession({
      args: ["mcp-server", "-c", "mcp_servers={}"],
      command: health.codex.path,
      cwd: runRoot,
      name: "codex",
      onLog: (message) => emit("log", { agent: "codex", message })
    });
    await codex.connect(["codex", "codex-reply"]);

    phase = "implement";
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
    if (!first.threadId) {
      throw new DuetError(
        ERROR_CODE.CODEX_PROTOCOL_INVALID,
        "Codex did not return a threadId.",
        { category: ERROR_CATEGORY.PROTOCOL, phase }
      );
    }
    emit("agent", { agent: "codex", round: 1, text: capText(first.content) });

    let previousDiffHash;
    let previousFindingHash;

    for (let round = 1; round <= config.maxRounds; round += 1) {
      runSignal.throwIfAborted();
      phase = "inspect";
      const snapshot = await dependencies.gitSnapshot(runRoot, baseCommit);
      lastSnapshot = snapshot;
      phase = "verification";
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

      phase = "review";
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
      const reviewOutput = await dependencies.retryOperation(
        () => dependencies.reviewWithClaude({
          command: health.claude.path,
          cwd: runRoot,
          model: config.reviewModel,
          onLog: (message) => emit("log", { agent: "claude", message }),
          prompt: reviewerPrompt,
          signal: runSignal
        }),
        {
          maxAttempts: 2,
          onRetry: ({ attempt, delayMs, error, maxAttempts }) => {
            const retry = {
              attempt,
              code: error.code || ERROR_CODE.CLAUDE_REVIEW_FAILED,
              delayMs,
              maxAttempts,
              operation: "claude_review",
              time: dependencies.now()
            };
            recordReceiptRetry(receipt, retry);
            emit("retry", retry);
          },
          signal: runSignal
        }
      );
      const review = parseReview(reviewOutput);
      recordReceiptRound(receipt, { review, round, snapshot, verification });
      emit("agent", {
        agent: "claude",
        round,
        text: capText(formatReview(review)),
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
          detail: review.blockedReason || review.summary,
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

      phase = "revise";
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

      phase = "inspect";
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
    const classified = asDuetError(error, {
      ...(phaseErrors[phase] || {}),
      phase
    });
    await closeCodex();
    classified.receipt = finalizeReceipt(
      receipt,
      {
        changedFiles: lastSnapshot?.changed || [],
        error: serializeDuetError(classified),
        reason: STOP_REASON.ERROR,
        status: RUN_STATUS.FAILED
      },
      dependencies.now()
    );
    if (workspace) {
      await dependencies.markWorkspaceInterrupted(workspace, classified).catch(
        (stateError) =>
          emit("log", {
            agent: "duet",
            message: `Could not persist workspace error state: ${stateError.message}`
          })
      );
    }
    throw classified;
  } finally {
    deadline.dispose();
    await closeCodex();
  }
}
