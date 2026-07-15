import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
  runVerification,
  verificationEnvironment,
  verificationInvocation
} from "../src/core/verify.mjs";

test("selects the native verification shell on each platform", () => {
  assert.deepEqual(
    verificationInvocation("pnpm test", { targetPlatform: "darwin" }),
    { args: ["-lc", "pnpm test"], shell: "/bin/zsh" }
  );
  assert.deepEqual(
    verificationInvocation("pnpm test", { targetPlatform: "linux" }),
    { args: ["-lc", "pnpm test"], shell: "/bin/sh" }
  );
  assert.deepEqual(
    verificationInvocation("pnpm test", {
      env: { ComSpec: "C:\\Windows\\System32\\cmd.exe" },
      targetPlatform: "win32"
    }),
    {
      args: ["/d", "/s", "/c", '"pnpm test"'],
      shell: "C:\\Windows\\System32\\cmd.exe",
      windowsVerbatimArguments: true
    }
  );
});

test("runs a verification command through the current platform shell", async () => {
  const command = `"${process.execPath}" -e "process.stdout.write(process.env.HOME)"`;
  const result = await runVerification(command, process.cwd());

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /duet-verify-/);
  assert.notEqual(result.stdout, process.env.HOME);
  await assert.rejects(access(join(result.stdout, "..")));
  assert.equal(result.timedOut, false);
});

test("scrubs agent, provider, and proxy credentials from verification", () => {
  const environment = verificationEnvironment("/tmp/isolation", {
    source: {
      ANTHROPIC_API_KEY: "secret",
      CLAUDE_CONFIG_DIR: "/real/claude",
      CODEX_HOME: "/real/codex",
      HOME: "/real/home",
      HTTPS_PROXY: "https://name:password@proxy.test",
      NODE_OPTIONS: "--inspect",
      OPENAI_API_KEY: "secret",
      PATH: "/usr/bin"
    },
    targetPlatform: "linux"
  });

  assert.equal(environment.HOME, "/tmp/isolation/home");
  assert.equal(environment.PATH, "/usr/bin");
  for (const key of [
    "ANTHROPIC_API_KEY",
    "CLAUDE_CONFIG_DIR",
    "CODEX_HOME",
    "HTTPS_PROXY",
    "NODE_OPTIONS",
    "OPENAI_API_KEY"
  ]) assert.equal(environment[key], undefined);
});
