/**
 * diag-affected.mjs — hitung assignment yang DATANYA bukan paket terbaru
 * (basis upload memilih .7z/.zip lama). READ-ONLY, memakai pool multi-akun.
 * Keluaran: bulk-affected.json {affected:[{aid, latestFile, latestAnswers,
 * cacheAnswers, ver}]}
 *
 * --resume : lanjutkan scan yang terputus (progress di bulk-affected.progress.json)
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createPool } from "./lib/pool.mjs";

const OUR_IDS = new Set([
  "7fbcbd6b-b3a4-41ee-bda2-bf05eed24757", // sesi bulk kita
  "abef9266-e379-4d36-a850-db4e7942a73a", // sesi uji coba lain (jika ada)
]);
const st = JSON.parse(readFileSync("./bulk-state.json", "utf8"));
const ids = Object.keys(st.done);

const cfg = existsSync("./config.json") ? JSON.parse(readFileSync("./config.json", "utf8")) : {};
const pool = await createPool({ cfg });
console.log("Pool:", pool.labels());
const withRetry = (fn, label, o = {}) => pool.withRetry(fn, label, o);

const sleepK = (ms) => new Promise((r) => setTimeout(r, ms));
const DELAYK = Number(process.env.DELAY_MS || 1200);

// ---- resume: progress per assignment disimpan, Ctrl+C tidak buang hasil
const PROG = "./bulk-affected.progress.json";
const RESUME = process.argv.includes("--resume");
let prog = { done: [], affected: [] };
if (RESUME && existsSync(PROG)) {
  try { prog = JSON.parse(readFileSync(PROG, "utf8")); } catch { prog = { done: [], affected: [] }; }
}
const doneSet = new Set(prog.done || []);
const affected = [...(prog.affected || [])];
const work = RESUME ? ids.filter((aid) => !doneSet.has(aid)) : ids;
if (RESUME) console.log(`resume: ${doneSet.size} sudah discan, sisa ${work.length}`);

let scanned = 0;
for (const aid of work) {
  scanned++;
  process.stdout.write(`scan ${scanned}/${work.length} ${aid.slice(0, 8)}          \r`);
  try {
    const arr = await withRetry((ac) => ac.api.history(aid), `hist ${aid.slice(0, 8)}`);
    const list = (Array.isArray(arr) ? arr : (arr.data || arr.content || []))
      .filter((h) => h.base_path && h.user_id && !OUR_IDS.has(h.user_id));
    if (list.length) {
      // paket terbaru oleh ORANG LAIN = nama file ter-sort terbesar (mtime di nama)
      list.sort((a, b) => String(b.base_path).localeCompare(String(a.base_path)));
      const latest = list[0];
      const latestName = String(latest.base_path).split("/").pop();
      // bandingkan isi paket terbaru vs cache (basis upload kita)
      const h = await withRetry((ac) => ac.api.historyData(aid, latestName), `data ${aid.slice(0, 8)}`);
      const newer = JSON.parse(h.data);
      const cf = readdirSync("./bulk-cache").find((x) => x.startsWith(aid.slice(0, 8)));
      if (cf) {
        const cache = JSON.parse(readFileSync(join("./bulk-cache", cf), "utf8"));
        const base = JSON.parse(cache.data);
        const nNew = (newer.answers || []).length, nBase = (base.answers || []).length;
        if (nNew !== nBase || String(newer.templateVersion) !== String(base.templateVersion)) {
          affected.push({
            aid, latestFile: latestName,
            latestAnswers: nNew, cacheAnswers: nBase,
            latestVer: newer.templateVersion || "", baseVer: base.templateVersion || "",
          });
        }
      }
    }
  } catch (e) {
    console.log(`\n✗ ${aid.slice(0, 8)}: ${String(e.message || e).slice(0, 100)}`);
  }
  doneSet.add(aid);
  // tulis progress tiap 10 assignment agar resume akurat
  if (scanned % 10 === 0) {
    prog.done = [...doneSet];
    prog.affected = affected;
    writeFileSync(PROG, JSON.stringify(prog, null, 1));
  }
  await sleepK(DELAYK);
}
prog.done = [...doneSet];
prog.affected = affected;
writeFileSync(PROG, JSON.stringify(prog, null, 1));
console.log(`\n=== dipindai ${scanned}${RESUME ? " (sisa)" : ""}; paket terbaru BERBEDA dari basis upload: ${affected.length}`);
for (const a of affected.slice(0, 10)) console.log(`   ${a.aid.slice(0, 8)} ${a.latestFile.slice(-22)} → ver ${a.baseVer}(${a.cacheAnswers}) vs ${a.latestVer}(${a.latestAnswers})`);
writeFileSync("./bulk-affected.json", JSON.stringify(affected, null, 1));
console.log("daftar: bulk-affected.json | progress: bulk-affected.progress.json (--resume untuk melanjutkan)");
process.exit(0);
