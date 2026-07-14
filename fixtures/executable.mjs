import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

export async function fakeExecutable(scriptUrl, prefixArgs = []) {
  const directory = await mkdtemp(join(tmpdir(), "duet-command-"));
  const script = fileURLToPath(scriptUrl);
  const suffix = process.platform === "win32" ? ".cmd" : "";
  const command = join(directory, `duet-fixture${suffix}`);
  const args = prefixArgs.map(String);
  const contents =
    process.platform === "win32"
      ? `@echo off\r\n"${process.execPath}" "${script}" ${args.map((arg) => `"${arg}"`).join(" ")} %*\r\n`
      : `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(script)} ${args.map(shellQuote).join(" ")} "$@"\n`;
  await writeFile(command, contents);
  if (process.platform !== "win32") await chmod(command, 0o755);
  return {
    command,
    dispose: () => rm(directory, { force: true, recursive: true })
  };
}
