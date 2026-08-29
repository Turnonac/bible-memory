# Worklog

One entry per nightly run: what was attempted, what shipped, what was learned.
Newest first. Keep entries short — the PR carries the detail.

## 2026-08-29 — merge the edit-in-place PR, then "Look up" in the edit form

Found PR #16 open from the previous run ("Edit a verse's reference or text
in place"): its one CodeRabbit review thread (a stale "Speak it" listener
surviving an active-verse edit) was already fixed and marked resolved on
the branch. Pulled the branch into a worktree, ran `npm test` myself rather
than trusting the PR body's numbers (384 total: 1 build + 113 KJV + 270
UI), read the diff directly — DOM text APIs throughout, no `innerHTML` — and
squash-merged. Republished the Artifact with the merged `index.html`.

`ROADMAP.md`'s **Now** and **Next** were both empty afterward, but last
night's PR named its own next slice in "Deliberately not done": the new
edit form had no "Look up" button, unlike "Add a verse of your own," which
can re-fetch the exact 1769 KJV text for a reference instead of requiring
the verse text typed by hand. Took that over proposing something new — a
deferred slice a previous run already scoped beats inventing fresh work
when both queues are empty.

A "Look up" button now sits beside the edit form's Reference field
(`.card-edit .reflookup`, mirroring the add form's `.form .reflookup`
layout), reusing the same `lookupReference()` the add form already calls —
one lookup implementation, not two. A successful lookup normalises the
reference and fills the verse text with the exact KJV wording, matching the
add form's behavior verse-for-verse (literally: the same "John 3:16" lookup
test both forms now share found the exact same wording in each). Saving
after a lookup goes through the unchanged `saveVerseEdit()` path, so it
marks the verse `"custom"` and preserves attempt history exactly like a
hand-typed correction — consistent with the add form's own lookup path,
which also marks a looked-up verse `"custom"` once it's actually added.

**Self-review (`code-review` skill) caught a real race before shipping.**
The lookup is asynchronous (`lookupReference()` awaits `DecompressionStream`
decompressing the bundled KJV), and the first version applied its result by
writing straight into the shared, module-level `editDraft` — the *live*
variable, not a stable reference. If the user cancelled the form, or
switched to editing a different card, before the lookup resolved,
`editDraft` had already moved on to something else (or become `null`) by
the time the `await` returned. The stale write landed on whatever draft was
now live — silently overwriting an unrelated card's in-progress edit with
the abandoned lookup's result. Confirmed this is reachable, not
theoretical: cancel-then-reopen the *same* card also swaps in a fresh
`editDraft` object, so even staying on the same verse doesn't protect
against it.

Fixed by capturing the draft object's own identity (`draftAtStart =
editDraft`) when the lookup starts, and discarding the result if
`editDraft !== draftAtStart` by the time it resolves — an identity check,
not an id check, so it catches the same-card-reopened case too, which a
`v.id` comparison alone would have missed. The success path now also calls
`renderDeck()` rather than poking the (possibly stale, possibly detached)
form's own DOM nodes directly, so a looked-up result reaches the screen
correctly even if an unrelated re-render happened to land in between.

Regression test gates the fix on a real async race, not a synchronous
stand-in: patches `Response.prototype.text` to gate on the *first* call
only (`kjvIndex()` caches its promise, so exactly one lookup per fresh page
load ever reaches it), starts a lookup on one card, abandons it for a
different card before releasing the gate, then confirms the second card's
fields are untouched once the stale lookup is allowed to finish.
Mutation-tested by reverting to the original `editDraft`-by-reference
write (keeping everything else, including the newly-added `renderDeck()`
call, so only the identity guard itself was removed): both new checks
failed exactly as expected (`expected "Psalm 46:1", got "John 3:16"` — the
abandoned card's looked-up text leaking into the card actually being
edited), confirming the guard is what's carrying the fix, not something
else in the same diff. Restored and confirmed 288/288 UI checks again.

`npm test`: 1 build + 113 KJV + 288 UI (up from 270, 18 new checks) — 402
total. Verified in the harness (real Chromium) in both themes and at
390px: the Reference-field-plus-button row sits correctly inside the
narrower `.card-edit` layout (adapted from the add form's own
`.reflookup` styling, since the edit form uses a different container
class), a successful lookup fills both fields with the exact KJV wording
in a screenshot taken after the fact, and dark theme keeps the button's
contrast readable against `--sunken`.

Republished the Artifact in place with this run's `index.html`.

**Addendum, same night — CodeRabbit's PR review found one more real gap in
the race fix above, distinct from the one self-review already caught.**
Its "Merge Risk" note: the identity guard (`editDraft !== draftAtStart`)
only catches the lookup's *draft object* changing — switching cards,
cancelling, or reopening the same card. It does nothing for the case where
the form never closes and no other card opens at all: the reader keeps
typing in the *same* still-open form's Reference or Verse text field while
the lookup is still in flight. `editDraft` never changes identity in that
case, so the guard waved the stale result straight through, silently
overwriting whatever had just been typed with the lookup's own text.
Reproduced directly: click Look up on a lowercase, unnormalised reference,
type a manual correction into the verse text field before the (gated)
lookup resolves, release it — the typed correction vanished, replaced by
the looked-up wording, and the reference field silently renormalised too
even though nothing about *which* draft was current had changed.

Fixed by snapshotting the draft's *content*, not just its identity —
`snapshotRef`/`snapshotText` captured alongside `draftAtStart`, and the
result is now discarded unless both the identity and the content are still
exactly what they were when the lookup started. Two new regression tests
(reusing the same `Response.prototype.text` gating trick as the first
race fix, now hoisted to a shared `installGatedLookup` fixture next to
`installFakeRecognizer` rather than duplicated across both test blocks):
one confirms an edit to the verse text field while a lookup is pending
survives; the other confirms the reference field stays exactly as typed
(not renormalised) for the same reason. Mutation-tested by reverting
`stillFresh()` to the identity-only check: both new tests failed with the
exact corruption CodeRabbit described (`expected "A manual correction
typed while the lookup was still pending.", got "For God so loved the
world..."`), confirming the content snapshot — not something else in the
same diff — is what's carrying this half of the fix. Restored and
confirmed 290/290 UI checks (404 total).

## 2026-08-28 — edit a verse's reference or text in place

No open PRs from previous runs (`mcp__github__list_pull_requests` returned
none), `main` was already green (359 checks: 1 build + 113 KJV + 245 UI),
and `ROADMAP.md`'s **Now** and **Next** were both empty, so — per the
working agreement — proposed my own item. The last four nights all worked
the "searchable verse library" thread; this was a different gap in the same
neighborhood — once a verse is in the deck, the only way to fix a typo in
its reference or text was to delete it and re-add it, which throws away all
attempt history, best score, and the SM-2 schedule over a misspelling.
Given CLAUDE.md's "scripture is graded against, so it must be exact,"
having no correction path for a self-inflicted typo felt like the sharper
gap to close.

An "edit" control sits next to "remove" in each card's stat row. Clicking
it swaps that one card's reference/snippet/meter/remove display for an
inline form — Reference input, Verse text textarea, Save/Cancel — prefilled
with the card's current values, reusing the same visual language as the
"Add a verse of your own" form (`.form` styling) rather than inventing a
new one. Only one card edits at a time (`editingId`, module state like
`deckQuery`/`deckFilter`/`deckSort`). Saving calls `saveVerseEdit()`, which
updates `ref`/`text` on the *existing* verse object — same `id` — so
`attempts`, `best`, `ease`, `reps`, `interval`, and `due` all survive
untouched; only the delete-and-re-add path should cost a reader that
progress. Validation matches the add form exactly: a non-empty reference,
at least two words of text.

Two deliberate calls, both recorded in `ROADMAP.md`'s Done entry: editing
any verse — starter or custom — flips its `source` to `"custom"`, since a
hand-edited verse can no longer claim to be the verified 1769 text
`test/verify-kjv.mjs` checks the starter deck against; and editing the
*active* verse resets `peeked`/`hideOrder` and clears the recite
textarea/result panel, since those hold word indices into the *old* text
that a changed word count would leave pointing at the wrong words (or past
the end) — editing any other card leaves the active drill alone.

Self-review (`code-review` skill) caught a real bug before shipping, fixed
and mutation-tested (reverted, confirmed the new check fails, restored):
**any unrelated action elsewhere on the page silently discarded an
in-progress edit.** `renderDeck()` tears down and rebuilds every card's DOM
on *any* change — a keystroke in the search box, a filter or sort change,
grading a due verse, removing a different card — and the edit form was
being rebuilt from the unchanged verse on disk rather than from what had
actually been typed. Reproduced directly: type a draft correction, then a
single character into the unrelated search box, and the draft vanished
with no warning. Fixed with a live `editDraft` (`{ ref, text }`) kept in
sync via `input` listeners on the form's own fields; `buildEditForm()` now
seeds from that draft when one exists, so a rebuild triggered by anything
else reflects what's actually been typed. `editDraft` clears alongside
`editingId` on Save and Cancel.

`npm test`: 1 build + 113 KJV + 268 UI (up from 245, 23 new checks) — 382
total. New checks cover: the edit control's presence, correct prefill, the
open/select overlay withdrawn while a card is mid-edit (so form clicks
don't navigate away), only one form open at a time and switching which
card is being edited, the empty-reference and under-two-words rejections
with the form staying open, a valid save updating the card and closing the
form, attempts/best/interval/due/source all surviving a save unchanged,
the draft-survives-an-unrelated-rerender fix above, and the active-verse
veil-state reset (word count changes, no stale `peeked` entries, no page
error). Mutation-tested five behaviors individually — reverting the
`source` flip, the active-verse veil reset, the editing-card render branch
entirely, the form's validation, and the draft-preservation fix — each
failed the corresponding new check (two of them hard-crashed the test with
a timeout rather than silently passing, which is arguably an even stronger
signal); restored and confirmed 382/382 again each time.

Verified in the harness (real Chromium) in both themes and at 390px: the
edit form renders cleanly at all three, Save/Cancel sit where the add
form's actions already do, and the whole click-through (open the form,
reject an invalid save twice, save a valid correction, watch the card
update) works end to end via a standalone script before formalizing it as
test coverage.

Republished the Artifact in place with this run's `index.html`.

**Addendum, same night — CodeRabbit's PR review found one more real bug,
same shape as the self-review catch above but on a different code path.**
`saveVerseEdit()` reset the recite textarea/result panel for the active
verse but never stopped an in-progress "Speak it" session. A listener left
running would keep listening against the verse just rewritten; its
eventual `onend` hands the stale transcript (spoken against the *old*
text) to `runCheck()`, which grades it via `active()` — the same, now-
mutated verse object — against the *new* text. Exactly the class of bug
already fixed once for `removeVerse()`/`selectVerse()` on 2026-08-17
("a stale listener's transcript lands on whatever verse becomes active
next"), just reached through a path that mutates the verse in place rather
than replacing the active one. Caught it independently from CodeRabbit's
summary-level "Merge Risk" note before its inline comment with the same
diagnosis and proposed fix arrived a few minutes later. Fixed with
`endListening(false)` + `setSpeakStatus("", false)`, matching the existing
pattern exactly. New regression test starts a fake "Speak it" session,
edits the active verse mid-listen, and asserts the stale transcript is
discarded rather than graded — mutation-tested by reverting the fix: the
unfixed code doesn't just mis-grade, it hangs (the listener never stops,
so the button never reverts from "Stop listening" and the test's own wait
times out) — a stronger signal than a value mismatch would have been.
`npm test`: 383 total (270 UI, up from 268). Replied on the review thread
with the fix commit and resolved it. CodeRabbit's other finding — a
"Docstring Coverage" pre-merge check below its 80% threshold — wasn't a
threaded comment and isn't one to act on: this codebase deliberately
writes no docstrings (`CLAUDE.md`'s "default to writing no comments"),
and none of the existing 1,479 lines of `src/app.js` carry any either;
adding them only to this diff's five touched functions would make it the
inconsistent one. Republished the Artifact again with the fixed
`index.html`.

## 2026-08-27 — filter the deck by status

No open PRs from previous runs (`mcp__github__list_pull_requests` returned
none), `main` was already green (345 checks: 1 build + 113 KJV + 231 UI), and
`ROADMAP.md`'s **Now** and **Next** were both empty, so — per the working
agreement — proposed my own item. The last three nights (search, highlight,
sort) all worked the "searchable verse library" thread the roadmap names as
direction; narrowing the grid to a status is the same shape of small,
schema-free slice, and it's the piece none of those three cover — sorting
by due date orders the whole deck but doesn't hide anything, and search only
matches text, not a verse's practice state.

A `<select id="deckFilter">` sits between the search box and the sort
select: **All verses / Due for review / Mastered / Not started**. It's
view state exactly like `deckQuery` and `deckSort` — a new `deckFilter`
module variable, no `SCHEMA` bump, no `migrate()` branch. `renderDeck()`
now composes all three: filter narrows `state.verses` first, search then
narrows that, `sortDeck()` orders what's left — so a filter and a search
query rule out results independently and correctly stack, verified
directly (`due` + `"micah"` → just the one due-and-matching verse; `az`
sort + `due` filter → the two due verses in alphabetical order, not deck
order).

"Due for review" reuses `isDue()` as-is rather than inventing a second
notion of due — it already includes never-started verses (a card's own
`when` chip already reads "due" for an unstarted verse, so a filter named
"Due" that disagreed with the chip sitting right next to it would be
confusing). "Not started" is a deliberately separate facet (`!v.attempts`):
a fresh verse is both due and not-started, an overdue-but-once-recited verse
is due but not new. They're not a mutually exclusive partition, same as the
existing due-chip and mastered-seal aren't either.

Zero results gets a named empty state, same idiom the search feature
already established, but distinguishes *why* nothing's showing: "Nothing
due right now." / "No verses mastered yet." / "Every verse has been
attempted at least once." when the filter alone is empty, versus "No
mastered verses match "romans"." when a search query on top of the filter
is what emptied it — the reader needs to know whether clearing the search
box would actually help.

**A real layout bug turned up while checking 390px, not from any test.**
`.deck-search` had no `flex-wrap`, so a second `<select>` joining the
existing search input and sort select had nowhere to go at narrow widths —
the search input (the only shrinkable item, `flex: 1 1 16rem`) got
squeezed down to a few visible characters of its own placeholder while both
selects held their fixed width. Added `flex-wrap: wrap` to `.deck-search`;
confirmed via the harness that the search input now takes its own full-width
row at 390px with the two selects wrapping to the row below, in both
themes, rather than three controls fighting for one row nothing was reserved
for.

`npm test`: 1 build + 113 KJV + 245 UI (up from 231, 14 new checks) — 359
total. New checks cover: the default filter and its blank caption, each of
the three status filters in isolation (mastered relies on
`MASTERY_RUNS`/`MASTERY_SCORE` — three recent scores at or above 95%),
composition with an active search query, composition with a sort mode, and
all four empty-state messages (three filter-alone wordings plus the
filter+query combined wording). Mutation-tested by reducing `matchesFilter`
to always return `true` — all 10 filtering/composition/empty-state checks
that depend on it failed, as expected; restored and confirmed 359/359
again. Self-review (`code-review` skill) found nothing to fix.

Verified in the harness (real Chromium) in both themes at 1100px and 390px:
the toolbar row (search, filter, sort) sits inline at 1100px exactly as it
already did with just search and sort, and wraps cleanly to two rows at
390px with the search input on its own full-width line. Confirmed the
count caption and named empty-state text render correctly for a filter
alone, a filter with no matches, and a filter combined with a
non-matching search query, using a hand-built fixture with one mastered,
one overdue-and-attempted, one never-started, and one scheduled-ahead
verse so each filter's boundary is actually exercised rather than assumed
from the code.

Republished the Artifact in place with this run's `index.html`.

## 2026-08-26 — merge PR #13, then sort the deck

Found PR #13 open (highlight search matches): `mergeable_state: clean`, CI
green (`CodeRabbit` context reporting success — rate-limited rather than
actually reviewing), and its one CodeRabbit thread (filtering/highlighting
disagreeing on Turkish `İ`) already fixed on the branch and marked resolved.
Pulled the branch into a worktree, re-ran `npm test` myself (340 total: 1
build + 113 KJV + 226 UI) rather than trusting the PR body's numbers, read
the `src/app.js` diff directly — DOM text nodes throughout, never
`innerHTML`, so no injection risk from user-supplied verse text — and
squash-merged.

`ROADMAP.md`'s **Now** and **Next** were both empty afterward and **Later**
stays blocked on decisions only Kevin can make, so proposed my own item
per the working agreement. Picked deck sorting: search (2026-08-24) and
highlighting (2026-08-25) both shipped on the "searchable verse library"
thread this roadmap names as direction, and a deck long enough to need
filtering is exactly as long as it needs ordering. A `<select id="deckSort">`
next to the search box offers "Deck order" (the existing insertion order,
a no-op), "Due soonest", and "A–Z" — resolved client-side in `renderDeck()`
against whatever the search already filtered to, never touching
`state.verses`'s own order, same "view state, not practice history" treatment
`deckQuery` already gets.

"Due soonest" reuses `dueVerses()`'s own ordering rule rather than inventing
a second one: overdue real dates sort before the `due: null` sentinel
("unstarted" verses read as due, same as they already do on their card's
"due" chip), then scheduled-future dates ascending. Implemented as one
comparator key (`"0:" + due` for anything currently due, `"1:" + due` for
anything scheduled ahead) rather than filtering into two arrays and
concatenating — cheaper and there's only one place to get the boundary
wrong instead of two.

This was the app's first `<select>`, so no existing component style to
match beyond the `.deck-search input`'s own border/radius/font treatment,
which it now shares — no new color tokens, a chevron built from two
gradient triangles reading off `--ink-faint` instead of an image asset,
same as everywhere else the app draws a hairline affordance without one.

`npm test`: 1 build + 113 KJV + 231 UI (up from 226, 5 new checks) — 345
total. New checks: deck order matches insertion order untouched by either
due date or the alphabet; due-soonest puts the most overdue verse first, an
unstarted verse after real overdue dates but before anything scheduled
ahead, matching the queue's own rule; A–Z sorts case-insensitively; and a
sort mode composes correctly with an active search filter rather than
re-sorting the unfiltered deck. Mutation-tested by making `sortDeck()` an
identity function — all three new order-dependent checks failed as expected
(the fourth, "deck order is the default", couldn't fail this way since it
tests the no-op case directly); restored and confirmed 345/345 again.
Self-review (`code-review` skill) found nothing to fix.

Verified in the harness (real Chromium) in both themes at 1100px and 390px:
the select sits inline with the search input and count caption at both
widths with no wrap or clipping, even with all three populated at once
(a live count plus a non-default sort). Also confirmed visually that
switching "Due soonest" actually reorders the rendered grid, not just the
underlying comparator.

Republished the Artifact in place with this run's `index.html`.

## 2026-08-25 — highlight search matches

No open PRs from the previous run (PR #12, the deck search, had already been
merged into `main`). `ROADMAP.md`'s **Now** and **Next** were both empty,
and **Later** is still entirely blocked on Kevin's decisions (backend,
translation), so — per the working agreement — picked my own item. Last
night's entry named match-highlighting explicitly as deferred scope
("no match-highlighting inside the snippet text"), it's the smallest
concrete slice still open on the searchable-library thread, and it needs no
schema or backend change, so took that over proposing something new.

Every case-insensitive hit of the deck search query now gets wrapped in
`<mark class="hit">` in both the card's reference label and its verse
snippet. Colour choice took a moment: madder red already marks a revealed
or incorrect word in a drill, and orpiment already marks "near miss" as a
*text* color in the recite breakdown, so reusing either as the highlight's
text color would collide with an existing meaning. Landed on an orpiment
*background* wash (new `--hit-fill` token, three theme variants) under
unchanged text — a wash reads as "the ink itself, illuminated," which
neither existing usage does, so it doesn't compete with them.

Self-review (`code-review` skill) surfaced a real bug before this shipped:
the first version matched by lowercasing the whole string and calling
`indexOf()`/`slice()` on the result, which silently assumes lowercasing
never changes a string's length. It does, for some Unicode — Turkish
capital `İ` lowercases to two characters (`i` + a combining dot). Past such
a character, the match index found in the lowercased copy no longer lines
up with the original string, so slicing corrupts the rendered text rather
than just mis-highlighting it. Rewrote the matcher on `RegExp` with the
`gi` flags instead (query characters escaped first, so it still matches
literally) — the regex engine case-folds per match without ever
materializing a differently-sized string, so there's no copy for an index
to desync against.

`npm test`: 1 build + 113 KJV + 223 UI (up from 214, 9 new checks) — 337
total. New checks cover: the ref and snippet both getting a `mark.hit` on a
match, casing preserved from the verse (not the query), every occurrence
marked rather than just the first, marks disappearing when the query
clears, the Turkish-`İ` case, and a literal `.` in the query matching only
a literal period rather than acting as a regex wildcard. Mutation-tested
the Unicode fix by reverting to the `indexOf` version: the Turkish-`İ`
check fails against it (confirmed), while the literal-`.` check still
passes either way since the old code was never regex-based — kept it
anyway as a guard against a *future* regression (e.g. someone adding regex
matching later without escaping). Verified in the harness (real Chromium)
in both themes at 1100px and at 390px with an active filter.

**Not done:** no highlighting inside the open verse display (Read/Veil/
Initials/Recite) — the deck grid was explicitly the deferred scope, and the
drill views are a different layout with the "text never reflows" invariant
to respect, which searching doesn't touch at all today.

**Addendum, same night — CodeRabbit found a real gap in the above.**
`matchesQuery()` (which verses `renderDeck()` shows) and `appendHighlighted()`
(what it marks inside them) had ended up on two different case-insensitive
contracts: the former via `String.prototype.toLowerCase().includes()`, the
latter via the regex from the fix above. They don't always agree — `toLowerCase()`
decomposes Turkish `İ` into `i` plus a combining mark, so a plain-substring
check finds `i` inside it, where regex case-folding treats `İ` as its own
letter and doesn't. A query of `"i"` against a verse whose only near-match
was that letter would show the card with nothing marked inside it — exactly
the confusing state highlighting was supposed to prevent. Factored both
functions onto one `queryRegex()` helper so that can't happen: a verse is a
filter hit if and only if the same regex finds something in it to mark.
`npm test`: 339 total (226 UI, up from 223) — new checks assert the
Turkish-`İ`-only case is excluded rather than shown unmarked, alongside a
verse with a real match nearby, and a general "every shown card has at least
one highlight" invariant. Mutation-tested by reverting `matchesQuery()` to
the old version — both new checks fail against it. Replied on the review
thread with the fix commit and why the same comment's `ast-grep` ReDoS flag
on the regex construction isn't actionable (the query is always escaped
before building the `RegExp`, so it's never anything but a literal
pattern), then resolved the thread. Republished the Artifact again with the
fixed `index.html`.

## 2026-08-24 — merge PR #11, then search the deck

Found PR #11 open (bound the recite-alignment input): green at 315/315,
`mergeable_state: clean`, and both CodeRabbit threads already addressed on
the branch (hiding the stale result panel on an over-cap attempt; correcting
the WORKLOG's memory estimate from "a few MB" to "~18 MiB") and marked
resolved. Re-ran the full suite on that branch myself rather than trusting
the PR body's numbers, confirmed 317/317, and squash-merged.

`ROADMAP.md`'s **Now** and **Next** were both empty afterward, and **Later**
is entirely blocked on decisions only Kevin can make (backend/accounts,
which translation), so — per the working agreement — proposed my own item
and recorded the reasoning in `ROADMAP.md`'s Done entry rather than here
twice. Picked it because the roadmap's own **Direction** line names "a
searchable verse library" outright, it's buildable with zero schema or
backend change, and "Add any verse by reference" already made the 28-verse
starter deck the scrollable-grid case it filters.

A "Search by reference or words…" box sits right above the card grid.
`renderDeck()` now filters `state.verses` against a module-level
`deckQuery` (case-insensitive substring match on both `ref` and `text`)
before rendering cards, updates a "N of M shown" caption while a filter is
active, and swaps in a `#cardsEmpty` message ("No verses match "…"") when a
query matches nothing rather than leaving a bare gap where the grid used to
be. The query is intentionally *not* persisted — like `veil`, `peeked`, and
`hideOrder`, it's viewport state, not practice history, so it doesn't touch
`SCHEMA` or `migrate()`.

**A real bug turned up in `test/ui.mjs` itself while verifying this in the
harness**, not in the shipped feature: adding the search box shifted
`.cards`'s vertical position enough to flip the fractional part of its
`getBoundingClientRect().y` from a "safe" value to one where
`page.locator(".cards").screenshot()` crops starting up to 1px *above* the
element's real top edge, sampling the page's paper background instead of
the deck-grid frame drawn by `.cards::after` — a false failure on the
"sheet is framed along its top/bottom edge" checks added 2026-08-22, with no
actual regression in the frame itself. Confirmed with a throwaway script
against the real Chromium binary: `page.screenshot({ fullPage: true, clip })`
using the same `getBoundingClientRect()` values samples the correct pixel
regardless of the fractional offset, where the locator screenshot doesn't.
Switched the test to that. Mutation-tested both directions: reverting the
capture fix reproduces the false failure against the *unmodified* frame CSS
(proving it really was the capture, not the CSS); reverting the frame CSS
itself (deleting `.cards::after`) still fails all four edge checks under the
fixed capture (proving the fix didn't blunt what the check actually guards).
This was a pre-existing fragility in the test's measurement technique, not
a weakened check — the invariant it guards is unchanged and still enforced.

`npm test`: 1 build + 113 KJV + 214 UI (up from 203, 11 new checks) — 328
total. New checks cover: an unfiltered grid and blank count caption on load,
a reference-only match, a case-insensitive text match, a query matching both
verses on a shared word, a no-match query hiding the grid and naming itself
in the empty state, and the empty state withdrawing once the query clears.
Mutation-tested the filter itself by short-circuiting it to always show
every verse — six of the new checks failed, as expected. Verified visually
in the harness (real Chromium) in both themes at 1100px, at 390px, and with
an active filter and a no-match filter, screenshots of each.

**Not done:** no match-highlighting inside the snippet text (e.g. `<mark>`
around the hit) — the filter alone already earns its keep on a 28-verse
deck, and highlighting is a separable follow-up rather than part of making
the deck searchable at all.

Republished the Artifact in place with this run's `index.html`.

## 2026-08-23 — merge the deck-grid PR, then bound the recite-alignment input

Found PR #10 open from the previous run (the deck-grid gap fix): green
(312/312), mergeable clean, no unresolved review threads — CodeRabbit had
hit its OSS review rate limit rather than actually flagging anything. Pulled
its branch and re-ran `npm test` myself before merging rather than trusting
the PR body's numbers alone. Merged, then reset this run's branch onto the
updated `main` and republished the Artifact with the merged `index.html`.

Then took the last item in **Next**: bounding `align()`'s O(n·m) LCS. Neither
a custom verse's text nor the recall textarea's typed attempt had a size cap,
so a large pasted passage on either side could allocate an unbounded matrix
in the tab — `align()` builds an `(n+1)`-row `Uint16Array` matrix, so a
20,000-word paste on both sides is on the order of a gigabyte. `MAX_ALIGN_WORDS`
(3,000) bounds both sides inside `compare()`; picked by actually measuring
the longest KJV chapter (decompressed `src/kjv-data.js` and counted words per
chapter) rather than guessing — Psalms 119 is 2,423 words, so 3,000 leaves
headroom for every real passage while keeping the matrix to about 18 MiB
(3,001 × 3,001 `Uint16` entries) even against a pathological paste.

Self-review (`code-review` skill) caught a real bug in the first version of
the fix, mutation-tested (reverted, confirmed the new checks failed, restored):
**silently truncating and still grading would let a recitation that was
genuinely wrong past word 3,000 score 100% anyway**, since neither side of
the comparison ever saw the mismatch — three such runs would reach the
Mastered seal on an attempt that was actually broken past the cap, directly
against the "must be exact" ethos this app is built on. Changed `runCheck()`
to refuse grading outright when either side exceeds the cap ("Too long to
check automatically — keep it under 3,000 words") rather than comparing a
truncated prefix and reporting a false exact match. `compare()` still caps
its inputs as a hard backstop in case of some future caller, but the refusal
in `runCheck()` is what actually keeps an unverifiable recitation from
reaching mastery.

`npm test`: 1 build + 113 KJV + 201 UI (up from 198, 3 new checks) — 315
total. Verified in the harness in both themes at 1100px and 390px with
screenshots of the refusal message rendered in the existing `#reciteNote`
caption slot — no layout change, since it's the same element that already
shows "N attempts · best N%".

## 2026-08-22 — the deck sheet's grey slab

Republished the Artifact in place with this run's `index.html`, restating the
`downloads` capability. Worth recording how that went, since it is new
behaviour: the first publish was **refused** because this session had never
read the live version, and the second was refused again for resending the
same bytes. The refusal is a good one — it hands you the live source and
makes you merge onto it. Diffing that source against the build showed the
only differences were the host's own injected frame-runtime skeleton (which
must never be included in what we publish) and this run's CSS, so nothing
published was at risk of being dropped. Re-reading the artifact and
publishing again then went through.

Started by finishing the previous night's open work: PR #9 ("hand off to the
next due verse") was green at 303/303, mergeable, no unresolved review
threads, and CodeRabbit had never run on it — it hit its free-tier review
limit rather than finding anything. Reviewed the diff directly, merged it,
then took the newly-promoted top of **Next**.

The roadmap described the deck-grid gap as cosmetic and rare: "only visible
once you remove most of the starter deck." Measuring it first showed it is
neither. `.cards` drew its hairlines the wrong way round — a `--rule`
background showing through 1px `gap`s — so *every* grid cell no card reached
painted as a flat grey slab. At 1100px a one-verse deck stranded a **761px**
band of it. More importantly, `auto-fill` was only half the cause: even with
empty tracks collapsed, a partly-filled **last row** still leaves empty
cells, and any deck whose size doesn't divide evenly by the column count has
one. 28 verses at three columns leaves one card in the last row and two
empty cells beside it — so the shipped starter deck showed the slab at
~900px, on a page nobody had edited. Decks of 5, 6, 7 and 9 verses hit it at
four columns.

So the fix goes both ways round. `auto-fit` collapses tracks no card ever
reaches, which handles decks too small to fill one row (a lone verse now
spans the sheet). And the sheet itself became paper — `background:
var(--raised)`, `gap: 0` — with each card ruling its own `border-right` and
`border-bottom`. An empty cell then paints paper, which reads as "the sheet
continues, nothing written there yet" rather than as a rendering fault.
Confirmed both halves are load-bearing independently: `auto-fit` alone still
fails the empty-cell check.

Self-review (`code-review` skill) caught a real bug in my own fix. I framed
the sheet with `outline: 1px solid var(--rule); outline-offset: -1px`, which
is declared correctly and **never paints**: Chromium renders an element's
outline beneath its descendants, and with `gap: 0` the cards tile the sheet
edge to edge and cover it. Verified independently by forcing the frame
magenta and counting pixels — 0 along the top, 0 along the left; the bottom
and right only looked framed because the last column and bottom row draw
their own borders, and the blank trailing region let the dead outline peek
through. Replaced with a `.cards::after`, which paints after the cards, so
all four edges show; it lands on the same pixels the edge cards already rule,
in the same colour, so the frame stays a single hairline.

The review's second finding was that my tests didn't guard what the diff
introduced — deleting the card hairlines outright still passed. It was right,
and the reason is that computed style is not evidence for "a colour appears
in a place." That is exactly the class of bug the dead outline was. So
`test/harness.mjs` gained `readPng()`, a dependency-free PNG decoder over
Node's own `zlib` (~40 lines, dev-only), and the deck checks now sample the
rendered pixels: the empty cell, the seam between two cards in a row, the
seam between two rows, and all four edges of the frame.

Mutation-tested every new check against the specific thing it guards:
deleting the card borders fails the two seam checks; deleting the `::after`
fails all four edge checks; **restoring the dead-outline version fails the
top and left edge checks and nothing else**, which is precisely the bug the
reviewer found; and the original pre-fix CSS fails the empty-cell check, the
bottom edge, and the single-verse span.

`npm test`: 1 build + 113 KJV + 198 UI (up from 189, 9 new checks) — 312
checks total. Verified in the harness at 1, 3, 5 and 28 verses, in both
themes, at 1100/900/700/390px, and confirmed the full starter deck still
lays out 4/3/2/1 columns at exactly the same breakpoints as before, so
nothing changed for a full deck except that the trailing row is now paper.

## 2026-08-21 — work the queue without going back to it

Republished the Artifact with this run's `index.html`; the `downloads`
capability declaration carried forward untouched, as it has on every
`index.html`-changing publish since it was granted.

No open PRs from previous runs and `main` was already green (294/294), so
took the newly-promoted top of **Next**: closing the loop on the review
queue. Grading a *due* verse used to leave you sitting on that verse with no
way forward except scrolling back up to the deck and pressing "Review now"
again.

`runCheck()` now checks `dueVerses()` again right after it updates the
schedule (only in the `wasDue` branch — extra practice doesn't touch the
queue, so it doesn't get the button). If anything's still waiting, a
"Next due: &lt;ref&gt; →" button appears in the result panel, right below the
marked-verse legend; clicking it runs the same `selectVerse()` +
`setMode("recite")` pair the queue's own "Review now" button already used,
so the reader lands on the next verse already in Recite mode with the
textarea focused — one click instead of a scroll and a click. If the queue
is empty after this grade, the button stays hidden and the existing
"Filed for review…" line grows a second sentence: "Queue cleared — nothing
else due."

Self-review (`code-review` skill) caught one real bug before shipping, fixed
and mutation-tested (reverted, confirmed the new check fails, restored):
**removing the verse a pending next-due button points at left the button
dangling.** The button's target lives in a closure variable
(`nextDueId`) separate from whichever verse is currently active, so
`removeVerse()` — which only reset recite-panel state when the *active*
verse was the one removed — never noticed when the *targeted* verse was
deleted instead. A user who graded verse A (arming "Next due: B"), then
opened the deck and removed B without navigating away first, was left with
a button still reading "Next due: B" that actually routed to whatever verse
happened to land at `state.verses[0]` — a silent bait-and-switch. Fixed by
clearing `nextDueId` and hiding the button whenever the removed id matches
it, regardless of which verse was active.

`npm test`: 1 build + 113 KJV + 189 UI (up from 180, 9 new checks) — 303
checks total. Verified in the harness in both themes and at 390px with real
screenshots of the result panel (button present with a verse still due,
absent with a "Queue cleared" message, and correctly hidden during genuine
extra practice even with another verse still due) — and drove the actual
click through a standalone Playwright script to confirm it lands on the
right verse, in Recite mode, with the textarea focused and no stale result
carried over from the previous verse.

## 2026-08-20 — printable drill sheets

No open PRs from previous runs and `main` was already green (280/280), so
took the newly-promoted top of **Next**: a print stylesheet for veiled and
first-letter worksheets.

A "Print worksheet" button appears in the mode row, but only in Veil and
Initials — the two modes that actually hide words; Read and Recite hide it.
Clicking it calls `window.print()`. A new `@media print` block in
`src/style.css` strips everything but the reference and the verse:
masthead, mode switch, hint, deck, and the recite panel all go to
`display: none !important`. The core design idea — hidden words keep their
screen width so the passage never reflows — carries over to paper; what
changes is *how* a blank reads. On screen `.tok.blank` gets a light
background tint, but browsers drop background colours by default when
printing, so the print rules swap that for a `border-bottom` under the
`.veiled` span instead — a fill-in line under wherever a word (or, in
Initials, everything after the first letter) would sit. The ruled
manuscript-paper lines under the verse text survive onto the printed sheet
too, forced past that same "skip backgrounds" default with
`print-color-adjust: exact`, so a worksheet still reads as the same page
rather than reverting to a generic look. Colours in the print block are
hardcoded (`#000`, `#d9dbd2`) rather than pulled from the theme tokens —
worksheets always print on white paper regardless of what theme the screen
was in, and the dark palette's `--rule-faint` is near-black, which would
print as a solid bar under every line.

Self-review (`code-review` skill) caught two real bugs before shipping,
both fixed and both mutation-tested:

- **The hint text pointed the wrong way.** It read "the button below," but
  `#printBtn` sits in the `.modes` row, which comes *before* the `<p
  class="hint">` in the DOM — the button is above the text that names it,
  for every user in Veil or Initials mode. Changed "below" to "above."
- **Printing from Recite mode left a dark, unreadable textarea on the
  page.** `printBtn` is hidden in Recite mode, but the app's own keydown
  handler explicitly lets `Ctrl/Cmd+Enter` through for "check my recall"
  and doesn't intercept `Ctrl/Cmd+P` at all — so a native browser print
  while reciting isn't gated by the button being hidden. The print
  hide-list didn't include `.recite`, so its dark-theme-styled textarea
  would print as a near-black box (or invisible light text on white, if
  the browser also skips background graphics). Added `.recite` to the
  hide-list. The regression test for this one needed a second pass: my
  first attempt tried to click the Recite mode button while `page` was
  still under `emulateMedia({media:'print'})` from the previous check, but
  `.modes` is itself print-hidden, so the click timed out rather than
  exercising the bug — the harness was failing for the wrong reason, not
  passing for the right one. Fixed by switching back to `screen` media to
  click, then re-emulating `print` to assert.

**One real risk this sandbox cannot verify, matching the pattern flagged
with Share deck last night:** whether `window.print()` fires at all inside
the published Artifact's sandboxed iframe. Per the HTML spec, `print()` is
treated as a modal-dialog trigger and needs `allow-modals` on a sandboxed
frame — and a blocked call is a silent no-op, not an exception, so there's
nothing a `try/catch` could surface. That's exactly why the hint text next
to the button spells out the Ctrl/Cmd+P keyboard fallback rather than
relying on the button alone: the `@media print` rules themselves apply to
*any* print trigger, so even if the button does nothing on the live page,
printing the page the normal way still produces the worksheet. Worth Kevin
trying both paths on the published Artifact.

`npm test`: 1/1 build fidelity + 113/113 KJV fidelity + 180/180 UI (up from
166, 14 new checks) — 294 checks total. Verified in the harness in both
themes and at 390px, and took real screenshots of the rendered print output
(via `page.emulateMedia({media:"print"})`) in both Veil and Initials to
confirm the worksheet actually looks like a worksheet, not just that the
CSS rules parse: chrome gone, reference and verse remain, ruled lines
survive, blanks read as fill-in lines, and a word already revealed on
screen keeps printing in rubric red per the existing "revealing marks it"
invariant — no extra rule was needed for that since `.tok.peeked`'s
class-selector specificity already beats the print block's `.verse { color:
#000 }`.

Republished the Artifact with the new `index.html`; the `downloads`
capability declaration carried forward untouched, as it has on every
`index.html`-changing publish since it was granted.

## 2026-08-19 — merge the verse-lookup PR, then deck sharing by URL

Merged PR #6 first (previous run's "Add any verse by reference"): green
(249/249), no open review threads, CodeRabbit finished — the working
agreement makes finishing an open PR outrank starting new work. Republished
the Artifact afterward with the merged `index.html` and the `downloads`
capability re-declared (declarations don't carry forward implicitly across
a fresh `capabilities` argument).

Then took the newly-promoted top of **Next**: deck sharing by URL. A "Share
deck" button on the deck-head tools row base64's the whole deck's ref/text
pairs — no progress, no schedule, matching how CLAUDE.md treats progress as
personal — into the page's own `location.hash`, and shows the resulting
link in a readonly field for the user to copy. Opening that link anywhere
shows a banner: "N new verses (M you already have)" with "Add to my deck" /
"Dismiss", matching against the recipient's own refs (case-insensitive) so
already-owned verses aren't duplicated. Either action clears the hash via
`history.replaceState` so a reload doesn't re-prompt.

Deliberately no `window.claude` capability dependency anywhere in this
feature — `location.hash`, `btoa`/`atob`, and `history.replaceState` are all
plain browser APIs with no permission gate, unlike Export (needed
`downloads`) or Speak It (needs the Web Speech API to exist at all). Copy
Link tries `navigator.clipboard.writeText` first but doesn't depend on it:
on rejection (no grant, or the API absent) it falls back to selecting the
link's text so the user can Ctrl/Cmd+C manually — verified this fallback
path directly by deleting `navigator.clipboard` before load, rather than
trusting whatever permission state this harness's Chromium happens to start
with, since the sandboxed case is the one that actually matters.

Self-review (`code-review` skill) caught two real issues before shipping,
both fixed and both mutation-tested (reverted, confirmed the check fails,
restored):

- **The share link itself wasn't capped, only the decoder was.** A user with
  a deck bigger than the 200-verse cap would build a link the *decoder*
  rejects as "Broken share link" on the far end — the truth (too big) and
  the message (corrupted) didn't match. `encodeShareDeck` now caps at the
  same `SHARE_MAX_VERSES` the decoder accepts, and the Share panel says so
  ("Only the first 200 verses fit in one link") rather than staying silent.
- **The "which address is this share link" check guessed a hostname.**
  `location.hostname.endsWith("claude.ai")` was an unverified assumption
  about the sandboxed iframe's actual origin — CLAUDE.md explicitly warns
  against trusting the harness (a plain top-level page) as evidence for the
  Artifact (an embedded one). Replaced it with `window !== window.top`,
  which is exactly the structural fact this decision needs (embedded vs.
  not) and is directly inferable from the Artifact's own frame-runtime
  script observed via `WebFetch` this session — not a guess.

**One real risk this sandbox cannot verify, flagged in `ROADMAP.md`'s Done
entry and worth Kevin trying on the live page:** whether the published
Artifact's outer URL actually forwards a `#deck=...` fragment into the
sandboxed iframe this page runs inside. Deployment is out of the sandbox's
network policy, so this mirrors the Export saga exactly — built the best
inference available, tested the mechanism thoroughly where it's testable
(the harness proves the encode/decode round-trip, the banner, dedup, and
hash-consumption all work correctly on a plain top-level page), and left
the one platform-specific unknown clearly documented rather than either
skipping the feature or claiming certainty I don't have.

`npm test`: 1/1 build fidelity + 113/113 KJV fidelity + 160/160 UI (up from
135, 25 new checks) — 274 checks total. Verified in the harness in both
themes and at 390px — the deck-head tools wrap to two rows on mobile
without crowding, the share panel's link/copy/hint stack cleanly, and the
import banner's actions drop below its text at narrow widths, matching the
review queue's existing madder-rail idiom for "something is waiting on
you."

Review round on PR #7 (CodeRabbit) caught two more real issues, both fixed
and both mutation-tested:

- **`encodeShareDeck` didn't cap ref/text length, only `decodeShareDeck`
  did.** A custom verse over either limit would build a link that decoded
  to different, shorter content than the sender's own deck — a silent
  mismatch, not a rejection. Both sides now cap identically
  (`SHARE_REF_MAX`/`SHARE_TEXT_MAX`), and the Share panel says so when a
  verse was shortened to fit.
- **A single malformed entry in a hand-edited link voided the whole
  import.** `decodeShareDeck` read `pair[0]`/`pair[1]` without checking
  `pair` was a two-element array first, so one `null` or bare-string entry
  threw and the caller's `try/catch` turned an otherwise-good link into
  "Broken share link" for every verse in it. Malformed entries are now
  filtered out before mapping, so the well-formed verses in the same link
  still import.

`npm test` after the review round: 1/1 + 113/113 + 166/166 UI (6 more
checks) — 280 total.

## 2026-08-18 — add any verse by reference

No open PRs from previous runs (last night's Recite Aloud PR was already
merged), so took the newly-promoted top of **Next**: bundling the KJV so
"Add a verse of your own" doesn't require pasting text by hand.

`scripts/gen-kjv-data.mjs` (run via `npm run gen:kjv`) reads the `kjv` npm
package's 1769 text — the same source `test/verify-kjv.mjs` already grades
the starter deck against — strips its two editorial markup conventions
(`[bracketed]` translator words, `#` paragraph marks), and writes
`src/kjv-data.js`: the 66-book canon list plus all 31,102 verses, gzip'd and
base64'd. Raw JSON is ~4.8 MB; gzipped it's ~1.3 MB, ~1.7 MB once base64'd
into the page — comfortably inside the 16 MB artifact budget, so the
"measure before committing" note in `ROADMAP.md` cleared quickly. `build.mjs`
now reads `src/kjv-data.js` as a fourth input alongside the other three —
documented in `CLAUDE.md` as generated-but-committed, same status as
`index.html` itself.

The Reference field in the add-verse form gained a "Look up" button (Enter in
the field does the same thing) that decompresses the bundle client-side with
`DecompressionStream` and fills the Verse text field. Accepts "Romans 8:28",
"Romans 8:28-30", or a bare "Romans 8" for the whole chapter. Per the
`CLAUDE.md` note that the harness's Chromium is more permissive than the
Artifact sandbox, checked first whether `DecompressionStream` is a real
compute API (not a network fetch) that CSP has no reason to block — it is —
so unlike Export/Speak-It this one needed no `window.claude` capability.
Still followed the same feature-detection pattern as Speak It regardless:
missing outright, not present and broken, where the API doesn't exist.

Self-review (`code-review` skill) caught three real bugs, all fixed, all
mutation-tested by reverting each and confirming the new check fails:

- **Psalm lookups displayed as "Psalms 23:1"**, the data's internal plural,
  when every other reference in the app — including the starter deck —
  displays the singular "Psalm". `test/verify-kjv.mjs` already documented
  this exact split; the new lookup path just hadn't been told about it.
  Added a `BOOK_DISPLAY` un-pluralizing map, used only for the label shown
  to the user, so the data stays keyed under "Psalms" internally.
- **The five one-chapter books (Jude, Obadiah, Philemon, 2 John, 3 John)
  parsed "Jude 3" as chapter 3**, which doesn't exist, when the number in
  their conventional citation is a verse. Detected by checking whether the
  book has a second chapter in the decompressed data (`!index[book + " 2:1"]`)
  and reinterpreting the bare number as a verse of chapter 1 when it doesn't.
- **A thrown/rejected decompression had no `catch`**, so a corrupted payload
  or browser quirk would silently reset the "Look up" button with no message
  at all rather than the readable error every other failure path in the
  function produces. Added the missing `catch`, with a test that installs a
  `DecompressionStream` whose constructor throws.

`npm test`: 249/249 (1 build + 113 KJV + 135 UI, UI up from 115). Verified in
the harness in both themes at 390px — the Reference field and its new button
share a row without crowding at that width — and manually exercised the
range/whole-chapter/alias/error paths beyond what the automated checks cover,
including all five one-chapter books by hand.

Scoped out for now, worth a note if it comes up again: abbreviations ("Rom
8:28") and multi-word fuzzy book matching aren't supported — full book names
only, case-insensitive. Full names cover the ask in `ROADMAP.md` ("someone
can type 'Romans 5'"); abbreviations would need a disambiguation table
several books share prefixes on (1/2/3 John, Philippians/Philemon) and felt
like scope creep for one night.

Opened PR #6, subscribed to its activity, and republished the Artifact at the
fixed URL (`WebFetch`'d it first to confirm this session hadn't already
published it) — the stored `downloads` capability declaration carried
forward untouched, per the tool's own note that omitting `capabilities` on a
redeploy keeps what's already there.

## 2026-08-17 — merge the export fix, then recite aloud

Started by merging PR #4 from the previous run (the `downloads`-capability export
fix): both CodeRabbit review threads were resolved, `npm test` was green
(91/91) on that branch, and the working agreement makes finishing an open PR
outrank starting new work. Republished the Artifact afterward with
`capabilities: {downloads: true}` declared — the fix needs the capability
actually granted at publish time to do anything on the live page, which the
previous run's PR body already called out. Missed this on the first attempt:
the Artifact tool blocks `capabilities` until the `artifact-capabilities`
skill has been loaded first, and separately requires viewing the artifact's
current version before a redeploy (`WebFetch` the URL) if this session hasn't
already published it.

Then took the newly-promoted top of **Now**: recite aloud. Added a "Speak it"
control to Recite mode using the Web Speech API — `webkitSpeechRecognition` /
`SpeechRecognition`, feature-detected so the button is absent outright on
Firefox and most mobile browsers rather than present and broken. Listening
runs continuously; stopping (by the user's own tap, or a spoken pass ending
with silence) hands the transcript to the exact same `runCheck()` /
`compare()` a typed attempt runs through, so grading, scheduling, and the
red-marked-word review are unchanged for a spoken pass.

**The harness's Chromium actually ships a working `SpeechRecognition`
constructor**, unlike a real sandbox with no microphone or speech service
behind it — checked this directly before writing any test. So per the
`CLAUDE.md` note about harness permissiveness, the new coverage mocks the
API's event lifecycle (a fake `SpeechRecognition` class installed via
`addInitScript` before load) and asserts the mechanism: that a transcript
reaches `runCheck()`, that silence or a denied microphone explain themselves
instead of grading a blank, and that the button is hidden when the addInitScript
removes the constructor to stand in for a browser that never had one.

Self-review (`code-review` skill) caught two real bugs before shipping, both
fixed and both regression-tested:

- **Removing the verse being recited didn't stop the listener.** Unlike
  `selectVerse()`/`setMode()`, which the same diff updated to stop listening on
  the way out, `removeVerse()` left a stale session running; its transcript
  would later grade against whatever verse became active next. Confirmed with
  the project's own harness before fixing — this wrote a real (fabricated)
  attempt onto an unrelated verse's SM-2 record, a direct hit against
  `CLAUDE.md`'s "only a due review moves the schedule" invariant.
- **A manual edit to the recall box during listening could be silently
  overwritten** by the next recognition event, since `onresult` replaces the
  whole field unconditionally. Fixed by making the box read-only for the
  duration of a listening session — simpler than merging two live input
  sources, and it matches how dictation fields behave elsewhere.

Also caught two bugs myself while writing the first pass of tests, before
the review: a naive "double-grade" regression test that couldn't actually
observe its own mutation (the fake recognizer's `onend` only fires from
`.stop()`, so a removed guard just left the session hanging rather than
double-grading) — rewrote it to simulate the follow-up tap that would
trigger the stale `onend` for real, then confirmed it failed against the
unfixed code before restoring the fix.

`npm test`: 111/111 (up from 91). Verified in the harness in both themes and
at 390px; the "FIRST ATTEMPT" / "LISTENING…" captions read as one run-on
phrase sharing a row, so status text now leads with "· " when set.

Did not start anything else from **Next** — one item finished well.

## 2026-08-16 — fix export on the published Artifact

Fixed the item logged at the top of `ROADMAP.md`'s **Now** two nights ago:
`exportDeck()` built a Blob and clicked an `<a download>`, which the Artifact
viewer's sandbox blocks outright (`blob:`/`data:` hrefs included), so the
button did nothing for anyone using the published page even though it passed
every test — the harness loads over `file://` in plain Chromium, where the
sandbox rules don't apply.

`exportDeck()` now checks for `window.claude.use("downloads")` first. When
granted, it hands the file to the viewer through `downloads.save({filename,
data})` instead of touching the DOM at all; a decline is silent (the user just
said no), any other error shows a one-line `alert` with the capability's own
message. Where the capability isn't there — the test harness, or the page
opened directly as a file — it falls back to the original anchor-click trick,
so nothing regressed for that path.

Per the `CLAUDE.md` note left with this item, a green suite proves nothing
about the Artifact sandbox by itself, so the new coverage asserts the
*mechanism*: `test/ui.mjs` now mocks `window.claude.downloads` before the page
loads and checks that `exportDeck()` calls `save()` with the whole deck rather
than falling back to the anchor. Mutation-tested by running that check against
the unfixed `exportDeck()` — it hung waiting on a save that never came, i.e.
it fails the way a real regression would. Also hand-verified in the harness
(not just asserted) that a `declined` rejection stays silent, a real error
(`too_large`) surfaces the alert, and the anchor fallback still produces a
working download with no `window.claude` present at all.

Self-review (`code-review` skill) caught one real bug before shipping: the
viewer allows only one undecided save prompt at a time, so a second click on
Export while the first `save()` call was still awaiting the viewer's
confirmation would reject with a non-`declined` error and surface a spurious
"couldn't save" alert for an export that was actually fine — the pre-fix
anchor-click version had no such conflict since each click was independent.
Added an `exporting` guard so a click while one is already in flight is a
no-op, with a test that clicks twice in quick succession against a `save()`
that resolves after a delay and checks it was only called once. Mutation-tested
by dropping the guard and confirming that check fails (`2` calls, not `1`).
Declined the review's second finding — falling back to the anchor/blob path
if `save()` fails with a lifecycle code like `capability_disabled` after the
capability was already granted — because if `window.claude` exists at all
we're in the Artifact sandbox, where that fallback doesn't work either; there
is nothing to fall back to.

`npm test`: 88/88 (up from 83). No visual change, so verification was a smoke
screenshot in both themes at 390px plus the browser checks above.

Did not touch the second `Now` item (Recite aloud) — one thing finished well.

## 2026-08-14 — export is dead on the published page

Found while republishing the Artifact after merging PR #2: the publish step warns
that a page cannot hand a viewer a file through `<a download>`, and `exportDeck()`
does exactly that with a Blob URL. So **Export has never worked on the published
page** — it only works in the test harness, which loads over `file://` in plain
Chromium where the sandbox rules don't apply. The colophon promises "export to
keep a copy", and progress now carries a schedule, so there is more to lose.

Logged at the top of **Now** (a live defect outranks a new feature, though Kevin
can reorder) and added a `CLAUDE.md` invariant: a green suite is not evidence the
published page can do something, because the harness is more permissive than the
Artifact sandbox. The fix is the `downloads` capability, declared at publish time.

Docs only — no behaviour change, so `npm test` is untouched at 83/83.

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
