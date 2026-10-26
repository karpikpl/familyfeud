# Family Feud Live

Host a Family Feud-style game from your laptop and run it from your phone. Two screens, one Node/TypeScript process, WebSocket sync, SQLite so a crash mid-game doesn't lose anything.

- **Port 3000 — Audience display.** Big oval board, team scores, pot, strikes overlay, theme music, ding and buzzer sound effects. Open on the laptop you're projecting.
- **Port 4000 — Game master admin.** Reveal answers, mark strikes, award the pot, edit team names, jump between questions, mute or unmute. Built for a phone.

Both screens stay in sync over Socket.IO. If the server dies mid-round, restart it and you're back exactly where you were.

<table>
<tr>
<td valign="top" width="65%">
<b>Audience display</b> — project this on the big screen.<br><br>
<img src="docs/screenshots/frontend.jpg" alt="Audience display: oval Family Feud-style board with gold frame, question banner, team score pills" />
</td>
<td valign="top" width="35%">
<b>Admin</b> — run this from your phone.<br><br>
<img src="docs/screenshots/admin.jpg" alt="Admin UI: theme volume slider, two team cards, instructions controls, round controls" />
</td>
</tr>
</table>

## Setup

```bash
cd familyfeud
npm install
npm run build
npm start
```

Then:

- Audience: <http://localhost:3000>  (project / share screen)
- Admin:    <http://localhost:4000>  (open on your phone)

For phone access on the same Wi-Fi, use `http://<your-mac-ip>:4000`. On macOS, `ipconfig getifaddr en0` gives you the IP. If you need to reach the admin from outside your LAN, point any tunnel of your choice at port 4000.

## Docker

```bash
docker build -t familyfeud .
docker run -d --name familyfeud \
  -p 3000:3000 -p 4000:4000 \
  -v familyfeud-data:/app/data \
  familyfeud
```

Open the same audience and admin URLs above. Stop with `docker stop familyfeud`; restart with `docker start familyfeud`. The named volume keeps game state when the container is removed and recreated. This starts a separate game; it does not import your local `familyfeud.db`.

The image runs as a non-root user and includes only the Standard and Fast Money template CSVs, not local questions, databases, or audio. To use your own files, add read-only bind mounts before the final `familyfeud` image name:

```bash
--mount type=bind,src="$(pwd)/questions.csv",dst=/app/questions.csv,readonly
--mount type=bind,src="$(pwd)/audio/sfx",dst=/app/audio/sfx,readonly
```

Mount additional CSVs as individual files under `/app/` to make them available in the admin dropdown. Create the source files/directories first and make them readable by the container user. Saved state takes precedence over CSV contents; select or reload the CSV in admin to apply changes.

Both ports must be free on the host; if you're already running the app locally, use `-p 3001:3000 -p 4001:4000` and open ports 3001/4001 instead. Keep admin access on a trusted network; it has no authentication.

## Questions CSV

Put question CSV files in the project root, then choose one from the admin's **Question CSV** dropdown. Standard and Fast Money remember separate selections. Format:

```csv
question,answer,points
Name something you find in a kitchen,Refrigerator,38
Name something you find in a kitchen,Stove,22
...
```

- Rows with the same `question` value are grouped into one round.
- Answers are sorted by points (highest on top), Family Feud style.
- Use **Refresh list** after adding files. **Reload CSV** re-reads the current mode's selected file.
- Selecting or reloading a Standard CSV clears the current round and unawarded pot, but keeps team names and scores.
- Selecting or reloading a Fast Money CSV resets Fast Money only. It needs at least five questions; the first five are used.
- `questions.fast-money.template.csv` is a playable starter with illustrative points, not real survey results.

## Game flow

1. Set team names in the admin (e.g. "The Smiths" / "The Joneses").
2. Pick a question from the dropdown.
3. **Start Round** — the question lights up on the audience screen, board hides answers.
4. As contestants answer, hit **Reveal** on the answer they said. Points add to the pot.
5. Wrong answer during a round? Hit **✕ Strike**. Three Xs flash on the audience screen and the buzzer plays.
6. Wrong answer during the face-off (where the first wrong answer doesn't count as a strike on the show)? Hit **🔊 Buzz** instead. Same sound, no strike counted.
7. **Award pot →** sends the round's pot to whichever team won.
8. **Next ▶** advances to the next question.
9. Award the final pot, then **End Game & Show Winner**. **Resume Game** allows corrections.

## Fast Money

Use the **Standard / Fast Money** switch in the admin header. Both modes keep independent progress and CSV selections; Fast Money never changes Standard team scores.

1. Select a Fast Money CSV. Keep Player 2 out of earshot during Player 1's questions and reveals.
2. **Start Player 1** begins 20 seconds. Read each question from the admin and use **Next** after an answer or **Pass** to leave it pending and advance. After the first five, only passed questions repeat, as often as needed while time remains. A separate recorder writes down the answers; the audience sees the timer, not the questions or answers.
3. When all five questions are answered or time runs out, the admin moves to answer entry automatically. You can also finish early with **Enter answers**. Match the notes to survey answers, or enter custom text and points, then click **Save Answers** once to save all five together. Unanswered passes default to 0 points, while a pass answered on a later lap needs its actual answer entered.
4. Choose **Ready to reveal on TV**, then **Reveal next answer** for each answer.
5. **Prepare Player 2** hides the first player's answers and prepares the same questions with 25 seconds. Use **Duplicate answer buzzer** during questioning; duplicate survey matches or repeated answer text are also rejected when scoring.
6. Enter and reveal Player 2's answers. A combined 200 points wins; otherwise the display shows the final total. **Edit this player's answers** allows corrections.

When scoring, **Pass** and **Miss** are separate choices worth 0 points. Pass reveals as **PASS**; Miss reveals only a centered red **X**, without answer text. The entered wrong answer is kept in admin.

Switching modes during questioning stops the Fast Money timer and moves to answer entry. **Reset Fast Money** clears its answers and timing without changing Standard scores.

## Sound

The audience screen plays:

- 🎵 **Theme song** — drop an audio file at `audio/sfx/theme.m4a` and the server will serve it at `/theme.m4a` (looped). The Family Feud theme is copyrighted by its rightsholders and not bundled here — bring your own. (`.m4a`, `.mp3`, `.wav`, `.ogg` all work if you adjust the filename or the route in `src/server.ts`.)
- 🛎 **Reveal "ding"** — synthesized in-browser (Web Audio bell stack) every time you reveal an answer.
- 🔊 **Strike "EH-EH-EH" buzzer** — synthesized in-browser every time you click ✕ Strike.

Browsers block audio autoplay, so the audience screen shows a one-time **"Click anywhere to start"** gate — click or hit space/enter to enable sound.

The admin has two audio buttons:

- **🎵 Theme: ON/OFF** — toggle the theme music.
- **🔊 / 🔇 Muted** — global mute (silences everything, theme + sound effects).

Both are part of game state and persist across restart.

## Persistence

State is saved to `familyfeud.db` (SQLite, WAL mode) after every command. If the server crashes mid-game, restart it with `npm start` and you'll come back exactly where you were: same question, same revealed answers, same pot, strikes, scores, team names.

- `DB_PATH=/some/path npm start` to put the DB elsewhere.
- **Reload CSV** re-reads the selected file for the active mode, keeping Standard team names and scores.
- **Reset Game** (admin) clears scores/reveals but keeps team names. Also persisted.
- To wipe everything and start clean: stop the server, `rm familyfeud.db*`, restart.

## Dev

```bash
npm run dev   # tsc --watch + nodemon
npm test      # build + Node's built-in tests for state, Fast Money, and CSV validation
```

## How this compares to other open-source Family Feud projects

There are a handful of Family Feud implementations on GitHub. Quick lay of the land:

| Project | Stars | Stack | Shape |
|---|---|---|---|
| [joshzcold/Friendly-Feud](https://github.com/joshzcold/Friendly-Feud) | ~135 | Next.js + Go, Docker | Hosted multi-room with join codes, separate `/admin` + `/buzzer`, Fast Money, i18n. The polished, full-featured option. |
| [MacEvelly/Family_Feud](https://github.com/MacEvelly/Family_Feud) | ~14 | Node + Express + Socket.io | Two-browser host/audience model. Closest architectural sibling to this. No persistence, no sound, no Fast Money. |
| [PierPlayss/Family-Feud](https://github.com/PierPlayss/Family-Feud) | ~10 | C++/SDL2 native | Argentinian variant, OBS-friendly. No web, no networking. |
| [tiwoc/clan-contest](https://github.com/tiwoc/clan-contest) | ~9 | Vanilla HTML5 | Pure browser, no server. Two-window control + projector via `postMessage`. Sound effects, GPL3. |
| [ChicagoBlend/Family-Feud](https://github.com/ChicagoBlend/Family-Feud) | ~5 | jQuery | Single-screen keyboard-driven. Optional WebSocket hook for **physical hardware buzzers** — its standout feature. |
| [ebron-tech/FamilyFeud](https://github.com/ebron-tech/FamilyFeud) | ~2 | Unity/C# | Two native binaries over OSC + buzzer hardware schematic. Heavy, in-person church events. |

### Where this project is different

- **Properly separated admin and display over WebSocket.** Only Friendly-Feud does this seriously, and that one needs Docker, Go, and room-code lobbies. This is `npm install && npm start` in a single Node process.
- **SQLite crash recovery.** None of the projects above persist live game state. They all start fresh on reload. This one survives a kernel panic mid-round.
- **Mobile-first admin on a dedicated port.** Friendly-Feud's admin is responsive but built desktop-first. The others assume the host is at a keyboard. Yours runs from a phone.
- **Synthesized Web Audio SFX (no asset shipping).** Most projects ship `.ogg` or `.mp3` files. The ding and buzzer here are math, not media. Cleaner repo, no licensing headaches.
- **Looks like the actual TV show.** Oval board, gold frame, animated tile flips, score pills. Most projects look utilitarian.

### What this project doesn't do

- **No multi-room or remote play.** Friendly-Feud's join-code system lets strangers play over the internet. This is LAN-only on purpose.
- **No physical hardware-buzzer integration.** ChicagoBlend and ebron-tech both support this.
- **No i18n.** Friendly-Feud ships four languages.

If you want a hosted, feature-complete product, use Friendly-Feud. If you want something lightweight you can throw on your laptop in five minutes that looks like the show, use this.

## License

[MIT](./LICENSE) © Conrad Chu. Note: any media files you place under `audio/sfx/` are not covered by this license — they remain the property of their respective rightsholders.
