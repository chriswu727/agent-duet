import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";

const tools = ["codex", "codex-reply"].map((name) => ({
  inputSchema: { type: "object" },
  name
}));
const server = new Server(
  { name: "fake-codex", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(CallToolRequestSchema, async ({ params }) => ({
  content: [{ text: `fake:${params.name}`, type: "text" }],
  structuredContent: {
    content: `fake:${params.name}`,
    threadId: params.name === "codex" ? "fake-thread" : undefined
  }
}));

await server.connect(new StdioServerTransport());
