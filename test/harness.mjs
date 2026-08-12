// Shared test plumbing: assertions, the artifact wrapper, and browser launch.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const PAGE = path.join(ROOT, "index.html");

/* ---------- tiny assertion harness ---------- */
let passed = 0;
const failures = [];

export function check(label, condition, detail) {
  if (condition) {
    passed++;
  } else {
    failures.push(detail ? `${label}\n      ${detail}` : label);
    console.log(`  ✗ ${label}${detail ? "\n      " + detail : ""}`);
  }
}

export function eq(label, actual, expected) {
  check(label, Object.is(actual, expected), `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

export function report(suite) {
  const total = passed + failures.length;
  console.log(`\n${suite}: ${passed}/${total} checks passed`);
  if (failures.length) {
    console.log(`\n${failures.length} failure(s):`);
    failures.forEach(f => console.log("  ✗ " + f));
    process.exit(1);
  }
}

/* ---------- the page under test ---------- */

/** The Artifact host wraps our file in a document skeleton. Reproduce it so
 *  tests exercise what actually ships, not a bare fragment. */
export function buildPreview() {
  const body = fs.readFileSync(PAGE, "utf8");
  const html = `<!doctype html><html><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${body}</body></html>`;
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vbh-")), "preview.html");
  fs.writeFileSync(out, html);
  return "file://" + out;
}

/** Read the STARTER deck out of index.html without executing the whole page. */
export function readStarter() {
  const html = fs.readFileSync(PAGE, "utf8");
  const m = html.match(/const STARTER = \[([\s\S]*?)\n {2}\];/);
  if (!m) throw new Error("Could not locate the STARTER array in index.html");
  return JSON.parse("[" + m[1].replace(/,\s*$/, "") + "]");
}

/* ---------- browser ---------- */

/** This sandbox ships Chromium under /opt/pw-browsers but the revision won't
 *  match whatever playwright resolves to, so point at the binary directly.
 *  Never run `playwright install` here — the CDN is outside the network policy. */
export function chromiumPath() {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
  if (!fs.existsSync(base)) return undefined;
  const dirs = fs.readdirSync(base)
    .filter(d => d.startsWith("chromium-"))
    .sort((a, b) => (parseInt(b.split("-")[1], 10) || 0) - (parseInt(a.split("-")[1], 10) || 0));
  for (const d of dirs) {
    const bin = path.join(base, d, "chrome-linux", "chrome");
    if (fs.existsSync(bin)) return bin;
  }
  return undefined;
}

export async function launch() {
  const { chromium } = await import("playwright");
  return chromium.launch({ executablePath: chromiumPath() });
}
