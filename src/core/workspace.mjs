import { randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import {
  gitSnapshot,
  repositoryHead,
  runGit
} from "./git.mjs";
import { subscriptionEnvironment } from "./process.mjs";

export const WORKSPACE_SCHEMA_VERSION = 1;
export const WORKSPACE_STATE = Object.freeze({
  ACTIVE: "active",
  APPLIED: "applied",
  APPLYING: "applying",
  BROKEN: "broken",
  CONFLICT: "conflict",
  DISCARDING: "discarding",
  INTERRUPTED: "interrupted",
  PENDING: "pending",
  UNDOING: "undoing"
});

const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const APPLYABLE_STATES = new Set([
  WORKSPACE_STATE.INTERRUPTED,
  WORKSPACE_STATE.PENDING
]);
const PREVIEWABLE_STATES = new Set([
  WORKSPACE_STATE.ACTIVE,
  WORKSPACE_STATE.APPLIED,
  WORKSPACE_STATE.CONFLICT,
  WORKSPACE_STATE.INTERRUPTED,
  WORKSPACE_STATE.PENDING
]);
const MAX_DIFF_PREVIEW_BYTES = 160_000;

function iso(now = Date.now()) {
  return new Date(now).toISOString();
}

function assertId(id) {
  if (!ID_PATTERN.test(String(id))) throw new Error("Invalid Duet workspace id.");
}

function workspaceDirectory(storageRoot, id) {
  assertId(id);
  return join(storageRoot, id);
}

function manifestPath(storageRoot, id) {
  return join(workspaceDirectory(storageRoot, id), "workspace.json");
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function persist(manifest) {
  manifest.updatedAt = iso();
  const path = manifest.manifestPath;
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, {
    mode: 0o600
  });
  await rename(temporary, path);
  return manifest;
}

async function load(storageRoot, id) {
  const path = manifestPath(storageRoot, id);
  let manifest;
  try {
    manifest = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`Could not read Duet workspace ${id}: ${error.message}`);
  }
  if (manifest.schemaVersion !== WORKSPACE_SCHEMA_VERSION || manifest.id !== id) {
    throw new Error(`Duet workspace ${id} has an unsupported manifest.`);
  }
  manifest.manifestPath = path;
  manifest.workspacePath = join(dirname(path), "checkout");
  return manifest;
}

async function removeCheckout(manifest) {
  try {
    await runGit(manifest.projectRoot, [
      "worktree",
      "remove",
      "--force",
      manifest.workspacePath
    ]);
  } catch {
    await rm(manifest.workspacePath, { force: true, recursive: true });
  }
  await runGit(manifest.projectRoot, ["worktree", "prune"]).catch(() => {});
}

async function removeRecord(manifest) {
  await rm(dirname(manifest.manifestPath), { force: true, recursive: true });
}

async function ensureOriginalIsUnchanged(manifest, { requireClean = true } = {}) {
  const head = await repositoryHead(manifest.projectRoot);
  if (head !== manifest.baseCommit) {
    throw new Error(
      "The original repository moved to another commit. Duet will not apply or undo automatically."
    );
  }
  const snapshot = await gitSnapshot(manifest.projectRoot);
  if (requireClean && !snapshot.clean) {
    throw new Error(
      "The original repository has new changes. Commit or move them before applying this Duet workspace."
    );
  }
  return snapshot;
}

async function restorePendingCheckout(manifest) {
  if (await pathExists(manifest.workspacePath)) {
    await runGit(manifest.workspacePath, ["reset", "--mixed", manifest.baseCommit]);
  }
}

async function workingTree(manifest, cwd) {
  const index = join(dirname(manifest.manifestPath), `index-${randomUUID()}`);
  const env = { ...subscriptionEnvironment(), GIT_INDEX_FILE: index };
  try {
    await runGit(cwd, ["read-tree", manifest.baseCommit], { env });
    await runGit(cwd, ["add", "-A"], { env });
    return (await runGit(cwd, ["write-tree"], { env })).trim();
  } finally {
    await rm(index, { force: true });
    await rm(`${index}.lock`, { force: true });
  }
}

async function readDiffPreview(path) {
  const metadata = await stat(path);
  const length = Math.min(metadata.size, MAX_DIFF_PREVIEW_BYTES);
  const buffer = Buffer.alloc(length);
  const handle = await open(path, "r");
  try {
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    let content = buffer.subarray(0, bytesRead);
    if (metadata.size > MAX_DIFF_PREVIEW_BYTES) {
      const newline = content.lastIndexOf(0x0a);
      if (newline > 0) content = content.subarray(0, newline + 1);
    }
    return {
      patch: content.toString("utf8"),
      truncated: metadata.size > MAX_DIFF_PREVIEW_BYTES
    };
  } finally {
    await handle.close();
  }
}

export function defaultWorkspaceStorageRoot() {
  return join(homedir(), ".agent-duet", "workspaces");
}

export function workspaceSummary(manifest) {
  const state = manifest.state;
  return {
    baseCommit: manifest.baseCommit,
    canApply: APPLYABLE_STATES.has(state),
    canDiscard: APPLYABLE_STATES.has(state) || state === WORKSPACE_STATE.BROKEN,
    canFinalize: state === WORKSPACE_STATE.APPLIED,
    canPreview:
      PREVIEWABLE_STATES.has(state) && Boolean(manifest.changedFiles?.length),
    canUndo: state === WORKSPACE_STATE.APPLIED && Boolean(manifest.appliedPatch),
    changedFiles: [...(manifest.changedFiles || [])],
    createdAt: manifest.createdAt,
    error: manifest.error || null,
    id: manifest.id,
    projectRoot: manifest.projectRoot,
    resultStatus: manifest.resultStatus || null,
    state,
    updatedAt: manifest.updatedAt
  };
}

export async function workspaceDiff(storageRoot, id) {
  const manifest = await load(storageRoot, id);
  let targetTree;
  if (
    manifest.state !== WORKSPACE_STATE.APPLIED &&
    await pathExists(manifest.workspacePath)
  ) {
    targetTree = await workingTree(manifest, manifest.workspacePath);
  } else {
    targetTree = manifest.expectedTree;
  }
  if (!targetTree) throw new Error("This workspace has no diff available to inspect.");

  const preview = join(dirname(manifest.manifestPath), `preview-${randomUUID()}.diff`);
  try {
    await runGit(manifest.projectRoot, [
      "diff",
      "--no-color",
      "--no-ext-diff",
      "--no-textconv",
      "--unified=3",
      `--output=${preview}`,
      manifest.baseTree,
      targetTree
    ]);
    const [content, diffStat] = await Promise.all([
      readDiffPreview(preview),
      runGit(manifest.projectRoot, [
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--stat",
        manifest.baseTree,
        targetTree
      ])
    ]);
    return {
      changedFiles: [...(manifest.changedFiles || [])],
      patch: content.patch || "No textual diff is available.",
      projectRoot: manifest.projectRoot,
      stat: diffStat.trim() || "No file changes.",
      truncated: content.truncated
    };
  } finally {
    await rm(preview, { force: true });
  }
}

export async function createManagedWorkspace({
  baseCommit,
  id,
  projectRoot,
  storageRoot = defaultWorkspaceStorageRoot()
}) {
  assertId(id);
  if (!isAbsolute(projectRoot) || !isAbsolute(storageRoot)) {
    throw new Error("Duet workspace paths must be absolute.");
  }
  const directory = workspaceDirectory(storageRoot, id);
  const checkout = join(directory, "checkout");
  const hooks = join(directory, "hooks");
  const baseTree = (await runGit(projectRoot, ["rev-parse", `${baseCommit}^{tree}`])).trim();
  await mkdir(storageRoot, { recursive: true });
  await mkdir(directory, { recursive: false });
  await mkdir(hooks);
  const manifest = {
    appliedPatch: join(directory, "applied.patch"),
    baseCommit,
    baseTree,
    changedFiles: [],
    createdAt: iso(),
    error: null,
    id,
    manifestPath: join(directory, "workspace.json"),
    projectRoot,
    resultStatus: null,
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    state: WORKSPACE_STATE.ACTIVE,
    updatedAt: iso(),
    workspacePath: checkout
  };

  try {
    await persist(manifest);
    await runGit(projectRoot, [
      "-c",
      `core.hooksPath=${hooks}`,
      "worktree",
      "add",
      "--detach",
      checkout,
      baseCommit
    ]);
    return manifest;
  } catch (error) {
    await removeCheckout(manifest);
    await rm(directory, { force: true, recursive: true });
    throw error;
  }
}

export async function markWorkspacePending(workspace, result) {
  workspace.changedFiles = [...(result.changedFiles || [])];
  workspace.error = null;
  workspace.resultStatus = result.status;
  workspace.state = WORKSPACE_STATE.PENDING;
  await persist(workspace);
  return workspaceSummary(workspace);
}

export async function markWorkspaceInterrupted(workspace, error) {
  try {
    workspace.changedFiles = (
      await gitSnapshot(workspace.workspacePath, workspace.baseCommit)
    ).changed;
  } catch {}
  workspace.error = error instanceof Error ? error.message : String(error);
  workspace.state = WORKSPACE_STATE.INTERRUPTED;
  await persist(workspace);
  return workspaceSummary(workspace);
}

export async function listManagedWorkspaces(storageRoot = defaultWorkspaceStorageRoot()) {
  let entries;
  try {
    entries = await readdir(storageRoot, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const workspaces = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !ID_PATTERN.test(entry.name)) continue;
    try {
      const manifest = await load(storageRoot, entry.name);
      if (
        APPLYABLE_STATES.has(manifest.state) &&
        !(await pathExists(manifest.workspacePath))
      ) {
        manifest.error = "The isolated checkout is missing.";
        manifest.state = WORKSPACE_STATE.BROKEN;
        await persist(manifest);
      }
      workspaces.push(workspaceSummary(manifest));
    } catch {}
  }
  return workspaces.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

async function reconcileApplying(manifest, failureMessage = "Duet closed while applying") {
  try {
    const head = await repositoryHead(manifest.projectRoot);
    if (head !== manifest.baseCommit) throw new Error("The repository commit changed.");
    const target = await gitSnapshot(manifest.projectRoot);
    if (target.clean) {
      await restorePendingCheckout(manifest);
      manifest.error = `${failureMessage}; the original repository stayed clean.`;
      manifest.state = WORKSPACE_STATE.INTERRUPTED;
    } else if ((await workingTree(manifest, manifest.projectRoot)) === manifest.expectedTree) {
      await runGit(manifest.projectRoot, ["reset", "--mixed", "HEAD"]);
      manifest.appliedHash = (await gitSnapshot(manifest.projectRoot)).hash;
      manifest.error = (await pathExists(manifest.appliedPatch))
        ? null
        : "Changes were applied, but the Undo patch is missing.";
      manifest.state = WORKSPACE_STATE.APPLIED;
      await removeCheckout(manifest);
    } else {
      throw new Error("The repository contains changes that do not match this workspace.");
    }
  } catch (error) {
    manifest.error = `Apply recovery needs manual inspection: ${error.message}`;
    manifest.state = WORKSPACE_STATE.CONFLICT;
  }
  await persist(manifest);
}

async function reconcileUndoing(manifest) {
  try {
    const head = await repositoryHead(manifest.projectRoot);
    if (head !== manifest.baseCommit) throw new Error("The repository commit changed.");
    const target = await gitSnapshot(manifest.projectRoot);
    const targetTree = await workingTree(manifest, manifest.projectRoot);
    if (targetTree === manifest.baseTree && target.clean) {
      manifest.state = "undone";
      await removeRecord(manifest);
      return;
    }
    if (targetTree === manifest.expectedTree && target.hash === manifest.appliedHash) {
      manifest.error = "Duet closed before Undo changed the repository.";
      manifest.state = WORKSPACE_STATE.APPLIED;
      await persist(manifest);
      return;
    }
    throw new Error("The repository contains changes that do not match the applied result.");
  } catch (error) {
    manifest.error = `Undo recovery needs manual inspection: ${error.message}`;
    manifest.state = WORKSPACE_STATE.CONFLICT;
    await persist(manifest);
  }
}

export async function recoverManagedWorkspaces(
  storageRoot = defaultWorkspaceStorageRoot()
) {
  await mkdir(storageRoot, { recursive: true });
  const entries = await readdir(storageRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || !ID_PATTERN.test(entry.name)) continue;
    let manifest;
    try {
      manifest = await load(storageRoot, entry.name);
    } catch {
      continue;
    }
    if (manifest.state === WORKSPACE_STATE.ACTIVE) {
      try {
        manifest.changedFiles = (
          await gitSnapshot(manifest.workspacePath, manifest.baseCommit)
        ).changed;
      } catch {}
      manifest.error = "Duet closed before this run finished.";
      manifest.state = WORKSPACE_STATE.INTERRUPTED;
      await persist(manifest);
    } else if (manifest.state === WORKSPACE_STATE.APPLYING) {
      await reconcileApplying(manifest);
    } else if (manifest.state === WORKSPACE_STATE.DISCARDING) {
      await removeCheckout(manifest);
      await removeRecord(manifest);
    } else if (manifest.state === WORKSPACE_STATE.APPLIED) {
      await removeCheckout(manifest);
    } else if (manifest.state === WORKSPACE_STATE.UNDOING) {
      await reconcileUndoing(manifest);
    }
  }
  return listManagedWorkspaces(storageRoot);
}

export async function applyManagedWorkspace(storageRoot, id) {
  const manifest = await load(storageRoot, id);
  if (!APPLYABLE_STATES.has(manifest.state)) {
    throw new Error(`Duet workspace ${id} cannot be applied from ${manifest.state}.`);
  }
  await ensureOriginalIsUnchanged(manifest);
  await runGit(manifest.workspacePath, ["reset", "--mixed", manifest.baseCommit]);
  const source = await gitSnapshot(manifest.workspacePath, manifest.baseCommit);
  if (source.clean) {
    await discardManagedWorkspace(storageRoot, id);
    return { ...workspaceSummary(manifest), noChanges: true, state: "discarded" };
  }

  manifest.changedFiles = [...source.changed];
  manifest.error = null;
  manifest.expectedHash = source.hash;
  manifest.expectedTree = await workingTree(manifest, manifest.workspacePath);
  if (manifest.expectedTree === manifest.baseTree) {
    manifest.error =
      "This workspace contains only changes Git cannot transfer, such as dirty submodule or ignored-file contents.";
    manifest.state = WORKSPACE_STATE.INTERRUPTED;
    await persist(manifest);
    throw new Error(manifest.error);
  }
  manifest.state = WORKSPACE_STATE.APPLYING;
  await persist(manifest);
  try {
    await runGit(manifest.workspacePath, ["add", "-A"]);
    const stagedTree = (await runGit(manifest.workspacePath, ["write-tree"])).trim();
    if (stagedTree !== manifest.expectedTree) {
      throw new Error("The isolated files changed while Apply was preparing them.");
    }
    await runGit(manifest.workspacePath, [
      "-c",
      "user.name=Duet",
      "-c",
      "user.email=duet@localhost",
      "-c",
      "commit.gpgsign=false",
      "-c",
      `core.hooksPath=${join(dirname(manifest.manifestPath), "hooks")}`,
      "commit",
      "--no-verify",
      "-m",
      `Duet workspace ${manifest.id}`
    ]);
    const commit = await repositoryHead(manifest.workspacePath);
    await runGit(manifest.workspacePath, [
      "diff",
      "--binary",
      "--full-index",
      manifest.baseCommit,
      commit,
      `--output=${manifest.appliedPatch}`
    ]);
    await chmod(manifest.appliedPatch, 0o600);
    await runGit(manifest.projectRoot, [
      "-c",
      `core.hooksPath=${join(dirname(manifest.manifestPath), "hooks")}`,
      "cherry-pick",
      "--no-commit",
      commit
    ]);
    const targetTree = (await runGit(manifest.projectRoot, ["write-tree"])).trim();
    if (targetTree !== manifest.expectedTree) {
      throw new Error("Git staged a tree that does not match the isolated result.");
    }
    await runGit(manifest.projectRoot, ["reset", "--mixed", "HEAD"]);
    if ((await workingTree(manifest, manifest.projectRoot)) !== manifest.expectedTree) {
      throw new Error("Applied files did not match the isolated workspace fingerprint.");
    }
    manifest.appliedAt = iso();
    manifest.appliedHash = (await gitSnapshot(manifest.projectRoot)).hash;
    manifest.state = WORKSPACE_STATE.APPLIED;
    await persist(manifest);
    await removeCheckout(manifest);
    return workspaceSummary(manifest);
  } catch (error) {
    await reconcileApplying(manifest, `Apply failed: ${error.message}`);
    if (manifest.state === WORKSPACE_STATE.APPLIED) return workspaceSummary(manifest);
    throw new Error(manifest.error);
  }
}

export async function discardManagedWorkspace(storageRoot, id) {
  const manifest = await load(storageRoot, id);
  if (!APPLYABLE_STATES.has(manifest.state) && manifest.state !== WORKSPACE_STATE.BROKEN) {
    throw new Error(`Duet workspace ${id} cannot be discarded from ${manifest.state}.`);
  }
  manifest.state = WORKSPACE_STATE.DISCARDING;
  await persist(manifest);
  await removeCheckout(manifest);
  await removeRecord(manifest);
  return { id, state: "discarded" };
}

export async function finalizeManagedWorkspace(storageRoot, id) {
  const manifest = await load(storageRoot, id);
  if (manifest.state !== WORKSPACE_STATE.APPLIED) {
    throw new Error(`Duet workspace ${id} has no applied result to keep.`);
  }
  await removeRecord(manifest);
  return { id, state: "finalized" };
}

export async function undoManagedWorkspace(storageRoot, id) {
  const manifest = await load(storageRoot, id);
  if (manifest.state !== WORKSPACE_STATE.APPLIED) {
    throw new Error(`Duet workspace ${id} has not been applied.`);
  }
  const current = await ensureOriginalIsUnchanged(manifest, { requireClean: false });
  if (
    current.hash !== manifest.appliedHash ||
    (await workingTree(manifest, manifest.projectRoot)) !== manifest.expectedTree
  ) {
    throw new Error(
      "The repository changed after Apply. Duet will not undo and risk deleting newer work."
    );
  }
  manifest.state = WORKSPACE_STATE.UNDOING;
  await persist(manifest);
  try {
    await runGit(manifest.projectRoot, [
      "apply",
      "--reverse",
      "--whitespace=nowarn",
      manifest.appliedPatch
    ]);
    const undone = await gitSnapshot(manifest.projectRoot);
    if (
      !undone.clean ||
      (await workingTree(manifest, manifest.projectRoot)) !== manifest.baseTree
    ) {
      throw new Error("Undo did not restore the exact base tree.");
    }
    await removeRecord(manifest);
    return { id, state: "undone" };
  } catch (error) {
    await reconcileUndoing(manifest);
    if (manifest.state === "undone") return { id, state: "undone" };
    throw new Error(`Undo failed safely: ${error.message}. ${manifest.error || ""}`.trim());
  }
}
