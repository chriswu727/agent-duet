# Privacy

Duet is a local desktop orchestrator. It has no Duet account, hosted proxy,
analytics SDK, telemetry endpoint, or crash-reporting service. It does not ask for
API keys. The official Codex and Claude Code processes still contact their model
providers under the subscription sessions you have already established, so task
text and selected repository content may be processed under those providers'
terms.

## Data stored on this computer

Duet uses Electron's per-user application-data directory. The operating system
normally places it under `~/Library/Application Support/Duet` on macOS,
`%APPDATA%\Duet` on Windows, and `$XDG_CONFIG_HOME/Duet` or `~/.config/Duet` on
Linux.

- `settings.json` contains run defaults, onboarding state, verification command,
  reviewer model, and the chosen history limit. It contains no task or repository
  path.
- `history/` contains versioned run receipts. A receipt records the task,
  repository path, base commit, file names and diff fingerprints, structured
  findings, verification exit state, errors, retries, and stop reason. It does
  not contain model transcripts or credentials.
- `workspaces/` can contain a detached Git worktree with a complete copy of files
  needed for a pending run, plus a recovery manifest. This data remains until you
  Apply and finalize, Undo, or Discard it so that an app restart cannot destroy
  unreviewed work.

Settings and receipts are atomically written with private user permissions where
the operating system supports POSIX modes.

## Retention and deletion

Run history defaults to the newest 100 receipts. In **Settings → Run history**
you can keep 10, 25, 50, or 100, or choose **Do not save**. Reducing the limit
prunes older receipts immediately; choosing **Do not save** clears existing
receipts and prevents new ones from being written. You can also delete one
receipt or use **Clear history**.

Discard pending workspaces from the main screen before deleting application
data. To remove everything, quit Duet and delete its application-data directory.
Uninstallers may leave that directory in place to avoid silently deleting user
work.

## Processes, credentials, and network access

Codex and Claude Code receive narrowly allowlisted environment variables needed
to find their cached subscription login. Provider API-key overrides are removed,
and Duet does not parse or copy the cached login data.

An optional verification command executes as your local operating-system user in
the isolated Git worktree. Duet gives that process a newly created temporary home,
cache, config, data, and temp directory, and does not pass Codex, Claude, provider,
proxy, or `NODE_OPTIONS` values. The temporary directory is removed when the
command exits. This reduces accidental credential exposure; it is not an
operating-system sandbox and does not prevent a command from reading other files
or using the network. Only run repository code and verification commands you
trust.

Duet never accesses the clipboard until you press a Copy button. Diagnostics can
contain paths and process output, so inspect them before sharing.

Installed builds contact GitHub's release infrastructure only after you press
**Check for updates**. Duet does not check on startup or download an update
automatically. A second explicit action downloads the selected release asset;
installation requires a third confirmation. The update channel is fixed to the
public `chriswu727/agent-duet` repository and is not used for analytics.

## Questions and reports

For a potential vulnerability, follow [SECURITY.md](./SECURITY.md). For other
privacy questions, open a GitHub issue without including credentials or private
source code.
