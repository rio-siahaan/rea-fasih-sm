/** dump-top-rows.mjs — lihat isi baris 1..4 Excel (mencari "catatan #4" user) */
import { readFileSync } from "node:fs";
import { readXlsx } from "./lib/xlsx.mjs";

const buf = readFileSync("C:/Users/User/Downloads/Rio_rumus2 (1).xlsx");
const { sheets } = readXlsx(buf);
const name = Object.keys(sheets)[0];
const rows = sheets[name].rows || sheets[name].data || sheets[name];
for (let i = 0; i < 4 && i < rows.length; i++) {
  const r = rows[i];
  const cells = [];
  if (Array.isArray(r)) {
    for (let c = 0; c < (r.length || 0); c++) if (r[c] != null && String(r[c]).trim() !== "") cells.push(`col${c + 1}="${String(r[c]).slice(0, 60)}"`);
  } else {
    for (const [k, v] of Object.entries(r)) if (v != null && String(v).trim() !== "") cells.push(`${k}="${String(v).slice(0, 60)}"`);
  }
  console.log(`baris ${i + 1}:`, cells.join(" | ") || "(kosong)");
}
process.exit(0);
