/**
 * diag-timeline.mjs — riwayat paket per assignment + waktu cache dibuat.
 * Tujuan: apakah ada paket di server lebih BARU dari cache kita (data bisa ketimpa lama)?
 */
import { readFileSync, statSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { findFasihPage } from "./lib/cdp.mjs";
import { createFasihApi } from "./lib/api.mjs";

const s = JSON.parse(readFileSync("./bulk-state.json", "utf8"));
const ids = Object.keys(s.done);
const aid = process.argv[2] || ids[0];
console.log(`===== ${aid} =====`);

const page = await findFasihPage(9222);
const api = createFasihApi(page);

const withIds = process.argv[2] ? [aid] : ids.slice(0, 6);
for (const aid of withIds) {
  console.log(`\n===== ${aid} =====`);
  const cf = readdirSync("./bulk-cache").find((x) => x.startsWith(aid.slice(0, 8)) && x.endsWith(".json"));
  const mt = statSync(join("./bulk-cache", cf)).mtime.toISOString();
  console.log("cache dibuat:", mt);
  const hist = await api.history(aid);
  const arr = Array.isArray(hist) ? hist : (hist.data || hist.content || []);
  console.log("jumlah entri:", arr.length);
  for (const h of [...arr].sort((a, b) => new Date(b.created_at || b.date_created) - new Date(a.created_at || a.date_created)).slice(0, 6)) {
    console.log(`  ${h.created_at || h.date_created}  ${String(h.base_path || "").split("/").pop() || "(tanpa file)"}  oleh=${h.username || h.user_id}  status=${h.status_alias || ""}`);
  }
}
process.exit(0);
