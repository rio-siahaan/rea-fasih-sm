/** ctx-comment.mjs — potong cuplikan kode di sekitar pemakaian struktur notes/comment */
import { findFasihPage } from "./lib/cdp.mjs";

const page = await findFasihPage(9222);
const js = await page.evaluate(`
  performance.getEntriesByType("resource").map((e) => e.name).filter((u) => /index-.*\\.js/.test(u))
`);
const out = [];
for (const u of js) {
  let txt = "";
  try {
    txt = await page.evaluate(`fetch(${JSON.stringify(u)}).then(r=>r.text())`);
  } catch { continue; }
  for (const needle of ['notes:[', 'notes: [', 'notes:"', '"notes"', "sender:", 'comment:', "dataKey:'',notes", '"comment"']) {
    let from = 0;
    for (let k = 0; k < 4; k++) {
      const i = txt.indexOf(needle, from);
      if (i < 0) break;
      const ctx = txt.slice(Math.max(0, i - 350), i + 350).replace(/\s+/g, " ");
      out.push(`---- ${u.split("/").pop()} @${i} [${needle}]\n${ctx}\n`);
      from = i + 1;
    }
  }
}
console.log(out.slice(0, 14).join("\n"));
process.exit(0);
