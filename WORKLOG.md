# Worklog

One entry per nightly run: what was attempted, what shipped, what was learned.
Newest first. Keep entries short — the PR carries the detail.

## 2026-08-12 — setup
Verified all 28 starter passages against the canonical 1769 KJV via the `kjv`
npm package. No wording errors; corrected four case/punctuation differences at
verse boundaries (`LORD'S`, `Meekness`, `Not of works`, and Colossians 3:23's
closing semicolon). Added the test suite and mutation-tested it: all six seeded
regressions were caught. Established the nightly Routine.
