const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const stateFns = require("../dist/state");

function classList() {
  const names = new Set();
  return {
    toggle(name, active) { active ? names.add(name) : names.delete(name); },
    remove(name) { names.delete(name); },
    contains(name) { return names.has(name); },
  };
}

function display() {
  const elements = new Map();
  const listeners = new Map();
  const xs = Array.from({ length: 3 }, () => ({ hidden: false, style: {} }));
  const strikeCountXs = Array.from({ length: 3 }, () => ({ classList: classList() }));
  const timeouts = new Map();
  let nextTimeout = 0;
  const document = {
    documentElement: {},
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, {
        hidden: true,
        style: {},
        classList: classList(),
        attributes: {},
        setAttribute(name, value) { this.attributes[name] = value; },
        addEventListener() {},
        querySelectorAll: () => id === "strikes" ? xs : [],
      });
      return elements.get(id);
    },
    querySelector: () => ({ classList: classList() }),
    querySelectorAll: (selector) => selector === "#strike-count .strike-count__x" ? strikeCountXs : [],
    addEventListener: (name, handler) => listeners.set(name, handler),
  };
  const context = vm.createContext({
    document,
    window: { addEventListener() {} },
    renderFastMoneyDisplay() {},
    io: () => ({
      on() {},
      emit() { assert.fail("Display controls must not send game commands"); },
    }),
    setInterval() {},
    setTimeout(handler) {
      timeouts.set(++nextTimeout, handler);
      return nextTimeout;
    },
    clearTimeout(id) { timeouts.delete(id); },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../public/display/app.js"), "utf8"), context);
  return {
    document,
    button: elements.get("fullscreen"),
    error: elements.get("fullscreen-error"),
    listeners,
    xs,
    timeouts,
    strikes: elements.get("strikes"),
    flashStrikes: vm.runInContext("flashStrikes", context),
    flashBuzz: vm.runInContext("flashBuzz", context),
    render: vm.runInContext("render", context),
    strikeCount: elements.get("strike-count"),
    strikeCountXs,
  };
}

test("audience strike counter persists after flashes and follows round resets and mode changes", () => {
  const { render, strikeCount, strikeCountXs, timeouts } = display();
  const state = stateFns.makeInitialState([{ id: 1, text: "Question", answers: [] }]);
  const renderState = () => render(structuredClone(state));
  const active = () => strikeCountXs.filter((x) => x.classList.contains("is-active")).length;
  renderState();
  assert.equal(strikeCount.hidden, true);
  stateFns.startRound(state);
  renderState();
  assert.equal(strikeCount.hidden, false);
  assert.equal(active(), 0);
  for (let count = 1; count <= 3; count++) {
    stateFns.addStrike(state);
    renderState();
    timeouts.values().next().value();
    assert.equal(strikeCount.hidden, false);
    assert.equal(active(), count);
    assert.equal(strikeCount.attributes["aria-label"], `${count} of 3 strikes`);
  }
  stateFns.clearStrikes(state);
  stateFns.addBuzz(state);
  renderState();
  assert.equal(active(), 0);
  stateFns.addStrike(state);
  renderState();
  stateFns.setMode(state, "fast_money");
  renderState();
  assert.equal(strikeCount.hidden, true);
  stateFns.setMode(state, "standard");
  renderState();
  assert.equal(strikeCount.hidden, false);
  assert.equal(active(), 1);
  stateFns.startRound(state);
  renderState();
  assert.equal(active(), 0);
  stateFns.endGame(state);
  renderState();
  assert.equal(strikeCount.hidden, true);
});

test("audience fullscreen toggles locally and tracks browser-driven exits", async () => {
  const { document, button, listeners } = display();
  document.documentElement.requestFullscreen = async function () {
    assert.equal(this, document.documentElement);
    document.fullscreenElement = this;
  };
  document.exitFullscreen = async function () {
    assert.equal(this, document);
    document.fullscreenElement = null;
  };
  await button.onclick();
  assert.equal(button.attributes["aria-label"], "Exit fullscreen");
  assert.equal(button.attributes["aria-pressed"], "true");
  await button.onclick();
  assert.equal(document.fullscreenElement, null);
  assert.equal(button.attributes["aria-label"], "Enter fullscreen");
  await button.onclick();
  document.fullscreenElement = null;
  listeners.get("fullscreenchange")();
  assert.equal(button.attributes["aria-pressed"], "false");
});

test("strike flashes center only the active Xs and replace earlier hide timers", () => {
  const { flashStrikes, strikes, xs, timeouts } = display();
  flashStrikes(1);
  assert.equal(strikes.hidden, false);
  assert.deepEqual(xs.map((x) => !x.hidden), [true, false, false]);
  const firstTimeout = timeouts.keys().next().value;
  flashStrikes(2);
  assert.equal(timeouts.has(firstTimeout), false);
  assert.equal(timeouts.size, 1);
  assert.deepEqual(xs.map((x) => !x.hidden), [true, true, false]);
  timeouts.values().next().value();
  assert.equal(strikes.hidden, true);
});

test("a face-off buzz replaces a pending strike flash with a single X", () => {
  const { flashStrikes, flashBuzz, strikes, xs, timeouts } = display();
  flashStrikes(3);
  flashBuzz();
  assert.equal(strikes.hidden, false);
  assert.deepEqual(xs.map((x) => !x.hidden), [true, false, false]);
  assert.equal(timeouts.size, 1);
});

test("audience fullscreen supports Safari's prefixed API and change event", async () => {
  const { document, button, listeners } = display();
  document.documentElement.webkitRequestFullscreen = async function () {
    assert.equal(this, document.documentElement);
    document.webkitFullscreenElement = this;
  };
  document.webkitExitFullscreen = async function () {
    assert.equal(this, document);
    document.webkitFullscreenElement = null;
  };
  await button.onclick();
  assert.equal(button.attributes["aria-pressed"], "true");
  await button.onclick();
  assert.equal(document.webkitFullscreenElement, null);
  document.webkitFullscreenElement = document.documentElement;
  listeners.get("webkitfullscreenchange")();
  assert.equal(button.attributes["aria-label"], "Exit fullscreen");
});

test("fullscreen failures are visible and a successful retry clears the error", async () => {
  const { document, button, error } = display();
  await button.onclick();
  assert.equal(error.hidden, false);
  assert.match(error.textContent, /does not support fullscreen/);
  document.documentElement.requestFullscreen = async () => {
    throw new Error("Permission denied");
  };
  await button.onclick();
  assert.match(error.textContent, /Permission denied/);
  assert.equal(button.attributes["aria-pressed"], "false");
  document.documentElement.requestFullscreen = async () => {
    document.fullscreenElement = document.documentElement;
  };
  await button.onclick();
  assert.equal(error.hidden, true);
  assert.equal(button.attributes["aria-pressed"], "true");
});
