/** keys-block.mjs — SEMUA key di blok usaha #N (tanpa filter) */
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
  const ks = Object.keys(o);
  if (!ks.some((k) => /kbli|biaya|pendapatan|gaji|aset/.test(k))) continue;
  console.log(`\n--- #${idx} (${ks.length} key)`);
  for (const k of ks.sort()) {
    let v = o[k];
    if (Array.isArray(v)) v = v.map((x) => (x && typeof x === "object" ? x.value ?? x.label : x)).join(",");
    else if (v && typeof v === "object") v = JSON.stringify(v).slice(0, 40);
    console.log(`  ${k} = ${String(v).slice(0, 70)}`);
  }
}
