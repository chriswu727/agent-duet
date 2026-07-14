import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, normalize } from "node:path";
import test from "node:test";
import { gitSnapshot, repositoryHead, repositoryRoot } from "../src/core/git.mjs";
import { runProcess } from "../src/core/process.mjs";

async function git(cwd, ...args) {
  const result = await runProcess("git", args, { cwd });
  assert.equal(result.code, 0, result.stderr);
}

test("snapshot changes when untracked file content changes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "duet-git-"));
  try {
    await git(directory, "init", "-q");
    await git(directory, "config", "user.email", "duet@example.test");
    await git(directory, "config", "user.name", "Duet Test");
    await writeFile(join(directory, "README.md"), "base\n");
    await git(directory, "add", "README.md");
    await git(directory, "commit", "-qm", "initial");
    assert.equal(
      normalize(await repositoryRoot(directory)),
      normalize(await realpath(directory))
    );
    assert.match(await repositoryHead(directory), /^[a-f0-9]{40}$/);

    await writeFile(join(directory, "new.txt"), "one\n");
    const first = await gitSnapshot(directory);
    await writeFile(join(directory, "new.txt"), "two\n");
    const second = await gitSnapshot(directory);

    assert.deepEqual(first.changed, ["new.txt"]);
    assert.notEqual(first.hash, second.hash);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("fingerprints an untracked symlink by its Git link target", {
  skip: process.platform === "win32"
}, async () => {
  const directory = await mkdtemp(join(tmpdir(), "duet-git-link-"));
  try {
    await git(directory, "init", "-q");
    await git(directory, "config", "user.email", "duet@example.test");
    await git(directory, "config", "user.name", "Duet Test");
    await writeFile(join(directory, "target-a"), "same content\n");
    await writeFile(join(directory, "target-b"), "same content\n");
    await git(directory, "add", "target-a", "target-b");
    await git(directory, "commit", "-qm", "initial");
    await symlink("target-a", join(directory, "link"));
    const first = await gitSnapshot(directory);
    await rm(join(directory, "link"));
    await symlink("target-b", join(directory, "link"));
    const second = await gitSnapshot(directory);

    assert.notEqual(first.contentHash, second.contentHash);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
