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
    ".github/ISSUE_TEMPLATE/beta_report.yml",
    ".github/ISSUE_TEMPLATE/bug_report.yml",
    ".github/ISSUE_TEMPLATE/feature_request.yml",
    ".github/pull_request_template.md",
    "docs/BETA_TESTING.md",
    "docs/COMPATIBILITY.md",
    "docs/RELEASE_READINESS.md"
  ].map((path) => access(new URL(path, root))));
});

test("keeps every structured issue form parseable", async () => {
  const directory = new URL(".github/ISSUE_TEMPLATE/", root);
  const names = (await readdir(directory))
    .filter((name) => name.endsWith(".yml") && name !== "config.yml");
  for (const name of names) {
    const form = parse(await readFile(new URL(name, directory), "utf8"));
    assert.equal(typeof form.name, "string", name);
    assert.equal(typeof form.description, "string", name);
    assert.ok(Array.isArray(form.body) && form.body.length > 0, name);
  }
});

test("keeps candidate builds separate from tag publication", async () => {
  const workflow = parse(await readFile(new URL(".github/workflows/release.yml", root), "utf8"));
  assert.ok(workflow.on.workflow_dispatch);
  assert.equal(workflow.jobs.publish.if, "github.event_name == 'push'");
  assert.equal(workflow.jobs.publish.needs, "assemble");
  assert.equal(workflow.jobs.assemble.needs, "build");
});

test("keeps source onboarding reproducible and subscription-backed", async () => {
  const readme = await readFile(new URL("README.md", root), "utf8");
  for (const required of [
    "codex login status",
    "claude auth status --json",
    "corepack enable",
    "pnpm install --frozen-lockfile",
    "does not fall back to API credits",
    "historical unsigned alpha builds"
  ]) {
    assert.ok(readme.includes(required), required);
  }
});
