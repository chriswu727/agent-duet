import { findExecutable, runProcess } from "./process.mjs";

export async function probeCliHealth(overrides = {}) {
  const [codexPath, claudePath] = await Promise.all([
    findExecutable("codex", overrides.codexPath || process.env.DUET_CODEX_PATH),
    findExecutable("claude", overrides.claudePath || process.env.DUET_CLAUDE_PATH)
  ]);

  const result = {
    codex: { installed: Boolean(codexPath), path: codexPath, subscription: false },
    claude: { installed: Boolean(claudePath), path: claudePath, subscription: false }
  };

  if (codexPath) {
    const [version, auth] = await Promise.all([
      runProcess(codexPath, ["--version"]),
      runProcess(codexPath, ["login", "status"])
    ]);
    result.codex.version = version.stdout.trim();
    result.codex.auth = auth.stdout.trim() || auth.stderr.trim();
    result.codex.subscription = auth.code === 0 && /using ChatGPT/i.test(result.codex.auth);
  }

  if (claudePath) {
    const [version, auth] = await Promise.all([
      runProcess(claudePath, ["--version"]),
      runProcess(claudePath, ["auth", "status", "--json"])
    ]);
    result.claude.version = version.stdout.trim();
    try {
      const parsed = JSON.parse(auth.stdout);
      result.claude.authMethod = parsed.authMethod;
      result.claude.subscriptionType = parsed.subscriptionType;
      result.claude.subscription =
        auth.code === 0 && parsed.loggedIn === true && parsed.authMethod === "claude.ai";
    } catch {
      result.claude.error = auth.stderr.trim() || "Could not parse Claude auth status.";
    }
  }

  return result;
}
