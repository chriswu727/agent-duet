import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  clearRunHistory,
  deleteRunReceipt,
  listRunHistory,
  readRunReceipt,
  saveRunReceipt,
  trimRunHistory
} from "../src/core/history.mjs";
import { beginReceipt, finalizeReceipt } from "../src/core/receipt.mjs";

function receipt(id, now = 1_700_000_000_000) {
  const started = beginReceipt({
    config: {
      maxMinutes: 60,
      maxRounds: 3,
      projectPath: `/projects/${id}`,
      reviewModel: "sonnet",
      task: `Task ${id}`,
      verificationCommand: "pnpm test"
    },
    id,
    now
  });
  return finalizeReceipt(started, {
    changedFiles: ["src/app.js"],
    reason: "verified",
    round: 1,
    status: "completed"
  }, now + 1_000);
}

async function historyRoot(t) {
  const directory = await mkdtemp(join(tmpdir(), "duet-history-"));
  const root = join(directory, "history");
  t.after(() => rm(directory, { force: true, recursive: true }));
  return root;
}

test("atomically saves, lists, and reads transcript-free receipts", async (t) => {
  const root = await historyRoot(t);
  const saved = await saveRunReceipt(root, receipt("run-1"));
  const history = await listRunHistory(root);
  const loaded = await readRunReceipt(root, "run-1");

  assert.equal(saved.project, "run-1");
  assert.equal(history.corruptCount, 0);
  assert.equal(history.items[0].task, "Task run-1");
  assert.equal(loaded.schemaVersion, 2);
  assert.equal("transcript" in loaded, false);
  if (process.platform !== "win32") {
    assert.equal((await stat(join(root, "run-1.json"))).mode & 0o777, 0o600);
    assert.equal((await stat(root)).mode & 0o777, 0o700);
  }
});

test("ignores corrupt receipt files and reports their count", async (t) => {
  const root = await historyRoot(t);
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "broken.json"), "not json");
  await saveRunReceipt(root, receipt("run-1"));

  const history = await listRunHistory(root);
  assert.equal(history.corruptCount, 1);
  assert.equal(history.items.length, 1);
});

test("prunes local history to the configured bound", async (t) => {
  const root = await historyRoot(t);
  await saveRunReceipt(root, receipt("run-1", 1_700_000_000_000), { maxItems: 2 });
  await saveRunReceipt(root, receipt("run-2", 1_700_000_010_000), { maxItems: 2 });
  await saveRunReceipt(root, receipt("run-3", 1_700_000_020_000), { maxItems: 2 });

  assert.equal((await listRunHistory(root)).items.length, 2);
});

test("rejects receipt ids that could escape the history root", async (t) => {
  const root = await historyRoot(t);
  await assert.rejects(readRunReceipt(root, "../outside"), /Invalid run receipt id/);
});

test("deletes one receipt or clears all local history", async (t) => {
  const root = await historyRoot(t);
  await saveRunReceipt(root, receipt("run-1"));
  await saveRunReceipt(root, receipt("run-2"));

  await deleteRunReceipt(root, "run-1");
  assert.deepEqual((await listRunHistory(root)).items.map((item) => item.id), ["run-2"]);

  await clearRunHistory(root);
  assert.deepEqual(await listRunHistory(root), { corruptCount: 0, items: [] });
});

test("supports zero retention and rejects invalid limits", async (t) => {
  const root = await historyRoot(t);
  await saveRunReceipt(root, receipt("run-1"));
  await trimRunHistory(root, 0);

  assert.equal((await listRunHistory(root)).items.length, 0);
  await assert.rejects(trimRunHistory(root, -1), /Invalid run history/);
  await assert.rejects(trimRunHistory(root, 101), /Invalid run history/);
});
