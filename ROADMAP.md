# Roadmap

Worked top-down. The nightly run takes the first unchecked item in **Now**,
finishes it, and opens a PR. When **Now** empties it promotes from **Next**; if
both are empty it proposes new work and records the reasoning in `WORKLOG.md`.

Kevin steers by editing this file. Reordering it reorders the work.

**Direction:** grow into a real app — accounts, cross-device sync, a searchable
verse library. The single-file Artifact stays the shop window; it stops being
the whole product.

---

## Now

_Empty — promote from Next._

## Next

- [ ] **Printable drill sheets.** A print stylesheet emitting veiled and
  first-letter worksheets. Memorization happens away from screens.

- [ ] **Work the queue without going back to it.** Grading a due verse leaves you
  on that verse; getting to the next one means scrolling to the deck and pressing
  "Review now" again. A session should hand you the next due verse when you
  finish one, and say so when the queue empties.

- [ ] **The deck grid leaves a gap on a small deck.** `.cards` is an `auto-fill`
  grid over a ruled background, so a deck of one or two verses shows a wide empty
  band of `--rule` beside them. Pre-existing, only visible once you remove most
  of the starter deck. Cheap fix, worth doing alongside other deck work.

- [ ] **Bound the recite-alignment input.** `align()` in `src/app.js` runs an
  O(n·m) LCS over the reference and typed words with no size cap. Custom verse
  creation and import both accept arbitrary-length text, so a large pasted
  passage plus a long attempt can allocate a very large matrix in the tab.
  Enforce a shared word-count limit before `compare()` runs, across manual
  entry, import, and anything already in storage. (Flagged by CodeRabbit on
  PR #1; pre-existing behaviour, not a regression from the `src/` extraction —
  scoped out of that PR to keep it a pure refactor.)

## Later — needs a decision from Kevin first

These are blocked on choices only he can make. Do not start them unsolicited;
raise them in a PR description or `WORKLOG.md` when the items above run low.

- [ ] **Backend: accounts and sync.** Buildable and fully testable in the sandbox
  (`psql` and `docker` are available) but **not deployable from it** — every
  hosting API is outside the network policy. The workable shape is: build the API
  and schema here with integration tests, deploy via GitHub Actions using repo
  secrets, since GitHub is reachable and the sandbox is not. Needs from Kevin:
  a host, and secrets added to the repo. Until then, prefer local-first work that
  makes sync easy later rather than sync itself.

- [ ] **Translations beyond the KJV.** Almost every modern translation is under
  copyright; shipping one is a licensing decision, not an engineering one.
  Public-domain options that need no permission: WEB, ASV, YLT, Douay-Rheims.

## Done

- [x] Deck sharing by URL. A "Share deck" button base64's the deck's
  ref/text pairs (no progress, no schedule) into the page's own
  `location.hash` and shows the resulting link for the user to copy —
  no backend, no capability grant. Opening that link shows a banner
  offering to add whatever's new (by reference, case-insensitive; verses
  the recipient already has are skipped), or to dismiss it; either way the
  hash is consumed so a reload doesn't re-prompt. Capped at 200 verses on
  both the encode and decode side, so a link this page builds is always one
  it (or anyone else's) can read back rather than failing as "broken" past
  the limit. **Not verifiable from this sandbox:** whether the published
  Artifact's outer address (`https://claude.ai/code/artifact/...`) actually
  forwards its `#deck=...` fragment into the sandboxed iframe this page runs
  in — deployment is out of the sandbox's network policy, and the test
  harness only proves the mechanism itself (encode/decode, the banner,
  dedup, the hash-consumption) on a plain top-level page. If the fragment
  doesn't reach the frame on the live page, Share deck's copied link will
  work for anyone pasting it as a fresh top-level URL, but the in-app
  "Add to my deck" banner won't fire — the same class of gap Export hit
  before the `downloads` capability existed, and worth checking the same
  way: try a real link on the published Artifact. *(2026-08-19)*
- [x] Add any verse by reference. `npm run gen:kjv` packs the whole 1769 KJV
  (66 books, 31,102 verses) into a gzip'd, base64'd `src/kjv-data.js` — 1.4 MB
  compressed, well inside the 16 MB artifact budget. "Add a verse of your own"
  gained a "Look up" button (and Enter-to-look-up) that resolves "Romans 8:28",
  "Romans 8:28-30", or a bare "Romans 8" for the whole chapter, decompressing
  client-side via `DecompressionStream` — absent outright where that API
  doesn't exist, same pattern as Speak It. Handles the KJV's own quirks: the
  data's "Psalms" displays as the app's usual singular "Psalm", "Song of
  Solomon" resolves via alias to the data's "Solomon's Song", and the five
  one-chapter books (Jude, Obadiah, Philemon, 2/3 John) read a bare number as
  a verse the way they're actually cited ("Jude 3"), not a chapter. *(2026-08-18)*
- [x] Recite aloud. A "Speak it" control in Recite mode uses the Web Speech
  API to capture a spoken attempt and grade it through the same
  `compare()`/`runCheck()` a typed attempt runs through. Hidden outright where
  the API doesn't exist (Firefox, most mobile) rather than showing a dead
  button. *(2026-08-17)*
- [x] Export uses the `downloads` capability, with a `<a download>` fallback for
  the test harness and any plain-browser (file://) use of the page. *(2026-08-16)*
- [x] Initial page: four drill modes, 28 verified KJV passages, localStorage
  progress, export/import, both themes. *(2026-08-11)*
- [x] Test suite: KJV fidelity against the 1769 text plus UI behaviour, ~150
  checks, mutation-tested. *(2026-08-12)*
- [x] Extract `src/` and add a build step. `index.html` is generated from
  `src/style.css`, `src/markup.html`, and `src/app.js` by a zero-dependency
  `build.mjs`; `test/build.mjs` fails the build if the two drift.
  *(2026-08-13)*
- [x] Spaced repetition. Recall scores grade into an SM-2 interval; a review
  queue above the deck says what's waiting and the page opens on it. Only a
  review that was actually due advances the ladder. *(2026-08-14)*
- [x] Storage migration path. The payload carries a `schema` number and
  `migrate()` upgrades older ones on load; v1 practice history replays through
  the same scheduler to derive a starting schedule. Shipped with spaced
  repetition rather than before it, since that was the first schema change.
  *(2026-08-14)*
