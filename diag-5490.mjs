/** diag-5490.mjs — nilai field upah/pengeluaran pra-edit (cache) vs sekarang (server) untuk 54906070 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { findFasihPage } from "./lib/cdp.mjs";
import { createFasihApi } from "./lib/api.mjs";

const aid = "54906070-7584-4458-b906-5f4ea895aded";
const cf = readdirSync("./bulk-cache").find((x) => x.startsWith("54906070"));
const cached = JSON.parse(readFileSync(join("./bulk-cache", cf), "utf8"));
const pre = JSON.parse(cached.data);

const page = await findFasihPage(9222);
const api = createFasihApi(page);
const re = /upah|pengeluaran|gaji|operasional|biaya|pendapatan|nilai_pendapatan|ntb|nilai_tambah/i;
const pick = (answers) => (answers || []).filter((a) => re.test(String(a.dataKey))).map((a) => ({
  k: a.dataKey, v: JSON.stringify(a.answer).slice(0, 40),
}));
const preRows = pick(pre.answers);
console.log(`pra-edit: ${preRows.length} field ekonomi`);
for (const r of preRows) console.log("   pra ", r.k.padEnd(28), "=", r.v);

let arr;
arr = await api.history(aid);
if (!Array.isArray(arr)) arr = arr.data || arr.content || [];
const own = arr.find((h) => h.status_alias === "EDITED BY Admin Kabupaten" && /2026-10-19/.test(h.date_created || ""));
console.log("\nentri нашей upload:", own && (own.date_created || own.created_at), own && String(own.base_path).split("/").pop());
const before = [...arr].filter((h) => h.base_path && (!own || new Date(h.created_at || h.date_created) < new Date(own.created_at || own.date_created)))
  .sort((a, b) => new Date(b.created_at || b.date_created) - new Date(a.created_at || a.date_created))[0];
console.log("paket sebelum upload kita:", before && (before.created_at || before.date_created), before && String(before.base_path).split("/").pop());

const now = await api.historyData(aid, String(own.base_path).split("/").pop());
const post = JSON.parse(now.data);
const postRows = pick(post.answers);
console.log(`\npasca-edit (server): ${postRows.length} field ekonomi`);
for (const r of postRows) console.log("   pasca", r.k.padEnd(28), "=", r.v);
process.exit(0);
