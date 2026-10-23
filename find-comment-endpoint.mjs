/**
 * find-comment-endpoint.mjs — cari di bundle SPA endpoint yang dipakai
 * saat menambahkan komentar per-field (notes) di halaman edit.
 */
import { findFasihPage } from "./lib/cdp.mjs";

const page = await findFasihPage(9222);
const js = await page.evaluate(`
  (async () => {
    // kumpulkan semua <script src> yang sudah termuat + performa entries
    const urls = performance.getEntriesByType("resource")
      .map((e) => e.name)
      .filter((u) => /\\.js(\\?|$)/.test(u));
    return urls;
  })()
`);
console.log("script urls:", js.length);
const hits = [];
for (const u of js) {
  let txt = "";
  try {
    txt = await page.evaluate(`
      fetch(${JSON.stringify(u)}).then(r => r.text())
    `);
  } catch (e) {
    console.log("skip", u.slice(-60), String(e).slice(0, 60));
    continue;
  }
  // cari endpoint yang memuat kata comment/notes
  const re = /["'`](\/[a-zA-Z0-9\-\/]*(?:comment|note)[a-zA-Z0-9\-\/]*)["'`]/gi;
  const seen = new Set();
  let m;
  while ((m = re.exec(txt))) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      hits.push([u.split("/").pop().slice(0, 40), m[1]]);
    }
  }
  // juga pola updateComment / addComment dsb
  const re2 = /(update|add|save|set)[A-Za-z]*Comment[a-zA-Z]*/g;
  const s2 = new Set();
  while ((m = re2.exec(txt))) {
    if (!s2.has(m[0])) { s2.add(m[0]); hits.push([u.split("/").pop().slice(0, 40), "fn:" + m[0]]); }
  }
}
for (const [f, e] of hits) console.log(f, "→", e);
console.log("total hit:", hits.length);
process.exit(0);
