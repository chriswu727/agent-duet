import assert from "node:assert/strict";
import test from "node:test";
import {
  asDuetError,
  DuetError,
  ERROR_CATEGORY,
  ERROR_CODE,
  retryOperation,
  serializeDuetError,
  transientProcessFailure
} from "../src/core/errors.mjs";

test("serializes stable error fields without exposing the cause", () => {
  const cause = new Error("private child failure");
  const error = new DuetError(ERROR_CODE.CODEX_CONNECT_FAILED, "Could not connect.", {
    category: ERROR_CATEGORY.PROCESS,
    cause,
    phase: "codex_connect",
    retryable: false
  });
  const serialized = serializeDuetError(error);

  assert.deepEqual(serialized, {
    category: "process",
    code: "codex_connect_failed",
    message: "Could not connect.",
    phase: "codex_connect",
    retryable: false
  });
  assert.equal("cause" in serialized, false);
  assert.equal(asDuetError(error), error);
});

test("recognizes only explicit transient process signals", () => {
  assert.equal(transientProcessFailure("503 Service Unavailable"), true);
  assert.equal(transientProcessFailure("ECONNRESET while reading"), true);
  assert.equal(transientProcessFailure("Permission denied"), false);
});

test("retries a retryable read-only operation once", async () => {
  let calls = 0;
  const retries = [];
  const result = await retryOperation(async () => {
    calls += 1;
    if (calls === 1) {
      throw new DuetError(ERROR_CODE.CLAUDE_REVIEW_FAILED, "Overloaded", {
        retryable: true
      });
    }
    return "review";
  }, {
    onRetry: (retry) => retries.push(retry),
    waitForRetry: async () => {}
  });

  assert.equal(result, "review");
  assert.equal(calls, 2);
  assert.equal(retries.length, 1);
  assert.equal(retries[0].nextAttempt, 2);
});

test("does not retry permanent failures", async () => {
  let calls = 0;
  await assert.rejects(
    retryOperation(async () => {
      calls += 1;
      throw new DuetError(ERROR_CODE.CLAUDE_OUTPUT_INVALID, "Invalid output");
    }, { waitForRetry: async () => {} }),
    /Invalid output/
  );
  assert.equal(calls, 1);
});
