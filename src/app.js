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

  /* ------------------------------------------------------------------ *
   * State
   * ------------------------------------------------------------------ */
  let state = load();
  let mode = "read";
  let veil = 50;
  let hideOrder = [];          // shuffled word indices, nested across veil levels
  let peeked = new Set();      // words revealed by clicking, this sitting

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
    const refRaw = tokens(refText);
    const saidRaw = tokens(saidText);
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
    if (mode !== "recite") { $("result").hidden = true; }

    renderVerse();

    const peeks = peeked.size;
    const notes = {
      read: "Read it through two or three times before you veil it.",
      veil: peeks ? peeks + (peeks === 1 ? " word restored" : " words restored") + " — those are the ones to work on." : "Click any blank to bring the word back in red.",
      initials: peeks ? peeks + (peeks === 1 ? " word restored." : " words restored.") : "Only the first letter stays. Click a word to see the rest.",
      recite: ""
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

  function renderDeck() {
    const cards = $("cards");
    cards.textContent = "";
    state.verses.forEach(v => {
      const card = el("div", "card" + (v.id === active().id ? " active" : ""));

      const ref = el("div", "ref");
      const open = el("button", "open");
      open.type = "button";
      open.textContent = v.ref;
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
      snip.textContent = v.text;

      const meter = el("div", "meter");
      const fill = el("i");
      fill.style.width = v.best + "%";
      meter.appendChild(fill);

      const stat = el("div", "stat");
      const left = el("span");
      left.textContent = v.attempts ? "best " + v.best + "% · " + v.attempts + "×" : "not yet recited";
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
      stat.appendChild(left);
      stat.appendChild(drop);

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
    state.verses = state.verses.filter(v => v.id !== id);
    if (wasActive) { state.activeId = state.verses[0].id; peeked = new Set(); hideOrder = []; }
    save();
    renderAll();
  }

  function stepVerse(dir) {
    const i = state.verses.findIndex(v => v.id === active().id);
    const next = state.verses[(i + dir + state.verses.length) % state.verses.length];
    selectVerse(next.id);
  }

  function setMode(next) {
    mode = next;
    if (next === "recite") { $("result").hidden = true; }
    renderStage();
    if (next === "recite") $("attempt").focus();
  }

  function runCheck() {
    const v = active();
    const typed = $("attempt").value.trim();
    if (!typed) { $("attempt").focus(); return; }

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
    } else {
      $("nextUp").textContent = "Extra practice — " + v.ref + " stays filed for " +
        inDays(daysUntil(v.due)) + ", on " + v.due + ".";
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

  function exportDeck() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = el("a");
    a.href = url;
    a.download = "verse-by-heart-" + todayKey() + ".json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
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

  document.querySelectorAll("#switch button").forEach(b => {
    b.addEventListener("click", () => setMode(b.dataset.mode));
  });

  $("reshuffle").addEventListener("click", () => {
    hideOrder = shuffleOrder(tokens(active().text).length);
    peeked = new Set();
    renderStage();
  });

  $("check").addEventListener("click", runCheck);
  $("peekBtn").addEventListener("click", () => setMode("read"));

  $("attempt").addEventListener("keydown", e => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); runCheck(); }
  });

  $("exportBtn").addEventListener("click", exportDeck);
  $("importBtn").addEventListener("click", () => $("importFile").click());
  $("importFile").addEventListener("change", e => {
    const f = e.target.files && e.target.files[0];
    if (f) importDeck(f);
    e.target.value = "";
  });

  $("addForm").addEventListener("submit", e => {
    e.preventDefault();
    const ref = $("newRef").value.trim();
    const text = $("newText").value.trim();
    const err = $("addErr");
    if (!ref) { err.textContent = "Give it a reference so you can find it again."; $("newRef").focus(); return; }
    if (tokens(text).length < 2) { err.textContent = "Paste the verse text — at least a couple of words."; $("newText").focus(); return; }
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
  });

  renderVeilSeg();
  renderAll();
})();
