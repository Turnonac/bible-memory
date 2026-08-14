# Verse by Heart

A scripture memorization tool. `index.html` is the whole product: one
self-contained page, published as a Claude Artifact.

**Published at `https://claude.ai/code/artifact/a8cc5bc3-f1af-46ba-98af-3bf2ed398794`.**
Republishing must pass that URL as the `url` argument, or it creates a second
artifact and the user's link goes stale.

## Source layout

`index.html` is generated, not hand-edited. The sources live in `src/`:
`src/style.css`, `src/markup.html`, `src/app.js`. Edit those, then run
`npm run build` to reassemble `index.html` — `build.mjs` is a zero-dependency
Node script (no bundler, no runtime dependency added). `test/build.mjs` fails
if `index.html` and a fresh build of `src/` disagree, so a forgotten build
before commit shows up as a test failure, not a silent drift. Always run
`npm run build` and commit the regenerated `index.html` alongside any `src/`
change — the Artifact publishes `index.html` itself, not `src/`.

## The idea the design rests on

The verse keeps its exact layout in every mode while the ink drains out of it.
Hidden words stay in the DOM at full width and turn transparent, so blanks land
exactly where the words were and the passage never reflows. The reader's spatial
memory of the page survives the drill. **Anything that makes the text reflow
between modes breaks the core idea** — there is a test for it.

Four modes: Read, Veil (hide 25/50/75/100%, levels nest so raising the veil
keeps what was already hidden), Initials (first letters only), Recite (type from
memory, graded by LCS word alignment).

A recall score grades into an SM-2 interval, so the deck schedules itself: each
verse carries `ease`, `reps`, `interval`, and `due`, the review queue above the
deck says what is waiting, and the page opens on that queue.

Revealing a hidden word restores it in rubric red and it stays red, so a finished
drill shows exactly which words needed help. That marking is a feature, not a
styling detail.

## Invariants

- **One file, no external requests.** A strict CSP blocks every external host —
  no CDN fonts, scripts, or images. Inline everything. No `<!doctype>`, `<html>`,
  `<head>`, or `<body>` tags: the Artifact host supplies the skeleton.
- **Scripture is graded against, so it must be exact.** Starter passages are
  King James Version, verified against the 1769 text by `test/verify-kjv.mjs`.
  Never edit a passage by hand — change it and re-run that test.
- **Three theme states, not two.** An explicit choice stamps
  `data-theme="light|dark"`; the default "system" setting stamps nothing. Define
  the full light palette on bare `:root`, then redefine only tokens under
  `@media (prefers-color-scheme: dark)` guarded as `:root:not([data-theme="light"])`,
  and again under `:root[data-theme="dark"]`. A colour whose only definition sits
  inside a media or `[data-theme]` block never applies in the un-stamped state.
- **Progress is the user's.** `localStorage` under `verse-by-heart:v1`. Changing
  the shape requires a migration path — people have real practice history in it.
  The key name is now fixed; the payload carries its own `schema` number instead,
  and `migrate()` in `src/app.js` upgrades anything older on load. Bump `SCHEMA`,
  add a branch to `migrate()`, and add a test that loads the *old* payload and
  comes out intact — `test/ui.mjs` already does this for v1. Everything read off
  disk goes through `normalizeVerse()` first, so a hand-edited or truncated field
  can't reach the scheduler.

- **Only a due review moves the schedule.** Reciting a verse that isn't due yet
  is practice: it counts as an attempt and feeds the streak, but it must not
  advance the SM-2 ladder. Grading every press compounds the interval — four taps
  of "Check my recall" would file a fresh verse six weeks out. There is a test.

## Traps already hit once

- **Chromium blockifies `<button>` to `inline-block`.** Setting `display:inline`
  on a button does not stick. Revealable words are `<span role="button" tabindex="0">`
  for that reason; as buttons, every blank stretched to the full line box and the
  page looked redacted.
- **`[hidden]` loses to any component rule that sets `display`.** There is a
  global `[hidden] { display: none !important }` guard. Removing it makes the
  "Mastered" seal appear on untouched verses.
- **Padded recall must not score 100%.** Words not in the verse count against the
  denominator, otherwise vague answers reach mastery.

## Tests

```sh
npm install     # npm is reachable; this is fine to run every session
npm test        # build fidelity + KJV fidelity + UI behaviour, ~150 checks
npm run build   # regenerate index.html from src/ after editing src/
```

`test/` is mutation-tested — every check in it fails when the behaviour it
guards is broken. Keep it that way: when you fix a bug, add the check that would
have caught it, then confirm it fails against the unfixed code.

## Sandbox constraints

- **Network is allowlisted.** npm, PyPI, and GitHub work. Everything else is
  blocked — including every hosting API (Vercel, Supabase, Fly, Netlify, Render,
  Cloudflare) and all Bible APIs. Scripture comes from the `kjv` npm package.
- **Never run `playwright install`.** Chromium is pre-installed under
  `/opt/pw-browsers`; the download CDN is outside the policy. `test/harness.mjs`
  resolves the binary — use `launch()` from there.
- **Deployment cannot happen from this sandbox.** Anything that needs to reach a
  host must run from GitHub Actions with repo secrets, since GitHub is reachable
  and the sandbox is not.
- `psql` and `docker` are available locally, so a real backend can be built and
  integration-tested here even though it cannot be deployed from here.

## Working agreement

- Branch from `main`, one PR per run, named `claude/<yyyy-mm-dd>-<slug>`.
- `npm test` must pass before opening a PR. Never weaken a test to make it pass.
- Work the top of `ROADMAP.md` first. Log what happened in `WORKLOG.md`.
- Prefer finishing one item well over starting three.
