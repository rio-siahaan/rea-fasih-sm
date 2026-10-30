/**
 * lib/excel.mjs — baca sumber sosial27 + tulis hasil audit ke salinan .xlsx.
 *
 * Catatan penting:
 * - Kolom link_fasih_sm sering berisi sel KOSONG, tetapi punya hyperlink Excel.
 *   Assignment ID harus diambil dari xl/worksheets/_rels/sheet1.xml.rels,
 *   bukan dari nilai sel.
 * - Kolom link tidak di-hardcode (sekarang F, sebelumnya L). Posisi dicari
 *   dari header.
 * - File sumber tidak pernah ditimpa; hasil ditulis ke file baru.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { readXlsx } from "../../lib/xlsx.mjs";
import { readZip, writeZip } from "../../lib/zip.mjs";

export const RESULT_COLUMNS = [
  "ASSIGNMENT ID",
  "STATUS ROBOT",
  "TARGET #0",
  "CATATAN ROBOT",
  "WAKTU PROSES",
];

const RESULT_WIDTHS = [38, 14, 26, 64, 22];

export function norm(v) {
  return String(v ?? "").trim().replace(/\s+/g, " ").toUpperCase();
}

export function digits(v) {
  return String(v ?? "").replace(/\D+/g, "");
}

function cellValue(c) {
  if (c == null) return "";
  if (typeof c === "object") return String(c.v ?? c.value ?? c.label ?? "").trim();
  return String(c).trim();
}

function xmlEscape(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function indexToCol(n) {
  // 1 -> A, 10 -> J
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function attr(tag, name) {
  const re = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + '="([^"]*)"');
  const m = re.exec(tag);
  return m ? m[1] : "";
}

function parseRels(xml) {
  const map = new Map();
  for (const m of String(xml || "").matchAll(/<Relationship\b[^>]*\/?>/g)) {
    const id = attr(m[0], "Id");
    const target = attr(m[0], "Target");
    if (id && target) map.set(id, target);
  }
  return map;
}

function findSheetPath(entries, sheetName) {
  const get = (name) => entries.find((e) => e.name === name)?.data.toString("utf8") || "";
  const wbXml = get("xl/workbook.xml");
  const wbRels = parseRels(get("xl/_rels/workbook.xml.rels"));

  let rid = "";
  for (const m of wbXml.matchAll(/<sheet\b[^>]*\/?>/g)) {
    if (attr(m[0], "name") === sheetName) {
      rid = attr(m[0], "r:id");
      break;
    }
  }
  let target = wbRels.get(rid) || "worksheets/sheet1.xml";
  target = target.replace(/^\//, "");
  if (!target.startsWith("xl/")) target = "xl/" + target;

  const slash = target.lastIndexOf("/");
  const dir = target.slice(0, slash);
  const base = target.slice(slash + 1);
  return { sheetPath: target, relsPath: `${dir}/_rels/${base}.rels` };
}

/**
 * Muat workbook + baris data + hyperlink assignment.
 * rows[i] punya properti header asli + __row (nomor baris Excel).
 */
export function loadWorkbook(path) {
  const buf = readFileSync(path);
  const parsed = readXlsx(buf);
  const sheetName = parsed.sheetNames[0];
  const sheetRows = parsed.sheets[sheetName] || [];
  const header = (sheetRows[0] || []).map(cellValue);
  const linkIndex = header.findIndex((h) => norm(h) === "LINK_FASIH_SM");
  if (linkIndex < 0) throw new Error(`Header link_fasih_sm tidak ada di ${path}`);
  const linkCol = indexToCol(linkIndex + 1);

  const rows = [];
  for (let i = 1; i < sheetRows.length; i++) {
    const values = (sheetRows[i] || []).map(cellValue);
    if (!values.some((v) => String(v).trim() !== "")) continue;
    const row = { __row: i + 1, __values: values };
    header.forEach((h, j) => { row[h] = values[j] ?? ""; });
    rows.push(row);
  }

  const entries = readZip(buf);
  const { sheetPath, relsPath } = findSheetPath(entries, sheetName);
  const sheetXml = entries.find((e) => e.name === sheetPath)?.data.toString("utf8") || "";
  const relsXml = entries.find((e) => e.name === relsPath)?.data.toString("utf8") || "";
  const rels = parseRels(relsXml);

  const links = new Map();
  for (const m of sheetXml.matchAll(/<hyperlink\b[^>]*\/?>/g)) {
    const ref = attr(m[0], "ref");
    const rid = attr(m[0], "r:id");
    if (!ref || !rid) continue;
    const rm = /^([A-Z]+)(\d+)$/.exec(ref);
    if (!rm || rm[1] !== linkCol) continue;
    const target = rels.get(rid);
    if (!target) continue;
    const aid = target.split("/").filter(Boolean).pop() || "";
    if (aid) links.set(Number(rm[2]), aid);
  }

  return { path, buf, parsed, sheetName, header, rows, links, linkCol, entries, sheetPath, relsPath, sheetXml, relsXml };
}

/** Hitung duplikasi NIK & nama_kk; hanya keduanya unik yang menjadi kandidat. */
export function classifyRows(rows) {
  const count = (key) => {
    const map = new Map();
    for (const r of rows) {
      const k = norm(r[key]);
      map.set(k, (map.get(k) || 0) + 1);
    }
    return map;
  };
  const nikCount = count("nik");
  const nameCount = count("nama_kk");

  const out = rows.map((r) => {
    const nk = nikCount.get(norm(r.nik)) || 0;
    const nm = nameCount.get(norm(r.nama_kk)) || 0;
    const reasons = [];
    if (!String(r.nik ?? "").trim()) reasons.push("NIK kosong");
    else if (nk > 1) reasons.push(`NIK duplikat ${nk}x`);
    if (!String(r.nama_kk ?? "").trim()) reasons.push("nama_kk kosong");
    else if (nm > 1) reasons.push(`nama_kk duplikat ${nm}x`);
    return {
      ...r,
      __nikCount: nk,
      __nameCount: nm,
      __candidate: reasons.length === 0,
      __reason: reasons.join("; "),
    };
  });

  return { rows: out, candidates: out.filter((r) => r.__candidate), nikCount, nameCount };
}

function styleFromBody(body, fallback) {
  let style = String(fallback);
  for (const m of String(body || "").matchAll(/<c\b[^>]*\bs="(\d+)"[^>]*>/g)) style = m[1];
  return style;
}

function inlineCell(ref, value, style) {
  const text = String(value ?? "");
  if (text === "") return "";
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(text)}</t></is></c>`;
}

/**
 * Tulis salinan workbook + 5 kolom hasil di kanan data lama.
 * Hyperlink, style, dan seluruh kolom asli dipertahankan.
 */
export function writeResultWorkbook({ srcPath, outPath, rows, results }) {
  const wb = loadWorkbook(srcPath);
  const maxCol = Math.max(wb.header.length, 9);
  const lastCol = maxCol + RESULT_COLUMNS.length;
  const resultByRow = results instanceof Map ? results : new Map(Object.entries(results || {}));

  const rowByNum = new Map();
  for (const r of rows) rowByNum.set(Number(r.__row), r);

  let maxRow = 0;
  for (const m of wb.sheetXml.matchAll(/<row\b[^>]*\br="(\d+)"/g)) maxRow = Math.max(maxRow, Number(m[1]));

  const rowRe = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g;
  let outXml = "";
  let last = 0;
  let rm;
  while ((rm = rowRe.exec(wb.sheetXml))) {
    const attrs = rm[1] || "";
    const body = rm[2] || "";
    const rowNum = Number(attr(attrs, "r"));
    let newAttrs = attrs.replace(/\s*\/\s*$/, "");
    if (/\bspans="/.test(newAttrs)) newAttrs = newAttrs.replace(/\bspans="[^"]*"/, `spans="1:${lastCol}"`);
    else newAttrs += ` spans="1:${lastCol}"`;

    let extra = "";
    if (rowNum === 1) {
      const style = styleFromBody(body, 2);
      extra = RESULT_COLUMNS.map((label, i) =>
        inlineCell(`${indexToCol(maxCol + i + 1)}1`, label, style)
      ).join("");
    } else {
      const row = rowByNum.get(rowNum);
      const res = resultByRow.get(rowNum);
      if (row && res) {
        const style = styleFromBody(body, 9);
        const vals = [
          res.assignmentId || wb.links.get(rowNum) || "",
          res.status || "",
          res.target || "",
          res.note || "",
          res.time || "",
        ];
        extra = vals.map((v, i) =>
          inlineCell(`${indexToCol(maxCol + i + 1)}${rowNum}`, v, style)
        ).join("");
      }
    }

    outXml += wb.sheetXml.slice(last, rm.index);
    outXml += `<row${newAttrs}>${body}${extra}</row>`;
    last = rowRe.lastIndex;
  }
  outXml += wb.sheetXml.slice(last);

  outXml = outXml.replace(
    /<dimension\b[^>]*\/>/,
    `<dimension ref="A1:${indexToCol(lastCol)}${maxRow}"/>`
  );

  const colDefs = RESULT_COLUMNS.map((_, i) =>
    `<col min="${maxCol + i + 1}" max="${maxCol + i + 1}" width="${RESULT_WIDTHS[i]}" customWidth="1"/>`
  ).join("");
  if (outXml.includes("</cols>")) outXml = outXml.replace("</cols>", `${colDefs}</cols>`);
  else outXml = outXml.replace(/(<sheetFormatPr\b[^>]*\/>)/, `$1<cols>${colDefs}</cols>`);

  const outEntries = wb.entries.map((e) =>
    e.name === wb.sheetPath ? { name: e.name, data: Buffer.from(outXml, "utf8") } : e
  );
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, writeZip(outEntries));
  return { outPath, maxCol, lastCol, maxRow, rowCount: rows.length };
}
