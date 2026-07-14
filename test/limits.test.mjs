import assert from "node:assert/strict";
import test from "node:test";
import { capText, estimateTokens, normalizeRunConfig } from "../src/core/limits.mjs";

test("normalizes defaults without treating them as subscription capacity", () => {
  const config = normalizeRunConfig({ projectPath: "/repo", task: "Fix it" });
  assert.equal(config.maxRounds, 3);
  assert.equal(config.maxMinutes, 60);
  assert.equal(config.reviewModel, "sonnet");
});

test("clamps per-run safety ceilings", () => {
  const config = normalizeRunConfig({
    maxMinutes: 999,
    maxRounds: 999,
    projectPath: "/repo",
    reviewModel: "unknown",
    task: "Fix it"
  });
  assert.equal(config.maxRounds, 6);
  assert.equal(config.maxMinutes, 120);
  assert.equal(config.reviewModel, "sonnet");
});

test("caps agent output and estimates only handoff text", () => {
  assert.match(capText("abcdef", 3), /abc\n\[truncated by Duet\]/);
  assert.equal(estimateTokens("12345"), 2);
});

test("requires a task and repository", () => {
  assert.throws(() => normalizeRunConfig({ projectPath: "/repo" }), /Task is required/);
  assert.throws(() => normalizeRunConfig({ task: "Fix it" }), /Project folder is required/);
});
