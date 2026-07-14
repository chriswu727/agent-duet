import { platform } from "node:os";
import { runProcess, subscriptionEnvironment } from "./process.mjs";

export async function runVerification(command, cwd, signal) {
  if (!command) return null;
  const invocation = verificationInvocation(command);
  return runProcess(invocation.shell, invocation.args, {
    cwd,
    env: subscriptionEnvironment(),
    maxOutputChars: 20_000,
    signal,
    timeoutMs: 10 * 60_000
  });
}

export function verificationInvocation(
  command,
  { env = process.env, targetPlatform = platform() } = {}
) {
  if (targetPlatform === "win32") {
    return {
      args: ["/d", "/s", "/c", command],
      shell: env.ComSpec || "cmd.exe"
    };
  }
  return {
    args: ["-lc", command],
    shell: targetPlatform === "darwin" ? "/bin/zsh" : "/bin/sh"
  };
}
