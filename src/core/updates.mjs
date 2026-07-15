function messageFor(error) {
  return String(error?.message || error || "Update operation failed.")
    .replace(/\s+/g, " ")
    .slice(0, 500);
}

export class UpdateController {
  constructor({ packaged, updater, version, onState = () => {} }) {
    this.packaged = packaged;
    this.updater = updater;
    this.version = version;
    this.onState = onState;
    this.state = {
      currentVersion: version,
      message: null,
      percent: null,
      state: packaged ? "idle" : "unavailable",
      version: null
    };
    if (!packaged) return;

    updater.allowDowngrade = false;
    updater.allowPrerelease = version.includes("-");
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.on("checking-for-update", () => this.transition("checking"));
    updater.on("update-available", (info) => {
      this.transition("available", { version: String(info.version) });
    });
    updater.on("update-not-available", () => this.transition("current"));
    updater.on("download-progress", (progress) => {
      this.transition("downloading", {
        percent: Math.max(0, Math.min(100, Math.round(Number(progress.percent) || 0))),
        version: this.state.version
      });
    });
    updater.on("update-downloaded", (info) => {
      this.transition("ready", { version: String(info.version) });
    });
    updater.on("error", (error) => {
      this.transition("error", { message: messageFor(error) });
    });
  }

  status() {
    return { ...this.state };
  }

  transition(state, details = {}) {
    this.state = {
      currentVersion: this.version,
      message: null,
      percent: null,
      state,
      version: null,
      ...details
    };
    this.onState(this.status());
  }

  ensurePackaged() {
    if (!this.packaged) throw new Error("Updates are available only in packaged builds.");
  }

  async check() {
    this.ensurePackaged();
    this.transition("checking");
    try {
      await this.updater.checkForUpdates();
      return this.status();
    } catch (error) {
      this.transition("error", { message: messageFor(error) });
      throw new Error(this.state.message);
    }
  }

  async download() {
    this.ensurePackaged();
    if (this.state.state !== "available") {
      throw new Error("No verified update is ready to download.");
    }
    const version = this.state.version;
    this.transition("downloading", { percent: 0, version });
    try {
      await this.updater.downloadUpdate();
      return this.status();
    } catch (error) {
      this.transition("error", { message: messageFor(error) });
      throw new Error(this.state.message);
    }
  }

  install() {
    this.ensurePackaged();
    if (this.state.state !== "ready") {
      throw new Error("No downloaded update is ready to install.");
    }
    this.transition("installing", { version: this.state.version });
    this.updater.quitAndInstall(false, true);
    return this.status();
  }
}
