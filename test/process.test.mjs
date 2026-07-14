import assert from "node:assert/strict";
import test from "node:test";
import { subscriptionEnvironment } from "../src/core/process.mjs";

test("passes subscription config but strips API credential overrides", () => {
  const env = subscriptionEnvironment({
    ANTHROPIC_API_KEY: "secret",
    CLAUDE_CONFIG_DIR: "/claude",
    CODEX_HOME: "/codex",
    HOME: "/home",
    OPENAI_API_KEY: "secret",
    PATH: "/bin"
  });
  assert.deepEqual(env, {
    CLAUDE_CONFIG_DIR: "/claude",
    CODEX_HOME: "/codex",
    HOME: "/home",
    PATH: "/bin"
  });
});
