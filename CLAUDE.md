# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # one-time
npm run build        # tsc → dist/
npm test             # build + node --test tests/*.test.js
npm start            # node dist/server.js  (must run build first)
npm run dev          # tsc -w + nodemon on dist/, public/, questions/
```

Tests use Node's built-in runner. There is no linter or separate frontend build — `public/` is plain HTML/CSS/JS served as-is. Static frontend changes are picked up on a browser reload (no rebuild needed). TypeScript changes need `npm run build` (or `npm run dev`).

Override default ports / DB path with env: `DISPLAY_PORT`, `ADMIN_PORT`, `DB_PATH`.

## Architecture

### One process, two HTTP servers, one game state

`src/server.ts` boots two independent Express + Socket.IO servers on two ports inside a single Node process:

- **Display server, port 3000** — serves `public/display/`. The audience screen. Read-only over its socket: it only emits `state`, never accepts commands. Also serves the local theme audio file at `/theme.m4a` (mapped to `Family Feud Theme Song - 1 HOUR.m4a` in the project root).
- **Admin server, port 4000** — serves `public/admin/`. The game master UI (designed for phone). Accepts a typed `cmd` event and broadcasts state changes to *both* socket servers.

There is **one in-memory `state: GameState`** and one `broadcast()` that fans it out to both `displayIo` and `adminIo`. Every command goes through `handle(cmd) → persist() → broadcast()`. Treat the state object as the single source of truth: never mutate it from anywhere except the `handle` switch in `server.ts` (which delegates to mutators in `src/state.ts` and `src/fast-money.ts`).

### Command protocol

The full vocabulary is the `Cmd` discriminated union in `src/server.ts`. When adding a new admin action:

1. Add a variant to the `Cmd` union and a case in `handle()`.
2. If it touches state, add the mutator to `src/state.ts` (don't mutate state in `server.ts` directly except for trivial single-field writes — keep the pattern of pure mutator functions consistent).
3. Wire a button in `public/admin/index.html` and an `onclick` in `public/admin/app.js` that does `send({ type: "your_cmd", ... })`.
4. Update `public/display/app.js` `render()` to react if it should affect the audience screen.

The display never sends commands. Don't add a write path on `displayIo`.

### Persistence (SQLite)

`src/persist.ts` wraps `better-sqlite3` and stores the entire `GameState` as a single JSON blob in a one-row table (`state` table, `id=1`). After every successful command in `adminIo.on("connection") → "cmd"`, `persist()` runs synchronously. On boot, `store.load()` returns the saved state if present (else falls back to `makeInitialState(questions)` from CSV).

**Schema migrations:** when adding new fields to `GameState`, add a backfill in `migrateState()` in `src/state.ts` and call it on the loaded state. This is what protects users running an older game against new server code (`audio` block was the first migration).

There's no schema versioning beyond defensive backfills. If you need a structural change incompatible with old data, document that users should `rm familyfeud.db*` before upgrading.

`SIGINT`/`SIGTERM`/`uncaughtException` flush state and close the DB cleanly.

### CSV → questions

`src/csv.ts` parses the question CSV (columns: `question`, `answer`, `points`). Rows with the same `question` text are grouped into one `Question`; answers are sorted highest-points first. Saved state wins over CSV contents on boot. The admin lists real `.csv` files directly inside `questions/` through `list_csv_files`; `select_csv` and `reload_csv` validate filenames against this list before loading. Subfolders such as `questions/drafts/` are not selectable. Standard and Fast Money persist separate filenames and question banks. Selecting/reloading Standard clears its round, not team names or scores; Fast Money clears only its own progress.

On a fresh game, `src/server.ts` loads the first alphabetically sorted CSV in `questions/` that does not end in `.fast-money.csv`; if none exists, it starts empty. Root-level CSVs are not loaded. `questions/local*.csv` is gitignored for host-specific banks. Reviewed climbing and themed exports and their provenance are in `questions/`; unfinished Fast Money sets stay in `questions/drafts/`.

`reset_game` rebuilds state while preserving both CSV selections/question banks, team names, audio and instructions. `reload_csv` instead delegates to `setQuestions` or `loadFastMoney` and preserves Standard scores.

### Fast Money

`state.mode` selects `standard` or `fast_money`. `state.fastMoney` owns its questions, two sets of five responses, per-player question status, current player, question index, absolute timer deadline, and `setup → asking → scoring → reveal → finished` progression. Player 1 gets 20 seconds; Player 2 gets 25. Next marks the current question answered; Pass keeps it pending. Navigation cycles past answered questions without resetting the deadline. Answering all five or server-side expiry moves to scoring. The host advances questions while a recorder takes notes, then enters answers in scoring. Survey indices enforce equivalent-answer duplicates, normalized text catches literal duplicates, and rejected duplicates increment `buzzFlash` without saving the response.

`public/{admin,display}/fast-money.js` are global scripts loaded before their respective `app.js`. Only revealed responses contribute to the audience total. Player 1's results are hidden during Player 2 setup, questions, and scoring. Mode switching preserves both games, but stops an active Fast Money timer and moves to scoring.

### Audio (display-only)

All audio plays on the display browser at port 3000. The admin device is silent.

- **Theme** (`audio/sfx/theme.m4a`, gitignored — bring your own): served at `/theme.m4a`, played via a looped `<audio>` element in `public/display/app.js`.
- **Reveal "ding"** and **strike "buzzer"**: synthesized live via Web Audio API in `public/display/app.js` (no audio files). If you change synth params, both functions are commented (`playReveal`, `playStrike`).

The display fires sounds by *diffing* incoming state against `lastState`: a newly-true `answer.revealed` → ding; a higher `round.strikeFlash` counter → buzzer. `strikeFlash` increments on every strike command (separate from the strike *count*) so repeated 3rd strikes still trigger the X overlay + buzz. Don't repurpose `strikeFlash` for anything else.

Browsers block autoplay; the display has a one-time "click to start" gate (`#audio-gate`) that must be dismissed before audio works. Admin toggles `state.audio.muted` and `state.audio.themePlaying`; the display reacts via `applyAudioState()`.

### Frontend conventions

- No build step, no framework, no module system. `public/{display,admin}/app.js` are global scripts loaded after `socket.io.js`.
- Both clients render purely from `state` snapshots received over Socket.IO — no client-side state machine. The admin holds `lastState` only to compose the next command (e.g., toggle mute = `{ muted: !lastState.audio.muted }`).
- The admin uses safe-area-aware page padding (`env(safe-area-inset-*)`) and a `max-width: 720px` `.app` container — preserve this when adding sections so iPhone layout stays correct.

## Sharing the admin to a phone

Same Wi-Fi: `http://<mac-ip>:4000`.

Tailscale: `tailscale serve --bg --https=4000 http://localhost:4000` (gives an HTTPS tailnet URL).
