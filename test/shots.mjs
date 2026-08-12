// Captures the page across modes, themes, and viewports so a change can be
// looked at rather than reasoned about. Writes into shots/ (gitignored).
//
//   npm run shots            all of them
//   npm run shots -- veil    only matrix entries whose name contains "veil"
//
// Nothing here asserts. Use it to see what you changed, then send the files to
// the user with SendUserFile if they tell the story better than a description.
import fs from "node:fs";
import path from "node:path";
import { buildPreview, launch, ROOT } from "./harness.mjs";

const OUT = path.join(ROOT, "shots");
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const filter = process.argv[2] || "";
const url = buildPreview();
const browser = await launch();

const DESKTOP = { width: 1100, height: 950 };
const MOBILE = { width: 390, height: 844 };

/** Each entry: [name, viewport, async setup]. Keep the setup honest — drive the
 *  UI the way a person would rather than poking state directly. */
const MATRIX = [
  ["read", DESKTOP, async p => {
    await p.click('.card .open:has-text("Philippians 4:6-7")');
  }],
  ["veil-50", DESKTOP, async p => {
    await p.click('.card .open:has-text("Philippians 4:6-7")');
    await p.click('button[data-mode="veil"]');
  }],
  ["veil-peeked", DESKTOP, async p => {
    await p.click('.card .open:has-text("Philippians 4:6-7")');
    await p.click('button[data-mode="veil"]');
    for (let i = 0; i < 3; i++) {
      const blank = await p.$(".tok.blank");
      if (blank) await blank.click();
    }
  }],
  ["initials", DESKTOP, async p => {
    await p.click('.card .open:has-text("Philippians 4:6-7")');
    await p.click('button[data-mode="initials"]');
  }],
  ["recite-graded", DESKTOP, async p => {
    await p.click('.card .open:has-text("Philippians 4:6-7")');
    await p.click('button[data-mode="recite"]');
    // a realistic near-miss: one paraphrase, one word split differently
    await p.fill("#attempt", "Be careful for nothing but in everything by prayer and supplication with thanksgiving let your requests be made known unto God. And the peace of God, which passes all understanding, shall keep your hearts and minds through Christ Jesus.");
    await p.click("#check");
  }],
  ["deck", DESKTOP, async p => {
    await p.locator(".deck-head").scrollIntoViewIfNeeded();
  }],
  ["mobile-veil", MOBILE, async p => {
    await p.click('.card .open:has-text("Proverbs 3:5-6")');
    await p.click('button[data-mode="veil"]');
  }],
];

const written = [];
for (const [name, viewport, setup] of MATRIX) {
  if (filter && !name.includes(filter)) continue;
  for (const scheme of ["light", "dark"]) {
    const ctx = await browser.newContext({ colorScheme: scheme, viewport, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(String(e)));
    await page.goto(url);
    await setup(page);
    await page.waitForTimeout(250);
    const file = path.join(OUT, `${name}-${scheme}.png`);
    await page.screenshot({ path: file });
    written.push(path.relative(ROOT, file) + (errors.length ? `  ⚠ ${errors.length} page error(s)` : ""));
    await ctx.close();
  }
}

await browser.close();
console.log(written.length ? written.join("\n") : "nothing matched filter: " + filter);
