import { resolve } from "node:path";
import {
  generateChecksums,
  verifyChecksums
} from "./lib/checksums.mjs";

const verify = process.argv.includes("--verify");
const directoryArgument = process.argv.slice(2).find((argument) => argument !== "--verify");
const directory = resolve(directoryArgument || "artifacts");
const result = verify
  ? await verifyChecksums(directory)
  : await generateChecksums(directory);
console.log(`${verify ? "Verified" : "Generated"} ${result.count} SHA-256 checksums.`);
