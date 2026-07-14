import assert from "node:assert/strict";
import test from "node:test";
import {
  probeCliHealth,
  REQUIRED_CLAUDE_FLAGS
} from "../src/core/health.mjs";
import { fakeExecutable } from "../fixtures/executable.mjs";

test("probes real cross-platform CLI wrappers without using subscriptions", async (t) => {
  const fixture = new URL("../fixtures/fake-cli.mjs", import.meta.url);
  const codex = await fakeExecutable(fixture, ["codex"]);
  const claude = await fakeExecutable(fixture, ["claude"]);
  t.after(async () => {
    await Promise.all([codex.dispose(), claude.dispose()]);
  });

  const health = await probeCliHealth({
    claudePath: claude.command,
    codexPath: codex.command
  });

  assert.deepEqual(
    {
      compatible: health.codex.compatible,
      subscription: health.codex.subscription,
      version: health.codex.version
    },
    { compatible: true, subscription: true, version: "codex-cli 9.9.9" }
  );
  assert.deepEqual(
    {
      compatible: health.claude.compatible,
      subscription: health.claude.subscription,
      subscriptionType: health.claude.subscriptionType
    },
    { compatible: true, subscription: true, subscriptionType: "max" }
  );
});

test("reports every missing Claude isolation option", async () => {
  const responses = new Map([
    ["--version", { code: 0, stderr: "", stdout: "Claude 1" }],
    ["auth status --json", {
      code: 0,
      stderr: "",
      stdout: '{"loggedIn":true,"authMethod":"claude.ai"}'
    }],
    ["--help", { code: 0, stderr: "", stdout: REQUIRED_CLAUDE_FLAGS[0] }]
  ]);
  const health = await probeCliHealth({
    finder: async (name) => (name === "claude" ? "/fake/claude" : null),
    runner: async (_command, args) => responses.get(args.join(" "))
  });

  assert.equal(health.claude.subscription, true);
  assert.equal(health.claude.compatible, false);
  assert.match(health.claude.compatibilityError, /--strict-mcp-config/);
});

test("contains an individual CLI launch failure in the health result", async () => {
  const health = await probeCliHealth({
    finder: async (name) => (name === "codex" ? "/broken/codex" : null),
    runner: async () => {
      throw new Error("cannot execute");
    }
  });

  assert.equal(health.codex.installed, true);
  assert.equal(health.codex.subscription, false);
  assert.equal(health.codex.compatible, false);
  assert.match(health.codex.compatibilityError, /cannot execute/);
});
