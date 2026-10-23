/**
 * diag-scan.mjs — cari assignment yang datanya bisa ketimpa (ada edit pihak lain
 * antara waktu cache dibuat dan waktu upload kita), lalu diff paket terakhir sebelum
 * upload kita vs cache. Menampilkan jumlah field yang "hilang" akibat overwrite.
 */
import { readFileSync, statSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { findFasihPage } from "./lib/cdp.mjs";
import { createFasihApi } from "./lib/api.mjs";
import { downloadPackage } from "./lib/flow.mjs";
import { readZip } from "./lib/zip.mjs";

const s = JSON.parse(readFileSync("./bulk-state.json", "utf8"));
const done = s.done;
const USERID = process.argv[2] || "7fbcbd6b-b3a4-41ee-bda2-bf05eed24757";

const page = await findFasihPage(9222);
const api = createFasihApi(page);

let dipindai = 0, tertimpa = 0;
for (const aid of Object.keys(done).slice(0, Number(process.argv[3] || 25))) {
  const cf = readdirSync("./bulk-cache").find((x) => x.startsWith(aid.slice(0, 8)) && x.endsWith(".json"));
  if (!cf) continue;
  const mt = statSync(join("./bulk-cache", cf)).mtime;
  const cached = JSON.parse(readFileSync(join("./bulk-cache", cf), "utf8"));
  const pre = JSON.parse(cached.data);
  const preKeys = new Map((pre.answers || []).map((a) => [String(a.dataKey), a]));

  let arr;
  try { arr = await api.history(aid); if (!Array.isArray(arr)) arr = arr.data || arr.content || []; }
  catch { continue; }
  const own = arr.find((h) => h.user_id === USERID && h.status_alias === "EDITED BY Admin Kabupaten");
  if (!own) continue;
  const ownT = new Date(own.date_created || own.created_at);
  // entri oleh LAIN antara cache dibuat dan upload kita, dengan file
  const berisiko = arr.filter((h) => h.user_id && h.user_id !== USERID && h.base_path &&
    new Date(h.created_at || h.date_created) > mt && new Date(h.created_at || h.date_created) < ownT);
  if (!berisiko.length) continue;

  dipindai++;
  // paket terakhir SEBELUM upload kita
  const before = [...arr].filter((h) => h.base_path && new Date(h.created_at || h.date_created) < ownT)
    .sort((a, b) => new Date(b.created_at || b.date_created) - new Date(a.created_at || a.date_created))[0];
  console.log(`\n⚠ ${aid.slice(0, 8)} — ada ${berisiko.length} edit lain antara cache(${mt.toISOString().slice(0, 16)}) & upload(${ownT.toISOString().slice(0, 16)})`);
  const fname = before.base_path.split("/").pop();
  console.log("   paket terakhir sebelum upload:", before.created_at || before.date_created, fname);
  const { buf } = await downloadPackage(api, aid, { filename: fname });
  if (!buf) { console.log("   unduh paket GAGAL (presign)"); continue; }
  const dz = readZip(buf).find((e) => e.name.toLowerCase() === "data.json");
  if (!dz) { console.log("   data.json tidak ada di paket :", readZip(buf).map((e) => e.name).join(",")); continue; }
  const post = JSON.parse(Buffer.from(dz.data).toString("utf8"));
  const postKeys = new Map((post.answers || []).map((a) => [String(a.dataKey), a]));
  const hilangK = [...preKeys.keys()].filter((k) => !postKeys.has(k));   // ada di cache(timpaan) tapi tidak di paket lama
  const hilangNilai = [];
  for (const [k, a] of postKeys) {
    const b = preKeys.get(k);
    if (b && JSON.stringify(a.answer) !== JSON.stringify(b.answer) && !/biaya_produksi|operasional|total_pengeluaran/.test(k))
      hilangNilai.push(`${k}: ${JSON.stringify(a.answer).slice(0, 30)} → ${JSON.stringify(b.answer).slice(0, 30)}`);
  }
  console.log(`   ⇢ yang tertimpa: kunci hilang=${hilangK.length}, nilai berubah=${hilangNilai.length}`);
  for (const x of [...hilangK.slice(0, 8).map((k) => "KEY " + k), ...hilangNilai.slice(0, 8)]) console.log("     -", x);
  if (hilangK.length || hilangNilai.length) tertimpa++;
}
console.log(`\n=== dipindai: ${dipindai} assignment berisiko; tertimpa (data beda): ${tertimpa}`);
process.exit(0);
