const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync } = require("node:fs");
const { once } = require("node:events");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const csv = require("../dist/csv");

async function reservePort() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server;
}

async function request(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(5000) });
  assert.ok(response.ok, `HTTP ${response.status}`);
  return response.text();
}

test("server starts from questions/ and catalogs, selects and reloads its playable files", async (t) => {
  const root = path.join(__dirname, "..");
  const dir = mkdtempSync(path.join(os.tmpdir(), "familyfeud-server-"));
  const reservations = await Promise.all([reservePort(), reservePort()]);
  const [displayPort, adminPort] = reservations.map(server => server.address().port);
  await Promise.all(reservations.map(server => new Promise(resolve => server.close(resolve))));
  const child = spawn(process.execPath, ["dist/server.js"], {
    cwd: root,
    env: { ...process.env, DISPLAY_PORT: String(displayPort), ADMIN_PORT: String(adminPort), DB_PATH: path.join(dir, "game.db") },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", data => { output += data; });
  child.stderr.on("data", data => { output += data; });
  t.after(async () => {
    if (child.exitCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      await exited;
    }
    rmSync(dir, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Server did not start: ${output}`)), 10000);
    child.once("exit", code => {
      clearTimeout(timer);
      reject(new Error(`Server exited (${code}): ${output}`));
    });
    child.stdout.on("data", () => {
      if (output.includes("[admin]")) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
  assert.equal(JSON.parse(await request(`http://127.0.0.1:${displayPort}/health`)).role, "display");
  assert.equal(JSON.parse(await request(`http://127.0.0.1:${adminPort}/health`)).role, "admin");

  const base = `http://127.0.0.1:${adminPort}/socket.io/?EIO=4&transport=polling`;
  const handshake = await request(base);
  const { sid } = JSON.parse(handshake.slice(1));
  const url = `${base}&sid=${encodeURIComponent(sid)}`;
  const post = body => request(url, { method: "POST", headers: { "Content-Type": "text/plain" }, body });
  const pending = [];
  async function event(name) {
    for (let attempt = 0; attempt < 10; attempt++) {
      const index = pending.findIndex(item => item[0] === name);
      if (index >= 0) return pending.splice(index, 1)[0][1];
      for (const packet of (await request(url)).split("\x1e")) {
        if (packet === "2") await post("3");
        if (packet.startsWith("42")) pending.push(JSON.parse(packet.slice(2)));
      }
    }
    throw new Error(`Missing socket event ${name}`);
  }
  const send = cmd => post(`42${JSON.stringify(["cmd", cmd])}`);
  await post("40");
  const files = await event("csv_files");
  assert.deepEqual(files, csv.listQuestionFiles(path.join(root, "questions")));
  assert.ok(files.includes("climbing-01.csv"));
  assert.ok(!files.some(name => name.includes("drafts") || name === "climbing-04.fast-money.csv"));
  const initial = await event("state");
  assert.equal(initial.questionFile, "climbing-01.csv");
  assert.equal(initial.questions.length, 5);
  await send({ type: "select_csv", mode: "standard", filename: "climbing-04.csv" });
  assert.equal((await event("state")).questions.length, 4);
  await send({ type: "reload_csv" });
  assert.equal((await event("state")).questionFile, "climbing-04.csv");
  await send({ type: "set_mode", mode: "fast_money" });
  await event("state");
  await send({ type: "select_csv", mode: "fast_money", filename: "climbing-02.fast-money.csv" });
  const money = await event("state");
  assert.equal(money.fastMoney.questions.length, 5);
  assert.equal(money.questionFile, "climbing-04.csv");
  await send({ type: "select_csv", mode: "fast_money", filename: "funny-general-04.fast-money.csv" });
  assert.equal((await event("state")).fastMoney.questions.length, 5);
  await send({ type: "set_mode", mode: "standard" });
  await event("state");
  await send({ type: "select_csv", mode: "standard", filename: "halloween-01.csv" });
  const themed = await event("state");
  assert.equal(themed.questionFile, "halloween-01.csv");
  assert.equal(themed.questions.length, 5);
  await send({ type: "set_mode", mode: "fast_money" });
  await event("state");
  await send({ type: "select_csv", mode: "fast_money", filename: "drafts/climbing-04.fast-money.csv" });
  assert.match(await event("error_msg"), /server's list/);
});
