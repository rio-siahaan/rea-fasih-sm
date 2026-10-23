import { readFileSync } from "node:fs";
import { readZip } from "./lib/zip.mjs";
const en = readZip(readFileSync("C:/Users/User/Downloads/Rio_rumus2.xlsx"));
const sheet = en.filter((e) => /worksheets\s*\/\s*sheet/.test(e.name) && e.data.length > 0).sort((a, b) => b.data.length - a.data.length)[0];
const xml = sheet.data.toString();
const filled = [];
const re = /<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g;
while (true) {
  const m = re.exec(xml);
  if (!m) break;
  if (/<v>/.test(m[2])) filled.push(m[1]);
}
console.log("entry:", sheet.name, sheet.data.length);
console.log("filled rows:", filled.length, "first-last:", filled[0], "-", filled[filled.length - 1]);
