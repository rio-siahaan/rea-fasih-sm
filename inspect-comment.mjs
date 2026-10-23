/** inspect-comment.mjs — struktur lengkap comment record + kaitan dgn data.json */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const dir = "./bulk-cache";
for (const f of readdirSync(dir).slice(0, 80)) {
  const p = JSON.parse(readFileSync(join(dir, f), "utf8"));
  const c = typeof p.comment === "string" ? p.comment : p.comment == null ? "" : JSON.stringify(p.comment);
  if (!c || c === '{"dataKey":"","notes":[]}') continue;
  console.log(`\n== ${f.slice(0, 8)} link=${p._id?.slice(0, 8)}`);
  const parsed = JSON.parse(c);
  console.log("   dataKey:", JSON.stringify(parsed.dataKey), "notes:", (parsed.notes || []).length);
  for (const n of (parsed.notes || []).slice(0, 3)) {
    console.log(`   note ${n.dataKey} (${(n.comments || []).length} komentar):`);
    for (const k of (n.comments || []).slice(0, 2)) console.log(`     `, JSON.stringify(k).slice(0, 220));
  }
  // apakah data.json juga menyimpan sesuatu tentang comment?
  const dj = JSON.parse(p.data);
  const inDj = ["notes", "comments", "comment", "remark"].filter((k) => k in dj);
  console.log("   kunci data.json:", Object.keys(dj).join(","), "| comment-ish:", inDj.join(",") || "tidak ada");
}
