/**
 * lib/cdp.mjs — klien CDP minimal-tanpa-dependensi (Node >= 22, WebSocket global).
 *
 * Attaching ke tab FASIH yang sudah dibuka user (login SSO dilakukan user
 * di Chrome dengan --remote-debugging-port=9222), lalu mengeksekusi
 * JavaScript di konteks halaman lewat Runtime.evaluate.
 */
import http from "node:http";

export function httpJson(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port, path }, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(d));
        } catch (e) {
          reject(new Error(`CDP HTTP ${path} tidak JSON: ${d.slice(0, 120)}`));
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(5000, () => req.destroy(new Error(`CDP timeout di ${path}`)));
  });
}

export async function findFasihPage(port = 9222, opts = {}) {
  const origin = opts.origin || "https://fasih-sm.bps.go.id";
  let targets;
  try {
    targets = await httpJson(port, "/json/list");
  } catch (e) {
    throw new Error(
      `Tidak bisa konek ke CDP http://127.0.0.1:${port}. ` +
      `Pastikan Chrome jalan dengan --remote-debugging-port=${port}. (${e.message})`
    );
  }
  const fasih = targets.filter(
    (t) => t.type === "page" && (t.url || "").startsWith(origin) && t.webSocketDebuggerUrl
  );
  if (fasih.length === 0) {
    throw new Error(`Tidak ada tab ${origin} terbuka di Chrome debugging.`);
  }
  const pick =
    fasih.find((t) => (t.url || "").includes("/app/assignment/")) ||
    fasih.find((t) => (t.url || "").includes("/app/surveys/")) ||
    fasih[0];
  const page = new Page(pick);
  await page.connect();
  return page;
}

export class Page {
  constructor(meta) {
    this.meta = meta;
    this.ws = null;
    this._mid = 0;
    this._pending = new Map();
  }

  connect() {
    if (this.ws) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.meta.webSocketDebuggerUrl);
      this.ws = ws;
      ws.onopen = () => resolve();
      ws.onerror = (e) => reject(new Error(`WebSocket CDP gagal untuk ${this.meta.url}`));
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.id && this._pending.has(msg.id)) {
          const p = this._pending.get(msg.id);
          this._pending.delete(msg.id);
          if (msg.error) p.reject(new Error(`CDP ${msg.error.message || JSON.stringify(msg.error)}`));
          else p.resolve(msg.result);
        }
      };
      ws.onclose = () => {
        for (const p of this._pending.values()) p.reject(new Error("CDP koneksi tertutup"));
        this._pending.clear();
      };
    });
  }

  send(method, params = {}) {
    if (!this.ws || this.ws.readyState !== 1) throw new Error("CDP belum terhubung");
    const id = ++this._mid;
    return new Promise((resolve, reject) => {
      this._pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this._pending.has(id)) {
          this._pending.delete(id);
          reject(new Error(`CDP ${method} timeout`));
        }
      }, 60000);
    });
  }

  /** Jalankan source JS di konteks halaman, kembalikan nilai yang serializable. */
  async evaluate(source) {
    const res = await this.send("Runtime.evaluate", {
      expression: source,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (res.exceptionDetails) {
      const ex = res.exceptionDetails;
      const msg =
        ex.exception?.description ||
        ex.exception?.value ||
        ex.text ||
        "unknown page error";
      throw new Error(`Halaman JS error: ${String(msg).slice(0, 500)}`);
    }
    return res.result ? res.result.value : undefined;
  }

  close() {
    try {
      this.ws && this.ws.close();
    } catch { /* noop */ }
    this.ws = null;
  }
}
