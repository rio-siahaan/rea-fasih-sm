#!/usr/bin/env node
/** analyze-capture.mjs — summarize one ndjson capture: node analyze-capture.mjs [file] [filter] */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const dir = "fasih-sm/captures";
const files = readdirSync(dir).filter((f) => f.endsWith(".ndjson")).sort();
const file = process.argv[2] || files[files.length - 1];
const filter = process.argv[3] || "";
const lines = readFileSync(join(dir, file), "utf8").split("\n").filter(Boolean);

const reqs = new Map(), bodies = new Map(), respBodies = new Map();
for (const l of lines) {
  const o = JSON.parse(l);
  if (o.kind === "request") reqs.set(o.requestId, o);
  else if (o.kind === "requestBody") bodies.set(o.requestId, o.body);
  else if (o.kind === "body") respBodies.set(o.requestId, o);
}

for (const [id, r] of reqs) {
  const u = r.url.replace("https://fasih-sm.bps.go.id/app/", "");
  if (filter && !u.includes(filter) && !(bodies.get(id) || "").includes(filter)) continue;
  if (!r.url.includes("/api/") && !r.url.match(/amazonaws|s3\.|cloudfront/)) continue;
  console.log(`REQ ${r.method} ${u.slice(0, 110)}`);
  if (bodies.has(id)) {
    let b = bodies.get(id);
    if (b.length > 2500) b = b.slice(0, 2500) + "...";
    console.log(`   BODY: ${b.replace(/\s+/g, " ")}`);
  }
  if (respBodies.has(id)) {
    let h = respBodies.get(id).head;
    if (h.length > 900) h = h.slice(0, 900) + "...";
    console.log(`   RESPBODY: ${h.replace(/\s+/g, " ")}`);
  }
  console.log();
}
