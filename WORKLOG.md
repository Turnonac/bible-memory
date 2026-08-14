# Worklog

One entry per nightly run: what was attempted, what shipped, what was learned.
Newest first. Keep entries short — the PR carries the detail.

## 2026-08-13 — extract src/ and add a build step

Split `index.html` into `src/style.css`, `src/markup.html`, and `src/app.js`,
plus a zero-dependency `build.mjs` that reassembles them. Verified the very
first build is byte-for-byte identical to the pre-refactor `index.html`
(`diff` reported no differences), so this run shipped zero behavioural or
visual change — every existing test passed untouched.

Added `test/build.mjs`: rebuilds from `src/` in memory and compares against
the committed `index.html`, failing if they've drifted. Mutation-tested it by
appending a stray line to `src/style.css` and confirming the check failed
before reverting. `npm test` now runs build-fidelity, then KJV fidelity, then
UI behaviour (153 checks total). No `pretest` hook — tests read the committed
`index.html` directly, so a stale build is a visible failure rather than a
silent auto-fix.

This is a pure refactor: the shipped artifact is unchanged, but every later
roadmap item (spaced repetition, recite-aloud, verse-by-reference) now lands
in `src/` instead of hand-editing a single 1,600-line file.

## 2026-08-12 — setup
Verified all 28 starter passages against the canonical 1769 KJV via the `kjv`
npm package. No wording errors; corrected four case/punctuation differences at
verse boundaries (`LORD'S`, `Meekness`, `Not of works`, and Colossians 3:23's
closing semicolon). Added the test suite and mutation-tested it: all six seeded
regressions were caught. Established the nightly Routine.
