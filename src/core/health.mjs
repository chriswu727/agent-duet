import { findExecutable, runProcess } from "./process.mjs";

export const REQUIRED_CLAUDE_FLAGS = Object.freeze([
  "--agent",
  "--agents",
  "--disable-slash-commands",
  "--mcp-config",
  "--no-chrome",
  "--no-session-persistence",
  "--output-format",
  "--permission-mode",
  "--print",
  "--setting-sources",
  "--strict-mcp-config"
]);

function output(result) {
  return [result?.stdout, result?.stderr].filter(Boolean).join("\n").trim();
}

async function safeRun(runner, command, args) {
  try {
    return await runner(command, args);
  } catch (error) {
    return {
      code: -1,
      stderr: error instanceof Error ? error.message : String(error),
      stdout: ""
    };
  }
}

export async function probeCliHealth(overrides = {}) {
  const finder = overrides.finder || findExecutable;
  const runner = overrides.runner || runProcess;
  const [codexPath, claudePath] = await Promise.all([
    finder("codex", overrides.codexPath || process.env.DUET_CODEX_PATH),
    finder("claude", overrides.claudePath || process.env.DUET_CLAUDE_PATH)
  ]);

  const result = {
    codex: {
      compatible: false,
      installed: Boolean(codexPath),
      path: codexPath,
      subscription: false
    },
    claude: {
      compatible: false,
      installed: Boolean(claudePath),
      path: claudePath,
      subscription: false
    }
  };

  if (codexPath) {
    const [version, auth, capability] = await Promise.all([
      safeRun(runner, codexPath, ["--version"]),
      safeRun(runner, codexPath, ["login", "status"]),
      safeRun(runner, codexPath, ["mcp-server", "--help"])
    ]);
    result.codex.version = output(version);
    result.codex.auth = output(auth);
    result.codex.subscription = auth.code === 0 && /using ChatGPT/i.test(result.codex.auth);
    result.codex.compatible = capability.code === 0;
    if (!result.codex.compatible) {
      result.codex.compatibilityError =
        output(capability) || "This Codex CLI does not provide the MCP server command.";
    }
  }

  if (claudePath) {
    const [version, auth, capability] = await Promise.all([
      safeRun(runner, claudePath, ["--version"]),
      safeRun(runner, claudePath, ["auth", "status", "--json"]),
      safeRun(runner, claudePath, ["--help"])
    ]);
    result.claude.version = output(version);
    try {
      const parsed = JSON.parse(auth.stdout);
      result.claude.authMethod = parsed.authMethod;
      result.claude.subscriptionType = parsed.subscriptionType;
      result.claude.subscription =
        auth.code === 0 && parsed.loggedIn === true && parsed.authMethod === "claude.ai";
    } catch {
      result.claude.error = output(auth) || "Could not parse Claude auth status.";
    }
    const help = output(capability);
    const missingFlags = REQUIRED_CLAUDE_FLAGS.filter((flag) => !help.includes(flag));
    result.claude.compatible = capability.code === 0 && missingFlags.length === 0;
    if (!result.claude.compatible) {
      result.claude.compatibilityError = missingFlags.length
        ? `This Claude Code CLI is missing required options: ${missingFlags.join(", ")}`
        : help || "Could not inspect Claude Code capabilities.";
    }
  }

  return result;
}
