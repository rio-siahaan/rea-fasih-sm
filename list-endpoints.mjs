/** list-endpoints.mjs — dump semua endpoint API yang direferensikan bundle SPA */
import { findFasihPage } from "./lib/cdp.mjs";

const page = await findFasihPage(9222);
const js = await page.evaluate(`
  performance.getEntriesByType("resource").map((e) => e.name).filter((u) => /\\.js(\\?|$)/.test(u))
`);
const seen = new Set();
for (const u of js) {
  let txt = "";
  try {
    txt = await page.evaluate(`fetch(${JSON.stringify(u)}).then(r=>r.text())`);
  } catch { continue; }
  const re = /["'`]((?:\/(assignment-history|assignment-general|survey|assignment|s3|comment|monitoring)[a-zA-Z0-9\-\/._{}$]*)?)["'`]/g;
  // pola luas: string yang diawali / dan mengandung huruf API-ish
  const re2 = /["'`](\/[a-zA-Z0-9~._-]+(?:\/[a-zA-Z0-9~._-]+)+)["'`]/g;
  let m;
  while ((m = re2.exec(txt))) {
    const s = m[1];
    if (/(api|history|assignment|comment|note|s3|save|update|data)/i.test(s) && s.length < 120)
      seen.add(s);
  }
}
const arr = [...seen].sort();
for (const s of arr) console.log(s);
console.log("total:", arr.length);
process.exit(0);
