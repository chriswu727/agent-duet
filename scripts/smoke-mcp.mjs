import { probeCliHealth } from "../src/core/health.mjs";
import { McpSession } from "../src/core/mcp.mjs";

const health = await probeCliHealth();
if (!health.codex.subscription || !health.claude.subscription) {
  throw new Error("Both CLIs must have subscription-backed local sessions.");
}

const codex = new McpSession({
  args: ["mcp-server", "-c", "mcp_servers={}"],
  command: health.codex.path,
  cwd: process.cwd(),
  name: "codex"
});
try {
  await codex.connect(["codex", "codex-reply"]);
  console.log(`Codex ${health.codex.version}: MCP ready with ChatGPT login`);
  console.log(
    `Claude Code ${health.claude.version}: local reviewer ready with ${health.claude.subscriptionType || "Claude.ai"} login`
  );
} finally {
  await codex.close();
}
