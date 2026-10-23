#!/usr/bin/env node
/**
 * robot-cek.mjs — READ-ONLY audit daftar "robot baru.xlsx" terhadap L Blok I.
 *
 * Satu baris robot = satu blok ART/keluarga (assignment bisa punya beberapa baris:
 * 7128 baris → 4980 assignment). Untuk tiap assignment:
 *   - 1 panggilan get-by-assignment-id (data + comment sekaligus, tanpa history)
 *   - data.json    → blok no_urut_kk#N & nik_dtsen#N (N = 1, 101, 102, …)
 *   - comment.json → notes "comments[].comment" — deteksi otomatis pola "#0"
 * robot baru.xlsx = RENCANA utk robot → status per baris:
 *   SIAP-TULIS  (blok cocok, #0 belum ada — normal utk rencana)
 *   SUDAH-#0    (blok cocok & #0 sudah tahun — robot sudah jalan di unit ini)
 *   URUT-TIDAK-ADA | NIK-BEDA | TANPA-BLOK  (rencana vs form TIDAK COCOK — perbaiki tabel robot)
 *   TANPA-DATA | FETCH-GAGAL
 *
 * Keluaran: robot-cek.csv (per baris Excel, selalu PENUH dari progres) + ringkasan pola #0.
 * Progres robot-cek-progress.json → aman Ctrl+C, dijalankan ulang otomatis lanjut.
 *
 * Jalankan (Chrome 3 port aktif):
 *   node robot-cek.mjs --limit 10      (uji kecil)
 *   node robot-cek.mjs                 (penuh — lanjut dari progres)
 * Opsi: --excel/--sheet/--out/--fresh/--delay-ms N
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createPool } from "./lib/pool.mjs";

// ------------------------------------------------------------------ argumen
const O = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith("--")) {
    const k = a.slice(2);
    if (process.argv[i + 1] && !String(process.argv[i + 1]).startsWith("--")) { O[k] = process.argv[i + 1]; i++; }
    else O[k] = true;
  }
}
const EXCEL = O.excel || "robot baru.xlsx";
const SHEET = O.sheet || null;
const OUT_CSV = O.out || "robot-cek.csv";
const PROG = "robot-cek-progress.json";
const EXTRA_MS = Number(O["delay-ms"] ?? process.env.DELAY_MS ?? 0);
const LIMIT = O.limit ? Number(O.limit) : Infinity;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ bantu kecil
const cell = (r, j) => {
  if (!r || j >= r.length) return "";
  const c = r[j];
  if (c == null) return "";
  if (typeof c === "object") return String(c.v ?? c.value ?? c.label ?? "").trim();
  return String(c).trim();
};
const ans = (a) => {
  let v = a && a.answer;
  if (Array.isArray(v)) v = v[0];
  if (v == null) return "";
  if (typeof v === "object") return String(v.value ?? v.label ?? v ?? "").trim();
  return String(v).trim();
};
const qesc = (s) => {
  const t = String(s ?? "");
  return /[",;\r\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
};

// ------------------------------------------------------------------ muat robot
const { readXlsx } = await import("./lib/xlsx.mjs");
const rd = readXlsx(readFileSync(EXCEL));
const sheetName = SHEET || rd.sheetNames[0];
const rows = rd.sheets[sheetName];
if (!rows) { console.error(`Sheet tidak ada: ${sheetName} — pilihan: ${rd.sheetNames.join(", ")}`); process.exit(1); }

// header di baris 2 → data mulai idx 2.
// kolom: 6=assignment_id, 7=no_urut_kk, 8=nik_dtsen, 9=Kode remak, 4=level5(BDT)
const groups = new Map(); // aid → [{row, urut, nik, remak, lv5}]
let rowsBad = 0;
for (let i = 2; i < rows.length; i++) {
  const r = rows[i] || [];
  const id = cell(r, 6);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) { rowsBad++; continue; }
  const item = { row: i + 1, urut: cell(r, 7), nik: cell(r, 8), remak: cell(r, 9), lv5: cell(r, 4) };
  if (!groups.has(id)) groups.set(id, []);
  groups.get(id).push(item);
}
const aids = [...groups.keys()];
const totalRows = aids.reduce((n, a) => n + groups.get(a).length, 0);
console.log(`robot: ${EXCEL} [${sheetName}] — ${aids.length} assignment, ${totalRows} baris Excel`);
if (rowsBad) console.log(`(dilewati ${rowsBad} baris tanpa assignment_id valid)`);

// ------------------------------------------------------------------ progres
// ------------------------------------------------------------------ progres
// SELALU muat progres lama dan gabungkan: --fresh hanya menentukan interpolasi
// indah yg diambil ulang, BUKAN menghapus isi file (timpa per-assignment saat selesai).
let prog = { ok: {}, fail: {} };
if (existsSync(PROG)) {
  try {
    const prev = JSON.parse(readFileSync(PROG, "utf8"));
    if (prev && prev.ok) prog = { ok: prev.ok || {}, fail: prev.fail || {} };
  } catch { prog = { ok: {}, fail: {} }; }
}
prog.ok = prog.ok || {}; prog.fail = prog.fail || {};
const saveProg = () => writeFileSync(PROG, JSON.stringify(prog, null, 1));

// ------------------------------------------------------------------ pool (lazy)
const cfg = existsSync("./config.json") ? JSON.parse(readFileSync("./config.json", "utf8")) : {};
let pool = null;
const getPool = async () => {
  if (!pool) {
    pool = await createPool({ cfg });
    for (const a of pool.accounts) {
      const who = a.bad ? `PERLU LOGIN ULANG — ${a.bad}` : `${a.user?.fullname || "-"} (${a.user?.username || "-"})`;
      console.log(`Akun ${a.label} (port ${a.port}): ${who}`);
    }
    console.log("Pool:", pool.labels());
  }
  return pool;
};
const withRetry = (fn, label, o = {}) => getPool().then((p) => p.withRetry(fn, label, o));

// ------------------------------------------------------------------ parse assignment
function parseAssignment(rec) {
  let dataJson = null;
  try { dataJson = typeof rec.data === "string" ? (rec.data.trim() ? JSON.parse(rec.data) : null) : rec.data || null; } catch { }
  let comJson = null;
  try { comJson = typeof rec.comment === "string" ? (rec.comment.trim() ? JSON.parse(rec.comment) : null) : rec.comment; } catch { }
  const answers = dataJson?.answers || [];
  const byIdx = new Map(); // idx → {idx, urut, nik}
  let no_kk = "", nama_kk = "";
  for (const a of answers) {
    const k = String(a.dataKey || "");
    let m = /^no_urut_kk#(\d+)$/.exec(k);
    if (m) {
      const idx = m[1];
      if (!byIdx.has(idx)) byIdx.set(idx, { idx, urut: "", nik: "" });
      byIdx.get(idx).urut = ans(a);
      continue;
    }
    m = /^nik_dtsen#(\d+)$/.exec(k);
    if (m) {
      const idx = m[1];
      if (!byIdx.has(idx)) byIdx.set(idx, { idx, urut: "", nik: "" });
      byIdx.get(idx).nik = ans(a);
      continue;
    }
    if (k === "no_kk" && !no_kk) no_kk = ans(a);
    if (/^nama_kk#?$/.test(k) && !nama_kk) nama_kk = ans(a);
  }
  const notes = comJson?.notes || [];
  const zeroKeys = [];
  const commentList = [];
  for (const n of notes) {
    for (const c of n.comments || []) {
      const t = String(c.comment || "").trim();
      commentList.push(`${String(n.dataKey || "")}=${t}`);
      if (t === "#0") zeroKeys.push(String(n.dataKey || ""));
    }
  }
  return {
    blocks: [...byIdx.values()],
    no_kk, nama_kk,
    zeroKeys,
    commentsAll: commentList,
    statusAlias: String(rec.assignment_status_alias || rec.assignmentStatusAlias || "").trim(),
    ver: dataJson?.templateVersion || rec.template_version || "",
    dataCount: answers.length,
  };
}

// ------------------------------------------------------------------ audit satu baris
/** hasil {status,...} untuk satu baris robot vs parsed assignment */
function auditRow(item, parsed) {
  const blocks = parsed.blocks;
  const zeroKeys = parsed.zeroKeys;
  const urutX = item.urut === "" ? NaN : Number(item.urut);
  const nikX = item.nik.replace(/\s+/g, "");
  const catatan = [];
  let status, blokIdx = "", urutForm = "", nikForm = "";

  // dataKey "#0" → idx-nya
  const zeroIdx = new Map();
  for (const zk of zeroKeys) {
    const m = /^(.*)#(\d+)$/.exec(zk);
    if (m) zeroIdx.set(zk, m[2]);
  }

  if (!blocks.length) {
    status = "TANPA-BLOK";
    catatan.push(`form tanpa no_urut_kk#N/nik_dtsen#N (answers=${parsed.dataCount})`);
  } else {
    const olehUrut = blocks.filter((b) => Number(b.urut) === urutX);
    if (!olehUrut.length) {
      status = "URUT-TIDAK-ADA";
      catatan.push(`urut form: [${blocks.map((b) => b.urut || "-").join(", ")}]`);
    } else {
      blokIdx = olehUrut.map((b) => b.idx).join("+");
      urutForm = olehUrut[0].urut;
      const nikEq = olehUrut.filter((b) => b.nik.replace(/\s+/g, "") === nikX);
      if (!nikEq.length) {
        status = "NIK-BEDA";
        nikForm = olehUrut.map((b) => b.nik || "-").join("|");
        catatan.push(`urut ${item.urut} form, nik: [${nikForm}]`);
      } else {
        nikForm = nikEq[0].nik;
        if (nikEq.length > 1) {
          blokIdx = nikEq.map((b) => b.idx).join("+");
          catatan.push(`blok kembar ×${nikEq.length}`);
        }
        const idxSet = new Set(blokIdx.split("+"));
        const zeroDiBlok = zeroKeys.filter((zk) => idxSet.has(zeroIdx.get(zk)));
        if (zeroDiBlok.length) {
          status = "SUDAH-#0";
          if (zeroDiBlok.length < zeroKeys.length)
            catatan.push(`#0 juga di field lain: ${zeroKeys.filter((zk) => !zeroDiBlok.includes(zk)).slice(0, 3).join(", ")}`);
        } else {
          status = "SIAP-TULIS";
          catatan.push(zeroKeys.length
            ? `#0 belum tapi komentar lain ada: ${zeroKeys.length} remark — cek kolom komentar_ada`
            : "blok cocok; #0 belum ditulis (normal utk rencana)");
        }
      }
    }
  }
  return { status, blokIdx, urutForm, nikForm, catatan: catatan.join(" ; ") };
}

// ------------------------------------------------------------------ proses
const need = aids.filter((a) => !prog.ok[a]);
const work = (O.fresh ? aids : need).slice(0, LIMIT === Infinity ? (O.fresh ? aids.length : need.length) : LIMIT);
const totalWork = work.reduce((n, a) => n + groups.get(a).length, 0);
console.log(`Target audit: ${work.length} assignment (baris Excel ${totalWork})${LIMIT !== Infinity ? ` — --limit ${LIMIT}` : ""}`);
if (Object.keys(prog.ok).length && !O.fresh) console.log(`progres: ${Object.keys(prog.ok).length} sudah OK dilewati`);
console.log("");

const statusCount = {};
const zeroPattern = new Map(); // basis dataKey (tanpa #idx) → hitungan, ringkasan pola
let csvLines = [];             // baris CSV run ini

function pushCsv(l) { csvLines.push(l); statusCount[l.status] = (statusCount[l.status] || 0) + 1; }

function csvLine(item, aid, parsed, audit, ver) {
  // #0 di blok (utk kolom #0_di)
  let zeroDi = "";
  if (parsed && audit && audit.blokIdx) {
    const idxSet = new Set(String(audit.blokIdx).split("+"));
    zeroDi = parsed.zeroKeys.filter((zk) => {
      const m = /^(.*)#(\d+)$/.exec(zk);
      if (!m) return false;
      return idxSet.has(m[2]);
    }).join(" ; ");
  }
  const short = (v) => {
    const t = String(v ?? "");
    return t.length > 60 ? t.slice(0, 57) + "…" : t;
  };
  const komentarAda = parsed && parsed.commentsAll && parsed.commentsAll.length
    ? short(parsed.commentsAll.join(" ; "))
    : "";
  return {
    baris: item.row, aid, urutX: item.urut, nikX: item.nik, remak: item.remak,
    lv5: item.lv5,
    no_kk: parsed ? parsed.no_kk : "",
    blokIdx: audit ? audit.blokIdx : "",
    urutForm: audit ? audit.urutForm : "",
    nikForm: audit ? audit.nikForm : "",
    zeroDi,
    status: audit ? audit.status : (parsed ? "TANPA-DATA" : "FETCH-GAGAL"),
    catatan: audit ? audit.catatan : (parsed ? "data.json kosong" : "gagal tarik — lihat ERROR/FETCH-GAGAL di log"),
    ver: ver || "",
    statusAlias: parsed ? parsed.statusAlias : "",
    komentarAda,
    err: audit ? "" : (parsed ? "" : "tarik gagal"),
  };
}

let done = 0;
for (const aid of work) {
  const gRows = groups.get(aid);
  done++;
  const tag = `[${done}/${work.length}] ${aid.slice(0, 8)} (${gRows.length}r)`;
  let rec = null;
  let err = "";
  try {
    rec = await withRetry((ac) => ac.api.getAssignment(aid), `get ${aid.slice(0, 8)}`);
    if (EXTRA_MS) await sleep(EXTRA_MS);
  } catch (e) {
    err = String((e && e.message) || e).slice(0, 160);
  }

  if (!rec) {
    prog.fail[aid] = err || "respons kosong";
    console.log(`${tag} ✗ FETCH-GAGAL ${err}`);
    saveProg();
    for (const it of gRows) pushCsv(csvLine(it, aid, null, null, ""));
    continue;
  }

  const parsed = parseAssignment(rec);
  if (!parsed.dataCount) {
    prog.fail[aid] = "data kosong";
    console.log(`${tag} ✗ TANPA-DATA`);
    saveProg();
    for (const it of gRows) pushCsv(csvLine(it, aid, parsed, null, parsed.ver));
    continue;
  }

  // simpan hasil PENUH per baris di progres
  const audits = gRows.map((it) => ({ row: it.row, ...auditRow(it, parsed) }));
  prog.ok[aid] = {
    at: Date.now(),
    ver: parsed.ver, no_kk: parsed.no_kk, blocks: parsed.blocks, zeroKeys: parsed.zeroKeys,
    commentsAll: parsed.commentsAll, statusAlias: parsed.statusAlias,
    rows: gRows.map((x) => x.row),
    audits,
  };
  delete prog.fail[aid];
  for (let i = 0; i < gRows.length; i++) {
    const audit = { status: audits[i].status, blokIdx: audits[i].blokIdx, urutForm: audits[i].urutForm, nikForm: audits[i].nikForm, catatan: audits[i].catatan };
    pushCsv(csvLine(gRows[i], aid, parsed, audit, parsed.ver));
  }
  const stats = audits.map((a) => a.status).join(",");
  const z = parsed.zeroKeys.length ? ` #0×${parsed.zeroKeys.length}` : "";
  console.log(`${tag} ${stats}${z}`);
  saveProg();
  if (done % 25 === 0) console.log(`— ${done}/${work.length} — ${JSON.stringify(statusCount)}`);
}

// ------------------------------------------------------------------ CSV final penuh
// gabung: baris run ini + baris dari progres lama (sudah OK, tidak diproses ulang)
const lines = [...csvLines];
const doneThis = new Set(work);
const outRows = [];
for (const l of lines) outRows.push(l);
for (const [aid, info] of Object.entries(prog.ok)) {
  if (doneThis.has(aid)) continue;
  const gRows = groups.get(aid) || [];
  for (const it of gRows) {
    const a = (info.audits || []).find((x) => x.row === it.row);
    const audit = a
      ? { status: a.status, blokIdx: a.blokIdx, urutForm: a.urutForm, nikForm: a.nikForm, catatan: a.catatan }
      : { status: "?", blokIdx: "", urutForm: "", nikForm: "", catatan: "(progres lama tanpa rincian baris)" };
    const parsed = {
      no_kk: info.no_kk,
      zeroKeys: info.zeroKeys || [],
      commentsAll: info.commentsAll || [],
      statusAlias: info.statusAlias || "",
    };
    outRows.push(csvLine(it, aid, { ...parsed, ver: info.ver }, audit, info.ver));
  }
}
outRows.sort((a, b) => Number(a.baris) - Number(b.baris));
const statusBad = new Set(["URUT-TIDAK-ADA", "NIK-BEDA", "TANPA-BLOK", "TANPA-DATA", "FETCH-GAGAL"]);
const head = "baris,assignment_id,no_urut_kk_excel,nik_excel,kode_remak,level5,no_kk_form,blok_idx,urut_form,nik_form,#0_di,status,catatan,status_assignment,komentar_ada,versi,catatan_tambahan";
const csv = [head].concat(outRows.map((l) =>
  [l.baris, l.aid, l.urutX, l.nikX, l.remak, l.lv5, l.no_kk, l.blokIdx, l.urutForm, l.nikForm, l.zeroDi, l.status, l.catatan, l.statusAlias, l.komentarAda, l.ver, l.err]
    .map(qesc).join(",")
)).join("\r\n") + "\r\n";
writeFileSync(OUT_CSV, "\uFEFF" + csv);

// CSV khusus baris GAGAL/BERMASALAH — bahan perbaikan tabel robot
const badRows = outRows.filter((l) => statusBad.has(l.status));
const OUT_BAD = OUT_CSV.replace(/\.csv$/i, "") + "-gagal.csv";
const csvBad = [head].concat(badRows.map((l) =>
  [l.baris, l.aid, l.urutX, l.nikX, l.remak, l.lv5, l.no_kk, l.blokIdx, l.urutForm, l.nikForm, l.zeroDi, l.status, l.catatan, l.statusAlias, l.komentarAda, l.ver, l.err]
    .map(qesc).join(",")
)).join("\r\n") + "\r\n";
writeFileSync(OUT_BAD, "\uFEFF" + csvBad);

// pola "#0" untuk deteksi otomatis (skala kecil → besar)
for (const [, info] of Object.entries(prog.ok)) {
  for (const zk of info.zeroKeys || []) {
    const m = /^(.*)#(\d+)$/.exec(zk);
    const k = m ? m[1] + "#N" : zk;
    zeroPattern.set(k, (zeroPattern.get(k) || 0) + 1);
  }
}

// ------------------------------------------------------------------ ringkasan
console.log(`\n=== hasil: ${JSON.stringify(statusCount)}`);
console.log("(robot baru.xlsx = RENCANA → SIAP-TULIS itu normal; bermasalah = URUT-TIDAK-ADA / NIK-BEDA / TANPA-BLOK)");
if (zeroPattern.size) {
  const top = [...zeroPattern.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  console.log("pola komentar #0 (deteksi otomatis):");
  for (const [k, n] of top) console.log(`  ${k}  ×${n}`);
}
console.log(`CSV : ${OUT_CSV}${badRows.length ? `\nGAGAL : ${OUT_BAD} (${badRows.length} baris — perbaiki di robot baru.xlsx)` : ""}`);
console.log(`prog: ${PROG} (${Object.keys(prog.ok).length} OK, ${Object.keys(prog.fail).length} fail)`);
const fails = Object.entries(prog.fail || {}).slice(0, 5);
if (fails.length) console.log("fail terakhir:", fails.map(([a, e]) => `${a.slice(0, 8)}: ${e}`).join(" | "));
