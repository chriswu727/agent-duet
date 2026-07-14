import assert from "node:assert/strict";
import test from "node:test";
import {
  beginReceipt,
  finalizeReceipt,
  RECEIPT_SCHEMA_VERSION,
  recordReceiptRound,
  recordReceiptRetry,
  recordReceiptWarning,
  setReceiptProject
} from "../src/core/receipt.mjs";

test("builds a versioned receipt without storing agent transcripts", () => {
  const receipt = beginReceipt({
    config: {
      maxMinutes: 60,
      maxRounds: 3,
      projectPath: "/selected",
      reviewModel: "sonnet",
      task: "Fix it",
      verificationCommand: "pnpm test"
    },
    id: "run-1",
    now: 1_700_000_000_000
  });
  setReceiptProject(receipt, { baseCommit: "abc123", root: "/repo" });
  recordReceiptRound(receipt, {
    review: {
      blockedReason: "",
      checks: [{ evidence: "ok", name: "pnpm test", status: "passed" }],
      findings: [],
      summary: "No defects found.",
      verdict: "PASS"
    },
    round: 1,
    snapshot: { changed: ["src/app.js"], hash: "diff-1" },
    verification: { code: 0, timedOut: false }
  });
  recordReceiptRetry(receipt, {
    attempt: 1,
    code: "claude_review_failed",
    delayMs: 750,
    maxAttempts: 2,
    operation: "claude_review",
    time: 1_700_000_000_500
  });
  recordReceiptWarning(receipt, {
    category: "process",
    code: "cleanup_failed",
    message: "Could not close transport.",
    phase: "cleanup",
    time: 1_700_000_000_750
  });
  const result = finalizeReceipt(
    receipt,
    {
      changedFiles: ["src/app.js"],
      reason: "verified",
      round: 1,
      status: "completed"
    },
    1_700_000_001_000
  );

  assert.equal(result.schemaVersion, RECEIPT_SCHEMA_VERSION);
  assert.equal(result.id, "run-1");
  assert.equal(result.startedAt, "2023-11-14T22:13:20.000Z");
  assert.equal(result.endedAt, "2023-11-14T22:13:21.000Z");
  assert.deepEqual(result.project, { baseCommit: "abc123", root: "/repo" });
  assert.equal(result.rounds[0].diffHash, "diff-1");
  assert.deepEqual(result.rounds[0].review.findings, []);
  assert.equal(result.rounds[0].review.checks[0].status, "passed");
  assert.equal(result.retries[0].operation, "claude_review");
  assert.equal(result.warnings[0].code, "cleanup_failed");
  assert.equal(result.result.reason, "verified");
  assert.equal(result.result.error, null);
  assert.equal("transcript" in result, false);
});
