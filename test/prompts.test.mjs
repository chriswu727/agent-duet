import assert from "node:assert/strict";
import test from "node:test";
import { parseReview, reviewPrompt } from "../src/core/prompts.mjs";

test("parses a structured revision request", () => {
  const review = parseReview(`VERDICT: REVISE
FINDINGS:
- [P1] src/a.js:4 — wrong branch
CHECKS:
- run tests`);
  assert.equal(review.verdict, "REVISE");
  assert.match(review.findings, /wrong branch/);
});

test("fails closed when reviewer output has no valid verdict", () => {
  const review = parseReview("Looks good to me.");
  assert.equal(review.verdict, "BLOCKED");
});

test("rejects an empty revision request", () => {
  const review = parseReview("VERDICT: REVISE\nFINDINGS:\nCHECKS:\n- none");
  assert.equal(review.verdict, "BLOCKED");
});

test("review prompt keeps the reviewer read-only and bounded", () => {
  const prompt = reviewPrompt({
    snapshot: { changed: ["src/a.js"], stat: "1 file changed" },
    task: "Fix the branch",
    verification: { code: 0, stderr: "", stdout: "ok", timedOut: false }
  });
  assert.match(prompt, /You are read-only/);
  assert.match(prompt, /at most 8 actionable findings/);
  assert.match(prompt, /Verification exit 0/);
});
