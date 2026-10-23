/**
 * diag-package.mjs — unduh paket asli (.7z) & bandingkan dengan data yang kita kirim
 * (cache bulk-cache = basis upload). Laporan: daftar file paket + diff data.json.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { findFasihPage } from "./lib/cdp.mjs";
import { createFasihApi } from "./lib/api.mjs";

const TMP = "C:/Users/User/AppData/Local/Temp/opencode/7zcheck";
const EXT = join(TMP, "ext");
const AID0 = process.argv[2] || "0d0e1e37";

const page = await findFasihPage(9222);
const api = createFasihApi(page);
const st = JSON.parse(readFileSync("./bulk-state.json", "utf8"));
const full = Object.keys(st.done).find((x) => x.startsWith(AID0)) || AID0;

const hist = await api.history(full);
const arr = Array.isArray(hist) ? hist : (hist.data || hist.content || []);
const entries = arr.filter((h) => h.base_path).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
console.log(`entri ber-file (${full.slice(0, 8)}):`);
for (const e of entries.slice(0, 4)) console.log(`  ${e.created_at}  ${e.base_path.split("/").pop()}`);

// paket asli = .7z terbaru SEBELUM zip kita (kios kelola CAPI/pengawas)
const zlist = entries.filter((e) => /\.7z$/i.test(String(e.base_path)));
const old = zlist.sort((a, b) => String(b.base_path).localeCompare(String(a.base_path)))[0];
if (!old) { console.log("tidak ada paket .7z"); process.exit(0); }
const fname = old.base_path.split("/").pop();
console.log(`\npaket dianalisis: ${fname} (${old.created_at})`);

// survey period dari getAssignmentExcludeData (hemat: tidak membawa data besar)
const brief = await api.getAssignmentExcludeData(full);
const spid = brief.survey_period_id || brief.surveyPeriodId;
console.log("surveyPeriodId:", String(spid).slice(0, 8) + "…");

const presigned = JSON.parse(JSON.stringify(await api.presignDownload(spid, full, [fname])));
const pr = (Array.isArray(presigned) ? presigned[0] : presigned).presignedUrls?.[0]?.presignedUrl;
if (!pr) { console.log("presign-download gagal:", JSON.stringify(presigned).slice(0, 200)); process.exit(1); }
// unduh S3 langsung dari Node (CORS tidak selalu mengizinkan GET dari halaman)
const resp = await fetch(pr);
if (!resp.ok) { console.log("S3 GET gagal:", resp.status); process.exit(1); }
const ab = await resp.arrayBuffer();
const buf = Buffer.from(ab);
console.log("unduh:", buf.length, "bytes");
writeFileSync(join(TMP, fname), buf);

rmSync(EXT, { recursive: true, force: true });
mkdirSync(EXT, { recursive: true });
execFileSync(join(TMP, "7zr.exe"), ["x", "-y", `-o${EXT}`, join(TMP, fname)], { stdio: "pipe" });
const files = readdirSync(EXT);
console.log("isi paket asli:", files.join(", "));

const dz = files.find((f) => f.toLowerCase() === "data.json");
if (dz) {
  const pkg = JSON.parse(readFileSync(join(EXT, dz), "utf8"));
  const pkgKeys = new Set((pkg.answers || []).map((a) => String(a.dataKey)));
  const cf = readdirSync("./bulk-cache").find((x) => x.startsWith(full.slice(0, 8)));
  const cache = JSON.parse(readFileSync(join("./bulk-cache", cf), "utf8"));
  const up = JSON.parse(cache.data);
  const upKeys = new Set((up.answers || []).map((a) => String(a.dataKey)));
  console.log(`answers: paket-asli=${pkgKeys.size}  cache/upload=${upKeys.size}`);
  const missingInUp = [...pkgKeys].filter((k) => !upKeys.has(k));
  const missingInPkg = [...upKeys].filter((k) => !pkgKeys.has(k));
  console.log("kunci HANYA di paket asli (hilang dari upload):", missingInUp.length, missingInUp.slice(0, 12).join(", "));
  console.log("kunci HANYA di upload:", missingInPkg.length, missingInPkg.slice(0, 8).join(", "));
  let diffVal = 0;
  for (const k of pkgKeys) {
    const a = (pkg.answers || []).find((x) => x.dataKey === k);
    const b = (up.answers || []).find((x) => x.dataKey === k);
    if (b && JSON.stringify(a.answer) !== JSON.stringify(b.answer)) {
      diffVal++;
      if (diffVal <= 10 && !/biaya_produksi|operasional|total_pengeluaran/.test(k))
        console.log(`   beda nilai (bukan 3 field): ${k}: ${JSON.stringify(a.answer).slice(0, 30)} vs ${JSON.stringify(b.answer).slice(0, 30)}`);
    }
  }
  console.log("jumlah nilai beda (termasuk 3 field biaya):", diffVal);
  // templateVersion & keys lain
  for (const k of ["templateVersion", "validationVersion", "createdAt", "updatedAt", "isForceSubmit"])
    if (JSON.stringify(pkg[k]) !== JSON.stringify(up[k])) console.log(`   beda paket-vs-upload[${k}]: ${JSON.stringify(pkg[k])} vs ${JSON.stringify(up[k])}`);
}
process.exit(0);
