import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { delimiter, join } from "node:path";
import { homedir, platform } from "node:os";
import { spawn } from "node:child_process";

const ENV_ALLOWLIST = new Set([
  "APPDATA",
  "CODEX_HOME",
  "ComSpec",
  "HOME",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "LANG",
  "LC_ALL",
  "LOCALAPPDATA",
  "LOGNAME",
  "NO_PROXY",
  "PATH",
  "PATHEXT",
  "ProgramFiles",
  "ProgramFiles(x86)",
  "SHELL",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "SystemRoot",
  "TEMP",
  "TMP",
  "TMPDIR",
  "USER",
  "USERPROFILE",
  "WINDIR",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "CLAUDE_CONFIG_DIR"
]);

export function subscriptionEnvironment(source = process.env) {
  return Object.fromEntries(
    Object.entries(source).filter(
      ([key, value]) => ENV_ALLOWLIST.has(key) && typeof value === "string"
    )
  );
}

async function isExecutable(path) {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function executableNames(name) {
  if (platform() !== "win32") return [name];
  return [name, `${name}.exe`, `${name}.cmd`, `${name}.bat`];
}

export async function findExecutable(name, explicitPath) {
  const candidates = [];
  if (explicitPath) candidates.push(explicitPath);

  if (name === "codex" && platform() === "darwin") {
    candidates.push("/Applications/ChatGPT.app/Contents/Resources/codex");
  }
  if (name === "claude") {
    candidates.push(join(homedir(), ".local", "bin", "claude"));
  }

  for (const directory of (process.env.PATH || "").split(delimiter)) {
    if (!directory) continue;
    for (const executable of executableNames(name)) {
      candidates.push(join(directory, executable));
    }
  }

  for (const candidate of [...new Set(candidates)]) {
    if (await isExecutable(candidate)) return candidate;
  }
  return null;
}

export function runProcess(command, args, options = {}) {
  const {
    cwd,
    env = subscriptionEnvironment(),
    maxOutputChars = 20_000,
    signal,
    timeoutMs = 30_000
  } = options;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      detached: platform() !== "win32",
      env,
      shell: false,
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const append = (current, chunk) =>
      (current + chunk.toString()).slice(-maxOutputChars);
    child.stdout.on("data", (chunk) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = append(stderr, chunk);
    });

    let forceTimer;
    const terminate = (force = false) => {
      if (!child.pid || child.exitCode !== null) return;
      const terminationSignal = force ? "SIGKILL" : "SIGTERM";
      if (platform() === "win32") {
        child.kill(terminationSignal);
      } else {
        try {
          process.kill(-child.pid, terminationSignal);
        } catch {
          child.kill(terminationSignal);
        }
      }
    };
    const stop = () => {
      terminate();
      forceTimer ||= setTimeout(() => terminate(true), 2_000);
      forceTimer.unref();
    };
    if (signal?.aborted) stop();
    else signal?.addEventListener("abort", stop, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, timeoutMs);

    child.on("error", (error) => {
      clearTimeout(timer);
      clearTimeout(forceTimer);
      signal?.removeEventListener("abort", stop);
      reject(error);
    });
    child.on("close", (code, closeSignal) => {
      clearTimeout(timer);
      clearTimeout(forceTimer);
      signal?.removeEventListener("abort", stop);
      resolve({
        code: code ?? -1,
        signal: closeSignal,
        stderr,
        stdout,
        timedOut
      });
    });
  });
}
