# Support

Duet is a community-maintained local developer tool. Support is best effort and
applies to the latest release and current `main` branch.

## Where to ask

- Use [GitHub Discussions](https://github.com/chriswu727/agent-duet/discussions)
  for setup questions, workflow advice, and early feature ideas.
- Use the structured bug form for reproducible product defects.
- Use the structured beta-result form only for a signed candidate built through
  the documented Release workflow.
- Use [private vulnerability reporting](https://github.com/chriswu727/agent-duet/security/advisories/new)
  for credential, command-execution, isolation, update, or data-loss issues.

Before reporting a problem, check [docs/COMPATIBILITY.md](./docs/COMPATIBILITY.md),
update both official CLIs, confirm their subscription login status, and retry in
a clean disposable Git repository. Include Duet, operating-system, Codex, Claude
Code, and Git versions plus redacted error codes and stop reasons.

Release-candidate testers should follow
[docs/BETA_TESTING.md](./docs/BETA_TESTING.md) and include the exact workflow
run. Unsigned or repacked artifacts are outside beta support.

Do not include credentials, private repository content, absolute paths that
identify people or organizations, or raw agent transcripts. Duet cannot provide
support for provider account limits, billing, model quality, unofficial CLI
builds, modified installers, or arbitrary third-party verification commands.
