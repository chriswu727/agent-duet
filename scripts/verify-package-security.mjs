import { access, stat } from "node:fs/promises";
import { arch, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  FuseV1Options,
  getCurrentFuseWire
} from "@electron/fuses";

const expected = new Map([
  [FuseV1Options.RunAsNode, "0"],
  [FuseV1Options.EnableCookieEncryption, "1"],
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable, "0"],
  [FuseV1Options.EnableNodeCliInspectArguments, "0"],
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation, "1"],
  [FuseV1Options.OnlyLoadAppFromAsar, "1"],
  [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot, "0"],
  [FuseV1Options.GrantFileProtocolExtraPrivileges, "0"]
]);

async function firstExisting(paths) {
  for (const path of paths) {
    try {
      await access(path);
      return path;
    } catch {}
  }
  return null;
}

function packageCandidates() {
  const root = resolve("release");
  if (platform() === "darwin") {
    const directory = arch() === "arm64" ? "mac-arm64" : "mac";
    return [join(root, directory, "Duet.app"), join(root, "mac", "Duet.app")];
  }
  if (platform() === "win32") return [join(root, "win-unpacked", "Duet.exe")];
  return [join(root, "linux-unpacked", "duet")];
}

function asarPath(executable) {
  if (executable.endsWith(".app")) {
    return join(executable, "Contents", "Resources", "app.asar");
  }
  return join(dirname(executable), "resources", "app.asar");
}

const executable = process.argv[2]
  ? resolve(process.argv[2])
  : await firstExisting(packageCandidates());
if (!executable) {
  throw new Error("No packaged Duet executable found. Run `pnpm run pack` first or pass its path.");
}

const archive = asarPath(executable);
if (!(await stat(archive)).isFile()) throw new Error(`Missing packaged ASAR: ${archive}`);

const wire = await getCurrentFuseWire(executable);
const failures = [];
for (const [option, state] of expected) {
  const actual = String.fromCharCode(wire[option]);
  if (actual !== state) {
    failures.push(`${FuseV1Options[option]} expected ${state}, received ${actual}`);
  }
}
if (failures.length) throw new Error(`Unsafe Electron fuse state:\n${failures.join("\n")}`);

console.log(`Verified ASAR and ${expected.size} Electron fuses in ${executable}.`);
