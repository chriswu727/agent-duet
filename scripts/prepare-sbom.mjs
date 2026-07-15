import { extractAll } from "@electron/asar";
import { access, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { join, resolve } from "node:path";
import {
  packageExecutableCandidates,
  packageResourcesPath
} from "./package-smoke.mjs";

let executable;
for (const candidate of packageExecutableCandidates()) {
  try {
    await access(candidate, constants.X_OK);
    executable = candidate;
    break;
  } catch {}
}
if (!executable) throw new Error("No packaged Duet executable found for SBOM extraction.");

const output = resolve(process.argv[2] || "release/sbom-root");
const archive = join(packageResourcesPath(executable), "app.asar");
await rm(output, { force: true, recursive: true });
await extractAll(archive, output);
await Promise.all([
  access(join(output, "package.json")),
  access(join(output, "src", "main.mjs")),
  access(join(output, "node_modules", "electron-updater", "package.json"))
]);
console.log(`Extracted packaged runtime for SBOM generation: ${output}`);
