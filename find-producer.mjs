import { readFileSync } from "node:fs";
const c = readFileSync("fasih-sm/scripts/index-CEn00D-U.js", "utf8");
for (const kw of ["generate-by-id", "assignment-producer/generate-all", "assignment-sync"]) {
  let i = c.indexOf(kw), n = 0;
  while (i >= 0 && n < 3) {
    console.log(`--- "${kw}" @ ${i}`);
    console.log(c.slice(Math.max(0, i - 500), i + 500).replace(/\s+/g, " "));
    i = c.indexOf(kw, i + 1);
    n++;
  }
}
