import { DuetError, ERROR_CATEGORY, ERROR_CODE } from "./errors.mjs";

export const HARD_LIMITS = Object.freeze({
  maxRounds: 6,
  maxTaskChars: 12_000,
  maxHandoffChars: 6_000,
  maxAgentOutputChars: 12_000,
  maxRunMinutes: 120
});

export function normalizeRunConfig(input) {
  const task = String(input.task || "").trim();
  const projectPath = String(input.projectPath || "").trim();
  if (!task) {
    throw new DuetError(ERROR_CODE.CONFIG_INVALID, "Task is required.", {
      category: ERROR_CATEGORY.CONFIGURATION
    });
  }
  if (!projectPath) {
    throw new DuetError(ERROR_CODE.CONFIG_INVALID, "Project folder is required.", {
      category: ERROR_CATEGORY.CONFIGURATION
    });
  }
  if (task.length > HARD_LIMITS.maxTaskChars) {
    throw new DuetError(
      ERROR_CODE.CONFIG_INVALID,
      `Task is limited to ${HARD_LIMITS.maxTaskChars} characters.`,
      { category: ERROR_CATEGORY.CONFIGURATION }
    );
  }

  const maxRounds = Math.max(
    1,
    Math.min(HARD_LIMITS.maxRounds, Number(input.maxRounds) || 3)
  );
  const maxMinutes = Math.max(
    10,
    Math.min(HARD_LIMITS.maxRunMinutes, Number(input.maxMinutes) || 60)
  );
  const reviewModel = ["sonnet", "opus", "haiku"].includes(input.reviewModel)
    ? input.reviewModel
    : "sonnet";

  return {
    maxRounds,
    maxMinutes,
    projectPath,
    reviewModel,
    task,
    verificationCommand: String(input.verificationCommand || "").trim()
  };
}

export function capText(value, max = HARD_LIMITS.maxAgentOutputChars) {
  const text = String(value || "").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n[truncated by Duet]`;
}

export function estimateTokens(text) {
  return Math.ceil(String(text || "").length / 4);
}
