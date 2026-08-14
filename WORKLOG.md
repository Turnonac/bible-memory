# Worklog

One entry per nightly run: what was attempted, what shipped, what was learned.
Newest first. Keep entries short — the PR carries the detail.

## 2026-08-14 — spaced repetition

Merged PR #1 first: it was open from the previous run, green (153/153), a pure
byte-for-byte refactor, and both review threads were settled — one fixed in
5f84dbc, one deliberately deferred to `ROADMAP.md` with CodeRabbit agreeing.
Fixing an open PR beats starting new work, and this one only needed merging.

Then built the scheduler. Each verse now carries `ease`, `reps`, `interval`, and
`due`; a recall score grades onto SM-2's 0–5 quality scale (95%+ = 5, below 70%
lapses) and climbs the 1-day / 6-day / ×ease ladder. A review queue sits above
the deck, cards show a `due` or `6d` chip, and the page opens on the queue
instead of wherever you stopped — unless the verse you left open is itself due,
so a reload mid-drill doesn't move you.

**The schema change forced the migration item early, so it shipped too.** The
key stays `verse-by-heart:v1`; the payload now carries a `schema` number and
`migrate()` upgrades anything older on load. v1 data has practice history but no
schedule, so migration replays the recorded scores through the same `step()` a
live attempt runs and anchors the result to the day that verse was last
practised — nothing invented, one implementation of the ladder.

Self-review caught four real bugs, all fixed and all now guarded:

- **Every press graded the schedule.** Four taps of "Check my recall" in one
  sitting filed a fresh verse 45 days out. Only a review that was *actually due*
  now advances the ladder; extra runs still count as attempts and feed the
  streak, and the page names them as practice. This one is worth remembering —
  my own test had encoded the compounding as intended behaviour, so I rewrote it
  to climb each rung on the day it actually falls due.
- **Import split scores from their schedule.** A newer session's failing scores
  were adopted while the local "due in a month" interval was kept, so a lapse was
  recorded but never scheduled. The practice record now moves as one unit.
- **Unstudied verses outranked overdue ones** in the queue, because `due: null`
  sorted ahead of every real date. Overdue reviews come first now.
- **`reps > 0` with `interval: 0`** multiplied out to zero for ever, parking a
  verse as permanently due. `normalizeVerse()` repairs it.

Verified in Chromium in both themes and at 390px, plus the resting state and the
extra-practice state. 83 UI checks (up from 39); mutation-tested all ten new
behaviours by reverting each fix and confirming the intended check failed.

Review round on PR #2 added a polite live region for the queue — the count is a
bare numeral beside its label, so it announced as two disconnected fragments and
said nothing when reciting changed it — and swapped a fixed 300ms wait in the
import test for a wait on the merged state. Declined a stylelint `currentColor`
→ `currentcolor` casing nit: the file already uses `currentColor` at line 177,
there is no stylelint in the toolchain, and changing only the new line would
make it the odd one out. **Left the PR unmerged for Kevin** — I overrode a review
finding, so self-merging would skip the check that bound exists for, and there is
a threshold question waiting on him anyway (see below).

Open question for Kevin, also in the PR: recall grades to SM-2 quality with 95%+
as perfect and below 70% as a lapse. 70% is forgiving for scripture, where
exactness is the point and the mastery seal already wants 95%. Raising the lapse
threshold to ~85% is one line in `quality()`.

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
