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

- [ ] **Spaced repetition.** Practice history is already stored but only drives a
  streak strip. Add an SM-2-style scheduler: grade each recite attempt into an
  interval, surface a "due today" queue, and open on the queue rather than the
  first verse in the deck. This is the single biggest lever on whether anyone
  actually memorizes anything.

- [ ] **Recite aloud.** Memorization is oral; typing is a proxy. Use the Web
  Speech API for a spoken-recall mode — prompt with the reference, listen, and
  run the same word-alignment grading over the transcript. Degrade cleanly where
  the API is missing (Firefox, most mobile browsers) by hiding the mode rather
  than showing a broken button.

## Next

- [ ] **Add any verse by reference.** Today you paste text by hand. Bundle a
  compressed KJV index so someone can type "Romans 5" and get the passage. The
  full 1769 text is ~5.5 MB raw, well inside the 16 MB artifact budget once
  compressed — measure before committing to the approach.

- [ ] **Deck sharing by URL.** Encode a deck into the fragment so a small group
  can work the same passages. No backend needed; a good rehearsal for sync.

- [ ] **Printable drill sheets.** A print stylesheet emitting veiled and
  first-letter worksheets. Memorization happens away from screens.

- [ ] **Storage migration path.** Before any schema change ships, add versioned
  migration for `verse-by-heart:v1` with a test that loads a v1 payload and
  comes out intact. Do this *before* it is needed, not during.

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

- [x] Initial page: four drill modes, 28 verified KJV passages, localStorage
  progress, export/import, both themes. *(2026-08-11)*
- [x] Test suite: KJV fidelity against the 1769 text plus UI behaviour, ~150
  checks, mutation-tested. *(2026-08-12)*
- [x] Extract `src/` and add a build step. `index.html` is generated from
  `src/style.css`, `src/markup.html`, and `src/app.js` by a zero-dependency
  `build.mjs`; `test/build.mjs` fails the build if the two drift.
  *(2026-08-13)*
