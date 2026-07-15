import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";

const rules = {
  linux: {
    asset: (name) => name.endsWith(".AppImage") || name.endsWith(".AppImage.blockmap"),
    metadata: "latest-linux.yml",
    primary: (name) => name.endsWith(".AppImage")
  },
  mac: {
    asset: (name) => [".dmg", ".dmg.blockmap", ".zip", ".zip.blockmap"].some((suffix) =>
      name.endsWith(suffix)
    ),
    metadata: "latest-mac.yml",
    primary: (name) => name.endsWith(".dmg") || name.endsWith(".zip")
  },
  win: {
    asset: (name) => name.endsWith(".exe") || name.endsWith(".exe.blockmap"),
    metadata: "latest.yml",
    primary: (name) => name.endsWith(".exe")
  }
};

export async function stageReleaseAssets({ arch, root, target }) {
  const rule = rules[target];
  if (!rule) throw new Error(`Unsupported release target: ${target}`);
  if (!String(arch || "").trim()) throw new Error("Release architecture is required.");

  const names = await readdir(root);
  const sbom = `duet-${target}-${arch}.spdx.json`;
  const selected = names.filter((name) =>
    rule.asset(name) || name === rule.metadata || name === sbom
  );
  const primary = selected.filter(rule.primary);
  if (!primary.length) throw new Error(`Missing ${target} release installer.`);
  if (!primary.every((name) => name.includes(`-${target}-${arch}.`))) {
    throw new Error(`Release installers do not match ${target}-${arch}.`);
  }
  for (const required of [rule.metadata, sbom]) {
    if (!selected.includes(required)) throw new Error(`Missing release asset: ${required}`);
  }

  const output = join(root, "public");
  await rm(output, { force: true, recursive: true });
  await mkdir(output, { recursive: true });
  await Promise.all(selected.map((name) => cp(join(root, name), join(output, name))));
  return { count: selected.length, output };
}
