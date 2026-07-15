import assert from "node:assert/strict";
import test from "node:test";
import { validateSbom } from "../scripts/lib/sbom.mjs";

const manifest = {
  dependencies: { "runtime-package": "2.0.0" },
  name: "agent-duet",
  version: "1.0.0"
};

test("requires the app and exact direct runtime dependency versions in an SPDX SBOM", () => {
  assert.deepEqual(validateSbom({
    packages: [
      { name: "agent-duet", versionInfo: "1.0.0" },
      { name: "runtime-package", versionInfo: "2.0.0" }
    ],
    spdxVersion: "SPDX-2.3"
  }, manifest), []);

  assert.match(validateSbom({
    packages: [{ name: "agent-duet", versionInfo: "0.9.0" }],
    spdxVersion: "SPDX-2.2"
  }, manifest).join(" "), /SPDX 2\.3.*version mismatch.*missing packaged dependency/);
});
