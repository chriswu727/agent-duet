<div align="center">

<img src="./build/icon.svg" alt="Duet" width="112" />

# Duet

**Codex builds. Claude challenges. Your subscriptions stay local.**

Duet is a bounded desktop collaboration loop for AI coding tools. Give it one
concrete task in a Git repository: Codex implements the change, Claude Code
independently reviews the working tree, and only evidenced findings go back for
revision. One writer, one reviewer, finite rounds.

[![CI](https://github.com/chriswu727/agent-duet/actions/workflows/ci.yml/badge.svg)](https://github.com/chriswu727/agent-duet/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/chriswu727/agent-duet?display_name=tag)](https://github.com/chriswu727/agent-duet/releases/latest)
[![Platforms](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-6f7781)](https://github.com/chriswu727/agent-duet/releases/latest)
[![Tests](https://img.shields.io/badge/tests-13%20offline-brightgreen)](./test)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

[Download](https://github.com/chriswu727/agent-duet/releases/latest) · [How it works](#how-it-works) · [Safety model](#safety-model) · [Build from source](#build-from-source)

</div>

<p align="center">
  <img src="./docs/images/duet.png" alt="Duet showing subscription-backed Codex and Claude Code sessions, task composer, bounded safety stops, and run receipt" width="900" />
</p>

<p align="center"><sub>The local app detects the official CLI sessions already on your machine. Handoff estimates describe compact prompt size—not account usage or remaining subscription capacity.</sub></p>

---

## Why Duet

Running two coding agents in separate terminals sounds simple until both edit the
same file, paste entire transcripts back and forth, or argue through your usage
limit. Duet makes the roles and stopping conditions structural.

| Ad-hoc two-agent workflow | **Duet** |
|---|---|
| Both agents may write | **Codex is the only writer** |
| Reviewer inherits the implementer's framing | **Claude starts from a fresh review context** |
| Full chat logs get copied between models | **Only the task, diff summary, verification result, and capped findings cross the handoff** |
| "Looks good" can override a broken test | **A failed verification command blocks PASS** |
| The debate can recurse indefinitely | **Stops on pass, blocked review, no progress, repeated findings, cancellation, rounds, or time** |
| API keys often end up in another orchestrator | **Uses the official local CLI logins; API-key overrides are stripped from child environments** |

Duet does not promise that two models make every change correct. It makes the
collaboration inspectable, asymmetric, and finite.

## How it works

```mermaid
flowchart LR
    U([Task + clean Git repo]) --> C[Codex<br/>implement]
    C --> V[Run explicit<br/>verification]
    V --> R[Claude Code<br/>read-only review]
    R -->|PASS + checks pass| D([Done])
    R -->|actionable findings| H[Compact handoff]
    H --> C2[Same Codex thread<br/>revise]
    C2 --> V
    R -->|blocked / repeated / no progress| S([Stop safely])
```

1. **Preflight** — confirm both CLIs are installed, subscription-backed sessions
   are active, and the selected Git working tree is clean.
2. **Implement** — launch the official Codex stdio MCP server with workspace-write
   sandboxing and no interactive approvals.
3. **Verify** — run the command you supplied, such as `pnpm test`.
4. **Challenge** — launch a fresh Claude Code reviewer in plan mode with write,
   delegation, web, plugin, and nested MCP capabilities disabled.
5. **Revise or stop** — send only valid findings to the same Codex thread. Stop as
   soon as the result passes or a deterministic stop condition fires.

The compact implementation policy is inspired by
[Ponytail](https://github.com/DietrichGebert/ponytail): understand first, reuse
what exists, prefer the platform and installed dependencies, and make the smallest
correct diff. Duet never minimizes away validation, security, accessibility, or
data-loss protection.

## Quick start

### 1. Install and sign in to the official CLIs

- [Codex CLI](https://developers.openai.com/codex/cli/) — sign in with ChatGPT.
- [Claude Code](https://code.claude.com/docs/en/quickstart) — sign in with Claude.ai.
- Install Git.

Duet never asks for either credential. It only checks the login status reported by
each CLI and launches those binaries locally.

### 2. Download Duet

Get the build for your platform from
[GitHub Releases](https://github.com/chriswu727/agent-duet/releases/latest).

Public macOS builds are unsigned until the project has Apple Developer ID signing
and notarization configured. If macOS blocks a build, either build it from source
or review the release checksum and use the system's **Open Anyway** flow only if
you trust this repository.

### 3. Run one bounded collaboration

1. Choose a **clean Git repository**. Duet 0.1 refuses dirty trees to avoid
   overwriting unrelated work.
2. Write one concrete task.
3. Optionally provide a verification command.
4. Choose 1–6 review rounds, a 10–120 minute ceiling, and the Claude reviewer
   model.
5. Start. The run receipt shows phases, findings, verification, changed files,
   and the exact reason the loop stopped.

The default is 3 rounds and 60 minutes. These are per-run safety stops—not token
quotas and not a statement about your remaining subscription capacity.

## Safety model

| Boundary | Enforcement |
|---|---|
| **Single writer** | Only Codex receives workspace-write access. Claude runs in plan mode. |
| **Clean-tree gate** | A run refuses to start if Git already has tracked or untracked changes. |
| **Credential isolation** | Child environments use an allowlist; OpenAI, Anthropic, and other provider API-key variables are omitted. |
| **No nested agent loop** | Codex MCP servers are cleared; Claude plugins, skills, nested MCP, web access, delegation, and write tools are disabled. |
| **Fail-closed review** | Missing or malformed reviewer verdicts become `BLOCKED`, never PASS. |
| **Machine check wins** | Claude cannot PASS a non-zero verification result. |
| **Progress detection** | Duet hashes tracked diffs and untracked contents; an unchanged revision stops the loop. |
| **Bounded output** | Agent output and cross-agent findings are capped before display or handoff. |
| **Process cleanup** | Cancel and timeout terminate child process groups, with a forced cleanup fallback. |
| **Desktop hardening** | Electron uses context isolation, renderer sandboxing, a narrow preload bridge, CSP, denied permissions, and blocked navigation. |

Duet is designed for **personal, local use**. It is not a hosted credential proxy,
does not implement ChatGPT or Claude.ai OAuth, and should not be turned into a
multi-user service that routes subscription credentials.

### Why Claude is not called through MCP today

Codex runs through its official `codex mcp-server`. Claude Code documents
`claude mcp serve`, but the tested Claude Code 2.1.208 surface advertised an
`Agent` tool without registering a usable agent type for an external MCP client.
Duet therefore uses Claude Code's official non-interactive local mode for the
reviewer. The isolation policy is explicit and the adapter is small, so this can
move back to MCP when the external agent contract is reliable.

## Build from source

Requirements: Node.js 22+, pnpm 10+, Git, Codex CLI, and Claude Code.

```bash
git clone https://github.com/chriswu727/agent-duet.git
cd agent-duet
pnpm install
pnpm start
```

Run the offline checks:

```bash
pnpm check
pnpm test
```

Build an installer for the current platform:

```bash
pnpm run dist
```

Pushing a `v*` tag runs the release workflow and attaches macOS, Windows, and
Linux artifacts to a GitHub Release. Local builds are unsigned unless you provide
the platform's signing credentials; no certificates or signing secrets live in
this repository.

## Project layout

```text
agent-duet/
├── src/main.mjs            # hardened Electron main process and run lifecycle
├── src/preload.cjs         # narrow renderer IPC bridge
├── src/renderer/           # desktop UI and run receipt
├── src/core/
│   ├── orchestrator.mjs    # finite Codex → verify → Claude → revise state machine
│   ├── mcp.mjs             # stdio MCP client for Codex
│   ├── claude.mjs          # isolated subscription-backed Claude reviewer
│   ├── git.mjs             # clean-tree gate and progress snapshots
│   ├── prompts.mjs         # lean implementation and fail-closed review contract
│   └── process.mjs         # credential allowlist and child-process cleanup
├── test/                   # offline unit and temporary-Git integration tests
└── .github/workflows/      # CI and cross-platform release builds
```

## Verification status

- 13 offline tests cover configuration ceilings, environment scrubbing, Claude
  isolation, reviewer parsing, and untracked-file progress hashing.
- The packaged macOS arm64 app has been launched and its renderer window verified.
- Generated DMG and ZIP archives pass `hdiutil verify` and `unzip -t` locally.
- Windows, Linux, macOS x64, signing, and notarization rely on GitHub runners or
  platform credentials and are not claimed as locally verified.

## Roadmap

- Signed and notarized macOS releases.
- A completed-run export suitable for issues and pull requests.
- Optional Claude-writer / Codex-reviewer role reversal after write isolation is
  independently verified.
- Native Claude MCP reviewing when its external agent contract is usable.
- More deterministic checks before a model review, reducing unnecessary usage.

## Contributing

Issues and focused pull requests are welcome. Please keep the invariant intact:
one writer, an independent read-only reviewer, and deterministic stopping
conditions. Security reports should follow [SECURITY.md](./SECURITY.md).

## License

[MIT](./LICENSE) © Yichen Wu.

---

<div align="center">

Built for developers who want a second model's skepticism without an unbounded model debate.

</div>
