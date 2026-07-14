import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { subscriptionEnvironment } from "./process.mjs";
import { DuetStdioClientTransport } from "./stdio-transport.mjs";

export class McpSession {
  constructor({ args, command, cwd, name, onLog }) {
    this.onLog = onLog;
    this.client = new Client(
      { name: `duet-${name}`, version: "0.1.1" },
      { capabilities: {} }
    );
    this.transport = new DuetStdioClientTransport({
      args,
      command,
      cwd,
      env: subscriptionEnvironment(),
      stderr: "pipe"
    });
    this.transport.stderr?.on("data", (chunk) => {
      const line = chunk.toString().trim();
      if (line) this.onLog?.(line.slice(0, 2_000));
    });
  }

  async connect(requiredTools = []) {
    await this.client.connect(this.transport);
    const response = await this.client.listTools();
    this.tools = response.tools;
    const names = new Set(response.tools.map((tool) => tool.name));
    const missing = requiredTools.filter((tool) => !names.has(tool));
    if (missing.length) {
      throw new Error(`MCP server is missing required tools: ${missing.join(", ")}`);
    }
    return response.tools;
  }

  async call(name, args, { signal, timeoutMs = 30 * 60_000 } = {}) {
    return this.client.callTool(
      { name, arguments: args },
      undefined,
      { signal, timeout: timeoutMs, maxTotalTimeout: timeoutMs }
    );
  }

  async close() {
    await this.transport.close().catch(() => {});
  }
}

export function toolText(result) {
  if (typeof result?.structuredContent?.content === "string") {
    return result.structuredContent.content;
  }
  return (result?.content || [])
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n")
    .trim();
}

export function codexToolResult(result) {
  const structured = result?.structuredContent || {};
  return {
    content: structured.content || toolText(result),
    threadId: structured.threadId || null
  };
}
