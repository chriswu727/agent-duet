import assert from "node:assert/strict";
import test from "node:test";
import {
  runVerification,
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
      args: ["/d", "/s", "/c", "pnpm test"],
      shell: "C:\\Windows\\System32\\cmd.exe"
    }
  );
});

test("runs a verification command through the current platform shell", async () => {
  const command = `"${process.execPath}" -e "process.stdout.write('verified')"`;
  const result = await runVerification(command, process.cwd());

  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, "verified");
  assert.equal(result.timedOut, false);
});
