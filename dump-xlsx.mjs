/** dump-xlsx.mjs — struktur + contoh isi: node dump-xlsx.mjs <file> [maxRows] [maxCols] */
import { readFileSync } from "node:fs";
import { readXlsx, xlsxValues } from "./lib/xlsx.mjs";

const file = process.argv[2];
const maxRows = Number(process.argv[3] || 6);
const maxCols = Number(process.argv[4] || 10);
const read = readXlsx(readFileSync(file));
const vals = xlsxValues(read);
console.log("FILE:", file);
console.log("SHEET:", read.sheetNames.join(" | "));
for (const name of read.sheetNames) {
  const rows = vals[name];
  console.log(`\n=== sheet "${name}" — ${rows.length} baris`);
  for (let i = 0; i < Math.min(maxRows, rows.length); i++) {
    const cells = rows[i].slice(0, maxCols);
    const line = cells.map((c) => {
      if (c && typeof c === "object" && c.f) return `${String(c.v).slice(0, 18)}{${c.f.slice(0, 24)}}`;
      return String(c).slice(0, 24);
    }).join(" | ");
    console.log(`r${i + 1}: ${line}`);
  }
}
