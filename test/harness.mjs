// Shared test plumbing: assertions, the artifact wrapper, and browser launch.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import zlib from "node:zlib";
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

/* ---------- pixels ---------- */

/** Decode a Playwright screenshot to sampleable pixels.
 *
 *  Some of what this page promises is a colour in a place — a hairline between
 *  two cards, a sheet that shows paper rather than rule-grey where no card
 *  sits. Computed styles are not evidence for those: a frame can be declared
 *  correctly and still never paint, which is exactly the bug that shipped a
 *  `.cards` outline the cards drew straight over. Read the rendered pixels.
 *
 *  Handles what Chromium emits for a screenshot: 8-bit truecolour, with or
 *  without alpha, uninterlaced. */
export function readPng(buf) {
  let p = 8, w = 0, h = 0, depth = 0, colour = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString("ascii", p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; colour = data[9]; }
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    p += 12 + len;
  }
  if (depth !== 8 || (colour !== 2 && colour !== 6)) {
    throw new Error(`unsupported PNG (bit depth ${depth}, colour type ${colour})`);
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = colour === 6 ? 4 : 3;
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  let o = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[o++];
    const line = raw.subarray(o, o + stride); o += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      const v = line[x];
      let r;
      if (filter === 0) r = v;
      else if (filter === 1) r = v + a;
      else if (filter === 2) r = v + b;
      else if (filter === 3) r = v + ((a + b) >> 1);
      else {
        const est = a + b - c;
        const pa = Math.abs(est - a), pb = Math.abs(est - b), pc = Math.abs(est - c);
        r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      cur[x] = r & 255;
    }
  }
  return {
    width: w,
    height: h,
    at(x, y) {
      const i = y * stride + x * bpp;
      return [out[i], out[i + 1], out[i + 2]];
    }
  };
}

/** True when two colours are the same to within a tolerance, so a check reads
 *  as "this is the rule colour" rather than tripping on antialiasing. */
export function near(a, b, tol = 12) {
  return a.every((v, i) => Math.abs(v - b[i]) <= tol);
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
