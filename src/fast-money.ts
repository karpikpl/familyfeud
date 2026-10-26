import { FastMoneyAnswer, FastMoneyAnswerInput, FastMoneyPhase, FastMoneyResult, FastMoneyState, GameState, Question } from "./types";

export function makeFastMoney(questions: Question[] = [], questionFile: string | null = null): FastMoneyState {
  const blankAnswers = (): FastMoneyAnswer[] => Array.from({ length: 5 }, () => ({
    result: "answer", text: "", points: 0, answerIndex: null, recorded: false, revealed: false,
  }));
  return {
    questionFile,
    questions: questions.slice(0, 5).map((q) => ({
      ...q, answers: q.answers.map((a) => ({ ...a, revealed: false })),
    })),
    player: 0,
    phase: "setup",
    questionIndex: 0,
    questionStatus: [Array(5).fill("unasked"), Array(5).fill("unasked")],
    answers: [blankAnswers(), blankAnswers()],
    endsAt: null,
    buzzFlash: 0,
  };
}

function requirePhase(state: GameState, phases: FastMoneyPhase[]): FastMoneyState {
  if (state.mode !== "fast_money" || !phases.includes(state.fastMoney.phase)) {
    throw new Error("That action is not available in the current Fast Money stage.");
  }
  return state.fastMoney;
}

export function loadFastMoney(state: GameState, questions: Question[], filename: string): void {
  if (questions.length < 5) throw new Error("Fast Money needs a CSV with at least five questions.");
  if (questions.slice(0, 5).some((q) => q.answers.some((a) => a.points > 100))) {
    throw new Error("Fast Money survey points must be between 0 and 100.");
  }
  state.fastMoney = makeFastMoney(questions, filename);
}

export function startFastMoney(state: GameState, now = Date.now()): void {
  const fm = requirePhase(state, ["setup"]);
  if (fm.questions.length !== 5) throw new Error("Select a Fast Money CSV with five questions first.");
  fm.phase = "asking";
  fm.questionIndex = 0;
  fm.questionStatus[fm.player].fill("unasked");
  fm.endsAt = now + (fm.player === 0 ? 20_000 : 25_000);
}

export function gotoFastMoneyQuestion(state: GameState, index: number, now = Date.now()): void {
  const fm = requirePhase(state, ["asking"]);
  if (fm.endsAt === null || now >= fm.endsAt) throw new Error("Time is up. Enter the player's answers.");
  if (!Number.isInteger(index) || index < 0 || index >= 5) throw new Error("Invalid Fast Money question.");
  fm.questionIndex = index;
}

export function stopFastMoney(state: GameState): void {
  const fm = requirePhase(state, ["asking"]);
  fm.phase = "scoring";
  fm.endsAt = null;
}

export function passFastMoneyQuestion(state: GameState, now = Date.now()): void {
  advanceFastMoneyQuestion(state, true, now);
}

export function nextFastMoneyQuestion(state: GameState, now = Date.now()): void {
  advanceFastMoneyQuestion(state, false, now);
}

function advanceFastMoneyQuestion(state: GameState, passed: boolean, now: number): void {
  const fm = requirePhase(state, ["asking"]);
  if (fm.endsAt === null || now >= fm.endsAt) throw new Error("Time is up. Enter the player's answers.");
  const statuses = fm.questionStatus[fm.player];
  if (passed || statuses[fm.questionIndex] === "passed") {
    fm.answers[fm.player][fm.questionIndex] = {
      result: passed ? "pass" : "answer",
      text: passed ? "Pass" : "", points: 0, answerIndex: null, recorded: passed, revealed: false,
    };
  }
  statuses[fm.questionIndex] = passed ? "passed" : "answered";
  for (let offset = 1; offset <= 5; offset++) {
    const next = (fm.questionIndex + offset) % 5;
    if (statuses[next] !== "answered") {
      fm.questionIndex = next;
      return;
    }
  }
  stopFastMoney(state);
}

export function expireFastMoney(state: GameState, now = Date.now()): boolean {
  const fm = state.fastMoney;
  if (state.mode !== "fast_money" || fm.phase !== "asking" || fm.endsAt === null || now < fm.endsAt) return false;
  stopFastMoney(state);
  return true;
}

export function buzzFastMoney(state: GameState): void {
  const fm = requirePhase(state, ["asking", "scoring"]);
  fm.buzzFlash += 1;
}

export function recordFastMoneyAnswer(
  state: GameState, index: number, text: string, answerIndex: number | null, points: number, result?: FastMoneyResult
): boolean {
  const fm = requirePhase(state, ["scoring"]);
  if (!Number.isInteger(index) || index < 0 || index >= 5) throw new Error("Invalid Fast Money question.");
  if (typeof text !== "string" || text.length > 200) throw new Error("Answer text must be at most 200 characters.");
  if (result !== undefined && !["answer", "pass", "miss"].includes(result)) throw new Error("Invalid answer result.");
  const survey = answerIndex === null ? null : fm.questions[index].answers[answerIndex];
  if (answerIndex !== null && (!Number.isInteger(answerIndex) || !survey)) throw new Error("Invalid survey answer.");
  const score = survey?.points ?? points;
  if (!Number.isInteger(score) || score < 0 || score > 100) throw new Error("Points must be a whole number from 0 to 100.");
  if (!text.trim() && !survey && score > 0) throw new Error("Enter an answer before assigning points.");
  if ((result === "pass" || result === "miss") && (answerIndex !== null || points !== 0)) {
    throw new Error("Pass and Miss must have zero points and no survey match.");
  }
  const outcome = result ?? (!survey && (!text.trim() || text.trim() === "Pass") ? "pass" : score === 0 ? "miss" : "answer");
  const answerText = outcome === "pass" ? "Pass" : text.trim() || survey?.text || (outcome === "miss" ? "Miss" : "Pass");
  const first = fm.answers[0][index];
  const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
  if (fm.player === 1 && first.recorded && first.result !== "pass" && outcome !== "pass" && (
    (answerIndex !== null && first.answerIndex === answerIndex) ||
    (!(outcome === "miss" && !text.trim() && !survey) && normalize(answerText) === normalize(first.text))
  )) {
    fm.buzzFlash += 1;
    return false;
  }
  fm.answers[fm.player][index] = {
    result: outcome,
    text: answerText, points: score, answerIndex, recorded: true, revealed: false,
  };
  return true;
}

export function recordFastMoneyAnswers(state: GameState, answers: FastMoneyAnswerInput[]): boolean {
  const fm = requirePhase(state, ["scoring"]);
  if (!Array.isArray(answers) || answers.length !== 5) throw new Error("Save all five answers together.");
  const draft = { ...state, fastMoney: structuredClone(fm) };
  for (const [index, answer] of answers.entries()) {
    if (!answer || typeof answer !== "object") throw new Error(`Invalid answer for question ${index + 1}.`);
    if (!recordFastMoneyAnswer(draft, index, answer.text, answer.answerIndex, answer.points, answer.result)) {
      fm.buzzFlash += 1;
      return false;
    }
  }
  fm.answers[fm.player] = draft.fastMoney.answers[fm.player];
  return true;
}

export function beginFastMoneyReveal(state: GameState): void {
  const fm = requirePhase(state, ["scoring"]);
  if (!fm.answers[fm.player].every((a) => a.recorded)) throw new Error("Save all five answers before revealing.");
  fm.phase = "reveal";
}

export function revealNextFastMoneyAnswer(state: GameState): void {
  const fm = requirePhase(state, ["reveal"]);
  const next = fm.answers[fm.player].find((a) => !a.revealed);
  if (!next) throw new Error("All answers are already revealed.");
  next.revealed = true;
  if (fm.player === 1 && fm.answers[1].every((a) => a.revealed)) fm.phase = "finished";
}

export function nextFastMoneyPlayer(state: GameState): void {
  const fm = requirePhase(state, ["reveal"]);
  if (fm.player !== 0 || !fm.answers[0].every((a) => a.revealed)) {
    throw new Error("Reveal all five answers for Player 1 first.");
  }
  fm.player = 1;
  fm.phase = "setup";
  fm.questionIndex = 0;
  fm.endsAt = null;
}

export function editFastMoneyAnswers(state: GameState): void {
  const fm = requirePhase(state, ["reveal", "finished"]);
  fm.phase = "scoring";
  for (const answer of fm.answers[fm.player]) answer.revealed = false;
}

export function resetFastMoney(state: GameState): void {
  state.fastMoney = makeFastMoney(state.fastMoney.questions, state.fastMoney.questionFile);
}
