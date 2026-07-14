const elements = {
  cancel: document.querySelector("#cancel-run"),
  chooseProject: document.querySelector("#choose-project"),
  claudeCard: document.querySelector("#claude-card"),
  claudeDetail: document.querySelector("#claude-detail"),
  claudePill: document.querySelector("#claude-pill"),
  codexCard: document.querySelector("#codex-card"),
  codexDetail: document.querySelector("#codex-detail"),
  codexPill: document.querySelector("#codex-pill"),
  copyDiagnostics: document.querySelector("#copy-diagnostics"),
  copyStatus: document.querySelector("#copy-status"),
  diffDialog: document.querySelector("#diff-dialog"),
  diffFiles: document.querySelector("#diff-files"),
  diffNote: document.querySelector("#diff-note"),
  diffPatch: document.querySelector("#diff-patch"),
  diffStat: document.querySelector("#diff-stat"),
  fileMetric: document.querySelector("#file-metric"),
  form: document.querySelector("#run-form"),
  formMessage: document.querySelector("#form-message"),
  historyList: document.querySelector("#history-list"),
  historyStatus: document.querySelector("#history-status"),
  log: document.querySelector("#log-output"),
  maxMinutes: document.querySelector("#max-minutes"),
  maxRounds: document.querySelector("#max-rounds"),
  onboardingDialog: document.querySelector("#onboarding-dialog"),
  onboardingStatus: document.querySelector("#onboarding-status"),
  openSettings: document.querySelector("#open-settings"),
  projectPath: document.querySelector("#project-path"),
  refreshHealth: document.querySelector("#refresh-health"),
  roundMetric: document.querySelector("#round-metric"),
  runState: document.querySelector("#run-state"),
  runTitle: document.querySelector("#run-title"),
  reviewModel: document.querySelector("#review-model"),
  settingsDialog: document.querySelector("#settings-dialog"),
  settingsForm: document.querySelector("#settings-form"),
  settingsMaxMinutes: document.querySelector("#settings-max-minutes"),
  settingsMaxRounds: document.querySelector("#settings-max-rounds"),
  settingsReviewModel: document.querySelector("#settings-review-model"),
  settingsStatus: document.querySelector("#settings-status"),
  settingsVerification: document.querySelector("#settings-verification-command"),
  start: document.querySelector("#start-run"),
  task: document.querySelector("#task"),
  taskCount: document.querySelector("#task-count"),
  timeline: document.querySelector("#timeline"),
  tokenMetric: document.querySelector("#token-metric"),
  verificationCommand: document.querySelector("#verification-command"),
  workspaceList: document.querySelector("#workspace-queue"),
  workspacePanel: document.querySelector("#workspace-queue-panel"),
  workspaceStatus: document.querySelector("#workspace-status")
};

let running = false;
let settings;

function setRunning(value) {
  running = value;
  elements.start.disabled = value;
  elements.chooseProject.disabled = value;
  elements.refreshHealth.disabled = value;
  elements.openSettings.disabled = value;
  elements.cancel.classList.toggle("hidden", !value);
  elements.form.setAttribute("aria-busy", String(value));
  document.querySelectorAll("[data-workspace-action]").forEach((button) => {
    button.disabled = value;
  });
  document.querySelectorAll("[data-history-id]").forEach((button) => {
    button.disabled = value;
  });
}

function repositoryName(path) {
  return String(path).split(/[\\/]/).filter(Boolean).at(-1) || path;
}

function workspaceButton(label, action, id, className = "") {
  const button = document.createElement("button");
  button.className = `workspace-action ${className}`.trim();
  button.dataset.workspaceAction = action;
  button.dataset.workspaceId = id;
  button.disabled = running;
  button.textContent = label;
  button.type = "button";
  return button;
}

function renderWorkspaces(workspaces) {
  elements.workspaceList.replaceChildren();
  elements.workspacePanel.classList.toggle("hidden", workspaces.length === 0);
  for (const workspace of workspaces) {
    const item = document.createElement("li");
    item.className = "workspace-item";
    const top = document.createElement("div");
    top.className = "workspace-item-top";
    const name = document.createElement("strong");
    name.textContent = repositoryName(workspace.projectRoot);
    const state = document.createElement("span");
    state.className = `run-state ${workspace.state === "applied" ? "completed" : "stopped"}`;
    state.textContent = workspace.state;
    top.append(name, state);

    const summary = document.createElement("p");
    summary.textContent = workspace.state === "applied"
      ? "Changes are in the original repository. Undo remains available only while that exact state is untouched."
      : "Changes remain outside the original repository and survive an app restart.";
    item.append(top, summary);

    if (workspace.error) {
      const error = document.createElement("p");
      error.textContent = workspace.error;
      item.append(error);
    }
    if (workspace.changedFiles.length) {
      const files = document.createElement("ul");
      files.className = "workspace-files";
      for (const path of workspace.changedFiles.slice(0, 8)) {
        const file = document.createElement("li");
        file.textContent = path;
        files.append(file);
      }
      if (workspace.changedFiles.length > 8) {
        const more = document.createElement("li");
        more.textContent = `+ ${workspace.changedFiles.length - 8} more`;
        files.append(more);
      }
      item.append(files);
    }

    const actions = document.createElement("div");
    actions.className = "workspace-item-actions";
    if (workspace.canPreview) {
      actions.append(workspaceButton("Inspect diff", "diff", workspace.id));
    }
    if (workspace.canApply) {
      actions.append(
        workspaceButton("Apply changes", "apply", workspace.id, "apply"),
        workspaceButton("Discard", "discard", workspace.id, "destructive")
      );
    } else if (workspace.canUndo) {
      actions.append(
        workspaceButton("Undo apply", "undo", workspace.id, "destructive"),
        workspaceButton("Keep changes", "finalize", workspace.id)
      );
    } else if (workspace.canDiscard) {
      actions.append(
        workspaceButton("Discard record", "discard", workspace.id, "destructive")
      );
    }
    item.append(actions);
    elements.workspaceList.append(item);
  }
}

async function refreshWorkspaces() {
  try {
    renderWorkspaces(await window.duet.workspaces());
  } catch (error) {
    elements.workspacePanel.classList.remove("hidden");
    elements.workspaceStatus.textContent = error.message;
  }
}

function applySettings(value) {
  settings = value;
  elements.maxMinutes.value = String(value.maxMinutes);
  elements.maxRounds.value = String(value.maxRounds);
  elements.reviewModel.value = value.reviewModel;
  elements.verificationCommand.value = value.verificationCommand;
  elements.settingsMaxMinutes.value = String(value.maxMinutes);
  elements.settingsMaxRounds.value = String(value.maxRounds);
  elements.settingsReviewModel.value = value.reviewModel;
  elements.settingsVerification.value = value.verificationCommand;
}

async function refreshSettings() {
  try {
    const result = await window.duet.settings();
    applySettings(result.settings);
    if (result.warning) elements.settingsStatus.textContent = result.warning;
    if (!result.settings.onboardingComplete && !elements.onboardingDialog.open) {
      elements.onboardingDialog.showModal();
    }
  } catch (error) {
    elements.formMessage.textContent = `Could not load settings: ${error.message}`;
  }
}

async function showWorkspaceDiff(id) {
  elements.diffFiles.replaceChildren();
  elements.diffStat.textContent = "Loading isolated diff…";
  elements.diffPatch.textContent = "";
  elements.diffNote.textContent = "";
  elements.diffDialog.showModal();
  document.querySelectorAll("[data-workspace-action]").forEach((button) => {
    button.disabled = true;
  });
  try {
    const preview = await window.duet.workspaceDiff(id);
    elements.diffStat.textContent = preview.stat;
    for (const path of preview.changedFiles) {
      const file = document.createElement("li");
      file.textContent = path;
      elements.diffFiles.append(file);
    }
    elements.diffPatch.textContent = preview.patch;
    elements.diffNote.textContent = preview.truncated
      ? "Preview capped at 160 KB. Apply still transfers the complete exact tree."
      : "Read-only preview of the complete isolated tree.";
  } catch (error) {
    elements.diffStat.textContent = "Could not load this diff.";
    elements.diffNote.textContent = error.message;
  } finally {
    document.querySelectorAll("[data-workspace-action]").forEach((button) => {
      button.disabled = running;
    });
  }
}

function renderHistory({ corruptCount = 0, items = [] }) {
  elements.historyList.replaceChildren();
  if (items.length === 0) {
    const empty = document.createElement("li");
    empty.className = "history-empty";
    empty.textContent = "Completed and failed run receipts will appear here.";
    elements.historyList.append(empty);
  }
  for (const receipt of items.slice(0, 8)) {
    const item = document.createElement("li");
    item.className = "history-item";
    const copy = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = `${receipt.project} · ${receipt.status}`;
    const task = document.createElement("p");
    task.textContent = receipt.task;
    copy.append(title, task);

    const meta = document.createElement("div");
    meta.className = "history-meta";
    const time = document.createElement("time");
    time.dateTime = receipt.endedAt || receipt.startedAt;
    time.textContent = new Date(time.dateTime).toLocaleString([], {
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      month: "short"
    });
    const result = document.createElement("span");
    result.textContent = receipt.reason.replaceAll("_", " ");
    const view = document.createElement("button");
    view.className = "history-view";
    view.dataset.historyId = receipt.id;
    view.disabled = running;
    view.textContent = "View receipt";
    view.type = "button";
    meta.append(time, result, view);
    item.append(copy, meta);
    elements.historyList.append(item);
  }
  elements.historyStatus.textContent = corruptCount
    ? `${corruptCount} unreadable local receipt${corruptCount === 1 ? " was" : "s were"} ignored.`
    : "";
}

async function refreshHistory() {
  try {
    renderHistory(await window.duet.history());
  } catch (error) {
    elements.historyStatus.textContent = error.message;
  }
}

function reviewText(review) {
  const sections = [];
  if (review.summary) sections.push(review.summary);
  if (review.blockedReason) sections.push(`Blocked: ${review.blockedReason}`);
  if (Array.isArray(review.findings) && review.findings.length) {
    sections.push(review.findings.map((finding) =>
      `- [${finding.priority}] ${finding.path || "repository"}${finding.line ? `:${finding.line}` : ""} — ${finding.title}\n  Evidence: ${finding.evidence}\n  Minimal fix: ${finding.suggestion}`
    ).join("\n"));
  } else if (typeof review.findings === "string" && review.findings) {
    sections.push(review.findings);
  }
  if (Array.isArray(review.checks) && review.checks.length) {
    sections.push(review.checks.map((check) =>
      `- ${check.name}: ${check.status}${check.evidence ? ` — ${check.evidence}` : ""}`
    ).join("\n"));
  }
  return sections.join("\n\n") || "No review details recorded.";
}

async function showHistoryReceipt(id) {
  if (running) return;
  elements.historyStatus.textContent = "Loading receipt…";
  try {
    const receipt = await window.duet.historyReceipt(id);
    clearTimeline();
    const state = receipt.result.status;
    setRunState(state === "failed" ? "error" : state, `Past run · ${repositoryName(receipt.project.root)}`);
    elements.roundMetric.textContent = String(receipt.result.round ?? receipt.rounds.length);
    elements.fileMetric.textContent = String(receipt.result.changedFiles.length);
    elements.tokenMetric.textContent = "—";
    addEvent({
      body: `${receipt.request.task}\nBase: ${receipt.project.baseCommit || "not resolved"}`,
      time: receipt.startedAt,
      title: "Run started"
    });
    for (const retry of receipt.retries || []) {
      addEvent({
        body: `${retry.operation} · ${retry.code} · retry ${retry.attempt + 1}/${retry.maxAttempts}`,
        time: retry.time,
        title: "Bounded retry"
      });
    }
    for (const warning of receipt.warnings || []) {
      addEvent({
        body: `${warning.message}\nCode: ${warning.code} · Category: ${warning.category}`,
        time: warning.time,
        title: "Cleanup warning"
      });
    }
    for (const round of receipt.rounds) {
      addEvent({
        agent: "claude",
        body: reviewText(round.review),
        title: `Claude review · round ${round.round}`,
        verdict: round.review.verdict
      });
      addEvent({
        body: round.verification
          ? `Exit ${round.verification.code}${round.verification.timedOut ? " · timed out" : ""}`
          : "No explicit command configured.",
        title: "Verification evidence"
      });
    }
    const error = receipt.result.error;
    addEvent({
      body: error
        ? `${error.message}\nCode: ${error.code} · Category: ${error.category}`
        : String(receipt.result.detail || receipt.result.reason),
      time: receipt.endedAt || receipt.startedAt,
      title: `Run ${receipt.result.status}`
    });
    elements.historyStatus.textContent = "Receipt loaded in the run panel.";
  } catch (error) {
    elements.historyStatus.textContent = error.message;
  }
}

async function runWorkspaceAction(action, id) {
  const confirmations = {
    discard: "Discard these isolated changes? This cannot be undone.",
    finalize: "Keep the applied files and remove Duet's Undo record?",
    undo: "Undo the applied files? Duet will proceed only if the repository is still an exact match."
  };
  if (confirmations[action] && !window.confirm(confirmations[action])) return;
  const operations = {
    apply: window.duet.applyWorkspace,
    discard: window.duet.discardWorkspace,
    finalize: window.duet.finalizeWorkspace,
    undo: window.duet.undoWorkspace
  };
  document.querySelectorAll("[data-workspace-action]").forEach((button) => {
    button.disabled = true;
  });
  elements.workspacePanel.setAttribute("aria-busy", "true");
  elements.workspaceStatus.textContent = `${action[0].toUpperCase()}${action.slice(1)} in progress…`;
  try {
    const result = await operations[action](id);
    const messages = {
      applied: "Changes applied to the original repository. Undo is available until you edit or commit.",
      discarded: "Isolated changes discarded. The original repository was not modified.",
      finalized: "Applied changes kept. The Undo record was removed.",
      undone: "Applied changes were undone and the original repository is clean."
    };
    elements.formMessage.textContent = messages[result.state] || "Workspace updated.";
    elements.workspaceStatus.textContent = "";
  } catch (error) {
    elements.workspaceStatus.textContent = error.message;
  }
  await refreshWorkspaces();
  elements.workspacePanel.setAttribute("aria-busy", "false");
}

function setRunState(state, title) {
  elements.runState.className = `run-state ${state}`;
  elements.runState.textContent = state;
  if (title) elements.runTitle.textContent = title;
}

function setHealth(agent, data) {
  const card = elements[`${agent}Card`];
  const detail = elements[`${agent}Detail`];
  const pill = elements[`${agent}Pill`];
  const ready = data.subscription && data.compatible;
  card.classList.toggle("ready", ready);
  pill.className = `pill ${ready ? "good" : "bad"}`;
  pill.textContent = ready
    ? "Ready"
    : data.subscription && !data.compatible
      ? "Update required"
      : "Needs login";

  if (!data.installed) {
    detail.textContent = "CLI not found on this computer.";
  } else if (!data.compatible) {
    detail.textContent = data.compatibilityError || "Installed CLI is not compatible with Duet.";
  } else if (data.subscription) {
    const plan = data.subscriptionType ? ` · ${data.subscriptionType}` : "";
    detail.textContent = `${data.version || "Installed"}${plan} · local cached login`;
  } else {
    detail.textContent = data.auth || data.error || `${data.version || "Installed"} · subscription login not detected`;
  }
}

async function refreshHealth() {
  elements.refreshHealth.disabled = true;
  elements.formMessage.textContent = "Checking local subscription sessions…";
  try {
    const health = await window.duet.health();
    setHealth("codex", health.codex);
    setHealth("claude", health.claude);
    const ready =
      health.codex.subscription &&
      health.codex.compatible &&
      health.claude.subscription &&
      health.claude.compatible;
    const signedIn = health.codex.subscription && health.claude.subscription;
    elements.formMessage.textContent = ready
      ? "Both subscription sessions are ready."
      : signedIn
        ? "Update the incompatible CLI before starting."
        : "Sign in with both official CLIs before starting.";
  } catch (error) {
    elements.formMessage.textContent = error.message;
  } finally {
    elements.refreshHealth.disabled = running;
  }
}

function clearTimeline() {
  elements.timeline.replaceChildren();
  elements.log.textContent = "No diagnostics yet.";
  elements.roundMetric.textContent = "—";
  elements.fileMetric.textContent = "—";
  elements.tokenMetric.textContent = "—";
}

function addEvent({ agent, body, title, time = Date.now(), verdict }) {
  const item = document.createElement("li");
  if (agent) item.classList.add(agent);
  const top = document.createElement("div");
  top.className = "event-top";
  const heading = document.createElement("strong");
  heading.textContent = title;
  const timestamp = document.createElement("time");
  timestamp.textContent = new Date(time).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
  top.append(heading);
  if (verdict) {
    const verdictLabel = document.createElement("span");
    verdictLabel.className = "event-verdict";
    verdictLabel.textContent = verdict;
    top.append(verdictLabel);
  }
  top.append(timestamp);
  item.append(top);
  if (body) {
    const content = document.createElement("pre");
    content.className = "event-body";
    content.textContent = body;
    item.append(content);
  }
  elements.timeline.append(item);
  elements.timeline.scrollTop = elements.timeline.scrollHeight;
}

function appendLog(agent, message) {
  const previous = elements.log.textContent === "No diagnostics yet." ? "" : elements.log.textContent;
  elements.log.textContent = `${previous}${previous ? "\n" : ""}[${agent}] ${message}`.slice(-12_000);
}

function finishRun(payload) {
  setRunning(false);
  const state = payload.status === "completed" ? "completed" : payload.status === "blocked" ? "blocked" : "stopped";
  const reason = String(payload.reason || "unknown_reason");
  const titles = {
    completed: "Review passed",
    blocked: "Needs your decision",
    stopped: "Stopped safely"
  };
  setRunState(state, titles[state]);
  elements.fileMetric.textContent = String(payload.changedFiles?.length ?? 0);
  elements.formMessage.textContent = payload.status === "completed"
    ? "Review passed. Apply or discard the isolated changes above."
    : `Stopped: ${reason.replaceAll("_", " ")}`;
  addEvent({
    body: String(payload.detail || reason),
    title: titles[state]
  });
  refreshWorkspaces();
}

window.duet.onEvent((event) => {
  const payload = event.payload || {};
  if (event.type === "phase") {
    setRunState("running", payload.message);
    addEvent({ body: payload.message, title: payload.name || "Phase", time: event.time });
  } else if (event.type === "preflight") {
    addEvent({
      body: `${payload.root}\nChanges are isolated until you choose Apply.`,
      title: "Preflight passed",
      time: event.time
    });
  } else if (event.type === "agent") {
    elements.roundMetric.textContent = String(payload.round);
    addEvent({
      agent: payload.agent,
      body: payload.text,
      title: payload.agent === "codex" ? "Codex" : "Claude review",
      time: event.time,
      verdict: payload.verdict
    });
  } else if (event.type === "verification") {
    const result = payload.result;
    addEvent({
      body: result ? `Exit ${result.code}\n${result.stdout || result.stderr || "No output."}` : "No explicit command configured.",
      title: result?.code === 0 ? "Verification passed" : result ? "Verification failed" : "Verification skipped",
      time: event.time
    });
  } else if (event.type === "metrics") {
    elements.roundMetric.textContent = String(payload.round);
    elements.fileMetric.textContent = String(payload.changedFiles);
    elements.tokenMetric.textContent = `≈${Number(payload.estimatedHandoffTokens).toLocaleString()}`;
  } else if (event.type === "log") {
    appendLog(payload.agent, payload.message);
  } else if (event.type === "retry") {
    addEvent({
      body: `${payload.code} · retry ${payload.attempt + 1}/${payload.maxAttempts} after ${payload.delayMs} ms`,
      title: "Transient review failure",
      time: event.time
    });
  } else if (event.type === "warning") {
    addEvent({
      body: `${payload.message}\nCode: ${payload.code} · Category: ${payload.category}`,
      title: "Cleanup warning",
      time: event.time
    });
  } else if (event.type === "finish") {
    finishRun(payload);
  } else if (event.type === "error") {
    setRunning(false);
    setRunState("error", "Run failed");
    elements.formMessage.textContent = payload.message;
    addEvent({
      body: `${payload.message}\nCode: ${payload.code} · Category: ${payload.category}`,
      title: "Error",
      time: event.time
    });
    refreshWorkspaces();
  } else if (event.type === "history-saved") {
    refreshHistory();
  } else if (event.type === "history-error") {
    elements.historyStatus.textContent = payload.message;
  } else if (event.type === "recovery-error") {
    elements.workspacePanel.classList.remove("hidden");
    elements.workspaceStatus.textContent = payload.message;
  }
});

elements.chooseProject.addEventListener("click", async () => {
  const path = await window.duet.selectProject();
  if (path) elements.projectPath.value = path;
});

elements.cancel.addEventListener("click", async () => {
  elements.cancel.disabled = true;
  elements.formMessage.textContent = "Stopping child processes safely…";
  await window.duet.cancel();
});

elements.refreshHealth.addEventListener("click", refreshHealth);
elements.historyList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-history-id]");
  if (button) showHistoryReceipt(button.dataset.historyId);
});
elements.workspaceList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-workspace-action]");
  if (!button) return;
  if (button.dataset.workspaceAction === "diff") {
    showWorkspaceDiff(button.dataset.workspaceId);
  } else {
    runWorkspaceAction(button.dataset.workspaceAction, button.dataset.workspaceId);
  }
});

elements.copyDiagnostics.addEventListener("click", async () => {
  elements.copyDiagnostics.disabled = true;
  const diagnostics = [
    `Duet run state: ${elements.runState.textContent}`,
    `Codex: ${elements.codexDetail.textContent}`,
    `Claude Code: ${elements.claudeDetail.textContent}`,
    "",
    elements.log.textContent
  ].join("\n");
  try {
    const result = await window.duet.copyText(diagnostics);
    elements.copyStatus.textContent = `Copied ${result.copied.toLocaleString()} characters.`;
  } catch (error) {
    elements.copyStatus.textContent = error.message;
  } finally {
    elements.copyDiagnostics.disabled = false;
  }
});

elements.openSettings.addEventListener("click", async () => {
  if (!settings) await refreshSettings();
  if (!settings || elements.settingsDialog.open) return;
  applySettings(settings);
  elements.settingsStatus.textContent = "";
  elements.settingsDialog.showModal();
});

document.querySelector("#close-settings").addEventListener("click", () => {
  elements.settingsDialog.close();
});

elements.settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  elements.settingsStatus.textContent = "Saving…";
  try {
    const saved = await window.duet.updateSettings({
      maxMinutes: elements.settingsMaxMinutes.value,
      maxRounds: elements.settingsMaxRounds.value,
      reviewModel: elements.settingsReviewModel.value,
      verificationCommand: elements.settingsVerification.value
    });
    applySettings(saved);
    elements.settingsDialog.close();
    elements.formMessage.textContent = "Run defaults saved locally.";
  } catch (error) {
    elements.settingsStatus.textContent = error.message;
  }
});

document.querySelector("#reset-settings").addEventListener("click", async () => {
  elements.settingsStatus.textContent = "Resetting…";
  try {
    const reset = await window.duet.resetSettings();
    applySettings(reset);
    elements.settingsStatus.textContent = "Safe defaults restored.";
  } catch (error) {
    elements.settingsStatus.textContent = error.message;
  }
});

document.querySelector("#finish-onboarding").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  elements.onboardingStatus.textContent = "Saving local preference…";
  try {
    const saved = await window.duet.updateSettings({ onboardingComplete: true });
    applySettings(saved);
    elements.onboardingDialog.close();
    elements.chooseProject.focus();
  } catch (error) {
    elements.onboardingStatus.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

elements.onboardingDialog.addEventListener("cancel", (event) => {
  if (!settings?.onboardingComplete) event.preventDefault();
});

elements.onboardingDialog.addEventListener("close", () => {
  if (settings?.onboardingComplete) return;
  queueMicrotask(() => {
    if (!elements.onboardingDialog.open) elements.onboardingDialog.showModal();
  });
});

document.querySelector("#close-diff").addEventListener("click", () => {
  elements.diffDialog.close();
});
elements.task.addEventListener("input", () => {
  elements.taskCount.textContent = `${elements.task.value.length.toLocaleString()} / 12,000`;
});

elements.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (running) return;
  if (!elements.projectPath.value) {
    elements.formMessage.textContent = "Choose a Git repository first.";
    return;
  }
  clearTimeline();
  setRunning(true);
  elements.cancel.disabled = false;
  setRunState("running", "Starting local CLIs…");
  elements.formMessage.textContent = "The app will stop on pass, no progress, repeated findings, cancel, or your selected ceilings.";
  const data = new FormData(elements.form);
  try {
    await window.duet.start(Object.fromEntries(data.entries()));
  } catch (error) {
    setRunning(false);
    setRunState("error", "Could not start");
    elements.formMessage.textContent = error.message;
  }
});

Promise.all([
  refreshHealth(),
  refreshHistory(),
  refreshSettings(),
  refreshWorkspaces()
]);
