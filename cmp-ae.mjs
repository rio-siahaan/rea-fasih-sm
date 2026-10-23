/** cmp-ae.mjs — nilai usaha ae1d3950 vs semua baris Excel (kedua file) */
import { readFileSync } from "node:fs";
import { readXlsx, xlsxValues } from "./lib/xlsx.mjs";

const pack = JSON.parse(readFileSync("./data-ae1d3950.json", "utf8"));
const dataJson = JSON.parse(pack.data);
console.log("code:", pack.code_identity, " answers:", dataJson.answers.length);

// kelompokkan per indeks N
const perIdx = {};
for (const a of dataJson.answers) {
  const m = /^(.+?)(?:#(\d+))?$/.exec(String(a.dataKey || ""));
  if (!m) continue;
  const base = m[1];
  const idx = Number(m[2] || 0);
  if (!/biaya|pendapatan|kbli|omzet|aset|output|tenaga_kerja|upah|gaji/i.test(base)) continue;
  (perIdx[idx] ??= []).push(`${base} = ${JSON.stringify(a.answer)}`);
}
for (const idx of Object.keys(perIdx).sort((a, b) => a - b)) {
  console.log(`\n--- index #${idx}`);
  for (const l of perIdx[idx]) console.log("  " + l);
}
console.log("\n== Jumlah usaha:", dataJson.answers.find((a) => a.dataKey === "jumlah_usaha")?.answer);
