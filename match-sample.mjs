/** match-sample.mjs — cari baris Cleaning untuk codeIdentity tertentu + tampilkan full baris + link */
import { readFileSync } from "node:fs";
import { readXlsx, xlsxValues } from "./lib/xlsx.mjs";

const read = readXlsx(readFileSync("C:/Users/User/Downloads/Cleaning Rio.xlsx"));
const rows = xlsxValues(read).Sheet1;
const header = rows[2].map((c) => (typeof c === "object" ? c.v : c));
console.log("HEADER:", header.map((h, i) => `[${i}]${h}`).join(" "));

const want = String(process.argv[2] || "5309010010001000");
let found = 0;
for (let i = 3; i < rows.length; i++) {
  const code = String(rows[i][2]?.v ?? rows[i][2] ?? "");
  if (code.includes(want)) {
    console.log(`\nBARIS r${i + 1}:`);
    header.forEach((h, j) => {
      const v = rows[i][j];
      const val = v && typeof v === "object" ? `${v.v}${v.f ? " {" + v.f + "}" : ""}` : v;
      console.log(`  ${h} = ${val}`);
    });
    found++;
  }
}
console.log(`\nditemukan: ${found} baris dengan kode ${want}`);
