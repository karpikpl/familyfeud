/* global io, renderFastMoneyDisplay */
const socket = io();

const els = {
  stage: document.querySelector(".stage"),
  questionBanner: document.getElementById("question-banner"),
  questionText: document.getElementById("question-text"),
  board: document.getElementById("board"),
  timer: document.getElementById("timer"),
  timerValue: document.getElementById("timer-value"),
  gameResult: document.getElementById("game-result"),
  resultTitle: document.getElementById("result-title"),
  resultWinner: document.getElementById("result-winner"),
  resultTeams: [0, 1].map((i) => document.getElementById(`result-team-${i}`)),
  resultNames: [0, 1].map((i) => document.getElementById(`result-name-${i}`)),
  resultScores: [0, 1].map((i) => document.getElementById(`result-score-${i}`)),
  pot: document.getElementById("pot"),
  strikes: document.getElementById("strikes"),
  nameLeft: document.getElementById("name-left"),
  nameRight: document.getElementById("name-right"),
  numLeft: document.getElementById("num-left"),
  numRight: document.getElementById("num-right"),
  gate: document.getElementById("audio-gate"),
  instructions: document.getElementById("instructions"),
  instructionsPages: document.querySelectorAll(".instructions__page"),
  instructionsPageNum: document.getElementById("instructions-page-num"),
};

let lastStrikeFlash = 0;
let lastBuzzFlash = 0;
let lastRevealed = new Map(); // questionId -> Set of revealed indices
let audioReady = false;
let audioCtx = null;
let masterGain = null;
let themeAudio = null;
let lastState = null;
const sfxBuffers = { strike: null, ding: null }; // AudioBuffers, loaded lazily

async function loadSample(name, url) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const arr = await res.arrayBuffer();
    const buf = await audioCtx.decodeAudioData(arr);
    sfxBuffers[name] = buf;
    console.log(`[sfx] loaded ${name} (${url})`);
  } catch (err) {
    console.warn(`[sfx] failed to load ${name}, will fall back to synth:`, err);
  }
}

function playSample(name, gainValue = 1.0) {
  const buf = sfxBuffers[name];
  if (!buf || !audioCtx) return false;
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  const g = audioCtx.createGain();
  g.gain.value = gainValue;
  src.connect(g).connect(masterGain);
  src.start(audioCtx.currentTime);
  return true;
}

// ----- Audio engine -----
function initAudio() {
  if (audioReady) return;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  audioCtx = new Ctx();
  masterGain = audioCtx.createGain();
  masterGain.gain.value = 1.0;
  masterGain.connect(audioCtx.destination);

  themeAudio = new Audio("/theme.m4a");
  themeAudio.loop = true;
  themeAudio.volume = lastState?.audio?.themeVolume ?? 0.7;
  themeAudio.preload = "auto";

  // Kick off SFX sample loads in parallel — playStrike/playReveal will use them
  // once decoded, and fall back to the Web Audio synth in the meantime.
  loadSample("strike", "/sfx/strike.mp3");
  loadSample("ding",   "/sfx/ding.mp3");

  audioReady = true;
  applyAudioState(lastState);
}

// "DING!" — uses the show's actual sample if loaded, falls back to bell synth.
function playReveal() {
  if (!audioReady || lastState?.audio?.muted) return;
  if (playSample("ding", 0.85)) return;
  playRevealSynth();
}

function playRevealSynth() {
  if (!audioReady || lastState?.audio?.muted) return;
  const t = audioCtx.currentTime;
  const fundamental = 880; // A5 — bright ding range

  // Master envelope for the ding
  const out = audioCtx.createGain();
  out.gain.setValueAtTime(0, t);
  out.gain.linearRampToValueAtTime(0.45, t + 0.005);
  out.gain.exponentialRampToValueAtTime(0.001, t + 1.4);
  out.connect(masterGain);

  // Bell partials — fundamental + inharmonic upper partial (church-bell style)
  [
    { f: fundamental,        type: "sine",     gain: 0.7 },
    { f: fundamental * 2.76, type: "sine",     gain: 0.25 },
    { f: fundamental * 5.4,  type: "triangle", gain: 0.08 },
  ].forEach(({ f, type, gain }) => {
    const osc = audioCtx.createOscillator();
    osc.type = type;
    osc.frequency.value = f;
    const g = audioCtx.createGain();
    g.gain.value = gain;
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + 1.5);
  });

  // Tiny attack click for punch
  const clickOsc = audioCtx.createOscillator();
  clickOsc.type = "square";
  clickOsc.frequency.value = 1760;
  const clickGain = audioCtx.createGain();
  clickGain.gain.setValueAtTime(0.18, t);
  clickGain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
  clickOsc.connect(clickGain).connect(masterGain);
  clickOsc.start(t);
  clickOsc.stop(t + 0.05);
}

// "EHHHHH!" — uses the show's actual buzzer sample if loaded, falls back to synth.
function playStrike() {
  if (!audioReady || lastState?.audio?.muted) return;
  if (playSample("strike", 0.85)) return;
  playStrikeSynth();
}

function playStrikeSynth() {
  if (!audioReady || lastState?.audio?.muted) return;
  const t = audioCtx.currentTime;
  const dur = 0.55;

  // Master envelope
  const out = audioCtx.createGain();
  out.gain.setValueAtTime(0, t);
  out.gain.linearRampToValueAtTime(0.5, t + 0.012);
  out.gain.linearRampToValueAtTime(0.5, t + dur - 0.08);
  out.gain.exponentialRampToValueAtTime(0.001, t + dur);
  out.connect(masterGain);

  // Resonant bandpass for nasal honk
  const bp = audioCtx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 800;
  bp.Q.value = 3.5;
  bp.connect(out);

  // Two detuned oscillators (saw + square) at ~200Hz with slight downward pitch slide
  const osc1 = audioCtx.createOscillator();
  osc1.type = "sawtooth";
  osc1.frequency.setValueAtTime(210, t);
  osc1.frequency.linearRampToValueAtTime(190, t + dur);

  const osc2 = audioCtx.createOscillator();
  osc2.type = "square";
  osc2.frequency.setValueAtTime(211, t); // ~1Hz detune for thickness
  osc2.frequency.linearRampToValueAtTime(189, t + dur);

  const oscGain1 = audioCtx.createGain();
  oscGain1.gain.value = 0.55;
  const oscGain2 = audioCtx.createGain();
  oscGain2.gain.value = 0.4;

  osc1.connect(oscGain1).connect(bp);
  osc2.connect(oscGain2).connect(bp);
  osc1.start(t); osc1.stop(t + dur);
  osc2.start(t); osc2.stop(t + dur);

  // Noise transient at the attack for the "BLAT" punch
  const noiseDur = 0.06;
  const noiseBuf = audioCtx.createBuffer(1, audioCtx.sampleRate * noiseDur, audioCtx.sampleRate);
  const noiseData = noiseBuf.getChannelData(0);
  for (let i = 0; i < noiseData.length; i++) noiseData[i] = (Math.random() * 2 - 1) * (1 - i / noiseData.length);
  const noiseSrc = audioCtx.createBufferSource();
  noiseSrc.buffer = noiseBuf;
  const noiseFilter = audioCtx.createBiquadFilter();
  noiseFilter.type = "bandpass";
  noiseFilter.frequency.value = 1200;
  noiseFilter.Q.value = 1;
  const noiseGain = audioCtx.createGain();
  noiseGain.gain.value = 0.4;
  noiseSrc.connect(noiseFilter).connect(noiseGain).connect(masterGain);
  noiseSrc.start(t);
}

// Theme management — driven by state.
function applyAudioState(state) {
  if (!audioReady || !themeAudio || !state) return;
  const targetVol = Math.max(0, Math.min(1, state.audio.themeVolume ?? 0.7));
  if (Math.abs(themeAudio.volume - targetVol) > 0.005) {
    themeAudio.volume = targetVol;
  }
  const wantPlaying = state.audio.themePlaying && !state.audio.muted;
  if (wantPlaying && themeAudio.paused) {
    themeAudio.play().catch(() => { /* user hasn't clicked yet, gate handles it */ });
  } else if (!wantPlaying && !themeAudio.paused) {
    themeAudio.pause();
  }
}

// ----- State + render -----
function render(state) {
  // Diff sounds before mutating lastState
  fireSoundDiffs(state);
  lastState = state;
  renderFastMoneyDisplay(state);
  updateTimer();
  applyGameResult(state);

  els.nameLeft.textContent = state.teams[0].name.toUpperCase();
  els.nameRight.textContent = state.teams[1].name.toUpperCase();
  els.numLeft.textContent = state.teams[0].score;
  els.numRight.textContent = state.teams[1].score;

  const q = state.questions[state.currentQuestionIndex];
  const fast = state.mode === "fast_money";
  els.stage.hidden = fast;
  const playing = !fast && state.round.kind === "playing";

  els.stage.classList.toggle("idle", !playing);

  if (state.reveal.questionVisible && q) {
    els.questionText.textContent = q.text;
    els.questionBanner.classList.remove("hidden");
  } else {
    els.questionText.textContent = "Get ready…";
  }

  els.pot.textContent = playing ? state.round.pot : 0;

  els.board.innerHTML = "";
  const answers = q?.answers ?? [];
  for (let i = 0; i < answers.length; i++) {
    const a = answers[i];
    const slot = document.createElement("div");
    slot.className = "slot";
    if (a?.revealed) slot.classList.add("revealed");
    slot.innerHTML = `
      <div class="slot__num">${i + 1}</div>
      <div class="slot__answer">${a ? escapeHtml(a.text) : ""}</div>
      <div class="slot__points">${a ? a.points : ""}</div>
    `;
    els.board.appendChild(slot);
  }

  if (playing && state.round.strikeFlash > lastStrikeFlash) {
    lastStrikeFlash = state.round.strikeFlash;
    flashStrikes(state.round.strikes);
  }
  const buzzFlash = playing ? (state.round.buzzFlash ?? 0) : 0;
  if (playing && buzzFlash > lastBuzzFlash) {
    lastBuzzFlash = buzzFlash;
    flashBuzz();
  }
  if (!playing && !fast) { lastStrikeFlash = 0; lastBuzzFlash = 0; }

  applyAudioState(state);
  applyInstructions(state);
}

function applyGameResult(state) {
  els.gameResult.hidden = !state.gameOver || state.mode === "fast_money";
  if (els.gameResult.hidden) return;
  const [left, right] = state.teams;
  const tied = left.score === right.score;
  els.resultTitle.textContent = tied ? "IT'S A TIE!" : "WINNER";
  els.resultWinner.textContent = tied ? "HONORS EVEN" : (left.score > right.score ? left.name : right.name);
  state.teams.forEach((team, i) => {
    els.resultNames[i].textContent = team.name;
    els.resultScores[i].textContent = team.score;
    els.resultTeams[i].classList.toggle("is-winner", tied || team.score > state.teams[1 - i].score);
  });
}

function updateTimer() {
  const endsAt = lastState?.mode === "fast_money"
    ? (lastState.fastMoney?.endsAt ?? null) : (lastState?.timer?.endsAt ?? null);
  els.timer.hidden = endsAt === null;
  if (endsAt === null) return;
  const seconds = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
  els.timerValue.textContent = `0:${String(seconds).padStart(2, "0")}`;
  els.timer.classList.toggle("is-expired", seconds === 0);
}
setInterval(updateTimer, 100);

function applyInstructions(state) {
  const ins = state.instructions;
  if (!ins) return;
  els.instructions.hidden = !ins.visible;
  const page = Math.max(0, Math.min(ins.total - 1, ins.page));
  els.instructionsPages.forEach((el) => {
    el.classList.toggle("is-active", Number(el.dataset.page) === page);
  });
  if (els.instructionsPageNum) {
    els.instructionsPageNum.textContent = `${page + 1} / ${ins.total}`;
  }
}

function fireSoundDiffs(state) {
  if (state.mode === "fast_money") return;
  if (!lastState) {
    // First state — initialize the revealed map without firing sounds
    const q = state.questions[state.currentQuestionIndex];
    if (q) {
      const set = new Set();
      q.answers.forEach((a, i) => { if (a.revealed) set.add(i); });
      lastRevealed.set(q.id, set);
    }
    return;
  }
  const q = state.questions[state.currentQuestionIndex];
  if (q) {
    const prev = lastRevealed.get(q.id) ?? new Set();
    const next = new Set();
    q.answers.forEach((a, i) => { if (a.revealed) next.add(i); });
    // Newly revealed
    for (const i of next) if (!prev.has(i)) playReveal();
    lastRevealed.set(q.id, next);
  }
  // Strike sound
  if (
    state.round.kind === "playing" &&
    lastState.round.kind === "playing" &&
    state.round.strikeFlash > lastState.round.strikeFlash
  ) {
    playStrike();
  } else if (
    state.round.kind === "playing" &&
    lastState.round.kind !== "playing" &&
    state.round.strikeFlash > 0
  ) {
    // round (re)started with strikes recorded — don't replay
  }
}

function flashStrikes(count) {
  const xs = els.strikes.querySelectorAll(".x");
  xs.forEach((x, i) => {
    x.style.visibility = i < count ? "visible" : "hidden";
  });
  els.strikes.hidden = false;
  els.strikes.style.animation = "none";
  void els.strikes.offsetWidth;
  els.strikes.style.animation = "";
  setTimeout(() => { els.strikes.hidden = true; }, 1600);
}

// Wrong-answer buzz (face-off) — single X, shorter flash, same buzzer sound.
function flashBuzz() {
  const xs = els.strikes.querySelectorAll(".x");
  xs.forEach((x, i) => {
    x.style.visibility = i === 0 ? "visible" : "hidden";
  });
  els.strikes.hidden = false;
  els.strikes.style.animation = "none";
  void els.strikes.offsetWidth;
  els.strikes.style.animation = "";
  playStrike();
  setTimeout(() => { els.strikes.hidden = true; }, 900);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ----- Audio gate (browser autoplay restriction) -----
function dismissGate() {
  initAudio();
  if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
  els.gate?.classList.add("dismissed");
  setTimeout(() => els.gate?.remove(), 400);
}
els.gate?.addEventListener("click", dismissGate);
window.addEventListener("keydown", (e) => {
  if (e.key === " " || e.key === "Enter") dismissGate();
});

socket.on("state", render);
socket.on("connect", () => console.log("display connected"));
socket.on("disconnect", () => console.log("display disconnected"));
