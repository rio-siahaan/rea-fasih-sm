/**
 * diag-loss2.mjs — untuk 1 assignment di-edit: bandingkan metadata record
 * (template versi, pre_defined_data, data1..10, comment) pra-edit (cache) vs sekarang (server).
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { findFasihPage } from "./lib/cdp.mjs";
import { createFasihApi } from "./lib/api.mjs";

const stateFile = JSON.parse(readFileSync("./bulk-state.json", "utf8"));
const aid = process.argv[2] || Object.keys(stateFile.done)[0];

const cf = readdirSync("./bulk-cache").find((x) => x.startsWith(aid.slice(0, 8)) && x.endsWith(".json"));
const cached = JSON.parse(readFileSync(join("./bulk-cache", cf), "utf8"));

const page = await findFasihPage(9222);
const api = createFasihApi(page);
const now = await api.getAssignment(aid);

const fields = [
  "pre_defined_data", "data", "template_file_id", "template_id", "template_version",
  "validation_version", "templateVersion", "validationVersion", "mode", "comment",
  "sum_remark", "sum_error", "sum_clean", "assignment_status_id", "assignment_status_alias",
];
console.log("=== pra (cache) vs sekarang (server) ===");
for (const f of fields) {
  const a = cached[f], b = now[f];
  const sa = a == null ? "null" : String(a).slice(0, 90);
  const sb = b == null ? "null" : String(b).slice(0, 90);
  const eq = JSON.stringify(a) === JSON.stringify(b) || (typeof a === "string" && typeof b === "string" && a === b);
  console.log(`${f.padEnd(26)} ${eq ? "sama" : "BEDA!"}  |  pra: ${sa}`);
  if (!eq) console.log(`${"".padEnd(26)} | pasca: ${sb}`);
}
// semua kunci record yang berubah
const changed = [];
for (const k of new Set([...Object.keys(cached), ...Object.keys(now)])) {
  if (["data", "history", "updatedAt"].includes(k)) continue;
  const sa = JSON.stringify(cached[k] ?? null), sb = JSON.stringify(now[k] ?? null);
  if (sa !== sb) changed.push(k);
}
console.log("\nsemua field record yang BEDA:", changed.join(", ") || "(tidak ada)");
process.exit(0);
