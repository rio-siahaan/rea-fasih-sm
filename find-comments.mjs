/** find-comments.mjs — cari struktur komentar di data.json cache */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const dir = "./bulk-cache";
const keys = ['"remark"', '"komentar"', '"notes"', '"comment"', '"catatan"'];
let hits = 0;
outer: for (const f of readdirSync(dir)) {
  const raw = readFileSync(join(dir, f), "utf8");
  for (const key of keys) {
    let from = 0;
    for (;;) {
      const i = raw.indexOf(key, from);
      if (i < 0) break;
      console.log(f.slice(0, 8), key, "@", i, "ctx:", raw.slice(Math.max(0, i - 110), i + 170).replace(/\s+/g, " "));
      hits++;
      from = i + 1;
      if (hits > 10) break outer;
    }
  }
}
console.log("hits:", hits);
