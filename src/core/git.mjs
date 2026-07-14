import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { resolve } from "node:path";
import { runProcess } from "./process.mjs";

async function git(cwd, args, options = {}) {
  const result = await runProcess("git", args, { cwd, ...options });
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || `git ${args.join(" ")} failed`);
  }
  return result.stdout;
}

export async function repositoryRoot(cwd) {
  return (await git(cwd, ["rev-parse", "--show-toplevel"])).trim();
}

export async function repositoryHead(cwd) {
  return (await git(cwd, ["rev-parse", "HEAD"])).trim();
}

export async function gitSnapshot(cwd) {
  const [status, stat, names, patch, untrackedOutput] = await Promise.all([
    git(cwd, ["status", "--short", "--untracked-files=all"]),
    git(cwd, ["diff", "--stat", "HEAD"]),
    git(cwd, ["diff", "--name-only", "HEAD"]),
    git(cwd, ["diff", "--binary", "--no-ext-diff", "HEAD"], {
      maxOutputChars: 2_000_000
    }),
    git(cwd, ["ls-files", "--others", "--exclude-standard", "-z"], {
      maxOutputChars: 2_000_000
    })
  ]);
  const untracked = untrackedOutput.split("\0").filter(Boolean).sort();
  const changed = [...new Set([...names.trim().split("\n").filter(Boolean), ...untracked])];
  const hasher = createHash("sha256").update(status).update("\0").update(patch);
  for (const path of untracked) {
    hasher.update("\0").update(path).update("\0");
    await new Promise((done, reject) => {
      const stream = createReadStream(resolve(cwd, path));
      stream.on("data", (chunk) => hasher.update(chunk));
      stream.on("end", done);
      stream.on("error", reject);
    });
  }
  const hash = hasher.digest("hex");

  return {
    changed,
    clean: status.trim() === "",
    hash,
    stat: stat.trim() || "No tracked diff.",
    status: status.trim() || "Clean working tree."
  };
}
