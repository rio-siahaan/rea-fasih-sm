/** test-put.mjs — presign → PUT S3 dari halaman, dengan log jaringan CDP */
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
const log = [];
ws.onopen = () => main().catch((e) => { console.error(e); process.exit(1); });
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === "Network.requestWillBeSent" && /obj\.bps/.test(m.params.request.url)) {
    log.push({ ev: "req", method: m.params.request.method, url: m.params.request.url.split("?")[0].slice(0, 80) });
  }
  if (m.method === "Network.responseReceived" && /obj\.bps/.test(m.params.response.url)) {
    log.push({ ev: "resp", method: m.params.type, status: m.params.response.status, headers: Object.fromEntries(Object.entries(m.params.response.headers).filter(([k]) => /^access-control|^content-type$/i.test(k))) });
  }
  if (m.method === "Network.loadingFailed" && m.params.blockedReason) {
    log.push({ ev: "failed", reason: m.params.blockedReason, errorText: m.params.errorText });
  }
};
const call = (method, params = {}) => new Promise((r) => { const id = ++mid; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });

async function main() {
  await call("Network.enable");
  const id = process.argv[2] || "2ad2c549-40a3-4f5e-9b5f-daabcfd9339f";
  const period = "fd68e454-ba45-4b85-8205-f3bf777ded24";
  const API = "https://fasih-sm.bps.go.id/app/api";
  const xsrf = (await call("Runtime.evaluate", { expression: `(document.cookie.split("; ").find(c=>c.startsWith("XSRF-TOKEN="))||"").slice(11)`, returnByValue: true })).result.result.value;

  // presign
  const expr = `(async () => {
    const res = await fetch(${JSON.stringify(`${API}/assignment-submit/api/assignment/s3/edit/presign-url?surveyPeriodId=${period}`)}, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json", "X-XSRF-TOKEN": ${JSON.stringify(xsrf)} },
      body: JSON.stringify({ assignmentId: ${JSON.stringify(id)}, fileNames: [${JSON.stringify(`${id}_${Date.now()}.zip`)}] })
    });
    return await res.json();
  })()`;
  const r = await call("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  const data = r.result.result.value.data;
  const url = data.presignedUrls[0].presignedUrl;
  console.log("presigned:", data.presignedUrls[0].fileName, "method:", data.presignedUrls[0].method);

  // PUT polos (tanpa XSRF / Content-Disposition) dulu
  const putExpr = `(async () => {
    const body = new Uint8Array([0x50,0x4b,0x05,0x06,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]);
    try {
      const res = await fetch(${JSON.stringify(url)}, { method: "PUT", credentials: "include", headers: { "Content-Type": "application/zip" }, body });
      return { status: res.status };
    } catch (e) { return { err: String(e).slice(0, 100) }; }
  })()`;
  const put = await call("Runtime.evaluate", { expression: putExpr, awaitPromise: true, returnByValue: true });
  console.log("putBare ->", JSON.stringify(put.result.result.value));

  // lalu PUT dengan Content-Disposition seperti SPA
  const dispName = `${id.slice(0, 8)}-disp.zip`;
  const put2Expr = `(async () => {
    const body = new Uint8Array([0x50,0x4b,0x05,0x06,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]);
    try {
      const res = await fetch(${JSON.stringify(url)}, { method: "PUT", credentials: "include", headers: { "Content-Type": "application/zip", "Content-Disposition": ${JSON.stringify(`attachment; filename="${dispName}"`)} }, body });
      return { status: res.status };
    } catch (e) { return { err: String(e).slice(0, 100) }; }
  })()`;
  const put2 = await call("Runtime.evaluate", { expression: put2Expr, awaitPromise: true, returnByValue: true });
  console.log("putDisp ->", JSON.stringify(put2.result.result.value));

  console.log("NET LOG:", JSON.stringify(log, null, 1).slice(0, 1800));
  process.exit(0);
}
