// Behavioural tests for the page, driven through a real browser.
//
// Several checks here guard bugs that have already bitten once. Read the
// comments before deleting one.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { buildPreview, launch, check, eq, report, PAGE, readPng, near } from "./harness.mjs";

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

/* ============================ printable worksheets ======================= */
{
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => { window.__printCalls = 0; window.print = () => { window.__printCalls++; }; });
  await page.goto(url);

  // A worksheet only makes sense for the two modes that actually hide words.
  check("print button hidden in read mode", !(await page.isVisible("#printBtn")));
  await page.click('button[data-mode="veil"]');
  check("print button visible in veil mode", await page.isVisible("#printBtn"));
  await page.click('button[data-mode="initials"]');
  check("print button visible in initials mode", await page.isVisible("#printBtn"));
  await page.click('button[data-mode="recite"]');
  check("print button hidden in recite mode", !(await page.isVisible("#printBtn")));

  await page.click('button[data-mode="veil"]');
  await page.click("#printBtn");
  eq("print button invokes window.print()", await page.evaluate(() => window.__printCalls), 1);

  // The sandboxed Artifact iframe may block window.print() outright (it needs
  // allow-modals) with no exception to catch, so the hint text names the
  // keyboard fallback rather than silently doing nothing.
  check("hint names the Ctrl/Cmd+P fallback in veil mode", (await page.textContent("#hint")).includes("+P"));

  await page.emulateMedia({ media: "print" });
  const printed = await page.evaluate(() => {
    const d = sel => getComputedStyle(document.querySelector(sel)).display;
    const veiled = document.querySelector(".tok .veiled");
    return {
      modes: d(".modes"),
      deck: d(".deck"),
      masthead: d(".masthead"),
      hint: d(".hint"),
      verse: d(".verse"),
      reference: document.querySelector("#ref").textContent,
      veiledBorder: veiled ? getComputedStyle(veiled).borderBottomWidth : null,
    };
  });
  check("print media hides the mode switch", printed.modes === "none");
  check("print media hides the deck", printed.deck === "none");
  check("print media hides the masthead", printed.masthead === "none");
  check("print media hides the mode hint", printed.hint === "none");
  check("print media keeps the verse box visible", printed.verse !== "none");
  check("print media keeps the reference heading", printed.reference.length > 0);
  check("print media draws a fill-in line under hidden words",
    !!printed.veiledBorder && parseFloat(printed.veiledBorder) > 0, printed.veiledBorder);

  // printBtn is hidden in Recite mode, but native Ctrl/Cmd+P isn't gated by
  // that — a print triggered from Recite mode must still neutralize the
  // recite panel, or its dark-styled textarea prints unreadable against the
  // forced-white page. .modes is print-hidden, so switch back to screen
  // media to reach the mode button, then re-emulate print to check.
  await page.emulateMedia({ media: "screen" });
  await page.click('button[data-mode="recite"]');
  await page.emulateMedia({ media: "print" });
  const reciteDisplay = await page.evaluate(() => getComputedStyle(document.querySelector(".recite")).display);
  check("print media hides the recite panel", reciteDisplay === "none", reciteDisplay);

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

/* ============================ recall alignment is bounded ================ */
{
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(url);

  // align()'s LCS is O(n·m); custom verse creation has no length limit of its
  // own, and neither does the recall textarea, so either side could allocate
  // an unbounded matrix. MAX_ALIGN_WORDS in src/app.js caps both at 3,000
  // words — comfortably above Psalms 119 (2,423 words, the longest KJV
  // chapter) — and runCheck() refuses to grade past it rather than silently
  // comparing only the first 3,000 words and reporting a false "exact" for
  // whatever went unchecked beyond that, which could otherwise reach mastery
  // on a recitation that was actually wrong past the cap.
  const ALIGN_CAP = 3000;
  const wordsAt = n => Array.from({ length: n }, (_, i) => "w" + i).join(" ");

  await page.click("details.add > summary");
  await page.fill("#newRef", "Alignment Cap 1:1");
  await page.fill("#newText", wordsAt(ALIGN_CAP));
  await page.click("#addForm button[type=submit]");
  await page.click('.card .open:has-text("Alignment Cap 1:1")');
  await page.click('button[data-mode="recite"]');
  await page.fill("#attempt", wordsAt(ALIGN_CAP));
  await page.click("#check");
  check("a verse exactly at the word cap still grades normally",
    (await page.isVisible("#result")) && (await page.textContent("#pct")) === "100%");

  await page.fill("#newRef", "Alignment Cap 2:1");
  await page.fill("#newText", wordsAt(ALIGN_CAP + 1));
  await page.click("#addForm button[type=submit]");
  await page.click('.card .open:has-text("Alignment Cap 2:1")');
  await page.click('button[data-mode="recite"]');
  await page.fill("#attempt", wordsAt(ALIGN_CAP + 1));
  await page.click("#check");
  const overLong = await page.textContent("#reciteNote");
  check(`a verse over the word cap is refused, not silently graded (note: "${overLong}")`,
    !(await page.isVisible("#result")) && overLong.toLowerCase().includes("too long"));

  // The same guard has to catch an oversized attempt against an
  // ordinary-length verse — the more realistic case a huge paste hits.
  await page.click('.card .open:has-text("Philippians 4:13")');
  await page.click('button[data-mode="recite"]');
  await page.fill("#attempt", wordsAt(ALIGN_CAP + 1));
  await page.click("#check");
  const overAttempt = await page.textContent("#reciteNote");
  check(`an over-length attempt against a normal verse is refused too (note: "${overAttempt}")`,
    !(await page.isVisible("#result")) && overAttempt.toLowerCase().includes("too long"));

  // A refusal has to clear whatever score is already on screen from an
  // earlier, valid attempt — otherwise the old percentage looks like the
  // grade for the recitation that was actually just refused.
  await page.fill("#attempt", "I can do all things through Christ which strengtheneth me.");
  await page.click("#check");
  check("a normal attempt grades and shows a result", await page.isVisible("#result"));
  await page.fill("#attempt", wordsAt(ALIGN_CAP + 1));
  await page.click("#check");
  check("a refusal hides the previous attempt's result rather than leaving it on screen",
    !(await page.isVisible("#result")));

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

/* ============================ deck sharing by URL ======================== */
let sharedHash;
{
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(url);

  // A verse only this "sender" has, so the recipient below has something new
  // to receive rather than every shared ref already matching their own deck.
  await page.click("details.add > summary");
  await page.fill("#newRef", "Psalm 27:1");
  await page.fill("#newText", "The LORD is my light and my salvation; whom shall I fear?");
  await page.click("#addForm button[type=submit]");

  check("the share panel starts hidden", !(await page.isVisible("#shareLink")));
  await page.click("#shareBtn");
  check("Share deck reveals a link", await page.isVisible("#shareLink"));
  const link = await page.inputValue("#shareLink");
  check("the link carries the deck fragment", link.includes("#deck="));
  sharedHash = "#" + link.split("#")[1];

  // Clicking Share again closes the panel rather than re-opening a second one.
  await page.click("#shareBtn");
  check("Share deck toggles the panel closed", !(await page.isVisible("#shareLink")));

  await ctx.close();
}

{
  // A sandboxed page with no clipboard-write grant is the case that actually
  // matters on the published Artifact, so force it rather than trust whatever
  // permission state this harness's Chromium happens to start with.
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => { Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true }); });
  await page.goto(url);
  await page.click("#shareBtn");
  await page.click("#shareCopy");
  const selected = await page.evaluate(() => {
    const el = document.getElementById("shareLink");
    return document.activeElement === el && el.selectionStart === 0 && el.selectionEnd === el.value.length;
  });
  check("Copy link without a Clipboard API falls back to selecting the text", selected);
  check("the fallback explains itself", (await page.textContent("#shareCopyStatus")).length > 5);
  await ctx.close();
}

{
  // A second, independent browser context stands in for a friend who never
  // touched the sender's deck — their storage starts at the default 28.
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  await page.goto(url + sharedHash);
  const cards = () => page.$$eval(".card", n => n.length);
  const start = await cards();

  check("opening a shared-deck link shows the import banner", await page.isVisible("#shareImport"));
  const sub = await page.textContent("#shareImportSub");
  check("the banner names the one verse the recipient doesn't already have",
    sub.includes("1 new verse") && sub.includes("already have"), sub);

  await page.click("#shareImportAdd");
  eq("adding a shared deck grows the recipient's deck by only the new verse", await cards(), start + 1);
  check("the imported verse is on the deck", (await page.locator(".card").filter({ hasText: "Psalm 27:1" }).count()) === 1);
  check("the import banner clears after adding", !(await page.isVisible("#shareImport")));

  await page.reload();
  check("the deck link's hash is consumed, not left to re-prompt on reload", !(await page.isVisible("#shareImport")));
  eq("the added verse survives the reload", await cards(), start + 1);

  check("deck sharing raised no page errors", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

{
  // The same link opened twice must not duplicate the verse a second time —
  // the recipient's own ref, not the sender's, decides what's already theirs.
  // Two fresh pages in one context (rather than re-goto()ing the same page):
  // navigating to a URL that differs only by fragment is a same-document
  // hash change in a real browser, not a reload, so the script wouldn't
  // re-run and this wouldn't actually exercise a second "open the link".
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const page1 = await ctx.newPage();
  await page1.goto(url + sharedHash);
  await page1.click("#shareImportAdd");
  const once = await page1.$$eval(".card", n => n.length);
  await page1.close();

  const page2 = await ctx.newPage();
  await page2.goto(url + sharedHash);
  await page2.click("#shareImportAdd");
  eq("re-adding an already-received shared deck is a no-op", await page2.$$eval(".card", n => n.length), once);
  await page2.close();
  await ctx.close();
}

{
  // Dismissing must not add anything, and must still consume the hash.
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(url + sharedHash);
  const cards = () => page.$$eval(".card", n => n.length);
  const start = await cards();

  await page.click("#shareImportDismiss");
  eq("dismissing a shared deck adds nothing", await cards(), start);
  check("dismissing hides the banner", !(await page.isVisible("#shareImport")));
  await page.reload();
  check("dismissing also consumes the hash", !(await page.isVisible("#shareImport")));
  await ctx.close();
}

{
  // A corrupted or hand-edited fragment must explain itself, not crash or
  // silently add garbage to the deck.
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  await page.goto(url + "#deck=not-valid-base64-at-all!!!");
  const cards = () => page.$$eval(".card", n => n.length);
  const start = await cards();

  check("a broken share link is reported, not silently dropped", await page.isVisible("#shareImport"));
  check("Add to my deck is withheld for a broken link", !(await page.isVisible("#shareImportAdd")));
  await page.click("#shareImportDismiss");
  eq("a broken share link adds nothing to the deck", await cards(), start);
  check("a broken share link raised no page errors", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

{
  // A deck past SHARE_MAX_VERSES must produce a link decodeShareDeck will
  // still accept — capping only on the read side would silently hand out
  // links that report themselves as "broken" on the far end.
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(url);
  const big = {
    schema: 2,
    verses: Array.from({ length: 205 }, (_, i) => ({
      id: "vbig" + i, ref: "Big Book " + i + ":1", text: "Verse number " + i + ".",
      source: "custom", attempts: 0, best: 0, last: null, recent: [],
      ease: 2.5, reps: 0, interval: 0, due: null
    })),
    activeId: null, history: {}
  };
  await page.evaluate(p => localStorage.setItem("verse-by-heart:v1", JSON.stringify(p)), big);
  await page.reload();
  eq("the oversized deck loaded in full", await page.$$eval(".card", n => n.length), 205);

  await page.click("#shareBtn");
  const link = await page.inputValue("#shareLink");
  const shared = JSON.parse(Buffer.from(link.split("#deck=")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
  check("the share link itself is capped at SHARE_MAX_VERSES", shared.length === 200, String(shared.length));
  check("going over the cap is explained, not silent", (await page.textContent("#shareCopyStatus")).includes("200"));
  await ctx.close();
}

{
  // A verse whose ref or text is longer than decodeShareDeck will accept
  // must be shortened on the SENDING side too — truncating only on read
  // would let a recipient's copy silently diverge from what the sender
  // thinks they shared.
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(url);
  const longText = "Word ".repeat(2000).trim(); // well past SHARE_TEXT_MAX (8000)
  const oversized = {
    schema: 2,
    verses: [{
      id: "vlong", ref: "Long Book 1:1", text: longText, source: "custom",
      attempts: 0, best: 0, last: null, recent: [], ease: 2.5, reps: 0, interval: 0, due: null
    }],
    activeId: null, history: {}
  };
  await page.evaluate(p => localStorage.setItem("verse-by-heart:v1", JSON.stringify(p)), oversized);
  await page.reload();

  await page.click("#shareBtn");
  const link = await page.inputValue("#shareLink");
  const shared = JSON.parse(Buffer.from(link.split("#deck=")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
  check("an oversized verse is shortened in the link itself, not just on read",
    shared[0][1].length <= 8000, String(shared[0][1].length));
  check("shortening a verse to fit is explained, not silent",
    (await page.textContent("#shareCopyStatus")).length > 5);

  // What the link carries is exactly what a recipient will receive — the
  // sender's own truncation and the reader's are the same cut, not two
  // different ones that could disagree. (decodeShareDeck also trims after
  // slicing, so the expected length mirrors that, not the raw slice length —
  // a truncation cut that lands on whitespace trims one extra character.)
  const hash = "#" + link.split("#")[1];
  const ctx2 = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const page2 = await ctx2.newPage();
  await page2.goto(url + hash);
  await page2.click("#shareImportAdd");
  const receivedText = await page2.evaluate(() =>
    JSON.parse(localStorage.getItem("verse-by-heart:v1")).verses.find(v => v.ref === "Long Book 1:1").text.length);
  eq("the recipient's copy matches the length already shortened in the link", receivedText, shared[0][1].trim().length);
  await ctx2.close();
  await ctx.close();
}

{
  // A hand-edited or truncated link can carry a malformed entry (null, a
  // bare string, wrong arity) alongside otherwise-good ones. One bad entry
  // must not void every valid verse in the same link. Built with plain
  // Node base64 (no browser round trip needed) so the only navigation is
  // the one straight to the deck link — goto(plain url) then goto(url+hash)
  // would be a same-document hash change in a real browser, not a reload,
  // and wouldn't actually exercise "open this link".
  const compact = [
    ["Good Verse 1:1", "This one is fine."],
    null,
    "just a string",
    ["Good Verse 2:1", "This one is fine too."],
    ["only one element"],
    ["", "empty ref is dropped like normal"]
  ];
  const b64 = Buffer.from(JSON.stringify(compact), "utf8").toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(url + "#deck=" + b64);

  check("a link with some malformed entries still offers the valid ones",
    await page.isVisible("#shareImportAdd"));
  const sub = await page.textContent("#shareImportSub");
  check("only the well-formed entries are counted", sub.includes("2 new verse"), sub);
  await page.click("#shareImportAdd");
  check("both well-formed verses were added despite the malformed entries",
    (await page.locator(".card").filter({ hasText: "Good Verse 1:1" }).count()) === 1 &&
    (await page.locator(".card").filter({ hasText: "Good Verse 2:1" }).count()) === 1);
  await ctx.close();
}

/* ============================ verse lookup ("Add any verse by reference") */
{
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  await page.goto(url);
  await page.click("details.add > summary");

  check("Look up is offered where DecompressionStream exists", await page.isVisible("#lookupBtn"));

  const lookUp = async ref => {
    await page.fill("#newRef", ref);
    await page.click("#lookupBtn");
    await page.waitForFunction(() => document.getElementById("lookupBtn").textContent === "Look up");
    return { err: await page.textContent("#addErr"), text: await page.inputValue("#newText"), ref: await page.inputValue("#newRef") };
  };

  // Same wording the starter deck already carries this verse with — proof the
  // bundled data round-trips through gzip/base64 without corruption.
  const john316 = await lookUp("john 3:16");
  eq("a single verse looks up the exact KJV wording",
    john316.text,
    "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.");
  eq("the reference is normalised to its canonical case", john316.ref, "John 3:16");

  const range = await lookUp("Romans 8:28-30");
  eq("a verse range joins consecutive verses with spaces", range.text,
    "And we know that all things work together for good to them that love God, to them who are the called according to his purpose. " +
    "For whom he did foreknow, he also did predestinate to be conformed to the image of his Son, that he might be the firstborn among many brethren. " +
    "Moreover whom he did predestinate, them he also called: and whom he called, them he also justified: and whom he justified, them he also glorified.");

  const chapter = await lookUp("Psalm 117");
  eq("a bare 'Book chapter' pulls the whole chapter", chapter.text,
    "O praise the LORD, all ye nations: praise him, all ye people. " +
    "For his merciful kindness is great toward us: and the truth of the LORD endureth for ever. Praise ye the LORD.");

  const alias = await lookUp("song of solomon 2:1");
  eq("a book alias resolves to its canonical KJV name", alias.ref, "Solomon's Song 2:1");

  // The kjv package's data files this book as "Psalms" (plural), but every
  // other reference in the app — the starter deck included — displays the
  // singular "Psalm". A looked-up reference must match that, not leak the
  // data's internal plural spelling into the deck.
  const psalm = await lookUp("psalm 23:1");
  eq("a Psalms lookup displays as singular 'Psalm', matching the rest of the app", psalm.ref, "Psalm 23:1");

  // Jude, Obadiah, Philemon, 2 John, and 3 John have only one chapter, so their
  // usual citation form is "Book verse" (e.g. "Jude 3"), not "Book chapter".
  // A number straight after one of these book names must be read as a verse.
  const oneChapter = await lookUp("Jude 3");
  eq("a bare number after a one-chapter book is read as a verse, not a chapter",
    oneChapter.text, "Beloved, when I gave all diligence to write unto you of the common salvation, it was needful for me to write unto you, and exhort you that ye should earnestly contend for the faith which was once delivered unto the saints.");
  eq("the normalised reference still names the (implicit) chapter", oneChapter.ref, "Jude 1:3");

  const badBook = await lookUp("Xylophon 1:1");
  check("an unknown book names itself in the error", badBook.err.includes("Xylophon"));

  const badChapter = await lookUp("Romans 999:1");
  check("a chapter past the book's end says so, not 'no verse'", badChapter.err.includes("chapter 999"));

  const badVerse = await lookUp("Romans 8:999");
  check("a verse past the chapter's end names the chapter", badVerse.err.includes("Romans 8") && badVerse.err.includes("999"));

  const garbage = await lookUp("not a reference");
  check("unparseable input gets a readable error, not a crash", garbage.err.length > 10);

  await page.fill("#newRef", "");
  await page.click("#lookupBtn");
  check("looking up with no reference asks for one", (await page.textContent("#addErr")).length > 5);

  // Enter in the Reference field should look up, not submit the half-filled form.
  await page.fill("#newRef", "James 1:5");
  await page.press("#newRef", "Enter");
  await page.waitForFunction(() => document.getElementById("lookupBtn").textContent === "Look up");
  check("Enter in the reference field triggers a lookup",
    (await page.inputValue("#newText")).startsWith("If any of you lack wisdom"));

  const cardsBefore = await page.$$eval(".card", n => n.length);
  await page.click("#addForm button[type=submit]");
  eq("a looked-up verse adds to the deck like any other", await page.$$eval(".card", n => n.length), cardsBefore + 1);

  check("verse lookup raised no page errors", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

/* ==================== verse lookup absent without the API ================ */
{
  // Same feature-detection pattern as Speak It: DecompressionStream doesn't
  // exist everywhere, so the control must be absent outright rather than
  // present and broken — see CLAUDE.md.
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => { delete window.DecompressionStream; });
  await page.goto(url);
  await page.click("details.add > summary");

  check("Look up stays hidden without DecompressionStream", !(await page.isVisible("#lookupBtn")));

  await page.fill("#newRef", "John 3:16");
  await page.press("#newRef", "Enter");
  check("Enter falls through to the ordinary add-a-verse flow when lookup is unavailable",
    (await page.textContent("#addErr")).toLowerCase().includes("paste"));
  await ctx.close();
}

/* ==================== verse lookup: decompression failure ================ */
{
  // If DecompressionStream exists but the pipeline throws — a corrupted
  // payload, a browser quirk — the failure must reach the user as a message
  // in #addErr, not vanish as a silently-swallowed rejection.
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    class ThrowingDecompressionStream {
      constructor() { throw new Error("simulated decompression failure"); }
    }
    window.DecompressionStream = ThrowingDecompressionStream;
  });
  await page.goto(url);
  await page.click("details.add > summary");

  await page.fill("#newRef", "John 3:16");
  await page.click("#lookupBtn");
  await page.waitForFunction(() => document.getElementById("lookupBtn").textContent === "Look up");
  check("a decompression failure surfaces a message instead of failing silently",
    (await page.textContent("#addErr")).length > 5);
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

  /* --- grading a due verse hands off to whatever's next in the queue, so
     getting to it doesn't mean scrolling back to the deck --- */
  {
    const TWO_DUE = {
      schema: 2,
      verses: [
        verse({ ref: "Genesis 1:1", text: GEN, ease: 2.5, reps: 0, interval: 0, due: "2020-01-01" }),
        verse({ ref: "Psalm 46:1", text: PSA, ease: 2.5, reps: 0, interval: 0, due: "2020-01-02" })
      ],
      activeId: "vGenesis11",
      history: {}
    };
    const { ctx, page } = await withState(TWO_DUE);
    await page.click('button[data-mode="recite"]');
    await page.fill("#attempt", GEN);
    await page.click("#check");
    check("a next-due button appears naming what's still waiting",
      (await page.textContent("#nextDueBtn")).includes("Psalm 46:1"),
      await page.textContent("#nextDueBtn"));
    await page.click("#nextDueBtn");
    eq("...and clicking it moves straight to that verse", await page.textContent("#ref"), "Psalm 46:1");
    check("...already in Recite mode, ready to type",
      await page.locator("#recite").isVisible());
    await ctx.close();
  }

  /* --- deleting the verse a pending next-due button points at must not
     leave that button dangling on a removed id --- */
  {
    const TWO_DUE = {
      schema: 2,
      verses: [
        verse({ ref: "Genesis 1:1", text: GEN, ease: 2.5, reps: 0, interval: 0, due: "2020-01-01" }),
        verse({ ref: "Psalm 46:1", text: PSA, ease: 2.5, reps: 0, interval: 0, due: "2020-01-02" })
      ],
      activeId: "vGenesis11",
      history: {}
    };
    const { ctx, page } = await withState(TWO_DUE);
    await page.click('button[data-mode="recite"]');
    await page.fill("#attempt", GEN);
    await page.click("#check");
    check("a next-due button is armed before the removal",
      await page.locator("#nextDueBtn").isVisible());
    // Remove Psalm 46:1 — the verse the button targets, not the active one —
    // without navigating away from the result panel first.
    const drop = page.locator(".card").filter({ hasText: "Psalm 46:1" }).locator(".drop");
    await drop.click();
    await drop.click(); // confirm
    check("removing that verse retracts the next-due button",
      !(await page.locator("#nextDueBtn").isVisible()));
    await ctx.close();
  }

  /* --- clearing the last due review says so instead of staying silent --- */
  {
    const ONE_DUE = {
      schema: 2,
      verses: [verse({ ref: "Genesis 1:1", text: GEN, ease: 2.5, reps: 0, interval: 0, due: "2020-01-01" })],
      activeId: "vGenesis11",
      history: {}
    };
    const { ctx, page } = await withState(ONE_DUE);
    await page.click('button[data-mode="recite"]');
    await page.fill("#attempt", GEN);
    await page.click("#check");
    check("no next-due button when nothing else is waiting",
      !(await page.locator("#nextDueBtn").isVisible()));
    check("the page says the queue is cleared",
      (await page.textContent("#nextUp")).includes("Queue cleared"),
      await page.textContent("#nextUp"));
    await ctx.close();
  }

  /* --- extra practice doesn't offer a next-due hand-off, since it didn't
     change the queue --- */
  {
    // Same shape as "drilling the same verse again is practice, not a review"
    // above: the first pass is the due one and moves Genesis off today, so a
    // second pass in the same sitting is unambiguously extra practice —
    // rather than starting from a verse that's already not due, which the
    // "open on the queue" wiring would immediately swap away from.
    const TWO_DUE = {
      schema: 2,
      verses: [
        verse({ ref: "Genesis 1:1", text: GEN, ease: 2.5, reps: 0, interval: 0, due: "2020-01-01" }),
        verse({ ref: "Psalm 46:1", text: PSA, ease: 2.5, reps: 0, interval: 0, due: "2020-01-02" })
      ],
      activeId: "vGenesis11",
      history: {}
    };
    const { ctx, page } = await withState(TWO_DUE);
    await page.click('button[data-mode="recite"]');
    await page.fill("#attempt", GEN);
    await page.click("#check");                         // the due review
    await page.fill("#attempt", GEN);
    await page.click("#check");                         // extra practice
    check("...and the page names it extra practice",
      (await page.textContent("#nextUp")).includes("Extra practice"));
    check("no next-due button for a run that wasn't a due review, even with Psalm 46:1 still waiting",
      !(await page.locator("#nextDueBtn").isVisible()));
    await ctx.close();
  }

  /* --- the deck sheet never shows bare --rule ground where no card sits --- */
  {
    // The sheet used to be a --rule-coloured ground with 1px gaps between
    // cards. Every grid cell no card reached therefore painted as a flat grey
    // slab: beside a one- or two-verse deck, and — the case auto-fit alone
    // can't reach — across the whole trailing row of any deck whose size
    // doesn't divide evenly by the column count. Five verses at four columns
    // is that case; so is the 28-verse starter deck at three columns.
    const FIVE = {
      schema: 2,
      verses: Array.from({ length: 5 }, (_, i) =>
        verse({ ref: "Genesis 1:" + (i + 1), text: GEN, ease: 2.5, reps: 0, interval: 0, due: "2020-01-01" })),
      activeId: "vGenesis11",
      history: {}
    };
    const { ctx, page } = await withState(FIVE);

    // Everything below is measured off the rendered pixels, not off computed
    // style: a rule that is declared correctly can still fail to paint.
    const geom = await page.evaluate(() => {
      const sheet = document.querySelector(".cards").getBoundingClientRect();
      const cards = [...document.querySelectorAll(".card")].map(c => {
        const r = c.getBoundingClientRect();
        return { x: r.x - sheet.x, y: r.y - sheet.y, w: r.width, h: r.height, right: r.right - sheet.x };
      });
      const rows = {};
      cards.forEach(c => (rows[Math.round(c.y)] ||= []).push(c));
      const ys = Object.keys(rows).map(Number).sort((a, b) => a - b);
      const last = cards[cards.length - 1];
      return {
        sheetX: sheet.x, sheetY: sheet.y, sheetW: sheet.width, sheetH: sheet.height,
        columns: rows[ys[0]].length,
        lastRowCount: rows[ys[ys.length - 1]].length,
        // seam between the first two cards of the top row
        seamX: rows[ys[0]][0].right,
        seamY: rows[ys[0]][0].y + rows[ys[0]][0].h / 2,
        // seam between the two rows, under the first column
        rowSeamX: rows[ys[0]][0].x + rows[ys[0]][0].w / 2,
        rowSeamY: ys[1],
        // a point well inside the trailing empty region
        emptyX: (last.right + sheet.width) / 2,
        emptyY: last.y + last.h / 2,
        trailing: sheet.width - last.right
      };
    });
    check("five verses lay out in a partly-filled last row (the case under test)",
      geom.columns === 4 && geom.lastRowCount === 1 && geom.trailing > 100,
      `columns=${geom.columns}, last row ${geom.lastRowCount}, trailing ${Math.round(geom.trailing)}px`);

    const RULE = await page.evaluate(() => {
      const el = document.createElement("span");
      el.style.color = getComputedStyle(document.documentElement).getPropertyValue("--rule").trim();
      document.body.appendChild(el);
      const c = getComputedStyle(el).color.match(/\d+/g).map(Number);
      el.remove();
      return c;
    });
    const PAPER = await page.evaluate(() =>
      // not .active — the selected card sits on --sunken, not the paper tone
      getComputedStyle(document.querySelector(".card:not(.active)")).backgroundColor
        .match(/\d+/g).map(Number));

    // A plain locator screenshot crops using the element's fractional
    // getBoundingClientRect() truncated to whole device pixels, which — for
    // some fractional y offsets above .cards — starts the crop up to 1px
    // above the element's real top edge and samples the page background
    // there instead of the frame. page.screenshot({clip}) doesn't round the
    // same way, so it stays correct regardless of what pushes .cards up or
    // down the page; fullPage keeps the clip valid even where .cards runs
    // past the viewport's own height, as a wider deck does at this width.
    const sheetPng = readPng(await page.screenshot({
      fullPage: true,
      clip: { x: geom.sheetX, y: geom.sheetY, width: geom.sheetW, height: geom.sheetH }
    }));
    const px = (x, y) => sheetPng.at(
      Math.max(0, Math.min(sheetPng.width - 1, Math.round(x))),
      Math.max(0, Math.min(sheetPng.height - 1, Math.round(y))));

    // The bug: this pixel used to be --rule, a flat grey slab filling the row.
    const empty = px(geom.emptyX, geom.emptyY);
    check("an empty cell paints paper, not the --rule grey that used to slab it",
      near(empty, PAPER) && !near(empty, RULE),
      `empty cell rgb(${empty}) — paper is rgb(${PAPER}), rule is rgb(${RULE})`);

    // ...and the hairlines the fix moved onto the cards still actually paint.
    // Sample a 3px window across the seam so subpixel rounding doesn't decide
    // the result; if the border is gone the whole window is paper.
    const ruledWithin = (x, y, dx, dy) =>
      [-1, 0, 1].some(d => near(px(x + d * dx, y + d * dy), RULE));
    check("a hairline still rules the seam between two cards in a row",
      ruledWithin(geom.seamX, geom.seamY, 1, 0),
      `window at x=${Math.round(geom.seamX)} is all paper; rule is rgb(${RULE})`);
    check("a hairline still rules the seam between two rows",
      ruledWithin(geom.rowSeamX, geom.rowSeamY, 0, 1),
      `window at y=${Math.round(geom.rowSeamY)} is all paper; rule is rgb(${RULE})`);

    // The frame must paint over the cards, not behind them. An outline or an
    // inset shadow on .cards renders beneath its own descendants, so with
    // gap:0 it survived only across the blank trailing region and vanished
    // along the top and left — declared, and invisible.
    const along = (n, f) => Array.from({ length: n }, (_, i) => f(2 + i * (n > 1 ? 1 : 0), i / (n - 1)));
    const edgeRuled = (label, pts) => {
      const bad = pts.filter(([x, y]) => !near(px(x, y), RULE));
      check(`the sheet is framed along its ${label} edge`, bad.length === 0,
        `${bad.length}/${pts.length} pixels off-colour, first at ${bad[0]} = rgb(${bad[0] ? px(...bad[0]) : ""})`);
    };
    const W = sheetPng.width, H = sheetPng.height;
    const spread = (n, lo, hi) => Array.from({ length: n }, (_, i) => lo + (i * (hi - lo)) / (n - 1));
    edgeRuled("top", spread(24, 4, W - 5).map(x => [x, 0]));
    edgeRuled("bottom", spread(24, 4, W - 5).map(x => [x, H - 1]));
    edgeRuled("left", spread(12, 4, H - 5).map(y => [0, y]));
    edgeRuled("right", spread(12, 4, H - 5).map(y => [W - 1, y]));
    await ctx.close();
  }

  /* --- a deck too small to fill one row fills the sheet instead of
     stranding empty tracks beside it --- */
  {
    const ONE = {
      schema: 2,
      verses: [verse({ ref: "Genesis 1:1", text: GEN, ease: 2.5, reps: 0, interval: 0, due: "2020-01-01" })],
      activeId: "vGenesis11",
      history: {}
    };
    const { ctx, page } = await withState(ONE);
    const spans = await page.evaluate(() => {
      const s = document.querySelector(".cards").getBoundingClientRect();
      const c = document.querySelector(".card").getBoundingClientRect();
      return { sheet: Math.round(s.width), card: Math.round(c.width) };
    });
    check("a single-verse deck spans the whole sheet",
      spans.sheet - spans.card <= 2,
      `sheet ${spans.sheet}px vs card ${spans.card}px`);
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

  /* --- searching the deck filters the card grid by reference or text --- */
  {
    const TWO = {
      schema: 2,
      verses: [
        verse({ ref: "Genesis 1:1", text: GEN, ease: 2.5, reps: 0, interval: 0, due: "2020-01-01" }),
        verse({ ref: "Psalm 46:1", text: PSA, ease: 2.5, reps: 0, interval: 0, due: "2020-01-01" })
      ],
      activeId: "vGenesis11",
      history: {}
    };
    const { ctx, page } = await withState(TWO);
    const refs = async () => (await page.$$eval(".card .ref .open", ns => ns.map(n => n.textContent))).join(", ");

    eq("no query shows every card", await page.$$eval(".card", n => n.length), 2);
    eq("no query leaves the count caption blank", await page.textContent("#deckSearchCount"), "");

    await page.fill("#deckSearch", "psalm");
    eq("a reference match narrows to the matching card", await refs(), "Psalm 46:1");
    eq("the count caption names what's filtered", await page.textContent("#deckSearchCount"), "1 of 2 shown");
    eq("the matching span of the reference is wrapped in a highlight mark",
      await page.textContent(".card .ref .open mark.hit"), "Psalm");
    eq("the highlight doesn't swallow the rest of the reference",
      await page.$eval(".card .ref .open", n => n.textContent), "Psalm 46:1");

    await page.fill("#deckSearch", "REFUGE");
    eq("a verse-text match is case-insensitive", await refs(), "Psalm 46:1");
    eq("the highlighted span keeps the verse's own casing, not the query's",
      await page.textContent(".card .snippet mark.hit"), "refuge");

    await page.fill("#deckSearch", "the");
    eq("a query matching only one verse's text narrows to it", await refs(), "Genesis 1:1");
    eq("every occurrence of the query is marked, not just the first",
      await page.$$eval(".card .snippet mark.hit", ns => ns.length), 3);

    await page.fill("#deckSearch", "god");
    eq("a word shared by both verses' text matches both",
      (await page.$$eval(".card .ref .open", ns => ns.map(n => n.textContent).sort())).join(", "),
      "Genesis 1:1, Psalm 46:1");

    await page.fill("#deckSearch", "zzz");
    eq("a query matching nothing empties the grid", await page.$$eval(".card", n => n.length), 0);
    check("the empty grid itself is hidden, not just visually blank", !(await page.isVisible("#cards")));
    check("an empty result names the query instead of leaving a bare gap",
      (await page.textContent("#cardsEmpty")).includes("zzz"));

    await page.fill("#deckSearch", "");
    eq("clearing the search restores every card", await page.$$eval(".card", n => n.length), 2);
    check("the empty-state message withdraws once results return",
      !(await page.isVisible("#cardsEmpty")));
    eq("clearing the query removes every highlight mark",
      await page.$$eval("mark.hit", ns => ns.length), 0);

    await ctx.close();
  }

  /* --- filtering the deck by status (due / mastered / not started) --- */
  {
    // Relative to today, like the sort test below, so the fixture's meaning
    // doesn't drift as the wall clock moves.
    const fkey = n => {
      const t = new Date();
      t.setDate(t.getDate() + n);
      return t.getFullYear() + "-" + String(t.getMonth() + 1).padStart(2, "0") + "-" + String(t.getDate()).padStart(2, "0");
    };
    const FILTERABLE = {
      schema: 2,
      verses: [
        // mastered, but scheduled well into the future — not due.
        verse({ ref: "Genesis 1:1", text: GEN, attempts: 3, best: 99, last: fkey(-1),
                recent: [96, 97, 99], ease: 2.6, reps: 4, interval: 400, due: fkey(30) }),
        // recited before, overdue now — due but not new, not mastered.
        verse({ ref: "Psalm 46:1", text: PSA, attempts: 1, best: 60, last: fkey(-10),
                recent: [60], ease: 2.5, reps: 1, interval: 1, due: fkey(-3) }),
        // never recited — due (as "unstarted" already reads on its card) and new.
        verse({ ref: "Micah 6:8", text: "He hath shewed thee, O man, what is good.",
                ease: 2.5, reps: 0, interval: 0, due: null }),
        // recited before, scheduled ahead — neither due, new, nor mastered.
        verse({ ref: "Romans 8:28", text: "And we know that all things work together for good.",
                attempts: 2, best: 80, last: fkey(-1), recent: [80, 80],
                ease: 2.5, reps: 2, interval: 30, due: fkey(20) })
      ],
      activeId: "vGenesis11",
      history: {}
    };
    const { ctx, page } = await withState(FILTERABLE);
    const refs = async () => (await page.$$eval(".card .ref .open", ns => ns.map(n => n.textContent))).join(", ");

    eq("\"all verses\" is the default filter", await page.$eval("#deckFilter", n => n.value), "all");
    eq("no filter shows every card", await refs(), "Genesis 1:1, Psalm 46:1, Micah 6:8, Romans 8:28");
    eq("no filter leaves the count caption blank", await page.textContent("#deckSearchCount"), "");

    await page.selectOption("#deckFilter", "due");
    eq("the due filter shows overdue and never-started verses, not scheduled or future ones",
      await refs(), "Psalm 46:1, Micah 6:8");
    eq("the count caption reports the filter even with no search query",
      await page.textContent("#deckSearchCount"), "2 of 4 shown");

    await page.selectOption("#deckFilter", "mastered");
    eq("the mastered filter shows only a verse with three recent scores at or above 95%",
      await refs(), "Genesis 1:1");

    await page.selectOption("#deckFilter", "new");
    eq("the not-started filter shows only a verse with zero attempts",
      await refs(), "Micah 6:8");

    await page.selectOption("#deckFilter", "due");
    await page.fill("#deckSearch", "micah");
    eq("a filter composes with an active search query", await refs(), "Micah 6:8");

    await page.selectOption("#deckSort", "az");
    await page.fill("#deckSearch", "");
    eq("a sort mode composes with an active filter", await refs(), "Micah 6:8, Psalm 46:1");
    await page.selectOption("#deckSort", "added");

    await page.selectOption("#deckFilter", "mastered");
    await page.fill("#deckSearch", "romans");
    check("the empty grid is hidden when a filter and query together match nothing",
      !(await page.isVisible("#cards")));
    eq("the empty state names both the filter and the query when both rule everything out",
      await page.textContent("#cardsEmpty"), "No mastered verses match “romans”.");

    await ctx.close();
  }

  /* --- filter empty-state wording when the filter alone matches nothing --- */
  {
    const fkey = n => {
      const t = new Date();
      t.setDate(t.getDate() + n);
      return t.getFullYear() + "-" + String(t.getMonth() + 1).padStart(2, "0") + "-" + String(t.getDate()).padStart(2, "0");
    };
    const ALL_STARTED = {
      schema: 2,
      verses: [
        verse({ ref: "Genesis 1:1", text: GEN, attempts: 1, best: 60, last: fkey(-1),
                recent: [60], ease: 2.5, reps: 1, interval: 10, due: fkey(9) }),
        verse({ ref: "Psalm 46:1", text: PSA, attempts: 1, best: 70, last: fkey(-1),
                recent: [70], ease: 2.5, reps: 1, interval: 10, due: fkey(9) })
      ],
      activeId: "vGenesis11",
      history: {}
    };
    const { ctx, page } = await withState(ALL_STARTED);

    await page.selectOption("#deckFilter", "due");
    eq("nothing due reads as a plain statement, not a search-style message",
      await page.textContent("#cardsEmpty"), "Nothing due right now.");

    await page.selectOption("#deckFilter", "new");
    eq("no unstarted verses names that directly",
      await page.textContent("#cardsEmpty"), "Every verse has been attempted at least once.");

    await page.selectOption("#deckFilter", "mastered");
    eq("no mastered verses names that directly",
      await page.textContent("#cardsEmpty"), "No verses mastered yet.");

    await ctx.close();
  }

  /* --- sorting the deck by due date or reference, independent of search --- */
  {
    // Due dates are relative to today, not hardcoded calendar dates, so this
    // test doesn't quietly change its own meaning as the wall clock moves
    // (a fixed future date eventually becomes a fixed past date).
    const key = n => {
      const t = new Date();
      t.setDate(t.getDate() + n);
      return t.getFullYear() + "-" + String(t.getMonth() + 1).padStart(2, "0") + "-" + String(t.getDate()).padStart(2, "0");
    };
    // Insertion order deliberately matches neither the due-date order nor the
    // alphabetical order below, so each sort mode's test can only pass if
    // that mode actually reordered the grid. "nahum 1:8" is lowercase on
    // purpose: it sorts after "Zephaniah 3:17" under a plain case-sensitive
    // comparison (every capital letter precedes every lowercase one in ASCII)
    // but between "Nahum 1:7" and "Zephaniah 3:17" once case is ignored, so
    // the A-Z check below can only pass if the comparator actually reads its
    // `sensitivity: "base"` option.
    const SORTABLE = {
      schema: 2,
      verses: [
        verse({ ref: "Nahum 1:7", text: "The LORD is good, a strong hold in the day of trouble.",
                ease: 2.5, reps: 1, interval: 300, due: key(30) }),
        verse({ ref: "Zephaniah 3:17", text: "The LORD thy God in the midst of thee is mighty.",
                ease: 2.5, reps: 0, interval: 0, due: key(-10) }),
        verse({ ref: "Micah 6:8", text: "He hath shewed thee, O man, what is good.",
                ease: 2.5, reps: 0, interval: 0, due: null }),
        verse({ ref: "Amos 5:24", text: "Let judgment run down as waters.",
                ease: 2.5, reps: 0, interval: 0, due: key(-3) }),
        verse({ ref: "nahum 1:8", text: "Trust and obey, for there is no other way.",
                ease: 2.5, reps: 0, interval: 0, due: key(-1) })
      ],
      activeId: "vNahum17",
      history: {}
    };
    const { ctx, page } = await withState(SORTABLE);
    const refs = async () => (await page.$$eval(".card .ref .open", ns => ns.map(n => n.textContent))).join(", ");

    eq("deck order is the default sort", await page.$eval("#deckSort", n => n.value), "added");
    eq("deck order matches insertion order, not due date or the alphabet", await refs(),
      "Nahum 1:7, Zephaniah 3:17, Micah 6:8, Amos 5:24, nahum 1:8");

    await page.selectOption("#deckSort", "due");
    eq("due-soonest puts the most overdue verse first", await refs(),
      "Zephaniah 3:17, Amos 5:24, nahum 1:8, Micah 6:8, Nahum 1:7");

    await page.selectOption("#deckSort", "az");
    eq("A-Z sorts by reference, case-insensitively", await refs(),
      "Amos 5:24, Micah 6:8, Nahum 1:7, nahum 1:8, Zephaniah 3:17");

    await page.selectOption("#deckSort", "due");
    await page.fill("#deckSearch", "good");
    eq("a sort mode composes with an active search filter", await refs(), "Micah 6:8, Nahum 1:7");

    await ctx.close();
  }

  /* --- highlight matching is regex-safe and length-safe, not just case-insensitive --- */
  {
    const EDGE = {
      schema: 2,
      verses: [
        verse({ ref: "Custom 1:1", text: "İstanbul and Ankara are cities.",
                ease: 2.5, reps: 0, interval: 0, due: "2020-01-01" }),
        verse({ ref: "Custom 2:1", text: "Alpha.beta Alphaxbeta end.",
                ease: 2.5, reps: 0, interval: 0, due: "2020-01-01" }),
        verse({ ref: "Custom 3:1", text: "İstanbul was great today.",
                ease: 2.5, reps: 0, interval: 0, due: "2020-01-01" })
      ],
      activeId: "vCustom11",
      history: {}
    };
    const { ctx, page } = await withState(EDGE);
    const card = ref => `.card:has(.ref .open:text-is("${ref}"))`;

    await page.fill("#deckSearch", "ankara");
    eq("a match next to a length-changing lowercase letter (Turkish İ) still highlights the right span",
      await page.textContent(`${card("Custom 1:1")} .snippet mark.hit`), "Ankara");
    eq("highlighting never corrupts the verse text around such a letter",
      await page.$eval(`${card("Custom 1:1")} .snippet`, n => n.textContent),
      "İstanbul and Ankara are cities.");

    await page.fill("#deckSearch", "a.");
    eq("a literal period in the query matches only a literal period, not any character",
      await page.$$eval(`${card("Custom 2:1")} .snippet mark.hit`, ns => ns.length), 1);

    // "Custom 3:1" contains no plain ASCII "i" anywhere except inside the
    // Turkish "İ" itself, where "Custom 1:1" has a real one in "cities".
    // Filtering and highlighting must agree on whether the Turkish letter
    // counts as a match, or a card would appear on screen with nothing
    // marked inside it to justify why it's there.
    await page.fill("#deckSearch", "i");
    check("a verse whose only match is a real ASCII letter is shown",
      !!(await page.$(card("Custom 1:1"))));
    check("a verse whose only \"i\" is the Turkish İ is excluded, not shown unmarked",
      !(await page.$(card("Custom 3:1"))));
    check("every card shown for an active query has at least one highlight inside it",
      await page.$$eval(".card", cards => cards.every(c => c.querySelector("mark.hit") !== null)));

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
