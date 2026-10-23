#!/usr/bin/env node
/**
 * capture-cdp.mjs — Passive CDP network/news observer for fasih-sm.bps.go.id
 *
 * Usage:  node capture-cdp.mjs [port=9222] [durasi_detik=180] [out_dir=./captures]
 *
 * Connects to a user-launched Chrome with --remote-debugging-port, attaches to
 * pages on fasih-sm.bps.go.id, and records:
 *   - every request/response line (method, url, status, type, initiator)
 *   - POST request bodies (payload flow: submit / status-change / presign)
 *   - response bodies of JSON/text up to 2 MB (API shape)
 *   - cookies / auth headers are REDACTED (never written to disk)
 *
 * Output: out_dir/capture-<ts>.ndjson  (one JSON record per line)
 *         out_dir/capture-<ts>.summary.json  (counts + endpoint map)
 */

import { writeFileSync, appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const PORT = Number(process.argv[2] || 9222);
const DURATION = Number(process.argv[3] || 180) * 1000;
const OUT_DIR = process.argv[4] || "./captures";
const ORIGIN = "https://fasih-sm.bps.go.id";
const MAX_BODY = 2 * 1024 * 1024; // keep bodies up to 2 MB
const AUTO_RELOAD = process.argv.includes("--reload");

mkdirSync(OUT_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const ndjson = join(OUT_DIR, `capture-${stamp}.ndjson`);
const summaryPath = join(OUT_DIR, `capture-${stamp}.summary.json`);

const logs = [];
function log(...a) { console.log(...a); }

const http = await import("node:http");
function httpGetJson(path) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port: PORT, path }, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on("error", reject);
  });
}

// ---- 1. discover fasih page targets -------------------------------------
const version = await httpGetJson("/json/version");
log(`CDP ok: ${version.Browser}`);

const targetsAll = await httpGetJson("/json/list");
const pages = targetsAll.filter(
  (t) => t.type === "page" && (t.url || "").startsWith(ORIGIN)
);
if (pages.length === 0) {
  console.error(`No fasih-sm page target found. Open ${ORIGIN} in the debug Chrome.`);
  process.exit(1);
}
log(`Attaching to ${pages.length} page target(s):`);
pages.forEach((p) => log(`  - ${p.id} ${p.url}`));

// ---- 2. attach & enable Network on each ---------------------------------
const REDACT = new Set(["cookie", "authorization", "set-cookie", "x-csrf-token", "x-xsrf-token", "x-api-key"]);
const seen = new Map(); // targetId -> { ws, sessionId }
const stats = { requests: 0, responses: 0, bodies: 0, posts: 0 };
const endpoints = new Map(); // method host+path -> {count, statuses:Set}

function recordLine(obj) { appendFileSync(ndjson, JSON.stringify(obj) + "\n"); }

function summarizeEndpoint(method, url, status) {
  let u; try { u = new URL(url); } catch { return; }
  const key = method + " " + u.host + u.pathname;
  let e = endpoints.get(key);
  if (!e) { e = { count: 0, statuses: new Set() }; endpoints.set(key, e); }
  e.count++;
  if (status) e.statuses.add(status);
}

async function attach(pageTarget) {
  const wsmeta = await httpGetJson("/json/list").then((l) => l.find((t) => t.id === pageTarget.id));
  const wsUrl = wsmeta.webSocketDebuggerUrl;
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let mid = 0;
  const pending = new Map();
  function send(method, params = {}, sessionId) {
    const id = ++mid;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  ws.onmessage = async (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      return;
    }
    const { method, params, sessionId } = msg;
    switch (method) {
      case "Network.requestWillBeSent": {
        const r = params.request;
        stats.requests++;
        const redactedHeaders = Object.fromEntries(
          Object.entries(r.headers || {}).map(([k, v]) => [k, REDACT.has(k.toLowerCase()) ? "<REDACTED>" : v])
        );
        recordLine({
          kind: "request", target: pageTarget.id, t: params.timestamp,
          requestId: params.requestId, method: r.method, url: r.url,
          type: params.type, initiator: shortenInitiator(params.initiator),
          headers: redactedHeaders,
        });
        if (r.method === "POST" || r.method === "PUT" || r.method === "PATCH") {
          stats.posts++;
          summarizeEndpoint(r.method, r.url, null);
          if (r.hasPostData) {
            try {
              const pd = await send("Network.getRequestPostData", { requestId: params.requestId }, sessionId);
              recordLine({
                kind: "requestBody", target: pageTarget.id, requestId: params.requestId,
                body: (pd.postData || "").slice(0, MAX_BODY),
              });
            } catch { /* body gone */ }
          }
        }
        break;
      }
      case "Network.responseReceived": {
        const r = params.response;
        stats.responses++;
        const redacted = Object.fromEntries(
          Object.entries(r.headers || {}).map(([k, v]) => [k, REDACT.has(k.toLowerCase()) ? "<REDACTED>" : v])
        );
        recordLine({
          kind: "response", target: pageTarget.id, t: params.timestamp,
          requestId: params.requestId, url: r.url, status: r.status,
          mimeType: r.mimeType,
          remoteIP: r.remoteIPAddress, protocol: r.protocol,
          headers: redacted,
        });
        summarizeEndpoint("GET", r.url, r.status);
        break;
      }
      case "Network.loadingFinished": {
        // fetch body for JSON/text responses under MAX_BODY
        try {
          const res = await send("Network.getResponseBody", { requestId: params.requestId }, sessionId);
          const mt = res.base64Encoded ? "b64" : "utf8";
          const size = (res.body || "").length;
          if (size <= MAX_BODY) {
            // only log first 4000 chars for bodies; full kept for .txt files bucketed later
            recordLine({
              kind: "body", target: pageTarget.id, requestId: params.requestId,
              encoding: mt, size, head: (res.body || "").slice(0, 4000),
            });
            stats.bodies++;
          } else {
            recordLine({ kind: "body", target: pageTarget.id, requestId: params.requestId, tooBig: true, size });
          }
        } catch { /* resource gone, stream reset, etc. */ }
        break;
      }
    }
  };

  function shortenInitiator(i) {
    if (!i || !i.stack || !i.stack.callFrames || !i.stack.callFrames[0]) return null;
    const f = i.stack.callFrames[0];
    const u = (f.url || "").split("/").slice(-3).join("/");
    return `${u}:${f.lineNumber}:${f.columnNumber}`;
  }

  await send("Runtime.enable");
  await send("Network.enable", { maxTotalBufferSize: 50_000_000, maxResourceBufferSize: 10_000_000 });
  if (AUTO_RELOAD) {
    await send("Page.enable");
    setTimeout(() => {
      send("Page.reload", { ignoreCache: true }).catch((e) => log(`reload err: ${e.message}`));
      log(`Auto-reloaded ${pageTarget.url}`);
    }, 3000);
  }
  seen.set(pageTarget.id, { ws });
  log(`Attached: ${pageTarget.id} -> ${pageTarget.url}`);
}

const started = Date.now();
const deadline = started + DURATION;
const errs = [];

try {
  for (const p of pages) {
    try { await attach(p); } catch (e) { errs.push(`attach ${p.id}: ${e.message}`); }
  }

  const endWait = new Promise((res) => {
    const timer = setInterval(() => {
      if (Date.now() >= deadline) { clearInterval(timer); res(); }
    }, 500);
  });
  await endWait;
} finally {
  for (const { ws } of seen.values()) { try { ws.close(); } catch { /* noop */ } }

  const summary = {
    browser: version.Browser,
    startedAt: new Date(started).toISOString(),
    durationSec: DURATION / 1000,
    stats,
    endpoints: [...endpoints.entries()]
      .map(([k, v]) => ({ endpoint: k, count: v.count, statuses: [...v.statuses] }))
      .sort((a, b) => b.count - a.count),
    errors: errs,
  };
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  log("\n==== CAPTURE SUMMARY ====");
  log(`requests=${stats.requests} responses=${stats.responses} posts=${stats.posts} bodies=${stats.bodies}`);
  log(`ndjson : ${ndjson}`);
  log(`summary: ${summaryPath}`);
  log("\nTop endpoints:");
  for (const e of summary.endpoints.slice(0, 40)) {
    log(`  ${e.endpoint}  x${e.count}  ${e.statuses.join(",") || "-"}`);
  }
}
