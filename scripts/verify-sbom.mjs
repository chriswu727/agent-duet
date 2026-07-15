import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { validateSbom } from "./lib/sbom.mjs";

const path = resolve(process.argv[2] || "release/duet.spdx.json");
const [document, manifest] = await Promise.all([
  readFile(path, "utf8").then(JSON.parse),
  readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse)
]);
const issues = validateSbom(document, manifest);
if (issues.length) throw new Error(`Invalid packaged-runtime SBOM:\n- ${issues.join("\n- ")}`);
console.log(`Verified ${document.packages.length} SPDX packages in ${path}.`);
