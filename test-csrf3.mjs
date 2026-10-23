/**
 * test-csrf3.mjs — ambil header request POST check-user milik SPA (via CDP Network),
 * bandingkan nilai X-XSRF-TOKEN dengan cookie. Nilai token tidak dicetak penuh.
 */
import http from "node:http";
function httpList(port) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: "/json/list" }, (res) => {
      let d = ""; res.on("data", (c) => (d += c)); res.on("end", () => resolve(JSON.parse(d)));
    }).on("error", reject);
  });
}

const port = 9222;
const targets = await httpList(port);
const t = targets.find((x) => x.type === "page" && x.url.startsWith("https://fasih-sm.bps.go.id"));
const ws = new WebSocket(t.webSocketDebuggerUrl);
let mid = 0;
const pending = new Map();
ws.onopen = () => main().catch((e) => { console.error(e); process.exit(1); });
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  else if (m.method === "Network.requestWillBeSent") onReq(m.params);
};
const call = (method, params = {}) => new Promise((r) => { const id = ++mid; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });

function onReq(params) {
  if (!params.request.url.includes("/users/check-user")) return;
  const h = params.request.headers || {};
  const report = {};
  for (const [k, v] of Object.entries(h)) {
    const lk = k.toLowerCase();
    if (lk === "xsrf-token" || lk === "x-xsrf-token" || lk === "cookie") {
      report[k] = `(len=${String(v).length}) ${lk === "cookie" ? "[redacted cookie]" : "head=" + String(v).slice(0, 6) + "…"} tokenMatchesCookie=${lk === "x-xsrf-token" ? String(v) === COOKIE_RAW : "-"}`;
    } else if (lk.startsWith("sec-") || lk.startsWith("ts") || lk.startsWith("tsp")) {
      report[k] = v.slice(0, 40);
    } else {
      report[k] = v.length > 60 ? v.slice(0, 57) + "…" : v;
    }
  }
  console.log("=== SPA check-user POST headers ===");
  console.log(JSON.stringify(report, null, 2));
  if (params.request.headers && params.request.headers["x-xsrf-token"]) {
    window.__TOKEN_LEN = String(params.request.headers["x-xsrf-token"]).length;
  }
}

let COOKIE_RAW = "";

async function main() {
  await call("Page.enable");
  await call("Network.enable");

  const res = await call("Runtime.evaluate", {
    expression: `document.cookie.split("; ").filter(c=>c.startsWith("XSRF-TOKEN=")).map(c=>c.slice(12))[0] ?? ""`,
    returnByValue: true,
  });
  COOKIE_RAW = res.result.result.value || "";
  console.log(`document.cookie XSRF len=${COOKIE_RAW.length}`);

  await call("Page.reload", { ignoreCache: false });
  await new Promise((r) => setTimeout(r, 9000));

  // bandingkan juga doc cookie SETELAH reload
  const res2 = await call("Runtime.evaluate", {
    expression: `document.cookie.split("; ").filter(c=>c.startsWith("XSRF-TOKEN=")).map(c=>c.slice(12))[0] ?? ""`,
    returnByValue: true,
  });
  const post = res2.result.result.value || "";
  console.log(`postReload cookie len=${post.length} sameBefore=${COOKIE_RAW === post}`);
  console.log("done");
  process.exit(0);
}
