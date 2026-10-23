/** dump-post.mjs — print POST request bodies from an ndjson capture */
import { readFileSync } from "node:fs";
import { join } from "node:path";
const file = process.argv[2];
const lines = readFileSync(join("fasih-sm/captures", file), "utf8").split("\n").filter(Boolean);
const posts = new Map(); // requestId -> url
const bodies = new Map();
for (const l of lines) {
  const o = JSON.parse(l);
  if (o.kind === "request" && ["POST", "PUT", "PATCH"].includes(o.method)) posts.set(o.requestId, o);
  if (o.kind === "requestBody") bodies.set(o.requestId, o.body);
}
for (const [id, r] of posts) {
  console.log("==== " + r.method + " " + r.url.split("?")[0].replace("https://fasih-sm.bps.go.id/app/", "") + "   (" + (r.url.startsWith("https://sisnas") ? "S3" : "API") + ")");
  if (bodies.has(id)) {
    let b = bodies.get(id).replace(/\s+/g, " ");
    if (b.length > 3000) b = b.slice(0, 3000) + " ...[truncated]";
    console.log(b);
  } else console.log("   [no BODY recorded]");
  console.log();
}
