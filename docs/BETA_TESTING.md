# Beta testing

This runbook validates a signed Duet release candidate without turning a test
into an open-ended model session. Use disposable repositories, one review round,
and explicit subscription-use consent from the person running each test.

## Obtain a candidate

The maintainer first configures the signing credentials in
[RELEASING.md](./RELEASING.md), then runs **Actions → Release → Run workflow**
from `main` with an exact version such as `v0.1.1`. A manual run builds and
attests all three platforms, assembles one 14-day Actions artifact with
`SHA256SUMS.txt`, and does not create a tag or GitHub Release.

Download only the combined `duet-v<version>` artifact from that workflow run.
Record the workflow URL with every result. A candidate from another commit or a
repacked installer is not valid evidence for the target version.

## Verify before launch

1. Run `shasum -a 256 -c SHA256SUMS.txt` or
   `sha256sum -c SHA256SUMS.txt` from the extracted artifact directory.
2. Verify at least the installer under test with:

   ```bash
   gh attestation verify <installer> --repo chriswu727/agent-duet
   ```

3. On macOS, verify the application with `codesign --verify --deep --strict`,
   `spctl --assess --type execute`, and `xcrun stapler validate`.
4. On Windows, require `Valid` from `Get-AuthenticodeSignature` for the
   installer and installed `Duet.exe`.
5. On Linux, require the checksum and attestation, then test the AppImage as an
   ordinary non-root desktop user.

Stop and report `BLOCKED` if any provenance or signature check fails.

## Minimum platform matrix

| Environment | Required result |
|---|---|
| macOS Apple silicon | Fresh install and complete scenario pass |
| macOS Intel | Fresh install and complete scenario pass |
| Windows 11 x64 | Fresh install and complete scenario pass |
| Ubuntu 24.04 x64 under X11 | Fresh install and complete scenario pass |
| Wayland or a second Linux distribution | Compatibility feedback; required before claiming support for that environment |

CI proves that unpacked applications launch on hosted macOS, Windows, and
Ubuntu runners. It does not replace installation, OS trust-dialog, desktop
integration, or real local CLI testing on the matrix above.

## Bounded collaboration scenario

Use current official Codex and Claude Code CLIs signed in through ChatGPT and
Claude.ai subscriptions. Confirm the tester accepts that the next step invokes
both subscriptions. Never run this scenario against employer or private code.

1. Create a disposable Git repository containing `README.md` and this verifier:

   ```js
   import { readFile } from "node:fs/promises";

   const value = await readFile("hello.txt", "utf8").catch(() => "");
   if (value !== "hello from duet\n") process.exit(1);
   ```

2. Commit the two files and confirm `git status --porcelain` is empty.
3. Start Duet, finish onboarding, and confirm both CLI probes report supported
   subscription-backed logins.
4. Set one round, a 15-minute ceiling, the lowest suitable reviewer model, and
   verification command `node verify.mjs`.
5. Ask: `Create hello.txt containing exactly "hello from duet" followed by one
   newline. Do not modify any other file.`
6. Require a terminal receipt, successful verification, an inspectable diff,
   and an explicit Apply or Discard choice. A model verdict alone is not a pass.

## Product checks

Complete these with disposable repositories; do not repeat model calls when a
UI-only check is sufficient.

- Restart during an isolated pending result and confirm recovery never changes
  the original repository automatically.
- Exercise Inspect diff, Apply, exact-state Undo, and Discard. Confirm Undo
  refuses after a newer edit, stage, or commit.
- Cancel a run and confirm child processes exit and the UI reaches a stable stop.
- Confirm malformed or failed verification cannot display PASS.
- Save settings, restart, and confirm only documented defaults return.
- Disable history, delete one receipt, clear all history, and verify the UI no
  longer exposes the deleted records.
- Open **Settings → App updates**, confirm no startup/background download, and
  cancel before installing any unrelated version.
- Test uninstall and the platform-specific local-data deletion path documented
  in [PRIVACY.md](../PRIVACY.md).

## Record the result

Use the structured **Beta result** issue form. Record the exact candidate
version, workflow URL, platform, CLI versions, login types, each gate as
pass/fail, and only redacted stable error codes or stop reasons. Never upload
credentials, private source, absolute identifying paths, or agent transcripts.
Report credential exposure, command escape, isolation bypass, update compromise,
or data-loss risk through private vulnerability reporting instead of a public
beta issue.

A candidate is approved only when every required environment has a PASS and no
open release-blocking safety, data-loss, install, signature, or update defect.
