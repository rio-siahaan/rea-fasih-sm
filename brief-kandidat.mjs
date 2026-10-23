import { readFileSync, readdirSync } from "node:fs";

// ambil baris Sheet2 r4..r8 + kandidat sesuai kode identity, kondisi habis
const { loadPlan } = await import("./lib/bulk.mjs");
const pExcel = loadPlan("yang tersisa rio.xlsx", { sheet: "Sheet2" });
const recs = pExcel.records.slice(0, 5);

const idIndex = new Map();
for (const f of readdirSync("bulk-cache")) {
  if (!f.endsWith(".json")) continue;
  try {
    const h = JSON.parse(readFileSync("bulk-cache/" + f, "utf8"));
    const code = String(h.code_identity || "").split(/\s+-\s+/)[0].trim();
    if (!/^\d{16}$/.test(code)) continue;
    if (!idIndex.has(code)) idIndex.set(code, []);
    idIndex.get(code).push({ aid: f.slice(0, 36), data1: String(h.data1 || "") });
  } catch { }
}

for (const r of recs) {
  const aid = (r.assignmentId || "").slice(0, 8);
  const codeOf = (() => {
    const cf = readdirSync("bulk-cache").find((x) => x.startsWith(aid) && x.endsWith(".json"));
    if (!cf) return null;
    try { return String(JSON.parse(readFileSync("bulk-cache/" + cf, "utf8")).code_identity || "").split(/\s+-\s+/)[0].trim(); } catch { return null; }
  })();
  console.log(`\nr${r.rowNo} "${r.nama_usaha.slice(0, 32)}" aid=${aid} kode=${codeOf}`);
  const cands = idIndex.get(codeOf || "") || [];
  console.log(`   kandidat cache: ${cands.length}`);
  for (const c of cands.slice(0, 12)) {
    const cf = readdirSync("bulk-cache").find((x) => x.startsWith(c.aid.slice(0, 8)) && x.endsWith(".json"));
    if (!cf) { console.log(`   ${c.aid.slice(0, 8)} — TIDAK ADA FILE?`); continue; }
    const h = JSON.parse(readFileSync("bulk-cache/" + cf, "utf8"));
    let data = null; try { data = JSON.parse(h.data); } catch { }
    const ks = (data?.answers || []).filter((a) => /^nama_usaha#/.test(String(a.dataKey)));
    const have = ks.length ? ks.map((a) => {
      const idx = a.dataKey.slice(10);
      let v = a.answer; if (Array.isArray(v)) v = v[0];
      const nama = String(v?.label ?? v?.value ?? v ?? "").trim();
      const map = new Set((data?.answers || []).map((x) => String(x.dataKey)));
      const biaya = map.has(`biaya_produksi#${idx}`) && map.has(`operasional#${idx}`);
      return `#${idx} ${biaya ? "[biaya]" : "      "} "${nama.slice(0, 34)}"`;
    }) : ["(tanpa blok nama_usaha)"];
    console.log(`   ${c.aid.slice(0, 8)} data1="${String(h.data1 || "").slice(0, 26)}" →`);
    for (const s of have) console.log(`        ${s}`);
  }
}
