const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function display() {
  const elements = new Map();
  const listeners = new Map();
  const xs = Array.from({ length: 3 }, () => ({ hidden: false, style: {} }));
  const timeouts = new Map();
  let nextTimeout = 0;
  const document = {
    documentElement: {},
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, {
        hidden: true,
        style: {},
        attributes: {},
        setAttribute(name, value) { this.attributes[name] = value; },
        addEventListener() {},
        querySelectorAll: () => id === "strikes" ? xs : [],
      });
      return elements.get(id);
    },
    querySelector: () => ({}),
    querySelectorAll: () => [],
    addEventListener: (name, handler) => listeners.set(name, handler),
  };
  const context = vm.createContext({
    document,
    window: { addEventListener() {} },
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
  };
}

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
