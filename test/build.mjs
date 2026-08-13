// Confirms index.html hasn't drifted from src/ — that whoever last edited
// src/style.css, src/markup.html, or src/app.js also ran `npm run build`
// and committed the result.
import fs from "node:fs";
import { PAGE, check, report } from "./harness.mjs";
import { buildPage } from "../build.mjs";

console.log("Checking index.html against a fresh build from src/\n");

const built = buildPage();
const committed = fs.readFileSync(PAGE, "utf8");

check(
  "index.html matches `npm run build` output from src/",
  built === committed,
  "run `npm run build` and commit the regenerated index.html"
);

report("Build fidelity");
