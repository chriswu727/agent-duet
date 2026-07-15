import { resolve } from "node:path";
import { stageReleaseAssets } from "./lib/release-assets.mjs";

const target = process.argv[2];
const root = resolve("release");
const result = await stageReleaseAssets({ arch: process.argv[3], root, target });
console.log(`Staged ${result.count} ${target} release assets.`);
