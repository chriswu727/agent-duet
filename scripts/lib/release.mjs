const releaseTag = /^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function missing(environment, names) {
  return names.filter((name) => !String(environment[name] || "").trim());
}

export function validateRelease({ environment = {}, tag, target, version }) {
  const issues = [];
  if (!releaseTag.test(tag || "")) issues.push("Release tag must be valid v-prefixed SemVer.");
  if (tag !== `v${version}`) issues.push(`Tag ${tag || "(missing)"} does not match package version ${version}.`);
  if (!["linux", "mac", "win"].includes(target)) issues.push(`Unsupported release target: ${target}`);
  if (target === "mac") {
    const signing = missing(environment, ["CSC_LINK", "CSC_KEY_PASSWORD"]);
    const notarization = missing(environment, [
      "APPLE_API_KEY",
      "APPLE_API_KEY_ID",
      "APPLE_API_ISSUER"
    ]);
    if (signing.length) issues.push(`Missing macOS signing values: ${signing.join(", ")}.`);
    if (notarization.length) {
      issues.push(`Missing macOS notarization values: ${notarization.join(", ")}.`);
    }
  }
  if (target === "win") {
    const signing = missing(environment, ["CSC_LINK", "CSC_KEY_PASSWORD"]);
    if (signing.length) issues.push(`Missing Windows signing values: ${signing.join(", ")}.`);
  }
  return issues;
}
