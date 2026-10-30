#!/usr/bin/env node
/**
 * fasih-sm — otomasi workflow FASIH-SM via CDP
 * ============================================
 * Prasyarat:
 *   1. Chrome dijalankan dengan remote debugging:
 *      chrome.exe --remote-debugging-port=9222 --user-data-dir="%TEMP%\opencode\chrome-fasih"
 *   2. User login SSO sendiri & buka fasih-sm.bps.go.id (login TIDAK ditangani tool ini).
 *
 * Perintah utama:
 *   doctor   [<poll>]  cek koneksi + status sesi
 *   whoami              info user + izin period aktif
 *   list [--start N --length N --search S --status F]  daftar assignment
 *   detail <id>         detail assignment
 *   history <id>        daftar versi/riwayat (basePath zip)
 *   data <id>           data terakhir assignment (data.json + data1..10)
 *   download <id>       unduh paket zip terbaru (presign GET → S3)
 *   unzip <file> --out <dir>                      bongkar zip lokal
 *   pack <dataJson> --out <zip>                   kemas file jadi zip baru
 *   upload <id> --file <zip> [--yes]              upload zip → S3 → status EDITED
 *   edit <id> [--transform <mjs>] [--yes] [--dry] download→ubah→upload→status EDITED
 *   bulk-edit --excel <file> [--dry] [--yes] [--limit N] [--resume]
 *                                        edit massal dari Excel rumus (Rio_rumus2)
 *
 * Opsi umum: --port 9222  --period <surveyPeriodId>  --survey <surveyId>
 * Default period/survey dibaca dari config.json di folder ini.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, createWriteStream } from "node:fs";
import { join, resolve, basename } from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import { createPool } from "./lib/pool.mjs";
import { readZip, writeZip } from "./lib/zip.mjs";
import { latestZipFilename, downloadPackage, uploadPackage, editAssignment } from "./lib/flow.mjs";
import { loadPlan, computeChanges, applyPlan, buildCommentJson, normNama } from "./lib/bulk.mjs";
import { buildS3EditPayload } from "./lib/flow.mjs";
import { md5hex as crypto_md5hex } from "./lib/zip.mjs";

// ---------------------------------------------------------------- util CLI
const HERE = fileURLToPath(new URL(".", import.meta.url));
const CONFIG_PATH = join(HERE, "config.json");
const DOWNLOAD_DIR = join(HERE, "downloads");

function config() {
  const defaults = {
    cdpPort: 9222,
    surveyId: "a0429e96-51a5-477b-a415-485f9c153004",
    periodId: "fd68e454-ba45-4b85-8205-f3bf777ded24",
  };
  if (existsSync(CONFIG_PATH)) {
    return { ...defaults, ...JSON.parse(readFileSync(CONFIG_PATH, "utf8")) };
  }
  writeFileSync(CONFIG_PATH, JSON.stringify(defaults, null, 2));
  return defaults;
}

function parseArgs(argv) {
  const opts = {}, pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) { opts[key] = next; i++; }
      else opts[key] = true;
    } else pos.push(a);
  }
  return { opts, pos };
}

const LOGIC = (s) => (s.length > 60 ? s.slice(0, 57) + "..." : s);

async function confirm(question) {
  const rl = (await import("node:readline/promises")).createInterface({ input: process.stdin, output: process.stdout });
  const ans = await rl.question(`${question} [y/N]: `);
  rl.close();
  return /^y(es)?$/i.test(ans.trim());
}

function die(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

// ------------------------------------------------------------------ main
const { opts, pos } = parseArgs(process.argv.slice(2));
const cmd = pos.shift();

const cfg = config();
const CDP_PORT = Number(opts.port || cfg.cdpPort);
let api, pool;

async function boot() {
  // Pool akun (çaccounts dari config.json; tanpa itu = akun tunggal mode lama).
  pool = await createPool({
    cfg,
    fallbackPort: CDP_PORT,
    paceMs: Number(opts.delay || 2000),
  });
  api = pool.api; // delegasi rolling untuk perintah satu-tembakan
  for (const a of pool.accounts) {
    const who = a.bad
      ? `PERLU LOGIN ULANG — ${a.bad}`
      : a.user
        ? `${a.user.fullname || "-"} (${a.user.username || "-"})`
        : "check-user gagal";
    console.log(`Akun ${a.label} (port ${a.port}): ${who}`);
  }
  console.log(`Pool  : ${pool.labels()}`);
  if (opts.survey) cfg.surveyId = opts.survey;
  if (opts.period) cfg.periodId = opts.period;
}

try {
  switch (cmd) {
    case undefined:
    case "help": {
      console.log(readFileSync(join(HERE, "README.md"), "utf8").split("## ").slice(0, 30).join("## "));
      break;
    }

    case "doctor": {
      await boot();
      for (const a of pool.accounts) {
        if (a.bad) { console.log(`Akun ${a.label}: ✗ ${a.bad}`); continue; }
        try {
          const info = await a.api.myInfo(cfg.periodId);
          console.log(`Myinfo ${a.label}: ${JSON.stringify(info).slice(0, 250)}`);
        } catch (e) {
          console.log(`Myinfo ${a.label} gagal: ${String(e.message || e).slice(0, 120)}`);
        }
      }
      console.log(`Periods: ${JSON.stringify(await api.periods(cfg.surveyId)).slice(0, 400)}`);
      console.log("✓ Koneksi & sesi OK");
      break;
    }

    case "whoami": {
      await boot();
      const user = await api.checkUser();
      console.log(JSON.stringify(user, null, 2));
      const perm = await api.permissionNames(cfg.periodId);
      console.log(`Izin: ${JSON.stringify(perm.data || perm).slice(0, 600)}`);
      break;
    }

    case "list": {
      await boot();
      const data = await api.listAssignments({
        surveyPeriodId: cfg.periodId,
        start: Number(opts.start || 0),
        length: Number(opts.length || 25),
        search: opts.search || "",
        statusType: opts.status != null ? Number(opts.status) : -1,
      });
      const rows = data.searchData || data.content || data.data || [];
      const total = data.recordsTotal != null ? data.recordsTotal : rows.length;
      console.log(`Total: ${total} — tampil ${rows.length} (start=${opts.start || 0})\n`);
      for (const r of rows) {
        console.log(
          `${r.assignmentStatusId} ${String(r.assignmentStatusAlias || "").padEnd(32)} ` +
          `${r.id}  [${r.codeIdentity || ""}] ${String(r.data1 || "").slice(0, 40)} | ${String(r.data2 || "").slice(0, 18)}`
        );
      }
      if (opts.json) console.log(JSON.stringify(data, null, 2));
      break;
    }

    case "detail": {
      await boot();
      const d = await api.getAssignmentExcludeData(pos[0] || die("perlu <assignmentId>"));
      console.log(JSON.stringify(d, null, 2));
      break;
    }

    case "history": {
      await boot();
      const id = pos[0] || die("perlu <assignmentId>");
      const h = await api.history(id);
      console.log(JSON.stringify(h, null, 2).slice(0, 4000));
      const latest = latestZipFilename(h);
      console.log(latest ? `\n→ zip terbaru: ${latest}` : "\n→ basePath tidak ditemukan");
      break;
    }

    case "data": {
      await boot();
      const id = pos[0] || die("perlu <assignmentId>");
      let fname = opts.filename;
      if (!fname) {
        const h = await api.history(id);
        fname = latestZipFilename(h);
        if (!fname) die("basePath tidak ada di history — pakai --filename");
      }
      const d = await api.historyData(id, fname);
      const text = JSON.stringify(d, null, 2);
      if (opts.out) { writeFileSync(opts.out, text); console.log(`→ disimpan: ${opts.out}`); }
      else console.log(text.length > 8000 ? text.slice(0, 8000) + "\n... (pakai --out untuk menyimpan penuh)" : text);
      break;
    }

    case "download": {
      await boot();
      const id = pos[0] || die("perlu <assignmentId>");
      mkdirSync(DOWNLOAD_DIR, { recursive: true });
      const { buf, filename } = await downloadPackage(api, id, {
        filename: opts.filename,
        onDownloadError: (e) => console.error(`[!] presign tidak berhasil: ${String(e.message || e).slice(0, 120)}`),
      });
      if (buf) {
        const out = join(DOWNLOAD_DIR, filename);
        writeFileSync(out, buf);
        console.log(`✓ ${out} (${buf.length} bytes, md5 ${crypto_md5hex(buf)})`);
        if (filename.toLowerCase().endsWith(".zip")) {
          for (const e of readZip(buf)) console.log(`  - ${e.name} (${e.data.length} bytes)`);
        } else console.log(`  (${filename} — non-zip)`);
      }
      // data.json selalu dibangun dari server (cara SPA membaca data)
      const hist = await api.history(id);
      const baseName = latestZipFilename(hist) || filename || "";
      const hdata = await api.historyData(id, baseName);
      const dataStr = typeof hdata.data === "string" ? hdata.data : JSON.stringify(hdata.data ?? {});
      const jsonOut = join(DOWNLOAD_DIR, `${id}_data.json`);
      writeFileSync(jsonOut, dataStr);
      const zipOut = join(DOWNLOAD_DIR, `${id}_rebuild.zip`);
      writeFileSync(zipOut, writeZip([{ name: "data.json", data: Buffer.from(dataStr, "utf8") }]));
      console.log(`✓ ${jsonOut} (data.json dari riwayat)`);
      console.log(`✓ ${zipOut} (paket siap edit/upload)`);
      break;
    }

    case "unzip": {
      const f = pos[0] || die("perlu <file.zip>");
      const out = opts.out || ".";
      mkdirSync(out, { recursive: true });
      for (const e of readZip(readFileSync(f))) {
        const p = join(out, e.name);
        writeFileSync(p, e.data);
        console.log(`  ${p} (${e.data.length} bytes)`);
      }
      break;
    }

    case "pack": {
      const src = pos[0] || die("perlu <data.json>");
      const out = opts.out || "paket.zip";
      const data = readFileSync(src);
      writeFileSync(out, writeZip([{ name: "data.json", data }]));
      console.log(`✓ ${out} (dari ${src})`);
      break;
    }

    case "upload": {
      await boot();
      const id = pos[0] || die("perlu <assignmentId>");
      const zip = opts.file || die("perlu --file <zip>");
      const buf = readFileSync(zip);
      const entries = readZip(buf);
      console.log(`File  : ${zip} (${buf.length} bytes)`);
      entries.forEach((e) => console.log(`  - ${e.name} (${e.data.length} bytes)`));
      if (!opts.yes) {
        const ok = await confirm(`Upload ke S3 dan ubah status ${id} jadi EDITED?`);
        if (!ok) die("dibatalkan");
      }
      const res = await uploadPackage(api, id, buf, { surveyPeriodId: cfg.periodId });
      if (res.dry) console.log("[DRY]\n" + JSON.stringify(res.payload, null, 2));
      else {
        console.log(`✓ status: ${res.data ? res.data.assignmentStatusAlias : res.message}`);
        console.log(JSON.stringify(res.data, null, 2).slice(0, 1200));
      }
      break;
    }

    case "edit": {
      await boot();
      const id = pos[0] || die("perlu <assignmentId>");
      const { zipBuf, entries, originName } = await editAssignment(api, id, {
        transform: opts.transform,
        saveDir: DOWNLOAD_DIR,
      });
      console.log(`Origin paket: ${originName}`);
      console.log(`Isi zip baru (${zipBuf.length} bytes):`);
      entries.forEach((e) => console.log(`  - ${e.name} (${e.data.length} bytes)`));
      if (opts.dry) {
        console.log("[DRY] tidak dilakukan upload");
        break;
      }
      if (!opts.yes) {
        const ok = await confirm(`Upload hasil edit & ubah status ${id} jadi EDITED?`);
        if (!ok) die("dibatalkan");
      }
      const res = await uploadPackage(api, id, zipBuf, { surveyPeriodId: cfg.periodId });
      console.log(`✓ status: ${res.data ? res.data.assignmentStatusAlias : res.message}`);
      break;
    }

    case "bulk-edit": {
      await boot();
      const excel = opts.excel || die("perlu --excel <file.xlsx>");
      const STATE = join(HERE, "bulk-state.json");
      const PLAN_OUT = join(HERE, "bulk-plan.json");
      const REPORT = join(HERE, "bulk-report.json");
      const PROGRESS = join(HERE, "bulk-progress.json");
      const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : { done: {}, fail: {} };
      const planf = loadPlan(excel);

      // ---- monitor live: rowMap[rowNo] = { aid, state, info?, at }
      const rowMap = {};
      let statCounter = { total: 0, fetchOk: 0, fetchFail: 0, applyOk: 0, applyFail: 0 };
      const writeProgress = (extra = {}) => {
        writeFileSync(PROGRESS, JSON.stringify({
          at: new Date().toISOString(),
          excel,
          stat: statCounter,
          ...extra,
          rowMap,
        }, null, 1));
      };
      const rowsOf = (recs) => recs.map((r) => r.rowNo);
      const markRows = (recs, st, info = "") => {
        for (const r of recs) {
          rowMap[r.rowNo] = { aid: r.assignmentId || r.aid || "", state: "saat ini", info, at: new Date().toISOString() };
        }
      };
      console.log(`Excel      : ${excel}`);
      console.log(`Baris usaha: ${planf.totalRows} (assignment: ${planf.groups.size})`);
      console.log(`Skip       : status "Sesuai" & "Output <= 0"; resume: ${opts.resume ? "aktif" : "tidak"}\n`);

      let resolvedInfo = { moved: [], unresolved: [] };
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const DELAY = Number(opts.delay || 2000); // jeda antar assignment (server 429 rate limit)
      // withRetry didelegasikan ke pool — cooldown & 429 per akun, rolling antar akun.
      // fn menerima objek akun: pakai ac.api (bukan api global), atau pin akun
      // tertentu via opts.pin supaya 1 assignment = 1 akun.
      const withRetry = (fn, label, o = {}) => pool.withRetry(fn, label, o);

      // ---- cache disk: satu assignment direpark sekali seumur proses bulk
      const CACHE_DIR = join(HERE, "bulk-cache");
      mkdirSync(CACHE_DIR, { recursive: true });
      const REFRESH = !!opts.refresh;
      const fetchData = async (aid, note = "", prefAcct = null) => {
        const cp = join(CACHE_DIR, `${aid}.json`);
        let hdata = !REFRESH && existsSync(cp) ? JSON.parse(readFileSync(cp, "utf8")) : null;
        if (!hdata) {
          const hist = await withRetry((ac) => ac.api.history(aid), `history ${aid.slice(0, 8)}${note}`, { pin: prefAcct });
          const baseName = latestZipFilename(hist);
          if (!baseName) throw new Error("basePath/zip tidak ada di riwayat");
          hdata = await withRetry((ac) => ac.api.historyData(aid, baseName), `history-data ${aid.slice(0, 8)}${note}`, { pin: prefAcct });
          writeFileSync(cp, JSON.stringify(hdata));
          await sleep(DELAY);
        }
        const dataStr = typeof hdata.data === "string" ? hdata.data : JSON.stringify(hdata.data ?? {});
        const dataJson = JSON.parse(dataStr);
        if (!Array.isArray(dataJson.answers)) throw new Error("data.json tidak berisi answers");
        return { hdata, dataJson };
      };


      // ---- fase 1: ambil data.json tiap assignment (cache disk) + hitung rencana awal
      const perAssign = [];
      const limit = opts.limit ? Number(opts.limit) : Infinity;
      const totalGroup = planf.groups.size;
      const targetN = Math.min(totalGroup, limit === Infinity ? totalGroup : limit);
      let fetchedN = 0;
      for (const [aid, recs] of planf.groups) {
        if (fetchedN >= targetN) break;
        process.stdout.write(`fetch ${fetchedN + 1}/${targetN} ${aid.slice(0, 8)}          \r`);
        markRows(recs, "fetching", `assignment ${aid.slice(0, 8)}`);
        statCounter.total = targetN;
        writeProgress({ fase: "fetch", posisi: `${fetchedN + 1}/${targetN}`, assignment: aid });
        if (opts.resume && state.done[aid]) {
          fetchedN++;
          perAssign.push({ aid, skip: "sudah selesai (resume)" });
          continue;
        }
        try {
          const acct = await pool.pick();
          const { hdata, dataJson } = await fetchData(aid, "", acct);
          const cc = computeChanges(dataJson, recs);
          markRows(recs, "data-ok", `${aid.slice(0, 8)}`);
          statCounter.fetchOk++;
          perAssign.push({ aid, acct, hdata, dataJson, cc, recs });
        } catch (e) {
          markRows(recs, "fetch-fail", String((e && e.message) || e).slice(0, 120));
          statCounter.fetchFail++;
          perAssign.push({ aid, error: String((e && e.message) || e).slice(0, 200) });
        }
        fetchedN++;
      }
      console.log("");

      // ---- fase 1.5: auto-carikan assignment usaha yang benar untuk baris
      // unmatched / no-field (link Excel sering menunjuk assignment keluarga) 
      if (!opts.noResolve) {
        const byRow = new Map();
        for (const x of perAssign) {
          if (!x.cc) continue;
          for (const u of x.cc.unmatched) byRow.set(u.rowNo, { aid: x.aid, rec: u, reason: "unmatched" });
          for (const p of x.cc.plan) if (!p.items.length) byRow.set(p.rec.rowNo, { aid: x.aid, rec: p.rec, reason: "no-field" });
        }
        const moved = [];
        const unresolved = [];
        const candCache = new Map();
        let ri = 0;
        for (const [rowNo, item] of byRow) {
          ri++;
          const { aid, rec, reason } = item;
          process.stdout.write(`resolusi ${ri}/${byRow.size} r${rowNo} ${aid.slice(0, 8)}          \r`);
          writeProgress({ fase: "resolusi", posisi: `${ri}/${byRow.size}`, baris: rowNo, assignment: aid });
          markRows([rec], "resolusi", `${reason} → cari assignment benar`);
          const src = perAssign.find((x) => x.aid === aid);
          if (!src || !src.hdata) { unresolved.push({ rec, reason, note: "sumber tidak terdata" }); continue; }
          const code = String(src.hdata.code_identity || "").split(/\s+-\s+/)[0].trim();
          if (!/^\d{16}$/.test(code)) { unresolved.push({ rec, reason, note: `code_identity tidak 16 digit (${code || "kosong"})` }); continue; }
          let cands = candCache.get(code);
          if (cands === undefined) {
            cands = await withRetry((ac) => ac.api.principalValues(cfg.periodId, code), `principal ${code}`)
              .then((r) => (Array.isArray(r) ? r : (r && r.data) || []))
              .catch((e) => {
                console.log(`\n[!] principal ${code}: ${String((e && e.message) || e).slice(0, 120)}`);
                return [];
              });
            candCache.set(code, cands || []);
          }
          if (!cands.length) { unresolved.push({ rec, reason, note: "daftar per-code kosong" }); continue; }

          const A = normNama(rec.nama_usaha);
          const ownerA = (String(rec.nama_usaha).match(/\(([^)]+)\)/g) || []).slice(-1)[0];
          let best = null, bestScore = 0;
          for (const c of cands) {
            const B = normNama(String(c.data1 || ""));
            if (!B) continue;
            let s = 0;
            if (B === A) s = 100;
            else if (B.includes(A) || A.includes(B)) s = 70;
            const ownerB = (String(c.data1 || "").match(/\(([^)]+)\)/g) || []).slice(-1)[0];
            if (ownerA && ownerB && normNama(ownerA) === normNama(ownerB)) s = Math.max(s, 60);
            if (!s) {
              const aw = A.split(" ").filter((w) => w.length > 3);
              const bw = new Set(B.split(" "));
              const hc = aw.filter((w) => bw.has(w)).length;
              if (hc >= 2) s = 20 + hc * 5;
            }
            if (s > bestScore) { bestScore = s; best = c; }
          }
          if (!best || (best.aid || best.assignmentId) === aid) {
            unresolved.push({ rec, reason, note: best ? "kandidat terbaik = assignment sama" : "tidak ada kandidat cukup mirip" });
            continue;
          }
          moved.push({ rowNo, from: aid, to: (best.aid || best.assignmentId), nama: String(best.data1 || ""), score: bestScore, reason });
        }
        console.log("");

        if (moved.length) {
          const finalMap = new Map();
          for (const [aid, recs] of planf.groups) {
            for (const r of recs) {
              const mv = moved.find((m) => m.rowNo === r.rowNo);
              const dest = mv ? mv.to : aid;
              if (!finalMap.has(dest)) finalMap.set(dest, []);
              finalMap.get(dest).push(r);
            }
          }
          const newAids = [...finalMap.keys()].filter((a) => !perAssign.some((x) => x.aid === a));
          for (const na of newAids) {
            try {
              const acct = await pool.pick();
              const { hdata, dataJson } = await fetchData(na, " (hasil resolusi)", acct);
              perAssign.push({ aid: na, acct, hdata, dataJson, recs: finalMap.get(na) });
            } catch (e) {
              console.log(`\n[!] data ${na.slice(0, 8)} — ${String((e && e.message) || e).slice(0, 100)}`);
              perAssign.push({ aid: na, error: String((e && e.message) || e).slice(0, 200) });
            }
          }
          for (const x of perAssign) {
            if (!x.dataJson) continue;
            if (!finalMap.has(x.aid)) { x.cc = null; x.skip = "semua baris dipindah (resolusi)"; continue; }
            x.cc = computeChanges(x.dataJson, finalMap.get(x.aid) || []);
          }
          console.log(`Resolusi: ${moved.length} baris dipindah ke assignment usaha yang cocok;\n${unresolved.length} baris tetap tidak terbantu.\n`);
          resolvedInfo = { moved, unresolved };
        } else resolvedInfo = { moved, unresolved };
      }

      if (opts.dry) {
        // ---- fase 2a: laporan rencana (tanpa menulis)
        const withData = perAssign.filter((x) => x.cc);
        const errors = perAssign.filter((x) => x.error);
        const planRows = withData.flatMap((x) => x.cc.plan);
        const dirty = planRows.filter((p) => p.items.length);
        const noFields = planRows.filter((p) => !p.items.length); // match, tapi field form tak ada
        const unmatched = withData.flatMap((x) => x.cc.unmatched);
        const skipped = withData.flatMap((x) => x.cc.skipped).filter((s) => s.reason !== "Sesuai");
        const sesuai = withData.flatMap((x) => x.cc.skipped).filter((s) => s.reason === "Sesuai");
        const flagCek = dirty.filter((p) => p.flagCek);

        console.log(`Fetch fails : ${errors.length}`);
        console.log(`Akan diedit : ${dirty.length} usaha (termasuk ${flagCek.length} ber-flag "Cek")`);
        console.log(`No-field    : ${noFields.length} (match, tapi field ekonomi tidak ada di data.json — tidak ditulis)`);
        console.log(`Tanpa match : ${unmatched.length} (nama_usaha tidak ketemu di data.json)`);
        console.log(`Skip nyata  : ${skipped.length} | skip "Sesuai": ${sesuai.length}`);

        const MAXSHOW = Number(opts.show || 25);
        const show = (arr, label, fmt) => {
          console.log(`\n--- ${label} (contoh ${Math.min(MAXSHOW, arr.length)})`);
          for (const x of arr.slice(0, MAXSHOW)) console.log("  " + fmt(x));
        };
        show(errors, "GAGAL FETCH", (x) => `${x.aid.slice(0, 8)}: ${x.error}`);
        show(resolvedInfo.moved, "RESOLUSI (dipindah)", (m) =>
          `r${m.rowNo} → ${m.to.slice(0, 8)} "${m.nama.slice(0, 36)}" (score ${m.score}, ${m.reason})`,
        );
        show(resolvedInfo.unresolved, "TAK TERBANTU (tetap lewati)", (u) =>
          `r${u.rec.rowNo}: ${u.rec.nama_usaha.slice(0, 34)} — ${u.reason}: ${u.note}`,
        );
        show(dirty, "RENCANA EDIT", (p) =>
          `r${p.rec.rowNo} ${p.blockName.slice(0, 32)} #${p.idx}: biaya_produksi ${p.before.biaya_produksi}→${p.after.biaya_produksi}, operasional ${p.before.operasional}→${p.after.operasional}, total_pengeluaran ${p.before.total_pengeluaran}→${p.after.total_pengeluaran}${p.flagCek ? " [CEK]" : ""}`,
        );
        show(noFields, "NO-FIELD", (p) => `r${p.rec.rowNo} ${p.blockName.slice(0, 36)} #${p.idx} (status: ${p.rec.status})`);
        show(unmatched, "TANPA MATCH", (u) => `r${u.rowNo}: ${u.nama_usaha.slice(0, 40)} (status: ${u.status})`);
        show(skipped, "SKIP", (s) => `r${s.rec.rowNo}: ${s.reason} (${s.rec.nama_usaha.slice(0, 30)})`);

        // simpan JSON plan
        const planOut = perAssign.map(({ aid, cc, error, skip }) => ({
          assignmentId: aid,
          error,
          skip,
          planEntries: cc ? cc.plan.map((p) => ({
            rowNo: p.rec.rowNo, nama_usaha: p.blockName, idx: p.idx, flagCek: p.flagCek,
            before: p.before, after: p.after, items: p.items,
            noFields: !p.items.length,
          })) : undefined,
          unmatched: cc ? cc.unmatched.map((u) => ({ rowNo: u.rowNo, nama: u.nama_usaha })) : undefined,
          skipped: cc ? cc.skipped.map((s) => ({ rowNo: s.rec.rowNo, reason: s.reason })) : undefined,
        }));
        writeFileSync(PLAN_OUT, JSON.stringify({
          excel, totalRows: planf.totalRows, dry: true,
          resolusi: resolvedInfo,
          assignments: planOut,
        }, null, 2));
        console.log(`\n→ rencana lengkap: ${PLAN_OUT}`);
        break;
      }

      // ---- fase 2b: terapkan
      const editable = perAssign.filter(
        (x) => x.cc && x.cc.plan.some((p) => p.items.length),
      );
      const fieldTotal = editable.reduce((a, x) => a + x.cc.plan.reduce((b, p) => b + p.items.length, 0), 0);
      if (!editable.length) { console.log("Tidak ada perubahan yang harus ditulis."); writeProgress({ fase: "idle", posisi: "tidak ada pekerjaan" }); break; }
      if (!opts.yes) {
        const ok = await confirm(`Terapkan ${fieldTotal} perubahan field pada ${editable.length} assignment (semua jadi EDITED)?`);
        if (!ok) die("dibatalkan");
      }
      // teks komentar penyertaan di "catatan" sebelah input (comment.json, format sama dgn SPA)
      const KTEXT = opts.komentar || "Perbaikan nilai biaya produksi & biaya operasional sesuai perhitungan admin";
      console.log(`Komentar comment.json: "${KTEXT}" (ubah dengan --komentar "...")`);
      let okc = 0, failc = 0;
      const report = [];
      for (let k = 0; k < editable.length; k++) {
        const x = editable[k];
        const tag = x.aid.slice(0, 8);
        statCounter.applyPos = `${k + 1}/${editable.length}`;
        writeProgress({ fase: "apply", posisi: statCounter.applyPos, assignment: x.aid, info: "menulis field → upload zip → status EDITED" });
        markRows(x.recs || [], "applying", `${k + 1}/${editable.length}`);
        try {
          let changed = 0;
          for (const p of x.cc.plan) changed += applyPlan(x.dataJson, p);
          // paket lengkap seperti SPA: data.json + comment.json + media.json + reference.zip
          const sender = x.hdata.current_user_username || x.hdata.current_user_fullname || "";
          const commentObj = buildCommentJson(x.hdata, x.cc.plan, KTEXT, sender);
          const refZip = writeZip([
            { name: "reference.json", data: Buffer.from(JSON.stringify({ details: [], sidebar: [] }), "utf8") },
          ]);
          const zipBuf = writeZip([
            { name: "data.json", data: Buffer.from(JSON.stringify(x.dataJson), "utf8") },
            { name: "comment.json", data: Buffer.from(JSON.stringify(commentObj), "utf8") },
            { name: "media.json", data: Buffer.from(JSON.stringify(x.hdata.media || {}), "utf8") },
            { name: "reference.zip", data: refZip },
          ]);
          const pid = x.aid;
          const acct = x.acct || (await pool.pick());
          const res = await withRetry(
            (ac) => uploadPackage(ac.api, pid, zipBuf, {
              hdata: x.hdata,
              surveyPeriodId: x.hdata.survey_period_id || cfg.periodId,
              filename: `${pid}_${Date.now()}.zip`,
            }),
            `upload ${pid.slice(0, 8)}`,
            { pin: acct },
          );
          const alias = res && res.data ? res.data.assignmentStatusAlias : res && res.message;
          state.done[pid] = { alias: alias || "EDITED?", acct: acct.label, at: new Date().toISOString(), fields: changed, rows: x.cc.plan.map((p) => p.rec.rowNo) };
          delete state.fail[pid];
          report.push({ id: pid, ok: true, alias, fields: changed, rows: x.cc.plan.map((p) => p.rec.rowNo) });
          okc++;
          statCounter.applyOk++;
          markRows(x.recs || [], "teredit", `${k + 1}/${editable.length} → ${alias}`);
          process.stdout.write(`✓ ${k + 1}/${editable.length} ${tag} (${changed} field → ${alias})\n`);
        } catch (e) {
          state.fail[x.aid] = String((e && e.message) || e).slice(0, 200);
          report.push({ id: x.aid, ok: false, error: state.fail[x.aid], rows: (x.cc.plan || []).map((p) => p.rec.rowNo) });
          failc++;
          statCounter.applyFail++;
          markRows(x.recs || [], "gagal", state.fail[x.aid]);
          console.log(`✗ ${k + 1}/${editable.length} ${tag}: ${state.fail[x.aid]}`);
        }
        writeFileSync(STATE, JSON.stringify(state, null, 2));
        writeProgress({ fase: "apply", posisi: statCounter.applyPos });
        if (k < editable.length - 1) await sleep(DELAY);
      }
      writeFileSync(REPORT, JSON.stringify({ at: new Date().toISOString(), ok: okc, fail: failc, results: report }, null, 2));
      writeProgress({ fase: "selesai", posisi: `${okc} OK / ${failc} gagal` });
      console.log(`\nSelesai: OK=${okc} GAGAL=${failc}`);
      console.log(`state: ${STATE} | laporan: ${REPORT}`);
      break;
    }

    case "bulk-komentar": {
      // Ganti/harumkan komentar (catatan sebelah input) TANPA menyentuh nilai field.
      // data.json dikirim apa adanya (dari server saat ini); hanya comment.json yang mengalami perubahan.
      await boot();
      // const KTEXT = opts.komentar || "#4";
      const KTEXT = opts.komentar || "#4";
      const OLD_TXT = "Perbaikan nilai biaya produksi & biaya operasional sesuai perhitungan admin";
      const STATE3 = join(HERE, "bulk-state.json");
      const st = existsSync(STATE3) ? JSON.parse(readFileSync(STATE3, "utf8")) : { done: {}, fail: {} };
      let ids = Object.keys(st.done || {});
      // pilihan batas
      if (opts.limit) ids = ids.slice(0, Number(opts.limit));

      // perlu Excel untuk menemukan blok nama_usaha → dataKey#idx per baris
      const excelPath = opts.excel || "C:/Users/User/Downloads/Rio_rumus2 (1).xlsx";
      const planf = loadPlan(excelPath);
      const recsOf = (aid) => planf.records.filter((r) => (r.assignmentId || "").slice(0, 8) === aid.slice(0, 8));

      const sleepK = (ms) => new Promise((r) => setTimeout(r, ms));
      const DELAYK = Number(opts.delay || 2000);
      const withRetry = (fn, label, o = {}) => pool.withRetry(fn, label, o);

      if (!ids.length) die("bulk-state.json kosong — jalankan bulk-edit dulu");
      console.log(`Komentar menjadi: "${KTEXT}" untuk ${ids.length} assignment (data field tidak berubah).`);

      if (!opts.yes) {
        const ok = await confirm(`Lanjut tulis komentar untuk ${ids.length} assignment?`);
        if (!ok) die("dibatalkan");
      }

      const RPT = join(HERE, "bulk-komentar.json");
      const done = existsSync(RPT) ? JSON.parse(readFileSync(RPT, "utf8")) : { ok: {}, fail: {} };
      let okc = 0, failc = 0, skipc = 0, i = 0;
      for (const aid of ids) {
        i++;
        if (done.ok && done.ok[aid]) { skipc++; continue; }
        const acct = await pool.pick();
        process.stdout.write(`komentar ${i}/${ids.length} ${aid.slice(0, 8)} [akun ${acct.label}]          \r`);
        try {
          const rec = await withRetry((ac) => ac.api.getAssignment(aid), `get ${aid.slice(0, 8)}`, { pin: acct });
          // dataKeys yang diubah = blok baris Excel → {biaya_produksi, operasional, total_pengeluaran}#idx
          const cur = JSON.parse(rec.data);
          const blocks = [];
          for (const a of cur.answers || []) {
            const m = /^nama_usaha#(\d+)$/.exec(String(a.dataKey || ""));
            if (m) blocks.push({ idx: m[1], nama: String(Array.isArray(a.answer) ? a.answer[0]?.label ?? a.answer[0]?.value ?? "" : a.answer ?? "").trim() });
          }
          const norm = (s) => String(s || "").toUpperCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
          const recsX = recsOf(aid);
          if (!recsX.length) throw new Error("baris Excel tidak ketemu untuk assignment ini");
          const keys = [];
          for (const rx of recsX) {
            if (rx.status === "Sesuai" || /output\s*<=\s*0/i.test(rx.status)) continue;
            let b = blocks.find((x) => norm(x.nama) === norm(rx.nama_usaha))
              || blocks.find((x) => norm(x.nama).includes(norm(rx.nama_usaha)) || norm(rx.nama_usaha).includes(norm(x.nama)));
            if (!b) continue;
            for (const base of ["biaya_produksi", "operasional"]) {
              const k = `${base}#${b.idx}`;
              if ((cur.answers || []).some((a) => a.dataKey === k) && !keys.includes(k)) keys.push(k);
            }
          }
          if (!keys.length) { skipc++; continue; } // kios terpisah (tanpa kunci) — tidak disentuh

          // comment.json baru: buang komentar lama milik tool kita untuk kunci tsb, ganti teks baru
          let c;
          try { c = typeof rec.comment === "string" ? JSON.parse(rec.comment) : { dataKey: "", notes: [] }; }
          catch { c = { dataKey: "", notes: [] }; }
          if (!Array.isArray(c.notes)) c.notes = [];

          // bersih-bersih: komentar milik tool pada total_pengeluaran#N dihapus (scope sekarang hanya prod/op)
          for (const rx of recsX) {
            let b = blocks.find((x) => norm(x.nama) === norm(rx.nama_usaha))
              || blocks.find((x) => norm(x.nama).includes(norm(rx.nama_usaha)) || norm(rx.nama_usaha).includes(norm(x.nama)));
            if (!b) continue;
            const tk = `total_pengeluaran#${b.idx}`;
            c.notes = (c.notes || []).filter((n) => {
              if (n.dataKey !== tk) return true;
              n.comments = (n.comments || []).filter((x) => x.comment !== KTEXT && x.comment !== OLD_TXT);
              return n.comments.length > 0;
            });
          }
          for (const k of keys) {
            let note = c.notes.find((x) => x.dataKey === k);
            if (!note) { note = { dataKey: k, comments: [] }; c.notes.push(note); }
            if (!Array.isArray(note.comments)) note.comments = [];
            // idempoten: buang komentar lama milik tool (teks default & teks lama) sebelum tambah
            note.comments = note.comments.filter((x) => x.comment !== OLD_TXT && x.comment !== KTEXT);
            note.comments.push({ comment: KTEXT, datetime: new Date().toISOString(), sender: rec.current_user_username || rec.current_user_fullname || "" });
          }

          const refZip = writeZip([
            { name: "reference.json", data: Buffer.from(JSON.stringify({ details: [], sidebar: [] }), "utf8") },
          ]);
          const zipBuf = writeZip([
            { name: "data.json", data: Buffer.from(String(rec.data), "utf8") },
            { name: "comment.json", data: Buffer.from(JSON.stringify(c), "utf8") },
            { name: "media.json", data: Buffer.from(JSON.stringify(rec.media || {}), "utf8") },
            { name: "reference.zip", data: refZip },
          ]);
          const presig = await withRetry((ac) => ac.api.presignEdit(rec.survey_period_id, aid, [`${aid}_edit_${Date.now()}.zip`]), `presign ${aid.slice(0, 8)}`, { pin: acct });
          const first = Array.isArray(presig) ? presig[0] : presig;
          const url = first && first.presignedUrls && first.presignedUrls[0] && first.presignedUrls[0].presignedUrl;
          if (!url) throw new Error("presign tidak mengembalikan URL");
          await withRetry((ac) => ac.api.s3Put(url, first.presignedUrls[0].filename || `${aid}_edit.zip`, zipBuf), `s3put ${aid.slice(0, 8)}`, { pin: acct });
          const payload = buildS3EditPayload({ assignmentId: aid, surveyPeriodId: rec.survey_period_id, filename: (first.presignedUrls[0].filename || `${aid}_edit.zip`), size: zipBuf.length, md5: crypto_md5hex(zipBuf), hdata: rec });
          const res = await (async () => {
            try {
              return await withRetry((ac) => ac.api.s3Edit(payload), `s3edit ${aid.slice(0, 8)}`, { pin: acct });
            } catch (e) {
              // kadang server memproses tapi respons 500 — jika body berisi assignmentStatusId, anggap sukses
              const m = String((e && e.message) || e);
              if (m.includes("HTTP 500") && m.includes("assignmentStatusId")) return { data: { assignmentStatusAlias: "EDITED BY Admin Kabupaten" }, _500ok: true };
              throw e;
            }
          })();
          const alias = res && res.data ? res.data.assignmentStatusAlias : res && res.message;
          done.ok[aid] = { alias: alias || "EDITED?", acct: acct.label, keys, at: new Date().toISOString() };
          if (done.fail) delete done.fail[aid];
          okc++;
          console.log(`\n✓ ${i}/${ids.length} ${aid.slice(0, 8)} komentar diperbarui (${keys.length} field) → ${alias}`);
        } catch (e) {
          done.fail = done.fail || {};
          done.fail[aid] = String((e && e.message) || e).slice(0, 200);
          failc++;
          console.log(`\n✗ ${i}/${ids.length} ${aid.slice(0, 8)}: ${done.fail[aid]}`);
        }
        writeFileSync(RPT, JSON.stringify(done, null, 2));
        if (i < ids.length) await sleepK(DELAYK);
      }
      console.log(`\nSelesai: OK=${okc} SKIP=${skipc} GAGAL=${failc} — laporan: bulk-komentar.json`);
      break;
    }

    case "bulk-snapshot": {
      // READ-ONLY: bekukan kondisi server saat ini sebelum operasi massal berikutnya.
      // Simpan riwayat pendek + data terkini tiap assignment (hasil diag dsb.).
      await boot();
      const stS = existsSync(join(HERE, "bulk-state.json"))
        ? JSON.parse(readFileSync(join(HERE, "bulk-state.json"), "utf8"))
        : { done: {}, fail: {} };
      const idsS = Object.keys(stS.done || {});
      if (!idsS.length) die("bulk-state.json kosong — tidak ada yang di-snapshot");
      const OUT = join(HERE, `snapshot-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.json`);
      const D10 = ["data1", "data2", "data3", "data4", "data5", "data6", "data7", "data8", "data9", "data10"];
      const snap = [];
      for (let i = 0; i < idsS.length; i++) {
        const aid = idsS[i];
        process.stdout.write(`snapshot ${i + 1}/${idsS.length} ${aid.slice(0, 8)}          \r`);
        try {
          const hraw = await pool.withRetry((ac) => ac.api.history(aid), `hist ${aid.slice(0, 8)}`);
          const list = (Array.isArray(hraw) ? hraw : (hraw.data || hraw.content || [])).filter((h) => h && h.base_path);
          list.sort((a, b) => String(b.base_path).localeCompare(String(a.base_path)));
          const latest = list[0] ? String(list[0].base_path).split("/").pop() : null;
          const hd = latest ? await pool.withRetry((ac) => ac.api.historyData(aid, latest), `data ${aid.slice(0, 8)}`) : null;
          let dataObj = null;
          try { dataObj = hd ? JSON.parse(hd.data) : null; } catch { }
          snap.push({
            aid,
            latest,
            nFiles: list.length,
            users: [...new Set(list.map((h) => String(h.user_id || "")))].slice(0, 8),
            templateVersion: (dataObj && dataObj.templateVersion) ?? null,
            answers: dataObj && Array.isArray(dataObj.answers) ? dataObj.answers.length : null,
            comment: hd ? (typeof hd.comment === "string" ? hd.comment : JSON.stringify(hd.comment ?? null)) : null,
            ...D10.reduce((o, k) => ((o[k] = (hd && hd[k]) ?? null), o), {}),
            data: opts.noData ? undefined : (hd ? hd.data : null),
          });
        } catch (e) {
          snap.push({ aid, error: String((e && e.message) || e).slice(0, 200) });
        }
      }
      writeFileSync(OUT, JSON.stringify(snap, null, 1));
      const errN = snap.filter((s) => s.error).length;
      const vers = {};
      for (const s of snap) { const v = String(s.templateVersion ?? "-"); vers[v] = (vers[v] || 0) + 1; }
      console.log(`\n✓ snapshot ${snap.length}${errN ? ` (gagal ${errN})` : ""} → ${OUT}`);
      console.log("  distribusi templateVersion:", JSON.stringify(vers));
      break;
    }

    case "bulk-repair": {
      // Pulihkan data dari PAKET TERBARU (versi 7.1.2 dst) + nilai Excel + komentar #4.
      // Sumber daftar: bulk-affected.json (hasil diag-affected.mjs).
      await boot();
      const AFF = existsSync(join(HERE, "bulk-affected.json"))
        ? JSON.parse(readFileSync(join(HERE, "bulk-affected.json"), "utf8"))
        : [];
      if (!AFF.length) die("bulk-affected.json kosong / tidak ada daftar terdampak");
      const RPT = join(HERE, "bulk-repair.json");
      const done = existsSync(RPT) ? JSON.parse(readFileSync(RPT, "utf8")) : { ok: {}, fail: {} };
      const excelPath = opts.excel || "C:/Users/User/Downloads/Rio_rumus2 (1).xlsx";
      const planf = loadPlan(excelPath, opts.sheet ? { sheet: opts.sheet } : {});
      const norm = (s) => String(s || "").toUpperCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
      // --map <file peta> (hasil diag-unmatched.mjs): rutekan baris bermasalah
      // langsung ke (aid, idx) yang benar — MOVED: aid lain, REINDEX: idx lain.
      const mapM = opts.map ? JSON.parse(readFileSync(opts.map, "utf8")) : null;
      const forcedAid = new Map();   // rowNo → aid tujuan
      const forcedIdx = new Map();   // rowNo → idx blok di aid tujuan
      if (mapM) {
        for (const m of mapM.moved || []) if (m.rowNo != null) { forcedAid.set(m.rowNo, m.to); forcedIdx.set(m.rowNo, String(m.idx)); }
        for (const m of mapM.reindex || []) if (m.rowNo != null) { forcedAid.set(m.rowNo, m.to || m.from); forcedIdx.set(m.rowNo, String(m.idx)); }
        const nUnres = (mapM.unresolved || []).length;
        console.log(`map: ${forcedAid.size} baris dirutekan (moved ${(mapM.moved || []).length}, reindex ${(mapM.reindex || []).length}) — NONE ${nUnres} manual`);
      }
      const effAid = (r) => forcedAid.get(r.rowNo) || r.assignmentId;
      const recsOf = (aid) => planf.records.filter((r) => (effAid(r) || "").slice(0, 8) === aid.slice(0, 8));
      console.log(`excel: ${planf.records.length} baris (format: ${planf.mode})`);

      let ids;
      if (opts["excel-only"]) {
        // --excel-only: Excel dengan assignment BERBEDA dari run lama —
        // sumber id HANYA dari link Excel (+ peta moved/reindex) — AFF lama diabaikan.
        const seenAid = new Set();
        const list = [];
        const push = (aid) => {
          aid = String(aid || "");
          if (!aid) return;
          const k = aid.slice(0, 8);
          if (seenAid.has(k)) return;
          seenAid.add(k);
          list.push({ aid, latestFile: undefined, fromSheet: true });
        };
        for (const r of planf.records) push(effAid(r));
        for (const a2 of forcedAid.values()) push(a2);
        ids = list;
        console.log(`excel-only: sumber = Excel + peta (${ids.length} assignment) — AFF lama diabaikan`);
      } else {
        let ids0 = AFF;
        // assignment tambahan: target MOVED dari peta + semua aid Excel (--all)
        const extra = new Set();
        for (const a2 of forcedAid.values())
          if (!AFF.some((a) => a.aid.slice(0, 8) === a2.slice(0, 8))) extra.add(a2);
        if (opts.all)
          for (const r of planf.records) {
            // baris yang dirutek peta → target aid-nya (bukan aid rumah tangga link)
            const a3 = effAid(r);
            if (a3 && !AFF.some((a) => a.aid.slice(0, 8) === a3.slice(0, 8))) extra.add(a3);
          }
        ids = ids0.concat([...extra].map((a) => ({ aid: a, latestFile: undefined, fromSheet: true })));
        if (extra.size) console.log(`tambahan sumber baris/peta: +${extra.size} assignment`);
      }
      // resume DULU (lewat yang sudah OK), baru limit di atas sisa
      if (opts.resume) {
        const okSet = new Set(Object.keys(done.ok || {}));
        const left = ids.filter((a) => !okSet.has(a.aid));
        console.log(`resume: ${ids.length - left.length} sudah OK di bulk-repair.json — lanjut ${left.length}`);
        ids = left;
      }
      if (opts.limit) ids = ids.slice(0, Number(opts.limit));
      // const KTEXT = opts.komentar || "#4";
      const KTEXT = opts.komentar || "#4";
      const OLD_TXT = "Perbaikan nilai biaya produksi & biaya operasional sesuai perhitungan admin";
      // user milik sesi bulk/uji-coba tool — paket mereka BUKAN kandidat basis pemulihan
      const OUR_IDS = new Set([
        "7fbcbd6b-b3a4-41ee-bda2-bf05eed24757",
        "abef9266-e379-4d36-a850-db4e7942a73a",
      ]);

      const sleepR = (ms) => new Promise((r) => setTimeout(r, ms));
      const DELAYR = Number(opts.delay || 2500);
      const withRetry = (fn, label, o = {}) => pool.withRetry(fn, label, o);

      console.log(`Repair ${ids.length} assignment: paket terbaru + nilai Excel + komentar "${KTEXT}".`);
      if (!opts.yes) {
        const ok = await confirm(`Lanjut repair ${ids.length} assignment?`);
        if (!ok) die("dibatalkan");
      }

      let okc = 0, failc = 0, skipc = 0, i = 0;
      const blocksOf = (dataJson) => {
        const arr = [];
        for (const a of dataJson.answers || []) {
          const m = /^nama_usaha#(\d+)$/.exec(String(a.dataKey || ""));
          if (m) arr.push({ idx: m[1], nama: String(Array.isArray(a.answer) ? a.answer[0]?.label ?? a.answer[0]?.value ?? "" : a.answer ?? "").trim() });
        }
        return arr;
      };
      // & — kunci komentar kini berasal dari plan items (lihat computeChanges p.keys).

      for (const aff of ids) {
        i++;
        const aid = aff.aid;
        if (done.ok && done.ok[aid]) { skipc++; continue; }
        const acct = await pool.pick();
        process.stdout.write(`repair ${i}/${ids.length} ${aid.slice(0, 8)} [akun ${acct.label}]          \r`);
        try {
          // 0) freshness check: paket terbaru milik orang lain bisa berubah sejak
          //    diag-affected (responden kirim lagi / perbaikan manual user) —
          //    selalu pakai yang TERBARU supaya tidak menimpa data lagi.
          let baseFile = aff.latestFile;
          const hist0 = await withRetry((ac) => ac.api.history(aid), `hist ${aid.slice(0, 8)}`); // baca — boleh putar akun (pin hanya utk tulis)
          const list0 = (Array.isArray(hist0) ? hist0 : (hist0.data || hist0.content || []))
            .filter((h) => h && h.base_path && h.user_id && !OUR_IDS.has(h.user_id));
          if (list0.length) {
            list0.sort((a, b) => String(b.base_path).localeCompare(String(a.base_path)));
            const lf0 = String(list0[0].base_path).split("/").pop();
            if (lf0 && lf0 !== aff.latestFile) {
              console.log(`\n[i] ${aid.slice(0, 8)} basis berubah: ${String(aff.latestFile ?? "-").slice(-20)} → ${lf0.slice(-20)} (pakai terbaru)`);
              baseFile = lf0;
            }
          }
          if (!baseFile) throw new Error("tidak ada paket pemulihan (semua paket milik tool?) — jalankan ulang `node diag-unmatched.mjs` bila berkeinan");
          // 1) data paket TERBARU (baca — tanpa pin)
          const hist = await withRetry((ac) => ac.api.historyData(aid, baseFile), `data ${aid.slice(0, 8)}`);
          const newerData = JSON.parse(hist.data);
          // 2) record terkini — comment terakumulasi + pemilik data1..10 + region (baca — tanpa pin)
          const rec = await withRetry((ac) => ac.api.getAssignment(aid), `get ${aid.slice(0, 8)}`);
          // 3) patch nilai Excel di atas data terbaru (format lama/baru otomatis)
          const recsX = recsOf(aid);
          if (!recsX.length) throw new Error("baris Excel tidak ketemu");
          const forcedIdxOf = new Map();
          for (const [rn, a2] of forcedAid)
            if ((a2 || "").slice(0, 8) === aid.slice(0, 8)) forcedIdxOf.set(rn, forcedIdx.get(rn));
          const cc = computeChanges(newerData, recsX, { mode: planf.mode, forcedIdx: forcedIdxOf });
          const blocks = blocksOf(newerData);
          // komentar = semua field target yang ADA di template (p.keys) —
          // items yang nilainya sudah sama tidak ditulis tapi tetap di-comment.
          const keys = [];
          let changed = 0;
          for (const p of cc.plan) {
            for (const kbase of p.keys || []) {
              const k = `${kbase}#${p.idx}`;
              if ((newerData.answers || []).some((x) => x.dataKey === k) && !keys.includes(k)) keys.push(k);
            }
            changed += applyPlan(newerData, p);
          }
          // 4) komentar: ambil dari record terkini; bersihkan teks lama milik tool; set "#4" pada prod/op
          let c;
          try { c = typeof rec.comment === "string" ? JSON.parse(rec.comment) : { dataKey: "", notes: [] }; }
          catch { c = { dataKey: "", notes: [] }; }
          if (!Array.isArray(c.notes)) c.notes = [];
          // sender komentar = akun yang MENULIS (akun pin pembawa paket),
          // bukan akun pembaca (baca kini bebas putar antar akun)
          const curUser = String((acct.user && acct.user.username) || rec.current_user_username || "").trim();
          // bersihkan komentar milik tool pada total_pengeluaran di semua blok baris ini
          for (const rx of recsX) {
            if (!norm(rx.nama_usaha)) continue; // baris kosong (mode baru) — jangan sentuh blok
            let b = blocks.find((x) => norm(x.nama) === norm(rx.nama_usaha))
              || blocks.find((x) => norm(x.nama).includes(norm(rx.nama_usaha)) || norm(rx.nama_usaha).includes(norm(x.nama)));
            if (!b && forcedIdx.has(rx.rowNo)) b = { idx: String(forcedIdx.get(rx.rowNo)), nama: rx.nama_usaha };
            if (!b) continue;
            const tk = `total_pengeluaran#${b.idx}`;
            c.notes = (c.notes || []).filter((n) => {
              if (n.dataKey !== tk) return true;
              n.comments = (n.comments || []).filter((x) =>
                x.comment !== OLD_TXT && String(x.sender || "").trim() !== curUser);
              return n.comments.length > 0;
            });
          }
          for (const k of keys) {
            let note = c.notes.find((x) => x.dataKey === k);
            if (!note) { note = { dataKey: k, comments: [] }; c.notes.push(note); }
            if (!Array.isArray(note.comments)) note.comments = [];
            note.comments = note.comments.filter((x) => x.comment !== OLD_TXT);
            // komentar MILIK kita di kunci ini di-refresh (run sebelumnya bisa pakai
            // teks lain, mis. #4 → kolom `komentar` baru #1) — komentar pengguna
            // lain (sender beda) dipertahankan apa adanya.
            note.comments = note.comments.filter((x) => String(x.sender || "").trim() !== curUser);
            // teks komentar per baris: kolom `komentar` Excel → default KTEXT ("#4")
            const pCom = cc.plan.find((p) => p.comText && p.items.some((it) => `${it.base}#${p.idx}` === k));
            const teks = (pCom && pCom.comText) || KTEXT;
            note.comments.push({ comment: teks, datetime: new Date().toISOString(), sender: curUser });
          }
          // 5) paket 4-file & upload
          const refZip = writeZip([
            { name: "reference.json", data: Buffer.from(JSON.stringify({ details: [], sidebar: [] }), "utf8") },
          ]);
          const zipBuf = writeZip([
            { name: "data.json", data: Buffer.from(JSON.stringify(newerData), "utf8") },
            { name: "comment.json", data: Buffer.from(JSON.stringify(c), "utf8") },
            { name: "media.json", data: Buffer.from(JSON.stringify(rec.media || {}), "utf8") },
            { name: "reference.zip", data: refZip },
          ]);
          const fname = `${aid}_repair_${Date.now()}.zip`;
          const presig = await withRetry((ac) => ac.api.presignEdit(rec.survey_period_id, aid, [fname]), `presign ${aid.slice(0, 8)}`, { pin: acct });
          const first = Array.isArray(presig) ? presig[0] : presig;
          const url = first && first.presignedUrls && first.presignedUrls[0] && first.presignedUrls[0].presignedUrl;
          if (!url) throw new Error("presign tidak mengembalikan URL");
          const fn2 = first.presignedUrls[0].filename || fname;
          await withRetry((ac) => ac.api.s3Put(url, fn2, zipBuf), `s3put ${aid.slice(0, 8)}`, { pin: acct });
          const payload = buildS3EditPayload({ assignmentId: aid, surveyPeriodId: rec.survey_period_id, filename: fn2, size: zipBuf.length, md5: crypto_md5hex(zipBuf), hdata: rec });
          const res = await (async () => {
            try {
              return await withRetry((ac) => ac.api.s3Edit(payload), `s3edit ${aid.slice(0, 8)}`, { pin: acct });
            } catch (e) {
              const m = String((e && e.message) || e);
              if (m.includes("HTTP 500") && m.includes("assignmentStatusId")) return { data: { assignmentStatusAlias: "EDITED BY Admin Kabupaten" } };
              throw e;
            }
          })();
          const alias = res && res.data ? res.data.assignmentStatusAlias : res && res.message;
          done.ok[aid] = { alias: alias || "EDITED?", acct: acct.label, keys: keys.length, fields: changed, skip: cc.skipped.length, unmatch: cc.unmatched.length, ver: newerData.templateVersion, base: baseFile, rows: recsOf(aid).map((r) => r.rowNo), at: new Date().toISOString() };
          if (done.fail) delete done.fail[aid];
          okc++;
          const rxInfo = cc.unmatched.length ? `, TANPA-MATCH=${cc.unmatched.length}` : "";
          console.log(`\n✓ ${i}/${ids.length} ${aid.slice(0, 8)} ver=${newerData.templateVersion} fields=${changed} komentar=${keys.length}${rxInfo} → ${alias}`);
        } catch (e) {
          done.fail = done.fail || {};
          done.fail[aid] = String((e && e.message) || e).slice(0, 200);
          failc++;
          console.log(`\n✗ ${i}/${ids.length} ${aid.slice(0, 8)}: ${done.fail[aid]}`);
        }
        writeFileSync(RPT, JSON.stringify(done, null, 2));
        if (i < ids.length) await sleepR(DELAYR);
      }
      console.log(`\nSelesai: OK=${okc} SKIP=${skipc} GAGAL=${failc} — laporan: bulk-repair.json`);
      break;
    }

    case "export-template": {
      // READ-ONLY (tanpa CDP): buat template CSV format baru dari Excel sumber
      // (--from) + peta bulk-map.json (hasil diag-unmatched.mjs) → diisi manual.
      const fromPath = opts.from || "C:/Users/User/Downloads/Rio_rumus2 (1).xlsx";
      const planf = loadPlan(fromPath);
      const mapM = existsSync(join(HERE, "bulk-map.json"))
        ? JSON.parse(readFileSync(join(HERE, "bulk-map.json"), "utf8")) : null;
      const mapRow = new Map();
      if (mapM) {
        for (const m of mapM.moved || []) mapRow.set(m.rowNo, { v: "MOVED", ke: `${String(m.to).slice(0, 8)}#${m.idx}`, s: m.score });
        for (const m of mapM.reindex || []) mapRow.set(m.rowNo, { v: "REINDEX", ke: `${String(m.to || m.from).slice(0, 8)}#${m.idx}`, s: m.score });
        for (const m of mapM.unresolved || []) mapRow.set(m.rowNo, { v: "NONE", ke: "", s: null });
      }
      const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const HEADER = [
        "nama_usaha", "link_fasih_sm",
        "biaya_pembelian_baru", "biaya_produksi_baru", "biaya_operasional_baru",
        "nilai_pendapatan_baru", "nilai_pendapatan_lainnya_baru",
        "kategori_baru", "kode_kbli_baru", "komentar",
        "baris_lama", "diag",
      ];
      const lines = ["\uFEFF" + HEADER.join(",")];
      for (const r of planf.records) {
        const dg = mapRow.get(r.rowNo);
        const isBaru = planf.mode === "baru";
        lines.push([
          r.nama_usaha,
          r.link,
          // prefill dari format baru (jika memang sudah), format lama dikosongkan
          String(isBaru ? r.pembelian_baru ?? "" : ""),
          String(isBaru ? r.prod_baru ?? "" : ""),
          String(isBaru ? r.op_baru ?? "" : ""),
          String(isBaru ? r.pendapatan_baru ?? "" : ""),
          String(isBaru ? r.pendapatan_lain_baru ?? "" : ""),
          String(isBaru ? r.kategori_baru ?? "" : (r.kategori ?? "")),
          String(isBaru ? r.kode_kbli_baru ?? "" : (r.kode_kbli ?? "")),
          String(isBaru ? r.komentar ?? "" : ""), // komentar — diisi manual
          r.rowNo,
          dg ? `${dg.v}${dg.ke ? " → " + dg.ke : ""}${dg.s != null ? " (skor " + dg.s + ")" : ""}` : "",
        ].map(esc).join(","));
      }
      const outF = opts.out || "template-baru.csv";
      writeFileSync(join(HERE, outF), lines.join("\r\n"));
      const nMap = mapM ? mapRow.size : 0;
      console.log(`✓ ${planf.records.length} baris → ${outF} (format sumber: ${planf.mode}${mapM ? `, peta ${nMap} baris` : ", peta belum ada"})`);
      console.log("  Buka di Excel → isi kolom nilai + komentar → Save As .xlsx → bulk-repair --excel <file> --map bulk-map.json");
      break;
    }

    case "bulk-misses": {
      // READ-ONLY (tanpa CDP): daftar baris Excel yang MASIH butuh tindakan MANUAL —
      // kelewat bulk, gagal bulk/repair, tanpa kunci biaya, no-field/tanpa-match.
      // Semua bisa dibuka langsung dari kolom link. `--watch N` refresh tiap N detik.
      //
      // MODE SHEET2 (--excel <f> --sheet <s> [--map bulk-map-s2.json]): monitor hasil
      // bulk-repair (biaya + komentar #4) — beres = target aid OK dgn unmatch=0
      // (fields=0 berarti nilai memang sudah sama ditimpa tadi).
      const excel = opts.excel || "C:/Users/User/Downloads/Rio_rumus2 (1).xlsx";
      const stM = existsSync(join(HERE, "bulk-state.json")) ? JSON.parse(readFileSync(join(HERE, "bulk-state.json"), "utf8")) : { done: {}, fail: {} };
      const repM = existsSync(join(HERE, "bulk-repair.json")) ? JSON.parse(readFileSync(join(HERE, "bulk-repair.json"), "utf8")) : { ok: {}, fail: {} };
      const repOk = new Map(Object.entries(repM.ok || {}));
      const repFail = new Map(Object.entries(repM.fail || {}));

      let rowsOut = [];
      if (opts.sheet) {
        // ------------------------------------------------------ mode Sheet2 (repair)
        const planfd = loadPlan(excel, { sheet: opts.sheet });
        const mapM = opts.map && existsSync(opts.map)
          ? JSON.parse(readFileSync(opts.map, "utf8"))
          : { moved: [], reindex: [], unresolved: [] };
        // rowNo → aid target (moved/reindex)
        const routed = new Map();
        for (const m of mapM.moved || []) if (m.rowNo != null) routed.set(m.rowNo, m.to);
        for (const m of mapM.reindex || []) if (m.rowNo != null) routed.set(m.rowNo, m.to || m.from);
        const unresolved = new Set((mapM.unresolved || []).map((u) => u.rowNo));

        // Entri repair yang dihitung BERES hanya dari RUN Sheet2 (era >= --since;
        // default 2026-10-21). Entri lama milik Sheet1 — nomor barisnya BERIRAMA
        // (1..615 vs 4..275), bisa saling merangkap dan memberi "beres" palsu.
        // Catatan: bulk-state.done (tulis bulk-edit lama) TIDAK dihitung di mode ini
        // karena alasan yang sama.
        const SINCE = new Date(opts.since || "2026-10-21T00:00:00").getTime();
        const beresRows = new Set();
        for (const e of repOk.values()) {
          const t = e.at ? Date.parse(String(e.at)) : 0;
          if (t && t < SINCE) continue;
          if ((e.unmatch || 0) === 0 && ((e.keys || 0) > 0 || (e.fields || 0) > 0))
            for (const rn of e.rows || []) beresRows.add(rn);
        }

        for (const r of planfd.records) {
          const aid = r.assignmentId || "";
          const eff = routed.get(r.rowNo) || aid;
          let status = null, alasan = "";
          if (beresRows.has(r.rowNo)) continue;
          if (repFail.has(eff)) { status = "REPAIR-GAGAL"; alasan = String(repFail.get(eff)).slice(0, 110); }
          else if (unresolved.has(r.rowNo)) { status = "TANPA-MATCH"; alasan = "blok usaha tidak kena di mana pun (peta NONE) — isi manual dari link"; }
          else if (repOk.has(eff) && ((repOk.get(eff).keys || 0) === 0)) { status = "TANPA-KUNCI"; alasan = "template tidak berisi field biaya di blok — isi & komentar #4 manual"; }
          else if (repOk.has(eff) && ((repOk.get(eff).unmatch || 0) > 0)) { status = "TANPA-MATCH"; alasan = `blok tidak ketemu di assignment ini (unmatch ${repOk.get(eff).unmatch}) — cek link/peta`; }
          else { status = "KELEWAT-BULK"; alasan = "tidak tercatat OK/GAGAL di bulk-repair — jalankan bulk-repair --resume"; }
          rowsOut.push({ rowNo: r.rowNo, nama: r.nama_usaha, aid: eff, status, alasan, link: r.link || "" });
        }
      } else {
        // ------------------------------------------------------ mode lama (Sheet1/bulk-plan)
        const okRep = repOk, failRep = repFail;
        const planM = opts["no-plan"]
          ? { assignments: [] } // Excel universe BARU — bulk-plan lama tidak relevan (nomor baris tabrakan)
          : existsSync(join(HERE, "bulk-plan.json")) ? JSON.parse(readFileSync(join(HERE, "bulk-plan.json"), "utf8")) : { assignments: [] };
        const planfd = loadPlan(excel);
        const failBulk = new Map(Object.entries(stM.fail || {}));
        const unmatchedRow = new Map();
        const noFieldRow = new Map();
        for (const a of planM.assignments || []) {
          for (const u of a.unmatched || []) unmatchedRow.set(u.rowNo, a.assignmentId);
          for (const p of a.planEntries || []) if (p.noFields) noFieldRow.set(p.rowNo, a.assignmentId);
        }
        const rowsOf = (aid) =>
          planfd.records.filter((r) => (r.assignmentId || "").slice(0, 8) === aid.slice(0, 8)).map((r) => r.rowNo);
        const beresRows = new Set();
        for (const aid of okRep.keys())
          if ((okRep.get(aid).keys || 0) > 0) for (const rn of rowsOf(aid)) beresRows.add(rn);
        for (const info of Object.values(stM.done || {}))
          for (const rn of info.rows || []) beresRows.add(rn);

        for (const r of planfd.records) {
          const aid = r.assignmentId || "";
          let status = null, alasan = "";
          if (failBulk.has(aid)) { status = "BULK-GAGAL"; alasan = String(stM.fail[aid]).slice(0, 110); }
          else if (failRep.has(aid)) { status = "REPAIR-GAGAL"; alasan = String(repM.fail[aid]).slice(0, 110); }
          else if (okRep.has(aid) && (okRep.get(aid).keys || 0) === 0) { status = "TANPA-KUNCI"; alasan = "repair OK tapi kunci biaya tidak ada di template — isi & komentar #4 manual"; }
          else if (unmatchedRow.has(r.rowNo)) { status = "TANPA-MATCH"; alasan = "nama_usaha tidak ketemu di data.json (cek bulk-map.json)"; }
          else if (noFieldRow.has(r.rowNo)) { status = "NO-FIELD"; alasan = "blok ketemu tapi field biaya tidak ada di idx itu (cek bulk-map.json)"; }
          else if (!beresRows.has(r.rowNo)) { status = "KELEWAT-BULK"; alasan = "tidak tercatat tertulis oleh bulk-edit maupun repair"; }
          if (!status) continue;
          rowsOut.push({ rowNo: r.rowNo, nama: r.nama_usaha, aid, status, alasan, link: r.link || "" });
        }
      }

      // --out <basis> : nama file keluaran kustom (tanpa ekstensi) supaya monitor
      // per-Excel tidak saling menimpa (mis. --out misses-bu-yanti)
      const baseOut = opts.out ? String(opts.out).replace(/\.csv$/i, "").replace(/\.json$/i, "") : null;
      const OUT_CSV_M = baseOut ? join(HERE, baseOut + ".csv") : join(HERE, opts.sheet ? "bulk-misses-s2.csv" : "bulk-misses.csv");
      const OUT_JSON_M = baseOut ? join(HERE, baseOut + ".json") : join(HERE, opts.sheet ? "bulk-misses-s2.json" : "bulk-misses.json");
      const runOnce = () => {
        const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
        writeFileSync(OUT_CSV_M, [
          "baris,nama_usaha,assignment,status,alasan,link",
          ...rowsOut.map((x) => [x.rowNo, x.nama, x.aid.slice(0, 8), x.status, x.alasan, x.link].map(esc).join(",")),
        ].join("\r\n"));
        writeFileSync(OUT_JSON_M, JSON.stringify(rowsOut, null, 1));
        return rowsOut;
      };
      const show = (rows) => {
        const c = {};
        for (const x of rows) c[x.status] = (c[x.status] || 0) + 1;
        console.log(`\n[${new Date().toISOString().slice(11, 19)}] perlu manual: ${rows.length}`);
        for (const [k, v] of Object.entries(c)) console.log(`   ${k.padEnd(13)} ${v}`);
        for (const x of rows.slice(0, 15)) console.log(`   r${String(x.rowNo).padEnd(4)} ${x.status.padEnd(13)} ${String(x.nama).slice(0, 36)}`);
        console.log(`   → ${OUT_CSV_M.split(/[\\/]/).pop()} / ${OUT_JSON_M.split(/[\\/]/).pop()}${opts.watch ? "" : "  (--watch N untuk refresh otomatis)"}`);
      };
      let rows = runOnce();
      show(rows);
      if (opts.watch) {
        const secs = Number(opts.watch) || 15;
        console.log(`watch: refresh tiap ${secs}s — Ctrl+C berhenti`);
        for (;;) {
          await new Promise((r) => setTimeout(r, secs * 1000));
          rows = runOnce();
          if (typeof console.clear === "function") console.clear();
          show(rows);
        }
      }
      break;
    }

    case "bulk-revert-suspect": {
      // kembalikan nilai lama (dari cache pra-edit) untuk assignment terseleksi —
      // tanpa mengubah apa pun di data.json (cache berisi data asli). Komentar
      // "revisi" ditambahkan di field total_pengeluaran#<idx>.
      await boot();
      const SUS = existsSync(join(HERE, "bulk-suspect.json"))
        ? JSON.parse(readFileSync(join(HERE, "bulk-suspect.json"), "utf8"))
        : [];
      if (!SUS.length) die("bulk-suspect.json kosong / tidak ada daftar");
      const state2 = existsSync(join(HERE, "bulk-state.json"))
        ? JSON.parse(readFileSync(join(HERE, "bulk-state.json"), "utf8"))
        : { done: {}, fail: {} };
      console.log(`Revert ${SUS.length} assignment ke nilai lama (paket 4 file seperti SPA).`);
      if (!opts.yes) {
        const ok = await confirm(`Lanjut revert ${SUS.length} assignment (konfirmasi terakhir)?`);
        if (!ok) die("dibatalkan");
      }
      const RTEXT = opts.komentar || "Nilai dikembalikan ke data sebelumnya (revisi)";
      const sleepR = (ms) => new Promise((r) => setTimeout(r, ms));
      const DELAYR = Number(opts.delay || 2000);
      const withRetry = (fn, label, o = {}) => pool.withRetry(fn, label, o);
      const out = [];
      let okr = 0, failr = 0;
      for (let k = 0; k < SUS.length; k++) {
        const row = SUS[k];
        // lengkapi id penuh dari state
        const aid = Object.keys(state2.done).find((x) => x.startsWith(row.aid));
        if (!aid) { console.log(`✗ ${row.aid}: id penuh tidak ketemu di state`); continue; }
        const cf = join(HERE, "bulk-cache", `${aid}.json`);
        const hdata = JSON.parse(readFileSync(cf, "utf8"));
        const dataJson = JSON.parse(hdata.data);
        process.stdout.write(`revert ${k + 1}/${SUS.length} ${aid.slice(0, 8)} (baris ${row.baris})          \r`);
        try {
          const sender = hdata.current_user_username || hdata.current_user_fullname || "";
          // catat di komentar field total_pengeluaran semua blok yang tercantum
          const planLike = [{ idx: row.idx || "1", items: [{ base: "total_pengeluaran" }], rec: { rowNo: row.baris } }];
          const commentObj = buildCommentJson(hdata, planLike, RTEXT, sender);
          const refZip = writeZip([
            { name: "reference.json", data: Buffer.from(JSON.stringify({ details: [], sidebar: [] }), "utf8") },
          ]);
          const zipBuf = writeZip([
            { name: "data.json", data: Buffer.from(JSON.stringify(dataJson), "utf8") },
            { name: "comment.json", data: Buffer.from(JSON.stringify(commentObj), "utf8") },
            { name: "media.json", data: Buffer.from(JSON.stringify(hdata.media || {}), "utf8") },
            { name: "reference.zip", data: refZip },
          ]);
          const acct = await pool.pick();
          await withRetry(
            (ac) => uploadPackage(ac.api, aid, zipBuf, {
              hdata,
              surveyPeriodId: hdata.survey_period_id || cfg.periodId,
              filename: `${aid}_revert_${Date.now()}.zip`,
            }),
            `revert ${aid.slice(0, 8)}`,
            { pin: acct },
          );
          okr++;
          out.push({ id: aid, ok: true, baris: row.baris });
          console.log(`\n✓ ${k + 1}/${SUS.length} ${aid.slice(0, 8)} nilai lama dikembalikan`);
        } catch (e) {
          failr++;
          out.push({ id: aid, ok: false, error: String((e && e.message) || e).slice(0, 200) });
          console.log(`\n✗ ${k + 1}/${SUS.length} ${aid.slice(0, 8)}: ${String(e.message || e).slice(0, 120)}`);
        }
        if (k < SUS.length - 1) await sleepR(DELAYR);
      }
      writeFileSync(join(HERE, "bulk-revert.json"), JSON.stringify({ at: new Date().toISOString(), ok: okr, fail: failr, results: out }, null, 2));
      console.log(`\nSelesai: OK=${okr} GAGAL=${failr} — detail: bulk-revert.json`);
      break;
    }

    case "bulk-status": {
      // monitoring tanpa CDP: baca bulk-progress.json + bulk-state.json + Excel
      let excel = opts.excel;
      if (!excel) excel = "C:/Users/User/Downloads/Rio_rumus2 (1).xlsx";
      const PROGRESS = join(HERE, "bulk-progress.json");
      const STATE2 = join(HERE, "bulk-state.json");
      if (!existsSync(PROGRESS)) {
        for (const w of [excel, "C:/Users/User/Downloads/Rio_rumus2 (1).xlsx", "C:/Users/User/Downloads/Rio_rumus2.xlsx", "C:/Users/User/Downloads/Cleaning Rio.xlsx"]) {
          if (existsSync(w)) { try { loadPlan(w); excel = w; break; } catch { } }
        }
      }
      const showOnce = () => {
        let prog = {};
        try { prog = JSON.parse(readFileSync(PROGRESS, "utf8")); } catch { }
        const st = existsSync(STATE2) ? JSON.parse(readFileSync(STATE2, "utf8")) : { done: {}, fail: {} };
        const doneIds = Object.keys(st.done || {});
        const failIds = Object.keys(st.fail || {});
        console.log(`\n[${prog.at || "?"}] fase: ${prog.fase || "-"}  posisi: ${prog.posisi || "-"}  assignment: ${String(prog.assignment || "").slice(0, 8)}`);
        console.log(`        server-side EDITED: ${doneIds.length}  |  gagal: ${failIds.length}`);
        // baris Excel — indeks keluarga: assignment berjalan/belum selesai
        const rm = prog.rowMap || {};
        const entries = Object.entries(rm).sort((a, b) => Number(a[0]) - Number(b[0]));
        const last = entries[entries.length - 1];
        const cur = entries.filter(([, v]) => v && (v.state === "applying" || v.state === "fetching" || v.state === "resolusi"));
        let kel = "";
        if (cur.length) {
          const aids = [...new Set(cur.map(([, v]) => String(v.aid || "").slice(0, 8)))].join("+");
          kel = `sedang: baris ${cur.map(([r]) => r).join(",")} (${aids})`;
        } else if (last) {
          kel = `progres terakhir: baris ${last[0]} (${String(last[1].aid || "").slice(0, 8)}, ${last[1].state})`;
        }
        console.log(`        ${kel}`);
        // selesai/tersisa per baris berdasarkan state.done rows
        const doneRows = new Set();
        for (const [, v] of Object.entries(st.done || {})) for (const r of v.rows || []) doneRows.add(Number(r));
        const planf2 = (() => { try { return loadPlan(excel); } catch { return null; } })();
        if (planf2) {
          const all = planf2.records.map((r) => r.rowNo);
          const remaining = all.filter((r) => !doneRows.has(r));
          console.log(`        baris Excel sudah teredit: ${doneRows.size}/${planf2.totalRows} — sisa ${remaining.length}`);
          const nextRows = remaining.slice(0, opts.tail ? Number(opts.tail) : 8);
          if (nextRows.length)
            console.log(`        berikutnya: ` + nextRows.map((r) => {
              const rec = planf2.records.find((x) => x.rowNo === r);
              return `r${r}:${String(rec.nama_usaha).slice(0, 22)}`;
            }).join(" | "));
        }
        if (opts.detail) {
          for (const [id, v] of Object.entries(st.done)) console.log(`  ✓ ${id.slice(0, 8)} ${v.alias} (${v.fields} field, baris ${(v.rows || []).join(",")}) @${v.at}`);
          for (const [id, v] of Object.entries(st.fail)) console.log(`  ✗ ${id.slice(0, 8)}: ${v}`);
        }
      };
      if (opts.watch) {
        const N = Number(opts.every || 5);
        console.log(`Monitor (Ctrl+C berhenti; refresh ${N} dtk):`);
        for (;;) {
          console.clear();
          showOnce();
          await new Promise((r) => setTimeout(r, N * 1000));
        }
      } else showOnce();
      break;
    }

    case "robot-cek": {
      // audit robot baru.xlsx vs L Blok I (read-only) — skrip mandiri
      await import("./robot-cek.mjs");
      break;
    }

    case "robot-tulis": {
      // tulis komentar #0 ke nik_dtsen#N sesuai hasil robot-cek — skrip mandiri
      await import("./robot-tulis.mjs");
      break;
    }

    default:
      die(`Perintah tidak dikenal: ${cmd} (lihat help)`);
  }
} catch (e) {
  die(e && e.stack ? e.stack.split("\n").slice(0, 4).join("\n") : e);
} finally {
  if (pool) for (const a of pool.accounts) a.page.close();
}
