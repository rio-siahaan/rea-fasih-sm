/** test-csrf.mjs — coba beberapa varian header CSRF, cari yang memberi sukses */
import { findFasihPage } from "./lib/cdp.mjs";
const page = await findFasihPage(9222);
const out = await page.evaluate(`(async () => {
  const raw = (document.cookie.split("; ").find(c => c.startsWith("XSRF-TOKEN=")) || "").slice(12);
  let dec = raw; try { dec = decodeURIComponent(raw); } catch (_e) {}
  const variants = [
    { name: "raw",  token: raw },
    { name: "decoded", token: dec },
    { name: "none", token: null },
  ];
  const results = [];
  for (const v of variants) {
    const headers = { "Content-Type": "application/json" };
    if (v.token) headers["X-XSRF-TOKEN"] = v.token;
    let status = null, body = null, err = null;
    try {
      const res = await fetch("/app/api/survey/api/v1/users/check-user", {
        method: "POST", credentials: "include", headers, body: "{}",
      });
      status = res.status;
      body = (await res.text()).slice(0, 120);
    } catch (e) { err = String(e).slice(0, 120); }
    results.push({ variant: v.name, tokenLen: v.token ? v.token.length : 0, status, body, err });
  }
  return { rawLen: raw.length, rawHead: raw.slice(0, 8), results };
})()`);
console.log(JSON.stringify(out, null, 2));
process.exit(0);
