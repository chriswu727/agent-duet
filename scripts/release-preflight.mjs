import { readFile } from "node:fs/promises";
import { validateRelease } from "./lib/release.mjs";

const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url)));
const target = process.argv[2];
const issues = validateRelease({
  environment: process.env,
  tag: process.env.GITHUB_REF_NAME,
  target,
  version: manifest.version
});
if (issues.length) throw new Error(`Release preflight failed:\n- ${issues.join("\n- ")}`);
console.log(`Release preflight passed for ${target} ${process.env.GITHUB_REF_NAME}.`);
