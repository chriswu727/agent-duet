import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  trustedRendererFrame,
  trustedRendererUrl
} from "../src/core/security.mjs";

test("accepts only the exact Duet renderer origin", () => {
  assert.equal(trustedRendererUrl("duet://app/index.html"), true);
  assert.equal(trustedRendererUrl("duet://app/settings/path"), true);
  assert.equal(trustedRendererUrl("duet://app.evil.test/index.html"), false);
  assert.equal(trustedRendererUrl("duet://app@evil.test/index.html"), false);
  assert.equal(trustedRendererUrl("duet://evil@app/index.html"), false);
  assert.equal(trustedRendererUrl("https://app/index.html"), false);
  assert.equal(trustedRendererUrl("not a URL"), false);
});

test("accepts the top-level trusted frame and rejects child frames", () => {
  const top = { url: "duet://app/index.html" };
  top.top = top;
  const child = { top, url: "duet://app/index.html" };

  assert.equal(trustedRendererFrame(top), true);
  assert.equal(trustedRendererFrame(child), false);
  assert.equal(trustedRendererFrame(null), false);
});

test("configures every supported Electron security fuse", async () => {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url)));
  assert.deepEqual(manifest.build.electronFuses, {
    enableCookieEncryption: true,
    enableEmbeddedAsarIntegrityValidation: true,
    enableNodeCliInspectArguments: false,
    enableNodeOptionsEnvironmentVariable: false,
    grantFileProtocolExtraPrivileges: false,
    loadBrowserProcessSpecificV8Snapshot: false,
    onlyLoadAppFromAsar: true,
    resetAdHocDarwinSignature: true,
    runAsNode: false
  });
});

test("keeps the Electron renderer sandbox and browser escape controls enabled", async () => {
  const [html, main] = await Promise.all([
    readFile(new URL("../src/renderer/index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/main.mjs", import.meta.url), "utf8")
  ]);

  for (const pattern of [
    /app\.enableSandbox\(\)/,
    /contextIsolation: true/,
    /nodeIntegration: false/,
    /sandbox: true/,
    /setPermissionCheckHandler\(\(\) => false\)/,
    /will-attach-webview/,
    /will-navigate/,
    /will-redirect/,
    /setWindowOpenHandler/
  ]) assert.match(main, pattern);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /object-src 'none'/);
});
