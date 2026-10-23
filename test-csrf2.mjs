/** test-csrf2.mjs — daftar semua pasangan cookie XSRF-TOKEN + uji tiap nilai */
import { findFasihPage } from "./lib/cdp.mjs";

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

const page = await findFasihPage(9222);
// reload dulu supaya kondisinya persis "baru buka" seperti SPA
await page.evaluate(`new Promise(r => setTimeout(r, 100))`);
await page.send("Page.enable");
await page.send("Page.reload", { ignoreCache: false });
await sleep(6000);

const out = await page.evaluate(`(async () => {
  const all = document.cookie.split("; ").filter(c => c.startsWith("XSRF-TOKEN="));
  const values = all.map(c => c.slice(12));
  const uniq = [...new Set(values)];
  const res = [];
  for (const tok of uniq) {
    for (const enc of [tok, decodeURIComponent(tok)]) {
      try {
        const r = await fetch("/app/api/survey/api/v1/users/check-user", {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json", "X-XSRF-TOKEN": enc },
          body: "{}",
        });
        res.push({ tokenHead: tok.slice(0, 8), len: tok.length, enc: enc === tok ? "raw" : "decoded", status: r.status, body: (await r.text()).slice(0, 80) });
      } catch (e) { res.push({ tokenHead: tok.slice(0, 8), err: String(e).slice(0, 80) }); }
    }
  }
  return { xsrfCount: all.length, uniqCount: uniq.length, res };
})()`);
console.log(JSON.stringify(out, null, 2));
process.exit(0);
