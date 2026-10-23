/** keys-econ.mjs — semua dataKey #N dari paket (full inventory) */
import { readFileSync } from "node:fs";
const id = process.argv[2];
const pack = JSON.parse(readFileSync(`./data-${id}.json`, "utf8"));
const d = JSON.parse(pack.data);
const byIdx = {};
for (const a of d.answers) {
  const m = /^(.+?)#(\d+)$/.exec(String(a.dataKey || ""));
  if (m) (byIdx[m[2]] ??= {})[m[1]] = a.answer;
}
for (const [idx, o] of Object.entries(byIdx)) {
  const econ = Object.keys(o).filter(
    (k) => /biaya|pendapatan|omzet|gaji|kbli|aset|tenaga|upah|pengeluaran|output/i.test(k),
  );
  if (!econ.length) continue;
  console.log(`\n--- #${idx}`);
  for (const k of econ.sort()) {
    let v = o[k];
    if (Array.isArray(v)) v = v.map((x) => x.value ?? x?.label).join(",");
    if (v && typeof v === "object") v = JSON.stringify(v);
    console.log(`  ${k} = ${String(v).slice(0, 60)}`);
  }
}
