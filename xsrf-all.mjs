/** xsrf-all.mjs — semua cookie XSRF-TOKEN via Network.getAllCookies (path/domain/len/head) */
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
ws.onopen = () => main();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const call = (method, params = {}) => new Promise((r) => { const id = ++mid; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });

async function main() {
  await call("Network.enable");
  const res = (await call("Network.getAllCookies")) || {};
  const cookies = res.cookies || res.result?.cookies || [];
  const xsrf = cookies.filter((c) => c.name === "XSRF-TOKEN");
  console.log(JSON.stringify(xsrf.map((c) => ({
    domain: c.domain, path: c.path, httpOnly: c.httpOnly, secure: c.secure,
    len: c.value.length, head2: c.value.slice(0, 2),
  })), null, 2));
  console.log(`total cookies: ${cookies.length}`);
  process.exit(0);
}
