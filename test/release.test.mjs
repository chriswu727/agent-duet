import assert from "node:assert/strict";
import test from "node:test";
import { validateRelease } from "../scripts/lib/release.mjs";

test("requires the tag to exactly match package SemVer", () => {
  assert.deepEqual(validateRelease({
    tag: "v0.2.0-beta.1",
    target: "linux",
    version: "0.2.0-beta.1"
  }), []);
  assert.deepEqual(validateRelease({
    tag: "v0.2.0+build.7",
    target: "linux",
    version: "0.2.0+build.7"
  }), []);
  assert.match(validateRelease({
    tag: "v0.2.1",
    target: "linux",
    version: "0.2.0"
  }).join(" "), /does not match/);
  assert.match(validateRelease({
    tag: "release-0.2.0",
    target: "linux",
    version: "0.2.0"
  }).join(" "), /v-prefixed SemVer/);
});

test("fails closed when signing or notarization values are absent", () => {
  const macIssues = validateRelease({
    environment: {},
    tag: "v0.2.0",
    target: "mac",
    version: "0.2.0"
  });
  const windowsIssues = validateRelease({
    environment: {},
    tag: "v0.2.0",
    target: "win",
    version: "0.2.0"
  });

  assert.match(macIssues.join(" "), /CSC_LINK/);
  assert.match(macIssues.join(" "), /APPLE_API_KEY/);
  assert.match(windowsIssues.join(" "), /CSC_LINK/);
});

test("accepts complete release credentials without exposing their values", () => {
  const environment = {
    APPLE_API_ISSUER: "issuer",
    APPLE_API_KEY: "/tmp/key.p8",
    APPLE_API_KEY_ID: "key",
    CSC_KEY_PASSWORD: "password",
    CSC_LINK: "certificate"
  };
  assert.deepEqual(validateRelease({
    environment,
    tag: "v0.2.0",
    target: "mac",
    version: "0.2.0"
  }), []);
  assert.deepEqual(validateRelease({
    environment: {
      CSC_KEY_PASSWORD: "password",
      CSC_LINK: "certificate"
    },
    tag: "v0.2.0",
    target: "win",
    version: "0.2.0"
  }), []);
});
