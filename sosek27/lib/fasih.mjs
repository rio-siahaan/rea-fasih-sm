/**
 * lib/fasih.mjs — operasi FASIH-SM khusus sosial27:
 *   - baca assignment + komentar
 *   - cocokkan NIK file ke nik_dtsen#N (bisa anggota mana pun)
 *   - tambah #0 ke no_kk (Blok P) dan nik_dtsen#N (L Blok I)
 *   - upload satu paket per assignment + verifikasi
 */
import { writeZip, md5hex } from "../../lib/zip.mjs";
import { buildS3EditPayload } from "../../lib/flow.mjs";

function parseJson(v) {
  if (typeof v !== "string") return v;
  if (!v.trim()) return null;
  try { return JSON.parse(v); } catch { return null; }
}

function answerValue(v) {
  if (Array.isArray(v)) v = v[0];
  if (v == null) return "";
  if (typeof v === "object") return String(v.value ?? v.label ?? "").trim();
  return String(v).trim();
}

export function digits(v) {
  return String(v ?? "").replace(/\D+/g, "");
}

export function parseAssignment(rec) {
  const data = parseJson(rec?.data) || {};
  const answers = Array.isArray(data.answers) ? data.answers : [];
  const byKey = new Map();
  for (const a of answers) byKey.set(String(a.dataKey || ""), a.answer);

  const noKk = answerValue(byKey.get("no_kk"));
  const namaKk = answerValue(byKey.get("nama_kk"));
  const members = [];
  for (const [key, value] of byKey) {
    const m = /^nik_dtsen#(\d+)$/.exec(key);
    if (!m) continue;
    const idx = m[1];
    members.push({
      idx,
      nik: answerValue(value),
      nama: answerValue(byKey.get(`nama_dtsen#${idx}`)),
      urut: answerValue(byKey.get(`no_urut_kk#${idx}`)),
    });
  }
  members.sort((a, b) => Number(a.idx) - Number(b.idx));

  const comment = parseJson(rec?.comment) || { dataKey: "", notes: [] };
  if (!Array.isArray(comment.notes)) comment.notes = [];
  const commentsByKey = new Map();
  for (const note of comment.notes) {
    const key = String(note.dataKey || "");
    commentsByKey.set(key, (note.comments || []).map((x) => String(x.comment || "").trim()));
  }

  return {
    data,
    noKk,
    namaKk,
    members,
    comment,
    commentsByKey,
    statusAlias: String(rec?.assignment_status_alias || rec?.assignmentStatusAlias || "").trim(),
    currentUser: String(rec?.current_user_username || "").trim(),
  };
}

/** Cocokkan NIK file ke satu anggota; exact dulu, lalu prefix 12 digit. */
export function matchMember(parsed, fileNik) {
  const target = digits(fileNik);
  if (!target) throw new Error("NIK file kosong");

  const exact = parsed.members.filter((m) => digits(m.nik) === target);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) {
    throw new Error(`NIK ${target} cocok ke ${exact.length} anggota: ${exact.map((m) => `#${m.idx}`).join(", ")}`);
  }

  const prefix = target.slice(0, 12);
  const pref = parsed.members.filter((m) => digits(m.nik).slice(0, 12) === prefix);
  if (pref.length === 1) return pref[0];
  if (pref.length > 1) {
    throw new Error(`NIK ${target} cocok ke ${pref.length} anggota via prefix: ${pref.map((m) => `#${m.idx}`).join(", ")}`);
  }
  throw new Error(`NIK ${target} tidak ditemukan di nik_dtsen#N`);
}

export function targetKeys(parsed, member) {
  if (!parsed.noKk) throw new Error("no_kk kosong di assignment");
  if (!member) throw new Error("anggota tidak ditemukan");
  return ["no_kk", `nik_dtsen#${member.idx}`];
}

/** Tambah #0 tanpa menghapus komentar lain. */
export function addZeroComments(parsed, keys) {
  const added = [];
  const already = [];
  for (const key of keys) {
    let note = parsed.comment.notes.find((n) => String(n.dataKey || "") === key);
    if (!note) {
      note = { dataKey: key, comments: [] };
      parsed.comment.notes.push(note);
    }
    if (!Array.isArray(note.comments)) note.comments = [];
    const hasZero = note.comments.some((x) => String(x.comment || "").trim() === "#0");
    if (hasZero) {
      already.push(key);
      continue;
    }
    note.comments.push({
      comment: "#0",
      datetime: new Date().toISOString(),
      sender: parsed.currentUser,
    });
    added.push(key);
  }
  return { added, already };
}

function buildZip(rec, comment) {
  const refZip = writeZip([
    { name: "reference.json", data: Buffer.from(JSON.stringify({ details: [], sidebar: [] }), "utf8") },
  ]);
  const dataStr = typeof rec.data === "string" ? rec.data : JSON.stringify(rec.data ?? {});
  return writeZip([
    { name: "data.json", data: Buffer.from(dataStr, "utf8") },
    { name: "comment.json", data: Buffer.from(JSON.stringify(comment), "utf8") },
    { name: "media.json", data: Buffer.from(JSON.stringify(rec.media || {}), "utf8") },
    { name: "reference.zip", data: refZip },
  ]);
}

async function uploadComment(withRetry, rec, aid, comment) {
  const zipBuf = buildZip(rec, comment);
  const fn = `${aid}_edit_${Date.now()}.zip`;
  const presig = await withRetry((ac) => ac.api.presignEdit(rec.survey_period_id, aid, [fn]), `presign ${aid.slice(0, 8)}`);
  const first = Array.isArray(presig) ? presig[0] : presig;
  const url = first?.presignedUrls?.[0]?.presignedUrl;
  if (!url) throw new Error("presign tidak mengembalikan URL");
  const filename = first.presignedUrls[0].filename || fn;
  await withRetry((ac) => ac.api.s3Put(url, filename, zipBuf), `s3put ${aid.slice(0, 8)}`);

  const payload = buildS3EditPayload({
    assignmentId: aid,
    surveyPeriodId: rec.survey_period_id,
    filename,
    size: zipBuf.length,
    md5: md5hex(zipBuf),
    hdata: rec,
  });

  try {
    return await withRetry((ac) => ac.api.s3Edit(payload), `s3edit ${aid.slice(0, 8)}`);
  } catch (e) {
    const m = String((e && e.message) || e);
    if (m.includes("HTTP 500") && m.includes("assignmentStatusId")) {
      return { data: { assignmentStatusAlias: "EDITED BY Admin Kabupaten" }, _500ok: true };
    }
    throw e;
  }
}

/**
 * Proses satu assignment.
 * Return status: SIAP (dry-run), SUDAH ADA, BERHASIL, atau GAGAL.
 */
export async function processAssignment({ pool, aid, fileNik, dryRun = false }) {
  const acct = await pool.pick();
  const withRetry = (fn, label) => pool.withRetry(fn, label, { pin: acct });

  const rec = await withRetry((ac) => ac.api.getAssignment(aid), `get ${aid.slice(0, 8)}`);
  const parsed = parseAssignment(rec);
  const member = matchMember(parsed, fileNik);
  const keys = targetKeys(parsed, member);
  const { added, already } = addZeroComments(parsed, keys);

  const base = {
    acct: acct.label,
    assignmentId: aid,
    member,
    keys,
    added,
    already,
    statusAlias: parsed.statusAlias,
    at: new Date().toISOString(),
  };

  if (dryRun) {
    return {
      ...base,
      status: added.length ? "SIAP" : "SUDAH ADA",
      target: added.join("; "),
      note: added.length
        ? `dry-run; akan menulis ${added.join(", ")}`
        : `sudah ada #0: ${already.join(", ")}`,
      verified: true,
    };
  }

  if (!added.length) {
    return {
      ...base,
      status: "BERHASIL",
      target: already.join("; "),
      note: `sudah ada #0: ${already.join(", ")}; tidak perlu tulis`,
      verified: true,
    };
  }

  const res = await uploadComment(withRetry, rec, aid, parsed.comment);
  const alias = res?.data?.assignmentStatusAlias || res?.message || "EDITED?";

  let verified = false;
  let verifyError = "";
  try {
    const vrec = await withRetry((ac) => ac.api.getAssignment(aid), `verify ${aid.slice(0, 8)}`);
    const vparsed = parseAssignment(vrec);
    verified = keys.every((k) => (vparsed.commentsByKey.get(k) || []).includes("#0"));
    if (!verified) verifyError = "komentar #0 belum terlihat setelah upload";
  } catch (e) {
    verifyError = String((e && e.message) || e).slice(0, 160);
  }

  return {
    ...base,
    status: verified ? "BERHASIL" : "GAGAL",
    target: added.join("; "),
    note: [
      `ditulis: ${added.join(", ")}`,
      already.length ? `sudah ada: ${already.join(", ")}` : "",
      `status: ${alias}`,
      verified ? "verifikasi: OK" : `verifikasi: GAGAL — ${verifyError}`,
    ].filter(Boolean).join(" | "),
    alias,
    verified,
  };
}
