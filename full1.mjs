/** full1.mjs — struktur file penuh Rio_rumus2 (1).xlsx */
import { readFileSync } from "node:fs";
import { readXlsx, xlsxValues } from "./lib/xlsx.mjs";

const read = readXlsx(readFileSync("C:/Users/User/Downloads/Rio_rumus2 (1).xlsx"));
console.log("SHEET:", read.sheetNames.join(" | "));
for (const name of read.sheetNames) {
  const rows = read.sheets[name];
  const g = (c) => (typeof c === "object" && c !== null ? c.v ?? "" : c ?? "");
  // cari baris header (baris terakhir yang kolom 0 berisi "kategori"?) — cukup print 6 baris pertama
  console.log(`\n=== ${name}: ${rows.length} baris terpakai`);
  for (let i = 0; i < Math.min(6, rows.length); i++) {
    const r = rows[i];
    const nonempty = r.filter((c) => String(g(c)).trim() !== "").length;
    console.log(`r${i + 1} (${nonempty} isi): ${r.slice(0, 34).map((c) => String(g(c)).slice(0, 20)).join(" | ")}`);
  }
}
