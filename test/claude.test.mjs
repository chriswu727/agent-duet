import assert from "node:assert/strict";
import test from "node:test";
import { claudeReviewArgs, reviewWithClaude } from "../src/core/claude.mjs";

test("isolates the Claude reviewer from nested MCP and write tools", () => {
  const args = claudeReviewArgs({ model: "sonnet", prompt: "Review this" });
  assert.ok(args.includes("--strict-mcp-config"));
  assert.ok(args.includes("--disable-slash-commands"));
  assert.ok(args.includes("--json-schema"));
  const schema = JSON.parse(args[args.indexOf("--json-schema") + 1]);
  assert.deepEqual(schema.properties.verdict.enum, ["PASS", "REVISE", "BLOCKED"]);
  const agents = JSON.parse(args[args.indexOf("--agents") + 1]);
  const reviewer = agents["duet-reviewer"];
  assert.equal(reviewer.permissionMode, "plan");
  assert.ok(reviewer.disallowedTools.includes("Write"));
  assert.ok(reviewer.disallowedTools.includes("Agent"));
  assert.doesNotMatch(reviewer.tools.join(","), /Write|Edit|Agent/);
  assert.ok(args.includes("--no-session-persistence"));
  assert.equal(args.at(-1), "Review this");
});

test("extracts structured Claude CLI output without a live model call", async () => {
  const structured = {
    blockedReason: "",
    checks: [],
    findings: [],
    summary: "No defects found.",
    verdict: "PASS"
  };
  const result = await reviewWithClaude({
    command: "claude",
    cwd: "/repo",
    model: "haiku",
    prompt: "Review this",
    runner: async () => ({
      code: 0,
      stderr: "",
      stdout: JSON.stringify({ is_error: false, structured_output: structured }),
      timedOut: false
    })
  });
  assert.deepEqual(result, structured);
});

test("rejects a successful Claude envelope without structured output", async () => {
  await assert.rejects(
    reviewWithClaude({
      command: "claude",
      cwd: "/repo",
      model: "haiku",
      prompt: "Review this",
      runner: async () => ({
        code: 0,
        stderr: "",
        stdout: JSON.stringify({ is_error: false, result: "Looks good" }),
        timedOut: false
      })
    }),
    (error) => error.code === "claude_output_invalid"
  );
});

test("rejects malformed Claude CLI output", async () => {
  await assert.rejects(
    reviewWithClaude({
      command: "claude",
      cwd: "/repo",
      model: "haiku",
      prompt: "Review this",
      runner: async () => ({ code: 0, stderr: "", stdout: "not json", timedOut: false })
    }),
    /invalid JSON/
  );
});
