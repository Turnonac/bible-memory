// Checks every starter passage in index.html against the canonical 1769 KJV.
//
// The app grades the user against this text, so a transcription slip would mark
// correct recall as wrong. This is the one test that must never be waived.
//
// Source: the `kjv` npm package (public domain). Its text carries two editorial
// conventions the app deliberately drops:
//   [word]  translator-supplied words, italicised in print
//   #       start of a printed paragraph (the pilcrow)
// Those are markup, not wording, so they are stripped before comparing. Case and
// punctuation are NOT stripped — they are part of the text you memorise.
import { createRequire } from "node:module";
import { readStarter, check, eq, report } from "./harness.mjs";

const require = createRequire(import.meta.url);
const CANON = require("kjv/json/verses-1769.json");

// The package files Psalms under its plural name; the app displays the singular,
// which is how the reference is normally written and spoken.
const BOOK_ALIAS = { Psalm: "Psalms" };

function expandRef(ref) {
  const m = ref.match(/^(.+?) (\d+):(\d+)(?:-(\d+))?$/);
  if (!m) return null;
  const [, rawBook, chapter, from, to] = m;
  const book = BOOK_ALIAS[rawBook] || rawBook;
  const keys = [];
  for (let v = Number(from); v <= Number(to || from); v++) keys.push(`${book} ${chapter}:${v}`);
  return keys;
}

const stripMarkup = s => s.replace(/^#\s*/, "").replace(/[[\]]/g, "").replace(/\s+/g, " ").trim();

const starter = readStarter();
console.log(`Verifying ${starter.length} starter passages against the 1769 KJV\n`);

check("deck is non-empty", starter.length > 0);

const seen = new Set();
for (const entry of starter) {
  const [ref, text] = entry;

  check(`${ref}: reference parses`, !!expandRef(ref));
  const keys = expandRef(ref);
  if (!keys) continue;

  check(`${ref}: appears once in the deck`, !seen.has(ref));
  seen.add(ref);

  const unknown = keys.filter(k => !CANON[k]);
  check(`${ref}: every verse exists in the KJV`, unknown.length === 0, unknown.join(", "));
  if (unknown.length) continue;

  const canonical = stripMarkup(keys.map(k => stripMarkup(CANON[k])).join(" "));
  const mine = stripMarkup(text);

  if (mine !== canonical) {
    const a = mine.split(" ");
    const b = canonical.split(" ");
    const i = Math.max(0, a.findIndex((w, j) => w !== b[j]));
    eq(`${ref}: text matches the KJV`,
      "…" + a.slice(Math.max(0, i - 4), i + 6).join(" "),
      "…" + b.slice(Math.max(0, i - 4), i + 6).join(" "));
  } else {
    check(`${ref}: text matches the KJV`, true);
  }
}

report("KJV fidelity");
