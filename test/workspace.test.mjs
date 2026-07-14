import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { gitSnapshot, repositoryHead, runGit } from "../src/core/git.mjs";
import {
  applyManagedWorkspace,
  createManagedWorkspace,
  discardManagedWorkspace,
  finalizeManagedWorkspace,
  listManagedWorkspaces,
  markWorkspacePending,
  recoverManagedWorkspaces,
  undoManagedWorkspace,
  workspaceDiff,
  WORKSPACE_STATE
} from "../src/core/workspace.mjs";

async function createRepository(t) {
  const directory = await mkdtemp(join(tmpdir(), "duet-workspace-"));
  const projectRoot = join(directory, "repo");
  const storageRoot = join(directory, "storage");
  await mkdir(projectRoot);
  await runGit(projectRoot, ["init", "-q"]);
  await runGit(projectRoot, ["config", "user.email", "duet@example.test"]);
  await runGit(projectRoot, ["config", "user.name", "Duet Test"]);
  await writeFile(join(projectRoot, "README.md"), "base\n");
  await runGit(projectRoot, ["add", "README.md"]);
  await runGit(projectRoot, ["commit", "-qm", "initial"]);
  t.after(() => rm(directory, { force: true, recursive: true }));
  return {
    baseCommit: await repositoryHead(projectRoot),
    projectRoot,
    storageRoot
  };
}

async function readText(path) {
  return (await readFile(path, "utf8")).replaceAll("\r\n", "\n");
}

test("keeps changes isolated, applies them, and undoes an exact applied state", async (t) => {
  const repository = await createRepository(t);
  const workspace = await createManagedWorkspace({
    ...repository,
    id: "apply-undo"
  });
  await writeFile(join(workspace.workspacePath, "README.md"), "changed\n");
  await writeFile(join(workspace.workspacePath, "binary.dat"), Buffer.from([0, 1, 2, 255]));

  assert.equal(await readText(join(repository.projectRoot, "README.md")), "base\n");
  assert.equal((await gitSnapshot(repository.projectRoot)).clean, true);

  await markWorkspacePending(workspace, {
    changedFiles: ["README.md", "binary.dat"],
    status: "completed"
  });
  const pending = await listManagedWorkspaces(repository.storageRoot);
  assert.equal(pending[0].state, WORKSPACE_STATE.PENDING);
  assert.equal(pending[0].canApply, true);
  assert.equal(pending[0].canPreview, true);

  const pendingDiff = await workspaceDiff(repository.storageRoot, workspace.id);
  assert.deepEqual(pendingDiff.changedFiles, ["README.md", "binary.dat"]);
  assert.match(pendingDiff.patch, /diff --git a\/README\.md b\/README\.md/);
  assert.match(pendingDiff.patch, /binary\.dat/);
  assert.equal(pendingDiff.truncated, false);
  assert.equal((await gitSnapshot(repository.projectRoot)).clean, true);

  const applied = await applyManagedWorkspace(repository.storageRoot, workspace.id);
  assert.equal(applied.state, WORKSPACE_STATE.APPLIED);
  assert.equal(applied.canUndo, true);
  const appliedDiff = await workspaceDiff(repository.storageRoot, workspace.id);
  assert.equal(appliedDiff.patch, pendingDiff.patch);
  assert.equal(await readText(join(repository.projectRoot, "README.md")), "changed\n");
  assert.deepEqual(
    await readFile(join(repository.projectRoot, "binary.dat")),
    Buffer.from([0, 1, 2, 255])
  );

  await undoManagedWorkspace(repository.storageRoot, workspace.id);
  assert.equal(await readText(join(repository.projectRoot, "README.md")), "base\n");
  await assert.rejects(readFile(join(repository.projectRoot, "binary.dat")), /ENOENT/);
  assert.equal((await gitSnapshot(repository.projectRoot)).clean, true);
  assert.deepEqual(await listManagedWorkspaces(repository.storageRoot), []);
});

test("caps a large diff preview from the beginning without touching the repository", async (t) => {
  const repository = await createRepository(t);
  const workspace = await createManagedWorkspace({
    ...repository,
    id: "large-preview"
  });
  const lines = Array.from({ length: 20_000 }, (_, index) =>
    `${String(index).padStart(5, "0")} ${"x".repeat(20)}`
  );
  await writeFile(join(workspace.workspacePath, "large.txt"), `${lines.join("\n")}\n`);
  await markWorkspacePending(workspace, {
    changedFiles: ["large.txt"],
    status: "completed"
  });

  const preview = await workspaceDiff(repository.storageRoot, workspace.id);
  assert.equal(preview.truncated, true);
  assert.match(preview.patch, /\+00000 x+/);
  assert.doesNotMatch(preview.patch, /\+19999 x+/);
  assert.equal((await gitSnapshot(repository.projectRoot)).clean, true);
  await discardManagedWorkspace(repository.storageRoot, workspace.id);
});

test("recovers an interrupted run and discards it without touching the repository", async (t) => {
  const repository = await createRepository(t);
  const workspace = await createManagedWorkspace({
    ...repository,
    id: "recover-discard"
  });
  await writeFile(join(workspace.workspacePath, "README.md"), "isolated\n");

  const recovered = await recoverManagedWorkspaces(repository.storageRoot);
  assert.equal(recovered[0].state, WORKSPACE_STATE.INTERRUPTED);
  assert.match(recovered[0].error, /closed before/);
  assert.deepEqual(recovered[0].changedFiles, ["README.md"]);

  await discardManagedWorkspace(repository.storageRoot, workspace.id);
  assert.equal(await readText(join(repository.projectRoot, "README.md")), "base\n");
  assert.equal((await gitSnapshot(repository.projectRoot)).clean, true);
  assert.deepEqual(await listManagedWorkspaces(repository.storageRoot), []);
});

test("refuses Apply when the original repository changed", async (t) => {
  const repository = await createRepository(t);
  const workspace = await createManagedWorkspace({
    ...repository,
    id: "apply-guard"
  });
  await writeFile(join(workspace.workspacePath, "README.md"), "duet\n");
  await markWorkspacePending(workspace, {
    changedFiles: ["README.md"],
    status: "completed"
  });
  await writeFile(join(repository.projectRoot, "README.md"), "user\n");

  await assert.rejects(
    applyManagedWorkspace(repository.storageRoot, workspace.id),
    /new changes/
  );
  assert.equal(await readText(join(repository.projectRoot, "README.md")), "user\n");
  assert.equal((await listManagedWorkspaces(repository.storageRoot))[0].canApply, true);
  await discardManagedWorkspace(repository.storageRoot, workspace.id);
});

test("refuses Undo after newer work and lets the user keep the applied result", async (t) => {
  const repository = await createRepository(t);
  const workspace = await createManagedWorkspace({
    ...repository,
    id: "undo-guard"
  });
  await writeFile(join(workspace.workspacePath, "README.md"), "duet\n");
  await markWorkspacePending(workspace, {
    changedFiles: ["README.md"],
    status: "completed"
  });
  await applyManagedWorkspace(repository.storageRoot, workspace.id);
  await writeFile(join(repository.projectRoot, "README.md"), "newer user work\n");

  await assert.rejects(
    undoManagedWorkspace(repository.storageRoot, workspace.id),
    /changed after Apply/
  );
  assert.equal(
    await readText(join(repository.projectRoot, "README.md")),
    "newer user work\n"
  );
  await finalizeManagedWorkspace(repository.storageRoot, workspace.id);
  assert.deepEqual(await listManagedWorkspaces(repository.storageRoot), []);
});

test("refuses Undo after the user stages the applied files", async (t) => {
  const repository = await createRepository(t);
  const workspace = await createManagedWorkspace({
    ...repository,
    id: "undo-staging-guard"
  });
  await writeFile(join(workspace.workspacePath, "README.md"), "duet\n");
  await markWorkspacePending(workspace, {
    changedFiles: ["README.md"],
    status: "completed"
  });
  await applyManagedWorkspace(repository.storageRoot, workspace.id);
  await runGit(repository.projectRoot, ["add", "README.md"]);

  await assert.rejects(
    undoManagedWorkspace(repository.storageRoot, workspace.id),
    /changed after Apply/
  );
  assert.equal(
    (await runGit(repository.projectRoot, ["diff", "--cached", "--name-only"])).trim(),
    "README.md"
  );
  await finalizeManagedWorkspace(repository.storageRoot, workspace.id);
});

test("recovers an Apply interrupted after the target files were written", async (t) => {
  const repository = await createRepository(t);
  const workspace = await createManagedWorkspace({
    ...repository,
    id: "apply-recovery"
  });
  await writeFile(join(workspace.workspacePath, "README.md"), "recovered apply\n");
  const source = await gitSnapshot(workspace.workspacePath, repository.baseCommit);
  const manifest = JSON.parse(await readFile(workspace.manifestPath, "utf8"));
  manifest.changedFiles = source.changed;
  manifest.expectedHash = source.hash;
  await runGit(workspace.workspacePath, ["add", "-A"]);
  manifest.expectedTree = (await runGit(workspace.workspacePath, ["write-tree"])).trim();
  manifest.state = WORKSPACE_STATE.APPLYING;
  await writeFile(workspace.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  await runGit(workspace.workspacePath, [
    "-c",
    "user.name=Duet",
    "-c",
    "user.email=duet@localhost",
    "commit",
    "--no-verify",
    "-m",
    "interrupted apply"
  ]);
  const commit = await repositoryHead(workspace.workspacePath);
  await runGit(workspace.workspacePath, [
    "diff",
    "--binary",
    "--full-index",
    repository.baseCommit,
    commit,
    `--output=${manifest.appliedPatch}`
  ]);
  await runGit(repository.projectRoot, [
    "cherry-pick",
    "--no-commit",
    commit
  ]);

  const recovered = await recoverManagedWorkspaces(repository.storageRoot);
  assert.equal(recovered[0].state, WORKSPACE_STATE.APPLIED);
  assert.equal(recovered[0].canUndo, true);
  assert.equal(
    await readText(join(repository.projectRoot, "README.md")),
    "recovered apply\n"
  );
  await undoManagedWorkspace(repository.storageRoot, workspace.id);
  assert.equal((await gitSnapshot(repository.projectRoot)).clean, true);
});

test("locks recovery instead of touching a mismatched repository", async (t) => {
  const repository = await createRepository(t);
  const workspace = await createManagedWorkspace({
    ...repository,
    id: "apply-conflict"
  });
  await writeFile(join(workspace.workspacePath, "README.md"), "duet\n");
  const manifest = JSON.parse(await readFile(workspace.manifestPath, "utf8"));
  await runGit(workspace.workspacePath, ["add", "-A"]);
  manifest.expectedTree = (await runGit(workspace.workspacePath, ["write-tree"])).trim();
  await runGit(workspace.workspacePath, ["reset", "--mixed", repository.baseCommit]);
  manifest.state = WORKSPACE_STATE.APPLYING;
  await writeFile(workspace.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(repository.projectRoot, "README.md"), "user work\n");

  const recovered = await recoverManagedWorkspaces(repository.storageRoot);
  assert.equal(recovered[0].state, WORKSPACE_STATE.CONFLICT);
  assert.match(recovered[0].error, /manual inspection/);
  assert.equal(
    await readText(join(repository.projectRoot, "README.md")),
    "user work\n"
  );
});

test("recovers both sides of an interrupted Undo", async (t) => {
  const repository = await createRepository(t);
  const workspace = await createManagedWorkspace({
    ...repository,
    id: "undo-recovery"
  });
  await writeFile(join(workspace.workspacePath, "README.md"), "applied\n");
  await markWorkspacePending(workspace, {
    changedFiles: ["README.md"],
    status: "completed"
  });
  await applyManagedWorkspace(repository.storageRoot, workspace.id);

  let manifest = JSON.parse(await readFile(workspace.manifestPath, "utf8"));
  manifest.state = WORKSPACE_STATE.UNDOING;
  await writeFile(workspace.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  let recovered = await recoverManagedWorkspaces(repository.storageRoot);
  assert.equal(recovered[0].state, WORKSPACE_STATE.APPLIED);
  assert.match(recovered[0].error, /before Undo changed/);

  manifest = JSON.parse(await readFile(workspace.manifestPath, "utf8"));
  manifest.state = WORKSPACE_STATE.UNDOING;
  await writeFile(workspace.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await runGit(repository.projectRoot, ["reset", "--hard", "HEAD"]);
  await runGit(repository.projectRoot, ["clean", "-fd"]);
  recovered = await recoverManagedWorkspaces(repository.storageRoot);
  assert.deepEqual(recovered, []);
});

test("keeps agent-created commits visible and applies their files from the base commit", async (t) => {
  const repository = await createRepository(t);
  const workspace = await createManagedWorkspace({
    ...repository,
    id: "agent-commit"
  });
  await writeFile(join(workspace.workspacePath, "README.md"), "agent commit\n");
  await runGit(workspace.workspacePath, ["add", "README.md"]);
  await runGit(workspace.workspacePath, [
    "-c",
    "user.name=Agent",
    "-c",
    "user.email=agent@example.test",
    "commit",
    "-qm",
    "agent committed"
  ]);

  const snapshot = await gitSnapshot(workspace.workspacePath, repository.baseCommit);
  assert.equal(snapshot.clean, false);
  assert.deepEqual(snapshot.changed, ["README.md"]);
  assert.match(snapshot.status, /differs from base/);
  await markWorkspacePending(workspace, {
    changedFiles: snapshot.changed,
    status: "completed"
  });
  await applyManagedWorkspace(repository.storageRoot, workspace.id);
  assert.equal(
    await readText(join(repository.projectRoot, "README.md")),
    "agent commit\n"
  );
});
