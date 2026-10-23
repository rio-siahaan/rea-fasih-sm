import { readFileSync, readdirSync } from "node:fs";
import { computeChanges, applyPlan } from "./lib/bulk.mjs";

const f = readdirSync("bulk-cache").find((x) => x.startsWith("004c8307"));
const h = JSON.parse(readFileSync("bulk-cache/" + f, "utf8"));
const data = JSON.parse(h.data);
console.log("blok #3001 punya biaya_produksi?", !!data.answers.find((a) => a.dataKey === "biaya_produksi#3001"));
const nu = data.answers.find((a) => a.dataKey === "nama_usaha#3001");
const nama = String(Array.isArray(nu?.answer) ? nu.answer[0]?.label ?? "" : nu?.answer ?? "").trim();
console.log("nama blok:", JSON.stringify(nama));

const recs = [{
  rowNo: 2, nama_usaha: nama,
  pembelian_baru: 5000, prod_baru: 3000, op_baru: 2000,
  pendapatan_baru: 40000, pendapatan_lain_baru: 1000,
  kategori_baru: "G", kode_kbli_baru: "47112", komentar: "#P1 uji",
}];
const cc = computeChanges(data, recs, { mode: "baru" });
console.log("unmatched:", cc.unmatched.length, "skipped:", JSON.stringify(cc.skipped.map((s) => s.reason)));
for (const p of cc.plan) {
  console.log("idx", p.idx, "items:", JSON.stringify(p.items));
  console.log("keys:", JSON.stringify(p.keys), "comText:", JSON.stringify(p.comText));
}
const wr = cc.plan.reduce((n, p) => n + applyPlan(data, p), 0);
console.log("applyPlan total:", wr);
console.log("nilai pasca-apply #3001:");
for (const k of ["biaya_pembelian", "biaya_produksi", "operasional", "nilai_pendapatan", "pendapatan_lain", "total_pengeluaran", "kategori", "kbli_akhir"])
  console.log(" ", k + "#3001 =", JSON.stringify(data.answers.find((a) => a.dataKey === k + "#3001")?.answer));
