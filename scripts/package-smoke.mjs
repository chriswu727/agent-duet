import assert from "node:assert/strict";
import { createServer } from "node:net";
import { access, mkdtemp, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { arch, platform, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import spawn from "cross-spawn";
import { chromium } from "playwright-core";
import { terminateProcessTree } from "../src/core/process.mjs";

export function packageExecutableCandidates(options = {}) {
  const {
    root = resolve("release"),
    targetArch = arch(),
    targetPlatform = platform()
  } = options;
  if (targetPlatform === "darwin") {
    const directories = [
      "mac-universal",
      targetArch === "arm64" ? "mac-arm64" : "mac",
      "mac-arm64",
      "mac"
    ];
    return [...new Set(directories)].map((directory) =>
      join(root, directory, "Duet.app", "Contents", "MacOS", "Duet")
    );
  }
  if (targetPlatform === "win32") {
    return [join(root, "win-unpacked", "Duet.exe")];
  }
  return [
    join(root, "linux-unpacked", "duet"),
    join(root, "linux-unpacked", "agent-duet")
  ];
}

export function packageResourcesPath(executable, targetPlatform = platform()) {
  if (targetPlatform === "darwin") {
    return resolve(executable, "..", "..", "Resources");
  }
  return join(resolve(executable, ".."), "resources");
}

async function findExecutable() {
  const explicit = process.env.DUET_PACKAGE_EXECUTABLE;
  for (const candidate of explicit
    ? [resolve(explicit)]
    : packageExecutableCandidates()) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {}
  }
  throw new Error("No packaged Duet executable found. Run `pnpm run pack` first.");
}

async function availablePort() {
  const server = createServer();
  await new Promise((done, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", done);
  });
  const { port } = server.address();
  await new Promise((done, reject) => server.close((error) =>
    error ? reject(error) : done()
  ));
  return port;
}

async function waitForDebugger(port, child, output) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Packaged Duet exited before startup.\n${output()}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return;
    } catch {}
    await new Promise((done) => setTimeout(done, 200));
  }
  throw new Error(`Timed out waiting for packaged Duet.\n${output()}`);
}

async function main() {
  const executable = await findExecutable();
  const port = await availablePort();
  const userData = await mkdtemp(join(tmpdir(), "duet-package-smoke-"));
  const screenshot = resolve("release", `package-smoke-${platform()}.png`);
  const child = spawn(executable, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userData}`
  ], {
    detached: platform() !== "win32",
    env: process.env,
    shell: false,
    windowsHide: true
  });
  let processOutput = "";
  const append = (chunk) => {
    processOutput = `${processOutput}${chunk}`.slice(-12_000);
  };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);
  let browser;
  try {
    await waitForDebugger(port, child, () => processOutput);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const page = browser.contexts()[0]?.pages()[0];
    assert.ok(page, "Packaged Duet did not create a renderer page.");
    const consoleErrors = [];
    const pageErrors = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await page.waitForSelector("#onboarding-dialog[open]");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(100);
    assert.equal(
      await page.locator("#onboarding-dialog").evaluate((dialog) => dialog.open),
      true,
      "Onboarding closed before acknowledgement."
    );
    await page.click("#finish-onboarding");
    const update = await page.evaluate(() => window.duet.updateStatus());
    assert.equal(update.state, "idle");
    assert.match(update.currentVersion, /^\d+\.\d+\.\d+/);

    await page.waitForFunction(
      () => !document.querySelector("#open-settings").disabled,
      null,
      { timeout: 45_000 }
    );
    await page.click("#open-settings");
    await page.selectOption("#settings-history-retention", "0");
    await page.click('#settings-form button[type="submit"]');
    await page.click("#open-settings");
    assert.equal(await page.inputValue("#settings-history-retention"), "0");
    await page.screenshot({ fullPage: true, path: screenshot });

    const session = await page.context().newCDPSession(page);
    await session.send("Runtime.evaluate", {
      expression: "window.location.href = 'https://example.com'"
    });
    await page.waitForTimeout(250);
    const location = await session.send("Runtime.evaluate", {
      expression: "window.location.href",
      returnByValue: true
    });
    assert.equal(location.result.value, "duet://app/index.html");
    assert.deepEqual(consoleErrors, []);
    assert.deepEqual(pageErrors, []);

    console.log(JSON.stringify({
      consoleErrors: 0,
      executable,
      pageErrors: 0,
      updateState: update.state,
      url: location.result.value
    }));
  } finally {
    await browser?.close().catch(() => {});
    terminateProcessTree(child, { force: true });
    await rm(userData, { force: true, recursive: true });
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
