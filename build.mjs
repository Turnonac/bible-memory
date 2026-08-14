// Assembles the published index.html from src/. Zero dependencies: only
// node:fs and node:path, so this runs anywhere npm does.
//
// index.html is checked in (it's what gets published as the Artifact and
// what test/harness.mjs loads), but src/ is what you edit. Run `npm run
// build` after touching src/ and commit the regenerated index.html —
// test/build.mjs fails the moment the two drift apart.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.dirname(fileURLToPath(import.meta.url));
export const SRC = path.join(ROOT, "src");

export function buildPage() {
  const title = "<title>Verse by Heart</title>\n";
  const css = fs.readFileSync(path.join(SRC, "style.css"), "utf8");
  const markup = fs.readFileSync(path.join(SRC, "markup.html"), "utf8");
  const js = fs.readFileSync(path.join(SRC, "app.js"), "utf8");
  return title + "<style>\n" + css + "</style>\n\n" + markup + "<script>\n" + js + "</script>\n";
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const page = buildPage();
  fs.writeFileSync(path.join(ROOT, "index.html"), page);
  console.log("Built index.html (" + page.length + " bytes) from src/.");
}
