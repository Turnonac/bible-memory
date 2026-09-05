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

_Empty — promote from Later, or propose new work._

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

- [x] Undo a verse removal. Both **Now** and **Next** were empty tonight, so
  proposed my own item. Removing a verse permanently threw away real,
  irreplaceable practice history (attempts, best, recent scores, the whole
  SM-2 schedule) with no way back except a prior export file — the
  arm-then-confirm click guards against a stray tap, but not against a
  deliberate removal the reader immediately regrets. A madder-rail banner
  (the same "something is waiting on the reader" idiom as the review queue
  and the shared-deck import banner) now offers "Undo" for six seconds after
  every removal, naming the verse removed; undoing splices it back into
  `state.verses` at its exact original position with every field untouched —
  the one thing "delete and re-add by hand" could never offer. A single
  pending slot by design: removing a second verse before touching Undo
  silently forfeits the first's offer rather than queueing several, and the
  banner replaces the message rather than stacking. Self-review
  (`code-review` skill) caught two real bugs before shipping, both in the
  "restore exactly what was there" half of the feature: (1) when the removed
  verse had been active, undo switched `state.activeId` back to it without
  first stopping a listening session the verse that took over in the
  meantime (`state.verses[0]`) could have started — the same reason
  `selectVerse()` and `removeVerse()` itself always call `endListening()`
  before changing which verse is active; unfixed, a stray transcript spoken
  for the stand-in verse would eventually grade against whichever verse was
  active when the recognizer's async `onend` finally fired. (2) undoing a
  verse that had been the "Next due" button's target didn't restore the
  button, and a naive fix would have unconditionally reclaimed the slot even
  if another verse graded during the six-second window had since legitimately
  claimed it — fixed to restore the button only when nothing else has taken
  it since. Mutation-tested all three fixes (the single-slot supersession,
  the stopped-listener fix, and the next-due guard) by reverting each in turn
  and confirming the dedicated test fails; the listener regression in
  particular hangs the whole suite rather than failing a single assertion,
  which is itself informative about how badly a stuck recognizer session
  degrades the page. `npm test`: 1 build + 113 KJV + 365 UI (up from 340, 25
  new checks) — 479 total. Verified in the harness (real Chromium) in both
  themes at 1100px and 390px: the banner sits between the search/sort row and
  the deck grid, wraps its button under the message at the narrow width
  exactly like the review queue's own button already does, and stays legible
  in dark mode. *(2026-09-05)*
- [x] "Needs work" deck filter. Both **Now** and **Next** were empty tonight,
  so proposed my own item — the natural next use of `v.recent`, the field
  the previous night's sparkline first surfaced but only ever showed, never
  acted on. A fourth `deckFilter` option narrows the grid to verses whose
  *most recent* recall score fell below the same 70%-comfortable line the
  sparkline's own endpoint dot and the recite result panel's `scoreColor()`
  already draw the madder/ink line at — factored that literal into a named
  `STRUGGLE_SCORE` constant shared by both, rather than a second, silently
  driftable copy of the same number. Deliberately reads the *last* attempt
  only, not an average across `v.recent`: a verse that just had one bad run
  should surface immediately, and a verse that's since recovered shouldn't
  stay flagged by an average still dragged down by its own past. No schema
  change — pure read of data already being recorded. Composes with search
  and sort exactly like the three existing filters already do, and gets its
  own named empty state ("Nothing needs extra work right now.") rather than
  falling through to a blank gap. Self-review (`code-review` skill) found
  no defects; confirmed the one coincidental collision it flagged — `quality()`'s
  own unrelated `score >= 70` SM-2 pass-mark threshold — is a different
  concept that happens to share the same number, not the same constant, and
  left it alone rather than wrongly conflating the two. Mutation-tested two
  ways: swapping "most recent" for an average across `v.recent` broke the
  dedicated boundary/recovery check (a verse with `recent: [40, 40, 95]`
  wrongly reappeared as struggling); dropping the filter branch entirely
  broke all three new checks, including the empty-state wording. `npm test`:
  1 build + 113 KJV + 340 UI (up from 337, 3 new checks) — 454 total.
  Verified in the harness (real Chromium) in both themes at 1100px and
  390px: the select sits inline with "Deck order" at the wide width and
  wraps cleanly below the search box at 390px in both themes, and a small
  hand-seeded fixture (one verse recovering from a low score, one
  freshly-lapsed) shows exactly the two struggling cards with the rest of
  the grid correctly excluded. *(2026-09-03)*
- [x] Recent-score sparkline on deck cards. Both **Now** and **Next** were
  empty tonight, so proposed my own item. Each card's stat row already showed
  the all-time `best` score but nothing about whether recent attempts are
  trending up or down; `v.recent` (the last up-to-5 recall scores) was already
  being stored for the mastery check but never surfaced anywhere. A small
  inline-SVG sparkline now sits next to "best 92% · 5×" on any card with 2+
  attempts (fewer than 2 points is not a trend, so nothing draws), scaled to
  its own min/max rather than a fixed 0–100 — the absolute number is already
  in the text beside it, so the sparkline's job is showing the shape of
  recent change, and a fixed scale would flatten that whenever scores cluster
  near the top. The endpoint dot reuses the same three-tier score-color
  logic the result panel's own `pct` color already used (extracted into a
  shared `scoreColor()` — was inlined twice). No schema change: pure read of
  existing `v.recent`. Self-review (`code-review` skill) caught a real bug:
  `normalizeVerse()` mapped `recent` through `Number()` with no finiteness
  check, unlike every other scheduler field it guards — a non-numeric entry
  (a hand-edited localStorage payload, e.g.) became `NaN` in memory and only
  surfaced once something finally rendered it, corrupting the sparkline's
  coordinates and its screen-reader label ("NaN%"). This directly broke
  CLAUDE.md's own stated invariant that "a hand-edited or truncated field
  can't reach the scheduler" through `normalizeVerse()`. Fixed by filtering
  to finite numbers before slicing to the last 5. Mutation-tested by
  reverting the filter: the new regression test failed exactly as expected
  (`NaN%` in the label, `NaN` in the polyline's coordinates), confirming the
  fix is what's carrying it. Also factored a tiny `svgEl(tag, attrs)` helper
  (mirroring the existing `el(tag, cls)`) after code-review flagged that the
  sparkline's hand-rolled `createElementNS`/`setAttribute` calls duplicated
  the pattern already used once for the deck's mastery checkmark — both now
  share it. `npm test`: 1 build + 113 KJV + 336 UI (up from 324, 12 new
  checks) — 450 total. Verified in the harness in both themes and at 390px:
  the line and dot render correctly for rising, falling, and flat score
  runs, the dot picks the right color at each tier, cards with 0 or 1
  attempts show no sparkline, and the row doesn't wrap or clip at the narrow
  width. *(2026-09-01)*
- [x] Add several verses at once by reference. A second "Add several at
  once" disclosure sits beside "Add a verse of your own", taking a
  newline- or comma-separated list of references, looking each one up
  against the bundled KJV, and adding every one that resolves — skipping
  anything already in the deck (or repeated within the same paste) and
  reporting what happened ("3 verses added, 1 already in your deck, 1
  reference not found"). Unresolved references are left behind in the
  textarea so a typo can be fixed and resubmitted without retyping the
  rest. *(2026-08-31)*
- [x] Keyboard shortcuts help panel. **Now** and **Next** were both empty
  tonight; the page has bound real keyboard shortcuts since early on — 1–4
  to switch modes, arrow keys to step between verses, `[`/`]` to change the
  veil level in Veil mode, Ctrl/Cmd+Enter to check recall — but nothing on
  the page ever told a reader they existed, and there was no way to
  discover them short of reading the source. A "Keyboard shortcuts"
  disclosure (reusing the same `<details>` visual language as "Add a verse
  of your own") sits under the practice hint; pressing `?` toggles it open
  and focuses it (for a screen reader to announce it), the same way the
  page already handles every other bare-key shortcut. `?` joins the
  existing input-field guard so it stays ordinary punctuation while typing
  a reference, a search query, or a recited verse. Self-review
  (`code-review` skill) caught a real bug before shipping: a new bare `kbd
  { ... }` rule for the panel's key caps had the same specificity as, and
  came later than, the page's pre-existing bare `kbd` rule (used by the
  practice hint's own inline "1"/"4"/arrow hints) — it silently won the
  cascade and reflowed every `<kbd>` on the page, not just the new panel's.
  Fixed by deleting the duplicate and letting the panel reuse the one kbd
  style already on the page, which is the more consistent look anyway:
  the same keys now render identically in both places. Mutation-tested
  by reverting the fix: computed styles on the hint bar's own kbd came
  back visibly different (padding, border, background, color) with the
  duplicate rule restored, confirming the fix is what's carrying it.
  A deck-frame pixel test (`the sheet is framed along its bottom edge`)
  broke as a side effect of adding content above `.cards` — not a bug in
  this feature, but a pre-existing fragility in that test's own crop math:
  it fed `.cards`' fractional `getBoundingClientRect()` straight into a
  screenshot `clip`, and rounding that down independently on each axis
  could truncate the crop by a whole row before any pixel was sampled,
  cropping the bottom hairline out of the image entirely whenever
  whatever sits above the deck changes height. Fixed the crop math itself
  (round the box outward, not the two edges independently) rather than
  touching what the check asserts; confirmed via mutation test that
  removing `.cards::after` entirely still fails all four edge checks, so
  the fix didn't quietly widen what the test tolerates. `npm test`: 1
  build + 113 KJV + 302 UI (up from 290, 12 new checks) — 416 total.
  Verified in the harness in both themes and at 390px: the panel wraps
  cleanly at the narrow width, kbd caps stay legible in dark mode, and the
  panel is excluded from the printable worksheet like the rest of the app
  chrome. *(2026-08-30)*
- [x] "Look up" in the edit form. The inline card-edit form (2026-08-28) can
  now re-fetch the KJV text for a corrected reference exactly like "Add a
  verse of your own" already could — a "Look up" button sits beside the
  Reference field, filling in the exact 1769 wording so a reference typo
  doesn't force retyping the verse text by hand too. Flagged as deliberately
  deferred scope in that PR's own "Deliberately not done" section, and
  **Now**/**Next** were both empty tonight, so it was the natural next slice
  rather than proposing something unrelated. Self-review (`code-review`
  skill) caught a real race before shipping: the lookup is async, and if the
  user cancelled or switched to editing a different card before it resolved,
  the original version wrote the stale result into whatever `editDraft`
  currently pointed to — silently overwriting an unrelated card's in-progress
  edit with this one's looked-up text. Fixed by capturing the draft object's
  identity at the start of the lookup and discarding the result if that
  identity has changed by the time it resolves (covers switching cards,
  cancelling, and reopening the *same* card, which swaps in a fresh draft
  object too). *(2026-08-29)*
- [x] Edit a verse's reference or text in place. An "edit" control sits next
  to "remove" on every card; it swaps the card's reference/snippet for an
  inline form (Reference, Verse text, Save/Cancel) prefilled with the
  card's current values. Saving updates `ref`/`text` on the existing verse
  object — same `id` — so the SM-2 schedule, attempt history, and streak
  all survive a fixed typo, unlike the only previous option (delete and
  re-add, which threw all of that away). Both **Now** and **Next** were
  empty tonight; picked this over continuing the searchable-library thread
  (search/highlight/sort/filter, four straight nights) because it's a
  different, real gap: a typo in a custom-added verse had no correction
  path at all, and CLAUDE.md's own "must be exact" ethos makes an
  uneditable typo worse here than in an ordinary app. Editing any verse —
  starter or custom — flips its `source` to `"custom"`, since a hand-edited
  verse can no longer claim to be the 1769 text `test/verify-kjv.mjs`
  checks the starter deck against. Editing the *active* verse resets
  `peeked`/`hideOrder` (indices into the old text — a changed word count
  would leave them pointing at the wrong words or past the end) and clears
  the recite textarea/result panel; editing any other card leaves the
  active drill untouched. Self-review (`code-review` skill) caught a real
  bug before shipping: `renderDeck()` rebuilds every card's DOM from
  `state.verses` on *any* unrelated change (a search keystroke, a filter
  or sort change, grading a due verse, removing a different card), which
  silently discarded whatever was mid-typed in an open edit form. Fixed by
  keeping a live `editDraft` synced from the form's own `input` events and
  reading the rebuilt form from that instead of the unchanged verse on
  disk. *(2026-08-28)*
- [x] Filter the deck by status. A "Filter your deck" select next to search
  and sort narrows the card grid to All verses / Due for review / Mastered /
  Not started, composing with search and sort exactly like they already
  compose with each other (view-only, like `deckQuery` and `deckSort` — no
  schema change). Both **Now** and **Next** were empty tonight; picked as the
  next-smallest slice on the "searchable verse library" thread after search
  (2026-08-24), highlighting (2026-08-25), and sorting (2026-08-26) — a deck
  long enough to need ordering is exactly as long as it needs narrowing down
  to "what's actually due right now" or "what have I not started yet."
  Zero results (whether from the filter alone, or the filter combined with a
  search query that also rules everything out) gets a named empty state
  rather than a bare gap, same as search's own empty state already does.
  *(2026-08-27)*
- [x] Sort the deck by due date or reference. A "Deck order / Due soonest /
  A–Z" select sits beside the search box and reorders the card grid without
  touching `state.verses` itself (view-only, like `deckQuery`). Both **Now**
  and **Next** were empty tonight; picked as the next-smallest slice on the
  "searchable verse library" thread now that search (2026-08-24) and
  highlighting (2026-08-25) are both shipped — a deck past a couple screens
  of cards is exactly as much a sorting problem as a filtering one, and this
  needs no schema or backend change. "Due soonest" reuses `dueVerses()`'s own
  rule (overdue real dates before the null-due "unstarted" sentinel, then
  future-scheduled dates ascending) so a verse lands in the same relative
  spot here as it does in the review queue above it. "A–Z" sorts the
  reference text itself, not canonical book order — a search aid, not a
  Bible index, and building real canon ordering would mean threading the
  `kjv-data.js` book list into a path that today has none of that
  machinery. *(2026-08-26)*
- [x] Highlight search matches in the deck. Last night's search left this as
  an explicit follow-up ("no match-highlighting inside the snippet text").
  Both **Now** and **Next** were empty tonight and it was the smallest slice
  still open on the searchable-library thread, so picked it over inventing
  new scope. Every case-insensitive hit of the query is now wrapped in
  `<mark class="hit">` in both the reference label and the snippet, in the
  deck grid only — an illuminated-gold background wash (`--hit-fill`, an
  `--orpiment` tint) rather than reusing madder red, since red already has a
  fixed meaning here (a revealed/incorrect word in a drill) and orpiment
  already means "near miss" as *text* color in the recite breakdown; a
  background wash under unchanged text collides with neither. Self-review
  (`code-review` skill) caught a real bug in the first version: matching via
  `text.toLowerCase().indexOf()` assumes lowercasing never changes a
  string's length, which is false for some Unicode (Turkish `İ` lowercases
  to two characters), so a match past such a character would slice the
  wrong span and corrupt the rendered text. Rewrote the matcher on a
  regex (`gi` flags, query characters escaped) so case-folding never
  produces a differently-sized string to slice against in the first place.
  Mutation-tested by reverting to the `indexOf` version: the new Turkish-`İ`
  check fails against it, confirming it's load-bearing. *(2026-08-25)*
- [x] Search the deck by reference or verse text. A search box above the card
  grid filters it case-insensitively against both `ref` and `text`, with a
  "N of M shown" caption and a named empty state ("No verses match…") instead
  of a bare gap when nothing matches. Proposed and self-scoped tonight — both
  **Now** and **Next** were empty, and the roadmap's own stated direction
  names "a searchable verse library" explicitly, so this is that goal's first
  slice: local-first (no schema or backend change — an ephemeral, unsaved
  filter over the existing in-memory `state.verses`), and it starts pulling
  its weight the moment "Add any verse by reference" (2026-08-18) grows a
  deck past a couple of screens of cards, which the 28-verse starter deck
  already is at three columns. *(2026-08-24)*

- [x] Bound the recite-alignment input. `align()`'s LCS is O(n·m) with an
  (n+1)-row matrix, and neither a custom verse nor a pasted recall attempt had
  a size cap. `MAX_ALIGN_WORDS` (3,000 — comfortably above Psalms 119, the
  longest KJV chapter at 2,423 words) bounds `compare()`'s inputs, and
  `runCheck()` now refuses to grade a verse or attempt past it, with a
  readable message, rather than silently comparing only the first 3,000 words.
  Self-review found that silent truncation alone would have let a recitation
  that was actually wrong past the cap score 100% and reach Mastered — fixed
  by refusing to grade instead of truncating and scoring. *(2026-08-23)*
- [x] The deck sheet no longer shows bare `--rule` ground where no card sits.
  The gap was wider than the roadmap entry described: `.cards` painted the
  hairlines as a `--rule` background showing through 1px gaps, so *any* grid
  cell no card reached rendered as a flat grey slab — beside a one- or
  two-verse deck, and across the whole trailing row of any deck whose size
  doesn't divide evenly by the column count. The 28-verse starter deck hits
  that second case at three columns, so the bug was visible on the shipped
  page at ~900px, not only after deleting most of the deck. Fixed both ways
  round: `auto-fit` collapses tracks no card ever reaches, and the sheet is
  now paper with each card ruling its own hairlines, so an empty cell reads
  as blank paper. Self-review caught the frame this introduced being
  invisible along the top and left — an outline on `.cards` paints beneath
  its own descendants, and with `gap:0` the cards covered it — so the frame
  is a `::after` that paints over them. *(2026-08-22)*
- [x] Work the queue without going back to it. Grading a *due* review (not
  extra practice on an already-scheduled verse) now shows a "Next due:
  &lt;ref&gt; →" button right in the result panel — a single click lands on
  the next waiting verse, already in Recite mode with the textarea focused,
  no scrolling to the deck required. When that was the last one due, the
  filed-for-review line says so ("Queue cleared — nothing else due.")
  instead of staying silent. *(2026-08-21)*
- [x] Printable drill sheets. A "Print worksheet" button appears in Veil and
  Initials modes (the only two that actually hide words) and calls
  `window.print()`; a `@media print` stylesheet strips the app chrome —
  masthead, mode switch, hint, deck, recite panel — down to just the
  reference and the verse. Hidden words keep their on-screen width (no
  reflow, matching the core layout idea) but trade their screen tint for a
  fill-in rule, since browsers drop background colours by default when
  printing. The ruled-line background under the verse text survives onto
  paper too, forced past that same default, so a printed sheet still reads
  as the same page. Colours in the print block are hardcoded rather than
  themed tokens — the dark palette's `--rule-faint` is near-black and would
  print as a solid bar under every blank. **Flagged, not verifiable from
  this sandbox:** whether `window.print()` fires at all inside the
  published Artifact's sandboxed iframe — the spec requires `allow-modals`
  for a sandboxed frame to invoke it, and a blocked call is a silent no-op,
  not an exception, so there's nothing to catch. The hint text next to the
  button names the Ctrl/Cmd+P keyboard fallback for exactly that reason —
  the `@media print` rules apply to *any* print trigger, not just the
  button. Same category of gap as Share deck's `#deck=` fragment forwarding
  last night: worth Kevin trying on the live page. *(2026-08-20)*
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
