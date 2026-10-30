#!/usr/bin/env node
/**
 * robot-sosial27.mjs — workflow khusus data_excel/sosial27.xlsx.
 *
 * Aturan batch:
 *   - hanya baris yang NIK dan nama_kk-nya SAMA-SAMA unik di file
 *   - target #0: no_kk (Blok P) + nik_dtsen#N milik anggota yang NIK-nya cocok
 *   - komentar lain dipertahankan; #0 tidak diduplikasi
 *   - hasil ditulis ke salinan .xlsx, sumber tidak diubah
 *
 * Contoh:
 *   node sosek27/robot-sosial27.mjs
 *   node sosek27/robot-sosial27.mjs --write --yes
 *   node sosek27/robot-sosial27.mjs --write --yes --limit 1
 *   node sosek27/robot-sosial27.mjs --write --yes --rows 80,115
 *   node sosek27/robot-sosial27.mjs --dry-run
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadWorkbook, classifyRows, writeResultWorkbook } from "./lib/excel.mjs";
import { processAssignment } from "./lib/fasih.mjs";
import { createPool } from "../lib/pool.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const O = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith("--")) continue;
  const k = a.slice(2);
  if (process.argv[i + 1] && !String(process.argv[i + 1]).startsWith("--")) {
    O[k] = process.argv[i + 1];
    i++;
  } else {
    O[k] = true;
  }
}

const SRC = resolve(ROOT, O.excel || "data_excel/sosial27.xlsx");
const OUT = resolve(ROOT, O.out || "data_excel/sosial27_hasil.xlsx");
const REPORT = resolve(ROOT, O.report || "sosek27/sosial27_report.csv");
const JSON_REPORT = resolve(ROOT, O.json || "sosek27/sosial27_report.json");
const WRITE_LOG = resolve(ROOT, O.log || "sosek27/sosial27_write_log.json");
const WRITE = Boolean(O.write);
const DRY = Boolean(O["dry-run"] || O.dryRun);
const YES = Boolean(O.yes);
const LIMIT = O.limit ? Number(O.limit) : Infinity;
const DELAY = Number(O.delay ?? 2000);
const ONLY_ROWS = O.rows
  ? new Set(String(O.rows).split(",").map((x) => Number(x.trim())).filter(Number.isFinite))
  : null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const qesc = (s) => {
  const t = String(s ?? "");
  return /[",;\r\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
};

let writeLog = [];
try {
  const raw = JSON.parse(readFileSync(WRITE_LOG, "utf8"));
  writeLog = Array.isArray(raw) ? raw : (raw.writes || []);
} catch { writeLog = []; }
const saveWriteLog = () => {
  mkdirSync(dirname(WRITE_LOG), { recursive: true });
  writeFileSync(WRITE_LOG, JSON.stringify({ version: 1, writes: writeLog }, null, 2));
};

async function confirm(question) {
  if (YES) return true;
  if (!process.stdin.isTTY) return false;
  const rl = (await import("node:readline/promises")).createInterface({ input: process.stdin, output: process.stdout });
  const a = await rl.question(`${question} (y/n) `);
  rl.close();
  return /^y(es)?$/i.test(a.trim());
}

const wb = loadWorkbook(SRC);
const { rows, candidates, nikCount, nameCount } = classifyRows(wb.rows);

console.log(`Sumber : ${SRC}`);
console.log(`Sheet  : ${wb.sheetName} — ${rows.length} baris data`);
console.log(`Link   : kolom ${wb.linkCol}, ${wb.links.size} hyperlink assignment`);
console.log(`Unik   : NIK=${nikCount.size}, nama_kk=${nameCount.size}`);
console.log(`Filter : NIK unik + nama_kk unik → ${candidates.length} kandidat\n`);

for (const r of candidates) {
  console.log(`  ✓ baris ${r.__row}: ${r.nama_kk} | NIK ${r.nik} | no_kk ${r.no_kk}`);
}
const skippedUniqueNik = rows.filter((r) => r.__nikCount === 1 && r.__nameCount > 1);
for (const r of skippedUniqueNik) {
  console.log(`  - baris ${r.__row}: ${r.nama_kk} | NIK unik tetapi nama_kk ${r.__nameCount}x → skip`);
}
console.log("");

if (WRITE && !DRY && !(await confirm(`Tulis #0 ke ${candidates.length} assignment?`))) {
  console.log("Dibatalkan — tidak ada perubahan.");
  process.exit(0);
}

const runAt = new Date().toISOString();
const results = new Map();
for (const r of rows) {
  results.set(r.__row, {
    assignmentId: wb.links.get(r.__row) || "",
    status: "SKIP",
    target: "",
    note: r.__reason || "bukan kandidat batch",
    time: runAt,
    added: [],
    already: [],
    verified: false,
    alias: "",
  });
}

let selected = candidates;
if (ONLY_ROWS) selected = selected.filter((r) => ONLY_ROWS.has(Number(r.__row)));
if (LIMIT !== Infinity) selected = selected.slice(0, LIMIT);

const selectedRows = new Set(selected.map((r) => Number(r.__row)));
for (const r of candidates) {
  if (selectedRows.has(Number(r.__row))) continue;
  results.set(r.__row, {
    assignmentId: wb.links.get(r.__row) || "",
    status: "SKIP",
    target: "",
    note: "kandidat, tidak dipilih pada run ini (--rows/--limit)",
    time: runAt,
    added: [],
    already: [],
    verified: false,
    alias: "",
  });
}

let pool = null;
if ((WRITE || DRY) && selected.length) {
  const cfg = JSON.parse(readFileSync(resolve(ROOT, "config.json"), "utf8"));
  try {
    pool = await createPool({ cfg });
    for (const a of pool.accounts) {
      const who = a.bad ? `PERLU LOGIN ULANG — ${a.bad}` : `${a.user?.fullname || "-"} (${a.user?.username || "-"})`;
      console.log(`Akun ${a.label} (port ${a.port}): ${who}`);
    }
    console.log(`Pool: ${pool.labels()}\n`);
  } catch (e) {
    console.error(`✗ Pool gagal: ${String((e && e.message) || e)}`);
  }
}

if (WRITE || DRY) {
  for (let i = 0; i < selected.length; i++) {
    const r = selected[i];
    const aid = wb.links.get(r.__row) || "";
    const tag = `[${i + 1}/${selected.length}] baris ${r.__row} ${String(r.nama_kk).slice(0, 28)}`;

    if (!aid) {
      results.set(r.__row, {
        assignmentId: "",
        status: "GAGAL",
        target: "",
        note: "hyperlink assignment tidak ditemukan",
        time: new Date().toISOString(),
      });
      console.log(`${tag} ✗ hyperlink assignment tidak ada`);
      continue;
    }

    if (!pool) {
      results.set(r.__row, {
        assignmentId: aid,
        status: "GAGAL",
        target: "",
        note: "pool FASIH tidak tersedia",
        time: new Date().toISOString(),
      });
      console.log(`${tag} ✗ pool tidak tersedia`);
      continue;
    }

    try {
      const res = await processAssignment({ pool, aid, fileNik: r.nik, dryRun: DRY });
      results.set(r.__row, {
        assignmentId: aid,
        status: res.status,
        target: res.target || "",
        note: res.note,
        time: res.at || new Date().toISOString(),
        added: res.added || [],
        already: res.already || [],
        verified: Boolean(res.verified),
        alias: res.alias || res.statusAlias || "",
      });
      if (!DRY && res.status === "BERHASIL" && (res.added || []).length) {
        writeLog.push({
          row: Number(r.__row),
          aid,
          keys: res.added,
          targets: res.keys || [],
          at: res.at || new Date().toISOString(),
          alias: res.alias || res.statusAlias || "",
          status: res.status,
        });
        saveWriteLog();
      }
      console.log(`${tag} ${res.status === "BERHASIL" || res.status === "SIAP" ? "✓" : res.status === "SUDAH ADA" ? "-" : "✗"} ${res.status} | ${res.target || "-"} | ${res.note}`);
    } catch (e) {
      const msg = String((e && e.message) || e).slice(0, 240);
      results.set(r.__row, {
        assignmentId: aid,
        status: "GAGAL",
        target: "",
        note: msg,
        time: new Date().toISOString(),
      });
      console.log(`${tag} ✗ GAGAL | ${msg}`);
    }
    if (i < selected.length - 1) await sleep(DELAY);
  }
} else {
  for (const r of selected) {
    results.set(r.__row, {
      assignmentId: wb.links.get(r.__row) || "",
      status: "SIAP",
      target: "no_kk; nik_dtsen#N",
      note: "lolos filter; belum ditulis (jalankan --write --yes)",
      time: runAt,
      added: [],
      already: [],
      verified: false,
      alias: "",
    });
  }
}

// Gabungkan riwayat tulisan yang sudah berhasil. Ini menjaga kolom hasil tetap
// akurat ketika script dijalankan ulang (target sudah ber-#0, jadi tidak upload lagi).
const logByRow = new Map();
for (const e of writeLog) {
  if (!e || !Number.isFinite(Number(e.row))) continue;
  const row = Number(e.row);
  if (!logByRow.has(row)) logByRow.set(row, []);
  logByRow.get(row).push(e);
}
for (const [rowNum, res] of results) {
  const entries = (logByRow.get(Number(rowNum)) || [])
    .filter((e) => !res.assignmentId || e.aid === res.assignmentId)
    .sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
  if (!entries.length) continue;

  const candidateNotSelected = res.status === "SKIP" && String(res.note || "").startsWith("kandidat, tidak dipilih");
  if (res.status !== "BERHASIL" && !candidateNotSelected) continue;

  const written = [...new Set([
    ...entries.flatMap((e) => e.keys || []),
    ...(res.added || []),
  ])];
  const targets = [...new Set([
    ...entries.flatMap((e) => e.targets || []),
    ...written,
    ...(res.already || []),
  ])];
  const already = targets.filter((k) => !written.includes(k));
  const last = entries[0];

  res.status = "BERHASIL";
  res.target = targets.join("; ");
  res.note = [
    written.length ? `ditulis: ${written.join(", ")}` : "",
    already.length ? `sudah ada: ${already.join(", ")}` : "",
    `status: ${last.alias || res.alias || "EDITED"}`,
    "verifikasi: OK",
  ].filter(Boolean).join(" | ");
  res.time = last.at || res.time;
  res.verified = true;
  res.alias = last.alias || res.alias;
}

const outInfo = writeResultWorkbook({ srcPath: SRC, outPath: OUT, rows, results });

const reportRows = rows.map((r) => {
  const res = results.get(r.__row) || {};
  return {
    baris: r.__row,
    nama_kk: r.nama_kk,
    no_kk: r.no_kk,
    nik: r.nik,
    assignment_id: res.assignmentId || wb.links.get(r.__row) || "",
    status: res.status || "",
    target_0: res.target || "",
    catatan: res.note || "",
    waktu: res.time || "",
  };
});
const counts = {};
for (const x of reportRows) counts[x.status] = (counts[x.status] || 0) + 1;

const head = "baris,nama_kk,no_kk,nik,assignment_id,status,target_0,catatan,waktu";
const csv = [head]
  .concat(reportRows.map((x) =>
    [x.baris, x.nama_kk, x.no_kk, x.nik, x.assignment_id, x.status, x.target_0, x.catatan, x.waktu].map(qesc).join(",")
  ))
  .join("\r\n") + "\r\n";
mkdirSync(dirname(REPORT), { recursive: true });
writeFileSync(REPORT, "\uFEFF" + csv);

const failRows = reportRows.filter((x) => x.status === "GAGAL");
const failPath = REPORT.replace(/\.csv$/i, "") + "-gagal.csv";
const failCsv = [head]
  .concat(failRows.map((x) =>
    [x.baris, x.nama_kk, x.no_kk, x.nik, x.assignment_id, x.status, x.target_0, x.catatan, x.waktu].map(qesc).join(",")
  ))
  .join("\r\n") + "\r\n";
writeFileSync(failPath, "\uFEFF" + failCsv);

writeFileSync(JSON_REPORT, JSON.stringify({
  source: SRC,
  output: OUT,
  generatedAt: new Date().toISOString(),
  counts,
  rows: reportRows,
}, null, 2));

console.log(`\nHasil Excel : ${outInfo.outPath}`);
console.log(`Report CSV  : ${REPORT}`);
if (failRows.length) console.log(`Report gagal: ${failPath} (${failRows.length} baris)`);
console.log(`Report JSON : ${JSON_REPORT}`);
console.log(`Ringkasan   : ${JSON.stringify(counts)}`);
process.exit(failRows.length ? 1 : 0);
