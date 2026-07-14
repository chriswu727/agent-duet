import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { gitSnapshot, repositoryRoot } from "../src/core/git.mjs";
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
    assert.equal(await repositoryRoot(directory), await realpath(directory));

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
