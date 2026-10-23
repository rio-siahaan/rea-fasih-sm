#!/usr/bin/env node
/**
 * diag-unmatched.mjs — READ-ONLY diagnosis untuk baris bulk yang TIDAK tertulis:
 *   - "unmatched" (nama_usaha tidak ketemu di data.json link Excel)            → bulk-plan.json
 *   - "no-field"  (match, tapi biaya_produksi/operasional#idx tidak ada)       → bulk-plan.json
 *
 * Untuk tiap baris: ambil data assignment link (cache bila ada), tarik daftar
 * assignment kandidat satu rumah tangga (principalValues by code_identity),
 * lalu cari blok `nama_usaha#N` yang punya kunci biaya — dengan skor mirip nama.
 *
 * Verdict per baris:
 *   MOVED    → ketemu di assignment kandidat LAIN  ({rowNo, to, idx})
 *   REINDEX  → ketemu di assignment yang sama, blok idx lain yang berisi field biaya
 *   NONE     → tidak ketemu (sisa manual)
 *
 * Keluaran: daftar pindaian di console + file `bulk-map.json` (dipakai
 * `--map bulk-map.json` pada eksekusi penulisan berikutnya).
 *
 * Jalankan:
 *   node diag-unmatched.mjs [--limit N] [--delay-ms N] [--net]           (mode plan-bulk lama)
 *   node diag-unmatched.mjs --excel <file.xlsx> --sheet <nama> [--out peta.json]
 *        → target = baris Excel itu sendiri; kandidat dari bulk-cache (tanpa Chrome);
 *          --net tambahkan pencarian principalValues & data dari server.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createPool } from "./lib/pool.mjs";
import { latestZipFilename } from "./lib/flow.mjs";

const EXCEL_DEFAULT = "C:/Users/User/Downloads/Rio_rumus2 (1).xlsx";
const PLAN_FILE = "./bulk-plan.json";
const DELAY_MS = Number(process.env.DELAY_MS || 800);

const norm = (s) =>
  String(s || "").toUpperCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** buang artefak <…> / (pemilik) untuk perbandingan */
const core = (s) =>
  norm(String(s || "").replace(/[<>]/g, " ").replace(/\([^)]*\)/g, " "));

const ownerOf = (s) => {
  const ms = String(s || "").match(/\(([^)]+)\)/g) || [];
  return norm(ms[ms.length - 1] || "");
};

function score(A, B) {
  if (!A || !B) return 0;
  let s = 0;
  const cA = core(A), cB = core(B);
  if (cA === cB) s = 100;
  else if (cA.includes(cB) || cB.includes(cA)) s = 70;
  const oA = ownerOf(A), oB = ownerOf(B);
  if (oA && oB && oA === oB) s = Math.max(s, 60);
  if (!s) {
    const aw = cA.split(" ").filter((w) => w.length > 3);
    const bw = new Set(cB.split(" "));
    const hc = aw.filter((w) => bw.has(w)).length;
    if (hc >= 2) s = 20 + hc * 5;
  }
  return s;
}

// ---------------------------------------------------------------- muat input
if (!existsSync(PLAN_FILE)) {
  console.error(`bulk-plan.json tidak ada — jalankan bulk-edit --dry dulu`);
  process.exit(1);
}
const plan = JSON.parse(readFileSync(PLAN_FILE, "utf8"));
const state = existsSync("./bulk-state.json")
  ? JSON.parse(readFileSync("./bulk-state.json", "utf8"))
  : { done: {}, fail: {} };

// baris yang SUDAH tertulis (state.done.rows) → bukan target diagnosis
const written = new Set();
for (const info of Object.values(state.done || {})) {
  for (const r of info.rows || []) written.add(r);
}

// ------------------------------------------------ opsi CLI (--kunci [nilai])
const O = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith("--")) {
    const k = a.slice(2);
    if (process.argv[i + 1] && !String(process.argv[i + 1]).startsWith("--")) { O[k] = process.argv[i + 1]; i++; }
    else O[k] = true;
  }
}

// kolom nama_usaha per baris Excel (untuk nama baku yang dipakai matching)
const { loadPlan } = await import("./lib/bulk.mjs");
// MODE EXCEL: target = baris file Excel itu sendiri (--excel, --sheet) —
// env berpeta ringan; yang TULIS di sekolah sudah ini, rowNO cocok 1:1 dengan
// Excel dipakai bulk-repair --map nantinya.
const EXCEL_SRC = O.excel || null;
const planExcel = loadPlan(EXCEL_SRC || EXCEL_DEFAULT, O.sheet ? { sheet: O.sheet } : {});
const excelRows = new Map();
for (const r of planExcel.records) excelRows.set(r.rowNo, r);
const OUT_FILE = O.out || (EXCEL_SRC ? "bulk-map-s2.json" : "bulk-map.json");

const blocksOf = (dataJson) => {
  const blocks = [];
  const keySet = new Set((dataJson.answers || []).map((a) => String(a.dataKey)));
  for (const a of dataJson.answers || []) {
    const m = /^nama_usaha#(\d+)$/.exec(String(a.dataKey || ""));
    if (!m) continue;
    let v = a.answer;
    if (Array.isArray(v)) v = v[0];
    const nama = String(v?.label ?? v?.value ?? v ?? "").trim();
    const idx = m[1];
    // kapasitas tulis per-blok — mode excel menilai per-kolom, mode lama rumus setengah kunci
    const hasProd = keySet.has(`biaya_produksi#${idx}`);
    const hasOp = keySet.has(`operasional#${idx}`);
    const hasPem = keySet.has(`biaya_pembelian#${idx}`);
    const hasNilai = keySet.has(`nilai_pendapatan#${idx}`);
    const hasLain = keySet.has(`pendapatan_lain#${idx}`);
    const hasKat = keySet.has(`kategori#${idx}`) || keySet.has(`kategori_2025#${idx}`);
    const hasKbli =
      keySet.has(`kbli_akhir#${idx}`) || keySet.has(`kbli#${idx}`) || keySet.has(`kbli_prelist#${idx}`);
    blocks.push({
      idx,
      nama,
      hasBiaya: hasProd && hasOp, // rumus lama butuh keduanya (total_pengeluaran)
      hasProd, hasOp, hasPem, hasNilai, hasLain, hasKat, hasKbli,
      cap: (hasProd ? 1 : 0) + (hasOp ? 1 : 0) + (hasPem ? 1 : 0) + (hasNilai ? 1 : 0) +
           (hasLain ? 1 : 0) + (hasKat ? 1 : 0) + (hasKbli ? 1 : 0),
    });
  }
  return blocks;
};

// ---------------------------------------------------------------- pool & API
const cfg = existsSync("./config.json") ? JSON.parse(readFileSync("./config.json", "utf8")) : {};
// pool LAZY: mode cache murni (--excel tanpa --net) tidak butuh Chrome aktif
let pool = null;
const getPool = async () => {
  if (!pool) {
    pool = await createPool({ cfg });
    console.log("Pool:", pool.labels());
  }
  return pool;
};
const withRetry = (fn, label, o = {}) => getPool().then((p) => p.withRetry(fn, label, o));

/** data dataJson satu assignment: cache dulu; fetch jaring hanya dengan --net */
const dataCache = new Map(); // aid → {dataJson, from: "cache"|"server"}
const NETG = process.argv.includes("--net");
async function dataOf(aid) {
  if (dataCache.has(aid)) return dataCache.get(aid);
  const cf = readdirSync("./bulk-cache").find((x) => x.startsWith(aid.slice(0, 8)) && x.endsWith(".json"));
  if (cf) {
    try {
      const hdata = JSON.parse(readFileSync(join("./bulk-cache", cf), "utf8"));
      const dataJson = JSON.parse(hdata.data);
      const out = { dataJson, from: "cache" };
      dataCache.set(aid, out);
      return out;
    } catch { }
  }
  if (!NETG) { dataCache.set(aid, null); return null; }
  const hist = await withRetry((ac) => ac.api.history(aid), `hist ${aid.slice(0, 8)}`).catch(() => null);
  const list = Array.isArray(hist) ? hist : (hist?.data || hist?.content || []);
  const fname = latestZipFilename(list || []);
  if (!fname) { dataCache.set(aid, null); return null; }
  const hd = await withRetry((ac) => ac.api.historyData(aid, fname), `data ${aid.slice(0, 8)}`);
  const dataJson = JSON.parse(hd.data);
  const out = { dataJson, from: "server" };
  dataCache.set(aid, out);
  return out;
}

// code_identity per assignment-link dari cache
const codeOf = (aid) => {
  const cf = readdirSync("./bulk-cache").find((x) => x.startsWith(aid.slice(0, 8)) && x.endsWith(".json"));
  if (!cf) return null;
  try {
    const hdata = JSON.parse(readFileSync(join("./bulk-cache", cf), "utf8"));
    return String(hdata.code_identity || "").split(/\s+-\s+/)[0].trim();
  } catch { return null; }
};

// indeks identitas LOKAL dari cache: kode16 → daftar assignment (dgn data1) —
// melayani mayoritas kandidat rumah tangga TANPA panggilan principalValues
const idIndex = new Map();
let idIndexN = 0;
try {
  for (const f of readdirSync("./bulk-cache")) {
    if (!f.endsWith(".json")) continue;
    try {
      const hdata = JSON.parse(readFileSync(join("./bulk-cache", f), "utf8"));
      const code = String(hdata.code_identity || "").split(/\s+-\s+/)[0].trim();
      if (!/^\d{16}$/.test(code)) continue;
      if (!idIndex.has(code)) idIndex.set(code, []);
      idIndex.get(code).push({ aid: f.slice(0, 36), data1: String(hdata.data1 || "") });
      idIndexN++;
    } catch { }
  }
} catch { }
console.log(`indeks cache: ${idIndex.size} kode identitas (${idIndexN} assignment) — cache-first ✓`);


// ---------------------------------------------------------------- kumpulkan baris target
const targets = [];
if (EXCEL_SRC) {
  console.log(`MODE EXCEL: sumber baris = ${EXCEL_SRC}${O.sheet ? " [" + O.sheet + "]" : ""} — ${planExcel.mode}`);
  for (const r of planExcel.records) {
    targets.push({ rowNo: r.rowNo, nama: r.nama_usaha, from: r.assignmentId, kind: "excel", idx: null });
  }
} else {
  for (const a of plan.assignments || []) {
    for (const u of a.unmatched || []) {
      if (written.has(u.rowNo)) continue;
      targets.push({ rowNo: u.rowNo, nama: u.nama, from: a.assignmentId, kind: "unmatched", idx: null });
    }
    for (const p of a.planEntries || []) {
      if (!p.noFields || written.has(p.rowNo)) continue;
      targets.push({ rowNo: p.rowNo, nama: p.nama_usaha, from: a.assignmentId, kind: "no-field", idx: String(p.idx) });
    }
  }
}
const limit = O.limit ? Number(O.limit) : (process.env.LIMIT ? Number(process.env.LIMIT) : Infinity);
const work = targets.slice(0, limit === Infinity ? targets.length : limit);
console.log(`Target diagnosis: ${work.length} baris (dari ${targets.length}) — sela baris ${DELAY_MS} ms (hanya utk rute jaring)\n`);

// ---------------------------------------------------------------- proses
const codeCache = new Map();
const moved = [], reindex = [], unresolved = [], selfOk = [];
const workPrev = new Set();
let prevMap = null, skipDone = 0;
// --only-none: lanjutkan dari peta yang sudah ada — MOVED/REINDEX lama dipertahankan,
// hanya baris selain MOVED/REINDEX yang dicoba ulang (pass --net).
if (O["only-none"] && existsSync(OUT_FILE)) {
  try {
    prevMap = JSON.parse(readFileSync(OUT_FILE, "utf8"));
    for (const x of [...(prevMap.moved || []), ...(prevMap.reindex || [])]) workPrev.add(x.rowNo);
    moved.push(...(prevMap.moved || []));
    reindex.push(...(prevMap.reindex || []));
    unresolved.push(...(prevMap.unresolved || []));
  } catch { }
}

for (let i = 0; i < work.length; i++) {
  const t = work[i];
  if (workPrev.has(t.rowNo)) { skipDone++; continue; }
  process.stdout.write(`diag ${i - skipDone + 1}/${work.length - skipDone} r${t.rowNo} ${String(t.nama).slice(0, 30)}          \r`);
  const excelName = excelRows.get(t.rowNo)?.nama_usaha || t.nama;
  const A = norm(excelName);

  // kandidat: assignment-link sendiri + semua assignment satu code_identity —
  // cache-first; dengan --net: gabung kandidat cache + principalValues server
  const NET = process.argv.includes("--net");
  const code = codeOf(t.from);
  let cands = [{ aid: t.from, data1: "" }];
  let usedNet = false;
  if (code && /^\d{16}$/.test(code)) {
    if (idIndex.has(code) && !NET) {
      cands = idIndex.get(code).slice();
      if (!cands.some((c) => c.aid === t.from)) cands.push({ aid: t.from, data1: "" });
    } else if (NET) {
      usedNet = true;
      if (!codeCache.has(code)) {
        codeCache.set(code, await withRetry((ac) => ac.api.principalValues(cfg.periodId, code), `principal ${code}`)
          .then((r) => (Array.isArray(r) ? r : r?.data || []))
          .catch(() => []));
      }
      // gabung: cache (punya data1) + server (sibling yang tidak dikenal cache)
      const byId = new Map();
      for (const c of idIndex.get(code) || []) byId.set(c.aid, c);
      for (const c of (codeCache.get(code) || [])) {
        const aid2 = c.assignmentId || c.aid;
        if (!byId.has(aid2)) byId.set(aid2, { aid: aid2, data1: String(c.data1 || "") });
      }
      cands = [...byId.values()];
      if (!cands.some((c) => c.aid === t.from)) cands.push({ aid: t.from, data1: "" });
    }
  }

  // telusuri kandidat: blok nama_usaha#N dengan skor & punya kapasitas tulis
  // TAHAP 1 — skor dari data1 (nama usaha/rumah tangga) yang datang BESAMA
  // principalValues: tarik paket hanya untuk kandidat terbaik (hemat 429)
  let best = null;
  let gotData = 0;
  const d1 = cands
    .map((c) => ({ c, s1: score(A, c.data1) }))
    .filter((x) => x.s1 >= 40)
    .sort((a, b) => b.s1 - a.s1)
    .slice(0, 5)
    .map((x) => x.c);
  const fetchTargets = d1.length ? d1 : cands;
  for (const c of fetchTargets) {
    const info = await dataOf(c.aid).catch(() => null);
    if (!info || !info.dataJson) continue;
    gotData++;
    const blocks = blocksOf(info.dataJson);
    for (const b of blocks) {
      const qualify = EXCEL_SRC ? b.cap > 0 : b.hasBiaya;
      if (!qualify) continue;
      const s = score(A, b.nama) || score(A, c.data1);
      if (!s) continue;
      const cand = { to: c.aid, idx: b.idx, nama_block: b.nama, score: s, cap: b.cap, same: c.aid === t.from };
      if (!best
        || cand.score > best.score
        || (cand.score === best.score && cand.cap > best.cap)
        || (cand.score === best.score && cand.cap === best.cap && cand.same && !best.same)) best = cand;
    }
  }

  const row = { rowNo: t.rowNo, nama: excelName, from: t.from, kind: t.kind };
  if (best) {
    if (best.score < 55) {
      const iu = unresolved.findIndex((u) => u.rowNo === row.rowNo);
      if (iu >= 0) unresolved.splice(iu, 1);
      unresolved.push({ ...row, reason: `kandidat mirip rendah (skor ${best.score}) — bisa salah rumah, cek manual` });
      console.log(`\n  r${t.rowNo} SKOR-RENDAH ${best.to.slice(0, 8)} #${best.idx} "${best.nama_block.slice(0, 24)}" (skor ${best.score})`);
    } else if (best.same && EXCEL_SRC) {
      // blok cocok di assignment sendiri — alur tulis biasa (tanpa peta) menangani
      selfOk.push({ ...row, idx: best.idx, score: best.score });
      console.log(`\n  r${t.rowNo} SELF ${t.from.slice(0, 8)} #${best.idx} "${best.nama_block.slice(0, 24)}" (skor ${best.score})`);
    } else if (best.same && t.kind === "no-field" && String(t.idx) !== String(best.idx)) {
      reindex.push({ ...row, to: best.to, from_idx: t.idx, idx: best.idx, nama_block: best.nama_block, score: best.score });
      console.log(`\n  r${t.rowNo} REINDEX ${t.from.slice(0, 8)} #${t.idx} → #${best.idx} "${best.nama_block.slice(0, 28)}" (skor ${best.score})`);
    } else if (!best.same) {
      moved.push({ ...row, to: best.to, idx: best.idx, nama_block: best.nama_block, score: best.score });
      console.log(`\n  r${t.rowNo} MOVED ${t.from.slice(0, 8)} → ${best.to.slice(0, 8)} #${best.idx} "${best.nama_block.slice(0, 28)}" (skor ${best.score})`);
    } else {
      unresolved.push({ ...row, reason: "kandidat terbaik = assignment/blok yang sama (tidak berubah)" });
    }
  } else {
    const iu = unresolved.findIndex((u) => u.rowNo === row.rowNo);
    if (iu >= 0) unresolved.splice(iu, 1);
    unresolved.push({
      ...row,
      reason: gotData === 0 && !NETG
        ? "kandidat di luar cache — jalankan ulang `node diag-unmatched.mjs --net --limit <N>` untuk bagian ini"
        : "tidak ada blok nama_usaha+biaya yang mirip di assignment rumah tangga ini",
    });
    console.log(`\n  r${t.rowNo} NONE — ${gotData === 0 && !NETG ? "di luar cache" : "tidak ketemu"}`);
  }
  if (usedNet) await new Promise((r) => setTimeout(r, DELAY_MS));
}

console.log(`\n=== hasil: MOVED ${moved.length} | REINDEX ${reindex.length} | NONE ${unresolved.length}${EXCEL_SRC ? ` | SELF ${selfOk.length}` : ""}`);
writeFileSync(OUT_FILE, JSON.stringify({ at: new Date().toISOString(), mode: EXCEL_SRC ? "excel" : "plan", excel: EXCEL_SRC || undefined, moved, reindex, unresolved }, null, 1));
console.log(`peta: ${OUT_FILE} (pakai --map ${OUT_FILE} pada eksekusi penulisan)`);
for (const u of unresolved.slice(0, 12)) console.log(`  r${u.rowNo}: ${String(u.nama).slice(0, 40)} — ${u.reason}`);
process.exit(0);
