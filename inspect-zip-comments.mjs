/** inspect-zip-comments.mjs — unduh paket asli 1 assignment berkomentar & inspeksi isi zip */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { findFasihPage } from "./lib/cdp.mjs";
import { createFasihApi } from "./lib/api.mjs";
import { readZip } from "./lib/zip.mjs";
import { downloadPackage } from "./lib/flow.mjs";

// 1. baca struktur comment dari cache, ambil dataKey field yang dipakai
const target = "025240c8"; // punya notes internet#1001, internet#3001, rekening#1
const fname = readdirSync("./bulk-cache").find((f) => f.startsWith(target));
const hdata = JSON.parse(readFileSync(join("./bulk-cache", fname), "utf8"));
const comment = JSON.parse(hdata.comment);
console.log("notes:", comment.notes.map((n) => n.dataKey).join(" | "));

// 2. boot api di halaman fasih
const page = await findFasihPage(9222);
const api = createFasihApi(page);

// 3. ambil id lengkap assignment dari cache record
const aidFull = hdata._id || hdata.id || hdata.assignmentId;
console.log("full id:", aidFull);

// 4. download paket asli
const { buf, filename } = await downloadPackage(api, aidFull);
console.log("filename:", filename, "size:", buf && buf.length);
if (buf) {
  const entries = readZip(buf);
  for (const e of entries) {
    console.log(`\n== ${e.name} (${e.data.length} bytes)`);
    if (/\.json$/i.test(e.name)) {
      const d = JSON.parse(Buffer.from(e.data).toString("utf8"));
      console.log("   keys:", Object.keys(d).join(","));
      const c = ["notes", "comments", "comment", "remark"].filter((k) => k in d);
      console.log("   comment-ish keys:", c.join(",") || "TIDAK ADA");
      if (c.length) console.log("   isi:", JSON.stringify(d[c[0]]).slice(0, 400));
      // cari reply/comment dalam answers
      for (const a of d.answers || []) {
        const extra = Object.keys(a).filter((k) => !["dataKey", "answer", "type", "section", "order", "errors"].includes(k));
        if (extra.length && /comment|note|remark/i.test(extra.join(",")))
          console.log("   answer", a.dataKey, "extra:", extra.join(","), JSON.stringify(a).slice(0, 200));
      }
    }
  }
}
process.exit(0);
