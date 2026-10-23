/** verify-revert.mjs — cek total_pengeluaran#1 di server setelah revert */
import { findFasihPage } from "./lib/cdp.mjs";
import { createFasihApi } from "./lib/api.mjs";
import { latestZipFilename } from "./lib/flow.mjs";

const aid = "54906070-7584-4458-b906-5f4ea895aded";
const page = await findFasihPage(9222);
const api = createFasihApi(page);
const hist = await api.history(aid);
const fname = latestZipFilename(hist);
console.log("paket terbaru:", fname);
const hd = await api.historyData(aid, fname);
const d = JSON.parse(hd.data);
const t = (d.answers || []).find((a) => a.dataKey === "total_pengeluaran#1");
console.log("total_pengeluaran#1 sekarang =", JSON.stringify(t && t.answer));
process.exit(0);
