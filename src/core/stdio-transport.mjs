import { platform } from "node:os";
import { PassThrough } from "node:stream";
import spawn from "cross-spawn";
import {
  ReadBuffer,
  serializeMessage
} from "@modelcontextprotocol/sdk/shared/stdio.js";
import { processIsRunning, terminateProcessTree } from "./process.mjs";

function waitForClose(child, timeoutMs) {
  if (!processIsRunning(child)) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      child.off("close", finish);
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    timer.unref();
    child.once("close", finish);
  });
}

export class DuetStdioClientTransport {
  constructor(server) {
    this.server = server;
    this.readBuffer = new ReadBuffer();
    this.stderrStream =
      server.stderr === "pipe" || server.stderr === "overlapped"
        ? new PassThrough()
        : null;
  }

  get stderr() {
    return this.stderrStream || this.child?.stderr || null;
  }

  get pid() {
    return this.child?.pid || null;
  }

  async start() {
    if (this.child) throw new Error("Duet MCP transport is already running.");

    await new Promise((resolve, reject) => {
      const child = spawn(this.server.command, this.server.args || [], {
        cwd: this.server.cwd,
        detached: platform() !== "win32",
        env: this.server.env,
        shell: false,
        stdio: ["pipe", "pipe", this.server.stderr || "inherit"],
        windowsHide: true
      });
      this.child = child;
      let started = false;

      child.once("error", (error) => {
        if (!started) reject(error);
        this.onerror?.(error);
      });
      child.once("spawn", () => {
        started = true;
        resolve();
      });
      child.once("close", () => {
        if (this.child === child) this.child = undefined;
        this.onclose?.();
      });
      child.stdin?.on("error", (error) => this.onerror?.(error));
      child.stdout?.on("error", (error) => this.onerror?.(error));
      child.stdout?.on("data", (chunk) => {
        this.readBuffer.append(chunk);
        this.processReadBuffer();
      });
      if (this.stderrStream && child.stderr) {
        child.stderr.pipe(this.stderrStream);
      }
    });
  }

  processReadBuffer() {
    while (true) {
      try {
        const message = this.readBuffer.readMessage();
        if (message === null) return;
        this.onmessage?.(message);
      } catch (error) {
        this.onerror?.(error);
      }
    }
  }

  async close() {
    const child = this.child;
    if (child) {
      try {
        child.stdin?.end();
      } catch {}
      await waitForClose(child, 1_000);
      if (processIsRunning(child)) {
        terminateProcessTree(child);
        await waitForClose(child, 2_000);
      }
      if (processIsRunning(child)) {
        terminateProcessTree(child, { force: true });
        await waitForClose(child, 1_000);
      }
    }
    this.child = undefined;
    this.readBuffer.clear();
  }

  send(message) {
    return new Promise((resolve, reject) => {
      if (!this.child?.stdin) {
        reject(new Error("Duet MCP transport is not connected."));
        return;
      }
      if (this.child.stdin.write(serializeMessage(message))) resolve();
      else this.child.stdin.once("drain", resolve);
    });
  }
}
