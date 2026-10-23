/** test-chain.mjs — jalankan langkah upload one-by-one + tangkap Network.loadingFailed */
import http from "node:http";
function httpList(port) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: "/json/list" }, (res) => {
      let d = ""; res.on("data", (c) => (d += c)); res.on("end", () => resolve(JSON.parse(d)));
    }).on("error", reject);
  });
}
const t = (await httpList(9222)).find((x) => x.type === "page" && x.url.startsWith("https://fasih-sm.bps.go.id"));
const ws = new WebSocket(t.webSocketDebuggerUrl);
let mid = 0;
const pending = new Map();
const failures = [];
ws.onopen = () => main().catch((e) => { console.error(e); process.exit(1); });
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === "Network.loadingFailed") failures.push(m.params);
  if (m.method === "Network.requestWillBeSent") {
    const u = m.params.request.url;
    if (u.includes("/api/")) console.log("REQ ", m.params.request.method, u.replace("https://fasih-sm.bps.go.id", "").slice(0, 90));
  }
};
const call = (method, params = {}) => new Promise((r) => { const id = ++mid; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });

async function main() {
  await call("Network.enable");
  const id = process.argv[2] || "2ad2c549-40a3-4f5e-9b5f-daabcfd9339f";
  const period = "fd68e454-ba45-4b85-8205-f3bf777ded24";
  const API = "https://fasih-sm.bps.go.id/app/api";
  const xsrf = (await call("Runtime.evaluate", { expression: `decodeURIComponent((document.cookie.split("; ").find(c=>c.startsWith("XSRF-TOKEN="))||"").slice(11))`, returnByValue: true })).result.result.value;

  async function tryFetch(label, url, method, body) {
    const expr = `(async () => {
      try {
        const res = await fetch(${JSON.stringify(url)}, {
          method: ${JSON.stringify(method)},
          credentials: "include",
          headers: { "Content-Type": "application/json", "X-XSRF-TOKEN": ${JSON.stringify(xsrf)} },
          body: ${JSON.stringify(body)}
        });
        const txt = await res.text();
        return { status: res.status, head: txt.slice(0, 120) };
      } catch (e) { return { err: String(e).slice(0, 120) }; }
    })()`;
    const r = (await call("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result.result.value;
    console.log(label, JSON.stringify(r).slice(0, 240));
  }

  await tryFetch("getAssignment ", `${API}/assignment-general/api/assignment/get-by-assignment-id?assignmentId=${id}`, "GET", undefined);
  await tryFetch("presignEdit   ", `${API}/assignment-submit/api/assignment/s3/edit/presign-url?surveyPeriodId=${period}`, "POST", JSON.stringify({ assignmentId: id, fileNames: [`${id}_${Date.now()}.zip`] }));

  if (failures.length) console.log("FAILURES:", JSON.stringify(failures, null, 2));
  process.exit(0);
}
