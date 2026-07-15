import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  resetSettings,
  updateSettings
} from "../src/core/settings.mjs";

async function settingsRoot(t) {
  const root = await mkdtemp(join(tmpdir(), "duet-settings-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  return root;
}

test("loads safe defaults without creating a settings file", async (t) => {
  const root = await settingsRoot(t);
  const result = await loadSettings(root);

  assert.deepEqual(result.settings, DEFAULT_SETTINGS);
  assert.equal(result.warning, null);
  assert.deepEqual(await readdir(root), []);
});

test("atomically persists bounded preferences without task or project data", async (t) => {
  const root = await settingsRoot(t);
  const settings = await updateSettings(root, {
    historyRetention: "25",
    maxMinutes: "90",
    maxRounds: "4",
    onboardingComplete: true,
    reviewModel: "haiku",
    verificationCommand: "  pnpm test  "
  });
  const stored = JSON.parse(await readFile(join(root, "settings.json"), "utf8"));

  assert.equal(settings.maxMinutes, 90);
  assert.equal(settings.maxRounds, 4);
  assert.equal(settings.historyRetention, 25);
  assert.equal(settings.verificationCommand, "pnpm test");
  assert.equal("task" in stored, false);
  assert.equal("projectPath" in stored, false);
  if (process.platform !== "win32") {
    assert.equal((await stat(join(root, "settings.json"))).mode & 0o777, 0o600);
  }
});

test("quarantines corrupt settings and recovers defaults", async (t) => {
  const root = await settingsRoot(t);
  await writeFile(join(root, "settings.json"), "not json");
  const result = await loadSettings(root, { now: () => 123 });

  assert.deepEqual(result.settings, DEFAULT_SETTINGS);
  assert.match(result.warning, /safe defaults/);
  assert.deepEqual(await readdir(root), ["settings.json.corrupt-123"]);
});

test("rejects unknown preferences and reset preserves onboarding", async (t) => {
  const root = await settingsRoot(t);
  await assert.rejects(updateSettings(root, { task: "do not persist me" }));
  await updateSettings(root, {
    maxRounds: 6,
    onboardingComplete: true
  });
  const reset = await resetSettings(root);

  assert.equal(reset.maxRounds, DEFAULT_SETTINGS.maxRounds);
  assert.equal(reset.onboardingComplete, true);
});

test("migrates version 1 settings without losing preferences", async (t) => {
  const root = await settingsRoot(t);
  await writeFile(join(root, "settings.json"), JSON.stringify({
    maxMinutes: 90,
    maxRounds: 4,
    onboardingComplete: true,
    reviewModel: "haiku",
    schemaVersion: 1,
    verificationCommand: "pnpm test"
  }));

  const result = await loadSettings(root);
  const stored = JSON.parse(await readFile(join(root, "settings.json"), "utf8"));

  assert.equal(result.settings.historyRetention, 100);
  assert.equal(result.settings.maxRounds, 4);
  assert.equal(result.settings.schemaVersion, 2);
  assert.match(result.warning, /upgraded/);
  assert.deepEqual(stored, result.settings);
});
