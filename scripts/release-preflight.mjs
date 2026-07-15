import { readFile } from "node:fs/promises";
import { validateRelease } from "./lib/release.mjs";

const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url)));
const mode = process.env.DUET_RELEASE_MODE || "publish";
const tag = process.env.DUET_RELEASE_TAG || process.env.GITHUB_REF_NAME;
const target = process.argv[2];
const issues = validateRelease({
  environment: process.env,
  mode,
  tag,
  target,
  version: manifest.version
});
if (issues.length) throw new Error(`Release preflight failed:\n- ${issues.join("\n- ")}`);
console.log(`Release preflight passed for ${target} ${tag} (${mode}).`);
