import { readFileSync } from "node:fs";
import { readZip } from "./lib/zip.mjs";
const xml = readZip(readFileSync("C:/Users/User/Downloads/Cleaning Rio.xlsx"))
  .find((e) => e.name === "xl/worksheets/sheet1.xml").data.toString();
const filled = [];
const re = /<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g;
let m;
while ((m = re.exec(xml))) if (/<v>/.test(m[2])) filled.push(m[1]);
console.log("filled rows:", filled.length);
console.log("first:", filled.slice(0, 3).join(","), ".. last:", filled.slice(-3).join(","));
