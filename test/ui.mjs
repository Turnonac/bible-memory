// Behavioural tests for the page, driven through a real browser.
//
// Several checks here guard bugs that have already bitten once. Read the
// comments before deleting one.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { buildPreview, launch, check, eq, report, PAGE } from "./harness.mjs";

const url = buildPreview();
const browser = await launch();

/* ============================ static source checks ======================= */
{
  const src = fs.readFileSync(PAGE, "utf8");

  // The Artifact host supplies the document skeleton; shipping our own would nest documents.
  check("no <html>/<body>/<!doctype> wrapper in the source",
    !/<!doctype|<html[\s>]|<body[\s>]/i.test(src));

  // A strict CSP blocks every external host, so a remote font or script fails silently.
  const remote = src.match(/(?:src|href)\s*=\s*["']https?:\/\/[^"']+/gi) || [];
  check("no external resource references", remote.length === 0, remote.join(", "));

  // Colours defined only inside a media or [data-theme] block never apply in the
  // default "system" state, which renders one theme's text on the other's ground.
  const themedBlocks = src.match(/@media \(prefers-color-scheme: dark\)[\s\S]*?\n {2}\}|:root\[data-theme="dark"\][\s\S]*?\n {2}\}/g) || [];
  const rootBlock = src.match(/:root \{[\s\S]*?\n {2}\}/);
  check("a bare :root block defines the light palette", !!rootBlock);
  const baseTokens = new Set([...(rootBlock?.[0].matchAll(/(--[\w-]+):/g) || [])].map(m => m[1]));
  const themedTokens = new Set(themedBlocks.flatMap(b => [...b.matchAll(/(--[\w-]+):/g)].map(m => m[1])));
  const orphans = [...themedTokens].filter(t => !baseTokens.has(t));
  check("every dark-theme token has a light-theme definition", orphans.length === 0, orphans.join(", "));

  check("body paints an explicit background token",
    /body\s*\{[^}]*background:\s*var\(--/.test(src));
}

/* ============================ per-theme rendering ======================== */
for (const scheme of ["light", "dark"]) {
  const ctx = await browser.newContext({ colorScheme: scheme, viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(url);

  check(`[${scheme}] no console or page errors on load`, errors.length === 0, errors.join(" | "));

  // [hidden] loses to any component rule that sets display, which once left the
  // "Mastered" seal showing on untouched verses.
  check(`[${scheme}] mastery seal hidden on an unpractised verse`, !(await page.isVisible("#seal")));
  check(`[${scheme}] veil controls hidden outside veil mode`, !(await page.isVisible("#veilControls")));

  const contrast = await page.evaluate(() => {
    const lum = c => {
      const [r, g, b] = c.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map(v => {
        v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const body = getComputedStyle(document.body);
    const verse = getComputedStyle(document.querySelector(".verse"));
    const L1 = lum(verse.color), L2 = lum(body.backgroundColor);
    return Math.round(((Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)) * 100) / 100;
  });
  check(`[${scheme}] scripture/background contrast ≥ 7:1 (got ${contrast})`, contrast >= 7);

  await ctx.close();
}

/* ============================ drill mechanics =========================== */
{
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  await page.goto(url);

  await page.click('.card .open:has-text("Philippians 4:6-7")');
  await page.click('button[data-mode="veil"]');

  // Chromium blockifies <button> to inline-block, which stretched each blank
  // over the full line box and made the page look redacted. Tokens must be
  // inline so a blank covers only its own text.
  const geom = await page.evaluate(() => {
    const blank = document.querySelector(".tok.blank");
    const word = [...document.querySelectorAll("span.tok")].find(s => s.textContent.trim());
    const lh = parseFloat(getComputedStyle(document.querySelector(".verse")).lineHeight);
    return { blankH: blank.getBoundingClientRect().height, wordH: word.getBoundingClientRect().height, lh };
  });
  check(`blanks are inline, not line-height tall (${geom.blankH}px vs ${geom.lh}px line)`,
    Math.abs(geom.blankH - geom.wordH) < 2 && geom.blankH < geom.lh - 4);

  // Veil levels must nest: raising the veil keeps what was already hidden, so
  // the drill gets strictly harder rather than reshuffling under you.
  const hiddenAt = async pct => {
    await page.click(`#veilSeg button:has-text("${pct}%")`);
    return page.evaluate(() => [...document.querySelectorAll(".verse > *")]
      .map((n, i) => n.classList?.contains("blank") ? i : -1).filter(i => i >= 0));
  };
  const at25 = await hiddenAt(25);
  const at50 = await hiddenAt(50);
  const at75 = await hiddenAt(75);
  check("veil 25% hides fewer words than 50%", at25.length < at50.length);
  check("veil levels nest (25 ⊂ 50 ⊂ 75)",
    at25.every(i => at50.includes(i)) && at50.every(i => at75.includes(i)));

  // The whole design rests on the verse holding its layout as words drain away.
  await page.click('button[data-mode="read"]');
  const readBox = await page.evaluate(() => {
    const r = document.querySelector(".verse").getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height) };
  });
  for (const mode of ["veil", "initials"]) {
    await page.click(`button[data-mode="${mode}"]`);
    const box = await page.evaluate(() => {
      const r = document.querySelector(".verse").getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    });
    check(`${mode} mode preserves the verse's block height`, Math.abs(box.h - readBox.h) <= 1,
      `read ${readBox.h}px vs ${mode} ${box.h}px`);
  }

  // Revealing a word marks it, so the finished page shows where help was needed.
  await page.click('button[data-mode="veil"]');
  await page.click(".tok.blank");
  check("a revealed word is marked as peeked", (await page.$$(".tok.peeked")).length === 1);

  check("drill mechanics raised no page errors", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

/* ============================ recall scoring ============================ */
{
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(url);
  await page.click('.card .open:has-text("Philippians 4:13")');
  await page.click('button[data-mode="recite"]');

  const score = async attempt => {
    await page.fill("#attempt", attempt);
    await page.click("#check");
    return page.textContent("#pct");
  };
  const VERSE = "I can do all things through Christ which strengtheneth me.";

  eq("exact recall scores 100%", await score(VERSE), "100%");
  eq("case and punctuation are not graded", await score(VERSE.toLowerCase().replace(/[.;,]/g, "")), "100%");

  // Padding a recitation with words that aren't in the verse must not score 100%,
  // or a vague answer could reach mastery.
  const padded = await score("I can truly do all of the things through Christ which strengtheneth me.");
  check(`padded recall is penalised (got ${padded})`, parseInt(padded, 10) < 100);

  // A single-letter slip is a typo, not a forgotten word.
  await score("I can do all things through Christ which strengthenth me");
  check("a near miss is reported as near, not missed",
    (await page.textContent("#breakdown")).includes("1 near"));

  const empty = await page.evaluate(() => { document.querySelector("#attempt").value = ""; return true; });
  check("empty attempt is accepted without throwing", empty);

  // Three clean runs earn mastery.
  for (let i = 0; i < 3; i++) await score(VERSE);
  check("three runs at 95%+ marks the verse mastered", await page.isVisible("#seal"));
  await ctx.close();
}

/* ============================ deck and storage ========================== */
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vbh-dl-"));
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  await page.goto(url);
  const cards = () => page.$$eval(".card", n => n.length);

  const start = await cards();
  await page.click("details.add > summary");
  await page.fill("#newRef", "Psalm 27:1");
  await page.fill("#newText", "The LORD is my light and my salvation; whom shall I fear?");
  await page.click("#addForm button[type=submit]");
  eq("adding a verse grows the deck", await cards(), start + 1);

  await page.fill("#newRef", "");
  await page.fill("#newText", "x");
  await page.click("#addForm button[type=submit]");
  check("a missing reference is refused with a readable message",
    (await page.textContent("#addErr")).length > 10 && (await cards()) === start + 1);

  const [download] = await Promise.all([page.waitForEvent("download"), page.click("#exportBtn")]);
  const file = path.join(dir, "deck.json");
  await download.saveAs(file);
  const exported = JSON.parse(fs.readFileSync(file, "utf8"));
  check("export contains the whole deck", exported.verses.length === start + 1);

  await page.reload();
  eq("the deck survives a reload", await cards(), start + 1);

  const drop = page.locator(".card").filter({ hasText: "Psalm 27:1" }).locator(".drop");
  await drop.click();
  check("removing a verse asks for confirmation first", (await cards()) === start + 1);
  await drop.click();
  eq("a confirmed removal drops the verse", await cards(), start);

  await page.setInputFiles("#importFile", file);
  await page.waitForTimeout(300);
  eq("import restores the removed verse", await cards(), start + 1);

  const junk = path.join(dir, "junk.json");
  fs.writeFileSync(junk, '{"not":"a deck"}');
  page.once("dialog", d => d.dismiss());
  await page.setInputFiles("#importFile", junk);
  await page.waitForTimeout(300);
  check("a malformed import leaves the deck intact", (await cards()) === start + 1);
  await ctx.close();
}

/* ============================ export capability ========================== */
{
  // The published Artifact sandbox blocks `<a download>` entirely, so a real
  // download event proves nothing about whether the page works there — see
  // CLAUDE.md. Mock `window.claude.downloads` before the page loads and assert
  // exportDeck() calls it instead of falling back to the anchor trick; that's
  // the mechanism the harness *can* check.
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    window.__saved = null;
    // A real "download" browser event is an async signal that could arrive
    // after we've already checked for it; count anchor clicks synchronously
    // instead so the assertion below can't race the fallback path.
    window.__anchorDownloadClicks = 0;
    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.hasAttribute("download")) window.__anchorDownloadClicks++;
      return origClick.call(this);
    };
    window.claude = {
      use: async name => name === "downloads" ? {
        save: async req => { window.__saved = req; return { status: "saved" }; }
      } : null
    };
  });
  await page.goto(url);

  await page.click("#exportBtn");
  await page.waitForFunction(() => window.__saved !== null);

  const saved = await page.evaluate(() => window.__saved);
  check("export hands the file to the downloads capability when it's granted",
    typeof saved.filename === "string" && /^verse-by-heart-.*\.json$/.test(saved.filename));
  const parsed = JSON.parse(saved.data);
  check("the capability payload is the whole deck", Array.isArray(parsed.verses) && parsed.verses.length > 0);
  eq("the anchor-download fallback is skipped once the capability exists",
    await page.evaluate(() => window.__anchorDownloadClicks), 0);
  await ctx.close();
}

/* ============================ export re-entrancy ========================= */
{
  // The viewer allows only one undecided save prompt at a time, so clicking
  // Export again while the first prompt is still pending must not fire a
  // second save() call — that would surface a spurious error for an export
  // that's actually fine.
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  const dialogs = [];
  page.on("dialog", async d => { dialogs.push(d.message()); await d.dismiss(); });
  await page.addInitScript(() => {
    window.__saveCalls = 0;
    window.claude = {
      use: async name => name === "downloads" ? {
        save: async () => {
          window.__saveCalls++;
          await new Promise(r => setTimeout(r, 200));
          return { status: "saved" };
        }
      } : null
    };
  });
  await page.goto(url);

  await page.click("#exportBtn");
  await page.click("#exportBtn");
  await page.waitForTimeout(400);

  eq("a second click while a save is pending doesn't start a second save", await page.evaluate(() => window.__saveCalls), 1);
  check("the pending-save guard raises no error dialog", dialogs.length === 0, dialogs.join(" | "));
  await ctx.close();
}

/* ============================ export error handling ====================== */
{
  // A declined save is the user's own "no" and must stay silent. Triggering a
  // second export afterwards is also the proof the pending-save guard released
  // — if it hadn't, this second click would be a no-op and __saveCalls would
  // never reach 2.
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  const dialogs = [];
  page.on("dialog", async d => { dialogs.push(d.message()); await d.dismiss(); });
  await page.addInitScript(() => {
    window.__saveCalls = 0;
    window.claude = {
      use: async name => name === "downloads" ? {
        save: async () => {
          window.__saveCalls++;
          const e = new Error("declined");
          e.code = "declined";
          throw e;
        }
      } : null
    };
  });
  await page.goto(url);

  await page.click("#exportBtn");
  await page.waitForFunction(() => window.__saveCalls === 1);
  await page.click("#exportBtn");
  await page.waitForFunction(() => window.__saveCalls === 2);
  check("a declined save raises no dialog", dialogs.length === 0, dialogs.join(" | "));
  await ctx.close();
}

{
  // Any other save failure surfaces one readable alert with the capability's
  // own message, and still releases the guard for the next attempt.
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  const dialogs = [];
  const firstDialog = new Promise(resolve => {
    page.once("dialog", async d => { dialogs.push(d.message()); await d.dismiss(); resolve(); });
  });
  await page.addInitScript(() => {
    window.__saveCalls = 0;
    window.claude = {
      use: async name => name === "downloads" ? {
        save: async () => {
          window.__saveCalls++;
          const e = new Error("File too large");
          e.code = "too_large";
          throw e;
        }
      } : null
    };
  });
  await page.goto(url);

  await page.click("#exportBtn");
  // Wait for the dialog to actually be delivered and dismissed — the alert()
  // call blocks the page's JS until then, so clicking again too early would
  // race the export guard's release in the `finally` block.
  await firstDialog;
  check("a real save error shows exactly one alert with its message",
    dialogs.length === 1 && dialogs[0].includes("File too large"), dialogs.join(" | "));

  await page.click("#exportBtn");
  await page.waitForFunction(() => window.__saveCalls === 2);
  eq("the export guard releases after an error, so a later export can run",
    await page.evaluate(() => window.__saveCalls), 2);
  await ctx.close();
}

/* ============================ recite aloud ================================ */
{
  // This harness's Chromium happens to expose the constructor (even in a
  // sandbox with no working mic or speech service behind it), so the button
  // should appear here — the "no API" case right after checks it stays
  // hidden where the constructor is genuinely absent, e.g. Firefox.
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(url);
  await page.click('button[data-mode="recite"]');
  check("Speak it is offered where the Web Speech API exists", await page.isVisible("#speakBtn"));
  await ctx.close();
}

{
  // Browsers without the API (Firefox, most mobile) must not show a button
  // that does nothing when pressed.
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    window.SpeechRecognition = undefined;
    window.webkitSpeechRecognition = undefined;
  });
  await page.goto(url);
  await page.click('button[data-mode="recite"]');
  check("Speak it stays hidden without the Web Speech API", !(await page.isVisible("#speakBtn")));
  await ctx.close();
}

// A fake SpeechRecognition standing in for the browser's — real speech
// capture needs a microphone and a speech service this sandbox has neither
// of, so these assert the mechanism: that a transcript reaches the same
// runCheck()/compare() a typed attempt runs through, per the CLAUDE.md note
// that a harness pass proves nothing about a capability it can't exercise.
const installFakeRecognizer = () => {
  window.__recStartCount = 0;
  window.__emitFinal = text => {
    window.__rec.onresult({
      resultIndex: 0,
      results: [Object.assign([{ transcript: text }], { isFinal: true })]
    });
  };
  class FakeRecognition {
    constructor() {
      this.onresult = null; this.onerror = null; this.onend = null;
      window.__rec = this;
      window.__recStartCount++;
    }
    start() {}
    stop() { setTimeout(() => this.onend && this.onend(), 0); }
  }
  window.SpeechRecognition = FakeRecognition;
};

{
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  await page.addInitScript(installFakeRecognizer);
  await page.goto(url);
  await page.click('.card .open:has-text("Psalm 46:1")');
  await page.click('button[data-mode="recite"]');
  await page.click("#speakBtn");

  eq("Speak it starts the recognizer", await page.evaluate(() => window.__recStartCount), 1);
  eq("the control flips to a stop affordance while listening",
    await page.textContent("#speakBtn"), "Stop listening");

  await page.evaluate(t => window.__emitFinal(t), "God is our refuge and strength a very present help in trouble");
  await page.click("#speakBtn"); // the user's "I'm done" — the same button now stops and submits

  await page.waitForFunction(() => !document.getElementById("result").hidden);
  check("stopping a spoken attempt grades it, showing a percentage",
    /%$/.test(await page.textContent("#pct")));
  eq("the control reverts once grading has run", await page.textContent("#speakBtn"), "Speak it");
  await ctx.close();
}

{
  // Nothing heard: don't grade a blank, and say why instead of going quiet.
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  await page.addInitScript(installFakeRecognizer);
  await page.goto(url);
  await page.click('button[data-mode="recite"]');
  await page.click("#speakBtn");
  await page.click("#speakBtn"); // stop without ever emitting a result

  await page.waitForFunction(() => document.getElementById("speakStatus").textContent.length > 0);
  check("an empty listen doesn't grade the verse", await page.isHidden("#result"));
  check("an empty listen explains what happened",
    (await page.textContent("#speakStatus")).toLowerCase().includes("catch"));
  await ctx.close();
}

{
  // A denied microphone is a real, expected outcome, not a crash.
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  await page.addInitScript(() => {
    class FakeRecognition {
      constructor() { this.onresult = null; this.onerror = null; this.onend = null; window.__rec = this; }
      start() {
        setTimeout(() => {
          this.onerror && this.onerror({ error: "not-allowed" });
          this.onend && this.onend();
        }, 0);
      }
      stop() {}
    }
    window.SpeechRecognition = FakeRecognition;
  });
  await page.goto(url);
  await page.click('button[data-mode="recite"]');
  await page.click("#speakBtn");

  await page.waitForFunction(() => document.getElementById("speakStatus").textContent.length > 0);
  check("a denied microphone names the problem",
    (await page.textContent("#speakStatus")).toLowerCase().includes("microphone"));
  eq("the control resets after an error", await page.textContent("#speakBtn"), "Speak it");
  check("a denied microphone raises no page error", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

{
  // Leaving mid-listen (switching verses) must discard the transcript rather
  // than grade it once the recognizer's async onend eventually fires — the
  // same "only a deliberate stop grades" rule the queue relies on for typing.
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  await page.addInitScript(installFakeRecognizer);
  await page.goto(url);
  await page.click('.card .open:has-text("Psalm 46:1")');
  await page.click('button[data-mode="recite"]');
  await page.click("#speakBtn");
  await page.evaluate(t => window.__emitFinal(t), "some words");

  await page.click('.card .open:has-text("John 3:16")');
  // The session has genuinely ended once the control reverts to its idle
  // label — a fixed sleep would race the recognizer's async onend instead.
  await page.waitForFunction(() => document.getElementById("speakBtn").textContent === "Speak it");

  check("switching verses mid-listen discards the transcript instead of grading it",
    await page.isHidden("#result"));
  eq("the recall box is cleared for the newly selected verse", await page.inputValue("#attempt"), "");
  eq("the control reverts to idle once the old session ends", await page.textContent("#speakBtn"), "Speak it");
  await ctx.close();
}

{
  // Pressing "Check my recall" mid-listen grades immediately; the recognizer's
  // own async onend must not grade the same attempt a second time once it
  // eventually fires — the same double-submit risk export's re-entrancy guard
  // protects against, here on the state that drives the schedule. Without the
  // guard, clicking Check mid-listen leaves the old recognizer running with
  // its transcript still held; the very next tap of the (still-labelled
  // "Stop listening") button would then stop that stale session and its
  // onend would grade the same transcript a second time.
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  await page.addInitScript(installFakeRecognizer);
  await page.goto(url);
  await page.click('.card .open:has-text("Psalm 46:1")');
  await page.click('button[data-mode="recite"]');
  await page.click("#speakBtn");
  await page.evaluate(t => window.__emitFinal(t), "God is our refuge and strength a very present help in trouble");
  await page.click("#check"); // grade mid-listen, before the recognizer has ended on its own
  await page.waitForFunction(() => !document.getElementById("result").hidden);

  const attemptsOf = async () => page.evaluate(() =>
    JSON.parse(localStorage.getItem("verse-by-heart:v1")).verses.find(v => v.ref === "Psalm 46:1").attempts);
  eq("a manual Check mid-listen grades once", await attemptsOf(), 1);

  // Tap it again — the fixed guard already stopped and cleared the old
  // session, so this starts a fresh one rather than re-grading the old
  // transcript. Confirming the fresh session actually starts (rather than
  // the stale one silently finishing instead) is itself deterministic; the
  // extra beat afterwards is a bounded margin for the *absence* of a delayed
  // async re-grade, which has no positive UI state to poll for.
  await page.click("#speakBtn");
  await page.waitForFunction(() => document.getElementById("speakBtn").textContent === "Stop listening");
  await page.waitForTimeout(150);
  eq("a follow-up tap doesn't re-grade the transcript the manual Check already used",
    await attemptsOf(), 1);
  await ctx.close();
}

{
  // Removing the verse being recited must stop the listener the same way
  // switching verses does — otherwise a transcript spoken for the removed
  // verse lands on whichever verse becomes active next, corrupting its SM-2
  // record for a recitation the user never made against it.
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  await page.addInitScript(installFakeRecognizer);
  await page.goto(url);
  await page.click('.card .open:has-text("Genesis 1:1")');
  await page.click('button[data-mode="recite"]');
  await page.click("#speakBtn");
  await page.evaluate(t => window.__emitFinal(t), "some words spoken for the verse being removed");

  const drop = page.locator(".card").filter({ hasText: "Genesis 1:1" }).locator(".drop");
  await drop.click();
  await drop.click(); // confirm
  // The session has genuinely ended once the control reverts to its idle
  // label — a fixed sleep would race the recognizer's async onend instead.
  await page.waitForFunction(() => document.getElementById("speakBtn").textContent === "Speak it");

  const attemptsOf = ref => page.evaluate(r =>
    JSON.parse(localStorage.getItem("verse-by-heart:v1")).verses.find(v => v.ref === r)?.attempts, ref);
  eq("removing the recited verse mid-listen leaves the next active verse ungraded",
    await attemptsOf("Joshua 1:9"), 0);
  eq("the control reverts once the removed verse's session ends", await page.textContent("#speakBtn"), "Speak it");
  await ctx.close();
}

{
  // Every recognition event overwrites the recall box with the transcript so
  // far; read-only while listening stops that from silently discarding a
  // manual edit typed into the same field mid-session.
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  await page.addInitScript(installFakeRecognizer);
  await page.goto(url);
  await page.click('button[data-mode="recite"]');
  check("the recall box accepts typing before listening starts", !(await page.getAttribute("#attempt", "readonly")));
  await page.click("#speakBtn");
  check("the recall box is read-only while a listening session is live",
    (await page.getAttribute("#attempt", "readonly")) !== null);
  await page.click("#speakBtn");
  await page.waitForFunction(() => document.getElementById("attempt").readOnly === false);
  await ctx.close();
}

{
  // Removing the active verse must clear its result the same way selectVerse()
  // does — otherwise the old percentage and marked words stay on screen for
  // whatever verse becomes active next, looking like a grade it never earned.
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(url);
  await page.click('.card .open:has-text("Genesis 1:1")');
  await page.click('button[data-mode="recite"]');
  await page.fill("#attempt", "In the beginning God created the heaven and the earth.");
  await page.click("#check");
  await page.waitForFunction(() => !document.getElementById("result").hidden);

  const drop = page.locator(".card").filter({ hasText: "Genesis 1:1" }).locator(".drop");
  await drop.click();
  await drop.click(); // confirm
  check("removing the graded verse clears its result instead of leaving it on screen",
    await page.isHidden("#result"));
  await ctx.close();
}

{
  // A cancelled session (switching verses, here) must not have its cleared
  // status text repopulated by an error the recognizer fires afterwards —
  // real browsers can report "aborted" for a stop() they treat like an abort.
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    class FakeRecognition {
      constructor() { this.onresult = null; this.onerror = null; this.onend = null; window.__rec = this; }
      start() {}
      stop() {
        setTimeout(() => {
          this.onerror && this.onerror({ error: "aborted" });
          this.onend && this.onend();
        }, 0);
      }
    }
    window.SpeechRecognition = FakeRecognition;
  });
  await page.goto(url);
  await page.click('.card .open:has-text("Psalm 46:1")');
  await page.click('button[data-mode="recite"]');
  await page.click("#speakBtn");
  await page.click('.card .open:has-text("John 3:16")'); // cancels the session
  await page.waitForFunction(() => document.getElementById("speakBtn").textContent === "Speak it");
  eq("cancelling a listening session leaves no stray error message behind",
    await page.textContent("#speakStatus"), "");
  await ctx.close();
}

{
  // A stop() call that fails synchronously (real recognizers can throw
  // InvalidStateError) must still reset the control instead of sticking on
  // "Stop listening" forever with no way to end the session.
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    class FakeRecognition {
      constructor() { this.onresult = null; this.onerror = null; this.onend = null; window.__rec = this; }
      start() {}
      stop() { throw new Error("InvalidStateError"); }
    }
    window.SpeechRecognition = FakeRecognition;
  });
  await page.goto(url);
  await page.click('button[data-mode="recite"]');
  await page.click("#speakBtn");
  eq("a listening session started", await page.textContent("#speakBtn"), "Stop listening");
  await page.click("#speakBtn"); // stop() throws synchronously here
  eq("a synchronous stop() failure still resets the control instead of sticking",
    await page.textContent("#speakBtn"), "Speak it");
  await ctx.close();
}

/* ============================ scheduling ================================ */
{
  // Boot the page with a given payload already in storage.
  const withState = async payload => {
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(String(e)));
    await page.goto(url);
    if (payload) {
      await page.evaluate(p => localStorage.setItem("verse-by-heart:v1", JSON.stringify(p)), payload);
      await page.reload();
    }
    return { ctx, page, errors };
  };

  const verse = (over) => Object.assign({
    id: "v" + over.ref.replace(/\W/g, ""), source: "kjv",
    attempts: 0, best: 0, last: null, recent: []
  }, over);

  const GEN = "In the beginning God created the heaven and the earth.";
  const PSA = "God is our refuge and strength, a very present help in trouble.";

  /* --- a fresh deck is entirely due, and the queue says so --- */
  {
    const { ctx, page } = await withState(null);
    const cards = await page.$$eval(".card", n => n.length);
    eq("a fresh deck is all due", await page.textContent("#queueN"), String(cards));
    check("the queue is not in its resting state when work is waiting",
      !(await page.getAttribute("#queue", "class")).includes("rest"));
    check("the review button is offered when verses are due", await page.isVisible("#queueGo"));

    // The count is a bare numeral next to its label, which announces as two
    // disconnected fragments; one live region carries the whole sentence.
    const says = await page.textContent("#queueSays");
    check(`the queue announces its count as a sentence (got "${says}")`,
      says.includes(String(cards)) && /verses? due/.test(says));
    const live = await page.evaluate(() => {
      const r = document.getElementById("queueSays");
      return { live: r.getAttribute("aria-live"), hiddenTwin: document.getElementById("queueN").getAttribute("aria-hidden") };
    });
    eq("...from a polite live region", live.live, "polite");
    eq("...with the visual count hidden from screen readers", live.hiddenTwin, "true");
    await ctx.close();
  }

  /* --- the SM-2 ladder lengthens with each clean pass, and a lapse resets it --- */
  {
    const { ctx, page, errors } = await withState(null);
    await page.click('.card .open:has-text("Philippians 4:13")');
    await page.click('button[data-mode="recite"]');
    const VERSE = "I can do all things through Christ which strengtheneth me.";
    const recite = async text => {
      await page.fill("#attempt", text);
      await page.click("#check");
      return page.textContent("#nextUp");
    };
    // Come back on the day the verse next falls due. Only a due review advances
    // the ladder, so the rungs can only be climbed one sitting at a time.
    const comeBackWhenDue = async () => {
      await page.evaluate(() => {
        const s = JSON.parse(localStorage.getItem("verse-by-heart:v1"));
        const t = new Date();
        s.verses.find(v => v.ref === "Philippians 4:13").due =
          t.getFullYear() + "-" + String(t.getMonth() + 1).padStart(2, "0") + "-" + String(t.getDate()).padStart(2, "0");
        localStorage.setItem("verse-by-heart:v1", JSON.stringify(s));
      });
      await page.reload();
      await page.click('.card .open:has-text("Philippians 4:13")');
      await page.click('button[data-mode="recite"]');
    };

    // SM-2's opening rungs are fixed at 1 day then 6 days; only after that does
    // the interval start multiplying by the ease factor.
    check("a first clean pass is filed for tomorrow",
      (await recite(VERSE)).includes("tomorrow"), await page.textContent("#nextUp"));
    await comeBackWhenDue();
    check("a second clean pass jumps to six days",
      (await recite(VERSE)).includes("in 6 days"), await page.textContent("#nextUp"));
    await comeBackWhenDue();
    check("a third clean pass multiplies out past a fortnight",
      (await recite(VERSE)).includes("weeks"), await page.textContent("#nextUp"));

    // A failed recall must drop the verse back to the bottom rung, or a verse
    // you've forgotten would stay parked weeks out.
    await comeBackWhenDue();
    check("a failed recall comes back tomorrow, not weeks out",
      (await recite("zzz qqq www")).includes("another pass"), await page.textContent("#nextUp"));

    const sched = await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem("verse-by-heart:v1"));
      return s.verses.find(v => v.ref === "Philippians 4:13");
    });
    eq("a lapse resets the repetition count", sched.reps, 0);
    check(`a lapse drives the ease factor down (got ${sched.ease})`, sched.ease < 2.5);
    check(`the ease factor never falls below SM-2's floor (got ${sched.ease})`, sched.ease >= 1.3);
    check("scheduling raised no page errors", errors.length === 0, errors.join(" | "));
    await ctx.close();
  }

  /* --- reciting removes a verse from the due queue --- */
  {
    const { ctx, page } = await withState(null);
    const before = Number(await page.textContent("#queueN"));
    await page.click('.card .open:has-text("Philippians 4:13")');
    await page.click('button[data-mode="recite"]');
    await page.fill("#attempt", "I can do all things through Christ which strengtheneth me.");
    await page.click("#check");
    eq("a recited verse leaves the due queue", Number(await page.textContent("#queueN")), before - 1);
    const chip = await page.textContent('.card:has-text("Philippians 4:13") .when');
    eq("its card now shows when it comes back", chip.trim(), "1d");
    await ctx.close();
  }

  /* --- drilling the same verse again in one sitting is practice, not a review --- */
  {
    // Grading every press would compound the interval: four clean taps on a
    // fresh verse would file it six weeks out on the strength of one sitting.
    const { ctx, page } = await withState(null);
    await page.click('.card .open:has-text("Philippians 4:13")');
    await page.click('button[data-mode="recite"]');
    const VERSE = "I can do all things through Christ which strengtheneth me.";
    for (let i = 0; i < 4; i++) {
      await page.fill("#attempt", VERSE);
      await page.click("#check");
    }
    const v = await page.evaluate(() => JSON.parse(localStorage.getItem("verse-by-heart:v1"))
      .verses.find(x => x.ref === "Philippians 4:13"));
    eq("every run in a sitting still counts as an attempt", v.attempts, 4);
    eq("...but only the review that was due moves the schedule", v.interval, 1);
    eq("...so the repetition count advances once, not four times", v.reps, 1);
    check("...and the page names the extra runs as practice",
      (await page.textContent("#nextUp")).includes("Extra practice"), await page.textContent("#nextUp"));
    await ctx.close();
  }

  /* --- an overdue review outranks a verse never started --- */
  {
    const OVERDUE = {
      schema: 2,
      verses: [
        verse({ ref: "Genesis 1:1", text: GEN }),                       // never studied
        verse({ ref: "Psalm 46:1", text: PSA, attempts: 2, best: 90, last: "2020-01-01",
                recent: [90], ease: 2.5, reps: 2, interval: 6, due: "2020-01-07" })
      ],
      activeId: "vGenesis11",
      history: {}
    };
    const { ctx, page } = await withState(OVERDUE);
    check("a long-overdue review is offered before an unstudied verse",
      (await page.textContent("#queueSub")).includes("Psalm 46:1"),
      await page.textContent("#queueSub"));
    await ctx.close();
  }

  /* --- a corrupt schedule can't park a verse as permanently due --- */
  {
    // reps without an interval multiplies out to zero for ever.
    const BROKEN = {
      schema: 2,
      verses: [verse({ ref: "Genesis 1:1", text: GEN, attempts: 3, best: 90, last: "2020-01-01",
                       recent: [90], ease: 2.5, reps: 3, interval: 0, due: "2020-01-01" })],
      activeId: "vGenesis11",
      history: {}
    };
    const { ctx, page } = await withState(BROKEN);
    await page.click('button[data-mode="recite"]');
    await page.fill("#attempt", GEN);
    await page.click("#check");
    const v = await page.evaluate(() => JSON.parse(localStorage.getItem("verse-by-heart:v1")).verses[0]);
    check(`a repaired schedule moves off today (interval ${v.interval})`, v.interval >= 1);
    check("a repaired verse leaves the due queue", (await page.textContent("#queueN")) === "0");
    await ctx.close();
  }

  /* --- importing a more recent session brings its schedule with it --- */
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vbh-sched-"));
    const key = n => {
      const t = new Date();
      t.setDate(t.getDate() + n);
      return t.getFullYear() + "-" + String(t.getMonth() + 1).padStart(2, "0") + "-" + String(t.getDate()).padStart(2, "0");
    };
    // Here the verse is comfortably filed three weeks out...
    const LOCAL = {
      schema: 2,
      verses: [verse({ ref: "Genesis 1:1", text: GEN, attempts: 5, best: 99, last: key(-10),
                       recent: [99, 99, 99], ease: 2.7, reps: 4, interval: 30, due: key(20) })],
      activeId: "vGenesis11", history: {}
    };
    // ...but on the other device it was failed yesterday.
    const OTHER = {
      schema: 2,
      verses: [verse({ ref: "Genesis 1:1", text: GEN, attempts: 7, best: 99, last: key(-1),
                       recent: [99, 99, 20], ease: 1.9, reps: 0, interval: 1, due: key(0) })],
      activeId: "vGenesis11", history: {}
    };
    const f = path.join(dir, "other.json");
    fs.writeFileSync(f, JSON.stringify(OTHER));

    const { ctx, page } = await withState(LOCAL);
    await page.setInputFiles("#importFile", f);
    // The import lands via FileReader.onload, so wait on the merged state rather
    // than a fixed delay that a slow machine can outrun.
    await page.waitForFunction(() =>
      JSON.parse(localStorage.getItem("verse-by-heart:v1")).verses[0].recent.length === 3);
    const merged = await page.evaluate(() => JSON.parse(localStorage.getItem("verse-by-heart:v1")).verses[0]);
    eq("importing a newer session takes its scores", merged.recent.join(), "99,99,20");
    // The scores and the schedule they produced must not be split: recording the
    // lapse while keeping the old month-long interval buries the verse.
    eq("...and the schedule those scores produced", merged.reps, 0);
    check("...so the lapsed verse actually comes back round",
      (await page.textContent("#queueN")) === "1", "due count " + await page.textContent("#queueN"));
    eq("cumulative attempt counts still take the higher of the two", merged.attempts, 7);
    await ctx.close();
  }

  /* --- v1 payloads (no schedule at all) survive the upgrade --- */
  {
    // Real practice history lives in these payloads; losing it is unacceptable.
    const V1 = {
      verses: [
        verse({ ref: "Genesis 1:1", text: GEN, attempts: 4, best: 97, last: "2020-01-01", recent: [96, 97] }),
        verse({ ref: "Psalm 46:1", text: PSA, attempts: 1, best: 30, last: "2020-01-01", recent: [30] })
      ],
      activeId: "vGenesis11",
      history: { "2020-01-01": 5 }
    };
    const { ctx, page, errors } = await withState(V1);

    eq("a v1 payload keeps every verse", await page.$$eval(".card", n => n.length), 2);
    check("a v1 payload keeps its recorded scores",
      (await page.textContent('.card:has-text("Genesis 1:1") .stat')).includes("best 97% · 4×"));
    check("a v1 payload keeps its streak history",
      (await page.textContent("#streakLabel")).length > 0);
    check("v1 verses last practised years ago come up due",
      (await page.textContent("#queueN")) === "2");

    // Selecting a verse persists, which is when the upgraded shape hits disk.
    await page.click('.card .open:has-text("Psalm 46:1")');
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("verse-by-heart:v1")));
    eq("the upgraded payload is stamped with its schema version", stored.schema, 2);
    const gen = stored.verses.find(v => v.ref === "Genesis 1:1");
    const psa = stored.verses.find(v => v.ref === "Psalm 46:1");
    eq("two clean recorded scores replay to two repetitions", gen.reps, 2);
    eq("...and to SM-2's six-day rung", gen.interval, 6);
    eq("a recorded failure replays to a reset schedule", psa.reps, 0);
    check(`a recorded failure replays a reduced ease (got ${psa.ease})`, psa.ease < 2.5);
    check("migration raised no page errors", errors.length === 0, errors.join(" | "));
    await ctx.close();
  }

  /* --- the page opens on the queue, not wherever you stopped --- */
  {
    const FUTURE = {
      schema: 2,
      verses: [
        verse({ ref: "Genesis 1:1", text: GEN, attempts: 3, best: 99, last: "2026-01-01",
                recent: [99], ease: 2.6, reps: 4, interval: 400, due: "2099-01-01" }),
        verse({ ref: "Psalm 46:1", text: PSA, attempts: 1, best: 80, last: "2020-01-01",
                recent: [80], ease: 2.5, reps: 1, interval: 1, due: "2020-01-02" })
      ],
      activeId: "vGenesis11",
      history: {}
    };
    const { ctx, page } = await withState(FUTURE);
    const activeRef = await page.textContent(".card.active .ref");
    check(`the page opens on a due verse, not the stored one (got ${activeRef.trim()})`,
      activeRef.includes("Psalm 46:1"));
    eq("only the due verse is counted", await page.textContent("#queueN"), "1");
    const chip = await page.textContent('.card:has-text("Genesis 1:1") .when');
    check(`a far-future verse shows its wait, not "due" (got ${chip.trim()})`, chip.trim() !== "due");
    await ctx.close();
  }

  /* --- nothing due reads as rest, not as an empty error state --- */
  {
    const RESTING = {
      schema: 2,
      verses: [
        verse({ ref: "Genesis 1:1", text: GEN, attempts: 3, best: 99, last: "2026-01-01",
                recent: [99], ease: 2.6, reps: 4, interval: 400, due: "2099-01-01" })
      ],
      activeId: "vGenesis11",
      history: {}
    };
    const { ctx, page } = await withState(RESTING);
    eq("nothing due shows a zero count", await page.textContent("#queueN"), "0");
    check("the queue switches to its resting state",
      (await page.getAttribute("#queue", "class")).includes("rest"));
    check("the review button is withdrawn when nothing is due",
      !(await page.isVisible("#queueGo")));
    check("the resting queue says what comes next",
      (await page.textContent("#queueSub")).includes("Genesis 1:1"));
    await ctx.close();
  }
}

/* ============================ layout and a11y =========================== */
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(url);
  await page.click('button[data-mode="veil"]');

  eq("no horizontal overflow at 390px",
    await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0);

  const clipped = await page.evaluate(() => {
    const seg = document.querySelector("#veilSeg");
    return seg.lastElementChild.getBoundingClientRect().right > seg.getBoundingClientRect().right + 0.5;
  });
  check("the veil control is not clipped on a narrow screen", !clipped);

  const a11y = await page.evaluate(() => {
    const unlabelled = [...document.querySelectorAll('[role="button"], button')]
      .filter(b => !b.textContent.trim() && !b.getAttribute("aria-label")).length;
    const reachable = [...document.querySelectorAll('.tok[role="button"]')].every(t => t.tabIndex === 0);
    return { unlabelled, reachable };
  });
  eq("every control has an accessible name", a11y.unlabelled, 0);
  check("revealable words are keyboard reachable", a11y.reachable);

  // Keyboard shortcuts must not fire while typing into the recall box.
  await page.click('button[data-mode="recite"]');
  await page.fill("#attempt", "");
  await page.type("#attempt", "12");
  eq("digits typed into the recall box do not switch modes", await page.inputValue("#attempt"), "12");
  await ctx.close();
}

await browser.close();
report("UI behaviour");
