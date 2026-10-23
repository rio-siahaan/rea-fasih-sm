import { readFileSync, existsSync, readdirSync } from "node:fs";
import { loadPlan, computeChanges } from "./lib/bulk.mjs";

const p = loadPlan("yang tersisa rio.xlsx", { sheet: "Sheet2" });
console.log("mode:", p.mode, "| records:", p.totalRows);
// contoh 3 baris
for (const r of p.records.slice(0, 3)) {
  console.log(`r${r.rowNo} ${r.nama_usaha.slice(0, 28)} aid=${(r.assignmentId || "").slice(0, 8)} prod=${r.prod_baru} op=${r.op_baru} kat=${r.kategori_baru} kbli=${r.kode_kbli_baru} kom=${JSON.stringify(r.komentar)} tindak=${JSON.stringify(r.tindak)}`);
}
// distribusi beberapa field
const c = { prod: 0, op: 0, kat: 0, kbli: 0, kom: 0 };
for (const r of p.records) {
  c.prod += r.prod_baru != null ? 1 : 0;
  c.op += r.op_baru != null ? 1 : 0;
  c.kat += r.kategori_baru ? 1 : 0;
  c.kbli += r.kode_kbli_baru ? 1 : 0;
  c.kom += r.komentar ? 1 : 0;
}
console.log("terisi:", JSON.stringify(c));

// dry: coba 10 baris di data cache masing-masing (read-only)
let planN = 0, unN = 0, skN = 0, noCache = 0;
const sample = p.records.slice(0, 10);
for (const r of sample) {
  const aid = (r.assignmentId || "").slice(0, 8);
  const cf = readdirSync("bulk-cache").find((x) => x.startsWith(aid) && x.endsWith(".json"));
  if (!cf) { noCache++; continue; }
  const h = JSON.parse(readFileSync("bulk-cache/" + cf, "utf8"));
  const data = JSON.parse(h.data);
  const cc = computeChanges(data, [r], { mode: "baru" });
  const itemsN = cc.plan.reduce((n, x) => n + x.items.length, 0);
  planN += itemsN; unN += cc.unmatched.length; skN += cc.skipped.length;
  console.log(`r${r.rowNo} -> items=${itemsN} unmatch=${cc.unmatched.length} skip=${JSON.stringify(cc.skipped.map((s) => s.reason))} idx=${cc.plan.map((x) => x.idx)}`);
}
console.log(`\nTOTAL sampel10: items=${planN} unmatch=${unN} skip=${skN} tanpaCache=${noCache}`);
