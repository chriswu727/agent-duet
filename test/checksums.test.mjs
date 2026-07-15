import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  CHECKSUM_FILE,
  generateChecksums,
  verifyChecksums
} from "../scripts/lib/checksums.mjs";

test("generates deterministic checksums and detects tampering", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "duet-checksums-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  await writeFile(join(root, "Duet.zip"), "zip");
  await writeFile(join(root, "latest.yml"), "version: 1");

  const generated = await generateChecksums(root);
  assert.equal(generated.count, 2);
  assert.deepEqual(
    (await readFile(join(root, CHECKSUM_FILE), "utf8")).trim().split("\n").map((line) =>
      line.split("  ")[1]
    ),
    ["Duet.zip", "latest.yml"]
  );
  assert.deepEqual(await verifyChecksums(root), { count: 2 });

  await writeFile(join(root, "Duet.zip"), "tampered");
  await assert.rejects(verifyChecksums(root), /Checksum mismatch/);
});

test("rejects checksum manifests that omit or duplicate release assets", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "duet-checksums-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  await writeFile(join(root, "Duet.zip"), "zip");
  await generateChecksums(root);
  await writeFile(join(root, "unexpected.txt"), "unexpected");
  await assert.rejects(verifyChecksums(root), /exactly cover/);

  await rm(join(root, "unexpected.txt"));
  const manifest = await readFile(join(root, CHECKSUM_FILE), "utf8");
  await writeFile(join(root, CHECKSUM_FILE), `${manifest}${manifest}`);
  await assert.rejects(verifyChecksums(root), /duplicate/);
});
