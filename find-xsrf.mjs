/** find-xsrf.mjs — find XSRF token mechanism in bundle */
import { readFileSync } from "node:fs";
const c = readFileSync("fasih-sm/scripts/index-CEn00D-U.js", "utf8");
for (const kw of ["XSRF-TOKEN", "csrf"]) {
  let i = c.toLowerCase().indexOf(kw.toLowerCase());
  while (i >= 0) {
    console.log(`--- "${kw}" @ ${i}`);
    console.log(c.slice(Math.max(0, i - 450), i + 350).replace(/\s+/g, " "));
    i = c.toLowerCase().indexOf(kw.toLowerCase(), i + 1);
  }
}
