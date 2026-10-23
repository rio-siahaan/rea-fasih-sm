/** lib/xlsx.mjs — pembaca .xlsx minimal (zip + XML regex, tanpa dependensi). */
import { readZip } from "./zip.mjs";

function xmlText(s) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
}

function colToIndex(ref) {
  // "BC12" -> 54
  const m = /^[A-Z]+/.exec(ref);
  let n = 0;
  for (const ch of m[0]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** return { sheetNames:[..], sheets: { name: rows[] } dengan rows[i][j] = { v: value, f?: formula, s?: type } */
export function readXlsx(buf) {
  const entries = readZip(buf);
  const file = (name) => {
    const e = entries.find((x) => x.name === name || x.name.replace(/^\//, "") === name);
    if (!e) return null;
    return e.data.toString("utf8");
  };

  const ssXml = file("xl/sharedStrings.xml");
  const shared = [];
  if (ssXml) {
    const siRe = /<si>([\s\S]*?)<\/si>/g;
    let m;
    while ((m = siRe.exec(ssXml))) {
      const seg = m[1];
      const ts = [...seg.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]);
      shared.push(xmlText(ts.join("")));
    }
  }

  const wbXml = file("xl/workbook.xml");
  if (!wbXml) throw new Error("workbook.xml tidak ada (bukan xlsx?)");
  const relXml = file("xl/_rels/workbook.xml.rels") || "";
  const rels = {};
  for (const tag of relXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /Id="([^"]+)"/.exec(tag[0]);
    const target = /Target="([^"]+)"/.exec(tag[0]);
    if (id && target) {
      let tp = target[1];
      tp = tp.replace(/^\//, "");            // absolut → root zip
      if (/^xl\//.test(tp)) { /* sudah berawalan xl */ }
      else if (/^worksheets\//.test(tp) || /worksheets\/.+\.xml$/.test(tp)) tp = "xl/" + tp;
      else if (!/\//.test(tp)) tp = "xl/" + tp;
      rels[id[1]] = tp;
    }
  }
  const sheetNames = [];
  for (const m of wbXml.matchAll(/<sheet[^>]*name="([^"]*)"[^>]*r:id="([^"]+)"[^>]*\/>/g)) {
    sheetNames.push({ name: xmlText(m[1]), rid: m[2] });
  }

  const ci = entries.find((e) => e.name === "[Content_Types].xml");
  void ci;

  function parseSheet(xml) {
    const rows = [];
    const rowRe = /<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g;
    let rm;
    while ((rm = rowRe.exec(xml))) {
      const idx = Number(rm[1]);
      const cells = [];
      const cRe = /<c([^>]*)>([\s\S]*?)<\/c>|<c([^>]*)\/>/g;
      let cm;
      while ((cm = cRe.exec(rm[2]))) {
        const attrs = cm[1] != null ? cm[1] : (cm[3] || "");
        const body = cm[2] || "";
        const ref = (/r="([A-Z]+\d+)"/.exec(attrs) || [])[1];
        const t = (/t="([^"]*)"/.exec(attrs) || [])[1];
        const fv = /<f[^>]*>([\s\S]*?)<\/f>/.exec(body);
        const vv = /<v>([\s\S]*?)<\/v>/.exec(body);
        let value = "";
        if (t === "s" && vv) value = shared[Number(vv[1])] ?? "";
        else if (t === "inlineStr") {
          const isV = body.match(/<t[^>]*>([\s\S]*?)<\/t>/);
          value = isV ? xmlText(isV[1]) : "";
        } else if (t === "str" && vv) value = xmlText(vv[1]);
        else if (t === "b" && vv) value = vv[1] === "1";
        else if (vv) {
          const num = Number(vv[1]);
          value = Number.isFinite(num) ? num : xmlText(vv[1]);
        }
        const j = ref ? colToIndex(ref) : cells.length;
        cells[j] = { v: value, ...(fv ? { f: xmlText(fv[1]) } : {}) };
      }
      // normalisasi: isi lubang undefined
      for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = { v: "" };
      rows[idx - 1] = cells;
    }
    for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
    return rows;
  }

  const sheets = {};
  for (const { name, rid } of sheetNames) {
    const target = rels[rid];
    if (!target) continue;
    const xml = file(target);
    if (!xml) continue;
    sheets[name] = parseSheet(xml);
  }
  return { sheetNames: sheetNames.map((s) => s.name), sheets, sharedStringLengths: shared.length };
}

/** Ambil nilai polos (v saja) — { sheet: rows of primitive } */
export function xlsxValues(read) {
  const out = {};
  for (const [name, rows] of Object.entries(read.sheets)) {
    out[name] = rows.map((r) => r.map((c) => (c.f !== undefined ? { f: c.f, v: c.v } : c.v)));
  }
  return out;
}
