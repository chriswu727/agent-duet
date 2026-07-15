import { randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat
} from "node:fs/promises";
import { basename, join } from "node:path";
import { z } from "zod";

export const HISTORY_RETENTION_LIMIT = 100;
const MAX_HISTORY_BYTES = 256 * 1024;
const receiptId = /^[A-Za-z0-9_-]{1,100}$/;

const receiptSchema = z.object({
  endedAt: z.string().nullable(),
  id: z.string().regex(receiptId),
  project: z.object({
    baseCommit: z.string().nullable(),
    root: z.string()
  }),
  request: z.object({
    task: z.string()
  }).passthrough(),
  result: z.object({
    changedFiles: z.array(z.string()),
    reason: z.string(),
    round: z.number().nullable(),
    status: z.string()
  }).passthrough(),
  rounds: z.array(z.unknown()),
  schemaVersion: z.union([z.literal(1), z.literal(2)]),
  startedAt: z.string()
}).passthrough();

function receiptPath(root, id) {
  if (!receiptId.test(id)) throw new Error("Invalid run receipt id.");
  return join(root, `${id}.json`);
}

async function ensureHistoryRoot(root) {
  await mkdir(root, { mode: 0o700, recursive: true });
  if (process.platform !== "win32") await chmod(root, 0o700);
}

async function parseReceiptFile(path) {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.size > MAX_HISTORY_BYTES) {
    throw new Error("Run receipt is not a supported file.");
  }
  return receiptSchema.parse(JSON.parse(await readFile(path, "utf8")));
}

function summary(receipt) {
  return {
    changedFiles: receipt.result.changedFiles.length,
    endedAt: receipt.endedAt,
    error: receipt.result.error || null,
    id: receipt.id,
    project: basename(receipt.project.root) || receipt.project.root,
    reason: receipt.result.reason,
    round: receipt.result.round,
    startedAt: receipt.startedAt,
    status: receipt.result.status,
    task: receipt.request.task.slice(0, 240)
  };
}

async function receiptFiles(root) {
  try {
    return (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => join(root, entry.name));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

export async function trimRunHistory(root, maxItems = HISTORY_RETENTION_LIMIT) {
  if (!Number.isInteger(maxItems) || maxItems < 0 || maxItems > HISTORY_RETENTION_LIMIT) {
    throw new Error("Invalid run history retention limit.");
  }
  const files = await receiptFiles(root);
  const dated = await Promise.all(files.map(async (path) => ({
    modified: (await stat(path)).mtimeMs,
    path
  })));
  dated.sort((left, right) => right.modified - left.modified);
  await Promise.all(dated.slice(maxItems).map(({ path }) => rm(path, { force: true })));
}

export async function saveRunReceipt(root, receipt, options = {}) {
  const parsed = receiptSchema.parse(receipt);
  const serialized = `${JSON.stringify(parsed, null, 2)}\n`;
  if (Buffer.byteLength(serialized) > MAX_HISTORY_BYTES) {
    throw new Error("Run receipt exceeds the local history size limit.");
  }

  await ensureHistoryRoot(root);
  const target = receiptPath(root, parsed.id);
  const temporary = join(root, `.${parsed.id}.${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(serialized, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporary, target);
  } finally {
    await handle?.close().catch(() => {});
    await rm(temporary, { force: true }).catch(() => {});
  }
  await trimRunHistory(root, options.maxItems ?? HISTORY_RETENTION_LIMIT);
  return summary(parsed);
}

export async function listRunHistory(root) {
  const items = [];
  let corruptCount = 0;
  for (const path of await receiptFiles(root)) {
    try {
      items.push(summary(await parseReceiptFile(path)));
    } catch {
      corruptCount += 1;
    }
  }
  items.sort((left, right) =>
    String(right.endedAt || right.startedAt).localeCompare(left.endedAt || left.startedAt)
  );
  return { corruptCount, items };
}

export async function readRunReceipt(root, id) {
  return parseReceiptFile(receiptPath(root, id));
}

export async function deleteRunReceipt(root, id) {
  await rm(receiptPath(root, id), { force: true });
  return { deleted: true };
}

export async function clearRunHistory(root) {
  await rm(root, { force: true, recursive: true });
  return { cleared: true };
}
