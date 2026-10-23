/** test-rows6.mjs — verifikasi 6 baris pertama Excel penuh: link → assignment → blok usaha */
import { findFasihPage } from "./lib/cdp.mjs";
import { createFasihApi } from "./lib/api.mjs";
import { latestZipFilename } from "./lib/flow.mjs";
import { loadPlan } from "./lib/bulk.mjs";

const page = await findFasihPage(9222);
const api = createFasihApi(page);
try {
  const planf = loadPlan("C:/Users/User/Downloads/Rio_rumus2 (1).xlsx");
  const six = planf.records.slice(0, 6);
  for (const rec of six) {
    const id = rec.assignmentId;
    console.log(`\n== r${rec.rowNo} "${rec.nama_usaha.slice(0, 40)}" status=${rec.status}`);
    console.log(`   link: ${rec.link}`);
    console.log(`   -> assignmentId: ${id}`);
    try {
      const hist = await api.history(id);
      const base = latestZipFilename(hist);
      const hdata = await api.historyData(id, base);
      const dj = JSON.parse(typeof hdata.data === "string" ? hdata.data : JSON.stringify(hdata.data ?? {}));
      const ju = dj.answers.find((a) => a.dataKey === "jumlah_usaha")?.answer;
      const code = hdata.code_identity || dj.answers.find((a) => a.dataKey === "var_desa")?.answer;
      console.log(`   code_identity: ${hdata.code_identity} | jumlah_usaha: ${JSON.stringify(ju)}`);
      // daftar blok usaha: nama + kbli + biaya utama
      const blocks = [];
      for (const a of dj.answers) {
        const m = /^nama_usaha#(\d+)$/.exec(String(a.dataKey || ""));
        if (m) {
          const idx = m[1];
          const nm = Array.isArray(a.answer) ? (a.answer[0]?.label ?? a.answer[0]?.value ?? "") : a.answer;
          const g = (k) => {
            const v = dj.answers.find((x) => x.dataKey === `${k}#${idx}`)?.answer;
            return Array.isArray(v) ? (v[0]?.value ?? v[0]?.label) : v;
          };
          blocks.push({ idx, nm: String(nm || ""), kbli: g("kbli_akhir"), prod: g("biaya_produksi"), pemb: g("biaya_pembelian"), op: g("operasional"), np: g("nilai_pendapatan") });
        }
      }
      if (!blocks.length) console.log("   (BLOK USAHA: tidak ada di assignment ini)");
      for (const b of blocks)
        console.log(`   #${b.idx} "${b.nm.slice(0, 36)}" kbli=${b.kbli} prod=${b.prod} pembelian=${b.pemb} op=${b.op} nilai_pend=${b.np}`);
      const recN = rec.nama_usaha.toUpperCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
      const hit = blocks.find((b) => b.nm.toUpperCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim() === recN);
      console.log(`   MATCH: ${hit ? `✓ #${hit.idx}` : "✗ tidak ketemu"}`);
    } catch (e) {
      console.log(`   ERROR: ${String(e.message || e).slice(0, 140)}`);
    }
  }
} finally {
  page.close();
}
