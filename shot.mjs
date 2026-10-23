#!/usr/bin/env node
/** Screenshot the current fasih page via CDP: node shot.mjs [port] [outfile] */
import { writeFileSync } from "node:fs";
import http from "node:http";

const PORT = Number(process.argv[2] || 9222);
const OUT = process.argv[3] || "fasih-sm/shot.png";

function getJson(path) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port: PORT, path }, (res) => {
      let d = ""; res.on("data", (c) => (d += c)); res.on("end", () => resolve(JSON.parse(d)));
    }).on("error", reject);
  });
}

const targets = (await getJson("/json/list")).filter((t) => t.type === "page" && t.url.startsWith("https://fasih-sm.bps.go.id"));
if (!targets.length) { console.error("no fasih target"); process.exit(1); }
const t = targets[0];
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let mid = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const call = (method, params = {}) => new Promise((res) => { const id = ++mid; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
await call("Page.enable");
const shot = await call("Page.captureScreenshot", { format: "png" });
writeFileSync(OUT, Buffer.from(shot.result.data, "base64"));
console.log("saved", OUT, t.url);
ws.close();
