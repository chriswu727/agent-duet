import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const html = await readFile(new URL("../src/renderer/index.html", import.meta.url), "utf8");
const script = await readFile(new URL("../src/renderer/app.js", import.meta.url), "utf8");

test("renderer ids are unique and every form control has a label", () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);

  for (const match of html.matchAll(/<(?:input|select|textarea)\b[^>]*\bid="([^"]+)"[^>]*>/g)) {
    const id = match[1];
    assert.match(html, new RegExp(`<label\\b[^>]*\\bfor="${id}"`), `${id} needs a label`);
  }
});

test("dialogs have labelled titles and buttons have accessible names", () => {
  for (const match of html.matchAll(/<dialog\b[^>]*\baria-labelledby="([^"]+)"[^>]*>/g)) {
    assert.match(html, new RegExp(`\\bid="${match[1]}"`));
  }
  for (const match of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
    const attributes = match[1];
    const text = match[2].replace(/<[^>]+>/g, "").trim();
    assert.ok(text || /\baria-label="[^"]+"/.test(attributes), "button needs a name");
  }
  assert.doesNotMatch(html, /tabindex="[1-9]/);
});

test("renderer writes untrusted values through textContent only", () => {
  assert.doesNotMatch(script, /\.innerHTML\s*=|insertAdjacentHTML|document\.write/);
  assert.match(script, /file\.textContent = path/);
  assert.match(script, /elements\.diffPatch\.textContent = preview\.patch/);
});

test("first-run acknowledgement survives Escape and async event cleanup", () => {
  assert.match(html, /id="onboarding-dialog"[^>]*closedby="none"/);
  assert.match(script, /const button = event\.currentTarget;[\s\S]*button\.disabled = false/);
  assert.match(
    script,
    /onboardingDialog\.addEventListener\("close"[\s\S]*onboardingDialog\.showModal\(\)/
  );
});
