/** find-appapi.mjs — occurrences of "app/api" and O/q builder hints in bundle */
import { readFileSync } from "node:fs";
const c = readFileSync("fasih-sm/scripts/index-CEn00D-U.js", "utf8");
let i = c.indexOf("app/api");
while (i >= 0) {
  console.log("--- @ " + i);
  console.log(c.slice(Math.max(0, i - 350), i + 350).replace(/\s+/g, " "));
  i = c.indexOf("app/api", i + 1);
}
