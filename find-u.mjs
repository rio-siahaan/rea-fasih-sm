import { readFileSync } from "node:fs";
const c = readFileSync("fasih-sm/scripts/index-CEn00D-U.js", "utf8");
const re = /function u\([^)]*\)\{|[,;{(]u=\s*\(?\s*\)?\s*=>/g;
let m, n = 0;
while ((m = re.exec(c)) !== null && n < 40) {
  console.log("--- @" + m.index);
  console.log(c.slice(m.index, m.index + 300).replace(/\s+/g, " "));
  n++;
}
