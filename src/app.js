(() => {
  "use strict";

  /* ------------------------------------------------------------------ *
   * Starter deck — King James Version (public domain)
   * ------------------------------------------------------------------ */
  const STARTER = [
    ["Genesis 1:1", "In the beginning God created the heaven and the earth."],
    ["Joshua 1:9", "Have not I commanded thee? Be strong and of a good courage; be not afraid, neither be thou dismayed: for the LORD thy God is with thee whithersoever thou goest."],
    ["Psalm 23:1-3", "The LORD is my shepherd; I shall not want. He maketh me to lie down in green pastures: he leadeth me beside the still waters. He restoreth my soul: he leadeth me in the paths of righteousness for his name's sake."],
    ["Psalm 46:1", "God is our refuge and strength, a very present help in trouble."],
    ["Psalm 119:105", "Thy word is a lamp unto my feet, and a light unto my path."],
    ["Proverbs 3:5-6", "Trust in the LORD with all thine heart; and lean not unto thine own understanding. In all thy ways acknowledge him, and he shall direct thy paths."],
    ["Proverbs 4:23", "Keep thy heart with all diligence; for out of it are the issues of life."],
    ["Isaiah 40:31", "But they that wait upon the LORD shall renew their strength; they shall mount up with wings as eagles; they shall run, and not be weary; and they shall walk, and not faint."],
    ["Isaiah 41:10", "Fear thou not; for I am with thee: be not dismayed; for I am thy God: I will strengthen thee; yea, I will help thee; yea, I will uphold thee with the right hand of my righteousness."],
    ["Jeremiah 29:11", "For I know the thoughts that I think toward you, saith the LORD, thoughts of peace, and not of evil, to give you an expected end."],
    ["Lamentations 3:22-23", "It is of the LORD'S mercies that we are not consumed, because his compassions fail not. They are new every morning: great is thy faithfulness."],
    ["Micah 6:8", "He hath shewed thee, O man, what is good; and what doth the LORD require of thee, but to do justly, and to love mercy, and to walk humbly with thy God?"],
    ["Matthew 6:33", "But seek ye first the kingdom of God, and his righteousness; and all these things shall be added unto you."],
    ["Matthew 11:28", "Come unto me, all ye that labour and are heavy laden, and I will give you rest."],
    ["John 3:16", "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life."],
    ["Romans 8:28", "And we know that all things work together for good to them that love God, to them who are the called according to his purpose."],
    ["Romans 12:2", "And be not conformed to this world: but be ye transformed by the renewing of your mind, that ye may prove what is that good, and acceptable, and perfect, will of God."],
    ["1 Corinthians 10:13", "There hath no temptation taken you but such as is common to man: but God is faithful, who will not suffer you to be tempted above that ye are able; but will with the temptation also make a way to escape, that ye may be able to bear it."],
    ["2 Corinthians 5:17", "Therefore if any man be in Christ, he is a new creature: old things are passed away; behold, all things are become new."],
    ["Galatians 5:22-23", "But the fruit of the Spirit is love, joy, peace, longsuffering, gentleness, goodness, faith, Meekness, temperance: against such there is no law."],
    ["Ephesians 2:8-9", "For by grace are ye saved through faith; and that not of yourselves: it is the gift of God: Not of works, lest any man should boast."],
    ["Philippians 4:6-7", "Be careful for nothing; but in every thing by prayer and supplication with thanksgiving let your requests be made known unto God. And the peace of God, which passeth all understanding, shall keep your hearts and minds through Christ Jesus."],
    ["Philippians 4:13", "I can do all things through Christ which strengtheneth me."],
    ["Colossians 3:23", "And whatsoever ye do, do it heartily, as to the Lord, and not unto men;"],
    ["2 Timothy 1:7", "For God hath not given us the spirit of fear; but of power, and of love, and of a sound mind."],
    ["Hebrews 11:1", "Now faith is the substance of things hoped for, the evidence of things not seen."],
    ["James 1:5", "If any of you lack wisdom, let him ask of God, that giveth to all men liberally, and upbraideth not; and it shall be given him."],
    ["1 John 1:9", "If we confess our sins, he is faithful and just to forgive us our sins, and to cleanse us from all unrighteousness."]
  ];

  const KEY = "verse-by-heart:v1";
  const SCHEMA = 2;            // shape of the payload inside KEY; migrate() upgrades older ones
  const VEIL_STEPS = [0, 25, 50, 75, 100];
  const MASTERY_RUNS = 3;      // consecutive attempts required
  const MASTERY_SCORE = 95;    // ...at or above this score

  const EASE_START = 2.5;      // SM-2's default E-Factor
  const EASE_FLOOR = 1.3;      // SM-2 never lets a verse get harder than this
  const MAX_INTERVAL = 365;    // a year out is as good as put away
  const DAY = /^\d{4}-\d{2}-\d{2}$/;

  // align()'s LCS is O(n·m) with an (n+1)-row matrix — Psalms 119, the longest
  // KJV chapter, is 2,423 words, so this leaves headroom for any real passage
  // while keeping a pathologically large custom verse or pasted recall attempt
  // from allocating an unbounded matrix in the tab.
  const MAX_ALIGN_WORDS = 3000;

  /* ------------------------------------------------------------------ *
   * State
   * ------------------------------------------------------------------ */
  let state = load();
  let mode = "read";
  let veil = 50;
  let hideOrder = [];          // shuffled word indices, nested across veil levels
  let peeked = new Set();      // words revealed by clicking, this sitting
  let nextDueId = null;        // target of the "Next due verse" button after grading
  let deckQuery = "";          // deck search box, filters the card grid only
  let deckFilter = "all";      // deck filter select, narrows the card grid only
  let deckSort = "added";      // deck sort select, orders the card grid only
  let editingId = null;        // id of the card currently showing its edit form, if any
  let editDraft = null;        // { ref, text } typed into that form, kept live so an unrelated
                                // renderDeck() (search, filter, sort, grading, removing another
                                // card) rebuilds the form from what's been typed, not from the
                                // unchanged verse on disk — otherwise the rebuild silently
                                // discards whatever the reader was mid-typing

  // The one case-insensitive "is this reference already in my deck" rule,
  // shared by deck sharing and add-several-at-once so the two "is this a
  // duplicate" checks can't silently drift apart from each other.
  function existingRefSet() {
    return new Set(state.verses.map(v => v.ref.toLowerCase()));
  }

  function blankVerse(ref, text, source) {
    return {
      id: "v" + Math.random().toString(36).slice(2, 10),
      ref: ref,
      text: text,
      source: source,
      attempts: 0,
      best: 0,
      last: null,
      recent: [],
      ease: EASE_START,
      reps: 0,
      interval: 0,
      due: null                // never scheduled — comes up straight away
    };
  }

  function seed() {
    return {
      schema: SCHEMA,
      verses: STARTER.map(v => blankVerse(v[0], v[1], "kjv")),
      activeId: null,
      history: {}
    };
  }

  // Anything read off disk goes through here, so a hand-edited or truncated
  // field can't reach the scheduler.
  function whole(n, max) {
    const x = Math.floor(Number(n));
    return Number.isFinite(x) && x > 0 ? Math.min(x, max) : 0;
  }

  function normalizeVerse(v) {
    const out = {
      id: v.id || blankVerse("", "", "custom").id,
      ref: String(v.ref),
      text: String(v.text),
      source: v.source === "custom" ? "custom" : "kjv",
      attempts: Number(v.attempts) || 0,
      best: Number(v.best) || 0,
      last: DAY.test(String(v.last)) ? String(v.last) : null,
      recent: Array.isArray(v.recent) ? v.recent.slice(-5).map(Number) : [],
      ease: Number(v.ease) >= EASE_FLOOR ? Math.min(Number(v.ease), 5) : EASE_START,
      reps: whole(v.reps, 999),
      interval: whole(v.interval, MAX_INTERVAL),
      due: DAY.test(String(v.due)) ? String(v.due) : null
    };
    // Repetitions with no interval behind them would multiply out to zero for
    // ever, parking the verse as permanently due.
    if (out.reps > 0 && out.interval < 1) out.interval = 1;
    return out;
  }

  // v1 payloads carry practice history but no schedule. Rebuild one by replaying
  // the scores already on record through the same ladder a live attempt climbs,
  // then anchor it to the day that verse was last practised. Nothing is invented:
  // a verse with no recorded attempts simply comes up due.
  function migrate(data) {
    if (Number(data.schema) >= SCHEMA) return data;
    data.verses.forEach(v => {
      let s = { ease: EASE_START, reps: 0, interval: 0 };
      v.recent.forEach(score => { s = step(s, quality(score)); });
      v.ease = s.ease;
      v.reps = s.reps;
      v.interval = s.interval;
      v.due = v.last && s.interval ? addDays(v.last, s.interval) : null;
    });
    data.schema = SCHEMA;
    return data;
  }

  function load() {
    let raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { /* storage blocked */ }
    if (!raw) return seed();
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.verses) || !parsed.verses.length) return seed();
      parsed.history = parsed.history || {};
      parsed.verses = parsed.verses.filter(v => v && v.ref && v.text).map(normalizeVerse);
      if (!parsed.verses.length) return seed();
      return migrate(parsed);
    } catch (e) {
      return seed();
    }
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* quota or private mode */ }
  }

  function active() {
    return state.verses.find(v => v.id === state.activeId) || state.verses[0];
  }

  /* ------------------------------------------------------------------ *
   * Words
   * ------------------------------------------------------------------ */
  function tokens(text) {
    return text.trim().split(/\s+/).filter(Boolean);
  }

  function normal(word) {
    return word
      .replace(/[‘’ʼ]/g, "'")
      .toLowerCase()
      .replace(/[^a-z0-9']/g, "")
      .replace(/^'+|'+$/g, "");
  }

  function isMastered(v) {
    const tail = v.recent.slice(-MASTERY_RUNS);
    return tail.length === MASTERY_RUNS && tail.every(s => s >= MASTERY_SCORE);
  }

  /* ------------------------------------------------------------------ *
   * Scheduling — SM-2, with the quality grade read off the recall score
   * instead of a self-rating. The schedule lives on the verse: ease, reps,
   * interval (days), and due (a day key, or null for "not yet scheduled").
   * ------------------------------------------------------------------ */
  function todayKey(d) {
    const t = d || new Date();
    return t.getFullYear() + "-" + String(t.getMonth() + 1).padStart(2, "0") + "-" + String(t.getDate()).padStart(2, "0");
  }

  function addDays(key, n) {
    const p = key.split("-").map(Number);
    const d = new Date(p[0], p[1] - 1, p[2]);
    d.setDate(d.getDate() + n);
    return todayKey(d);
  }

  // Whole days from today to a day key — UTC arithmetic so a daylight-saving
  // boundary can't round a 6-day interval to 5.
  function daysUntil(key) {
    const p = key.split("-").map(Number);
    const t = todayKey().split("-").map(Number);
    return Math.round((Date.UTC(p[0], p[1] - 1, p[2]) - Date.UTC(t[0], t[1] - 1, t[2])) / 86400000);
  }

  function quality(score) {
    if (score >= 95) return 5;
    if (score >= 85) return 4;
    if (score >= 70) return 3;   // 3 is SM-2's pass mark; below it the verse lapses
    if (score >= 50) return 2;
    if (score >= 25) return 1;
    return 0;
  }

  // One rung of the ladder. Pure, so migrate() can replay recorded scores
  // through exactly the code a live attempt runs.
  function step(sched, q) {
    let ease = sched.ease || EASE_START;
    let reps = sched.reps || 0;
    let interval = sched.interval || 0;
    if (q >= 3) {
      interval = reps === 0 ? 1 : reps === 1 ? 6 : Math.round(interval * ease);
      reps++;
    } else {
      reps = 0;                  // a lapse drops you back to the bottom rung
      interval = 1;
    }
    ease = Math.max(EASE_FLOOR, ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
    return {
      ease: Math.round(ease * 1000) / 1000,
      reps: reps,
      interval: Math.min(MAX_INTERVAL, interval)
    };
  }

  function isDue(v) {
    return !v.due || v.due <= todayKey();
  }

  // Overdue reviews come before verses never started: forgetting something you
  // once knew costs more than postponing something you haven't begun.
  function dueVerses() {
    const key = v => v.due || "9999-12-31";
    return state.verses.filter(isDue).sort((a, b) => key(a).localeCompare(key(b)));
  }

  function nextScheduled() {
    return state.verses.filter(v => !isDue(v)).sort((a, b) => a.due.localeCompare(b.due))[0] || null;
  }

  function inDays(n) {
    if (n <= 0) return "today";
    if (n === 1) return "tomorrow";
    if (n < 14) return "in " + n + " days";
    if (n < 60) return "in " + Math.round(n / 7) + " weeks";
    if (n < 365) return "in " + Math.round(n / 30) + " months";
    return "in a year";
  }

  function shortSpan(n) {
    if (n < 7) return n + "d";
    if (n < 60) return Math.round(n / 7) + "w";
    return Math.round(n / 30) + "mo";
  }

  // Deterministic-per-shuffle order so raising the veil hides a superset
  function shuffleOrder(n) {
    const idx = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = idx[i]; idx[i] = idx[j]; idx[j] = t;
    }
    return idx;
  }

  function hiddenSet() {
    const words = tokens(active().text);
    if (hideOrder.length !== words.length) hideOrder = shuffleOrder(words.length);
    const count = Math.round(words.length * veil / 100);
    return new Set(hideOrder.slice(0, count));
  }

  /* ------------------------------------------------------------------ *
   * Diff — LCS alignment, then pair leftovers into near misses
   * ------------------------------------------------------------------ */
  function levenshtein(a, b) {
    if (a === b) return 0;
    const m = a.length, n = b.length;
    if (!m || !n) return m || n;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    const cur = new Array(n + 1);
    for (let i = 1; i <= m; i++) {
      cur[0] = i;
      for (let j = 1; j <= n; j++) {
        cur[j] = Math.min(
          prev[j] + 1,
          cur[j - 1] + 1,
          prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
        );
      }
      prev = cur.slice();
    }
    return prev[n];
  }

  function isNear(a, b) {
    const d = levenshtein(a, b);
    const len = Math.max(a.length, b.length);
    if (len <= 3) return d === 0;
    if (len <= 6) return d <= 1;
    return d <= 2;
  }

  function align(ref, said) {
    const n = ref.length, m = said.length;
    const dp = [];
    for (let i = 0; i <= n; i++) dp.push(new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] = ref[i] === said[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    const ops = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (ref[i] === said[j]) { ops.push({ t: "same", ri: i }); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ t: "del", ri: i }); i++; }
      else { ops.push({ t: "ins", ti: j }); j++; }
    }
    while (i < n) ops.push({ t: "del", ri: i++ });
    while (j < m) ops.push({ t: "ins", ti: j++ });
    return ops;
  }

  function compare(refText, saidText) {
    const refRaw = tokens(refText).slice(0, MAX_ALIGN_WORDS);
    const saidRaw = tokens(saidText).slice(0, MAX_ALIGN_WORDS);
    const ref = refRaw.map(normal).filter(Boolean);
    const said = saidRaw.map(normal).filter(Boolean);
    const refDisplay = refRaw.filter(w => normal(w));
    const saidDisplay = saidRaw.filter(w => normal(w));

    const ops = align(ref, said);
    const out = [];
    let k = 0;

    while (k < ops.length) {
      if (ops[k].t === "same") { out.push({ t: "ok", word: refDisplay[ops[k].ri] }); k++; continue; }

      // gather a contiguous run of non-matching ops and pair them up
      const dels = [], inss = [];
      while (k < ops.length && ops[k].t !== "same") {
        if (ops[k].t === "del") dels.push(ops[k].ri); else inss.push(ops[k].ti);
        k++;
      }
      const usedIns = new Set();
      for (const ri of dels) {
        let hit = -1;
        for (let x = 0; x < inss.length; x++) {
          if (usedIns.has(x)) continue;
          if (isNear(ref[ri], said[inss[x]])) { hit = x; break; }
        }
        if (hit >= 0) {
          usedIns.add(hit);
          out.push({ t: "close", word: refDisplay[ri], said: saidDisplay[inss[hit]] });
        } else {
          out.push({ t: "miss", word: refDisplay[ri] });
        }
      }
      inss.forEach((ti, x) => {
        if (!usedIns.has(x)) out.push({ t: "extra", word: saidDisplay[ti] });
      });
    }

    const counts = { ok: 0, close: 0, miss: 0, extra: 0 };
    out.forEach(o => counts[o.t]++);
    // words you added that aren't in the verse count against you, so a padded
    // recitation can't reach 100%
    const total = (ref.length || 1) + counts.extra;
    const score = Math.max(0, Math.min(100, Math.round(100 * (counts.ok + counts.close * 0.5) / total)));
    return { marks: out, counts: counts, score: score };
  }

  /* ------------------------------------------------------------------ *
   * Rendering
   * ------------------------------------------------------------------ */
  const $ = id => document.getElementById(id);
  const el = (tag, cls) => { const n = document.createElement(tag); if (cls) n.className = cls; return n; };

  function revealable(cls, label, i) {
    const s = el("span", cls);
    s.setAttribute("role", "button");
    s.tabIndex = 0;
    s.setAttribute("aria-label", label);
    const reveal = () => { peeked.add(i); renderVerse(); };
    s.addEventListener("click", reveal);
    s.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); reveal(); }
    });
    return s;
  }

  function renderVerse() {
    const v = active();
    const box = $("verse");
    box.textContent = "";
    box.hidden = mode === "recite";
    if (mode === "recite") return;

    const words = tokens(v.text);

    if (mode === "read") {
      box.textContent = v.text;
      return;
    }

    const hidden = mode === "veil" ? hiddenSet() : null;

    words.forEach((word, i) => {
      const shown = peeked.has(i) || (mode === "veil" && !hidden.has(i));
      if (shown) {
        const span = el("span", peeked.has(i) ? "tok peeked" : "tok");
        span.textContent = word;
        box.appendChild(span);
      } else if (mode === "veil") {
        const b = revealable("tok blank", "Hidden word " + (i + 1) + ", reveal", i);
        const inner = el("span", "veiled");
        inner.textContent = word;
        inner.setAttribute("aria-hidden", "true");
        b.appendChild(inner);
        box.appendChild(b);
      } else {
        // initials: keep the first letter, drain the rest but hold its width
        const m = word.match(/^([^A-Za-z0-9]*)([A-Za-z0-9])(.*)$/);
        const b = revealable("tok initial", "Word " + (i + 1) + " starting with " + (m ? m[2] : word[0]) + ", reveal", i);
        if (m) {
          b.appendChild(document.createTextNode(m[1] + m[2]));
          const rest = el("span", "veiled");
          rest.textContent = m[3];
          rest.setAttribute("aria-hidden", "true");
          b.appendChild(rest);
        } else {
          b.textContent = word;
        }
        box.appendChild(b);
      }
      if (i < words.length - 1) box.appendChild(document.createTextNode(" "));
    });
  }

  function renderStage() {
    const v = active();
    $("ref").textContent = v.ref;
    $("seal").hidden = !isMastered(v);

    document.querySelectorAll("#switch button").forEach(b => {
      b.setAttribute("aria-pressed", String(b.dataset.mode === mode));
    });

    $("veilControls").hidden = mode !== "veil";
    $("recite").hidden = mode !== "recite";
    $("printBtn").hidden = mode !== "veil" && mode !== "initials";
    if (mode !== "recite") { $("result").hidden = true; }

    renderVerse();

    const peeks = peeked.size;
    const printHint = " Print a blank worksheet with the button above, or press ⌘/Ctrl+P.";
    const notes = {
      read: "Read it through two or three times before you veil it.",
      veil: (peeks ? peeks + (peeks === 1 ? " word restored" : " words restored") + " — those are the ones to work on." : "Click any blank to bring the word back in red.") + printHint,
      initials: (peeks ? peeks + (peeks === 1 ? " word restored." : " words restored.") : "Only the first letter stays. Click a word to see the rest.") + printHint,
      recite: SpeechRecognition ? "Type it, or tap Speak it and say it aloud." : ""
    };
    $("hint").innerHTML = notes[mode] +
      (mode === "recite" ? "" : " <span style=\"color:var(--ink-faint)\">&middot; <kbd>1</kbd>&ndash;<kbd>4</kbd> switch modes, <kbd>&larr;</kbd> <kbd>&rarr;</kbd> change verse</span>");

    $("reciteNote").textContent = v.attempts
      ? v.attempts + (v.attempts === 1 ? " attempt" : " attempts") + " · best " + v.best + "%"
      : "First attempt";
  }

  function renderVeilSeg() {
    const seg = $("veilSeg");
    seg.textContent = "";
    VEIL_STEPS.forEach(p => {
      const b = el("button");
      b.type = "button";
      b.textContent = p + "%";
      b.setAttribute("aria-pressed", String(p === veil));
      b.addEventListener("click", () => { veil = p; renderStage(); });
      seg.appendChild(b);
    });
  }

  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // The one definition of "matches the deck search query" — matchesQuery()
  // (which verses to show) and appendHighlighted() (what to mark inside them)
  // both build their regex from this, so a verse can never be shown as a hit
  // without a highlight to justify it, or vice versa. Case-insensitive via
  // the regex engine's own folding rather than toLowerCase(): the two
  // disagree for some Unicode (toLowerCase() decomposes Turkish "İ" into "i"
  // plus a combining mark, so a plain-substring check finds "i" inside it,
  // where regex case-folding treats "İ" as its own letter), and a shared
  // regex is what keeps filtering and highlighting from silently diverging.
  function queryRegex(q, flags) {
    return new RegExp(escapeRegExp(q), flags);
  }

  function matchesQuery(v, q) {
    const re = queryRegex(q, "i");
    return re.test(v.ref) || re.test(v.text);
  }

  // "due" reuses isDue() as-is, so it includes never-started verses — the
  // same "due" chip a card already shows them under (line ~596), rather than
  // inventing a second, disagreeing notion of "due" here. "new" (never
  // recited) is a separate facet from "due": a fresh verse is both, an
  // overdue-but-once-recited verse is due but not new.
  function matchesFilter(v, filter) {
    if (filter === "due") return isDue(v);
    if (filter === "mastered") return isMastered(v);
    if (filter === "new") return !v.attempts;
    return true;
  }

  // Deliberately distinct wording for "no results because of the filter
  // alone" versus "no results because the search query also ruled things
  // out" — the reader needs to know whether clearing the search box would
  // help, since the filter select alone (the deck is never empty; see
  // removeVerse()) can already produce zero cards.
  function emptyStateMessage(filter, query) {
    const noun = filter === "due" ? "due" : filter === "mastered" ? "mastered" : filter === "new" ? "not-started" : "";
    if (query) {
      return "No" + (noun ? " " + noun : "") + " verses match “" + query + "”.";
    }
    if (filter === "due") return "Nothing due right now.";
    if (filter === "mastered") return "No verses mastered yet.";
    if (filter === "new") return "Every verse has been attempted at least once.";
    return "";
  }

  // Appends `text` to `parent`, wrapping every hit of queryRegex() in a
  // <mark> — built as DOM nodes (never innerHTML) since verse text and refs
  // are user-supplied. Matches against the original `text` rather than a
  // lowercased copy: toLowerCase() can change a string's length (e.g. "İ"
  // becomes two characters), which would desync a lowercased match index
  // from the original text and slice the wrong substring.
  function appendHighlighted(parent, text, q) {
    if (!q) { parent.appendChild(document.createTextNode(text)); return; }
    const re = queryRegex(q, "gi");
    let last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) parent.appendChild(document.createTextNode(text.slice(last, m.index)));
      const mark = el("mark", "hit");
      mark.textContent = m[0];
      parent.appendChild(mark);
      last = m.index + m[0].length;
    }
    if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
  }

  // "added" is a no-op — state.verses is already insertion order, since every
  // add appends. "due" groups overdue-or-unstarted verses before scheduled
  // ones, same rule dueVerses() sorts the review queue by (real dates before
  // the null-due sentinel), so a verse reads "due" in the same relative spot
  // here as it does up in the queue. "az" sorts the reference text itself,
  // not canonical book order — this is a search aid, not a Bible index.
  function sortDeck(list, sortKey) {
    if (sortKey === "due") {
      const key = v => (isDue(v) ? "0:" : "1:") + (v.due || "9999-12-31");
      return list.slice().sort((a, b) => key(a).localeCompare(key(b)));
    }
    if (sortKey === "az") {
      return list.slice().sort((a, b) => a.ref.localeCompare(b.ref, undefined, { sensitivity: "base" }));
    }
    return list;
  }

  // Saving a correction updates the verse in place — same id, so the SM-2
  // schedule, attempt history, and streak all survive a fixed typo rather
  // than the delete-and-re-add path forcing a reader to lose that progress
  // over a misspelling. A hand-edited verse can no longer claim to be the
  // verified 1769 text test/verify-kjv.mjs checks the starter deck against,
  // so editing any verse — starter or custom — marks it "custom".
  function saveVerseEdit(id, ref, text) {
    const v = state.verses.find(x => x.id === id);
    if (!v) return;
    v.ref = ref;
    v.text = text;
    v.source = "custom";
    editingId = null;
    editDraft = null;
    // peeked/hideOrder hold word indices into the *old* text; a changed word
    // count would leave them pointing at the wrong words, or past the end.
    if (v.id === active().id) {
      // A "Speak it" session left running would keep listening against the
      // verse we just rewrote — its eventual transcript (spoken against the
      // *old* text) would grade via runCheck()'s `active()` lookup against
      // the *new* one, same class of bug selectVerse()/removeVerse() already
      // guard against for exactly this reason.
      endListening(false);
      setSpeakStatus("", false);
      peeked = new Set();
      hideOrder = [];
      $("attempt").value = "";
      $("result").hidden = true;
    }
    save();
    renderAll();
  }

  function buildEditForm(v) {
    const form = el("form", "card-edit");
    const draft = editDraft || { ref: v.ref, text: v.text };

    const refField = el("div");
    const refLabel = el("label");
    refLabel.htmlFor = "editRef";
    refLabel.textContent = "Reference";
    const refRow = el("div", "reflookup");
    const refInput = document.createElement("input");
    refInput.id = "editRef";
    refInput.value = draft.ref;
    refInput.addEventListener("input", () => { editDraft.ref = refInput.value; });
    const lookupBtn = el("button", "btn");
    lookupBtn.type = "button";
    lookupBtn.textContent = "Look up";
    lookupBtn.hidden = !KJV_LOOKUP_SUPPORTED;
    refRow.appendChild(refInput);
    refRow.appendChild(lookupBtn);
    refField.appendChild(refLabel);
    refField.appendChild(refRow);

    const textField = el("div");
    const textLabel = el("label");
    textLabel.htmlFor = "editText";
    textLabel.textContent = "Verse text";
    const textArea = document.createElement("textarea");
    textArea.id = "editText";
    textArea.value = draft.text;
    textArea.addEventListener("input", () => { editDraft.text = textArea.value; });
    textField.appendChild(textLabel);
    textField.appendChild(textArea);

    const err = el("p", "err");

    // Same re-fetch "Add a verse of your own" offers via its own Look up
    // button (KJV_LOOKUP_SUPPORTED / lookupReference, defined below) — a
    // typo in the reference shouldn't force retyping the verse text by hand
    // too. Programmatic value assignment doesn't fire "input", so the draft
    // needs the same explicit sync doLookup's own field assignment skips
    // only because it writes straight to state, not a live draft.
    async function doEditLookup() {
      // Captured by identity, not by this card's id: cancelling and
      // reopening the *same* card also swaps in a fresh editDraft object,
      // and a lookup that started before that must still be told apart from
      // one running against whatever draft is live now.
      const draftAtStart = editDraft;
      // Also snapshot its *content* — the form can stay open on the same
      // card the whole time, with the reader typing further corrections
      // into either field while the lookup is still in flight. A stale
      // result must not clobber that either, even though editDraft itself
      // never changed identity.
      const snapshotRef = draftAtStart.ref;
      const snapshotText = draftAtStart.text;
      const stillFresh = () => editDraft === draftAtStart && draftAtStart.ref === snapshotRef && draftAtStart.text === snapshotText;
      const raw = refInput.value.trim();
      if (!raw) { err.textContent = "Give it a reference to look up."; refInput.focus(); return; }
      lookupBtn.disabled = true;
      const original = lookupBtn.textContent;
      lookupBtn.textContent = "Looking up…";
      err.textContent = "";
      try {
        const result = await lookupReference(raw);
        // The user may have cancelled, saved, moved to editing a different
        // card, or just kept typing in this same form while this was in
        // flight. Applying a stale result now would silently overwrite
        // whatever's actually there with this lookup's own text.
        if (!stillFresh()) return;
        if (result.error) { err.textContent = result.error; return; }
        draftAtStart.ref = result.ref;
        draftAtStart.text = result.text;
        renderDeck();
        $("editText").focus();
      } catch (e) {
        if (stillFresh()) err.textContent = "Couldn't look that up just now — try again.";
      } finally {
        lookupBtn.disabled = false;
        lookupBtn.textContent = original;
      }
    }
    lookupBtn.addEventListener("click", doEditLookup);
    refInput.addEventListener("keydown", ev => {
      if (ev.key === "Enter" && KJV_LOOKUP_SUPPORTED) { ev.preventDefault(); doEditLookup(); }
    });

    const actions = el("div", "actions");
    const saveBtn = el("button", "btn primary");
    saveBtn.type = "submit";
    saveBtn.textContent = "Save";
    const cancelBtn = el("button", "btn quiet");
    cancelBtn.type = "button";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", ev => {
      ev.stopPropagation();
      editingId = null;
      editDraft = null;
      renderDeck();
    });
    actions.appendChild(saveBtn);
    actions.appendChild(cancelBtn);

    form.appendChild(refField);
    form.appendChild(textField);
    form.appendChild(err);
    form.appendChild(actions);
    form.addEventListener("click", ev => ev.stopPropagation());
    form.addEventListener("submit", ev => {
      ev.preventDefault();
      const ref = refInput.value.trim();
      const text = textArea.value.trim();
      if (!ref) { err.textContent = "Give it a reference so you can find it again."; refInput.focus(); return; }
      if (tokens(text).length < 2) { err.textContent = "Needs at least a couple of words."; textArea.focus(); return; }
      saveVerseEdit(v.id, ref, text);
    });
    return form;
  }

  function renderDeck() {
    const cards = $("cards");
    cards.textContent = "";
    const q = deckQuery.trim().toLowerCase();
    const base = deckFilter === "all" ? state.verses : state.verses.filter(v => matchesFilter(v, deckFilter));
    const matched = q ? base.filter(v => matchesQuery(v, q)) : base;
    const shown = sortDeck(matched, deckSort);
    cards.hidden = shown.length === 0;
    $("cardsEmpty").hidden = shown.length > 0;
    if (shown.length === 0) {
      $("cardsEmpty").textContent = emptyStateMessage(deckFilter, deckQuery.trim());
    }
    $("deckSearchCount").textContent = (q || deckFilter !== "all")
      ? shown.length + " of " + state.verses.length + " shown" : "";
    shown.forEach(v => {
      const card = el("div", "card" + (v.id === active().id ? " active" : ""));

      if (editingId === v.id) {
        // No .open overlay while editing — it would swallow clicks meant for
        // the form's own inputs and buttons.
        card.classList.add("editing");
        card.appendChild(buildEditForm(v));
        cards.appendChild(card);
        return;
      }

      const ref = el("div", "ref");
      const open = el("button", "open");
      open.type = "button";
      appendHighlighted(open, v.ref, q);
      open.addEventListener("click", () => selectVerse(v.id));
      ref.appendChild(open);
      if (isMastered(v)) {
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("viewBox", "0 0 16 16");
        svg.setAttribute("fill", "none");
        svg.setAttribute("stroke", "currentColor");
        svg.setAttribute("stroke-width", "2.4");
        svg.setAttribute("aria-hidden", "true");
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", "M2.5 8.5 6 12l7.5-8");
        path.setAttribute("stroke-linecap", "round");
        path.setAttribute("stroke-linejoin", "round");
        svg.appendChild(path);
        ref.appendChild(svg);
      }

      const when = el("span", "when" + (isDue(v) ? " now" : ""));
      when.textContent = isDue(v) ? "due" : shortSpan(daysUntil(v.due));
      when.title = !v.due ? "Not scheduled yet"
        : isDue(v) ? "Due since " + v.due
        : "Next review " + v.due;
      ref.appendChild(when);

      const snip = el("p", "snippet");
      appendHighlighted(snip, v.text, q);

      const meter = el("div", "meter");
      const fill = el("i");
      fill.style.width = v.best + "%";
      meter.appendChild(fill);

      const stat = el("div", "stat");
      const left = el("span");
      left.textContent = v.attempts ? "best " + v.best + "% · " + v.attempts + "×" : "not yet recited";
      const edit = el("button", "edit");
      edit.type = "button";
      edit.textContent = "edit";
      edit.setAttribute("aria-label", "Edit " + v.ref);
      edit.addEventListener("click", ev => {
        ev.stopPropagation();
        editingId = v.id;
        editDraft = { ref: v.ref, text: v.text };
        renderDeck();
      });
      const drop = el("button", "drop");
      drop.type = "button";
      drop.textContent = "remove";
      drop.setAttribute("aria-label", "Remove " + v.ref + " from the deck");
      drop.addEventListener("click", ev => {
        ev.stopPropagation();
        if (drop.dataset.armed !== "1") {
          drop.dataset.armed = "1";
          drop.textContent = "remove?";
          setTimeout(() => {
            if (!drop.isConnected) return;
            drop.dataset.armed = "";
            drop.textContent = "remove";
          }, 3000);
          return;
        }
        removeVerse(v.id);
      });
      const statActions = el("span", "stat-actions");
      statActions.appendChild(edit);
      statActions.appendChild(drop);
      stat.appendChild(left);
      stat.appendChild(statActions);

      card.appendChild(ref);
      card.appendChild(snip);
      card.appendChild(meter);
      card.appendChild(stat);
      cards.appendChild(card);
    });
  }

  function streakLength() {
    let n = 0;
    const d = new Date();
    if (!state.history[todayKey(d)]) d.setDate(d.getDate() - 1); // today not required
    while (state.history[todayKey(d)]) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }

  function renderStreak() {
    const days = $("streakDays");
    days.textContent = "";
    const n = streakLength();
    $("streakLabel").textContent = "Last 28 days · " + (n ? n + (n === 1 ? " day running" : " days running") : "no run yet");
    for (let i = 27; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const count = state.history[todayKey(d)] || 0;
      const cell = el("div", "day" + (count >= 3 ? " hot" : count > 0 ? " lit" : ""));
      cell.title = todayKey(d) + (count ? " — " + count + (count === 1 ? " attempt" : " attempts") : " — none");
      days.appendChild(cell);
    }
  }

  function renderTally() {
    const mastered = state.verses.filter(isMastered).length;
    $("tally").innerHTML = "<b>" + state.verses.length + "</b> verses &nbsp;/&nbsp; <b>" +
      dueVerses().length + "</b> due &nbsp;/&nbsp; <b>" + mastered + "</b> mastered";
  }

  function renderQueue() {
    const due = dueVerses();
    $("queueN").textContent = due.length;
    $("queue").classList.toggle("rest", due.length === 0);
    $("queueGo").hidden = due.length === 0;
    if (due.length) {
      $("queueLabel").textContent = due.length === 1 ? "verse due" : "verses due";
      $("queueSub").textContent = "Next up " + due[0].ref + ".";
    } else {
      const next = nextScheduled();
      $("queueLabel").textContent = "nothing due";
      $("queueSub").textContent = next
        ? next.ref + " comes back round " + inDays(daysUntil(next.due)) + "."
        : "Recite a verse to start its schedule.";
    }
    // The count reads as a bare numeral beside its label, which announces as two
    // disconnected fragments. Carry the whole sentence in one polite live region
    // instead, and hide the visual pieces from the accessibility tree.
    $("queueSays").textContent = (due.length
      ? due.length + (due.length === 1 ? " verse due. " : " verses due. ")
      : "Nothing due. ") + $("queueSub").textContent;
  }

  function renderAll() {
    renderStage();
    renderDeck();
    renderQueue();
    renderStreak();
    renderTally();
  }

  /* ------------------------------------------------------------------ *
   * Actions
   * ------------------------------------------------------------------ */
  function selectVerse(id) {
    endListening(false);
    setSpeakStatus("", false);
    state.activeId = id;
    peeked = new Set();
    hideOrder = [];
    $("attempt").value = "";
    $("result").hidden = true;
    save();
    renderAll();
    $("stage").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  }

  function removeVerse(id) {
    if (state.verses.length === 1) return;
    const wasActive = active().id === id;
    // Removing the verse currently being recited must not leave a listener
    // running: its transcript would otherwise land on whatever verse becomes
    // active next, grading a recitation that was never made against it.
    if (wasActive) { endListening(false); setSpeakStatus("", false); }
    state.verses = state.verses.filter(v => v.id !== id);
    if (wasActive) {
      state.activeId = state.verses[0].id;
      peeked = new Set();
      hideOrder = [];
      $("attempt").value = "";
      $("result").hidden = true;
    }
    // The "next due" button can point at a verse other than the active one —
    // removing that verse must not leave the button dangling on a deleted id.
    if (id === nextDueId) {
      nextDueId = null;
      $("nextDueBtn").hidden = true;
    }
    save();
    renderAll();
  }

  function stepVerse(dir) {
    const i = state.verses.findIndex(v => v.id === active().id);
    const next = state.verses[(i + dir + state.verses.length) % state.verses.length];
    selectVerse(next.id);
  }

  function setMode(next) {
    if (mode === "recite" && next !== "recite") { endListening(false); setSpeakStatus("", false); }
    mode = next;
    if (next === "recite") { $("result").hidden = true; }
    renderStage();
    if (next === "recite") $("attempt").focus();
  }

  function runCheck() {
    if (listener) endListening(false); // grading now; the async onend shouldn't grade again
    const v = active();
    const typed = $("attempt").value.trim();
    if (!typed) { $("attempt").focus(); return; }

    // A verse or attempt this long would blow up align()'s O(n·m) matrix.
    // Refuse to grade rather than silently comparing only the first
    // MAX_ALIGN_WORDS and reporting a false "exact" past that point — a
    // recitation this app can't fully check must not be able to reach mastery.
    if (tokens(v.text).length > MAX_ALIGN_WORDS || tokens(typed).length > MAX_ALIGN_WORDS) {
      $("result").hidden = true; // don't leave an earlier attempt's score on screen for this one
      $("reciteNote").textContent = "Too long to check automatically — keep it under " + MAX_ALIGN_WORDS + " words.";
      return;
    }

    const res = compare(v.text, typed);

    // Only a review that was actually due moves the schedule. Running the same
    // verse again this afternoon is practice, not a review — otherwise four taps
    // of "Check my recall" would compound the interval out to six weeks.
    const wasDue = isDue(v);

    v.attempts++;
    v.best = Math.max(v.best, res.score);
    v.recent = v.recent.concat(res.score).slice(-5);
    v.last = todayKey();

    if (wasDue) {
      const sched = step(v, quality(res.score));
      v.ease = sched.ease;
      v.reps = sched.reps;
      v.interval = sched.interval;
      v.due = addDays(todayKey(), sched.interval);
      $("nextUp").textContent = sched.reps === 0
        ? "That one needs another pass — back tomorrow."
        : "Filed for review " + inDays(sched.interval) + ", on " + v.due + ".";

      // Hand off to whatever's next in the queue rather than leaving the
      // reader to scroll back to the deck and press "Review now" again.
      const stillDue = dueVerses();
      if (stillDue.length) {
        nextDueId = stillDue[0].id;
        $("nextDueBtn").hidden = false;
        $("nextDueBtn").textContent = "Next due: " + stillDue[0].ref + " →";
      } else {
        nextDueId = null;
        $("nextDueBtn").hidden = true;
        $("nextUp").textContent += " Queue cleared — nothing else due.";
      }
    } else {
      $("nextUp").textContent = "Extra practice — " + v.ref + " stays filed for " +
        inDays(daysUntil(v.due)) + ", on " + v.due + ".";
      nextDueId = null;
      $("nextDueBtn").hidden = true;
    }

    state.history[todayKey()] = (state.history[todayKey()] || 0) + 1;
    save();

    $("pct").textContent = res.score + "%";
    $("pct").style.color = res.score >= MASTERY_SCORE ? "var(--verdigris)" : res.score >= 70 ? "var(--ink)" : "var(--madder)";

    const bd = $("breakdown");
    bd.textContent = "";
    [["n-ok", res.counts.ok, "exact"], ["n-close", res.counts.close, "near"], ["n-miss", res.counts.miss, "missed"], ["n-extra", res.counts.extra, "extra"]]
      .forEach(([cls, n, label]) => {
        const s = el("span", cls);
        s.innerHTML = "<b>" + n + "</b> " + label;
        bd.appendChild(s);
      });

    const marked = $("marked");
    marked.textContent = "";
    res.marks.forEach((m, i) => {
      const span = el("span", m.t);
      span.textContent = m.word;
      if (m.t === "close") span.title = "You wrote “" + m.said + "”";
      marked.appendChild(span);
      if (i < res.marks.length - 1) marked.appendChild(document.createTextNode(" "));
    });

    $("result").hidden = false;
    $("reciteNote").textContent = v.attempts + (v.attempts === 1 ? " attempt" : " attempts") + " · best " + v.best + "%";
    renderDeck();
    renderQueue();
    renderStreak();
    renderTally();
    $("seal").hidden = !isMastered(v);
  }

  /* ------------------------------------------------------------------ *
   * Verse lookup — "Add any verse by reference" without pasting text.
   * KJV_BOOKS and KJV_DATA_GZ_B64 come from src/kjv-data.js (generated by
   * `npm run gen:kjv`), concatenated ahead of this file at build time.
   * Missing outright where DecompressionStream doesn't exist, same pattern
   * as Speak It below — a feature that can't work stays absent, not present
   * and broken.
   * ------------------------------------------------------------------ */
  const KJV_LOOKUP_SUPPORTED = typeof DecompressionStream !== "undefined";

  // A batch this large is already a copy-pasted reading plan, not a quick
  // add — bounding it keeps one runaway paste from queuing thousands of
  // sequential lookups.
  const ADD_MANY_MAX = 50;

  const BOOK_ALIAS = {
    "psalm": "Psalms",
    "song of solomon": "Solomon's Song",
    "song of songs": "Solomon's Song",
    "canticles": "Solomon's Song"
  };

  // The kjv package files this book under its plural name; the app displays
  // the singular everywhere else (test/verify-kjv.mjs documents the same
  // split), so a looked-up reference needs to un-pluralize for display even
  // though the data itself stays keyed under "Psalms".
  const BOOK_DISPLAY = { "Psalms": "Psalm" };

  function resolveBook(name) {
    const low = name.trim().toLowerCase();
    if (BOOK_ALIAS[low]) return BOOK_ALIAS[low];
    return KJV_BOOKS.find(b => b.toLowerCase() === low) || null;
  }

  // "Romans 8:28", "Romans 8:28-30", or "Romans 8" (whole chapter).
  function parseReference(raw) {
    const m = String(raw).trim().match(/^(.+?)\s+(\d+)(?::(\d+)(?:-(\d+))?)?$/);
    if (!m) return null;
    const [, book, chapter, from, to] = m;
    return {
      book: book.trim(),
      chapter: Number(chapter),
      from: from ? Number(from) : null,
      to: to ? Number(to) : (from ? Number(from) : null)
    };
  }

  // Decompressed once, lazily, and cached — nothing needs it until the first lookup.
  let kjvIndexPromise = null;
  function kjvIndex() {
    if (!kjvIndexPromise) {
      kjvIndexPromise = (async () => {
        const binary = atob(KJV_DATA_GZ_B64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
        const text = await new Response(stream).text();
        return JSON.parse(text);
      })();
    }
    return kjvIndexPromise;
  }

  async function lookupReference(raw) {
    const parsed = parseReference(raw);
    if (!parsed) return { error: "Couldn't read that as a reference — try “Romans 8:28” or “Romans 8”." };
    const book = resolveBook(parsed.book);
    if (!book) return { error: "No book called “" + parsed.book + "” in the KJV." };
    if (parsed.from !== null && parsed.from > parsed.to) {
      return { error: parsed.from + "-" + parsed.to + " isn't a valid verse range." };
    }
    const index = await kjvIndex();
    let chapter = parsed.chapter;
    let from = parsed.from, to = parsed.to;
    // Jude, Obadiah, Philemon, 2 John, and 3 John have only one chapter, so
    // their conventional citation ("Jude 3") gives a verse number, not a
    // chapter — unlike "Romans 8", which means the whole chapter 8. A book
    // with no second chapter in the data is exactly the single-chapter case.
    if (from === null && !index[book + " 2:1"]) {
      from = to = chapter;
      chapter = 1;
    }
    let verseNums = [];
    if (from === null) {
      let v = 1;
      while (index[book + " " + chapter + ":" + v]) { verseNums.push(v); v++; }
      if (!verseNums.length) return { error: book + " has no chapter " + chapter + "." };
    } else {
      for (let v = from; v <= to; v++) verseNums.push(v);
    }
    const missing = verseNums.find(v => !index[book + " " + chapter + ":" + v]);
    if (missing !== undefined) {
      if (!index[book + " " + chapter + ":1"]) return { error: book + " has no chapter " + chapter + "." };
      return { error: book + " " + chapter + " has no verse " + missing + "." };
    }
    const label = BOOK_DISPLAY[book] || book;
    const ref = from === null
      ? label + " " + chapter
      : label + " " + chapter + ":" + from + (to !== from ? "-" + to : "");
    const text = verseNums.map(v => index[book + " " + chapter + ":" + v]).join(" ");
    return { ref, text };
  }

  /* ------------------------------------------------------------------ *
   * Deck sharing by URL — the ref/text pairs of the whole deck (no
   * progress, no schedule) live base64'd in the page's own location.hash,
   * so a link can be pasted straight into a browser with no backend. The
   * published Artifact's own address (CLAUDE.md) is the one durable,
   * paste-able link for that host — this frame's own `location` is an
   * internal address a second person could never open directly — so that's
   * what a share link is built from there; anywhere else (this test
   * harness, a self-hosted copy) the page's own location already is that
   * address.
   * ------------------------------------------------------------------ */
  const SHARE_PREFIX = "#deck=";
  const SHARE_MAX_VERSES = 200;
  const SHARE_REF_MAX = 200;
  const SHARE_TEXT_MAX = 8000;
  const PUBLISHED_URL = "https://claude.ai/code/artifact/a8cc5bc3-f1af-46ba-98af-3bf2ed398794";

  // Capped exactly like decodeShareDeck reads them back — count, ref length,
  // and text length alike — so a link this page builds always decodes to
  // what it looks like it shares. Truncating only on the read side would let
  // an oversized verse arrive at the recipient reading different words than
  // the sender's own deck holds, with nothing to explain the difference.
  function encodeShareDeck(verses) {
    const compact = verses.slice(0, SHARE_MAX_VERSES)
      .map(v => [String(v.ref).trim().slice(0, SHARE_REF_MAX), String(v.text).trim().slice(0, SHARE_TEXT_MAX)]);
    const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(compact))));
    return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  // Bounded and length-capped: a link is untrusted input, however it was
  // handed to whoever opens it. One malformed entry (not a [ref, text] pair —
  // a hand-edited or truncated link) is dropped rather than voiding every
  // other verse in an otherwise-good link.
  function decodeShareDeck(b64) {
    const padded = b64.replace(/-/g, "+").replace(/_/g, "/");
    const pad = padded.length % 4 ? "=".repeat(4 - padded.length % 4) : "";
    const json = decodeURIComponent(escape(atob(padded + pad)));
    const compact = JSON.parse(json);
    if (!Array.isArray(compact) || compact.length > SHARE_MAX_VERSES) throw new Error("not a deck");
    return compact
      .filter(pair => Array.isArray(pair) && pair.length === 2)
      .map(pair => ({ ref: String(pair[0] || "").trim().slice(0, SHARE_REF_MAX), text: String(pair[1] || "").trim().slice(0, SHARE_TEXT_MAX) }))
      .filter(v => v.ref && v.text);
  }

  function shareBaseUrl() {
    // Embedded means the sandboxed Artifact frame, whose own `location` is an
    // internal address nobody else can open directly — the durable,
    // paste-able link there is the one recorded in CLAUDE.md. Top-level
    // (this test harness, a self-hosted copy) means the page's own location
    // already is that address.
    return window !== window.top
      ? PUBLISHED_URL
      : location.origin + location.pathname + location.search;
  }

  // null: no shared deck in the address. { ok:false }: a hash was there but
  // couldn't be read. { ok:true, verses }: a deck worth offering to add.
  function readSharedDeck() {
    if (!location.hash.startsWith(SHARE_PREFIX)) return null;
    try {
      const verses = decodeShareDeck(location.hash.slice(SHARE_PREFIX.length));
      return verses.length ? { ok: true, verses } : { ok: false };
    } catch (e) {
      return { ok: false };
    }
  }

  function clearShareHash() {
    try { history.replaceState(null, "", location.pathname + location.search); }
    catch (e) { /* history API unavailable in this context */ }
  }

  function describeShared(verses) {
    const existing = existingRefSet();
    const fresh = verses.filter(v => !existing.has(v.ref.toLowerCase())).length;
    if (fresh === 0) {
      return "Already in your deck — nothing new to add.";
    }
    const news = fresh + (fresh === 1 ? " new verse" : " new verses");
    return verses.length > fresh
      ? news + " (" + (verses.length - fresh) + " you already have)."
      : news + ".";
  }

  function addSharedDeck(verses) {
    const existing = existingRefSet();
    let added = 0;
    verses.forEach(sv => {
      if (existing.has(sv.ref.toLowerCase())) return;
      state.verses.push(blankVerse(sv.ref, sv.text, "custom"));
      existing.add(sv.ref.toLowerCase());
      added++;
    });
    if (added) save();
    return added;
  }

  function renderShareImport(shared) {
    const box = $("shareImport");
    if (!shared) { box.hidden = true; return; }
    box.hidden = false;
    $("shareImportLabel").textContent = shared.ok
      ? (shared.verses.length === 1 ? "Shared verse" : "Shared verses")
      : "Broken share link";
    $("shareImportSub").textContent = shared.ok
      ? describeShared(shared.verses)
      : "That link's deck couldn't be read.";
    $("shareImportAdd").hidden = !shared.ok;
  }

  /* ------------------------------------------------------------------ *
   * Recite aloud — same word-alignment grading, spoken instead of typed.
   * Missing outright on browsers with no Web Speech API (Firefox, most
   * mobile), so the button only appears where it can actually work rather
   * than showing one that does nothing.
   * ------------------------------------------------------------------ */
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let listener = null;
  let suppressAutoGrade = false;

  const SPEECH_ERRORS = {
    "not-allowed": "Microphone access was blocked — allow it and try again.",
    "service-not-allowed": "Microphone access was blocked — allow it and try again.",
    "audio-capture": "No microphone found.",
    "network": "Speech recognition needs a network connection.",
    "no-speech": "Didn't catch anything — try again."
  };

  function setSpeakStatus(text, warn) {
    const s = $("speakStatus");
    s.textContent = text ? "· " + text : "";
    s.classList.toggle("warn", !!warn);
  }

  function setListeningUI(active) {
    const b = $("speakBtn");
    b.textContent = active ? "Stop listening" : "Speak it";
    b.setAttribute("aria-pressed", String(active));
    b.classList.toggle("listening", active);
    // Every recognition event overwrites the whole field with the transcript
    // so far; read-only while listening stops that from silently clobbering
    // a manual edit the user typed mid-session.
    $("attempt").readOnly = active;
  }

  // grade=false discards whatever was heard (switching verse or mode mid-listen);
  // grade=true is the normal "I'm done" path and lets onend hand off to runCheck.
  function endListening(grade) {
    if (!listener) return;
    if (!grade) suppressAutoGrade = true;
    try { listener.stop(); }
    catch (e) {
      // stop() failed synchronously, so onend will never arrive to reset
      // this state itself — reset it here or the control stays stuck
      // reading "Stop listening" with no way to end the session.
      listener = null;
      suppressAutoGrade = false;
      setListeningUI(false);
    }
  }

  function startListening() {
    if (!SpeechRecognition || listener) return;
    const rec = new SpeechRecognition();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = true;
    rec.maxAlternatives = 1;
    let finalTranscript = "";
    let hadError = false;

    $("attempt").value = "";
    listener = rec;
    setListeningUI(true);
    setSpeakStatus("Listening…", false);

    rec.onresult = e => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalTranscript += t + " ";
        else interim += t;
      }
      $("attempt").value = (finalTranscript + interim).trim();
    };

    rec.onerror = e => {
      // A session already being discarded (switching verses, a manual Check,
      // or the browser's own "aborted" for a stop() it treats like an abort)
      // must not repopulate the status text a canceller already cleared.
      if (suppressAutoGrade || e.error === "aborted") return;
      hadError = true;
      setSpeakStatus(SPEECH_ERRORS[e.error] || "Didn't catch that — try again.", true);
    };

    rec.onend = () => {
      listener = null;
      setListeningUI(false);
      const auto = !suppressAutoGrade;
      suppressAutoGrade = false;
      if (!auto) return;
      if (finalTranscript.trim()) { setSpeakStatus("", false); runCheck(); }
      else if (!hadError) setSpeakStatus("Didn't catch anything — try again.", true);
    };

    try { rec.start(); }
    catch (e) {
      listener = null;
      setListeningUI(false);
      setSpeakStatus("Couldn't start listening — try again.", true);
    }
  }

  let exporting = false;

  async function exportDeck() {
    // The viewer allows only one undecided save prompt at a time, so a second
    // click while the first is still awaiting confirmation would surface a
    // spurious "couldn't save" error for a export that's actually fine.
    if (exporting) return;
    exporting = true;

    const data = JSON.stringify(state, null, 2);
    const filename = "verse-by-heart-" + todayKey() + ".json";

    try {
      // The published Artifact sandbox blocks `<a download>` (and blob:/data:
      // hrefs) outright, so on that host this button did nothing at all. Where
      // the capability is granted, hand the file to the viewer through it;
      // otherwise fall back to the anchor trick for the test harness and any
      // plain-browser (file://) use of this page.
      const downloads = window.claude && typeof window.claude.use === "function"
        ? await window.claude.use("downloads")
        : null;
      if (downloads) {
        try {
          await downloads.save({ filename, data });
        } catch (e) {
          if (e && e.code !== "declined") {
            alert("Couldn't save the export — " + (e && e.message ? e.message : "try again") + ".");
          }
        }
        return;
      }

      const blob = new Blob([data], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = el("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } finally {
      exporting = false;
    }
  }

  function importDeck(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (!parsed || !Array.isArray(parsed.verses)) throw new Error("shape");
        // An older export carries no schedule, so run it through the same
        // normalise-then-migrate path as anything loaded from storage.
        const incoming = migrate({
          schema: Number(parsed.schema) || 1,
          verses: parsed.verses.filter(v => v && v.ref && v.text).map(normalizeVerse)
        });
        const byRef = new Map(state.verses.map(v => [v.ref.toLowerCase(), v]));
        incoming.verses.forEach(raw => {
          const mine = byRef.get(raw.ref.toLowerCase());
          if (mine) {
            // Attempts and best are cumulative, so they take the higher of the two.
            mine.attempts = Math.max(mine.attempts, raw.attempts);
            mine.best = Math.max(mine.best, raw.best);
            // The rest is one practice record — the scores, the day they were set,
            // and the schedule they produced — so it moves as a unit, and the more
            // recent session wins. Splitting it would record a lapse from the other
            // device while keeping this one's comfortable month-long interval.
            if (raw.last && (!mine.last || raw.last >= mine.last)) {
              mine.recent = raw.recent;
              mine.last = raw.last;
              mine.ease = raw.ease;
              mine.reps = raw.reps;
              mine.interval = raw.interval;
              mine.due = raw.due;
            }
          } else {
            if (state.verses.some(v => v.id === raw.id)) raw.id = blankVerse("", "", "custom").id;
            state.verses.push(raw);
            byRef.set(raw.ref.toLowerCase(), raw);
          }
        });
        Object.entries(parsed.history || {}).forEach(([day, n]) => {
          state.history[day] = Math.max(state.history[day] || 0, Number(n) || 0);
        });
        save();
        renderAll();
      } catch (e) {
        alert("That file isn't a Verse by Heart export. Pick the JSON file you downloaded with Export.");
      }
    };
    reader.readAsText(file);
  }

  /* ------------------------------------------------------------------ *
   * Wiring
   * ------------------------------------------------------------------ */
  // Open on the queue rather than wherever you happened to stop. If the verse
  // you left open is itself due you stay on it, so a reload mid-drill doesn't
  // yank you somewhere else.
  {
    const due = dueVerses();
    if (!state.activeId || !state.verses.some(v => v.id === state.activeId)) {
      state.activeId = (due[0] || state.verses[0]).id;
    } else if (due.length && !isDue(active())) {
      state.activeId = due[0].id;
    }
  }

  $("queueGo").addEventListener("click", () => {
    const due = dueVerses();
    if (!due.length) return;
    selectVerse(due[0].id);
    setMode("recite");
  });

  let pendingShared = readSharedDeck();
  renderShareImport(pendingShared);

  $("shareImportAdd").addEventListener("click", () => {
    if (!pendingShared || !pendingShared.ok) return;
    addSharedDeck(pendingShared.verses);
    clearShareHash();
    pendingShared = null;
    $("shareImport").hidden = true;
    renderAll();
  });

  $("shareImportDismiss").addEventListener("click", () => {
    clearShareHash();
    pendingShared = null;
    $("shareImport").hidden = true;
  });

  $("shareBtn").addEventListener("click", () => {
    const panel = $("sharePanel");
    const opening = panel.hidden;
    panel.hidden = !opening;
    if (!opening) return;
    $("shareLink").value = shareBaseUrl() + SHARE_PREFIX + encodeShareDeck(state.verses);
    const overCount = state.verses.length > SHARE_MAX_VERSES;
    const overLength = state.verses.some(v => v.ref.length > SHARE_REF_MAX || v.text.length > SHARE_TEXT_MAX);
    $("shareCopyStatus").textContent = overCount
      ? "Only the first " + SHARE_MAX_VERSES + " verses fit in one link."
      : overLength
        ? "A verse was too long to share in full and was shortened."
        : "";
    $("shareLink").focus();
    $("shareLink").select();
  });

  $("shareCopy").addEventListener("click", async () => {
    const link = $("shareLink").value;
    try {
      if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error("no clipboard API");
      await navigator.clipboard.writeText(link);
      $("shareCopyStatus").textContent = "Copied.";
    } catch (e) {
      $("shareLink").focus();
      $("shareLink").select();
      $("shareCopyStatus").textContent = "Selected — press Ctrl/Cmd+C to copy.";
    }
  });

  document.querySelectorAll("#switch button").forEach(b => {
    b.addEventListener("click", () => setMode(b.dataset.mode));
  });

  $("reshuffle").addEventListener("click", () => {
    hideOrder = shuffleOrder(tokens(active().text).length);
    peeked = new Set();
    renderStage();
  });

  // window.print() is a no-op, not an error, in a sandboxed iframe without
  // allow-modals — nothing to catch. The hint text next to the button names
  // the keyboard fallback so a silent no-op still leaves a way to print.
  $("printBtn").addEventListener("click", () => window.print());

  $("check").addEventListener("click", runCheck);
  $("peekBtn").addEventListener("click", () => setMode("read"));
  $("nextDueBtn").addEventListener("click", () => {
    if (!nextDueId) return;
    selectVerse(nextDueId);
    setMode("recite");
  });

  $("speakBtn").hidden = !SpeechRecognition;
  $("speakBtn").addEventListener("click", () => {
    if (listener) endListening(true); else startListening();
  });

  $("attempt").addEventListener("keydown", e => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); runCheck(); }
  });

  $("deckSearch").addEventListener("input", () => {
    deckQuery = $("deckSearch").value;
    renderDeck();
  });

  $("deckFilter").addEventListener("change", () => {
    deckFilter = $("deckFilter").value;
    renderDeck();
  });

  $("deckSort").addEventListener("change", () => {
    deckSort = $("deckSort").value;
    renderDeck();
  });

  $("exportBtn").addEventListener("click", exportDeck);
  $("importBtn").addEventListener("click", () => $("importFile").click());
  $("importFile").addEventListener("change", e => {
    const f = e.target.files && e.target.files[0];
    if (f) importDeck(f);
    e.target.value = "";
  });

  $("lookupBtn").hidden = !KJV_LOOKUP_SUPPORTED;
  async function doLookup() {
    const raw = $("newRef").value.trim();
    const err = $("addErr");
    if (!raw) { err.textContent = "Give it a reference to look up."; $("newRef").focus(); return; }
    const btn = $("lookupBtn");
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = "Looking up…";
    err.textContent = "";
    try {
      const result = await lookupReference(raw);
      if (result.error) { err.textContent = result.error; return; }
      $("newRef").value = result.ref;
      $("newText").value = result.text;
      $("newText").focus();
    } catch (e) {
      err.textContent = "Couldn't look that up just now — try again.";
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  }
  $("lookupBtn").addEventListener("click", doLookup);
  $("newRef").addEventListener("keydown", e => {
    if (e.key === "Enter" && KJV_LOOKUP_SUPPORTED) { e.preventDefault(); doLookup(); }
  });

  $("addForm").addEventListener("submit", e => {
    e.preventDefault();
    const ref = $("newRef").value.trim();
    const text = $("newText").value.trim();
    const err = $("addErr");
    if (!ref) { err.textContent = "Give it a reference so you can find it again."; $("newRef").focus(); return; }
    if (tokens(text).length < 2) { err.textContent = "Paste the verse text — at least a couple of words, or look it up."; $("newText").focus(); return; }
    err.textContent = "";
    const v = blankVerse(ref, text, "custom");
    state.verses.push(v);
    $("newRef").value = "";
    $("newText").value = "";
    save();
    selectVerse(v.id);
  });

  $("clearAdd").addEventListener("click", () => {
    $("newRef").value = "";
    $("newText").value = "";
    $("addErr").textContent = "";
  });

  $("addMany").hidden = !KJV_LOOKUP_SUPPORTED;

  function parseManyRefs(raw) {
    return raw.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
  }

  $("addManyForm").addEventListener("submit", async e => {
    e.preventDefault();
    const err = $("addManyErr");
    const status = $("addManyStatus");
    err.textContent = "";
    status.textContent = "";
    const lines = parseManyRefs($("manyRefs").value);
    if (!lines.length) { err.textContent = "Paste one or more references, one per line or comma-separated."; $("manyRefs").focus(); return; }
    if (lines.length > ADD_MANY_MAX) {
      err.textContent = "Up to " + ADD_MANY_MAX + " references at a time — split into batches.";
      return;
    }
    const btn = $("addManyBtn");
    const textarea = $("manyRefs");
    const clearBtn = $("clearAddMany");
    btn.disabled = true;
    textarea.disabled = true;
    clearBtn.disabled = true;
    const original = btn.textContent;
    btn.textContent = "Looking up…";
    let added = 0, skipped = 0;
    const failed = []; // { line, error }
    for (const line of lines) {
      let result;
      try { result = await lookupReference(line); }
      catch (e2) { result = { error: "Couldn't look that up just now." }; }
      if (result.error) { failed.push({ line, error: result.error }); continue; }
      // Read fresh right before every insert, not captured once before the
      // loop — each await above gives the rest of the page a turn, so a
      // verse can be added, removed, or edited elsewhere in the deck (or
      // by an earlier line in this same batch) while a later line is still
      // being looked up. Re-reading state.verses here catches both: a
      // reference repeated within the pasted batch shows up because the
      // previous line's own push already landed in state.verses.
      if (existingRefSet().has(result.ref.toLowerCase())) { skipped++; continue; }
      state.verses.push(blankVerse(result.ref, result.text, "custom"));
      added++;
    }
    btn.disabled = false;
    textarea.disabled = false;
    clearBtn.disabled = false;
    btn.textContent = original;
    if (added) { save(); renderAll(); }
    const parts = [];
    if (added) parts.push(added + (added === 1 ? " verse added" : " verses added"));
    if (skipped) parts.push(skipped + " already in your deck");
    if (failed.length) parts.push(failed.length + (failed.length === 1 ? " reference not found" : " references not found"));
    status.textContent = parts.length ? parts.join(", ") + "." : "";
    if (failed.length) {
      // Leave only the unresolved lines behind so a typo can be fixed and
      // resubmitted without retyping everything that already went through.
      err.textContent = failed.map(f => f.line + " — " + f.error).join("; ");
      $("manyRefs").value = failed.map(f => f.line).join("\n");
    } else {
      $("manyRefs").value = "";
    }
  });

  $("clearAddMany").addEventListener("click", () => {
    $("manyRefs").value = "";
    $("addManyErr").textContent = "";
    $("addManyStatus").textContent = "";
  });

  document.addEventListener("keydown", e => {
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const modes = { "1": "read", "2": "veil", "3": "initials", "4": "recite" };
    if (modes[e.key]) { e.preventDefault(); setMode(modes[e.key]); return; }
    if (e.key === "ArrowRight") { e.preventDefault(); stepVerse(1); }
    if (e.key === "ArrowLeft") { e.preventDefault(); stepVerse(-1); }
    if (mode === "veil" && (e.key === "[" || e.key === "]")) {
      e.preventDefault();
      const i = VEIL_STEPS.indexOf(veil);
      veil = VEIL_STEPS[Math.min(VEIL_STEPS.length - 1, Math.max(0, i + (e.key === "]" ? 1 : -1)))];
      renderStage();
    }
    if (e.key === "?") {
      e.preventDefault();
      const panel = $("shortcuts");
      panel.open = !panel.open;
      if (panel.open) panel.querySelector("summary").focus();
    }
  });

  renderVeilSeg();
  renderAll();
})();
