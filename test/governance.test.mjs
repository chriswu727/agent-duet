import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { parse } from "yaml";

const root = new URL("../", import.meta.url);

test("pins every third-party workflow action to an immutable commit", async () => {
  const directory = new URL(".github/workflows/", root);
  const names = (await readdir(directory)).filter((name) => name.endsWith(".yml"));
  for (const name of names) {
    const content = await readFile(new URL(name, directory), "utf8");
    for (const match of content.matchAll(/^\s*(?:-\s*)?uses:\s*([^\s#]+)/gm)) {
      assert.match(match[1], /^[^@\s]+@[a-f0-9]{40}$/, `${name}: ${match[1]}`);
    }
  }
});

test("keeps dependency automation and community health files configured", async () => {
  const dependabot = parse(await readFile(new URL(".github/dependabot.yml", root), "utf8"));
  assert.deepEqual(
    dependabot.updates.map((entry) => entry["package-ecosystem"]).sort(),
    ["github-actions", "npm"]
  );
  await Promise.all([
    "CHANGELOG.md",
    "CODE_OF_CONDUCT.md",
    "CONTRIBUTING.md",
    "SUPPORT.md",
    ".github/CODEOWNERS",
    ".github/ISSUE_TEMPLATE/bug_report.yml",
    ".github/ISSUE_TEMPLATE/feature_request.yml",
    ".github/pull_request_template.md",
    "docs/COMPATIBILITY.md"
  ].map((path) => access(new URL(path, root))));
});
