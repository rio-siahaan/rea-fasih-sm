/** ctx-find.mjs — potong konteks pemakaian "assignment-history/data" & "comment" update di bundle */
import { findFasihPage } from "./lib/cdp.mjs";

const page = await findFasihPage(9222);
const js = await page.evaluate(`
  performance.getEntriesByType("resource").map((e) => e.name)
    .filter((u) => /\\.js(\\?|$)/.test(u))
`);
const out = [];
for (const u of js) {
  let txt = "";
  try {
    txt = await page.evaluate(`fetch(${JSON.stringify(u)}).then(r=>r.text())`);
  } catch { continue; }
  for (const needle of ["assignment-history/data", "history-data", "{dataKey:", "remark:"]) {
    let from = 0;
    for (let k = 0; k < 6; k++) {
      const i = txt.indexOf(needle, from);
      if (i < 0) break;
      out.push(`---- ${u.split("/").pop()} @${i} [${needle}]\n${txt.slice(Math.max(0, i - 300), i + 420).replace(/\s+/g, " ")}\n`);
      from = i + needle.length;
    }
  }
}
console.log(out.slice(0, 20).join("\n"));
process.exit(0);
