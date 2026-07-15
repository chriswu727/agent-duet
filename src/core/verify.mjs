import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { platform, tmpdir } from "node:os";
import { join } from "node:path";
import { runProcess } from "./process.mjs";

const VERIFICATION_ENV_ALLOWLIST = new Set([
  "ComSpec",
  "LANG",
  "LC_ALL",
  "PATH",
  "PATHEXT",
  "ProgramFiles",
  "ProgramFiles(x86)",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "SystemRoot",
  "WINDIR"
]);

export async function runVerification(command, cwd, signal) {
  if (!command) return null;
  const invocation = verificationInvocation(command);
  const environmentRoot = await mkdtemp(join(tmpdir(), "duet-verify-"));
  try {
    const directories = verificationDirectories(environmentRoot);
    await Promise.all(Object.values(directories).map((path) =>
      mkdir(path, { recursive: true })
    ));
    return await runProcess(invocation.shell, invocation.args, {
      cwd,
      env: verificationEnvironment(environmentRoot),
      maxOutputChars: 20_000,
      signal,
      timeoutMs: 10 * 60_000,
      windowsVerbatimArguments: invocation.windowsVerbatimArguments
    });
  } finally {
    await rm(environmentRoot, { force: true, recursive: true });
  }
}

function verificationDirectories(root) {
  return {
    cache: join(root, "cache"),
    config: join(root, "config"),
    data: join(root, "data"),
    home: join(root, "home"),
    temporary: join(root, "tmp")
  };
}

export function verificationEnvironment(
  root,
  { source = process.env, targetPlatform = platform() } = {}
) {
  const environment = Object.fromEntries(
    Object.entries(source).filter(
      ([key, value]) => VERIFICATION_ENV_ALLOWLIST.has(key) && typeof value === "string"
    )
  );
  const directories = verificationDirectories(root);
  Object.assign(environment, {
    HOME: directories.home,
    TEMP: directories.temporary,
    TMP: directories.temporary,
    TMPDIR: directories.temporary,
    XDG_CACHE_HOME: directories.cache,
    XDG_CONFIG_HOME: directories.config,
    XDG_DATA_HOME: directories.data
  });
  if (targetPlatform === "win32") {
    environment.APPDATA = join(directories.config, "Roaming");
    environment.LOCALAPPDATA = join(directories.config, "Local");
    environment.USERPROFILE = directories.home;
  }
  return environment;
}

export function verificationInvocation(
  command,
  { env = process.env, targetPlatform = platform() } = {}
) {
  if (targetPlatform === "win32") {
    return {
      args: ["/d", "/s", "/c", `"${command}"`],
      shell: env.ComSpec || "cmd.exe",
      windowsVerbatimArguments: true
    };
  }
  return {
    args: ["-lc", command],
    shell: targetPlatform === "darwin" ? "/bin/zsh" : "/bin/sh"
  };
}
