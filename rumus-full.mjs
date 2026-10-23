/** rumus-full.mjs — dump semua formula + nilai kolom rumus file */
import { readFileSync } from "node:fs";
import { readXlsx, xlsxValues } from "./lib/xlsx.mjs";

const read = readXlsx(readFileSync("C:/Users/User/Downloads/Rio_rumus2.xlsx"));
const sheets = read.sheets.Lembar1;
const g = (c) => (typeof c === "object" && c !== null ? c.v ?? "" : c ?? "");
const rows = sheets; // raw (dengan {f,v})
const header = rows[2].map((c) => g(c));
console.log("HEADER:", header.map((h, i) => `[${i}]${h}(${String.fromCharCode(65 + (i % 26))})`).join("\n"));

for (const rn of [4, 5, 7]) {
  const row = rows[rn - 1];
  console.log(`\n################## BARIS ${rn} — ${g(row[2])}`);
  row.forEach((c, j) => {
    if (c && typeof c === "object" && c.f) {
      console.log(`  [${j}] ${header[j]}: f='${c.f}' v=${g(c)}`);
    } else if (c !== undefined) {
      console.log(`  [${j}] ${header[j]}: ${c}`);
    }
  });
}
