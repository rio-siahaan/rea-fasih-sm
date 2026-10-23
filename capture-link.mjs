/** capture-link.mjs — buka link assignment di tab CDP baru, rekam request API 30 dtk,
 *  cari dari mana nama kios muncul di respons. Node >=22 (WebSocket bawaan). */
const ASSIGN = process.argv[2] || "fcfec28d-ece2-4983-b59d-fbb091aaada4";
const WORDS = (process.argv[3] || "MAESELINA,KIOS").split(",");
const PERIOD = "fd68e454-ba45-4b85-8205-f3bf777ded24";

const host = "http://127.0.0.1:9222";
const newTab = await fetch(
  `${host}/json/new?${encodeURIComponent("https://fasih-sm.bps.go.id/app/assignment/" + PERIOD + "/" + ASSIGN)}`,
  { method: "PUT" },
).then((r) => r.json());
console.log("tab:", newTab.id);
const ws = new WebSocket(newTab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let seq = 0;
const pending = new Map();
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
});
const send = (method, params) =>
  new Promise((res) => {
    const id = ++seq;
    pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params }));
  });

const reqs = [];
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === "Network.requestWillBeSent") {
    const p = m.params;
    if (/\/app\/api\//.test(p.request.url))
      reqs.push({ url: p.request.url, method: p.request.method, body: (p.request.postData || "").slice(0, 300), nid: p.requestId });
  }
});

await send("Network.enable", {});
await send("Page.enable", {});
await new Promise((r) => setTimeout(r, 30000));

const interesting = reqs.filter((r) => /assignment|usaha|listing|dtsen|prelist|analytic/i.test(r.url)).slice(0, 80);
console.log("total req /app/api:", reqs.length, "| interesting:", interesting.length);
let found = 0;
let bodies = 0;
for (const r of interesting) {
  let body = "";
  try {
    const res = await send("Network.getResponseBody", { requestId: r.nid });
    body = res && (res.body || "");
    bodies++;
  } catch { /* skip */ }
  if (!body) continue;
  const t = body.toUpperCase();
  const idxs = WORDS.map((w) => [w, t.indexOf(w.toUpperCase())]).filter(([, i]) => i >= 0);
  if (idxs.length) {
    found++;
    const i0 = idxs[0][1];
    console.log(`\n=== HIT [${idxs.map(([w, i]) => `${w}@${i}`).join(", ")}] ${r.method} ${r.url.split("?")[0]}`);
    console.log("    ", body.slice(Math.max(0, i0 - 120), i0 + 280).replace(/\s+/g, " "));
  }
  if (found > 14) break;
}
console.log(`\nselesai. body dibaca: ${bodies}, hits: ${found}`);
await fetch(`${host}/json/close/${newTab.id}`).catch(() => {});
ws.close();
process.exit(0);
