# Release readiness

This document separates completed engineering from the external evidence needed
for a supported public release. The current source candidate is `v0.1.1`; it is
not approved for public release yet. The existing `v0.1.0` assets are historical
unsigned alpha builds, not evidence that the gates below have passed.

## Current `v0.1.1` status

| Gate | Status | Evidence or remaining action |
|---|---|---|
| Offline behavior and integration suite | Complete | Runs on macOS, Windows, and Ubuntu with fake CLI/MCP processes; no subscription use |
| Packaged application startup | Complete | Fresh unpacked applications launch and pass UI smoke on all three hosted runner platforms |
| Desktop and supply-chain hardening | Complete | ASAR, eight Electron fuses, checksums, SPDX runtime SBOM, attestations, CodeQL, OSV, and dependency review are enforced |
| Repository governance | Complete | Protected `main`, immutable future releases, squash-only merges, security reporting, pinned Actions, Dependabot, and community files |
| Anthropic distribution confirmation | Blocked externally | Obtain written confirmation suitable for this third-party local orchestrator, then retain a private record reference |
| Apple signing and notarization | Blocked externally | Add a Developer ID Application certificate and App Store Connect API credentials |
| Windows signing | Blocked externally | Add a trusted Windows code-signing certificate and password |
| Real subscription smoke | Awaiting explicit consent | Run the guarded one-shot smoke for this exact version; it has intentionally not been run during development |
| External signed-package beta | Not run | Complete every required environment in [BETA_TESTING.md](./BETA_TESTING.md) |

Requiring written distribution confirmation is a conservative project release
policy, not a legal conclusion. Do not set the gate merely because the software
works technically.

### Distribution-confirmation request

Use an official Anthropic support or terms channel and describe the product
without implying endorsement. The request should include the public repository,
MIT license, planned supported platforms, and these exact boundaries:

- Duet launches the user's installed official Claude Code CLI in documented
  non-interactive mode as one fresh, read-only reviewer.
- The user signs in directly through Claude.ai; Duet neither receives nor
  forwards credentials and does not accept an Anthropic API key.
- The product is local and single-user, has finite rounds, performs no hosted
  credential proxying, and disables nested MCP, plugins, delegation, and writes
  for the reviewer.
- The user explicitly starts each run, and subscription limits remain controlled
  by the provider's own CLI and account.

Ask for written confirmation that publicly distributing and supporting this
specific integration is permitted, plus any conditions on branding,
documentation, telemetry, or subscription-backed non-interactive use. Retain
the response privately and place only a non-sensitive record reference in the
GitHub variable.

## Enforced workflow gates

The **Release** workflow has two modes:

- A manual `workflow_dispatch` run is a signed **candidate**. It validates the
  exact `v<package-version>`, signatures, notarization, package security, UI
  startup, SBOM, attestations, and checksums, then retains a combined artifact
  for 14 days. It never tags or publishes a Release.
- A pushed exact version tag is a **publication**. It repeats the full build and
  additionally refuses to start unless the written-confirmation reference,
  live-smoke version, and beta-approved version gates are present. Only then can
  it create an immutable GitHub Release.

This prevents a tag typo or a partially configured runner from publishing an
unsigned or unapproved build.

## Credentials and approval variables

Configure certificates and keys as GitHub Actions repository secrets:

| Platform | Required secrets |
|---|---|
| macOS | `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`, `APPLE_API_KEY_BASE64`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` |
| Windows | `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` |

After the corresponding evidence exists, set these repository variables:

| Variable | Required value |
|---|---|
| `DUET_DISTRIBUTION_APPROVAL_REF` | A non-secret reference to the privately retained written confirmation |
| `DUET_LIVE_SMOKE_VERSION` | The exact tag, for example `v0.1.1` |
| `DUET_BETA_APPROVED_VERSION` | The same exact tag after the required beta matrix passes |

Example commands, to be run only after the evidence exists:

```bash
gh variable set DUET_DISTRIBUTION_APPROVAL_REF --body "<record-reference>"
gh variable set DUET_LIVE_SMOKE_VERSION --body "v0.1.1"
gh variable set DUET_BETA_APPROVED_VERSION --body "v0.1.1"
```

Do not store a letter, certificate, token, password, or private test data in a
repository variable. Keep the underlying records privately and record the date,
version, operator, result, and workflow URL in the release evidence.

## Go/no-go checklist

Before pushing a release tag:

1. Confirm `main` is clean, protected, and green at the intended commit.
2. Confirm the package version, changelog, documentation, and exact tag agree.
3. Run the manual signed candidate from `main`; verify every checksum,
   attestation, signature, notarization ticket, SBOM, and packaged smoke.
4. Complete the external matrix in [BETA_TESTING.md](./BETA_TESTING.md) and
   resolve every release blocker.
5. With the maintainer's explicit subscription-use consent, run the guarded
   live smoke exactly once for the target version and retain its terminal result.
6. Verify the written distribution confirmation still covers the supported
   product behavior and local subscription-backed CLI usage.
7. Set the three exact approval variables, then follow the tag procedure in
   [RELEASING.md](./RELEASING.md).
8. After publication, independently download one installer per platform and
   repeat checksum, attestation, signature, install, launch, and manual update
   checks. Publish a new patch version for any correction; never replace assets.

Any missing item is a no-go. A GitHub Actions success cannot substitute for the
external evidence, and external evidence cannot justify bypassing a failed
automated check.
