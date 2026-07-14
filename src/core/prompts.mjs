import { capText, HARD_LIMITS } from "./limits.mjs";
import { formatFindings } from "./review.mjs";

export { parseReview } from "./review.mjs";

export const LEAN_POLICY = `Work like a necessity-first senior engineer. Understand the touched flow before editing. Reuse existing code, then standard library, native platform features, and installed dependencies before adding anything. Make the smallest correct diff. Do not remove trust-boundary validation, data-loss prevention, security controls, accessibility, or requested behavior. Do not add speculative abstractions or dependencies. Verify the result with the smallest relevant runnable check.`;

export function implementationPrompt({ task, verificationCommand }) {
  const verification = verificationCommand
    ? `The user's explicit verification command is: ${verificationCommand}`
    : "Discover and run the smallest relevant existing checks.";
  return `${LEAN_POLICY}\n\nImplement this task in the current repository:\n${task}\n\n${verification}\nPreserve unrelated work. Do not commit or push. End with a compact summary of changed files and checks run.`;
}

export function reviewPrompt({ task, snapshot, verification }) {
  const verificationText = verification
    ? `Verification exit ${verification.code}${verification.timedOut ? " (timed out)" : ""}:\n${capText(verification.stdout || verification.stderr, 2_000)}`
    : "No explicit verification command was configured.";
  return `Independently review the current Git working tree for this task:\n${task}\n\nYou are read-only. Inspect the actual diff and relevant callers; do not edit files. Focus only on correctness, security, data loss, regressions, and missing requested behavior. Reject speculative style feedback. Limit yourself to at most 8 actionable findings.\n\nChanged files: ${snapshot.changed.join(", ") || "none"}\nDiff stat:\n${snapshot.stat}\n\n${verificationText}\n\nReturn the requested structured review. Use line 0 or an empty path only when no precise location exists. Keep blockedReason empty unless the repository cannot be reviewed. Use PASS only when findings is empty and the supplied verification did not fail.`;
}

export function revisionPrompt({ findings, verification }) {
  const verificationText = verification && verification.code !== 0
    ? `\nThe verification command also failed:\n${capText(verification.stdout || verification.stderr, 2_000)}`
    : "";
  return `${LEAN_POLICY}\n\nAn independent read-only reviewer found the following actionable issues. Verify each claim against the repository, fix only valid findings, and rerun the relevant checks. Do not commit or push.\n\n${capText(formatFindings(findings), HARD_LIMITS.maxHandoffChars)}${verificationText}`;
}
