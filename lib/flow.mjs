/**
 * lib/flow.mjs — operasi tingkat tinggi: download paket, edit, upload, ubah status.
 * Dipakai oleh CLI (fasih-sm.mjs).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { readZip, writeZip, md5hex } from "./zip.mjs";

/**
 * Ambil nama file paket TERBARU dari riwayat assignment.
 * Catatan penting: field created_at daftar riwayat server sering undefined —
 * urutan yang benar dipakai dari timestamp di NAMA FILE (…_<mtime>.7z/.zip),
 * yang menaik mulut (lexicographic = urutan waktu karena panjang sama).
 */
export function latestZipFilename(historyData) {
  const arr = Array.isArray(historyData)
    ? historyData
    : historyData && Array.isArray(historyData.content)
      ? historyData.content
      : historyData && Array.isArray(historyData.data)
        ? historyData.data
        : [];
  if (!arr.length) return null;
  const withFile = arr.filter((h) => (h && (h.basePath || h.base_path)));
  if (!withFile.length) return null;
  const pathOf = (h) => String(h.basePath || h.base_path);
  const mtime = (h) => {
    const m = /_(\d{12,})\.(?:zip|7z)$/i.exec(pathOf(h).split("/").pop() || "");
    const explicit = Date.parse((h && (h.created_at || h.date_created || h.createdAt)) || "");
    if (m) return Number(m[1]);
    return Number.isFinite(explicit) ? explicit : 0;
  };
  withFile.sort((a, b) => mtime(b) - mtime(a));
  return pathOf(withFile[0]).split("/").pop() || null;
}

/** Bangun payload POST s3/edit persis seperti SPA (template dari capture live). */
export function buildS3EditPayload({ assignmentId, surveyPeriodId, filename, size, md5, hdata }) {
  const d = (n) => (hdata && (hdata["data" + n] != null ? String(hdata["data" + n]) : "")) || "";
  return {
    filename,
    start: "0",
    end: String(size - 1),
    length: String(size),
    md5,
    surveyPeriodeId: surveyPeriodId,
    assignmentId,
    createStatus: "false",
    draftStatus: "false",
    regionId: (hdata && hdata.region && (hdata.region.id || hdata.region._id)) || "",
    sourceFrom: "SCM-EDIT",
    data1: d(1),
    data2: d(2),
    data3: d(3),
    data4: d(4),
    data5: d(5),
    data6: d(6),
    data7: d(7),
    data8: d(8),
    data9: d(9),
    data10: d(10),
  };
}

/** Unduh paket terbaru sebuah assignment (.zip/.7z). Mengembalikan buf=null bila gagal. */
export async function downloadPackage(api, assignmentId, opts = {}) {
  const detail = await api.getAssignment(assignmentId);
  const surveyPeriodId = detail.survey_period_id;
  let filename = opts.filename;
  if (!filename) {
    const hist = await api.history(assignmentId);
    filename = latestZipFilename(hist);
    if (!filename) throw new Error(`Tidak ada basePath/zip di riwayat assignment ${assignmentId}`);
  }
  try {
    const presigned = await api.presignDownload(surveyPeriodId, assignmentId, [filename]);
    const first = Array.isArray(presigned) ? presigned[0] : presigned;
    const url = first && first.presignedUrls && first.presignedUrls[0] && first.presignedUrls[0].presignedUrl;
    if (!url) throw new Error(`presign-url-get tidak mengembalikan URL: ${JSON.stringify(presigned).slice(0, 300)}`);
    const buf = await api.s3Get(url);
    return { buf, filename, surveyPeriodId, detail };
  } catch (e) {
    if (opts.onDownloadError) opts.onDownloadError(e);
    return { buf: null, filename, surveyPeriodId, detail };
  }
}

/** Bangun entri data.json dari endpoint riwayat (fallback untuk paket .7z dsb). */
export async function entriesFromHistoryData(api, assignmentId, filename) {
  const hdata = await api.historyData(assignmentId, filename);
  const dataStr = typeof hdata.data === "string" ? hdata.data : JSON.stringify(hdata.data ?? {});
  return [{ name: "data.json", data: Buffer.from(dataStr, "utf8") }];
}

/** Jalur upload lengkap: presign-edit → PUT S3 → POST s3/edit (status = EDITED). */
export async function uploadPackage(api, assignmentId, zipBuf, opts = {}) {
  const detail = await api.getAssignment(assignmentId);
  const surveyPeriodId = opts.surveyPeriodId || detail.survey_period_id;
  const filename = opts.filename || `${assignmentId}_${Date.now()}.zip`;

  let hdata = opts.hdata;
  if (!hdata) {
    let baseName = null;
    try {
      const hist = await api.history(assignmentId);
      baseName = latestZipFilename(hist);
    } catch { /* boleh gagal, fallback kosong */ }
    hdata = await api.historyData(assignmentId, baseName || filename);
  }

  const presigned = await api.presignEdit(surveyPeriodId, assignmentId, [filename]);
  const first = Array.isArray(presigned) ? presigned[0] : presigned;
  const url = first && first.presignedUrls && first.presignedUrls[0] && first.presignedUrls[0].presignedUrl;
  if (!url) throw new Error(`presign-url tidak mengembalikan URL: ${JSON.stringify(presigned).slice(0, 300)}`);

  await api.s3Put(url, filename, zipBuf);

  const payload = buildS3EditPayload({
    assignmentId,
    surveyPeriodId,
    filename,
    size: zipBuf.length,
    md5: md5hex(zipBuf),
    hdata,
  });
  if (opts.dryRun) {
    return { dry: true, payload };
  }
  const resp = await api.s3Edit(payload);
  return { status: resp.status, message: resp.message, data: resp.data, payload };
}

/** Edit penuh: ambil isi (zip atau data.json dari riwayat) → transform → rezip → upload. */
export async function editAssignment(api, assignmentId, opts = {}) {
  const { buf, filename: originName, surveyPeriodId, detail } = await downloadPackage(api, assignmentId, {
    filename: opts.filename,
    onDownloadError: (e) => console.log(`  [!] unduh paket gagal (${String(e.message || e).slice(0, 120)}) — fallback dari riwayat`),
  });

  let entries;
  if (buf && originName && originName.toLowerCase().endsWith(".zip")) {
    entries = readZip(buf);
  } else {
    if (buf && originName) console.log(`  [i] paket origin ${originName} bukan format .zip — data.json dibangun dari riwayat`);
    else console.log(`  [i] paket origin tidak terunduh — data.json dibangun dari riwayat`);
    entries = await entriesFromHistoryData(api, assignmentId, originName);
  }

  if (opts.transform) {
    const tPath = resolve(opts.transform);
    if (!existsSync(tPath)) throw new Error(`Transform tidak ada: ${tPath}`);
    const mod = await import(pathToFileURL(tPath).href);
    const fn = mod.default || mod;
    if (typeof fn !== "function") throw new Error(`Transform harus export default function: ${tPath}`);
    const dataEntry = entries.find((e) => e.name === "data.json");
    let dataJson = null;
    if (dataEntry) {
      try { dataJson = JSON.parse(dataEntry.data.toString("utf8")); } catch { /* biarkan null */ }
    }
    const result = await fn({
      assignmentId,
      entries,
      dataJson,
      meta: { originName, surveyPeriodId, detail },
    });
    if (result && Array.isArray(result.entries)) entries = result.entries;
    else if (result && result.dataJson !== undefined) {
      const enc = Buffer.from(JSON.stringify(result.dataJson), "utf8");
      const i = entries.findIndex((e) => e.name === "data.json");
      if (i >= 0) entries[i] = { ...entries[i], data: enc };
      else entries.push({ name: "data.json", data: enc });
    } else if (result) throw new Error("Transform harus return {entries} atau {dataJson}");
  }

  const newZip = writeZip(entries);
  if (opts.saveDir) {
    mkdirSync(opts.saveDir, { recursive: true });
    const out = join(opts.saveDir, `${assignmentId}_edited.zip`);
    writeFileSync(out, newZip);
    console.log(`  [i] zip hasil edit disimpan: ${out}`);
  }
  return { zipBuf: newZip, entries, surveyPeriodId, originName };
}
