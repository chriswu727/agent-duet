import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import {
  packageExecutableCandidates,
  packageResourcesPath
} from "../scripts/package-smoke.mjs";

test("resolves packaged executables on every supported platform", () => {
  const root = "/release";
  assert.deepEqual(packageExecutableCandidates({
    root,
    targetArch: "arm64",
    targetPlatform: "darwin"
  }), [
    join(root, "mac-universal", "Duet.app", "Contents", "MacOS", "Duet"),
    join(root, "mac-arm64", "Duet.app", "Contents", "MacOS", "Duet"),
    join(root, "mac", "Duet.app", "Contents", "MacOS", "Duet")
  ]);
  assert.deepEqual(packageExecutableCandidates({ root, targetPlatform: "win32" }), [
    join(root, "win-unpacked", "Duet.exe")
  ]);
  assert.deepEqual(packageExecutableCandidates({ root, targetPlatform: "linux" }), [
    join(root, "linux-unpacked", "duet"),
    join(root, "linux-unpacked", "agent-duet")
  ]);
});

test("resolves platform package resource directories", () => {
  const mac = join("/release", "mac", "Duet.app", "Contents", "MacOS", "Duet");
  assert.equal(
    packageResourcesPath(mac, "darwin"),
    join("/release", "mac", "Duet.app", "Contents", "Resources")
  );
  assert.equal(
    packageResourcesPath(join("/release", "win-unpacked", "Duet.exe"), "win32"),
    join("/release", "win-unpacked", "resources")
  );
});
