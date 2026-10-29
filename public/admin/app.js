/* global io, renderFastMoney, updateFastMoneyTimer */
const socket = io();

const els = {
  conn: document.getElementById("conn"),
  modeStandard: document.getElementById("mode-standard"),
  modeFastMoney: document.getElementById("mode-fast-money"),
  questionFile: document.getElementById("question-file"),
  questionFileLabel: document.getElementById("question-file-label"),
  questionFileHint: document.getElementById("question-file-hint"),
  refreshFiles: document.getElementById("refresh-files"),
  reload: document.getElementById("reload"),
  reset: document.getElementById("reset"),
  endGame: document.getElementById("end-game"),
  resumeGame: document.getElementById("resume-game"),
  gameStatus: document.getElementById("game-status"),
  gameResultSummary: document.getElementById("game-result-summary"),
  mute: document.getElementById("mute"),
  theme: document.getElementById("theme"),
  startTimer: document.getElementById("start-timer"),
  hideTimer: document.getElementById("hide-timer"),
  timerStatus: document.getElementById("timer-status"),
  insToggle: document.getElementById("ins-toggle"),
  insPrev: document.getElementById("ins-prev"),
  insNext: document.getElementById("ins-next"),
  insPage: document.getElementById("ins-page"),
  insChips: document.querySelectorAll(".ins-chip"),
  vol: document.getElementById("vol"),
  volNum: document.getElementById("vol-num"),
  volPresets: document.querySelectorAll(".vol-preset"),
  scoreA: document.getElementById("score-0"),
  scoreB: document.getElementById("score-1"),
  nameInputs: document.querySelectorAll(".team__name"),
  nameRefs: document.querySelectorAll(".team-name-ref"),
  prevQ: document.getElementById("prev-q"),
  nextQ: document.getElementById("next-q"),
  gotoQ: document.getElementById("goto-q"),
  qmeta: document.getElementById("qmeta"),
  potDisplay: document.getElementById("pot-display"),
  roundQuestion: document.getElementById("round-question"),
  showQ: document.getElementById("show-q"),
  startRound: document.getElementById("start-round"),
  endRound: document.getElementById("end-round"),
  strike: document.getElementById("strike"),
  buzz: document.getElementById("buzz"),
  clearStrikes: document.getElementById("clear-strikes"),
  strikesPill: document.getElementById("strikes-pill"),
  answers: document.getElementById("answers"),
  csvInfo: document.getElementById("csv-info"),
  undoAward: document.getElementById("undo-award"),
  undoAwardSection: document.getElementById("undo-award-section"),
};

let lastState = null;
let nameEditing = [false, false];
let volEditing = false;
let csvFiles = [];
let questionListKey = "";

function send(cmd) { socket.emit("cmd", cmd); }

function render(state) {
  lastState = state;
  const fast = state.mode === "fast_money";
  document.body.classList.toggle("fast-money-mode", fast);
  document.querySelectorAll("[data-mode]").forEach((el) => {
    el.hidden = el.dataset.mode !== (state.mode ?? "standard");
  });
  for (const [button, active] of [[els.modeStandard, !fast], [els.modeFastMoney, fast]]) {
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  els.reset.textContent = fast ? "Reset Fast Money" : "Reset Game";
  renderQuestionFiles();
  renderFastMoney(state);
  updateTimer();
  const finished = state.gameOver === true;
  els.endGame.hidden = finished;
  els.resumeGame.hidden = !finished;
  els.gameStatus.textContent = finished ? "Game over" : "In progress";
  const [left, right] = state.teams;
  els.gameResultSummary.textContent = finished
    ? (left.score === right.score ? `It's a tie! ${left.score} points each.`
      : `${left.score > right.score ? left.name : right.name} wins! Final score: ${left.score} - ${right.score}.`)
    : "Award the final pot before ending the game.";
  document.querySelectorAll('[data-act], .team__name, #prev-q, #next-q, #goto-q, #show-q, #undo-award').forEach((el) => {
    el.disabled = finished;
  });

  // Teams
  els.scoreA.textContent = state.teams[0].score;
  els.scoreB.textContent = state.teams[1].score;
  els.nameInputs.forEach((inp) => {
    const t = Number(inp.dataset.team);
    if (!nameEditing[t]) inp.value = state.teams[t].name;
  });
  els.nameRefs.forEach((s) => {
    s.textContent = state.teams[Number(s.dataset.team)].name;
  });

  // Question dropdown
  const listKey = JSON.stringify(state.questions.map((q) => [q.id, q.text]));
  if (questionListKey !== listKey) {
    questionListKey = listKey;
    els.gotoQ.innerHTML = "";
    state.questions.forEach((q, i) => {
      const o = document.createElement("option");
      o.value = String(i);
      o.textContent = `${i + 1}. ${truncate(q.text, 40)}`;
      els.gotoQ.appendChild(o);
    });
  }
  els.gotoQ.value = String(state.currentQuestionIndex);

  const q = state.questions[state.currentQuestionIndex];
  els.qmeta.textContent = q
    ? `Q ${state.currentQuestionIndex + 1} / ${state.questions.length} · ${q.answers.length} answers`
    : "no question";
  els.roundQuestion.textContent = q ? q.text : "—";

  const playing = state.round.kind === "playing";
  const locked = playing && state.round.locked;
  els.potDisplay.textContent = playing ? state.round.pot : 0;
  els.potDisplay.parentElement.classList.toggle("pot-locked", locked);
  els.potDisplay.parentElement.title = locked
    ? "Pot is locked — leftover reveals won't change it"
    : "";

  // Undo last award button — only visible when there's an award to undo.
  if (state.lastAward) {
    const teamName = state.teams[state.lastAward.team].name;
    els.undoAward.textContent = `↩ Undo award (${teamName} −${state.lastAward.amount})`;
    els.undoAwardSection.hidden = fast;
  } else {
    els.undoAwardSection.hidden = true;
  }
  els.strikesPill.textContent = playing ? state.round.strikes : 0;
  els.startRound.disabled = finished || playing || !q;
  els.endRound.disabled = finished || !playing;
  els.strike.disabled = finished || !playing;
  els.buzz.disabled = finished || !playing;
  els.clearStrikes.disabled = finished || !playing;
  els.showQ.textContent = state.reveal.questionVisible ? "Hide question on TV" : "Show question on TV";

  // Audio buttons
  els.mute.textContent = state.audio.muted ? "🔇 Muted" : "🔊";
  els.mute.classList.toggle("is-active", state.audio.muted);
  els.theme.textContent = state.audio.themePlaying ? "🎵 Theme: ON" : "🎵 Theme: OFF";
  els.theme.classList.toggle("is-active", state.audio.themePlaying);

  // Volume
  if (!volEditing) {
    const v = Math.round((state.audio.themeVolume ?? 0.7) * 100);
    els.vol.value = String(v);
    els.volNum.textContent = String(v);
  }
  els.volPresets.forEach((b) => {
    const want = Number(b.dataset.vol);
    const cur = Math.round((state.audio.themeVolume ?? 0.7) * 100);
    b.classList.toggle("is-active", want === cur);
  });

  // Instructions
  const ins = state.instructions;
  if (ins) {
    els.insToggle.textContent = ins.visible ? "Hide from TV" : "Show on TV";
    els.insToggle.classList.toggle("btn-primary", !ins.visible);
    els.insToggle.classList.toggle("btn-warn", ins.visible);
    els.insPage.textContent = `${ins.page + 1} / ${ins.total}`;
    els.insPrev.disabled = ins.page <= 0;
    els.insNext.disabled = ins.page >= ins.total - 1;
    els.insChips.forEach((b) => {
      b.classList.toggle("is-active", Number(b.dataset.insPage) === ins.page);
    });
  }

  // Control highlight
  document.querySelectorAll('[data-act="control"]').forEach((b) => {
    const t = b.dataset.team === "" ? null : Number(b.dataset.team);
    const active = playing && state.round.controllingTeam === t;
    b.classList.toggle("is-active", active);
  });

  // Answers
  els.answers.innerHTML = "";
  if (!q) {
    const empty = document.createElement("div");
    empty.className = "answers__empty";
    empty.textContent = "No question loaded. Drop a questions.csv in the project root and click Reload CSV.";
    els.answers.appendChild(empty);
    return;
  }
  q.answers.forEach((a, i) => {
    const row = document.createElement("div");
    row.className = "answer" + (a.revealed ? " revealed" : "");
    row.innerHTML = `
      <div class="answer__num">${i + 1}</div>
      <div class="answer__text">${escapeHtml(a.text)}</div>
      <div class="answer__pts">${a.points}</div>
    `;
    const btn = document.createElement("button");
    btn.className = "btn answer__btn " + (a.revealed ? "btn-ghost" : "btn-primary");
    btn.textContent = a.revealed ? "Hide" : "Reveal";
    btn.disabled = finished || !playing;
    btn.onclick = () =>
      send({ type: a.revealed ? "unreveal_answer" : "reveal_answer", index: i });
    row.appendChild(btn);
    els.answers.appendChild(row);
  });
}

function updateTimer() {
  updateFastMoneyTimer(lastState);
  const endsAt = lastState?.timer?.endsAt ?? null;
  const seconds = endsAt === null ? 0 : Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
  els.timerStatus.textContent = endsAt === null ? "Hidden" : `0:${String(seconds).padStart(2, "0")}`;
  els.startTimer.textContent = endsAt === null ? "Start 30s" : "Restart 30s";
  els.hideTimer.disabled = endsAt === null;
}
setInterval(updateTimer, 100);

function renderQuestionFiles() {
  if (!lastState) return;
  const fast = lastState.mode === "fast_money";
  const current = fast ? lastState.fastMoney?.questionFile : lastState.questionFile;
  const filenames = [...csvFiles];
  if (current && !filenames.includes(current)) filenames.push(current);
  const key = JSON.stringify(filenames);
  if (els.questionFile.dataset.files !== key) {
    els.questionFile.dataset.files = key;
    const placeholder = new Option("Select a CSV...", "");
    placeholder.disabled = true;
    els.questionFile.replaceChildren(placeholder, ...filenames.map((filename) => new Option(filename, filename)));
  }
  els.questionFile.value = current ?? "";
  els.questionFileLabel.textContent = fast ? "Fast Money question CSV" : "Standard question CSV";
  els.questionFileHint.textContent = fast
    ? "Uses the first five questions. Changing CSV resets Fast Money only; standard scores are kept."
    : "Changing the CSV clears the current round but keeps team names and scores.";
  const count = fast ? (lastState.fastMoney?.questions.length ?? 0) : lastState.questions.length;
  els.csvInfo.textContent = `${count} questions loaded · ${current ?? "No CSV selected"} · Add CSV files to the project root, then refresh the list.`;
}

function truncate(s, n) {
  s = String(s);
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Wire UI
function changeMode(mode) {
  if (lastState?.fastMoney?.phase === "asking" && mode !== lastState.mode &&
      !confirm("Switch modes? This stops the Fast Money timer and keeps both games' progress.")) return;
  send({ type: "set_mode", mode });
}
els.modeStandard.onclick = () => changeMode("standard");
els.modeFastMoney.onclick = () => changeMode("fast_money");
els.refreshFiles.onclick = () => socket.emit("list_csv_files");
els.questionFile.onchange = () => {
  const filename = els.questionFile.value;
  const mode = lastState?.mode ?? "standard";
  const warning = mode === "fast_money" ? "This resets Fast Money answers." : "This clears the current round and unawarded pot.";
  if (confirm(`Load ${filename}? ${warning} Team scores are kept.`)) send({ type: "select_csv", mode, filename });
  renderQuestionFiles();
};
els.endGame.onclick = () => {
  const pot = lastState?.round?.kind === "playing" ? lastState.round.pot : 0;
  const warning = pot > 0 ? ` The unawarded pot (${pot} points) will not count. Cancel to award it first.` : "";
  if (confirm("End the game and show the winner using the current team scores?" + warning)) {
    send({ type: "end_game" });
  }
};
els.resumeGame.onclick = () => send({ type: "resume_game" });
els.startTimer.onclick = () => send({ type: "start_timer" });
els.hideTimer.onclick  = () => send({ type: "hide_timer" });
els.startRound.onclick = () => send({ type: "start_round" });
els.endRound.onclick   = () => send({ type: "end_round" });
els.strike.onclick     = () => send({ type: "strike" });
els.buzz.onclick       = () => send({ type: "buzz" });
els.clearStrikes.onclick = () => send({ type: "clear_strikes" });
els.prevQ.onclick      = () => send({ type: "prev_question" });
els.nextQ.onclick      = () => send({ type: "next_question" });
els.gotoQ.onchange     = () => send({ type: "goto_question", index: Number(els.gotoQ.value) });
els.showQ.onclick      = () =>
  send({ type: "show_question", visible: !(lastState?.reveal?.questionVisible) });
els.reset.onclick      = () => {
  if (lastState?.mode === "fast_money") {
    if (confirm("Reset Fast Money answers and timers? Standard scores are kept.")) send({ type: "fm_reset" });
  } else if (confirm("Reset the whole game (scores + reveals)?")) send({ type: "reset_game" });
};
els.reload.onclick     = () => {
  if (confirm("Reload this mode's selected CSV? Current round progress is cleared; team scores are kept.")) {
    send({ type: "reload_csv" });
  }
};
els.mute.onclick       = () => send({ type: "set_muted", muted: !lastState?.audio?.muted });
els.theme.onclick      = () => send({ type: "set_theme_playing", playing: !lastState?.audio?.themePlaying });

els.vol.addEventListener("pointerdown", () => { volEditing = true; });
els.vol.addEventListener("pointerup",   () => { volEditing = false; });
els.vol.addEventListener("input", () => {
  const v = Number(els.vol.value);
  els.volNum.textContent = String(v);
  send({ type: "set_theme_volume", volume: v / 100 });
});
els.volPresets.forEach((b) => {
  b.onclick = () => send({ type: "set_theme_volume", volume: Number(b.dataset.vol) / 100 });
});

els.insToggle.onclick = () =>
  send({ type: "set_instructions_visible", visible: !lastState?.instructions?.visible });
els.insPrev.onclick = () =>
  send({ type: "set_instructions_page", page: (lastState?.instructions?.page ?? 0) - 1 });
els.insNext.onclick = () =>
  send({ type: "set_instructions_page", page: (lastState?.instructions?.page ?? 0) + 1 });
els.insChips.forEach((b) => {
  b.onclick = () => send({ type: "set_instructions_page", page: Number(b.dataset.insPage) });
});

document.querySelectorAll('[data-act="adjust"]').forEach((b) => {
  b.onclick = () =>
    send({ type: "adjust_score", team: Number(b.dataset.team), delta: Number(b.dataset.delta) });
});
document.querySelectorAll('[data-act="award"]').forEach((b) => {
  b.onclick = () => send({ type: "award_pot", team: Number(b.dataset.team) });
});
els.undoAward.onclick = () => send({ type: "undo_award" });
document.querySelectorAll('[data-act="control"]').forEach((b) => {
  b.onclick = () => {
    const t = b.dataset.team === "" ? null : Number(b.dataset.team);
    send({ type: "set_controlling_team", team: t });
  };
});

els.nameInputs.forEach((inp) => {
  const t = Number(inp.dataset.team);
  inp.addEventListener("focus", () => { nameEditing[t] = true; });
  inp.addEventListener("blur", () => {
    nameEditing[t] = false;
    if (!lastState?.gameOver) send({ type: "set_team_name", team: t, name: inp.value });
  });
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter") inp.blur(); });
});

// Connection status
socket.on("connect", () => { els.conn.textContent = "live"; els.conn.className = "conn ok"; });
socket.on("disconnect", () => { els.conn.textContent = "offline"; els.conn.className = "conn bad"; });
socket.on("csv_files", (files) => {
  csvFiles = files;
  renderQuestionFiles();
});
socket.on("state", render);
socket.on("error_msg", (m) => alert("Server error: " + m));
