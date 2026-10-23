/** cmp-final.mjs — tabel: 10 baris Excel vs field form tiap assignment */
import { readFileSync } from "node:fs";
import { readXlsx, xlsxValues } from "./lib/xlsx.mjs";

const g = (c) => (typeof c === "object" && c !== null ? c.v ?? "" : c ?? "");
const num = (c) => Number(g(c)) || 0;

const packs = {};
for (const id of ["fcfec28d", "0d0e1e37", "0d446760", "bd3871a1", "ae1d3950"]) {
  const p = JSON.parse(readFileSync(`./data-${id}.json`, "utf8"));
  const d = JSON.parse(p.data);
  packs[p.code_identity.split(" ")[0]] = { id: p._id, code: p.code_identity, d };
}

function* iter(file, sheetEl, headerRow) {
  const rows = xlsxValues(readXlsx(readFileSync(file)))[sheetEl];
  const header = rows[headerRow].map((c) => g(c));
  for (let i = headerRow + 1; i < rows.length; i++) {
    if (!g(rows[i][2]).trim()) continue;
    yield { r: i + 1, header, v: rows[i] };
  }
}

for (const [file, sheetEl, hr] of [
  ["C:/Users/User/Downloads/Cleaning Rio.xlsx", "Sheet1", 2],
  ["C:/Users/User/Downloads/Rio_rumus2.xlsx", "Lembar1", 2],
]) {
  for (const { r, header, v } of iter(file, sheetEl, hr)) {
    const code = String(g(v[2]));
    const kbliE = g(v[4]);
    console.log(`\n== [${r}] ${code} kbli_excel=${kbliE}`);
    const p = packs[code];
    if (!p) { console.log("  (tidak ada paket)"); continue; }
    const answers = p.d.answers;
    const byIdx = {};
    for (const a of answers) {
      const m = /^(.+?)#(\d+)$/.exec(String(a.dataKey || ""));
      if (m) (byIdx[m[2]] ??= {})[m[1]] = a.answer;
    }
    for (const [idx, o] of Object.entries(byIdx)) {
      if (Array.isArray(o.kbli_akhir)) o.kbli_akhir = o.kbli_akhir[0]?.value;
      if (typeof o.kbli_akhir !== "string") continue;
      const kb = String(o.kbli_akhir);
      console.log(`  -> ${p.id.slice(0,8)} ${p.code} | usaha#${idx}: kbli=${kb} gaji=${o.gaji} biaya_prod=${o.biaya_produksi} nilai_pend=${o.nilai_pendapatan} p_lain=${o.pendapatan_lain} total_pend=${o.total_pendapatan} aset=${o.total_aset_thn}`);
    }
    // kolom Excel yang relevan
    const col = (name) => { const j = header.findIndex((h) => String(h).startsWith(name)); return j >= 0 ? num(v[j]) : null; };
    console.log(`  excel: tenaga_kerja=${col("metrik_tenaga_kerja")} upah_gaji=${col("metrik_upah_gaji")} biaya_prod=${col("metrik_biaya_produksi")} pembelian=${col("metrik_biaya_pembelian")} operasional=${col("metrik_biaya_operasional")} non_op=${col("metrik_biaya_non")} pend_bj=${col("metrik_pendapatan_barang")} pend_lain=${col("metrik_pendapatan_lain")} nilai_tambah=${col("metrik_nilai_tambah")} aset=${col("metrik_total_aset")} output=${col("metrik_output")}`);
  }
}
