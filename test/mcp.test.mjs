import assert from "node:assert/strict";
import test from "node:test";
import {
  codexToolResult,
  McpSession,
  toolText
} from "../src/core/mcp.mjs";
import { fakeExecutable } from "../fixtures/executable.mjs";

test("connects, lists tools, calls tools, and closes a fake stdio MCP server", async (t) => {
  const fixture = await fakeExecutable(
    new URL("../fixtures/fake-mcp-server.mjs", import.meta.url)
  );
  t.after(fixture.dispose);
  const session = new McpSession({
    args: [],
    command: fixture.command,
    cwd: process.cwd(),
    name: "contract"
  });
  t.after(() => session.close());

  const tools = await session.connect(["codex", "codex-reply"]);
  const result = await session.call("codex", { prompt: "offline contract" });

  assert.deepEqual(tools.map((tool) => tool.name), ["codex", "codex-reply"]);
  assert.equal(toolText(result), "fake:codex");
  assert.deepEqual(codexToolResult(result), {
    content: "fake:codex",
    threadId: "fake-thread"
  });
  await session.close();
});
