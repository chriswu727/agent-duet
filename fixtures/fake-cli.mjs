const [role, ...args] = process.argv.slice(2);

if (role === "codex") {
  if (args[0] === "--version") {
    console.log("codex-cli 9.9.9");
  } else if (args[0] === "login" && args[1] === "status") {
    console.log("Logged in using ChatGPT");
  } else if (args[0] === "mcp-server" && args[1] === "--help") {
    console.log("Usage: codex mcp-server");
  } else {
    process.exitCode = 2;
  }
} else if (role === "claude") {
  if (args[0] === "--version") {
    console.log("9.9.9 (Claude Code)");
  } else if (args[0] === "auth" && args[1] === "status" && args[2] === "--json") {
    console.log(
      JSON.stringify({
        authMethod: "claude.ai",
        loggedIn: true,
        subscriptionType: "max"
      })
    );
  } else if (args[0] === "--help") {
    console.log(`
--agent
--agents
--disable-slash-commands
--json-schema
--mcp-config
--no-chrome
--no-session-persistence
--output-format
--permission-mode
--print
--setting-sources
--strict-mcp-config
`);
  } else {
    process.exitCode = 2;
  }
} else {
  process.exitCode = 2;
}
