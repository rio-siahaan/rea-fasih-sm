/** full2.mjs — statistik file penuh: baris, status, cek_rasio, baris per link, flag */
import { readFileSync } from "node:fs";
import { readXlsx, xlsxValues } from "./lib/xlsx.mjs";

const read = readXlsx(readFileSync("C:/Users/User/Downloads/Rio_rumus2 (1).xlsx"));
const rows = read.sheets.Lembar1;
const g = (c) => (typeof c === "object" && c !== null ? c.v ?? "" : c ?? "");
// formula cells muncul sebagai {f,v}
const header = ["kategori","kode_kbli","nama_usaha","Produk","keg","biaya_prod","pembelian","operasional","non_op","total_pendapatan?","pend_bj","pdd_lain","ntb","aset","output","rasio_beli","rasio_ntb","link","ntb_awal","output_cek","rasio_awal","status","ntb_baru","selisih","op_baru","prod_baru","ntb_cek","rasio_baru","cek","flag"];
// index 0..29
let dataRows = 0;
const stat = { status: {}, cek: {}, flag: {}, kategori: {} };
const linkCount = {};
let links = 0, withoutLink = 0, flagCek = 0;
for (let i = 3; i < rows.length; i++) {
  const r = rows[i];
  const link = g(r[17]);
  if (!g(r[2]).trim() && !link) continue;
  dataRows++;
  const lh = linkCount[link];
  if (lh === undefined) { linkCount[link] = 1; links++; }
  else { linkCount[link]++; if (lh === 1) {} }
  if (!link) withoutLink++;
  stat.status[g(r[21])] = (stat.status[g(r[21])] || 0) + 1;
  stat.cek[g(r[28])] = (stat.cek[g(r[28])] || 0) + 1;
  const fl = g(r[29]);
  if (fl === "Cek") flagCek++;
  stat.kategori[g(r[0])] = (stat.kategori[g(r[0])] || 0) + 1;
}
console.log("baris data:", dataRows, "| link unik:", links, "| baris tanpa link:", withoutLink, "| flag Cek:", flagCek);
const multi = Object.entries(linkCount).filter(([, n]) => n > 1);
console.log("link dengan >1 baris (assignment multi-usaha):", multi.length);
for (const [l, n] of multi.slice(0, 8)) console.log("  ", (l.match(/[0-9a-f]{8}$/)?.[0] || l.slice(-8)), "x" + n);
console.log("status_rasio:", JSON.stringify(stat.status));
console.log("cek_rasio:", JSON.stringify(stat.cek));
console.log("kategori:", JSON.stringify(stat.kategori));
// contoh multi-usaha
if (multi.length) {
  const l0 = multi[0][0];
  console.log("\ncontoh multi-usaha:", l0.slice(-12));
  for (let i = 3; i < rows.length; i++) if (g(rows[i][17]) === l0) console.log("  r" + (i + 1), "|", String(g(rows[i][2])).slice(0, 40), "| status:", g(rows[i][21]), "| W:", g(rows[i][22]), "Z:", g(rows[i][25]), "Y:", g(rows[i][24]));
}
