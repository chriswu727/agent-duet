import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  net,
  protocol,
  session
} from "electron";
import electronUpdater from "electron-updater";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { serializeDuetError } from "./core/errors.mjs";
import { probeCliHealth } from "./core/health.mjs";
import {
  clearRunHistory,
  deleteRunReceipt,
  listRunHistory,
  readRunReceipt,
  saveRunReceipt,
  trimRunHistory
} from "./core/history.mjs";
import { runDuet } from "./core/orchestrator.mjs";
import {
  loadSettings,
  resetSettings,
  updateSettings
} from "./core/settings.mjs";
import { trustedRendererFrame } from "./core/security.mjs";
import { UpdateController } from "./core/updates.mjs";
import {
  applyManagedWorkspace,
  discardManagedWorkspace,
  finalizeManagedWorkspace,
  listManagedWorkspaces,
  recoverManagedWorkspaces,
  undoManagedWorkspace,
  workspaceDiff
} from "./core/workspace.mjs";

const here = dirname(fileURLToPath(import.meta.url));
let mainWindow;
let currentRun;
let currentAbort;
let protocolReady = false;
let recoveryError;
let workspaceMutation;
let updateController;
const hasSingleInstanceLock = app.requestSingleInstanceLock();
const { autoUpdater } = electronUpdater;

protocol.registerSchemesAsPrivileged([
  {
    scheme: "duet",
    privileges: { secure: true, standard: true, supportFetchAPI: true }
  }
]);
app.enableSandbox();

function trusted(event) {
  return trustedRendererFrame(event.senderFrame);
}

function handle(channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!trusted(event)) throw new Error("Untrusted IPC sender.");
    return handler(...args);
  });
}

function emit(event) {
  if (!mainWindow?.isDestroyed()) mainWindow.webContents.send("duet:event", event);
}

function workspaceStorageRoot() {
  return join(app.getPath("userData"), "workspaces");
}

function historyStorageRoot() {
  return join(app.getPath("userData"), "history");
}

async function persistReceipt(receipt) {
  if (!receipt) return;
  try {
    const { settings } = await loadSettings(app.getPath("userData"));
    if (settings.historyRetention === 0) return;
    await saveRunReceipt(historyStorageRoot(), receipt, {
      maxItems: settings.historyRetention
    });
    emit({ payload: { id: receipt.id }, time: Date.now(), type: "history-saved" });
  } catch (error) {
    emit({
      payload: { message: `Could not save run history: ${error.message}` },
      time: Date.now(),
      type: "history-error"
    });
  }
}

async function mutateWorkspace(operation) {
  if (currentRun) throw new Error("Wait for the active Duet run to finish.");
  if (workspaceMutation) throw new Error("Another workspace action is still running.");
  workspaceMutation = operation();
  try {
    return await workspaceMutation;
  } finally {
    workspaceMutation = null;
  }
}

async function createWindow() {
  const rendererRoot = resolve(here, "renderer");
  if (!protocolReady) {
    await protocol.handle("duet", (request) => {
      const url = new URL(request.url);
      if (url.hostname !== "app" || url.port || url.username || url.password) {
        return new Response("Not found", { status: 404 });
      }
      let relative;
      try {
        relative = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
      } catch {
        return new Response("Bad request", { status: 400 });
      }
      const path = resolve(rendererRoot, relative);
      if (path !== rendererRoot && !path.startsWith(`${rendererRoot}${sep}`)) {
        return new Response("Not found", { status: 404 });
      }
      return net.fetch(pathToFileURL(path).toString());
    });
    protocolReady = true;
  }

  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler(() => false);
  mainWindow = new BrowserWindow({
    backgroundColor: "#0b0d10",
    height: 860,
    minHeight: 680,
    minWidth: 960,
    show: false,
    title: "Duet",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(here, "preload.cjs"),
      sandbox: true
    },
    width: 1180
  });
  await mainWindow.loadURL("duet://app/index.html");
  mainWindow.show();
  if (recoveryError) {
    emit({
      payload: { message: recoveryError.message },
      time: Date.now(),
      type: "recovery-error"
    });
  }
}

handle("duet:health", () => probeCliHealth());
handle("duet:history", () => listRunHistory(historyStorageRoot()));
handle("duet:history-clear", () => clearRunHistory(historyStorageRoot()));
handle("duet:history-delete", (id) => deleteRunReceipt(historyStorageRoot(), id));
handle("duet:history-read", (id) => readRunReceipt(historyStorageRoot(), id));
handle("duet:settings", () => loadSettings(app.getPath("userData")));
handle("duet:settings-reset", async () => resetSettings(app.getPath("userData")));
handle("duet:settings-update", async (patch) => {
  const settings = await updateSettings(app.getPath("userData"), patch);
  await trimRunHistory(historyStorageRoot(), settings.historyRetention);
  return settings;
});
handle("duet:update-status", () => updateController.status());
handle("duet:update-check", () => updateController.check());
handle("duet:update-download", () => updateController.download());
handle("duet:update-install", () => {
  if (currentRun || workspaceMutation) {
    throw new Error("Wait for the active Duet operation to finish before restarting.");
  }
  return updateController.install();
});
handle("duet:copy-text", (value) => {
  const text = String(value || "").slice(-12_000);
  clipboard.writeText(text);
  return { copied: text.length };
});
handle("duet:select-project", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"]
  });
  return result.canceled ? null : result.filePaths[0];
});
handle("duet:start", async (config) => {
  if (currentRun) throw new Error("A Duet run is already active.");
  if (workspaceMutation) throw new Error("Wait for the workspace action to finish.");
  currentAbort = new AbortController();
  currentRun = runDuet(config, {
    onEvent: emit,
    signal: currentAbort.signal,
    workspaceRoot: workspaceStorageRoot()
  })
    .then(async (result) => {
      await persistReceipt(result.receipt);
      emit({ payload: result, time: Date.now(), type: "finish" });
    })
    .catch(async (error) => {
      await persistReceipt(error.receipt);
      emit({
        payload: serializeDuetError(error),
        time: Date.now(),
        type: "error"
      });
    })
    .finally(() => {
      currentRun = null;
      currentAbort = null;
    });
  return { started: true };
});
handle("duet:cancel", () => {
  if (!currentAbort) return { cancelled: false };
  currentAbort.abort(new Error("Cancelled by user."));
  return { cancelled: true };
});
handle("duet:workspaces", () => listManagedWorkspaces(workspaceStorageRoot()));
handle("duet:workspace-diff", (id) =>
  mutateWorkspace(() => workspaceDiff(workspaceStorageRoot(), id))
);
handle("duet:workspace-apply", (id) =>
  mutateWorkspace(() => applyManagedWorkspace(workspaceStorageRoot(), id))
);
handle("duet:workspace-discard", (id) =>
  mutateWorkspace(() => discardManagedWorkspace(workspaceStorageRoot(), id))
);
handle("duet:workspace-finalize", (id) =>
  mutateWorkspace(() => finalizeManagedWorkspace(workspaceStorageRoot(), id))
);
handle("duet:workspace-undo", (id) =>
  mutateWorkspace(() => undoManagedWorkspace(workspaceStorageRoot(), id))
);

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.whenReady().then(async () => {
    updateController = new UpdateController({
      onState: (state) => emit({ payload: state, time: Date.now(), type: "update" }),
      packaged: app.isPackaged,
      updater: autoUpdater,
      version: app.getVersion()
    });
    try {
      await recoverManagedWorkspaces(workspaceStorageRoot());
    } catch (error) {
      recoveryError = error;
    }
    await createWindow();
  });
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
}
app.on("web-contents-created", (_event, contents) => {
  contents.on("will-attach-webview", (event) => event.preventDefault());
  contents.on("will-navigate", (event) => event.preventDefault());
  contents.on("will-redirect", (event) => event.preventDefault());
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
});
app.on("window-all-closed", () => {
  currentAbort?.abort(new Error("Window closed."));
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
