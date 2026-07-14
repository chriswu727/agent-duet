import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { RUN_STATUS, runDuet } from "../src/core/orchestrator.mjs";
import { runProcess } from "../src/core/process.mjs";

const CONFIRMATION = "I_ACCEPT_SUBSCRIPTION_USAGE";

export function assertLiveSmokeConsent(env = process.env) {
  if (
    env.DUET_LIVE_SMOKE !== "1" ||
    env.DUET_LIVE_SMOKE_CONFIRM !== CONFIRMATION
  ) {
    throw new Error(
      "Live smoke refused. It invokes real Codex and Claude subscription sessions. " +
        "Set DUET_LIVE_SMOKE=1 and DUET_LIVE_SMOKE_CONFIRM=I_ACCEPT_SUBSCRIPTION_USAGE to continue."
    );
  }
}

async function git(cwd, ...args) {
  const result = await runProcess("git", args, { cwd });
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || `git ${args[0]} failed`);
  }
}

async function main() {
  assertLiveSmokeConsent();
  const root = await mkdtemp(join(tmpdir(), "agent-duet-live-"));

  try {
    await writeFile(join(root, "README.md"), "# Duet live smoke fixture\n");
    await writeFile(
      join(root, "verify.mjs"),
      "import { readFile } from 'node:fs/promises';\n" +
        "const text = await readFile('hello.txt', 'utf8').catch(() => '');\n" +
        "if (text !== 'hello from duet\\n') process.exit(1);\n"
    );
    await git(root, "init");
    await git(root, "config", "user.name", "Duet Live Smoke");
    await git(root, "config", "user.email", "duet-smoke@example.invalid");
    await git(root, "add", "README.md", "verify.mjs");
    await git(root, "-c", "commit.gpgSign=false", "commit", "-m", "Initialize smoke fixture");

    const result = await runDuet(
      {
        maxMinutes: 15,
        maxRounds: 1,
        projectPath: root,
        reviewModel: "haiku",
        task: "Create hello.txt containing exactly `hello from duet` followed by one newline. Do not modify any other file.",
        verificationCommand: "node verify.mjs"
      },
      {
        onEvent: (event) => {
          if (event.type === "phase") console.log(event.payload.message);
        }
      }
    );

    console.log(JSON.stringify({ reason: result.reason, status: result.status }));
    if (result.status !== RUN_STATUS.COMPLETED) {
      throw new Error(`Live smoke stopped with ${result.reason}.`);
    }
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (import.meta.url === invokedPath) await main();
