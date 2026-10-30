const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { readFileSync, readdirSync } = require("node:fs");
const csv = require("../dist/csv");
const stateFns = require("../dist/state");
const fm = require("../dist/fast-money");

const root = path.join(__dirname, "..");
const directory = path.join(root, "questions");
const manifest = JSON.parse(readFileSync(path.join(directory, "manifest.json"), "utf8"));
const themedManifest = JSON.parse(readFileSync(path.join(directory, "themed-manifest.json"), "utf8"));

test("reviewed packs preserve question order, answer groups and response-based points", () => {
  const seen = new Set();
  for (const pack of manifest.sets) {
    const questions = csv.loadQuestions(path.join(directory, pack.filename), true);
    assert.equal(questions.length, pack.questions.length, pack.filename);
    questions.forEach((question, i) => {
      const source = pack.questions[i];
      assert.ok(!seen.has(source.id), source.id);
      seen.add(source.id);
      assert.equal(question.text, source.question);
      assert.deepEqual(question.answers.map(({ text, points }) => ({ text, points })),
        source.answers.map(({ answer, responses }) => ({
          text: answer, points: Math.round(responses / source.respondents * 100),
        })));
      assert.equal(new Set(question.answers.map(a => a.text.toLowerCase())).size, question.answers.length);
      assert.ok(question.answers.every(a => !/\(combine|skip this/i.test(a.text)));
    });
  }
  assert.equal(seen.size, 35);
  assert.ok(!seen.has("Q02"));
  assert.ok(!seen.has("Q17"));
});

test("inline column E merges recompute scores instead of adding rounded scores", () => {
  const all = manifest.sets.flatMap(pack => pack.questions);
  const cases = [
    ["Q08", "Eat snacks", 2, 14],
    ["Q10", "Allez! / Ale!", 2, 15],
    ["Q16", "A granola bar", 5, 38],
    ["Q21", "This is so hard / This is not a 5.10", 2, 17],
    ["Q26", "Climbing a certain level", 4, 36],
    ["Q28", "Crowd", 8, 67],
    ["Q35", "An overhang", 3, 27],
    ["Q42", "Unsupervised children / Free-range children / Kids", 3, 33],
  ];
  for (const [id, label, responses, points] of cases) {
    const answer = all.find(q => q.id === id).answers.find(a => a.answer === label);
    assert.equal(answer.responses, responses, id);
    assert.equal(answer.points, points, id);
    assert.ok(answer.source_rows.length >= 2, id);
  }
  const shouts = all.find(q => q.id === "Q10").answers;
  assert.ok(shouts.some(a => a.answer === "<Explative>"));
  assert.ok(!shouts.some(a => a.answer === "FUCK"));
});

test("catalog contains only playable folder CSVs, not root sets or unfinished drafts", () => {
  const playable = [...manifest.sets, ...themedManifest.sets]
    .filter(pack => !pack.draft).map(pack => pack.filename).sort();
  assert.deepEqual(csv.listQuestionFiles(directory), playable);
  assert.deepEqual(readdirSync(root).filter(name => name.endsWith(".csv")), []);
  const draft = manifest.sets.find(pack => pack.draft);
  assert.equal(draft.filename, "drafts/climbing-04.fast-money.csv");
  assert.throws(() => csv.loadQuestionFile(directory, draft.filename), /server's list/);
  const questions = csv.loadQuestions(path.join(directory, draft.filename), true);
  assert.equal(questions.length, 1);
  assert.throws(() => fm.loadFastMoney(stateFns.makeInitialState([]), questions), /at least five/);
});

test("themed review creates complete 5+5 games without exclusions, duplicates or score changes", () => {
  const seen = new Set();
  const games = new Map();
  const promoted = [];
  for (const pack of themedManifest.sets) {
    const questions = csv.loadQuestionFile(directory, pack.filename);
    assert.equal(questions.length, 5, pack.filename);
    const modes = games.get(pack.game) ?? [];
    modes.push(pack.mode);
    games.set(pack.game, modes);
    questions.forEach((question, i) => {
      const source = pack.questions[i];
      assert.ok(!seen.has(source.id), source.id);
      assert.ok(!themedManifest.excluded_question_ids.includes(source.id), source.id);
      seen.add(source.id);
      assert.equal(question.text, source.question);
      assert.deepEqual(question.answers.map(({ text, points }) => ({ text, points })),
        source.answers.map(({ answer, points }) => ({ text: answer, points }))
          .sort((a, b) => b.points - a.points));
      assert.ok(source.source_note.startsWith("Source:"));
      if (pack.mode === "standard" && source.original_stage.startsWith("Fast")) promoted.push(source.id);
    });
  }
  assert.equal(games.size, 7);
  for (const modes of games.values()) assert.deepEqual(modes.sort(), ["fast_money", "standard"]);
  assert.equal(seen.size, 70);
  assert.deepEqual([...seen, ...themedManifest.excluded_question_ids].sort(),
    Array.from({ length: 97 }, (_, i) => `Q${String(i + 1).padStart(3, "0")}`));
  assert.deepEqual(promoted.sort(), themedManifest.promoted_to_standard);
});

for (const pack of [...manifest.sets, ...themedManifest.sets].filter(pack => pack.mode === "fast_money" && !pack.draft)) {
  test(`${pack.filename} supports both Fast Money players with distinct survey matches`, () => {
    const questions = csv.loadQuestionFile(directory, pack.filename);
    const state = stateFns.makeInitialState([]);
    fm.loadFastMoney(state, questions, pack.filename);
    stateFns.setMode(state, "fast_money");
    assert.equal(questions.length, 5);
    for (let player = 0; player < 2; player++) {
      fm.startFastMoney(state, 1000);
      fm.stopFastMoney(state);
      for (let i = 0; i < 5; i++) {
        assert.equal(fm.recordFastMoneyAnswer(state, i, "", player, 0), true);
      }
      fm.beginFastMoneyReveal(state);
      for (let i = 0; i < 5; i++) fm.revealNextFastMoneyAnswer(state);
      if (player === 0) fm.nextFastMoneyPlayer(state);
    }
    assert.equal(state.fastMoney.phase, "finished");
    const expected = questions.reduce((sum, q) => sum + q.answers[0].points + q.answers[1].points, 0);
    assert.equal(state.fastMoney.answers.flat().reduce((sum, answer) => sum + answer.points, 0), expected);
  });
}
