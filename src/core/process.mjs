import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { posix, win32 } from "node:path";
import { homedir, platform } from "node:os";
import spawn from "cross-spawn";

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

function executableNames(name, targetPlatform) {
  if (targetPlatform !== "win32") return [name];
  return [name, `${name}.exe`, `${name}.cmd`, `${name}.bat`];
}

export function executableCandidates(name, explicitPath, options = {}) {
  const {
    env = process.env,
    home = homedir(),
    targetPlatform = platform()
  } = options;
  const paths = targetPlatform === "win32" ? win32 : posix;
  const candidates = [];
  if (explicitPath) candidates.push(explicitPath);

  if (name === "codex" && targetPlatform === "darwin") {
    candidates.push("/Applications/ChatGPT.app/Contents/Resources/codex");
  }
  if (name === "claude") {
    for (const executable of executableNames(name, targetPlatform)) {
      candidates.push(paths.join(home, ".local", "bin", executable));
    }
  }

  const userDirectories = [
    paths.join(home, ".local", "bin"),
    paths.join(home, ".npm-global", "bin"),
    paths.join(home, ".local", "share", "pnpm"),
    paths.join(home, ".bun", "bin"),
    paths.join(home, ".volta", "bin")
  ];
  const commonDirectories =
    targetPlatform === "win32"
      ? [
          ...userDirectories,
          env.APPDATA && paths.join(env.APPDATA, "npm"),
          env.LOCALAPPDATA && paths.join(env.LOCALAPPDATA, "pnpm"),
          env.LOCALAPPDATA && paths.join(env.LOCALAPPDATA, "Microsoft", "WindowsApps"),
          env.ProgramFiles && paths.join(env.ProgramFiles, "nodejs")
        ]
      : [...userDirectories, "/usr/local/bin", "/usr/bin"];
  if (targetPlatform === "darwin") {
    commonDirectories.unshift("/opt/homebrew/bin");
    commonDirectories.push(paths.join(home, "Library", "pnpm"));
  }
  if (targetPlatform === "linux") commonDirectories.push("/snap/bin");

  const pathDirectories = (env.PATH || "").split(paths.delimiter);
  for (const directory of [...pathDirectories, ...commonDirectories]) {
    if (!directory) continue;
    for (const executable of executableNames(name, targetPlatform)) {
      candidates.push(paths.join(directory, executable));
    }
  }

  return [...new Set(candidates)];
}

export async function findExecutable(name, explicitPath, options = {}) {
  const executableCheck = options.executableCheck || isExecutable;

  for (const candidate of executableCandidates(name, explicitPath, options)) {
    if (await executableCheck(candidate)) return candidate;
  }
  return null;
}

export function terminationInvocation(pid, force, targetPlatform = platform()) {
  if (targetPlatform === "win32") {
    return {
      args: ["/PID", String(pid), "/T", ...(force ? ["/F"] : [])],
      command: "taskkill"
    };
  }
  return {
    pid: -pid,
    signal: force ? "SIGKILL" : "SIGTERM"
  };
}

export function processIsRunning(child) {
  return child?.exitCode === null && child?.signalCode === null;
}

export function terminateProcessTree(child, options = {}) {
  const {
    force = false,
    spawner = spawn,
    targetPlatform = platform()
  } = options;
  if (!child?.pid || !processIsRunning(child)) return;

  const invocation = terminationInvocation(child.pid, force, targetPlatform);
  const signal = force ? "SIGKILL" : "SIGTERM";
  if (targetPlatform !== "win32") {
    try {
      process.kill(invocation.pid, invocation.signal);
    } catch {
      child.kill(signal);
    }
    return;
  }

  const fallback = () => {
    if (processIsRunning(child)) child.kill(signal);
  };
  try {
    const killer = spawner(invocation.command, invocation.args, {
      stdio: "ignore",
      windowsHide: true
    });
    killer.once("error", fallback);
    killer.once("close", (code) => {
      if (code !== 0) fallback();
    });
  } catch {
    fallback();
  }
}

export function runProcess(command, args, options = {}) {
  const {
    cwd,
    env = subscriptionEnvironment(),
    maxOutputChars = 20_000,
    signal,
    timeoutMs = 30_000,
    windowsVerbatimArguments = false
  } = options;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      detached: platform() !== "win32",
      env,
      shell: false,
      windowsVerbatimArguments,
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
    const stop = () => {
      terminateProcessTree(child);
      forceTimer ||= setTimeout(
        () => terminateProcessTree(child, { force: true }),
        2_000
      );
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
