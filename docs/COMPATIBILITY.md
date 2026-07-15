# Compatibility

Duet validates capabilities at startup instead of trusting version strings. A
CLI can be installed and authenticated yet still be rejected if a required
non-interactive or isolation option is unavailable.

## Known-good environments

| Component | Verified environment | Evidence |
|---|---|---|
| Codex CLI | `codex-cli 0.144.2`, ChatGPT login | Local capability and auth probe; `codex mcp-server` contract exercised with offline fake-MCP integration tests |
| Claude Code | `2.1.208`, Claude.ai login | Local capability and auth probe; every required isolation flag present |
| macOS | macOS 15.7 arm64 locally; macOS 26 arm64 GitHub runner | Fresh universal `x86_64`/`arm64` app, DMG, ZIP, fuse, archive, and packaged UI checks |
| Windows | Windows Server 2025 GitHub runner | x64 unpacked app, process-tree cleanup, fuse, settings, navigation, and packaged UI checks |
| Linux | Ubuntu 24.04 GitHub runner under Xvfb | x64 unpacked app with root-owned `chrome-sandbox` mode 4755, fuse, and packaged UI checks |
| Git | 2.50.1 locally plus current GitHub runner versions | Temporary-repository Apply/Discard/Undo and recovery integration suite |
| Build runtime | Node.js 22.12+ and pnpm 10 in CI | Frozen-lockfile install, syntax, offline test, and package matrix |

The Windows CI environment is not a claim that every Windows 10/11 hardware and
policy combination has completed external beta testing. Linux validation covers
Ubuntu/X11-compatible startup; other distributions, Wayland-only environments,
and desktop integration still need release feedback. The macOS universal binary
contains both architectures, while the hosted packaged smoke currently runs on
Apple silicon.

## Required CLI capabilities

Codex must provide `codex mcp-server` and report a ChatGPT-backed login through
`codex login status`.

Claude Code must report `loggedIn: true` with `authMethod: claude.ai` through
`claude auth status --json`, and its help must expose all of these options:

```text
--agent --agents --disable-slash-commands --json-schema --mcp-config
--no-chrome --no-session-persistence --output-format --permission-mode
--print --setting-sources --strict-mcp-config
```

Duet does not set a guessed semantic-version floor. Newer or older builds are
accepted only when this capability probe succeeds. Unofficial wrappers, API-key
logins, and provider-compatible third-party endpoints are outside the supported
contract.

## Reporting a compatibility result

Use the bug form and include Duet, OS, architecture, Git, Codex, and Claude Code
versions; whether each CLI reports the supported subscription login type; and
the redacted compatibility error. Never attach credentials, transcripts, or
private repository content.
