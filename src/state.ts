import { GameMode, GameState, Question, Round } from "./types";
import { isValidFastMoneySeconds, makeFastMoney } from "./fast-money";

export function makeInitialState(questions: Question[], questionFile: string | null = null): GameState {
  return {
    mode: "standard",
    questionFile,
    fastMoney: makeFastMoney(),
    gameOver: false,
    teams: [
      { name: "Team 1", score: 0 },
      { name: "Team 2", score: 0 },
    ],
    questions: cloneQuestions(questions),
    currentQuestionIndex: questions.length > 0 ? 0 : -1,
    round: { kind: "idle" },
    reveal: { questionVisible: false },
    audio: { muted: false, themePlaying: true, themeVolume: 0.7 },
    instructions: { visible: false, page: 0, total: INSTRUCTIONS_TOTAL },
    timer: { endsAt: null },
    lastAward: null,
  };
}

export const INSTRUCTIONS_TOTAL = 4;

export function migrateState(state: GameState, defaultQuestionFile: string | null = null): GameState {
  // Backfill blocks for states persisted before these fields existed.
  if (!state.mode) state.mode = "standard";
  if (!state.questionFile) state.questionFile = defaultQuestionFile;
  if (!state.fastMoney) state.fastMoney = makeFastMoney();
  const playerSeconds = state.fastMoney.playerSeconds;
  state.fastMoney.playerSeconds = [
    isValidFastMoneySeconds(playerSeconds?.[0]) ? playerSeconds[0] : 20,
    isValidFastMoneySeconds(playerSeconds?.[1]) ? playerSeconds[1] : 25,
  ];
  for (const answer of state.fastMoney.answers.flat()) {
    if (!answer.result) {
      answer.result = answer.recorded && answer.text === "Pass"
        ? "pass" : answer.recorded && answer.points === 0 ? "miss" : "answer";
    }
  }
  if (!state.fastMoney.questionStatus) {
    const fm = state.fastMoney;
    const statuses = (player: 0 | 1): typeof fm.questionStatus[0] =>
      fm.answers[player].map((answer, i) => {
        if (answer.recorded) return answer.text === "Pass" ? "passed" : "answered";
        return player === fm.player && fm.phase === "asking" && i < fm.questionIndex ? "answered" : "unasked";
      });
    fm.questionStatus = [statuses(0), statuses(1)];
  }
  if (typeof state.gameOver !== "boolean") {
    state.gameOver = false;
  }
  if (!state.audio) {
    state.audio = { muted: false, themePlaying: true, themeVolume: 0.7 };
  } else if (typeof state.audio.themeVolume !== "number") {
    state.audio.themeVolume = 0.7;
  }
  if (!state.instructions) {
    state.instructions = { visible: false, page: 0, total: INSTRUCTIONS_TOTAL };
  } else {
    state.instructions.total = INSTRUCTIONS_TOTAL;
  }
  if (state.round.kind === "playing" && typeof (state.round as { buzzFlash?: number }).buzzFlash !== "number") {
    state.round.buzzFlash = 0;
  }
  if (state.round.kind === "playing" && typeof (state.round as { locked?: boolean }).locked !== "boolean") {
    state.round.locked = false;
  }
  if (typeof state.lastAward === "undefined") {
    state.lastAward = null;
  }
  if (!state.timer) {
    state.timer = { endsAt: null };
  }
  return state;
}

export function startTimer(state: GameState, now = Date.now()): void {
  state.timer.endsAt = now + 10_000;
}

export function hideTimer(state: GameState): void {
  state.timer.endsAt = null;
}

export function expireTimer(state: GameState, now = Date.now()): boolean {
  if (state.timer.endsAt === null || now < state.timer.endsAt + 3_000) return false;
  hideTimer(state);
  return true;
}

export function setMode(state: GameState, mode: GameMode): void {
  if (mode !== "standard" && mode !== "fast_money") throw new Error("Invalid game mode.");
  if (state.mode === mode) return;
  if (state.fastMoney.phase === "asking") {
    state.fastMoney.phase = "scoring";
    state.fastMoney.endsAt = null;
  }
  hideTimer(state);
  state.instructions.visible = false;
  state.mode = mode;
}

export function setQuestions(state: GameState, questions: Question[], filename: string): void {
  state.questions = cloneQuestions(questions);
  state.questionFile = filename;
  state.currentQuestionIndex = questions.length ? 0 : -1;
  endRound(state);
  hideTimer(state);
  state.gameOver = false;
}

export function endGame(state: GameState): void {
  state.gameOver = true;
  hideTimer(state);
  state.instructions.visible = false;
}

export function resumeGame(state: GameState): void {
  state.gameOver = false;
}

export function cloneQuestions(questions: Question[]): Question[] {
  return questions.map((q) => ({
    ...q,
    answers: q.answers.map((a) => ({ ...a, revealed: false })),
  }));
}

export function currentQuestion(state: GameState): Question | null {
  if (state.currentQuestionIndex < 0) return null;
  return state.questions[state.currentQuestionIndex] ?? null;
}

export function startRound(state: GameState): void {
  const q = currentQuestion(state);
  if (!q) return;
  // reset answer reveals for this question
  for (const a of q.answers) a.revealed = false;
  state.round = {
    kind: "playing",
    questionId: q.id,
    pot: 0,
    strikes: 0,
    strikeFlash: 0,
    buzzFlash: 0,
    controllingTeam: null,
    locked: false,
  };
  state.reveal.questionVisible = true;
  state.lastAward = null;
}

export function addBuzz(state: GameState): void {
  if (state.round.kind !== "playing") return;
  state.round.buzzFlash += 1;
}

export function revealAnswer(state: GameState, index: number): void {
  const q = currentQuestion(state);
  if (!q || state.round.kind !== "playing") return;
  const a = q.answers[index];
  if (!a || a.revealed) return;
  a.revealed = true;
  // Once the pot is awarded (locked), revealing leftovers is for show only —
  // don't re-grow the pot, or a subsequent re-award would over-pay.
  if (!state.round.locked) state.round.pot += a.points;
}

export function unrevealAnswer(state: GameState, index: number): void {
  const q = currentQuestion(state);
  if (!q || state.round.kind !== "playing") return;
  const a = q.answers[index];
  if (!a || !a.revealed) return;
  a.revealed = false;
  if (!state.round.locked) state.round.pot = Math.max(0, state.round.pot - a.points);
}

export function addStrike(state: GameState): void {
  if (state.round.kind !== "playing") return;
  if (state.round.strikes < 3) {
    state.round.strikes = (state.round.strikes + 1) as 0 | 1 | 2 | 3;
  }
  state.round.strikeFlash += 1;
  // 3 strikes = round decided. Freeze the pot so leftover-answer reveals (for show)
  // don't inflate the eventual award.
  if (state.round.strikes === 3) state.round.locked = true;
}

export function clearStrikes(state: GameState): void {
  if (state.round.kind !== "playing") return;
  state.round.strikes = 0;
  // If strikes were cleared (e.g. mis-tap), reverse the 3-strike auto-lock too —
  // but only when the pot hasn't been awarded yet (no lastAward outstanding).
  if (!state.lastAward) state.round.locked = false;
}

export function awardPotToTeam(state: GameState, team: 0 | 1): number {
  if (state.round.kind !== "playing") return 0;
  const pot = state.round.pot;
  state.teams[team].score += pot;
  state.round.pot = 0;
  state.round.locked = true;
  state.lastAward = { team, amount: pot };
  return pot;
}

export function undoLastAward(state: GameState): void {
  const last = state.lastAward;
  if (!last) return;
  state.teams[last.team].score = Math.max(0, state.teams[last.team].score - last.amount);
  if (state.round.kind === "playing") {
    state.round.pot += last.amount;
    state.round.locked = false;
  }
  state.lastAward = null;
}

export function adjustScore(state: GameState, team: 0 | 1, delta: number): void {
  state.teams[team].score = Math.max(0, state.teams[team].score + delta);
}

export function setTeamName(state: GameState, team: 0 | 1, name: string): void {
  state.teams[team].name = name.trim() || `Team ${team + 1}`;
}

export function setControllingTeam(state: GameState, team: 0 | 1 | null): void {
  if (state.round.kind !== "playing") return;
  state.round.controllingTeam = team;
}

export function endRound(state: GameState): void {
  state.round = { kind: "idle" };
  state.reveal.questionVisible = false;
  state.lastAward = null;
}

export function gotoQuestion(state: GameState, index: number): void {
  if (index < 0 || index >= state.questions.length) return;
  state.currentQuestionIndex = index;
  state.round = { kind: "idle" };
  state.reveal.questionVisible = false;
  state.lastAward = null;
  // reset reveals on the new question
  const q = state.questions[index];
  for (const a of q.answers) a.revealed = false;
}

export function nextQuestion(state: GameState): void {
  if (state.currentQuestionIndex + 1 < state.questions.length) {
    gotoQuestion(state, state.currentQuestionIndex + 1);
  }
}

export function prevQuestion(state: GameState): void {
  if (state.currentQuestionIndex > 0) {
    gotoQuestion(state, state.currentQuestionIndex - 1);
  }
}

export function resetGame(state: GameState, questions: Question[]): GameState {
  const fresh = makeInitialState(questions, state.questionFile);
  fresh.fastMoney = makeFastMoney(state.fastMoney.questions, state.fastMoney.questionFile, state.fastMoney.playerSeconds);
  return fresh;
}

export function setRound(state: GameState, round: Round): void {
  state.round = round;
}
