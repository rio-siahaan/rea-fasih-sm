/**
 * diag-suspect.mjs — hitung assignment yang di-edit tapi di recordnya tidak ada
 * kunci biaya_produksi#N / operasional#N (template kios terpisah) → total_pengeluaran
 * kemungkinan salah makna. Keluaran: daftar + CSV.
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { computeChanges } from "./lib/bulk.mjs";
import { loadPlan } from "./lib/bulk.mjs";

const s = JSON.parse(readFileSync("./bulk-state.json", "utf8"));
const excelPath = "C:/Users/User/Downloads/Rio_rumus2 (1).xlsx";
const planf = loadPlan(excelPath);

const re = /biaya_produksi|operasional|total_pendapatan|total_upah|upah|pengeluaran/i;
const rows = [];
let berisiko = 0, baik = 0;
for (const [aid, info] of Object.entries(s.done)) {
  const cf = join("./bulk-cache", `${aid}.json`);
  if (!existsSync(cf)) continue;
  const cached = JSON.parse(readFileSync(cf, "utf8"));
  const dataJson = JSON.parse(cached.data);
  const keys = new Set((dataJson.answers || []).map((a) => String(a.dataKey)));
  const adaProd = [...keys].some((k) => /^biaya_produksi#/.test(k));
  const adaOp = [...keys].some((k) => /^operasional#/.test(k));
  // recompute plan yang dipakai saat apply (records setelah resolusi tak ikut, tapi kira-kira sama)
  const recs = planf.records.filter((r) => r.assignmentId.slice(0, 8) === aid.slice(0, 8));
  const preds = [];
  if (recs.length) {
    const cc = computeChanges(dataJson, recs.filter((r) => r.rowNo <= Math.max(...recs.map((x) => x.rowNo))));
    preds.push(...cc.plan.map((p) => ({ idx: p.idx, items: p.items.map((i) => i.base) })));
  }
  // yang benar-benar ditulis saat apply = state.done.fields > 0
  // (recompute post-guard tidak lagi menghasilkan item untuk kios terpisah)
  const ditulisN = info.fields || 0;
  const tanpaProdOp = ditulisN > 0 && (!adaProd || !adaOp);
  if (tanpaProdOp) berisiko++;
  else if (ditulisN > 0) baik++;
  rows.push({
    aid, adaProd, adaOp, ditulis: `jumlah-field=${ditulisN}`,
    berisiko: tanpaProdOp, baris: (info.rows || []).join(","),
  });
}
const sus = rows.filter((r) => r.berisiko);
console.log(`total di-edit: ${rows.length}`);
console.log(`ditulis dgn kunci biaya lengkap : ${baik}`);
console.log(`⚠ ditulis padahal record TANPA biaya_produksi/operasional: ${berisiko}`);
console.log("contoh 15:");
for (const r of sus.slice(0, 15)) console.log(`  ${r.aid} baris=${r.baris} ditulis=${r.ditulis}`);
writeFileSync("./bulk-suspect.json", JSON.stringify(sus, null, 1));
console.log("daftar lengkap: bulk-suspect.json");
process.exit(0);
