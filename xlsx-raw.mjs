/** xlsx-raw.mjs — inspect raw XML rows */
import { readFileSync } from "node:fs";
import { readZip } from "./lib/zip.mjs";
const xml = readZip(readFileSync("C:/Users/User/Downloads/Cleaning Rio.xlsx"))
  .find((e) => e.name === "xl/worksheets/sheet1.xml").data.toString();
console.log("len:", xml.length);
let j = xml.indexOf('dimension"');
console.log("dim:", xml.slice(j - 10, j + 200));
for (const rn of [10, 50, 300, 617]) {
  const i = xml.indexOf(`r="${rn}"`);
  console.log(`--- row ${rn} @${i}`);
  console.log(xml.slice(i, i + 500).replace(/\n/g, " ").slice(0, 480));
}
