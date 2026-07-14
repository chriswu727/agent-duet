import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const coreFiles = (await readdir(new URL("../src/core/", import.meta.url)))
  .filter((file) => file.endsWith(".mjs"))
  .map((file) => `src/core/${file}`);
const files = [
  "src/main.mjs",
  "src/preload.cjs",
  "src/renderer/app.js",
  ...coreFiles
];

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], {
    encoding: "utf8",
    stdio: "pipe"
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(result.status || 1);
  }
}

console.log(`Syntax checked ${files.length} files.`);
