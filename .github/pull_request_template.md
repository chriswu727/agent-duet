## What changed

Describe the user-visible outcome and why this is the smallest correct change.

## Safety impact

- [ ] Codex remains the only writer and Claude remains read-only.
- [ ] Apply/Discard, clean-tree, bounded-stop, and credential-isolation behavior is preserved.
- [ ] New child processes and persisted data have explicit cleanup and privacy behavior.
- [ ] No generated artifact, credential, transcript, or private repository content is committed.

## Verification

- [ ] `pnpm check`
- [ ] `pnpm test`
- [ ] Relevant packaged or temporary-Git integration test
- [ ] No live subscription smoke was run, or the PR explains explicit consent and the exact result.

Link related issues and include platform-specific evidence when behavior differs by operating system.
