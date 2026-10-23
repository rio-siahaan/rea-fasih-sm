/** test-comment.mjs — uji buildCommentJson + paket zip 4 file (tanpa jaringan) */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { buildCommentJson } from "./lib/bulk.mjs";
import { writeZip, readZip } from "./lib/zip.mjs";

const f = readdirSync("./bulk-cache").find((x) => x.startsWith("025240c8"));
const hdata = JSON.parse(readFileSync(join("./bulk-cache", f), "utf8"));
const dataJson = JSON.parse(hdata.data);

// plan palsu: ubah biaya_produksi#1001 & operasional#1001
const plan = [
  { idx: "1001", rec: { rowNo: 5 }, items: [
    { base: "biaya_produksi", old: 100000, new: 123456 },
    { base: "operasional", old: 50000, new: 60000 },
  ] },
];

const KTEXT = "Perbaikan nilai biaya produksi & biaya operasional sesuai perhitungan admin";
const sender = hdata.current_user_username || hdata.current_user_fullname || "";
const c = buildCommentJson(hdata, plan, KTEXT, sender);
const existing = c.notes.find((n) => n.dataKey === "internet#1001");
const baru = c.notes.find((n) => n.dataKey === "biaya_produksi#1001");
console.log("lokasi internet#1001: ", existing, `→ komentar lama cukup ${existing?.comments?.length}`);
console.log("biaya_produksi#1001:", JSON.stringify(baru, null, 1));
console.log("total notes:", c.notes.length, "(5 lama + 2 baru)");

// zip 4 file
const refZip = writeZip([{ name: "reference.json", data: Buffer.from(JSON.stringify({ details: [], sidebar: [] })) }]);
const zip = writeZip([
  { name: "data.json", data: Buffer.from(JSON.stringify(dataJson)) },
  { name: "comment.json", data: Buffer.from(JSON.stringify(c)) },
  { name: "media.json", data: Buffer.from(JSON.stringify(hdata.media || {})) },
  { name: "reference.zip", data: refZip },
]);
const back = readZip(zip);
console.log("zip entries:", back.map((z) => `${z.name}(${z.data.length})`).join(", "));
console.log("OK");
