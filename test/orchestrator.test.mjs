import assert from "node:assert/strict";
import test from "node:test";
import {
  DuetError,
  ERROR_CATEGORY,
  ERROR_CODE,
  retryOperation
} from "../src/core/errors.mjs";
import {
  RUN_STATUS,
  runDuet,
  STOP_REASON
} from "../src/core/orchestrator.mjs";

const PASS = {
  blockedReason: "",
  checks: [{ evidence: "pnpm test exited 0", name: "pnpm test", status: "passed" }],
  findings: [],
  summary: "No actionable defects found.",
  verdict: "PASS"
};
const REVISE = {
  blockedReason: "",
  checks: [{ evidence: "Missing branch coverage", name: "regression test", status: "not_run" }],
  findings: [{
    evidence: "The false branch returns the success value.",
    line: 4,
    path: "src/app.js",
    priority: "P1",
    suggestion: "Return the failure value and add a regression test.",
    title: "Wrong branch"
  }],
  summary: "One correctness defect needs revision.",
  verdict: "REVISE"
};

function snapshot(hash, { changed = ["src/app.js"], clean = false } = {}) {
  return {
    changed,
    clean,
    hash,
    stat: changed.length ? `${changed.length} file changed` : "No tracked diff.",
    status: clean ? "Clean working tree." : "M src/app.js"
  };
}

function createHarness({
  callError,
  closeError,
  connectError,
  health = {
    claude: { compatible: true, path: "/bin/claude", subscription: true },
    codex: { compatible: true, path: "/bin/codex", subscription: true }
  },
  missingThreadId = false,
  reviewError,
  reviews = [PASS],
  snapshots = [snapshot("initial", { changed: [], clean: true }), snapshot("diff-1")],
  verificationError,
  verifications = [{ code: 0, stderr: "", stdout: "ok", timedOut: false }]
} = {}) {
  let now = 1_700_000_000_000;
  let reviewIndex = 0;
  let snapshotIndex = 0;
  let verificationIndex = 0;
  let deadlineDisposed = false;
  const deadlineController = new AbortController();
  const events = [];
  const codex = {
    calls: [],
    closed: false,
    async call(name, args) {
      this.calls.push({ args, name });
      if (callError) throw callError;
      if (name === "codex") {
        return {
          structuredContent: {
            content: "Implemented.",
            threadId: missingThreadId ? undefined : "thread-1"
          }
        };
      }
      return { structuredContent: { content: "Revised." } };
    },
    async close() {
      this.closed = true;
      if (closeError) throw closeError;
    },
    async connect(requiredTools) {
      this.requiredTools = requiredTools;
      if (connectError) throw connectError;
    }
  };
  const workspace = {
    baseCommit: "abc123",
    id: "run-1",
    projectRoot: "/repo",
    state: "active",
    workspacePath: "/workspace/run-1"
  };
  const dependencies = {
    createCodexSession: (options) => {
      codex.options = options;
      return codex;
    },
    createDeadline: () => ({
      dispose: () => {
        deadlineDisposed = true;
      },
      signal: deadlineController.signal
    }),
    createId: () => "run-1",
    createWorkspace: async () => workspace,
    gitSnapshot: async () => {
      assert.ok(snapshotIndex < snapshots.length, "Unexpected Git snapshot request");
      return snapshots[snapshotIndex++];
    },
    now: () => now++,
    markWorkspaceInterrupted: async (_workspace, error) => {
      workspace.error = error.message;
      workspace.state = "interrupted";
    },
    markWorkspacePending: async (_workspace, result) => {
      workspace.changedFiles = result.changedFiles;
      workspace.state = "pending";
      return {
        canApply: true,
        changedFiles: result.changedFiles,
        id: workspace.id,
        projectRoot: workspace.projectRoot,
        state: workspace.state
      };
    },
    probeCliHealth: async () => health,
    repositoryHead: async () => "abc123",
    repositoryRoot: async () => "/repo",
    reviewWithClaude: async () => {
      if (reviewError) throw reviewError;
      assert.ok(reviewIndex < reviews.length, "Unexpected Claude review request");
      const review = reviews[reviewIndex++];
      if (review instanceof Error) throw review;
      return review;
    },
    retryOperation: (operation, options) => retryOperation(operation, {
      ...options,
      waitForRetry: async () => {}
    }),
    runVerification: async () => {
      if (verificationError) throw verificationError;
      const index = Math.min(verificationIndex++, verifications.length - 1);
      return verifications[index];
    },
    summarizeWorkspace: () => ({
      id: workspace.id,
      projectRoot: workspace.projectRoot,
      state: workspace.state
    })
  };

  return {
    codex,
    deadlineController,
    dependencies,
    events,
    get deadlineDisposed() {
      return deadlineDisposed;
    },
    get reviewCalls() {
      return reviewIndex;
    },
    onEvent: (event) => events.push(event),
    workspace
  };
}

function config(overrides = {}) {
  return {
    maxMinutes: 60,
    maxRounds: 3,
    projectPath: "/selected",
    reviewModel: "haiku",
    task: "Fix the branch",
    verificationCommand: "pnpm test",
    ...overrides
  };
}

test("completes after a passing review and machine check", async () => {
  const harness = createHarness();
  const result = await runDuet(config(), harness);

  assert.equal(result.status, RUN_STATUS.COMPLETED);
  assert.equal(result.reason, STOP_REASON.VERIFIED);
  assert.equal(result.round, 1);
  assert.deepEqual(result.changedFiles, ["src/app.js"]);
  assert.deepEqual(harness.codex.requiredTools, ["codex", "codex-reply"]);
  assert.deepEqual(harness.codex.calls.map((call) => call.name), ["codex"]);
  assert.equal(harness.codex.closed, true);
  assert.equal(harness.deadlineDisposed, true);
  assert.deepEqual(
    harness.events.map((event) =>
      event.type === "phase" ? `${event.type}:${event.payload.name}` : event.type
    ),
    [
      "phase:preflight",
      "preflight",
      "phase:implement",
      "agent",
      "verification",
      "phase:review",
      "agent",
      "metrics"
    ]
  );
  assert.equal(result.receipt.schemaVersion, 2);
  assert.equal(result.receipt.id, "run-1");
  assert.equal(result.receipt.project.baseCommit, "abc123");
  assert.equal(result.receipt.project.root, "/repo");
  assert.equal(result.receipt.rounds[0].review.verdict, "PASS");
  assert.equal(result.receipt.result.reason, STOP_REASON.VERIFIED);
  assert.equal(result.workspace.state, "pending");
  assert.equal(harness.codex.options.cwd, "/workspace/run-1");
});

test("does not let PASS override failed verification", async () => {
  const harness = createHarness({
    verifications: [{ code: 1, stderr: "failed", stdout: "", timedOut: false }]
  });
  const result = await runDuet(config({ maxRounds: 1 }), harness);

  assert.equal(result.status, RUN_STATUS.STOPPED);
  assert.equal(result.reason, STOP_REASON.ROUND_LIMIT);
  assert.equal(result.receipt.rounds[0].verification.code, 1);
});

test("revises in the same Codex thread and then completes", async () => {
  const harness = createHarness({
    reviews: [REVISE, PASS],
    snapshots: [
      snapshot("initial", { changed: [], clean: true }),
      snapshot("diff-1"),
      snapshot("diff-2"),
      snapshot("diff-2")
    ],
    verifications: [
      { code: 0, stderr: "", stdout: "ok", timedOut: false },
      { code: 0, stderr: "", stdout: "ok", timedOut: false }
    ]
  });
  const result = await runDuet(config(), harness);

  assert.equal(result.status, RUN_STATUS.COMPLETED);
  assert.equal(result.reason, STOP_REASON.VERIFIED);
  assert.equal(result.round, 2);
  assert.deepEqual(harness.codex.calls.map((call) => call.name), ["codex", "codex-reply"]);
  assert.equal(harness.codex.calls[1].args.threadId, "thread-1");
  assert.equal(result.receipt.rounds.length, 2);
});

test("fails closed on malformed reviewer output", async () => {
  const harness = createHarness({ reviews: ["Unstructured reviewer response"] });
  const result = await runDuet(config(), harness);

  assert.equal(result.status, RUN_STATUS.BLOCKED);
  assert.equal(result.reason, STOP_REASON.REVIEW_BLOCKED);
  assert.match(result.detail, /did not satisfy Duet's protocol/);
  assert.equal(result.receipt.result.detail, result.detail);
  assert.equal(result.receipt.rounds[0].review.protocolError, ERROR_CODE.REVIEW_PROTOCOL_INVALID);
});

test("retries one transient read-only review and records the attempt", async () => {
  const transient = new DuetError(
    ERROR_CODE.CLAUDE_REVIEW_FAILED,
    "Service temporarily unavailable",
    {
      category: ERROR_CATEGORY.EXTERNAL,
      phase: "review",
      retryable: true
    }
  );
  const harness = createHarness({ reviews: [transient, PASS] });
  const result = await runDuet(config(), harness);

  assert.equal(result.status, RUN_STATUS.COMPLETED);
  assert.equal(harness.reviewCalls, 2);
  assert.deepEqual(result.receipt.retries.map((retry) => retry.code), [
    ERROR_CODE.CLAUDE_REVIEW_FAILED
  ]);
  assert.equal(harness.events.filter((event) => event.type === "retry").length, 1);
});

test("stops when the reviewer repeats the same findings", async () => {
  const harness = createHarness({
    reviews: [REVISE, REVISE],
    snapshots: [
      snapshot("initial", { changed: [], clean: true }),
      snapshot("diff-1"),
      snapshot("diff-2"),
      snapshot("diff-2")
    ]
  });
  const result = await runDuet(config(), harness);

  assert.equal(result.status, RUN_STATUS.STOPPED);
  assert.equal(result.reason, STOP_REASON.REPEATED_FINDINGS);
  assert.equal(result.round, 2);
  assert.equal(result.receipt.rounds.length, 2);
});

test("stops when a revision does not change the working tree", async () => {
  const harness = createHarness({
    reviews: [REVISE],
    snapshots: [
      snapshot("initial", { changed: [], clean: true }),
      snapshot("diff-1"),
      snapshot("diff-1")
    ]
  });
  const result = await runDuet(config(), harness);

  assert.equal(result.status, RUN_STATUS.STOPPED);
  assert.equal(result.reason, STOP_REASON.NO_PROGRESS);
  assert.equal(result.round, 2);
});

test("stops at the selected review round ceiling", async () => {
  const harness = createHarness({ reviews: [REVISE] });
  const result = await runDuet(config({ maxRounds: 1 }), harness);

  assert.equal(result.status, RUN_STATUS.STOPPED);
  assert.equal(result.reason, STOP_REASON.ROUND_LIMIT);
  assert.equal(result.round, 1);
  assert.deepEqual(harness.codex.calls.map((call) => call.name), ["codex"]);
});

test("distinguishes user cancellation from timeout", async () => {
  const cancelled = createHarness();
  const userAbort = new AbortController();
  userAbort.abort(new Error("Cancelled by user"));
  const cancelledResult = await runDuet(config(), {
    ...cancelled,
    signal: userAbort.signal
  });
  assert.equal(cancelledResult.reason, STOP_REASON.USER_CANCELLED);

  const timedOut = createHarness();
  timedOut.deadlineController.abort(new Error("Time limit"));
  const timedOutResult = await runDuet(config(), timedOut);
  assert.equal(timedOutResult.reason, STOP_REASON.TIME_LIMIT);
  assert.equal(timedOutResult.status, RUN_STATUS.STOPPED);
});

test("closes Codex and disposes the deadline when MCP connection fails", async () => {
  const harness = createHarness({ connectError: new Error("missing codex tool") });
  let captured;
  await assert.rejects(runDuet(config(), harness), (error) => {
    captured = error;
    return /missing codex tool/.test(error.message);
  });
  assert.equal(harness.codex.closed, true);
  assert.equal(harness.deadlineDisposed, true);
  assert.equal(harness.workspace.state, "interrupted");
  assert.equal(harness.workspace.error, "missing codex tool");
  assert.equal(captured.code, ERROR_CODE.CODEX_CONNECT_FAILED);
  assert.equal(captured.receipt.result.status, RUN_STATUS.FAILED);
  assert.equal(captured.receipt.result.error.category, ERROR_CATEGORY.PROCESS);
});

test("closes Codex when implementation fails", async () => {
  const harness = createHarness({ callError: new Error("Codex failed") });
  await assert.rejects(runDuet(config(), harness), /Codex failed/);
  assert.equal(harness.codex.closed, true);
  assert.equal(harness.codex.calls.length, 1);
  assert.equal(harness.deadlineDisposed, true);
});

test("preserves a successful result when Codex cleanup reports a warning", async () => {
  const harness = createHarness({ closeError: new Error("transport already closed") });
  const result = await runDuet(config(), harness);

  assert.equal(result.status, RUN_STATUS.COMPLETED);
  assert.equal(result.receipt.warnings[0].code, ERROR_CODE.CLEANUP_FAILED);
  assert.equal(result.receipt.warnings[0].phase, "cleanup");
  assert.equal(harness.events.filter((event) => event.type === "warning").length, 1);
});

test("closes Codex when Claude review fails", async () => {
  const harness = createHarness({ reviewError: new Error("Claude failed") });
  await assert.rejects(runDuet(config(), harness), /Claude failed/);
  assert.equal(harness.codex.closed, true);
  assert.equal(harness.deadlineDisposed, true);
});

test("fails preflight before starting Codex when a subscription session is missing", async () => {
  const harness = createHarness({
    health: {
      claude: { compatible: true, path: "/bin/claude", subscription: false },
      codex: { compatible: true, path: "/bin/codex", subscription: true }
    }
  });
  await assert.rejects(runDuet(config(), harness), /Claude Code must be installed/);
  assert.equal(harness.codex.calls.length, 0);
  assert.equal(harness.codex.closed, false);
  assert.equal(harness.deadlineDisposed, true);
});

test("fails preflight when an authenticated CLI lacks required capabilities", async () => {
  const harness = createHarness({
    health: {
      claude: {
        compatibilityError: "Claude update required",
        compatible: false,
        path: "/bin/claude",
        subscription: true
      },
      codex: { compatible: true, path: "/bin/codex", subscription: true }
    }
  });
  await assert.rejects(runDuet(config(), harness), /Claude update required/);
  assert.equal(harness.codex.calls.length, 0);
  assert.equal(harness.codex.closed, false);
  assert.equal(harness.deadlineDisposed, true);
});

test("fails closed and cleans up when Codex omits the thread id", async () => {
  const harness = createHarness({ missingThreadId: true });
  await assert.rejects(runDuet(config(), harness), /did not return a threadId/);
  assert.equal(harness.codex.closed, true);
  assert.equal(harness.deadlineDisposed, true);
});

test("cleans up when the verification runner fails", async () => {
  const harness = createHarness({ verificationError: new Error("Could not start tests") });
  await assert.rejects(runDuet(config(), harness), /Could not start tests/);
  assert.equal(harness.codex.closed, true);
  assert.equal(harness.deadlineDisposed, true);
});
