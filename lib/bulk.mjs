/**
 * lib/bulk.mjs — bulk-edit berbasis Excel.
 *
 * DUA FORMAT Excel (dideteksi otomatis dari header):
 *
 * A) FORMAT BARU (2016→) — penulisan bidang biaya/kategori/kbli/komentar:
 *      nama_usaha, link_fasih_sm, biaya_pembelian_baru, biaya_produksi_baru,
 *      biaya_operasional_baru, nilai_pendapatan_baru, nilai_pendapatan_lainnya_baru,
 *      kategori_baru, kode_kbli_baru, komentar
 *    Semua kolom nilai OPTIONAL — baris dengan semua kosong dilewati.
 *    ditulis ke data.json:
 *      biaya_pembelian_baru       → biaya_pembelian#N
 *      biaya_produksi_baru        → biaya_produksi#N
 *      biaya_operasional_baru     → operasional#N
 *      nilai_pendapatan_baru      → nilai_pendapatan#N
 *      nilai_pendapatan_lainnya   → pendapatan_lain#N
 *      kategori_baru              → kategori#N   (fallback kategori_2025#N)
 *      kode_kbli_baru             → kbli_akhir#N (fallback kbli#N → kbli_prelist#N)
 *      komentar                   → comment.json (teks mandiri per baris; kosong = default)
 *    Turunan otomatis (kolom tak perlu ada):
 *      total_pengeluaran = pembelian + produksi + operasional + non_operasional(lama) + gaji(lama)
 *
 * B) FORMAT LAMA (Rio_rumus2) — perilaku tak berubah:
 *      kategori, kode_kbli, nama_usaha, produk, link_fasih_sm, status_rasio,
 *      ntb_baru, biaya_operasional_baru, biaya_produksi_baru, cek_rasio,
 *      flag_perubahan_besar
 *    status_rasio "Sesuai"/"Output <= 0" dilewati; menulis biaya_produksi,
 *    operasional, total_pengeluaran saja.
 *
 * Jika peta baris (bulk-map.json, hasil diag-unmatched.mjs) ada — computeChanges
 * menerima opts.forcedIdx: Map(rowNo → idx); baris ybs TIDAK mencari blok via nama,
 * melainkan menulis ke blok itu. Baris yang target assignmentnya juga ditoleransi
 * berbeda (MOVED) — ditangan dengan rerouting di pemanggil (bulk-repair).
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { readXlsx } from "./xlsx.mjs";

/** Ambil nilai polos dari sel (formula cells berbentuk {f,v}). */
export const cellVal = (c) => (typeof c === "object" && c !== null ? c.v ?? "" : c ?? "");

const norm = (s) =>
  String(s || "")
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
export { norm as normNama };

// kolom yang HANYA ada di format baru (pembeda dari lama — biaya_produksi_baru
// dll ada di kedua format, jadi tidak bisa jadi pembeda)
const BARU_DETECT = [
  "nilai_pendapatan_baru", "nilai_pendapatan_lainnya_baru",
  "kategori_baru", "kode_kbli_baru", "komentar",
];

/** Baca Excel (format baru maupun lama) → array baris + gruping per assignment. */
export function loadPlan(file, opts = {}) {
  if (!existsSync(file)) {
    throw new Error(
      `File Excel tidak ditemukan: ${resolve(file)}\n` +
      `  (path relatif dihitung dari folder kerja saat ini — pakai path absolut jika perlu)`,
    );
  }
  const read = readXlsx(readFileSync(file));
  const sheet = opts.sheet || read.sheetNames[0];
  const rows = read.sheets[sheet];
  if (!rows || !rows.length) {
    throw new Error(`Sheet "${sheet}" kosong/tidak ada. Sheet tersedia: ${read.sheetNames.join(", ")}`);
  }

  // deteksi baris header: cari baris yang paling banyak cocok nama kolom kunci
  const KEY_COLS = ["nama_usaha", "link_fasih_sm", "status_rasio", "ntb_baru", "kode_kbli_baru", "komentar"];
  let headerIdx = opts.headerRow != null ? opts.headerRow : -1;
  if (headerIdx < 0) {
    let best = { n: -1, i: -1 };
    for (let i = 0; i < Math.min(8, rows.length); i++) {
      const hs = (rows[i] || []).map(cellVal).map(norm);
      const n = KEY_COLS.filter((k) => hs.some((h) => h.startsWith(norm(k)))).length;
      if (n > best.n) best = { n, i };
    }
    if (best.n < 2) {
      throw new Error(
        `Baris header tidak ditemukan di "${sheet}" (cari kolom: ${KEY_COLS.join(", ")}). ` +
        `Baris pertama: ${JSON.stringify(rows[0].slice(0, 6).map(cellVal))}`,
      );
    }
    headerIdx = best.i;
  }
  const header = (rows[headerIdx] || []).map(cellVal);
  // kolom duplikat (mis. kategori_baru muncul 2×) — yang TERAKHIR menang
  // (kolom tambahan user berada paling kanan)
  const col = (name) => header.map(norm).reduce((acc, h, j) => (h.startsWith(norm(name)) ? j : acc), -1);

  // ---------- deteksi mode ----------
  const hNormAll = header.map(norm);
  const mode = BARU_DETECT.some((k) => hNormAll.some((h) => h.startsWith(norm(k)))) ? "baru" : "lama";

  let C;
  if (mode === "baru") {
    C = {
      nama_usaha: col("nama_usaha"),
      link: col("link_fasih_sm"),
      pembelian_baru: col("biaya_pembelian_baru"),
      prod_baru: col("biaya_produksi_baru"),
      op_baru: col("biaya_operasional_baru"),
      pendapatan_baru: col("nilai_pendapatan_baru"),
      pendapatan_lain_baru: col("nilai_pendapatan_lainnya_baru"),
      kategori: col("kategori_baru"),
      kbli: col("kode_kbli_baru"),
      komentar: col("komentar"),
      tindak: col("tindak_lanjut"),
    };
    for (const k of ["nama_usaha", "link"])
      if (C[k] < 0) throw new Error(`Kolom Excel "${k}" wajib ada di header ${sheet} (format baru)`);
  } else {
    C = {
      kategori: col("kategori"),
      kode_kbli: col("kode_kbli"),
      nama_usaha: col("nama_usaha"),
      link: col("link_fasih_sm"),
      status: col("status_rasio"),
      ntb_baru: col("ntb_baru"),
      op_baru: col("biaya_operasional_baru"),
      prod_baru: col("biaya_produksi_baru"),
      cek_rasio: col("cek_rasio"),
      flag: col("flag_perubahan_besar"),
    };
    for (const [k, j] of Object.entries(C))
      if (j < 0) throw new Error(`Kolom Excel "${k}" tidak ditemukan di header ${sheet}`);
  }

  const records = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const link = String(cellVal(r[C.link])).trim();
    if (!link) continue;
    const get = (j) => (j < 0 || j == null ? "" : cellVal(r[j]));
    const num = (j) => {
      if (j < 0) return null;
      const rawS = String(get(j)).trim();
      if (rawS === "") return null;
      const v = Number(rawS.replace(/,/g, ""));
      return Number.isFinite(v) ? v : null;
    };
    const str = (j) => String(get(j)).trim();
    const assignmentId = (link.match(/[0-9a-f-]{36}$/i) || [])[0];
    if (!assignmentId) {
      throw new Error(`Link pada baris ${i + 1} tidak berakhiran UUID assignment: ${link.slice(0, 80)}`);
    }
    if (mode === "baru") {
      const tindak = str(C.tindak);
      if (/sudah/i.test(tindak)) continue; // Tindak Lanjut = Sudah → bundar dulu, bukan sisa
      records.push({
        rowNo: i + 1,
        nama_usaha: str(C.nama_usaha),
        link,
        assignmentId,
        pembelian_baru: num(C.pembelian_baru),
        prod_baru: num(C.prod_baru),
        op_baru: num(C.op_baru),
        pendapatan_baru: num(C.pendapatan_baru),
        pendapatan_lain_baru: num(C.pendapatan_lain_baru),
        kategori_baru: str(C.kategori),
        kode_kbli_baru: str(C.kbli),
        komentar: str(C.komentar),
        tindak,
      });
    } else {
      records.push({
        rowNo: i + 1,
        kategori: get(C.kategori),
        kode_kbli: get(C.kode_kbli),
        nama_usaha: str(C.nama_usaha),
        link,
        assignmentId,
        status: str(C.status),
        ntb_baru: num(C.ntb_baru),
        op_baru: num(C.op_baru),
        prod_baru: num(C.prod_baru),
        cek_rasio: str(C.cek_rasio),
        flagCek: str(C.flag) === "Cek",
      });
    }
  }

  const groups = new Map();
  for (const rec of records) {
    if (!groups.has(rec.assignmentId)) groups.set(rec.assignmentId, []);
    groups.get(rec.assignmentId).push(rec);
  }
  return { sheet, header: C, mode, records, groups, totalRows: records.length };
}

const asNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
};

/**
 * Hitung perubahan sebuah assignment.
 * @param dataJson  objek data.json (hasil parse)
 * @param recs      baris Excel untuk assignment ini
 * @param opts      { mode?: "baru"|"lama", forcedIdx?: Map<rowNo, idx|string> }
 * @returns {plan, unmatched, skipped}
 */
export function computeChanges(dataJson, recs, opts = {}) {
  const mode = opts.mode || (recs.length && "kode_kbli_baru" in recs[0] ? "baru" : "lama");
  const unmatched = [];
  const skipped = [];
  const plan = [];

  // indeks blok usaha: dataKey ^...#N yang punya nama_usaha
  const blocks = [];
  for (const a of dataJson.answers || []) {
    const m = /^nama_usaha#(\d+)$/.exec(String(a.dataKey || ""));
    if (m) blocks.push({ idx: m[1], nama: String(Array.isArray(a.answer) ? a.answer[0]?.label ?? a.answer[0]?.value ?? "" : a.answer ?? "").trim() });
  }

  const answerOf = (base, idx) => (dataJson.answers || []).find((a) => a.dataKey === `${base}#${idx}`);

  for (const rec of recs) {
    rec.nama_usaha_norm = norm(rec.nama_usaha);

    if (mode === "lama") {
      if (rec.status === "Sesuai" || /output\s*<=\s*0/i.test(rec.status)) {
        skipped.push({ rec, reason: rec.status });
        continue;
      }
      if (rec.ntb_baru == null || rec.op_baru == null || rec.prod_baru == null) {
        skipped.push({ rec, reason: "kolom W/Z/Y kosong" });
        continue;
      }
    } else {
      const hasAny =
        rec.pembelian_baru != null || rec.prod_baru != null || rec.op_baru != null ||
        rec.pendapatan_baru != null || rec.pendapatan_lain_baru != null ||
        (rec.kategori_baru && rec.kategori_baru !== "") ||
        (rec.kode_kbli_baru && rec.kode_kbli_baru !== "") ||
        (rec.komentar && rec.komentar !== "");
      if (!hasAny) {
        skipped.push({ rec, reason: "kolom nilai & komentar kosong" });
        continue;
      }
    }

    // ---- tentukan blok #N ----
    const forcedIdx = opts.forcedIdx instanceof Map ? opts.forcedIdx.get(rec.rowNo) : null;
    let b = null;
    if (forcedIdx != null) {
      b = { idx: String(forcedIdx), nama: "(paksa dari bulk-map)" };
    } else {
      b = blocks.find((x) => norm(x.nama) === rec.nama_usaha_norm);
      if (!b) b = blocks.find((x) => norm(x.nama).includes(rec.nama_usaha_norm) || rec.nama_usaha_norm.includes(norm(x.nama)));
    }
    if (!b) { unmatched.push(rec); continue; }

    const dig = (base) => {
      const a = answerOf(base, b.idx);
      if (!a) return { raw: null, num: null, isStr: false };
      const v = a.answer;
      return { raw: v, num: asNum(v), isStr: typeof v === "string" };
    };

    // guard: kios terpisah / template beda — hanya format lama yang menjalankan rumus
    // pengeluaran; format baru menulis satu-per-satu (key tak ada → dilewati aman).
    if (mode === "lama") {
      if (!answerOf("biaya_produksi", b.idx) || !answerOf("operasional", b.idx)) {
        skipped.push({ rec, reason: "template tak cocok (tanpa biaya_produksi/operasional)" });
        continue;
      }
    }

    const oldPembelian = dig("biaya_pembelian");
    const oldProd = dig("biaya_produksi");
    const oldOp = dig("operasional");
    const oldNonOp = dig("non_operasional");
    const oldGaji = dig("gaji");
    const oldTotal = dig("total_pengeluaran");
    const oldNilai = dig("nilai_pendapatan");
    const oldLain = dig("pendapatan_lain");

    const pembelianLama = oldPembelian.num ?? 0;
    const gaji = oldGaji.num ?? 0;
    const nonOp = oldNonOp.num ?? 0;

    // ---- kumpulkan item penulisan ----
    const items = [];
    const keysPlan = []; // semua field target yang ADA di data.json (untuk komentar/diff)

    if (mode === "lama") {
      const prodNew = rec.prod_baru;
      const opNew = rec.op_baru;
      const pengeluaranNew = pembelianLama + prodNew + opNew + nonOp + gaji;
      keysPlan.push("biaya_produksi", "operasional");
      if (asNum(oldProd.num) !== prodNew && oldProd.raw !== null)
        items.push({ base: "biaya_produksi", old: oldProd.num, new: prodNew });
      if (asNum(oldOp.num) !== opNew && oldOp.raw !== null)
        items.push({ base: "operasional", old: oldOp.num, new: opNew });
      if (oldTotal.raw !== null) keysPlan.push("total_pengeluaran");
      if (asNum(oldTotal.num) !== pengeluaranNew && oldTotal.raw !== null)
        items.push({ base: "total_pengeluaran", old: oldTotal.num, new: pengeluaranNew });
      if (items.length === 0 && oldTotal.raw !== null) {
        // nilai sudah sama dengan Excel — tidak perlu tulis; lihat keysPlan.
      }
    } else {
      // ---- FORMAT BARU ----
      // numerik: tulis bila kolom diisi & key ada di blok
      const pendet = [
        ["pembelian_baru", "biaya_pembelian", rec.pembelian_baru, oldPembelian],
        ["prod_baru", "biaya_produksi", rec.prod_baru, oldProd],
        ["op_baru", "operasional", rec.op_baru, oldOp],
        ["pendapatan_baru", "nilai_pendapatan", rec.pendapatan_baru, oldNilai],
        ["pendapatan_lain_baru", "pendapatan_lain", rec.pendapatan_lain_baru, oldLain],
      ];
      for (const [, base, v, old] of pendet) {
        if (v == null) continue;
        if (!answerOf(base, b.idx)) continue; // template tak punya — lewati dengan aman
        keysPlan.push(base);
        if (asNum(old.num) !== asNum(v))
          items.push({ base, old: old.num, new: asNum(v) });
      }
      // kategori (huruf / teks)
      if (rec.kategori_baru) {
        const katBase = answerOf("kategori", b.idx) ? "kategori" : (answerOf("kategori_2025", b.idx) ? "kategori_2025" : null);
        if (katBase) {
          keysPlan.push(katBase);
          const oldRaw = dig(katBase).raw;
          if (String(oldRaw ?? "") !== String(rec.kategori_baru))
            items.push({ base: katBase, old: oldRaw, new: String(rec.kategori_baru) });
        }
      }
      // kode kbli (string kode polos → kbli_akhir dulu)
      if (rec.kode_kbli_baru) {
        const kbliBase =
          answerOf("kbli_akhir", b.idx) ? "kbli_akhir" :
          answerOf("kbli", b.idx) ? "kbli" :
          answerOf("kbli_prelist", b.idx) ? "kbli_prelist" : null;
        if (kbliBase) {
          keysPlan.push(kbliBase);
          const oldRaw = dig(kbliBase).raw;
          if (String(oldRaw ?? "") !== String(rec.kode_kbli_baru))
            items.push({ base: kbliBase, old: oldRaw, new: String(rec.kode_kbli_baru) });
        }
      }
      // total_pengeluaran dihitung ulang bila komponen pengeluaran diisi
      const prodEff = rec.prod_baru ?? oldProd.num ?? 0;
      const opEff = rec.op_baru ?? oldOp.num ?? 0;
      const pembelianEff = rec.pembelian_baru ?? pembelianLama;
      if ((rec.pembelian_baru != null || rec.prod_baru != null || rec.op_baru != null) && oldTotal.raw !== null) {
        keysPlan.push("total_pengeluaran");
        const pengeluaranNew = pembelianEff + prodEff + opEff + nonOp + gaji;
        if (asNum(oldTotal.num) !== asNum(pengeluaranNew))
          items.push({ base: "total_pengeluaran", old: oldTotal.num, new: asNum(pengeluaranNew) });
      }
      if (items.length === 0 && keysPlan.length === 0) {
        // tidak ada satu pun field target yang tersedia di template ini
        skipped.push({ rec, reason: `tak ada field target di blok #${b.idx} (template beda)` });
        continue;
      }
    }

    plan.push({
      rec,
      blockName: b.nama,
      idx: b.idx,
      before: {
        biaya_pembelian: pembelianLama, biaya_produksi: oldProd.num, operasional: oldOp.num,
        non_operasional: nonOp, gaji,
        total_pengeluaran: oldTotal.num, nilai_pendapatan: oldNilai.num, pendapatan_lain: oldLain.num,
      },
      after: Object.fromEntries(items.map((it) => [it.base, it.new])),
      items,
      keys: [...new Set(keysPlan)],
      comText: mode === "baru" ? (rec.komentar || null) : null,
      flagCek: rec.flagCek,
    });
  }

  return { plan, unmatched, skipped };
}

/** Terapkan satu planEntry ke dataJson (mutasi jawaban). Return jumlah field berubah. */
export function applyPlan(dataJson, planEntry) {
  let n = 0;
  for (const it of planEntry.items) {
    const k = `${it.base}#${planEntry.idx}`;
    const a = (dataJson.answers || []).find((x) => x.dataKey === k);
    if (!a) continue; // key tidak ada di data.json — tidak bisa ditulis di sini
    a.answer = it.str || typeof a.answer === "string" ? String(it.new) : it.new;
    n++;
  }
  return n;
}

/**
 * Bangun isi comment.json (catatan sebelah input) untuk field yang diubah.
 * Struktur sama persis seperti SPA: {dataKey:"", notes:[{dataKey, comments:[{comment,datetime,sender}]}]}
 * Komentar ditambahkan ke note yang sudah ada (tidak menimpa komentar pengawas).
 * Model format BARU: tiap plan entry membawa comText-nya sendiri (kolom `komentar`,
 * kosong → pakai `text` default dari pemanggil, biasanya "#4").
 */
export function buildCommentJson(hdata, plan, text, sender) {
  let c;
  try {
    c = typeof hdata.comment === "string" ? JSON.parse(hdata.comment) : { dataKey: "", notes: [] };
  } catch {
    c = { dataKey: "", notes: [] };
  }
  if (!c || typeof c !== "object") c = { dataKey: "", notes: [] };
  if (!Array.isArray(c.notes)) c.notes = [];

  const now = new Date().toISOString();
  for (const p of plan) {
    const txt = p.comText || text;
    for (const it of p.items) {
      const key = `${it.base}#${p.idx}`;
      let note = c.notes.find((x) => x.dataKey === key);
      if (!note) {
        note = { dataKey: key, comments: [] };
        c.notes.push(note);
      }
      if (!Array.isArray(note.comments)) note.comments = [];
      note.comments.push({ comment: txt, datetime: now, sender: sender || "" });
    }
  }
  return c;
}
