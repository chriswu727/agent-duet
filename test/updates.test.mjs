import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { UpdateController } from "../src/core/updates.mjs";

class FakeUpdater extends EventEmitter {
  async checkForUpdates() {}
  async downloadUpdate() {}
  quitAndInstall(...args) {
    this.installArgs = args;
  }
}

test("keeps development builds offline and rejects update operations", async () => {
  const updater = new FakeUpdater();
  const controller = new UpdateController({
    packaged: false,
    updater,
    version: "0.1.1"
  });

  assert.equal(controller.status().state, "unavailable");
  assert.equal(updater.listenerCount("error"), 0);
  await assert.rejects(controller.check(), /packaged builds/);
});

test("requires explicit download and install decisions", async () => {
  const events = [];
  const updater = new FakeUpdater();
  const controller = new UpdateController({
    onState: (state) => events.push(state),
    packaged: true,
    updater,
    version: "0.1.1"
  });

  assert.equal(updater.autoDownload, false);
  assert.equal(updater.autoInstallOnAppQuit, false);
  await controller.check();
  updater.emit("update-available", { version: "0.2.0" });
  await controller.download();
  updater.emit("download-progress", { percent: 52.4 });
  updater.emit("update-downloaded", { version: "0.2.0" });
  controller.install();

  assert.deepEqual(updater.installArgs, [false, true]);
  assert.deepEqual(events.map((event) => event.state), [
    "checking",
    "available",
    "downloading",
    "downloading",
    "ready",
    "installing"
  ]);
  assert.equal(events[3].percent, 52);
});

test("fails closed on invalid transitions and sanitizes updater errors", async () => {
  const updater = new FakeUpdater();
  const controller = new UpdateController({
    packaged: true,
    updater,
    version: "0.1.1-beta.1"
  });

  assert.equal(updater.allowPrerelease, true);
  await assert.rejects(controller.download(), /No verified update/);
  assert.throws(() => controller.install(), /No downloaded update/);
  updater.emit("error", new Error("network\nrequest failed"));
  assert.deepEqual(controller.status(), {
    currentVersion: "0.1.1-beta.1",
    message: "network request failed",
    percent: null,
    state: "error",
    version: null
  });
});
