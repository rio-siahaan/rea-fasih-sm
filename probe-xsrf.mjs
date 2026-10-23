/** probe-xsrf.mjs — dari mana SPA mengambil CSRF token? (hanya nama, tak ada nilai di log) */
import { findFasihPage } from "./lib/cdp.mjs";
const page = await findFasihPage(9222);
const out = await page.evaluate(`(async () => {
  const cookies = document.cookie.split("; ").map(c => c.split("=")[0]);
  const ls = {};
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); ls[k] = (localStorage.getItem(k) || "").slice(0, 24); }
  const ss = {};
  for (let i = 0; i < sessionStorage.length; i++) { const k = sessionStorage.key(i); ss[k] = (sessionStorage.getItem(k) || "").slice(0, 24); }
  const globals = ["__APPCONFIG__", "__APP__", "__NEXT_DATA__", "csrfToken", "APP_CONFIG"].filter(k => window[k] !== undefined);
  return { cookies, lsKeys: Object.keys(ls), ssKeys: Object.keys(ss), globals, url: location.href };
})()`);
console.log(JSON.stringify(out, null, 2));
page.close();
