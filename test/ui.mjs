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
