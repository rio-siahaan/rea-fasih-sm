/** cmp-map.mjs — bandingkan nilai Excel baris-1 dengan data.json assignment fcfec28d */
import { readFileSync } from "node:fs";
import { readXlsx, xlsxValues } from "./lib/xlsx.mjs";

const pack = JSON.parse(readFileSync("./data-fcfec28d.json", "utf8"));
const dataJson = JSON.parse(pack.data); // stringified data.json di dalam paket
const answers = dataJson.answers;
console.log("total answers:", answers.length);
console.log("code_identity:", pack.code_identity);

const g = (c) => (typeof c === "object" && c !== null ? c.v ?? "" : c ?? "");
const rows = xlsxValues(readXlsx(readFileSync("C:/Users/User/Downloads/Cleaning Rio.xlsx"))).Sheet1;
const header = rows[2].map((c) => g(c));
const xr = rows[3];

console.log("\n== NILAI EXCEL (baris r4) ==");
[11, 12, 13, 14, 15, 16, 17, 18, 19, 20].forEach((j) =>
  console.log(`  ${header[j]} = ${g(xr[j])}`),
);

const re = /biaya|pendapatan|pengeluaran|nilai|omzet|aset|output|tenaga|upah|gaji/i;
console.log("\n== dataKey data.json yang cocok ==");
for (const a of answers) {
  const k = String(a.dataKey || "");
  if (re.test(k)) {
    let v = a.answer;
    if (v && typeof v === "object") v = JSON.stringify(v);
    console.log(`  ${k} = ${v}   [${String(a.description || "").slice(0, 50)}]`);
  }
}
