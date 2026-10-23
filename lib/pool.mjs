/**
 * lib/pool.mjs — pool koneksi multi-akun untuk rolling anti-429.
 *
 * FASIH rate-limit endpoint assignment-history/* per sesi (per akun).
 * Dua akun di dua Chrome (port CDP berbeda) punya "jatah" masing-masing,
 * jadi tool boleh berganti akun ANTAR-assignment: yang satu sedang
 * cooldown (kena 429) sementara yang lain jalan.
 *
 * Aturan penting: satu assignment SELALU dikerjakan satu akun dari awal
 * sampai selesai (opts.pin pada withRetry) supaya metadata/sender riwayat
 * konsisten satu identitas per paket.
 *
 * Build pool: createPool({ cfg, fallbackPort }) membaca cfg.accounts
 * [{label,port}]; tanpa itu, perilaku lama (akun tunggal di fallbackPort)
 * tetap dipakai.
 */
import { findFasihPage } from "./cdp.mjs";
import { createFasihApi } from "./api.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const is429 = (m) => /429|RATE_LIMIT/i.test(m);
const is401 = (m) => /\bHTTP 401\b|UNAUTHORIZED/i.test(m);
const is403 = (m) => /\bHTTP 403\b/;                        // sesi/token halaman tamat — sering pulih dgn refresh tab
const is5xx = (m) => /HTTP 5\d\d/.test(m);
const isTransient = (m) => /taking longer|try again later/i.test(m); // server overload, body bukan JSON

export async function createPool({
  cfg = {},
  fallbackPort = 9222,
  paceMs = 2000,
  checkUser = true,
  log = console.log,
} = {}) {
  const defs = Array.isArray(cfg.accounts) && cfg.accounts.length
    ? cfg.accounts
    : [{ label: "A", port: fallbackPort }];

  const accounts = [];
  const failLog = [];
  for (const d of defs) {
    const port = d.port ?? fallbackPort;
    try {
      const page = await findFasihPage(port);
      const api = createFasihApi(page);
      const acc = {
        label: d.label || String.fromCharCode(65 + accounts.length),
        port, page, api,
        user: null, bad: null,
        coolUntil: 0, coolMs: 30000, paceUntil: 0,
      };
      accounts.push(acc);
      if (checkUser) {
        try { acc.user = await api.checkUser(); }
        catch (e) { acc.bad = String((e && e.message) || e).slice(0, 140); }
      }
    } catch (e) {
      failLog.push({ port, err: String((e && e.message) || e).slice(0, 140) });
    }
  }
  if (!accounts.length) {
    throw new Error(
      "Tidak ada tab fasih yang bisa dikonek: " +
      failLog.map((f) => `port ${f.port} — ${f.err}`).join(" | ")
    );
  }
  if (failLog.length) {
    log(`[pool] tab tidak konek: ${failLog.map((f) => f.port).join(", ")} — lanjut dengan ${accounts.length} akun`);
  }

  const soonest = (a) => Math.max(a.coolUntil || 0, a.paceUntil || 0);

  /** Akun dengan hambatan (cooldown/pace) paling dekat selesai; menunggu bila perlu. */
  async function pick() {
    const avail = accounts.filter((a) => !a.bad);
    if (!avail.length) {
      throw new Error("Semua akun perlu login ulang di Chrome-nya (sesi tamat).");
    }
    for (;;) {
      let best = avail[0];
      for (const a of avail) if (soonest(a) < soonest(best)) best = a;
      const w = soonest(best) - Date.now();
      if (w <= 0) return best;
      await sleep(Math.min(w, 30000));
    }
  }

  function penalize(a) {
    a.coolUntil = Date.now() + a.coolMs;
    a.coolMs = Math.min(a.coolMs * 2, 300000); // 30 dtk → 1 mnt → … → maks 5 mnt
  }

  /**
   * fn menerima OBJEK AKUN — fn wajib memakai acct.api, bukan api global.
   * opts.pin = paksa akun ini untuk semua percobaan (atomic per assignment);
   * bila akun pin mati sesinya, percobaan berikut boleh pakai akun lain
   * (dicatat jelas di log).
   */
  async function withRetry(fn, label = "req", opts = {}) {
    const max = opts.max || 8;
    let lastErr = null;
    for (let attempt = 1; attempt <= max; attempt++) {
      const acct = opts.pin || (await pick());
      try {
        const w = Math.max(acct.coolUntil, acct.paceUntil) - Date.now();
        if (w > 0) await sleep(w);
        acct.paceUntil = Date.now() + paceMs;
        const out = await fn(acct);
        if (attempt > 1) acct.coolMs = 30000; // sukses → reset skala cooldown
        return out;
      } catch (e) {
        const m = String((e && e.message) || e);
        lastErr = e;
        if (is429(m)) {
          penalize(acct);
          console.log(
            `\n[429][akun ${acct.label}] ${label} — cooldown ${Math.round((acct.coolUntil - Date.now()) / 1000)} dtk (percobaan ${attempt}/${max})` +
            (opts.pin ? " [pin akun ini]" : " → putar akun")
          );
          continue;
        }
        if (is401(m)) {
          acct.bad = "sesi tamat (HTTP 401) — login ulang di Chrome port " + acct.port;
          console.log(`\n[!][akun ${acct.label}] ${label} — ${acct.bad}`);
          if (opts.pin === acct) opts.pin = null; // lepas pin → lanjut akun lain
          continue;
        }
        if (is403(m)) {
          penalize(acct);
          console.log(
            `\n[403][akun ${acct.label}] ${label} — cooldown ${Math.round((acct.coolUntil - Date.now()) / 1000)} dtk (percobaan ${attempt}/3) → putar akun (tab port ${acct.port} perlu refresh sesi)`
          );
          if (attempt >= 3 || opts.pin) { // pin tidak boleh ganti akun — hentikan dgn pesan jelas
            if (opts.pin === acct) throw e;
            if (attempt >= 3) throw e;
          }
          continue;
        }
        if ((is5xx(m) || isTransient(m)) && attempt <= 2) { await sleep(3000); continue; }
        throw e;
      }
    }
    throw new Error(
      `${label}: gagal setelah ${max} percobaan` +
      (lastErr ? ` (terakhir: ${String(lastErr.message || lastErr).slice(0, 160)})` : "")
    );
  }

  /**
   * api delegasi untuk perintah satu-tembakan (doctor/list/detail/dll):
   * tiap panggilan memilih akun sendiri lewat rolling.
   */
  const api = new Proxy({}, {
    get(_t, prop) {
      if (typeof prop !== "string") return undefined;
      return (...args) => withRetry((ac) => ac.api[prop](...args), prop);
    },
  });

  return {
    accounts,
    api,
    pick,
    withRetry,
    labels: () => accounts.map((a) => `${a.label}@${a.port}${a.bad ? "(login-ulang)" : ""}`).join(" + "),
  };
}
