import assert from "node:assert/strict";
import test from "node:test";
import { parseReview, reviewPrompt, revisionPrompt } from "../src/core/prompts.mjs";

function revisionReview(overrides = {}) {
  return {
    blockedReason: "",
    checks: [{ evidence: "Missing branch coverage", name: "tests", status: "not_run" }],
    findings: [{
      evidence: "The false branch returns the success value.",
      line: 4,
      path: "src/a.js",
      priority: "P1",
      suggestion: "Return the failure value.",
      title: "Wrong branch"
    }],
    summary: "One defect needs revision.",
    verdict: "REVISE",
    ...overrides
  };
}

test("parses a structured revision request", () => {
  const review = parseReview(revisionReview());
  assert.equal(review.verdict, "REVISE");
  assert.equal(review.findings[0].path, "src/a.js");
});

test("fails closed when reviewer output is not structured", () => {
  const review = parseReview("Looks good to me.");
  assert.equal(review.verdict, "BLOCKED");
  assert.equal(review.protocolError, "review_protocol_invalid");
});

test("rejects an empty revision request", () => {
  const review = parseReview(revisionReview({ findings: [] }));
  assert.equal(review.verdict, "BLOCKED");
  assert.match(review.blockedReason, /requires at least one finding/);
});

test("rejects PASS with actionable findings", () => {
  const review = parseReview(revisionReview({ verdict: "PASS" }));
  assert.equal(review.verdict, "BLOCKED");
  assert.match(review.blockedReason, /PASS cannot include/);
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
  assert.match(prompt, /structured review/);
});

test("renders structured findings into a bounded revision handoff", () => {
  const prompt = revisionPrompt({
    findings: revisionReview().findings,
    verification: { code: 1, stderr: "failed", stdout: "", timedOut: false }
  });
  assert.match(prompt, /\[P1\] src\/a\.js:4/);
  assert.match(prompt, /Evidence: The false branch/);
  assert.match(prompt, /verification command also failed/);
});
