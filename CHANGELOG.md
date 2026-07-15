# Changelog

All notable user-visible changes are recorded here. Duet follows Semantic
Versioning while pre-1.0 minor releases may still change interfaces.

## [Unreleased]

### Added

- Isolated managed worktrees with Apply, Discard, exact-state Undo, and crash
  recovery.
- Structured fail-closed Claude reviews, classified errors, bounded read-only
  retry, and transcript-free Receipt v2 history.
- First-run onboarding, saved defaults, diff preview, privacy controls, and local
  diagnostics.
- Manual signed-release updates, packaged UI smoke, checksums, SPDX runtime
  SBOMs, and GitHub attestations.
- Signed candidate artifacts, external beta guidance, and fail-closed
  distribution, live-smoke, and beta approval gates before publication.
- Cross-platform CI, dependency review, OSV, CodeQL, OpenSSF Scorecard, and
  repository governance.

### Security

- Exact-origin IPC, renderer sandboxing, denied browser capabilities, ASAR
  integrity, restrictive Electron fuses, and isolated verification environments.

## [0.1.0] - 2026-07-14

### Added

- Initial public macOS alpha demonstrating a bounded local Codex writer and
  Claude Code reviewer loop backed by existing CLI subscription sessions.

[Unreleased]: https://github.com/chriswu727/agent-duet/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/chriswu727/agent-duet/releases/tag/v0.1.0
