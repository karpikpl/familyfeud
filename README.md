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

### Published image

The **Container image** GitHub Actions workflow builds the existing Dockerfile on
pushes and pull requests to `main`, or when run manually. Only runs on the default
branch publish to GHCR using `GITHUB_TOKEN`; pull requests and manual runs on other
branches build without publishing or logging in to the registry.

Images are published as `ghcr.io/conradchu/familyfeud:latest` and
`ghcr.io/conradchu/familyfeud:sha-<short-commit>`. Forks use their own lowercase
owner/repository name. To run the published image with persistent game state:

```bash
docker run -d --name familyfeud \
  -p 3000:3000 -p 4000:4000 \
  -v familyfeud-data:/app/data \
  ghcr.io/conradchu/familyfeud:latest
```

The repository must allow GitHub Actions to write packages. New GHCR packages may
be private; a package administrator can make the package public for anonymous
pulls, or users can authenticate to GHCR with a token granting `read:packages`.

### Build locally

```bash
docker build -t familyfeud .
docker run -d --name familyfeud \
  -p 3000:3000 -p 4000:4000 \
  -v familyfeud-data:/app/data \
  familyfeud
```

Open the same audience and admin URLs above. Stop with `docker stop familyfeud`; restart with `docker start familyfeud`. The named volume keeps game state when the container is removed and recreated. This starts a separate game; it does not import your local `familyfeud.db`.

The image runs as a non-root user and includes the playable reviewed climbing and themed CSVs from `questions/`, not drafts, local questions, databases, or audio. To use your own files, add read-only bind mounts before the final `familyfeud` image name:

```bash
--mount type=bind,src="$(pwd)/questions",dst=/app/questions,readonly
--mount type=bind,src="$(pwd)/audio/sfx",dst=/app/audio/sfx,readonly
```

Place additional CSVs directly inside the mounted `questions/` folder to make them available in the admin dropdown. Subfolders are not scanned. Create the source files/directories first and make them readable by the container user. Saved state takes precedence over CSV contents; select or reload the CSV in admin to apply changes.

Both ports must be free on the host; if you're already running the app locally, use `-p 3001:3000 -p 4001:4000` and open ports 3001/4001 instead. Keep admin access on a trusted network; it has no authentication.

## Questions CSV

Put question CSV files directly inside `questions/`, then choose one from the admin's **Question CSV** dropdown. Standard and Fast Money remember separate selections. Root-level CSVs and subfolders are not scanned. Format:

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
- A new game starts with the first alphabetically sorted Standard CSV (a filename not ending in `.fast-money.csv`), or empty if none exists.
- Saved games retain their existing questions and scores. After replacing the old sets, select a new CSV in each mode; an old saved filename cannot be reloaded once its file is removed.
- Use `questions/local*.csv` for gitignored host-specific banks.

### Reviewed climbing sets

The climbing CSVs come from `.collected/Climber-Survey-Review-groupped.xlsx`,
using real climber responses, assigned sets and question exclusions. Inline
instructions in Answer Review column E are applied, including answer merges
and wording edits. Unassigned questions are not exported. Earlier unreviewed
CSV banks have been replaced by these climbing sets and the reviewed themed
sets below.

All paths below are relative to `questions/`.

| Set | Standard CSV | Fast Money CSV |
|---|---|---|
| 1 | `climbing-01.csv` (5 questions) | `climbing-01.fast-money.csv` (5 questions) |
| 2 | `climbing-02.csv` (5 questions) | `climbing-02.fast-money.csv` (5 questions) |
| 3 | `climbing-03.csv` (5 questions) | `climbing-03.fast-money.csv` (5 questions) |
| 4 | `climbing-04.csv` (4 questions) | `drafts/climbing-04.fast-money.csv` (1 question; incomplete) |

Set 4 Fast Money remains a draft and is intentionally absent from the admin
dropdown and Docker image until it has five questions. The three complete
Fast Money sets can each be used with both players.

Scores are merged response counts divided by that question's nonblank response
count, multiplied by 100 and rounded once. Scores are not invented or adjusted
to make boards total 100. Excluded answers remain in the denominator. This is
a small sample (up to 14 respondents per question), not a 100-person survey.

`questions/manifest.json` records question IDs, response counts, merged answer
source rows and the workbook hash. Question order follows Position when present,
otherwise workbook order. Slash-separated equivalents are a single scoring
slot; match them to the same survey answer in Fast Money.

### Reviewed Halloween and funny/general sets

`Family-Feud-Themed-Sets-reviewed.xlsx` supplies **seven complete games**:
three Halloween and four funny/general. Each game has **five Standard questions
and five Fast Money questions**. All 70 included questions are used exactly once;
the 27 excluded questions, including reserves, are omitted. Existing climbing
sets are unchanged.

| Game | Theme | Standard CSV | Fast Money CSV |
|---|---|---|---|
| Halloween 01 | Spooky classics | `halloween-01.csv` | `halloween-01.fast-money.csv` |
| Halloween 02 | Trick-or-treat night | `halloween-02.csv` | `halloween-02.fast-money.csv` |
| Halloween 03 | Party monsters | `halloween-03.csv` | `halloween-03.fast-money.csv` |
| Funny General 01 | Everyday absurdities | `funny-general-01.csv` | `funny-general-01.fast-money.csv` |
| Funny General 02 | Daily mishaps | `funny-general-02.csv` | `funny-general-02.fast-money.csv` |
| Funny General 03 | Kids, pets and home | `funny-general-03.csv` | `funny-general-03.fast-money.csv` |
| Funny General 04 | Family game night | `funny-general-04.csv` | `funny-general-04.fast-money.csv` |

Paths are relative to `questions/`. The five original Daily Chaos Fast Money
questions (Q068-Q072) move into Standard to balance the games; the reviewed
workbook itself is unchanged. Answer wording and original points are preserved,
not normalized or replaced with survey estimates. These points are estimated,
unverified or AI-generated, **not results from our climber survey**.

`questions/themed-manifest.json` records final assignments, original stages,
exclusions, source caveats and the workbook hash.

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
