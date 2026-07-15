# Releasing Duet

Duet releases are built only from an exact `v<package-version>` tag. The
release workflow fails closed when a tag and `package.json` disagree, when a
required signing or approval value is absent, or when the resulting binaries
do not pass platform signature checks. A manual run can build the same signed
candidate matrix without creating a tag or publishing a GitHub Release.

## Release credentials

Configure these as GitHub Actions repository secrets. Never commit certificate
files, passwords, or Apple API keys.

| Platform | Required secrets |
|---|---|
| macOS | `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`, `APPLE_API_KEY_BASE64`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` |
| Windows | `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` |
| Linux | None |

`MAC_CSC_LINK` must identify a Developer ID Application certificate. Encode the
App Store Connect `.p8` API key as base64 for `APPLE_API_KEY_BASE64`. The
workflow writes it to a private temporary file and deletes it with the runner.
The Windows values must identify a code-signing certificate accepted by
electron-builder.

Publication also requires three GitHub Actions repository variables. Set them
only after the evidence in [RELEASE_READINESS.md](./RELEASE_READINESS.md)
exists:

| Variable | Required value |
|---|---|
| `DUET_DISTRIBUTION_APPROVAL_REF` | Non-secret reference to retained written distribution confirmation |
| `DUET_LIVE_SMOKE_VERSION` | Exact release tag |
| `DUET_BETA_APPROVED_VERSION` | Exact release tag |

These variables are not needed to build a manual candidate. Signing and
notarization credentials are required for both candidate and publication runs.

## Release procedure

1. Confirm `main` CI is green and the working tree is clean.
2. Update the version with `pnpm version <version> --no-git-tag-version`, update
   release-facing documentation, and merge that change through CI.
3. From the GitHub **Release** workflow, run a manual candidate against `main`
   with the exact `v<package-version>`. Download the combined `duet-v<version>`
   artifact, verify it, and complete [BETA_TESTING.md](./BETA_TESTING.md).
4. Run the guarded live subscription smoke only with explicit maintainer
   consent. Retain its result and the written distribution-confirmation
   reference, then set all three approval variables to the exact target tag.
5. Create and push one annotated tag on that exact `main` commit:

   ```bash
   git tag -a v0.2.0 -m "Duet v0.2.0"
   git push origin v0.2.0
   ```

6. Watch the `Release` workflow. Do not create a GitHub Release by hand. A tag
   containing a SemVer prerelease suffix, such as `v0.2.0-beta.1`, becomes a
   prerelease; a stable tag becomes the latest release.
7. Download one installer per platform and verify its checksum, attestation,
   signature, launch, and manual update UI before announcing the release.

The build matrix produces a notarized universal macOS DMG and ZIP, a signed
Windows NSIS installer, and a Linux AppImage. Each job runs the offline suite,
validates the packaged ASAR, update feed, and Electron fuses, launches the
packaged UI, generates a packaged-runtime SPDX JSON SBOM, and creates GitHub
artifact and SBOM attestations. The assembly job creates and verifies a sorted
`SHA256SUMS.txt`. Candidate runs retain the complete set as a 14-day Actions
artifact; tag runs pass that exact assembled set to the immutable GitHub
Release publisher.

## Verify downloaded artifacts

From a directory containing all downloaded release files:

```bash
shasum -a 256 -c SHA256SUMS.txt
gh attestation verify Duet-0.2.0-mac-universal.dmg \
  --repo chriswu727/agent-duet
```

Use `sha256sum -c SHA256SUMS.txt` on systems that provide GNU coreutils. GitHub
CLI attestation verification requires a current authenticated `gh` installation.

Platform checks:

- macOS: `codesign --verify --deep --strict Duet.app`,
  `spctl --assess --type execute Duet.app`, and `xcrun stapler validate Duet.app`.
- Windows: inspect both the installer and installed `Duet.exe` with
  `Get-AuthenticodeSignature`; each status must be `Valid`.
- Linux: verify the checksum and GitHub attestation, then launch the AppImage in
  a disposable user-data directory.

## Update channel

Packaged Duet builds use only this repository's GitHub Releases feed. They do
not check on startup and do not download automatically. The user must press
**Check for updates**, then separately approve **Download update** and
**Restart and install**. Stable builds follow stable releases; prerelease builds
may follow prereleases. Downgrades are disabled.

The macOS ZIP and Windows blockmap/metadata files are update inputs, even when a
user normally downloads the DMG or installer. Do not delete them from a release.
Never replace assets on an existing tag; publish a new patch version instead.

## Failure policy

Do not bypass signing, notarization, package smoke, SBOM, attestation, checksum,
or tag/version failures. Fix the source, workflow, or credentials and publish a
new tag. A failed tag must not be reused after any artifact was made public.
