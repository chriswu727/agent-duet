import { access, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  FuseV1Options,
  getCurrentFuseWire
} from "@electron/fuses";
import { parse } from "yaml";
import {
  packageExecutableCandidates,
  packageResourcesPath
} from "./package-smoke.mjs";

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

function resourcesPath(executable) {
  if (executable.endsWith(".app")) {
    return join(executable, "Contents", "Resources");
  }
  return packageResourcesPath(executable);
}

const executable = process.argv[2]
  ? resolve(process.argv[2])
  : await firstExisting(packageExecutableCandidates());
if (!executable) {
  throw new Error("No packaged Duet executable found. Run `pnpm run pack` first or pass its path.");
}

const resources = resourcesPath(executable);
const archive = join(resources, "app.asar");
if (!(await stat(archive)).isFile()) throw new Error(`Missing packaged ASAR: ${archive}`);
let updateFeedVerified = false;
try {
  const updateConfig = parse(await readFile(join(resources, "app-update.yml"), "utf8"));
  if (
    updateConfig.provider !== "github"
    || updateConfig.owner !== "chriswu727"
    || updateConfig.repo !== "agent-duet"
  ) throw new Error("Packaged update feed does not match the public Duet repository.");
  updateFeedVerified = true;
} catch (error) {
  if (error.code !== "ENOENT" || process.env.DUET_REQUIRE_UPDATE_FEED === "1") throw error;
}

const wire = await getCurrentFuseWire(executable);
const failures = [];
for (const [option, state] of expected) {
  const actual = String.fromCharCode(wire[option]);
  if (actual !== state) {
    failures.push(`${FuseV1Options[option]} expected ${state}, received ${actual}`);
  }
}
if (failures.length) throw new Error(`Unsafe Electron fuse state:\n${failures.join("\n")}`);

console.log(`Verified ASAR and ${expected.size} Electron fuses${updateFeedVerified ? " plus the update feed" : ""} in ${executable}.`);
