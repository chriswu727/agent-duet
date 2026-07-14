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
removed from spawned agent processes, but the selected repository and its content
remain untrusted input to both coding tools.
