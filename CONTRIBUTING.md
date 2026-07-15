# Contributing to Duet

Duet welcomes focused bug fixes, compatibility work, documentation, and small
features that preserve its core contract: one writer, an independent read-only
reviewer, explicit Apply, and deterministic stopping conditions.

## Before opening a change

- Use a GitHub Discussion for design questions or broad ideas.
- Use an issue for a reproducible bug or a scoped accepted feature.
- Use private vulnerability reporting for credential exposure, command escape,
  reviewer-write bypass, or data-loss risks.
- Never post subscription credentials, private source code, or agent transcripts.

## Local setup

Install Node.js 22.12+, pnpm 10, and Git. The official Codex and Claude Code CLIs
are needed only for an explicitly consented live smoke, not for development.

```bash
git clone https://github.com/chriswu727/agent-duet.git
cd agent-duet
pnpm install --frozen-lockfile
pnpm check
pnpm test
```

Use a topic branch and keep changes narrowly scoped. Do not commit `release/`,
application data, generated logs, credentials, or fixture repositories.

## Verification expectations

Every behavior change needs an offline test. Prefer temporary Git repositories
and fake CLI/MCP processes so CI never spends a subscription or depends on a
provider. Run `pnpm check`, `pnpm test`, and `git diff --check` before opening a
pull request.

For desktop, packaging, security-fuse, or platform changes, also run the relevant
package checks when your platform supports them:

```bash
pnpm run pack
pnpm run verify:package-security
pnpm run smoke:package
```

The guarded `pnpm smoke:live` command is never a routine contribution check. It
must remain opt-in and requires both consent variables documented in the README.

## Pull requests

Explain the outcome, safety impact, and exact verification performed. CI runs
offline tests and packaged UI smoke on macOS, Windows, and Linux, plus dependency
review, OSV, and CodeQL. Merges are squash-only after required checks pass.

Keep public interfaces, receipt schemas, persisted settings, and error codes
backward-compatible or include an explicit migration. Update README, privacy,
security, compatibility, and release documentation whenever their claims change.
Do not set release approval variables or push a version tag from a contribution;
the maintainer gates are defined in
[docs/RELEASE_READINESS.md](./docs/RELEASE_READINESS.md).
