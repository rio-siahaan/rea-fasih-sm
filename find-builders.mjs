/** find-builders.mjs — locate index-CEn00D-U.js URL-builder definitions named O or q adjacent to usage */
import { readFileSync } from "node:fs";
const c = readFileSync("fasih-sm/scripts/index-CEn00D-U.js", "utf8");
// find every call context O(`...` , {..}) and q(`...`,{..}) — done. Now find their definitions:
const patterns = [
  /[,;{(](?:let |var |const )?([OQq])\s*=\s*async\s*\(?\s*\w+\s*,\s*\w+\s*\)?\s*=>/g,
  /([OQq])\s*=\s*async\s*\w+\s*=>/g,
];
const found = new Map();
for (const p of patterns) {
  let m;
  while ((m = p.exec(c)) !== null) {
    const seg = c.slice(m.index, m.index + 500).replace(/\s+/g, " ");
    if (/surveyPeriodId|api|http|fetch|base/.test(seg)) {
      if (!found.has(m.index)) found.set(m.index, `${m[1]} = ${seg}`);
    }
  }
}
for (const [i, s] of found) { console.log("--- @" + i); console.log(s.slice(0, 420)); }
