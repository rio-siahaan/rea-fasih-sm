/** cmp-usaha.mjs — utk tiap paket: jumlah usaha + nilai field ekonomi, lalu cari cocok angka di Excel */
import { readFileSync } from "node:fs";
import { readXlsx, xlsxValues } from "./lib/xlsx.mjs";

const ids = ["fcfec28d", "0d0e1e37", "0d446760", "bd3871a1", "ae1d3950"];

// excel rows (kedua file)
const g = (c) => (typeof c === "object" && c !== null ? c.v ?? "" : c ?? "");
const excel = [];
{
  const rows = xlsxValues(readXlsx(readFileSync("C:/Users/User/Downloads/Cleaning Rio.xlsx"))).Sheet1;
  const header = rows[2].map((c) => g(c));
  for (let i = 3; i < rows.length; i++) {
    if (!g(rows[i][2]).trim()) continue;
    excel.push({ file: "clean", code: g(rows[i][2]), header, vals: rows[i].map((c) => Number(g(c)) || 0) });
  }
}
{
  const rows = xlsxValues(readXlsx(readFileSync("C:/Users/User/Downloads/Rio_rumus2.xlsx"))).Lembar1;
  const header = rows[2].map((c) => g(c));
  for (let i = 3; i < rows.length; i++) {
    if (!g(rows[i][2]).trim()) continue;
    excel.push({ file: "rumus", code: g(rows[i][2]), header, vals: rows[i].map((c) => Number(g(c)) || 0) });
  }
}
console.log("excel rows:", excel.length);

for (const id of ids) {
  const pack = JSON.parse(readFileSync(`./data-${id}.json`, "utf8"));
  const dataJson = JSON.parse(pack.data);
  const answers = dataJson.answers;
  const get = (k) => answers.find((a) => a.dataKey === k)?.answer;
  const ju = get("jumlah_usaha") ?? get("jumlah_usaha_ditemukan");
  console.log(`\n=== ${id} | ${pack.code_identity} | jumlah_usaha=${JSON.stringify(ju)}`);
  // nilai ekonomi per #N
  const byIdx = {};
  for (const a of answers) {
    const m = /^(.+?)#(\d+)$/.exec(String(a.dataKey || ""));
    if (m && /biaya_produksi|nilai_pendapatan|pendapatan_lain|total_pendapatan|gaji|kbli_akhir|aset_usaha_thn|aset_lain_thn|total_aset_thn/.test(m[1])) {
      (byIdx[m[2]] ??= {})[m[1]] = a.answer;
    }
  }
  for (const [idx, o] of Object.entries(byIdx)) {
    console.log(`  #${idx}: ` + JSON.stringify(o));
  }
}
