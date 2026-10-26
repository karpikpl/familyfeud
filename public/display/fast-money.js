/* global playReveal, flashBuzz, escapeHtml */
const fastDisplay = {
  panel: document.getElementById("fast-money"),
  subtitle: document.getElementById("fm-display-subtitle"),
  holding: document.getElementById("fm-display-holding"),
  message: document.getElementById("fm-display-message"),
  hint: document.getElementById("fm-display-hint"),
  results: document.getElementById("fm-display-results"),
  board: document.getElementById("fm-display-board"),
  outcome: document.getElementById("fm-display-outcome"),
  total: document.getElementById("fm-display-total"),
};
let previousFastMoney = null;
let previousFastMode = false;

function renderFastMoneyDisplay(state) {
  const active = state.mode === "fast_money";
  const fm = state.fastMoney;
  fastDisplay.panel.hidden = !active;
  if (!fm) return;
  if (active && previousFastMode && previousFastMoney) {
    if (fm.buzzFlash > previousFastMoney.buzzFlash) flashBuzz();
    fm.answers.forEach((answers, player) => answers.forEach((answer, i) => {
      if (answer.revealed && !previousFastMoney.answers[player][i].revealed) playReveal();
    }));
  }
  previousFastMoney = fm;
  previousFastMode = active;
  if (!active) return;
  const showingResults = ["reveal", "finished"].includes(fm.phase);
  fastDisplay.results.hidden = !showingResults;
  fastDisplay.holding.hidden = showingResults;
  fastDisplay.subtitle.textContent = fm.phase === "finished" ? "FINAL RESULTS" : `PLAYER ${fm.player + 1}`;
  fastDisplay.message.textContent = fm.phase === "asking" ? "ON THE CLOCK" : fm.phase === "scoring" ? "SURVEY SAYS..." : "GET READY";
  fastDisplay.hint.textContent = fm.phase === "asking"
    ? "Five questions. Give your best answers."
    : fm.phase === "scoring" ? "Answers coming up next." : `${fm.player === 0 ? 20 : 25} seconds · 200 points to win`;
  fastDisplay.board.replaceChildren(...Array.from({ length: 5 }, (_, i) => {
    const row = document.createElement("div");
    row.className = "fast-money__row";
    row.innerHTML = `<span class="fast-money__number">${i + 1}</span>` + fm.answers.map((answers, player) => {
      const answer = answers[i];
      const visible = showingResults && answer.revealed && (player === 0 || fm.player === 1);
      const missed = visible && answer.result === "miss";
      return `<div class="fast-money__answer${visible ? " is-revealed" : ""}${missed ? " is-miss" : ""}">
        ${missed ? '<strong class="fast-money__miss" aria-label="Miss, zero points">X</strong>' : `
          <span>${visible ? escapeHtml(answer.result === "pass" ? "PASS" : answer.text) : ""}</span>
          <strong>${visible ? answer.points : ""}</strong>
        `}
      </div>`;
    }).join("");
    return row;
  }));
  const total = fm.answers.flat().reduce((sum, a) => sum + (a.revealed ? a.points : 0), 0);
  fastDisplay.total.textContent = showingResults ? total : 0;
  fastDisplay.outcome.textContent = fm.phase === "finished"
    ? (total >= 200 ? "FAST MONEY WIN!" : "FINAL TOTAL") : "TOTAL";
  fastDisplay.panel.classList.toggle("is-won", fm.phase === "finished" && total >= 200);
}
