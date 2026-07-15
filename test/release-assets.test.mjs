import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { stageReleaseAssets } from "../scripts/lib/release-assets.mjs";

test("stages an exact platform release set", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "duet-release-assets-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  for (const name of [
    "Duet-0.2.0-mac-universal.dmg",
    "Duet-0.2.0-mac-universal.dmg.blockmap",
    "Duet-0.2.0-mac-universal.zip",
    "Duet-0.2.0-mac-universal.zip.blockmap",
    "duet-mac-universal.spdx.json",
    "latest-mac.yml"
  ]) await writeFile(join(root, name), name);

  const result = await stageReleaseAssets({ arch: "universal", root, target: "mac" });
  assert.equal(result.count, 6);
  assert.deepEqual((await readdir(result.output)).sort(), [
    "Duet-0.2.0-mac-universal.dmg",
    "Duet-0.2.0-mac-universal.dmg.blockmap",
    "Duet-0.2.0-mac-universal.zip",
    "Duet-0.2.0-mac-universal.zip.blockmap",
    "duet-mac-universal.spdx.json",
    "latest-mac.yml"
  ]);
});

test("rejects stale installers for another architecture", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "duet-release-assets-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  for (const name of [
    "Duet-0.2.0-mac-arm64.dmg",
    "duet-mac-universal.spdx.json",
    "latest-mac.yml"
  ]) await writeFile(join(root, name), name);

  await assert.rejects(
    stageReleaseAssets({ arch: "universal", root, target: "mac" }),
    /do not match/
  );
});
