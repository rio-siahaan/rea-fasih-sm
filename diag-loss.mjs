/**
 * diag-loss.mjs — bandingkan jawaban data.json sebelum edit (cache) vs di server sekarang,
 * untuk beberapa assignment yang sudah di-edit. Tujuan: cari kenapa field seperti umur hilang.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { findFasihPage } from "./lib/cdp.mjs";
import { createFasihApi } from "./lib/api.mjs";

const aid0 = process.argv[2] || null;
const state = JSON.parse(readFileSync("./bulk-state.json", "utf8"));
const doneIds = Object.keys(state.done || {});
if (!doneIds.length) {
  console.log("bulk-state.json belum punya hasil apply. done=0");
  process.exit(0);
}
console.log("sudah di-edit (server):", doneIds.length, "assignment");
console.log("contoh:", doneIds.slice(0, 5).map((x) => x.slice(0, 8)).join(", "));

const page = await findFasihPage(9222);
const api = createFasihApi(page);

const targets = (aid0 ? [aid0] : doneIds.slice(0, 3));
for (const aid of targets) {
  console.log(`\n=========== ${aid.slice(0, 8)} ===========`);
  // data prae edit dari cache
  const cf = readdirSync("./bulk-cache").find((x) => x.startsWith(aid.slice(0, 8)) && x.endsWith(".json"));
  if (!cf) { console.log("cache pra-edit tidak ada"); continue; }
  const cached = JSON.parse(readFileSync(join("./bulk-cache", cf), "utf8"));
  const pre = JSON.parse(cached.data);
  const preKeys = new Map((pre.answers || []).map((a) => [String(a.dataKey), a]));

  // data di server sekarang — butuh filename paket terbaru dari riwayat
  const { latestZipFilename } = await import("./lib/flow.mjs");
  let fname = null;
  try {
    const hist = await api.history(aid);
    fname = latestZipFilename(hist.data ?? hist);
  } catch (e) { console.log("history gagal:", e.message); }
  console.log("file paket terakhir di server:", fname);
  const now = await api.historyData(aid, fname).catch((e) => { console.log("historyData gagal:", e.message); return null; });
  if (!now) continue;
  const post = JSON.parse(now.data);
  const postKeys = new Map((post.answers || []).map((a) => [String(a.dataKey), a]));

  console.log(`answers  pra=${preKeys.size}  pasca=${postKeys.size}`);
  const ukuran = (m) => [...m.keys()].filter((k) => /umur|nik|nama_usaha|pendapatan|pengeluaran|kbli/i.test(k));
  console.log("contoh kunci umur/nik pra : [", ukuran(preKeys).slice(0, 8).join(", "), "]");
  console.log("contoh kunci umur/nik pasca: [", ukuran(postKeys).slice(0, 8).join(", "), "]");

  // kunci yang hilang di pasca (ada pra, tidak pasca)
  const hilang = [...preKeys.keys()].filter((k) => !postKeys.has(k));
  const baru = [...postKeys.keys()].filter((k) => !preKeys.has(k));
  console.log("kunci HILANG:", hilang.length, hilang.slice(0, 12).join(", "));
  console.log("kunci BARU  :", baru.length, baru.slice(0, 12).join(", "));

  // nilai berubah selain 3 field yang memang ditulis?
  const diubah = [];
  for (const [k, a] of preKeys) {
    const b = postKeys.get(k);
    if (!b) continue;
    const pa = JSON.stringify(a.answer), pb = JSON.stringify(b.answer);
    if (pa !== pb && !/biaya_produksi|operasional|total_pengeluaran/.test(k))
      diubah.push(`${k}: ${String(pa).slice(0, 24)} → ${String(pb).slice(0, 24)}`);
  }
  console.log("nilai BERUBAH di luar 3 field:", diubah.length);
  for (const d of diubah.slice(0, 10)) console.log("  ", d);

  // data sama persis dengan yang kita upload? templateVersion?
  console.log("templateVersion pra :", pre.templateVersion, "| pasca:", post.templateVersion);
  console.log("validationVersion pra:", pre.validationVersion, "| pasca:", post.validationVersion);
}
process.exit(0);
