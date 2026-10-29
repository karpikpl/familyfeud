const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function display() {
  const elements = new Map();
  const listeners = new Map();
  const document = {
    documentElement: {},
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, {
        hidden: true,
        attributes: {},
        setAttribute(name, value) { this.attributes[name] = value; },
        addEventListener() {},
      });
      return elements.get(id);
    },
    querySelector: () => ({}),
    querySelectorAll: () => [],
    addEventListener: (name, handler) => listeners.set(name, handler),
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../public/display/app.js"), "utf8"), {
    document,
    window: { addEventListener() {} },
    io: () => ({
      on() {},
      emit() { assert.fail("Display controls must not send game commands"); },
    }),
    setInterval() {},
  });
  return {
    document,
    button: elements.get("fullscreen"),
    error: elements.get("fullscreen-error"),
    listeners,
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
