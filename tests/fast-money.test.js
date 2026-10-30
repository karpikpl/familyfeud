const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const stateFns = require("../dist/state");
const fm = require("../dist/fast-money");
const csv = require("../dist/csv");

const questions = Array.from({ length: 5 }, (_, i) => ({
  id: i + 1, text: `Question ${i + 1}`,
  answers: [
    { text: `Top ${i + 1}`, points: 40, revealed: false },
    { text: `Other ${i + 1}`, points: 20, revealed: false },
  ],
}));

function ready() {
  const state = stateFns.makeInitialState(questions, "standard.csv");
  stateFns.setMode(state, "fast_money");
  fm.loadFastMoney(state, questions, "fast.csv");
  return state;
}

function recordPlayer(state, answerIndex = 0) {
  fm.startFastMoney(state, 1000);
  fm.stopFastMoney(state);
  for (let i = 0; i < 5; i++) {
    assert.equal(fm.recordFastMoneyAnswer(state, i, "", answerIndex, 0), true);
  }
  fm.beginFastMoneyReveal(state);
  for (let i = 0; i < 5; i++) fm.revealNextFastMoneyAnswer(state);
}

test("legacy state migration preserves scores, round, and timer", () => {
  const state = stateFns.makeInitialState(questions);
  state.teams[0].score = 123;
  stateFns.startRound(state);
  stateFns.revealAnswer(state, 0);
  stateFns.startTimer(state, 1000);
  const originalRound = structuredClone(state.round);
  delete state.mode;
  delete state.fastMoney;
  delete state.questionFile;
  stateFns.migrateState(state, "legacy.csv");
  assert.equal(state.mode, "standard");
  assert.equal(state.questionFile, "legacy.csv");
  assert.equal(state.fastMoney.phase, "setup");
  assert.equal(state.teams[0].score, 123);
  assert.deepEqual(state.round, originalRound);
  assert.equal(state.timer.endsAt, 11000);
});

test("standard timer counts down ten seconds and hides three seconds after expiry", () => {
  const state = stateFns.makeInitialState(questions);
  stateFns.startTimer(state, 1000);
  assert.equal(state.timer.endsAt, 11000);
  assert.equal(stateFns.expireTimer(state, 10999), false);
  assert.equal(stateFns.expireTimer(state, 11000), false);
  assert.equal(stateFns.expireTimer(state, 13999), false);
  assert.equal(state.timer.endsAt, 11000);
  assert.equal(stateFns.expireTimer(state, 14000), true);
  assert.equal(state.timer.endsAt, null);
  assert.equal(stateFns.expireTimer(state, 14001), false);
});

test("restarting or manually hiding the standard timer cancels its old expiry", () => {
  const state = stateFns.makeInitialState(questions);
  stateFns.startTimer(state, 1000);
  stateFns.startTimer(state, 12000);
  assert.equal(stateFns.expireTimer(state, 14000), false);
  assert.equal(state.timer.endsAt, 22000);
  stateFns.hideTimer(state);
  assert.equal(stateFns.expireTimer(state, 25000), false);
  assert.equal(state.timer.endsAt, null);
});

test("CSV replacement preserves standard scores and clears only its round", () => {
  const state = ready();
  state.teams[0].score = 150;
  state.teams[0].name = "Champions";
  const fast = structuredClone(state.fastMoney);
  stateFns.setQuestions(state, questions.slice(0, 2), "new.csv");
  assert.equal(state.teams[0].score, 150);
  assert.equal(state.teams[0].name, "Champions");
  assert.equal(state.questions.length, 2);
  assert.equal(state.round.kind, "idle");
  assert.deepEqual(state.fastMoney, fast);
  assert.equal(state.questionFile, "new.csv");
});

test("mode switching keeps both games and stops a running Fast Money timer", () => {
  const state = ready();
  state.teams[1].score = 80;
  fm.startFastMoney(state, 1000);
  stateFns.setMode(state, "standard");
  assert.equal(state.fastMoney.phase, "scoring");
  assert.equal(state.fastMoney.endsAt, null);
  assert.equal(state.teams[1].score, 80);
  stateFns.setMode(state, "fast_money");
  assert.equal(state.fastMoney.questionFile, "fast.csv");
  assert.throws(() => stateFns.setMode(state, "unknown"), /Invalid game mode/);
});

test("five-question selection validates atomically and uses first five questions", () => {
  const state = ready();
  const before = structuredClone(state);
  assert.throws(() => fm.loadFastMoney(state, questions.slice(0, 4), "short.csv"), /at least five/);
  assert.deepEqual(state, before);
  fm.loadFastMoney(state, [...questions, ...questions], "ten.csv");
  assert.equal(state.fastMoney.questions.length, 5);
  assert.equal(state.fastMoney.questionFile, "ten.csv");
});

test("20/25 second deadlines, navigation, expiry, and phase validation", () => {
  const state = ready();
  fm.startFastMoney(state, 1000);
  assert.equal(state.fastMoney.endsAt, 21000);
  fm.gotoFastMoneyQuestion(state, 4, 1500);
  assert.equal(state.fastMoney.questionIndex, 4);
  assert.throws(() => fm.gotoFastMoneyQuestion(state, -1, 1500), /Invalid/);
  assert.throws(() => fm.gotoFastMoneyQuestion(state, 3, 21000), /Time is up/);
  assert.throws(() => fm.startFastMoney(state), /not available/);
  fm.stopFastMoney(state);
  assert.equal(state.fastMoney.endsAt, null);
  assert.throws(() => fm.beginFastMoneyReveal(state), /Save all five/);
  assert.throws(() => fm.recordFastMoneyAnswer(state, 8, "Bad", null, 0), /Invalid/);
  assert.throws(() => fm.recordFastMoneyAnswer(state, 0, "Bad", null, -1), /whole number/);
  assert.throws(() => fm.recordFastMoneyAnswer(state, 0, "", null, 10), /Enter an answer/);
  fm.resetFastMoney(state);
  recordPlayer(state);
  fm.nextFastMoneyPlayer(state);
  fm.startFastMoney(state, 5000);
  assert.equal(state.fastMoney.endsAt, 30000);
});

test("survey matches use canonical points, sequential reveals and separate totals", () => {
  const state = ready();
  state.teams[0].score = 250;
  recordPlayer(state);
  assert.equal(state.fastMoney.answers[0][0].text, "Top 1");
  assert.equal(state.fastMoney.answers[0][0].points, 40);
  assert.equal(state.fastMoney.phase, "reveal");
  assert.throws(() => fm.revealNextFastMoneyAnswer(state), /already revealed/);
  fm.nextFastMoneyPlayer(state);
  recordPlayer(state, 1);
  assert.equal(state.fastMoney.phase, "finished");
  assert.equal(state.fastMoney.answers.flat().reduce((sum, a) => sum + a.points, 0), 300);
  assert.equal(state.teams[0].score, 250);
  assert.equal(state.teams[1].score, 0);
  const restored = stateFns.migrateState(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(restored, state);
  fm.editFastMoneyAnswers(state);
  assert.equal(state.fastMoney.phase, "scoring");
  assert.ok(state.fastMoney.answers[1].every((a) => !a.revealed));
  assert.ok(state.fastMoney.answers[0].every((a) => a.revealed));
});

test("duplicates buzz and do not save; host judges synonyms through survey matching", () => {
  const state = ready();
  recordPlayer(state);
  fm.nextFastMoneyPlayer(state);
  fm.startFastMoney(state, 1000);
  fm.buzzFastMoney(state);
  fm.stopFastMoney(state);
  assert.equal(fm.recordFastMoneyAnswer(state, 0, "A synonym", 0, 99), false);
  assert.equal(state.fastMoney.buzzFlash, 2);
  assert.equal(state.fastMoney.answers[1][0].recorded, false);
  assert.equal(fm.recordFastMoneyAnswer(state, 0, "   TOP   1 ", null, 0), false);
  assert.equal(fm.recordFastMoneyAnswer(state, 0, "Other 1", 1, 99), true);
  assert.equal(state.fastMoney.answers[1][0].points, 20);
});

test("Save Answers records all five together and validates before committing", () => {
  const state = ready();
  fm.startFastMoney(state, 0);
  fm.stopFastMoney(state);
  const answers = questions.map(() => ({ text: "", answerIndex: 0, points: 0 }));
  const original = structuredClone(state);
  assert.throws(() => fm.recordFastMoneyAnswers(state, answers.slice(0, 4)), /all five/);
  const invalid = structuredClone(answers);
  invalid[4] = { text: "Bad", answerIndex: null, points: -1 };
  assert.throws(() => fm.recordFastMoneyAnswers(state, invalid), /whole number/);
  assert.deepEqual(state, original);
  const malformed = structuredClone(answers);
  malformed[4] = null;
  assert.throws(() => fm.recordFastMoneyAnswers(state, malformed), /Invalid answer/);
  assert.deepEqual(state, original);
  assert.equal(fm.recordFastMoneyAnswers(state, answers), true);
  assert.ok(state.fastMoney.answers[0].every((a) => a.recorded && a.points === 40));
  fm.beginFastMoneyReveal(state);
  for (let i = 0; i < 5; i++) fm.revealNextFastMoneyAnswer(state);
  fm.nextFastMoneyPlayer(state);
  fm.startFastMoney(state, 0);
  fm.stopFastMoney(state);
  const secondPlayer = questions.map(() => ({ text: "", answerIndex: 1, points: 0 }));
  const before = structuredClone(state.fastMoney.answers);
  secondPlayer[4].answerIndex = 0;
  assert.equal(fm.recordFastMoneyAnswers(state, secondPlayer), false);
  assert.deepEqual(state.fastMoney.answers, before);
  assert.equal(state.fastMoney.buzzFlash, 1);
  secondPlayer[4].answerIndex = 1;
  assert.equal(fm.recordFastMoneyAnswers(state, secondPlayer), true);
  assert.ok(state.fastMoney.answers[1].every((a) => a.recorded && a.points === 20));
  fm.beginFastMoneyReveal(state);
  assert.throws(() => fm.recordFastMoneyAnswers(state, secondPlayer), /not available/);
});

test("Pass and Miss are distinct zero-point results and invalid combinations do not save", () => {
  const state = ready();
  fm.startFastMoney(state, 0);
  fm.stopFastMoney(state);
  assert.equal(fm.recordFastMoneyAnswer(state, 0, "", null, 0, "pass"), true);
  assert.equal(fm.recordFastMoneyAnswer(state, 1, "Wrong answer", null, 0, "miss"), true);
  assert.equal(fm.recordFastMoneyAnswer(state, 2, "", null, 0, "miss"), true);
  assert.equal(state.fastMoney.answers[0][0].result, "pass");
  assert.equal(state.fastMoney.answers[0][0].text, "Pass");
  assert.equal(state.fastMoney.answers[0][1].result, "miss");
  assert.equal(state.fastMoney.answers[0][1].text, "Wrong answer");
  assert.equal(state.fastMoney.answers[0][2].text, "Miss");
  const snapshot = structuredClone(state);
  assert.throws(() => fm.recordFastMoneyAnswer(state, 3, "Bad", null, 10, "miss"), /zero points/);
  assert.throws(() => fm.recordFastMoneyAnswer(state, 3, "", 0, 0, "pass"), /no survey match/);
  assert.throws(() => fm.recordFastMoneyAnswer(state, 3, "", null, 0, "invalid"), /Invalid answer result/);
  assert.deepEqual(state, snapshot);
  for (let i = 3; i < 5; i++) fm.recordFastMoneyAnswer(state, i, "", null, 0, "miss");
  fm.beginFastMoneyReveal(state);
  for (let i = 0; i < 5; i++) fm.revealNextFastMoneyAnswer(state);
  fm.nextFastMoneyPlayer(state);
  fm.startFastMoney(state, 0);
  fm.stopFastMoney(state);
  assert.equal(fm.recordFastMoneyAnswer(state, 0, "", null, 0, "pass"), true);
  assert.equal(fm.recordFastMoneyAnswer(state, 1, "Wrong answer", null, 0, "miss"), false);
  assert.equal(fm.recordFastMoneyAnswer(state, 2, "", null, 0, "miss"), true);
  assert.equal(fm.recordFastMoneyAnswer(state, 3, "", null, 0, "miss"), true);
});

test("legacy answer results migrate without changing text, points or reveal status", () => {
  const state = ready();
  fm.startFastMoney(state, 0);
  fm.stopFastMoney(state);
  fm.recordFastMoneyAnswer(state, 0, "", null, 0);
  fm.recordFastMoneyAnswer(state, 1, "Wrong", null, 0);
  fm.recordFastMoneyAnswer(state, 2, "", 0, 0);
  state.fastMoney.answers[0][1].revealed = true;
  for (const answer of state.fastMoney.answers.flat()) delete answer.result;
  stateFns.migrateState(state);
  assert.deepEqual(state.fastMoney.answers[0].map((a) => a.result), ["pass", "miss", "answer", "answer", "answer"]);
  assert.equal(state.fastMoney.answers[0][1].text, "Wrong");
  assert.equal(state.fastMoney.answers[0][1].points, 0);
  assert.equal(state.fastMoney.answers[0][1].revealed, true);
  assert.equal(state.fastMoney.answers[0][2].points, 40);
});

test("both players may pass, and resetting retains CSV sources", () => {
  const state = ready();
  fm.startFastMoney(state, 0);
  fm.stopFastMoney(state);
  for (let i = 0; i < 5; i++) fm.recordFastMoneyAnswer(state, i, "", null, 0);
  fm.beginFastMoneyReveal(state);
  for (let i = 0; i < 5; i++) fm.revealNextFastMoneyAnswer(state);
  fm.nextFastMoneyPlayer(state);
  fm.startFastMoney(state, 0);
  fm.stopFastMoney(state);
  assert.equal(fm.recordFastMoneyAnswer(state, 0, "", null, 0), true);
  fm.resetFastMoney(state);
  assert.equal(state.fastMoney.questionFile, "fast.csv");
  assert.equal(state.fastMoney.phase, "setup");
  assert.ok(state.fastMoney.answers.flat().every((a) => !a.recorded && !a.revealed));
  const reset = stateFns.resetGame(state, state.questions);
  assert.equal(reset.questionFile, "standard.csv");
  assert.equal(reset.fastMoney.questionFile, "fast.csv");
});

test("Pass keeps questions pending on repeated laps without resetting time", () => {
  const state = ready();
  fm.startFastMoney(state, 1000);
  fm.passFastMoneyQuestion(state, 1500);
  assert.equal(state.fastMoney.questionIndex, 1);
  assert.equal(state.fastMoney.endsAt, 21000);
  assert.deepEqual(state.fastMoney.answers[0][0], {
    result: "pass", text: "Pass", points: 0, answerIndex: null, recorded: true, revealed: false,
  });
  assert.equal(state.fastMoney.answers[0][1].recorded, false);
  const snapshot = structuredClone(state);
  assert.throws(() => fm.passFastMoneyQuestion(state, 21000), /Time is up/);
  assert.deepEqual(state, snapshot);
  for (let i = 1; i < 5; i++) fm.passFastMoneyQuestion(state, 2000);
  assert.equal(state.fastMoney.phase, "asking");
  assert.equal(state.fastMoney.questionIndex, 0);
  assert.equal(state.fastMoney.endsAt, 21000);
  assert.deepEqual(state.fastMoney.questionStatus[0], Array(5).fill("passed"));
  for (let i = 0; i < 10; i++) fm.passFastMoneyQuestion(state, 3000);
  assert.equal(state.fastMoney.questionIndex, 0);
  assert.equal(state.fastMoney.phase, "asking");
  assert.ok(state.fastMoney.answers[0].every((a) => a.recorded && a.points === 0));
  assert.equal(fm.expireFastMoney(state, 21000), true);
  assert.equal(state.fastMoney.phase, "scoring");
  assert.equal(state.fastMoney.endsAt, null);
  assert.throws(() => fm.passFastMoneyQuestion(state), /not available/);
  fm.beginFastMoneyReveal(state);
  for (let i = 0; i < 5; i++) fm.revealNextFastMoneyAnswer(state);
  fm.nextFastMoneyPlayer(state);
  fm.startFastMoney(state, 5000);
  fm.passFastMoneyQuestion(state, 5500);
  assert.equal(state.fastMoney.answers[1][0].text, "Pass");
  assert.equal(state.fastMoney.answers[1][0].recorded, true);
  assert.equal(state.fastMoney.endsAt, 30000);
});

test("Next skips answered questions, revisits passes, and completes only when no questions remain", () => {
  const state = ready();
  fm.startFastMoney(state, 1000);
  fm.nextFastMoneyQuestion(state, 1500);
  fm.passFastMoneyQuestion(state, 1500);
  fm.nextFastMoneyQuestion(state, 1500);
  fm.passFastMoneyQuestion(state, 1500);
  fm.nextFastMoneyQuestion(state, 1500);
  assert.equal(state.fastMoney.phase, "asking");
  assert.equal(state.fastMoney.questionIndex, 1);
  assert.deepEqual(state.fastMoney.questionStatus[0], ["answered", "passed", "answered", "passed", "answered"]);
  fm.passFastMoneyQuestion(state, 2000);
  assert.equal(state.fastMoney.questionIndex, 3);
  fm.nextFastMoneyQuestion(state, 2000);
  assert.equal(state.fastMoney.questionIndex, 1);
  assert.equal(state.fastMoney.answers[0][3].recorded, false);
  assert.equal(state.fastMoney.answers[0][3].text, "");
  fm.passFastMoneyQuestion(state, 3000);
  assert.equal(state.fastMoney.questionIndex, 1);
  assert.equal(state.fastMoney.endsAt, 21000);
  const restored = stateFns.migrateState(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(restored, state);
  fm.nextFastMoneyQuestion(state, 3000);
  assert.equal(state.fastMoney.phase, "scoring");
  assert.equal(state.fastMoney.endsAt, null);
  assert.ok(state.fastMoney.questionStatus[0].every((status) => status === "answered"));
  assert.ok(state.fastMoney.answers[0].every((answer) => !answer.recorded));
  assert.throws(() => fm.beginFastMoneyReveal(state), /Save all five/);
});

test("five answered questions finish, and navigation cannot advance after expiry", () => {
  const state = ready();
  fm.startFastMoney(state, 1000);
  const snapshot = structuredClone(state);
  assert.throws(() => fm.nextFastMoneyQuestion(state, 21000), /Time is up/);
  assert.deepEqual(state, snapshot);
  for (let i = 0; i < 5; i++) fm.nextFastMoneyQuestion(state, 2000);
  assert.equal(state.fastMoney.phase, "scoring");
  assert.equal(state.fastMoney.endsAt, null);
  assert.throws(() => fm.nextFastMoneyQuestion(state, 2000), /not available/);
});

test("expiry transitions once, preserves pending passes, and leaves other modes alone", () => {
  const state = ready();
  fm.startFastMoney(state, 1000);
  fm.passFastMoneyQuestion(state, 1500);
  assert.equal(fm.expireFastMoney(state, 20999), false);
  assert.equal(fm.expireFastMoney(state, 21000), true);
  assert.equal(state.fastMoney.phase, "scoring");
  assert.equal(state.fastMoney.answers[0][0].text, "Pass");
  assert.equal(state.fastMoney.answers[0][0].recorded, true);
  assert.equal(state.fastMoney.answers[0][1].recorded, false);
  assert.equal(fm.expireFastMoney(state, 22000), false);
  stateFns.setMode(state, "standard");
  assert.equal(fm.expireFastMoney(state, 22000), false);
});

test("saved pre-cycling games backfill progress without changing scores, answers or deadline", () => {
  const state = ready();
  fm.startFastMoney(state, 1000);
  fm.passFastMoneyQuestion(state, 1500);
  fm.nextFastMoneyQuestion(state, 1500);
  delete state.fastMoney.questionStatus;
  state.teams[0].score = 120;
  const answers = structuredClone(state.fastMoney.answers);
  stateFns.migrateState(state);
  assert.deepEqual(state.fastMoney.questionStatus[0], ["passed", "answered", "unasked", "unasked", "unasked"]);
  assert.deepEqual(state.fastMoney.questionStatus[1], Array(5).fill("unasked"));
  assert.deepEqual(state.fastMoney.answers, answers);
  assert.equal(state.fastMoney.endsAt, 21000);
  assert.equal(state.teams[0].score, 120);
  for (let i = 0; i < 3; i++) fm.nextFastMoneyQuestion(state, 2000);
  assert.equal(state.fastMoney.questionIndex, 0);
  assert.equal(state.fastMoney.phase, "asking");
});

test("CSV catalog permits only real CSV files in its directory, and rejects malformed data", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "familyfeud-csv-"));
  try {
    fs.writeFileSync(path.join(dir, "good.csv"), "question,answer,points\nQ,A,10\n");
    fs.writeFileSync(path.join(dir, "notes.txt"), "not a question file");
    fs.mkdirSync(path.join(dir, "folder.csv"));
    fs.symlinkSync(path.join(dir, "good.csv"), path.join(dir, "link.csv"));
    assert.deepEqual(csv.listQuestionFiles(dir), ["good.csv"]);
    assert.equal(csv.loadQuestionFile(dir, "good.csv")[0].answers[0].points, 10);
    assert.throws(() => csv.loadQuestionFile(dir, "../good.csv"), /server's list/);
    assert.throws(() => csv.loadQuestionFile(dir, "link.csv"), /server's list/);
    fs.writeFileSync(path.join(dir, "bad.csv"), "question,answer,points\nQ,A,-1\n");
    assert.throws(() => csv.loadQuestionFile(dir, "bad.csv"), /whole-number/);
    fs.writeFileSync(path.join(dir, "bad.csv"), "question,answer\nQ,A\n");
    assert.throws(() => csv.loadQuestionFile(dir, "bad.csv"), /columns/);
    fs.writeFileSync(path.join(dir, "bad.csv"), "question,answer,points\n");
    assert.throws(() => csv.loadQuestionFile(dir, "bad.csv"), /no questions/);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});
