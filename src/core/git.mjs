import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readlink } from "node:fs/promises";
import { resolve } from "node:path";
import { runProcess } from "./process.mjs";

export async function runGit(cwd, args, options = {}) {
  const result = await runProcess("git", args, { cwd, ...options });
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || `git ${args.join(" ")} failed`);
  }
  return result.stdout;
}

export async function repositoryRoot(cwd) {
  return (await runGit(cwd, ["rev-parse", "--show-toplevel"])).trim();
}

export async function repositoryHead(cwd) {
  return (await runGit(cwd, ["rev-parse", "HEAD"])).trim();
}

export async function gitSnapshot(cwd, baseRef = "HEAD") {
  const head = await repositoryHead(cwd);
  const baseCommit =
    baseRef === "HEAD" ? head : (await runGit(cwd, ["rev-parse", baseRef])).trim();
  const [status, stat, names, patch, untrackedOutput] = await Promise.all([
    runGit(cwd, ["status", "--short", "--untracked-files=all"]),
    runGit(cwd, ["diff", "--stat", "--no-ext-diff", "--no-textconv", baseCommit]),
    runGit(cwd, ["diff", "--name-only", "--no-ext-diff", "--no-textconv", baseCommit]),
    runGit(cwd, ["diff", "--binary", "--no-ext-diff", "--no-textconv", baseCommit], {
      maxOutputChars: 2_000_000
    }),
    runGit(cwd, ["ls-files", "--others", "--exclude-standard", "-z"], {
      maxOutputChars: 2_000_000
    })
  ]);
  const state = [
    head === baseCommit
      ? ""
      : `Worktree HEAD ${head.slice(0, 12)} differs from base ${baseCommit.slice(0, 12)}.`,
    status.trim()
  ].filter(Boolean).join("\n");
  const untracked = untrackedOutput.split("\0").filter(Boolean).sort();
  const changed = [...new Set([...names.trim().split("\n").filter(Boolean), ...untracked])];
  const contentHasher = createHash("sha256").update(patch);
  for (const path of untracked) {
    contentHasher.update("\0").update(path).update("\0");
    const absolutePath = resolve(cwd, path);
    const metadata = await lstat(absolutePath);
    if (metadata.isSymbolicLink()) {
      contentHasher.update("symlink\0").update(await readlink(absolutePath));
    } else if (metadata.isFile()) {
      await new Promise((done, reject) => {
        const stream = createReadStream(absolutePath);
        stream.on("data", (chunk) => contentHasher.update(chunk));
        stream.on("end", done);
        stream.on("error", reject);
      });
    } else {
      throw new Error(`Duet cannot fingerprint untracked path type: ${path}`);
    }
  }
  const contentHash = contentHasher.digest("hex");
  const hash = createHash("sha256")
    .update(state)
    .update("\0")
    .update(contentHash)
    .digest("hex");

  return {
    changed,
    clean: state === "",
    contentHash,
    hash,
    stat: stat.trim() || "No tracked diff.",
    status: state || "Clean working tree."
  };
}
