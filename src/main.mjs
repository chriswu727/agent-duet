import { app, BrowserWindow, dialog, ipcMain, net, protocol, session } from "electron";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { probeCliHealth } from "./core/health.mjs";
import { runDuet } from "./core/orchestrator.mjs";

const here = dirname(fileURLToPath(import.meta.url));
let mainWindow;
let currentRun;
let currentAbort;
let protocolReady = false;

protocol.registerSchemesAsPrivileged([
  {
    scheme: "duet",
    privileges: { secure: true, standard: true, supportFetchAPI: true }
  }
]);
app.enableSandbox();

function trusted(event) {
  return event.senderFrame?.url?.startsWith("duet://app/");
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

async function createWindow() {
  const rendererRoot = resolve(here, "renderer");
  if (!protocolReady) {
    await protocol.handle("duet", (request) => {
      const url = new URL(request.url);
      const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
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
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  await mainWindow.loadURL("duet://app/index.html");
  mainWindow.show();
}

handle("duet:health", () => probeCliHealth());
handle("duet:select-project", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"]
  });
  return result.canceled ? null : result.filePaths[0];
});
handle("duet:start", async (config) => {
  if (currentRun) throw new Error("A Duet run is already active.");
  currentAbort = new AbortController();
  currentRun = runDuet(config, {
    onEvent: emit,
    signal: currentAbort.signal
  })
    .then((result) => emit({ payload: result, time: Date.now(), type: "finish" }))
    .catch((error) =>
      emit({ payload: { message: error.message }, time: Date.now(), type: "error" })
    )
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

app.whenReady().then(createWindow);
app.on("window-all-closed", () => {
  currentAbort?.abort(new Error("Window closed."));
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
