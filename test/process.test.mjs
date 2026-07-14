import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  executableCandidates,
  findExecutable,
  processIsRunning,
  runProcess,
  subscriptionEnvironment,
  terminationInvocation
} from "../src/core/process.mjs";

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

test("discovers Windows command shims and common npm locations", () => {
  const candidates = executableCandidates("codex", null, {
    env: {
      APPDATA: "C:\\Users\\dev\\AppData\\Roaming",
      LOCALAPPDATA: "C:\\Users\\dev\\AppData\\Local",
      PATH: "C:\\custom;C:\\tools",
      ProgramFiles: "C:\\Program Files"
    },
    home: "C:\\Users\\dev",
    targetPlatform: "win32"
  });

  assert.ok(candidates.includes("C:\\custom\\codex.cmd"));
  assert.ok(
    candidates.includes("C:\\Users\\dev\\AppData\\Roaming\\npm\\codex.cmd")
  );
  assert.ok(candidates.includes("C:\\Users\\dev\\.volta\\bin\\codex.cmd"));
  assert.ok(candidates.includes("C:\\Program Files\\nodejs\\codex.exe"));
});

test("prefers an explicit executable before discovered candidates", async () => {
  const checked = [];
  const path = await findExecutable("claude", "/custom/claude", {
    env: { PATH: "/bin" },
    executableCheck: async (candidate) => {
      checked.push(candidate);
      return candidate === "/custom/claude";
    },
    home: "/home/dev",
    targetPlatform: "linux"
  });

  assert.equal(path, "/custom/claude");
  assert.deepEqual(checked, ["/custom/claude"]);
});

test("builds process-tree termination invocations for Windows and Unix", () => {
  assert.deepEqual(terminationInvocation(42, false, "win32"), {
    args: ["/PID", "42", "/T"],
    command: "taskkill"
  });
  assert.deepEqual(terminationInvocation(42, true, "win32"), {
    args: ["/PID", "42", "/T", "/F"],
    command: "taskkill"
  });
  assert.deepEqual(terminationInvocation(42, false, "linux"), {
    pid: -42,
    signal: "SIGTERM"
  });
  assert.equal(processIsRunning({ exitCode: null, signalCode: null }), true);
  assert.equal(processIsRunning({ exitCode: null, signalCode: "SIGTERM" }), false);
});

function childExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForExit(pid) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (!childExists(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

test("times out and terminates a real process tree", async (t) => {
  const fixture = fileURLToPath(
    new URL("../fixtures/spawn-tree.mjs", import.meta.url)
  );
  const result = await runProcess(
    process.execPath,
    [fixture],
    { timeoutMs: 250 }
  );
  const childPid = Number(result.stdout.trim());
  t.after(() => {
    if (childExists(childPid)) process.kill(childPid, "SIGKILL");
  });

  assert.equal(result.timedOut, true);
  assert.notEqual(result.code, 0);
  assert.ok(Number.isInteger(childPid));
  assert.equal(await waitForExit(childPid), true, `child ${childPid} was left running`);
});
