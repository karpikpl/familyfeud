/* global send, lastState, escapeHtml */
const fmEls = {
  player: document.getElementById("fm-player"),
  phase: document.getElementById("fm-phase"),
  timer: document.getElementById("fm-timer"),
  hint: document.getElementById("fm-hint"),
  setup: document.getElementById("fm-setup"),
  asking: document.getElementById("fm-asking"),
  scoring: document.getElementById("fm-scoring"),
  revealing: document.getElementById("fm-revealing"),
  questions: document.getElementById("fm-question-list"),
  start: document.getElementById("fm-start"),
  timeInputs: [0, 1].map((player) => document.getElementById(`fm-seconds-${player}`)),
  questionNumber: document.getElementById("fm-question-number"),
  question: document.getElementById("fm-current-question"),
  priorAnswer: document.getElementById("fm-prior-answer"),
  prev: document.getElementById("fm-prev"),
  next: document.getElementById("fm-next"),
  pass: document.getElementById("fm-pass"),
  buzz: document.getElementById("fm-buzz"),
  stop: document.getElementById("fm-stop"),
  responses: document.getElementById("fm-responses"),
  saveAnswers: document.getElementById("fm-save-answers"),
  beginReveal: document.getElementById("fm-begin-reveal"),
  summary: document.getElementById("fm-summary"),
  total: document.getElementById("fm-total"),
  revealNext: document.getElementById("fm-reveal-next"),
  nextPlayer: document.getElementById("fm-next-player"),
  edit: document.getElementById("fm-edit"),
  reset: document.getElementById("fm-reset"),
};
let fmFormKey = "";

function renderFastMoney(state) {
  const fm = state.fastMoney;
  if (!fm) return;
  fmEls.player.textContent = `Player ${fm.player + 1}`;
  fmEls.phase.textContent = { setup: "Ready", asking: "Questions", scoring: "Enter answers", reveal: "Reveal", finished: "Finished" }[fm.phase];
  fmEls.hint.textContent = fm.phase === "asking"
    ? "Next marks the question answered. Pass leaves it pending. Passed questions repeat after the first five until answered or time runs out. The recorder writes down the answers."
    : fm.player === 0
      ? "Keep Player 2 out of earshot during Player 1's questions and reveals."
      : "Player 1's results stay hidden on TV until Player 2's reveal. Duplicate survey answers are not allowed.";
  fmEls.setup.hidden = fm.phase !== "setup";
  fmEls.asking.hidden = fm.phase !== "asking";
  fmEls.scoring.hidden = fm.phase !== "scoring";
  fmEls.revealing.hidden = !["reveal", "finished"].includes(fm.phase);
  fmEls.questions.replaceChildren(...fm.questions.map((q) => {
    const li = document.createElement("li");
    li.textContent = q.text;
    return li;
  }));
  fmEls.timeInputs.forEach((input, player) => {
    input.disabled = fm.phase !== "setup";
    if (document.activeElement !== input) input.value = String(fm.playerSeconds[player]);
  });
  fmEls.start.textContent = `Start Player ${fm.player + 1} · ${fm.playerSeconds[fm.player]}s`;
  fmEls.nextPlayer.textContent = `Prepare Player 2 · ${fm.playerSeconds[1]}s`;
  const statuses = fm.questionStatus?.[fm.player] ?? [];
  const remaining = statuses.filter((status) => status !== "answered").length;
  const revisiting = statuses[fm.questionIndex] === "passed";
  fmEls.questionNumber.textContent = `Question ${fm.questionIndex + 1} / 5${revisiting ? " · Passed" : ""} · ${remaining} remaining`;
  fmEls.question.textContent = fm.questions[fm.questionIndex]?.text ?? "Select a CSV first.";
  fmEls.priorAnswer.hidden = fm.player !== 1;
  fmEls.priorAnswer.textContent = fm.player === 1
    ? `Player 1 answered: ${fm.answers[0][fm.questionIndex].text}. Do not accept a duplicate.` : "";
  fmEls.next.textContent = "Next";
  fmEls.buzz.hidden = fm.player !== 1;

  const formKey = JSON.stringify([fm.player, fm.questions]);
  if (formKey !== fmFormKey) {
    fmFormKey = formKey;
    fmEls.responses.replaceChildren(...fm.questions.map((q, i) => createFastMoneyForm(q, i)));
  }
  fm.answers[fm.player].forEach((answer, i) => {
    const form = document.getElementById(`fm-response-${i}`);
    if (!form) return;
    const snapshot = JSON.stringify(answer);
    const input = readFastMoneyForm(form);
    const survey = input.answerIndex === null ? null : fm.questions[i].answers[input.answerIndex];
    const matchesSaved = answer.recorded &&
      answer.result === input.result &&
      answer.text === (input.result === "pass" ? "Pass" : input.text.trim() || survey?.text || "Miss") &&
      answer.answerIndex === input.answerIndex && answer.points === (survey?.points ?? input.points);
    if (fm.phase !== "scoring" || matchesSaved) delete form.dataset.dirty;
    if (form.dataset.dirty !== "true" && form.dataset.snapshot !== snapshot && !form.contains(document.activeElement)) {
      form.elements.text.value = answer.text;
      form.elements.match.value = answer.result === "pass" || answer.result === "miss"
        ? answer.result : answer.answerIndex === null ? "" : String(answer.answerIndex);
      form.elements.points.value = String(answer.points);
      form.dataset.snapshot = snapshot;
    }
    form.elements.points.disabled = form.elements.match.value !== "";
    form.elements.text.disabled = form.elements.match.value === "pass";
    form.querySelector(".fm-response__status").textContent = form.dataset.dirty === "true"
      ? "Unsaved changes" : answer.recorded ? `Saved · ${answer.points} points` : "Not saved";
  });
  fmEls.beginReveal.disabled = !fm.answers[fm.player].every((a) => a.recorded) ||
    Boolean(fmEls.responses.querySelector('[data-dirty="true"]'));
  const total = fm.answers.flat().reduce((sum, a) => sum + (a.revealed ? a.points : 0), 0);
  const allRevealed = fm.answers[fm.player].every((a) => a.revealed);
  fmEls.total.textContent = String(total);
  fmEls.revealNext.hidden = fm.phase === "finished";
  fmEls.revealNext.disabled = allRevealed;
  fmEls.nextPlayer.hidden = fm.player !== 0 || !allRevealed;
  fmEls.summary.textContent = fm.phase === "finished"
    ? (total >= 200 ? "Fast Money win! 200 points reached." : `Fast Money complete · ${total} points`)
    : `Reveal Player ${fm.player + 1}'s answers one at a time`;
  updateFastMoneyTimer(state);
}

function createFastMoneyForm(question, index) {
  const form = document.createElement("form");
  form.id = `fm-response-${index}`;
  form.className = "fm-response";
  form.innerHTML = `
    <div class="fm-response__question">${index + 1}. ${escapeHtml(question.text)}</div>
    ${lastState.fastMoney.player === 1 ? `<div class="game-controls__hint">Player 1: ${escapeHtml(lastState.fastMoney.answers[0][index].text)}</div>` : ""}
    <label>Answer result / Survey match
      <select name="match" id="fm-match-${index}">
        <option value="">Custom answer and points</option>
        <option value="pass">Pass · 0 points</option>
        <option value="miss">Miss · 0 points · X on reveal</option>
        ${question.answers.map((a, i) => `<option value="${i}">${escapeHtml(a.text)} · ${a.points} points</option>`).join("")}
      </select>
    </label>
    <label>Player's answer <input name="text" id="fm-text-${index}" maxlength="200" autocomplete="off" /></label>
    <label>Points <input name="points" id="fm-points-${index}" type="number" min="0" max="100" step="1" value="0" required /></label>
    <span class="fm-response__status">Not saved</span>
  `;
  form.elements.match.onchange = () => {
    const choice = form.elements.match.value;
    const matched = choice !== "" && choice !== "pass" && choice !== "miss";
    form.elements.points.disabled = choice !== "";
    form.elements.text.disabled = choice === "pass";
    if (matched) {
      const answer = question.answers[Number(form.elements.match.value)];
      form.elements.text.value = answer.text;
      form.elements.points.value = String(answer.points);
    } else {
      form.elements.points.value = "0";
      if (choice === "pass") form.elements.text.value = "Pass";
      else if (form.elements.text.value === "Pass") form.elements.text.value = "";
    }
  };
  const markDirty = () => {
    form.dataset.dirty = "true";
    form.querySelector(".fm-response__status").textContent = "Unsaved changes";
    fmEls.beginReveal.disabled = true;
  };
  form.addEventListener("input", markDirty);
  form.addEventListener("change", markDirty);
  form.onsubmit = (event) => {
    event.preventDefault();
    saveFastMoneyAnswers();
  };
  return form;
}

function readFastMoneyForm(form) {
  const choice = form.elements.match.value;
  const matched = choice !== "" && choice !== "pass" && choice !== "miss";
  const points = Number(form.elements.points.value);
  const text = form.elements.text.value;
  return {
    text,
    answerIndex: matched ? Number(choice) : null,
    points,
    result: choice === "pass" || choice === "miss" ? choice :
      matched || points > 0 ? "answer" : text.trim() && text.trim() !== "Pass" ? "miss" : "pass",
  };
}

function saveFastMoneyAnswers() {
  const forms = Array.from(fmEls.responses.querySelectorAll("form"));
  for (const form of forms) {
    if (!form.reportValidity()) return;
  }
  send({ type: "fm_answers", answers: forms.map(readFastMoneyForm) });
}

function updateFastMoneyTimer(state) {
  const fm = state?.fastMoney;
  if (!fm) return;
  fmEls.start.disabled = fm.phase !== "setup" || fm.questions.length !== 5 ||
    fmEls.timeInputs.some((input) => !input.validity.valid);
  const seconds = fm.endsAt === null
    ? fm.playerSeconds[fm.player]
    : Math.max(0, Math.ceil((fm.endsAt - Date.now()) / 1000));
  fmEls.timer.textContent = fm.phase === "asking" || fm.phase === "setup"
    ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}` : "—";
  const expired = fm.phase === "asking" && seconds === 0;
  fmEls.prev.disabled = fm.questionIndex === 0 || expired;
  fmEls.next.disabled = expired;
  fmEls.pass.disabled = expired;
  fmEls.stop.textContent = expired ? "Time's up · Enter answers" : "Finish questions / Enter answers";
}

fmEls.timeInputs.forEach((input, player) => {
  input.oninput = () => {
    updateFastMoneyTimer(lastState);
  };
  input.onchange = () => {
    if (input.reportValidity()) send({ type: "fm_set_time", player, seconds: input.valueAsNumber });
  };
});
fmEls.start.onclick = () => {
  if (fmEls.timeInputs.every((input) => input.reportValidity())) send({ type: "fm_start" });
};
fmEls.prev.onclick = () => send({ type: "fm_question", index: lastState.fastMoney.questionIndex - 1 });
fmEls.next.onclick = () => send({ type: "fm_next" });
fmEls.buzz.onclick = () => send({ type: "fm_buzz" });
fmEls.pass.onclick = () => send({ type: "fm_pass" });
fmEls.stop.onclick = () => send({ type: "fm_stop" });
fmEls.saveAnswers.onclick = saveFastMoneyAnswers;
fmEls.beginReveal.onclick = () => send({ type: "fm_begin_reveal" });
fmEls.revealNext.onclick = () => send({ type: "fm_reveal_next" });
fmEls.nextPlayer.onclick = () => send({ type: "fm_next_player" });
fmEls.edit.onclick = () => send({ type: "fm_edit_answers" });
fmEls.reset.onclick = () => {
  if (confirm("Reset Fast Money answers and timers? Standard team scores are kept.")) send({ type: "fm_reset" });
};
