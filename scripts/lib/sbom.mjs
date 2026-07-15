export function validateSbom(document, manifest) {
  const issues = [];
  if (document?.spdxVersion !== "SPDX-2.3") issues.push("SBOM must use SPDX 2.3.");
  if (!Array.isArray(document?.packages)) return [...issues, "SBOM packages are missing."];

  const versions = new Map(document.packages.map((entry) => [entry.name, entry.versionInfo]));
  const expected = new Map([
    [manifest.name, manifest.version],
    ...Object.entries(manifest.dependencies || {})
  ]);
  for (const [name, version] of expected) {
    if (!versions.has(name)) issues.push(`SBOM is missing packaged dependency: ${name}.`);
    else if (versions.get(name) !== version) {
      issues.push(`SBOM version mismatch for ${name}: expected ${version}, received ${versions.get(name)}.`);
    }
  }
  return issues;
}
