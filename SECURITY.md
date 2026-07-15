# Security Policy

## Supported versions

Duet is pre-1.0 software. Security fixes are applied to the latest release and the
`main` branch.

## Reporting a vulnerability

Please do not open a public issue for a vulnerability that could expose local
credentials, execute commands outside the selected repository, bypass the
read-only reviewer boundary, or overwrite unrelated work.

Use GitHub's private vulnerability reporting for this repository. Include the
affected version, operating system, reproduction steps, impact, and any proposed
mitigation. Do not include real access tokens, subscription credentials, or other
secrets in the report.

## Trust boundary

Duet launches the official Codex and Claude Code binaries already authenticated on
the local machine. It does not implement provider login, read cached credentials,
or forward those credentials to a Duet service. API-key environment variables are
removed from spawned agent processes. Verification runs in an ephemeral home with
agent, provider, proxy, and Node injection variables removed, but it still has the
local user's operating-system permissions and is not a security sandbox. Treat a
repository's code and its verification commands as untrusted until reviewed.

The packaged desktop app enables ASAR integrity and restrictive Electron fuses,
accepts IPC only from the exact top-level `duet://app` renderer, denies Chromium
permissions, and blocks navigation and new windows. These controls reduce the
impact of renderer compromise; they do not make arbitrary local commands safe.

See [PRIVACY.md](./PRIVACY.md) for stored data, retention, deletion,
child-process, and network boundaries.
