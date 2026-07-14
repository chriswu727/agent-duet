import { createHash, randomUUID } from "node:crypto";
import { capText, HARD_LIMITS } from "./limits.mjs";

export const RECEIPT_SCHEMA_VERSION = 2;

function timestamp(value) {
  return new Date(value).toISOString();
}

export function beginReceipt({ config, id = randomUUID(), now }) {
  return {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    id,
    startedAt: timestamp(now),
    endedAt: null,
    project: {
      baseCommit: null,
      root: config.projectPath
    },
    request: {
      maxMinutes: config.maxMinutes,
      maxRounds: config.maxRounds,
      reviewModel: config.reviewModel,
      task: config.task,
      verificationCommand: config.verificationCommand
    },
    retries: [],
    rounds: [],
    result: null,
    warnings: []
  };
}

export function setReceiptProject(receipt, { baseCommit, root }) {
  receipt.project = { baseCommit, root };
}

export function recordReceiptRound(receipt, { review, round, snapshot, verification }) {
  const findings = review.findings.map((finding) => ({ ...finding }));
  const findingsText = capText(JSON.stringify(findings), HARD_LIMITS.maxHandoffChars);
  receipt.rounds.push({
    changedFiles: [...snapshot.changed],
    diffHash: snapshot.hash,
    review: {
      blockedReason: review.blockedReason,
      checks: review.checks.map((check) => ({ ...check })),
      findings,
      findingsHash: createHash("sha256").update(findingsText).digest("hex"),
      protocolError: review.protocolError || null,
      summary: review.summary,
      verdict: review.verdict
    },
    round,
    verification: verification
      ? {
          code: verification.code,
          timedOut: Boolean(verification.timedOut)
        }
      : null
  });
}

export function recordReceiptRetry(receipt, retry) {
  receipt.retries.push({
    attempt: retry.attempt,
    code: retry.code,
    delayMs: retry.delayMs,
    maxAttempts: retry.maxAttempts,
    operation: retry.operation,
    time: timestamp(retry.time)
  });
}

export function recordReceiptWarning(receipt, warning) {
  receipt.warnings.push({
    category: warning.category,
    code: warning.code,
    message: capText(warning.message, 2_000),
    phase: warning.phase,
    time: timestamp(warning.time)
  });
}

export function finalizeReceipt(receipt, result, now) {
  return {
    ...receipt,
    endedAt: timestamp(now),
    result: {
      changedFiles: [...(result.changedFiles || [])],
      detail: result.detail || null,
      error: result.error || null,
      reason: result.reason,
      round: result.round || null,
      status: result.status
    }
  };
}
