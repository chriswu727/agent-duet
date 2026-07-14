import { platform } from "node:os";
import { runProcess, subscriptionEnvironment } from "./process.mjs";

export async function runVerification(command, cwd, signal) {
  if (!command) return null;
  const windows = platform() === "win32";
  const shell = windows ? process.env.ComSpec || "cmd.exe" : "/bin/zsh";
  const args = windows ? ["/d", "/s", "/c", command] : ["-lc", command];
  return runProcess(shell, args, {
    cwd,
    env: subscriptionEnvironment(),
    maxOutputChars: 20_000,
    signal,
    timeoutMs: 10 * 60_000
  });
}
