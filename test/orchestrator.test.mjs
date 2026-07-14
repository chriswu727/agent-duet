import assert from "node:assert/strict";
import test from "node:test";
import {
  RUN_STATUS,
  runDuet,
  STOP_REASON
} from "../src/core/orchestrator.mjs";

const PASS = `VERDICT: PASS
FINDINGS:
CHECKS:
- tests pass`;
const REVISE = `VERDICT: REVISE
FINDINGS:
- [P1] src/app.js:4 — wrong branch
CHECKS:
- add a regression test`;

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
    },
    async connect(requiredTools) {
      this.requiredTools = requiredTools;
      if (connectError) throw connectError;
    }
  };
  const dependencies = {
    createCodexSession: () => codex,
    createDeadline: () => ({
      dispose: () => {
        deadlineDisposed = true;
      },
      signal: deadlineController.signal
    }),
    createId: () => "run-1",
    gitSnapshot: async () => {
      assert.ok(snapshotIndex < snapshots.length, "Unexpected Git snapshot request");
      return snapshots[snapshotIndex++];
    },
    now: () => now++,
    probeCliHealth: async () => health,
    repositoryHead: async () => "abc123",
    repositoryRoot: async () => "/repo",
    reviewWithClaude: async () => {
      if (reviewError) throw reviewError;
      assert.ok(reviewIndex < reviews.length, "Unexpected Claude review request");
      return reviews[reviewIndex++];
    },
    runVerification: async () => {
      if (verificationError) throw verificationError;
      const index = Math.min(verificationIndex++, verifications.length - 1);
      return verifications[index];
    }
  };

  return {
    codex,
    deadlineController,
    dependencies,
    events,
    get deadlineDisposed() {
      return deadlineDisposed;
    },
    onEvent: (event) => events.push(event)
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
  assert.equal(result.receipt.schemaVersion, 1);
  assert.equal(result.receipt.id, "run-1");
  assert.equal(result.receipt.project.baseCommit, "abc123");
  assert.equal(result.receipt.project.root, "/repo");
  assert.equal(result.receipt.rounds[0].review.verdict, "PASS");
  assert.equal(result.receipt.result.reason, STOP_REASON.VERIFIED);
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
  assert.equal(result.detail, "Unstructured reviewer response");
  assert.equal(result.receipt.result.detail, result.detail);
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
  await assert.rejects(runDuet(config(), harness), /missing codex tool/);
  assert.equal(harness.codex.closed, true);
  assert.equal(harness.deadlineDisposed, true);
});

test("closes Codex when implementation fails", async () => {
  const harness = createHarness({ callError: new Error("Codex failed") });
  await assert.rejects(runDuet(config(), harness), /Codex failed/);
  assert.equal(harness.codex.closed, true);
  assert.equal(harness.deadlineDisposed, true);
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
