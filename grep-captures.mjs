#!/usr/bin/env node
/** grep-captures.mjs — search all ndjson for patterns: node grep-captures.mjs <regex> */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const re = new RegExp(process.argv[2] || ".");
for (const f of readdirSync("fasih-sm/captures").filter((x) => x.endsWith(".ndjson")).sort()) {
  const lines = readFileSync(join("fasih-sm/captures", f), "utf8").split("\n").filter(Boolean);
  const hits = [];
  for (const l of lines) {
    const o = JSON.parse(l);
    if (o.kind === "request" && re.test(o.url)) {
      hits.push(`  ${o.method} ${o.url.split("?").slice(0, 2).join("?").replace("https://sisnas-fasih-assignment.obj.bps.go.id", "<S3>").replace("https://fasih-sm.bps.go.id/app/", "").slice(0, 140)}`);
    }
  }
  if (hits.length) { console.log(f + ":"); for (const h of hits) console.log(h); }
}
