/** verify-komentar.mjs — cek komentar record setelah bulk-komentar */
import { findFasihPage } from "./lib/cdp.mjs";
import { createFasihApi } from "./lib/api.mjs";
import { readFileSync } from "node:fs";

const state = JSON.parse(readFileSync("./bulk-komentar.json", "utf8"));
const ids = Object.keys(state.ok).concat(Object.keys(state.fail || {}));
for (const aid of ids.slice(0, process.argv[2] ? Number(process.argv[2]) : 3)) {
  const page = await findFasihPage(9222);
  const api = createFasihApi(page);
  const r = await api.getAssignment(aid);
  let c;
  try { c = JSON.parse(r.comment); } catch { c = { notes: [] }; }
  console.log(`\n${aid.slice(0, 8)} status: ${r.assignment_status_alias}`);
  for (const n of (c.notes || []).slice(0, 8)) {
    const koms = (n.comments || []).map((x) => `"${x.comment}"(${x.sender})`).join(",");
    console.log(`  ${n.dataKey}: ${koms}`);
  }
  // pastikan nilai field tetap
  const d = JSON.parse(r.data);
  for (const k of ["biaya_produksi#1", "operasional#1", "total_pengeluaran#1"]) {
    const a = (d.answers || []).find((x) => x.dataKey === k);
    console.log(`  nilai ${k} = ${JSON.stringify(a ? a.answer : "TIDAK ADA")}`);
  }
}
process.exit(0);
