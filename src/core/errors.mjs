export const ERROR_CATEGORY = Object.freeze({
  AUTH: "auth",
  COMPATIBILITY: "compatibility",
  CONFIGURATION: "configuration",
  EXTERNAL: "external",
  FILESYSTEM: "filesystem",
  GIT: "git",
  INTERNAL: "internal",
  PROCESS: "process",
  PROTOCOL: "protocol",
  VERIFICATION: "verification"
});

export const ERROR_CODE = Object.freeze({
  CLAUDE_AUTH_REQUIRED: "claude_auth_required",
  CLAUDE_INCOMPATIBLE: "claude_incompatible",
  CLAUDE_OUTPUT_INVALID: "claude_output_invalid",
  CLAUDE_REVIEW_FAILED: "claude_review_failed",
  CLAUDE_REVIEW_TIMEOUT: "claude_review_timeout",
  CLEANUP_FAILED: "cleanup_failed",
  CODEX_AUTH_REQUIRED: "codex_auth_required",
  CODEX_CONNECT_FAILED: "codex_connect_failed",
  CODEX_FAILED: "codex_failed",
  CODEX_INCOMPATIBLE: "codex_incompatible",
  CODEX_PROTOCOL_INVALID: "codex_protocol_invalid",
  CONFIG_INVALID: "config_invalid",
  DIRTY_WORKTREE: "dirty_worktree",
  GIT_INSPECTION_FAILED: "git_inspection_failed",
  INTERNAL: "internal_error",
  PREFLIGHT_FAILED: "preflight_failed",
  REVIEW_PROTOCOL_INVALID: "review_protocol_invalid",
  VERIFICATION_FAILED: "verification_failed",
  WORKSPACE_FAILED: "workspace_failed"
});

export class DuetError extends Error {
  constructor(code, message, options = {}) {
    const text = String(message || "Unknown Duet error.");
    const bounded = text.length > 4_000
      ? `${text.slice(0, 4_000)}\n[truncated by Duet]`
      : text;
    super(bounded, { cause: options.cause });
    this.name = "DuetError";
    this.category = options.category || ERROR_CATEGORY.INTERNAL;
    this.code = code;
    this.phase = options.phase || null;
    this.retryable = Boolean(options.retryable);
  }
}

export function asDuetError(error, fallback = {}) {
  if (error instanceof DuetError) return error;
  return new DuetError(
    fallback.code || ERROR_CODE.INTERNAL,
    error instanceof Error ? error.message : String(error),
    {
      category: fallback.category,
      cause: error,
      phase: fallback.phase,
      retryable: fallback.retryable
    }
  );
}

export function serializeDuetError(error) {
  const normalized = asDuetError(error);
  return {
    category: normalized.category,
    code: normalized.code,
    message: normalized.message.slice(0, 2_000),
    phase: normalized.phase,
    retryable: normalized.retryable
  };
}

export function transientProcessFailure(message) {
  return /(?:429|rate.?limit|overload|temporar|service unavailable|econn|etimedout|network|socket hang up|connection reset)/i.test(
    String(message || "")
  );
}

function wait(delayMs, signal) {
  if (!delayMs) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const done = () => {
      signal?.removeEventListener("abort", stop);
      resolve();
    };
    const timer = setTimeout(done, delayMs);
    const stop = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", stop);
      reject(signal.reason || new Error("Operation cancelled."));
    };
    signal?.addEventListener("abort", stop, { once: true });
    if (signal?.aborted) stop();
  });
}

export async function retryOperation(operation, options = {}) {
  const {
    delays = [750],
    maxAttempts = 2,
    onRetry = () => {},
    signal,
    waitForRetry = wait
  } = options;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    signal?.throwIfAborted();
    try {
      return await operation(attempt);
    } catch (error) {
      if (signal?.aborted || !error?.retryable || attempt === maxAttempts) throw error;
      const delayMs = delays[Math.min(attempt - 1, delays.length - 1)] || 0;
      await onRetry({
        attempt,
        delayMs,
        error,
        maxAttempts,
        nextAttempt: attempt + 1
      });
      await waitForRetry(delayMs, signal);
    }
  }

  throw new DuetError(ERROR_CODE.INTERNAL, "Retry loop ended unexpectedly.");
}
