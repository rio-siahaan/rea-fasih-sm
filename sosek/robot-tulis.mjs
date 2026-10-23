#!/usr/bin/env node
/**
 * robot-tulis.mjs — tulis komentar "#0" ke L Blok I sesuai hasil audit robot-cek.
 *
 * #0 = "NIK tidak berupa (sesuai lapangan)" — menempel di nik_dtsen#N SAJA.
 * Sumber target: robot-cek-progress.json → assignment dgn baris berstatus SIAP-TULIS;
 * blok cocok per baris sudah diketahui (blok_idx) — tidak ada pencocokan ulang.
 *
 * Per assignment (1 paket utk semua blok-nya):
 *   getAssignment → patch comment.json (tambah #0 di nik_dtsen#<idx>; skip kunci
 *   yang sudah punya #0) → zip(data+comment+media+reference.zip) → s3/edit
 *   (presign+put+edit) → status EDITED. data.json dikirim apa adanya.
 *
 * Jalankan (Chrome 3 port aktif, sesudah robot-cek):
 *   node robot-tulis.mjs --limit 3 --yes      (uji kecil)
 *   node robot-tulis.mjs --yes                (penuh — lanjut dari report)
 *   node robot-tulis.mjs                      (ditanya konfirmasi dulu)
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createPool } from "./lib/pool.mjs";
import { writeZip, md5hex } from "./lib/zip.mjs";
import { buildS3EditPayload } from "./lib/flow.mjs";

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
const PROG_CEK = O.progress || "robot-cek-progress.json";
const REPORT = O.report || "robot-tulis.json";
const DELAY = Number(O.delay ?? 2000);
const LIMIT = O.limit ? Number(O.limit) : Infinity;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!existsSync(PROG_CEK)) {
  console.error(`✗ ${PROG_CEK} tidak ada — jalankan dulu: node robot-cek.mjs --limit 10`);
  process.exit(1);
}
const prog = JSON.parse(readFileSync(PROG_CEK, "utf8"));
if (!prog.ok) { console.error("✗ progres robot-cek kosong"); process.exit(1); }

// ------------------------------------------------------------------ kumpulkan target
// aid → {idxs:Set, rows:number[]} dari baris berstatus SIAP-TULIS
const targets = new Map();
let skipNoSiap = 0;
for (const [aid, info] of Object.entries(prog.ok)) {
  const idxs = new Set(), rows = [];
  for (const a of info.audits || []) {
    if (a.status !== "SIAP-TULIS" || !a.blokIdx) continue;
    // baris kembar (blokIdx "101+102") → cukup blok pertama (dua blok identik)
    const first = String(a.blokIdx).split("+")[0];
    if (first && !idxs.has(first)) { idxs.add(first); rows.push(a.row); }
  }
  if (!idxs.size) { skipNoSiap++; continue; }
  targets.set(aid, { idxs, rows });
}
const order = [...targets.keys()].slice(0, LIMIT === Infinity ? targets.size : LIMIT);
console.log(`Target tulis #0 (nik_dtsen#N): ${order.length} assignment` +
  (LIMIT !== Infinity ? ` — --limit ${LIMIT}` : "") +
  ` (skip ${skipNoSiap} tanpa baris SIAP-TULIS)`);
const totalKeys = order.reduce((n, a) => n + targets.get(a).idxs.size, 0);
console.log(`Total kunci nik_dtsen: ${totalKeys}\n`);

async function confirm(q) {
  if (O.yes) return true;
  if (!process.stdin.isTTY) { console.error("(bukan TTY — pakai --yes utk lanjut)"); return false; }
  const rl = (await import("node:readline/promises")).createInterface({ input: process.stdin, output: process.stdout });
  const a = await rl.question(`${q} (y/n) `);
  rl.close();
  return /^y(es)?$/i.test(a.trim());
}
if (!order.length) { console.log("Tidak ada target."); process.exit(0); }
if (!(await confirm(`Lanjut TULIS komentar #0 ke ${order.length} assignment?`))) {
  console.log("dibatalkan"); process.exit(0);
}

// ------------------------------------------------------------------ pool
const cfg = existsSync("./config.json") ? JSON.parse(readFileSync("./config.json", "utf8")) : {};
const pool = await createPool({ cfg });
for (const a of pool.accounts) {
  const who = a.bad ? `PERLU LOGIN ULANG — ${a.bad}` : `${a.user?.fullname || "-"} (${a.user?.username || "-"})`;
  console.log(`Akun ${a.label} (port ${a.port}): ${who}`);
}
console.log("Pool:", pool.labels());
const withRetry = (fn, label, o = {}) => pool.withRetry(fn, label, o);

// ------------------------------------------------------------------ report
const done = existsSync(REPORT) ? JSON.parse(readFileSync(REPORT, "utf8")) : { ok: {}, fail: {}, skip: 0 };
done.ok = done.ok || {}; done.fail = done.fail || {}; done.skip = done.skip || 0;
const saveReport = () => writeFileSync(REPORT, JSON.stringify(done, null, 2));

const work = order.filter((a) => !done.ok[a]);
console.log(`report: ${Object.keys(done.ok).length} sudah OK di ${REPORT} — lanjut ${work.length}\n`);

// ------------------------------------------------------------------ proses
let okc = 0, failc = 0, skipc = 0;
for (let i = 0; i < work.length; i++) {
  const aid = work[i];
  const t = targets.get(aid);
  const acct = await pool.pick();
  const tag = `tulis ${i + 1}/${work.length} ${aid.slice(0, 8)}`;
  process.stdout.write(`${tag} [akun ${acct.label}]          \r`);
  try {
    const rec = await withRetry((ac) => ac.api.getAssignment(aid), `get ${aid.slice(0, 8)}`, { pin: acct });

    // comment.json lama
    let c;
    try { c = typeof rec.comment === "string" ? JSON.parse(rec.comment) : { dataKey: "", notes: [] }; }
    catch { c = { dataKey: "", notes: [] }; }
    if (!c || typeof c !== "object") c = { dataKey: "", notes: [] };
    if (!Array.isArray(c.notes)) c.notes = [];

    // kunci target yang BELUM punya #0 (siapa pun pengirimnya — idempoten)
    const keys = [];
    for (const idx of t.idxs) {
      const k = `nik_dtsen#${idx}`;
      const note = c.notes.find((x) => x.dataKey === k);
      const hasZero = note && (note.comments || []).some((x) => String(x.comment || "").trim() === "#0");
      if (!hasZero) keys.push(k);
    }
    if (!keys.length) {
      skipc++;
      done.skip++;
      saveReport();
      console.log(`\n- ${i + 1}/${work.length} ${aid.slice(0, 8)} semua kunci sudah ber-#0 — dilewati`);
      continue;
    }

    for (const k of keys) {
      let note = c.notes.find((x) => x.dataKey === k);
      if (!note) { note = { dataKey: k, comments: [] }; c.notes.push(note); }
      if (!Array.isArray(note.comments)) note.comments = [];
      note.comments.push({ comment: "#0", datetime: new Date().toISOString(), sender: rec.current_user_username || "" });
    }

    // paket: data.json apa adanya + comment.json baru (pola bulk-komentar yang teruji)
    const refZip = writeZip([
      { name: "reference.json", data: Buffer.from(JSON.stringify({ details: [], sidebar: [] }), "utf8") },
    ]);
    const zipBuf = writeZip([
      { name: "data.json", data: Buffer.from(String(rec.data), "utf8") },
      { name: "comment.json", data: Buffer.from(JSON.stringify(c), "utf8") },
      { name: "media.json", data: Buffer.from(JSON.stringify(rec.media || {}), "utf8") },
      { name: "reference.zip", data: refZip },
    ]);
    const fn = `${aid}_edit_${Date.now()}.zip`;
    const presig = await withRetry((ac) => ac.api.presignEdit(rec.survey_period_id, aid, [fn]), `presign ${aid.slice(0, 8)}`, { pin: acct });
    const first = Array.isArray(presig) ? presig[0] : presig;
    const url = first && first.presignedUrls && first.presignedUrls[0] && first.presignedUrls[0].presignedUrl;
    if (!url) throw new Error("presign tidak mengembalikan URL");
    await withRetry((ac) => ac.api.s3Put(url, (first.presignedUrls[0].filename || fn), zipBuf), `s3put ${aid.slice(0, 8)}`, { pin: acct });
    const payload = buildS3EditPayload({
      assignmentId: aid, surveyPeriodId: rec.survey_period_id,
      filename: (first.presignedUrls[0].filename || fn),
      size: zipBuf.length, md5: md5hex(zipBuf), hdata: rec,
    });
    const res = await (async () => {
      try {
        return await withRetry((ac) => ac.api.s3Edit(payload), `s3edit ${aid.slice(0, 8)}`, { pin: acct });
      } catch (e) {
        const m = String((e && e.message) || e);
        if (m.includes("HTTP 500") && m.includes("assignmentStatusId"))
          return { data: { assignmentStatusAlias: "EDITED BY Admin Kabupaten" }, _500ok: true };
        throw e;
      }
    })();
    const alias = res && res.data ? res.data.assignmentStatusAlias : res && res.message;
    done.ok[aid] = { alias: alias || "EDITED?", acct: acct.label, keys, rows: t.rows, at: new Date().toISOString() };
    if (done.fail) delete done.fail[aid];
    okc++;
    console.log(`\n✓ ${i + 1}/${work.length} ${aid.slice(0, 8)} #0 → ${keys.length} kunci (${keys.join(", ")}) → ${alias}`);
  } catch (e) {
    done.fail = done.fail || {};
    done.fail[aid] = String((e && e.message) || e).slice(0, 200);
    failc++;
    console.log(`\n✗ ${i + 1}/${work.length} ${aid.slice(0, 8)}: ${done.fail[aid]}`);
  }
  saveReport();
  if (i < work.length - 1) await sleep(DELAY);
}

console.log(`\nSelesai: OK=${okc} SKIP=${skipc} GAGAL=${failc} — laporan: ${REPORT}`);
if (failc) console.log("ulangi perintah yang sama untuk mengulang yang gagal");
console.log("verifikasi: node robot-cek.mjs --fresh (status harus berubah SUDAH-#0)");
