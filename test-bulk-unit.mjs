/** test-bulk-unit.mjs — uji computeChanges TANPA CDP: pakai data-0d0e1e37.json & data-0d446760.json */
import { readFileSync } from "node:fs";
import { loadPlan, computeChanges } from "./lib/bulk.mjs";

const planf = loadPlan("C:/Users/User/Downloads/Rio_rumus2 (1).xlsx");
console.log("records:", planf.totalRows, "groups:", planf.groups.size);

const tests = [
  ["0d0e1e37-09ec-44b8-92ac-d6b94309d604", "r5 (expect PROD 750000→486000)"],
  ["0d446760-7bfa-4f06-8408-a0c634b62e11", "r7 (expect PROD 10000→110000, OP 250000→110000)"],
];
for (const [id, desc] of tests) {
  const recs = planf.groups.get(id);
  if (!recs) { console.log(id.slice(0, 8), "TIDAK ADA DI EXCEL"); continue; }
  const pack = JSON.parse(readFileSync(`./data-${id.slice(0, 8)}.json`, "utf8"));
  const dataJson = JSON.parse(pack.data);
  const cc = computeChanges(dataJson, recs);
  console.log(`\n==== ${id.slice(0, 8)} — ${desc}`);
  console.log("  plan:", JSON.stringify(cc.plan.map((p) => ({
    rowNo: p.rec.rowNo, nama: p.blockName, idx: p.idx, items: p.items,
    before: p.before, after: p.after,
  })), null, 1));
  if (cc.unmatched.length) console.log("  UNMATCHED:", cc.unmatched.map((u) => `${u.rowNo}:${u.nama_usaha}`).join(" | "));
  if (cc.skipped.length) console.log("  SKIPPED:", cc.skipped.map((s) => `${s.rec.rowNo}:${s.reason}`).join(" | "));
}
