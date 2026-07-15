import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

export const CHECKSUM_FILE = "SHA256SUMS.txt";

async function digest(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function assetNames(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name !== CHECKSUM_FILE)
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

export async function generateChecksums(directory) {
  const names = await assetNames(directory);
  if (!names.length) throw new Error("No release assets found for checksums.");
  const lines = [];
  for (const name of names) {
    if (name.includes("\n") || basename(name) !== name) {
      throw new Error(`Unsafe release asset name: ${name}`);
    }
    lines.push(`${await digest(join(directory, name))}  ${name}`);
  }
  const content = `${lines.join("\n")}\n`;
  await writeFile(join(directory, CHECKSUM_FILE), content, "utf8");
  return { content, count: names.length };
}

export async function verifyChecksums(directory) {
  const content = await readFile(join(directory, CHECKSUM_FILE), "utf8");
  const lines = content.trim().split("\n").filter(Boolean);
  if (!lines.length) throw new Error("Checksum manifest is empty.");
  const expectedNames = await assetNames(directory);
  const manifestNames = [];
  for (const line of lines) {
    const match = /^([a-f0-9]{64})  ([^/\\]+)$/.exec(line);
    if (!match) throw new Error(`Invalid checksum line: ${line}`);
    const [, expected, name] = match;
    manifestNames.push(name);
    const actual = await digest(join(directory, name));
    if (actual !== expected) throw new Error(`Checksum mismatch: ${name}`);
  }
  if (new Set(manifestNames).size !== manifestNames.length) {
    throw new Error("Checksum manifest contains duplicate assets.");
  }
  if (manifestNames.join("\n") !== expectedNames.join("\n")) {
    throw new Error("Checksum manifest does not exactly cover the release assets.");
  }
  return { count: lines.length };
}
