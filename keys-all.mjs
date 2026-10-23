/** keys-all.mjs — dump semua dataKey dari paket data */
import { readFileSync } from "node:fs";
const pack = JSON.parse(readFileSync(process.argv[2] || "./data-fcfec28d.json", "utf8"));
const dataJson = JSON.parse(pack.data);
console.log("answers:", dataJson.answers.length, " code:", pack.code_identity);
for (const a of dataJson.answers) {
  let v = a.answer;
  if (v && typeof v === "object") v = JSON.stringify(v);
  console.log(`  ${a.dataKey} = ${String(v).slice(0, 60)}   [${String(a.description || "").slice(0, 40)}]`);
}
