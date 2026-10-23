/** find-base.mjs — hunt for the API base URL construction */
import { readFileSync } from "node:fs";
const c = readFileSync("fasih-sm/scripts/index-CEn00D-U.js", "utf8");
for (const kw of ["/app", "BASE_URL", "baseURL", "apiBase", "VITE_", "origin"]) {
  let idx = 0, n = 0;
  let i;
  while (n < 6) {
    i = c.indexOf(kw, idx);
    if (i < 0) break;
    console.log(`--- "${kw}" @ ${i}`);
    console.log(c.slice(Math.max(0, i - 250), i + 250).replace(/\s+/g, " ").slice(0, 480));
    idx = i + 1;
    n++;
  }
}
