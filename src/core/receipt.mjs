import { createHash, randomUUID } from "node:crypto";
import { capText, HARD_LIMITS } from "./limits.mjs";

export const RECEIPT_SCHEMA_VERSION = 1;

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
    rounds: [],
    result: null
  };
}

export function setReceiptProject(receipt, { baseCommit, root }) {
  receipt.project = { baseCommit, root };
}

export function recordReceiptRound(receipt, { review, round, snapshot, verification }) {
  const findings = capText(review.findings, HARD_LIMITS.maxHandoffChars);
  receipt.rounds.push({
    changedFiles: [...snapshot.changed],
    diffHash: snapshot.hash,
    review: {
      findings,
      findingsHash: createHash("sha256").update(findings).digest("hex"),
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

export function finalizeReceipt(receipt, result, now) {
  return {
    ...receipt,
    endedAt: timestamp(now),
    result: {
      changedFiles: [...(result.changedFiles || [])],
      detail: result.detail || null,
      reason: result.reason,
      round: result.round || null,
      status: result.status
    }
  };
}
