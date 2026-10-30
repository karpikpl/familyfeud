import express from "express";
import http from "http";
import path from "path";
import { Server as IOServer } from "socket.io";
import { listQuestionFiles, loadQuestionFile, loadQuestions } from "./csv";
import {
  beginFastMoneyReveal, buzzFastMoney, editFastMoneyAnswers, expireFastMoney, gotoFastMoneyQuestion,
  loadFastMoney, nextFastMoneyPlayer, nextFastMoneyQuestion, passFastMoneyQuestion, recordFastMoneyAnswer, recordFastMoneyAnswers, resetFastMoney,
  revealNextFastMoneyAnswer, setFastMoneyTime, startFastMoney, stopFastMoney,
} from "./fast-money";
import { Store } from "./persist";
import {
  addBuzz,
  addStrike,
  adjustScore,
  awardPotToTeam,
  clearStrikes,
  endGame,
  endRound,
  expireTimer,
  gotoQuestion,
  hideTimer,
  makeInitialState,
  migrateState,
  nextQuestion,
  prevQuestion,
  resetGame,
  resumeGame,
  revealAnswer,
  setControllingTeam,
  setMode,
  setQuestions,
  setTeamName,
  startRound,
  startTimer,
  undoLastAward,
  unrevealAnswer,
} from "./state";
import { FastMoneyAnswerInput, GameMode, GameState } from "./types";

const ROOT = path.resolve(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const QUESTIONS_DIR = path.join(ROOT, "questions");
const DEFAULT_CSV = listQuestionFiles(QUESTIONS_DIR)
  .find((filename) => !filename.toLowerCase().endsWith(".fast-money.csv")) ?? null;
const CSV_PATH = DEFAULT_CSV ? path.join(QUESTIONS_DIR, DEFAULT_CSV) : null;
const DB_PATH = process.env.DB_PATH ?? path.join(ROOT, "familyfeud.db");

const DISPLAY_PORT = Number(process.env.DISPLAY_PORT ?? 3000);
const ADMIN_PORT = Number(process.env.ADMIN_PORT ?? 4000);

const store = new Store(DB_PATH);
const questions = CSV_PATH ? loadQuestions(CSV_PATH) : [];

let state: GameState;
const saved = store.load();
if (saved) {
  state = migrateState(saved, DEFAULT_CSV);
  console.log(
    `[persist] restored state from ${DB_PATH}: Q${state.currentQuestionIndex + 1}/${state.questions.length}, scores ${state.teams[0].score}/${state.teams[1].score}`
  );
} else {
  state = makeInitialState(questions, DEFAULT_CSV);
  store.save(state);
  console.log(`[persist] no saved state; initialized from CSV at ${DB_PATH}`);
}

function persist() {
  try {
    store.save(state);
  } catch (err) {
    console.error("[persist] save failed", err);
  }
}

// ----- Display server (port 3000): audience screen + read-only socket -----
const THEME_PATH = path.join(ROOT, "audio", "sfx", "theme.m4a");
const displayApp = express();
displayApp.use(express.static(path.join(PUBLIC, "display")));
displayApp.get("/health", (_req, res) => res.json({ ok: true, role: "display" }));
displayApp.get("/theme.m4a", (_req, res) => {
  res.sendFile(THEME_PATH, (err) => {
    if (err && !res.headersSent) res.status(404).send("theme not found");
  });
});
// Serve sound effect files from audio/sfx/ at /sfx/<file>.
displayApp.use("/sfx", express.static(path.join(ROOT, "audio", "sfx")));
const displayServer = http.createServer(displayApp);
const displayIo = new IOServer(displayServer, { cors: { origin: "*" } });

displayIo.on("connection", (socket) => {
  socket.emit("state", state);
});

// ----- Admin server (port 4000): admin UI + control socket -----
const adminApp = express();
adminApp.use(express.json());
adminApp.use(express.static(path.join(PUBLIC, "admin")));
adminApp.get("/health", (_req, res) => res.json({ ok: true, role: "admin" }));

const adminServer = http.createServer(adminApp);
const adminIo = new IOServer(adminServer, { cors: { origin: "*" } });

function broadcast() {
  displayIo.emit("state", state);
  adminIo.emit("state", state);
}

type Cmd =
  | { type: "set_mode"; mode: GameMode }
  | { type: "select_csv"; mode: GameMode; filename: string }
  | { type: "fm_start" }
  | { type: "fm_set_time"; player: 0 | 1; seconds: number }
  | { type: "fm_question"; index: number }
  | { type: "fm_pass" }
  | { type: "fm_next" }
  | { type: "fm_stop" }
  | { type: "fm_buzz" }
  | ({ type: "fm_answer"; index: number } & FastMoneyAnswerInput)
  | { type: "fm_answers"; answers: FastMoneyAnswerInput[] }
  | { type: "fm_begin_reveal" }
  | { type: "fm_reveal_next" }
  | { type: "fm_next_player" }
  | { type: "fm_edit_answers" }
  | { type: "fm_reset" }
  | { type: "end_game" }
  | { type: "resume_game" }
  | { type: "start_timer" }
  | { type: "hide_timer" }
  | { type: "start_round" }
  | { type: "end_round" }
  | { type: "next_question" }
  | { type: "prev_question" }
  | { type: "goto_question"; index: number }
  | { type: "reveal_answer"; index: number }
  | { type: "unreveal_answer"; index: number }
  | { type: "strike" }
  | { type: "buzz" }
  | { type: "clear_strikes" }
  | { type: "award_pot"; team: 0 | 1 }
  | { type: "undo_award" }
  | { type: "adjust_score"; team: 0 | 1; delta: number }
  | { type: "set_team_name"; team: 0 | 1; name: string }
  | { type: "set_controlling_team"; team: 0 | 1 | null }
  | { type: "reset_game" }
  | { type: "show_question"; visible: boolean }
  | { type: "reload_csv" }
  | { type: "set_muted"; muted: boolean }
  | { type: "set_theme_playing"; playing: boolean }
  | { type: "set_theme_volume"; volume: number }
  | { type: "set_instructions_visible"; visible: boolean }
  | { type: "set_instructions_page"; page: number };

const GAMEPLAY_COMMANDS = new Set<Cmd["type"]>([
  "start_round", "end_round", "next_question", "prev_question", "goto_question",
  "reveal_answer", "unreveal_answer", "strike", "buzz", "clear_strikes",
  "award_pot", "undo_award", "adjust_score", "set_team_name",
  "set_controlling_team", "show_question",
]);

adminIo.on("connection", (socket) => {
  const sendFiles = () => {
    try {
      socket.emit("csv_files", listQuestionFiles(QUESTIONS_DIR));
    } catch (err) {
      console.error("[csv] failed to list question files", err);
      socket.emit("error_msg", "Unable to list CSV files on the server.");
    }
  };
  socket.on("list_csv_files", sendFiles);
  sendFiles();
  socket.emit("state", state);
  socket.emit("hello", {
    questionCount: state.questions.length,
    csvPath: state.questionFile,
    dbPath: DB_PATH,
  });

  socket.on("cmd", (cmd: Cmd) => {
    try {
      const warning = handle(cmd);
      persist();
      broadcast();
      if (warning) socket.emit("error_msg", warning);
    } catch (err) {
      console.error("[cmd] error", cmd, err);
      socket.emit("error_msg", String((err as Error).message ?? err));
    }
  });
});

function handle(cmd: Cmd) {
  if (state.mode !== "standard" && (GAMEPLAY_COMMANDS.has(cmd.type) || cmd.type === "end_game" || cmd.type === "resume_game")) {
    throw new Error("Switch to Standard mode to use standard game controls.");
  }
  if (state.gameOver && GAMEPLAY_COMMANDS.has(cmd.type)) {
    throw new Error("The game has ended. Resume the game to change scores or continue playing.");
  }
  switch (cmd.type) {
    case "set_mode":
      setMode(state, cmd.mode);
      break;
    case "select_csv":
      if (cmd.mode !== state.mode) throw new Error("The mode changed. Choose the CSV again.");
      selectQuestionFile(cmd.filename);
      break;
    case "fm_start":
      startFastMoney(state);
      break;
    case "fm_set_time":
      setFastMoneyTime(state, cmd.player, cmd.seconds);
      break;
    case "fm_question":
      gotoFastMoneyQuestion(state, cmd.index);
      break;
    case "fm_pass":
      passFastMoneyQuestion(state);
      break;
    case "fm_next":
      nextFastMoneyQuestion(state);
      break;
    case "fm_stop":
      stopFastMoney(state);
      break;
    case "fm_buzz":
      buzzFastMoney(state);
      break;
    case "fm_answer":
      if (!recordFastMoneyAnswer(state, cmd.index, cmd.text, cmd.answerIndex, cmd.points, cmd.result)) {
        return "Duplicate answer! Player 2 must give a different answer.";
      }
      break;
    case "fm_answers":
      if (!recordFastMoneyAnswers(state, cmd.answers)) {
        return "Duplicate answer! Player 2 must give different answers. No answers were saved.";
      }
      break;
    case "fm_begin_reveal":
      beginFastMoneyReveal(state);
      break;
    case "fm_reveal_next":
      revealNextFastMoneyAnswer(state);
      break;
    case "fm_next_player":
      nextFastMoneyPlayer(state);
      break;
    case "fm_edit_answers":
      editFastMoneyAnswers(state);
      break;
    case "fm_reset":
      if (state.mode !== "fast_money") throw new Error("Switch to Fast Money first.");
      resetFastMoney(state);
      break;
    case "end_game":
      endGame(state);
      break;
    case "resume_game":
      resumeGame(state);
      break;
    case "start_timer":
      startTimer(state);
      break;
    case "hide_timer":
      hideTimer(state);
      break;
    case "start_round":
      startRound(state);
      break;
    case "end_round":
      endRound(state);
      break;
    case "next_question":
      nextQuestion(state);
      break;
    case "prev_question":
      prevQuestion(state);
      break;
    case "goto_question":
      gotoQuestion(state, cmd.index);
      break;
    case "reveal_answer":
      revealAnswer(state, cmd.index);
      break;
    case "unreveal_answer":
      unrevealAnswer(state, cmd.index);
      break;
    case "strike":
      addStrike(state);
      break;
    case "buzz":
      addBuzz(state);
      break;
    case "clear_strikes":
      clearStrikes(state);
      break;
    case "award_pot":
      awardPotToTeam(state, cmd.team);
      break;
    case "undo_award":
      undoLastAward(state);
      break;
    case "adjust_score":
      adjustScore(state, cmd.team, cmd.delta);
      break;
    case "set_team_name":
      setTeamName(state, cmd.team, cmd.name);
      break;
    case "set_controlling_team":
      setControllingTeam(state, cmd.team);
      break;
    case "reset_game": {
      const names: [string, string] = [state.teams[0].name, state.teams[1].name];
      const audio = state.audio;
      const instructions = state.instructions;
      state = resetGame(state, state.questions);
      state.teams[0].name = names[0];
      state.teams[1].name = names[1];
      state.audio = audio;
      state.instructions = instructions;
      break;
    }
    case "show_question":
      state.reveal.questionVisible = cmd.visible;
      break;
    case "reload_csv": {
      const filename = state.mode === "fast_money" ? state.fastMoney.questionFile : state.questionFile;
      if (!filename) throw new Error("Select a CSV file first.");
      selectQuestionFile(filename);
      break;
    }
    case "set_muted":
      state.audio.muted = cmd.muted;
      break;
    case "set_theme_playing":
      state.audio.themePlaying = cmd.playing;
      break;
    case "set_theme_volume":
      state.audio.themeVolume = Math.max(0, Math.min(1, cmd.volume));
      break;
    case "set_instructions_visible":
      state.instructions.visible = cmd.visible;
      break;
    case "set_instructions_page": {
      const max = state.instructions.total - 1;
      state.instructions.page = Math.max(0, Math.min(max, cmd.page));
      break;
    }
  }
}

function selectQuestionFile(filename: string) {
  const loaded = loadQuestionFile(QUESTIONS_DIR, filename);
  if (state.mode === "fast_money") loadFastMoney(state, loaded, filename);
  else setQuestions(state, loaded, filename);
}

setInterval(() => {
  const timerExpired = expireTimer(state);
  const fastMoneyExpired = expireFastMoney(state);
  if (timerExpired || fastMoneyExpired) {
    persist();
    broadcast();
  }
}, 100);

// Graceful shutdown — flush state and close DB cleanly on signals.
function shutdown(signal: string) {
  console.log(`\n[shutdown] ${signal} — flushing state and closing DB`);
  try { persist(); } catch {}
  try { store.close(); } catch {}
  process.exit(0);
}
process.on("SIGINT",  () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("uncaughtException", (err) => {
  console.error("[uncaught]", err);
  try { persist(); } catch {}
  try { store.close(); } catch {}
  process.exit(1);
});

displayServer.listen(DISPLAY_PORT, () => {
  console.log(`[display] http://localhost:${DISPLAY_PORT}  (audience screen — share this)`);
});
adminServer.listen(ADMIN_PORT, () => {
  console.log(`[admin]   http://localhost:${ADMIN_PORT}  (game master controls — open on phone)`);
  console.log(`[csv]     ${state.questions.length} question(s) in play (loaded ${questions.length} from ${CSV_PATH ?? QUESTIONS_DIR})`);
  console.log(`[db]      ${DB_PATH}`);
});
