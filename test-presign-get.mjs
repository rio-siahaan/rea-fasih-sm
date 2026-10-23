/**
 * test-presign-get.mjs — bandingkan GET presign dari halaman (fetch) vs dari Node (https)
 * untuk assignment yang disebut di argv.
 */
import { findFasihPage } from "./lib/cdp.mjs";
import { createFasihApi } from "./lib/api.mjs";

const id = process.argv[2] || "ae1d3950-7e65-4326-b7bb-af7c97c4b987";
const page = await findFasihPage(9222);
const api = createFasihApi(page);
const detail = await api.getAssignment(id);
const period = detail.survey_period_id;
const hist = await api.history(id);
let best = null, bestT = -1;
for (const h of (Array.isArray(hist) ? hist : hist.content || [])) {
  const bp = (h && (h.base_path || h.basePath)) || "";
  if (!bp) continue;
  const tm = Date.parse((h && (h.created_at || h.createdAt)) || "") || 0;
  if (tm >= bestT) { bestT = tm; best = bp; }
}
const latest = best.split("/").pop();
if (!latest) throw new Error("no basePath");
console.log("filename:", latest);

const presigned = await api.presignDownload(period, id, [latest]);
const first = Array.isArray(presigned) ? presigned[0] : presigned;
const url = first.presignedUrls[0].presignedUrl;
console.log("url host:", new URL(url).host);
console.log("url path:", new URL(url).pathname);
console.log("url query keys:", [...new URL(url).searchParams.keys()].join(","));

// 1) dari halaman
try {
  const r = await page.evaluate(`(async () => {
    try {
      const res = await fetch(${JSON.stringify(url)}, { method: "GET" });
      return { status: res.status, ct: res.headers.get("content-type"), len: res.headers.get("content-length"), err: null };
    } catch (e) { return { err: String(e).slice(0, 200) }; }
  })()`);
  console.log("page fetch:", JSON.stringify(r));
} catch (e) { console.log("page fetch eval err:", e.message); }

// 2) dari Node
try {
  const nodeRes = await fetch(url);
  const buf = Buffer.from(await nodeRes.arrayBuffer());
  console.log("node fetch:", JSON.stringify({ status: nodeRes.status, ct: nodeRes.headers.get("content-type"), bytes: buf.length, magic: buf.subarray(0, 4).toString("hex") }));
} catch (e) { console.log("node fetch err:", String(e).slice(0, 200)); }

process.exit(0);
