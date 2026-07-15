import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

export const SETTINGS_SCHEMA_VERSION = 2;
export const DEFAULT_SETTINGS = Object.freeze({
  historyRetention: 100,
  maxMinutes: 60,
  maxRounds: 3,
  onboardingComplete: false,
  reviewModel: "sonnet",
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  verificationCommand: ""
});

const minuteValues = [10, 30, 60, 90, 120];
const historyRetentionValues = [0, 10, 25, 50, 100];
const settingsV1Schema = z.object({
  maxMinutes: z.number().int().refine((value) => minuteValues.includes(value)),
  maxRounds: z.number().int().min(1).max(6),
  onboardingComplete: z.boolean(),
  reviewModel: z.enum(["sonnet", "opus", "haiku"]),
  schemaVersion: z.literal(1),
  verificationCommand: z.string().max(2_000)
}).strict();
const settingsSchema = z.object({
  historyRetention: z.number().int().refine((value) =>
    historyRetentionValues.includes(value)
  ),
  maxMinutes: z.number().int().refine((value) => minuteValues.includes(value)),
  maxRounds: z.number().int().min(1).max(6),
  onboardingComplete: z.boolean(),
  reviewModel: z.enum(["sonnet", "opus", "haiku"]),
  schemaVersion: z.literal(SETTINGS_SCHEMA_VERSION),
  verificationCommand: z.string().max(2_000)
}).strict();

const patchSchema = z.object({
  historyRetention: z.coerce.number().int().refine((value) =>
    historyRetentionValues.includes(value)
  ).optional(),
  maxMinutes: z.coerce.number().int().refine((value) => minuteValues.includes(value)).optional(),
  maxRounds: z.coerce.number().int().min(1).max(6).optional(),
  onboardingComplete: z.boolean().optional(),
  reviewModel: z.enum(["sonnet", "opus", "haiku"]).optional(),
  verificationCommand: z.string().max(2_000).transform((value) => value.trim()).optional()
}).strict();

function pathFor(root) {
  return join(root, "settings.json");
}

async function persist(root, settings) {
  const parsed = settingsSchema.parse(settings);
  await mkdir(root, { recursive: true });
  const target = pathFor(root);
  const temporary = join(root, `.settings.${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(parsed, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporary, target);
  } finally {
    await handle?.close().catch(() => {});
    await rm(temporary, { force: true }).catch(() => {});
  }
  return parsed;
}

export async function loadSettings(root, options = {}) {
  const target = pathFor(root);
  try {
    const value = JSON.parse(await readFile(target, "utf8"));
    const current = settingsSchema.safeParse(value);
    if (current.success) return { settings: current.data, warning: null };
    const previous = settingsV1Schema.safeParse(value);
    if (previous.success) {
      const settings = await persist(root, {
        ...previous.data,
        historyRetention: DEFAULT_SETTINGS.historyRetention,
        schemaVersion: SETTINGS_SCHEMA_VERSION
      });
      return {
        settings,
        warning: "Duet upgraded local settings to the latest format."
      };
    }
    throw current.error;
  } catch (error) {
    if (error.code === "ENOENT") {
      return { settings: { ...DEFAULT_SETTINGS }, warning: null };
    }
    const suffix = options.now ? options.now() : Date.now();
    await rename(target, `${target}.corrupt-${suffix}`).catch(() => {});
    return {
      settings: { ...DEFAULT_SETTINGS },
      warning: "Duet recovered invalid settings and restored safe defaults."
    };
  }
}

export async function updateSettings(root, patch) {
  const current = (await loadSettings(root)).settings;
  const next = {
    ...current,
    ...patchSchema.parse(patch),
    schemaVersion: SETTINGS_SCHEMA_VERSION
  };
  return persist(root, next);
}

export async function resetSettings(root) {
  const current = (await loadSettings(root)).settings;
  return persist(root, {
    ...DEFAULT_SETTINGS,
    onboardingComplete: current.onboardingComplete
  });
}
