/**
 * lib/api.mjs — klien API FASIH-SM lewat konteks halaman (Runtime.evaluate + fetch).
 *
 * Semua request dijalankan DI DALAM halaman fasih-sm.bps.go.id yang aktif,
 * sehingga:
 *   - cookie SSO ikut otomatis (credentials: "include")
 *   - lolos F5 bot-check (tokens TSPD di-reuse browser)
 *   - CORS S3 obj.bps.go.id sama seperti SPA aslinya
 *
 * Endpoint dipetakan dari observasi CDP live + analisa bundle SPA
 * (lihat ../captures/*.ndjson dan ../scripts/index-CEn00D-U.js).
 */
import { bufToBase64, base64ToBuf } from "./zip.mjs";

export const ORIGIN = "https://fasih-sm.bps.go.id";
export const APP = `${ORIGIN}/app`;
export const API = `${APP}/api`;

/** Source JS dieksekusi di halaman: fetch generik dgn XSRF + base64 I/O. */
function pageFetchSource(spec) {
  const specJson = JSON.stringify(spec);
  return `(async () => {
  const spec = ${specJson};
  const raw = (document.cookie.split("; ").find(c => c.startsWith("XSRF-TOKEN=")) || "").slice("XSRF-TOKEN=".length);
  let xsrf = raw;
  try { xsrf = decodeURIComponent(raw); } catch (_e) {}
  const headers = { ...(spec.headers || {}) };
  if (spec.json) headers["Content-Type"] = "application/json";
  // XSRF hanya untuk API internal; wartel ke S3 harus polos seperti aslinya, apa lagi prefight CORS
  if (spec.url.includes("/app/api/")) headers["X-XSRF-TOKEN"] = xsrf;
  let body;
  if (!spec.method || spec.method === "GET" || spec.method === "HEAD") body = undefined;
  else if (spec.bodyBase64) body = Uint8Array.from(atob(spec.bodyBase64), c => c.charCodeAt(0));
  else if (spec.json) body = JSON.stringify(spec.body);
  else body = spec.body;
  const res = await fetch(spec.url, {
    method: spec.method || "GET",
    headers,
    credentials: spec.url.includes("/app/api/") ? "include" : "same-origin",
    body,
  });
  const outHeaders = {};
  res.headers.forEach((v, k) => { if (k.toLowerCase() !== "set-cookie") outHeaders[k] = v; });
  if (spec.raw) {
    const buf = await res.arrayBuffer();
    const u8 = new Uint8Array(buf);
    let bin = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < u8.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK));
    }
    return { status: res.status, ok: res.ok, headers: outHeaders, dataBase64: btoa(bin) };
  }
  const data = await res.text();
  return { status: res.status, ok: res.ok, headers: outHeaders, data };
})()`;
}

export function createFasihApi(page) {
  async function raw(spec) {
    const out = await page.evaluate(pageFetchSource(spec));
    if (out == null) throw new Error("Evaluasi halaman tidak mengembalikan apa pun");
    if (!out.ok) {
      throw new Error(
        `${spec.method || "GET"} ${spec.url.split("?")[0]} -> HTTP ${out.status}: ${String(out.data || "").slice(0, 300)}`
      );
    }
    return out;
  }

  async function jsonCall(spec, okCodes = [200, 201]) {
    const out = await raw(spec);
    if (!okCodes.includes(out.status)) {
      throw new Error(
        `${spec.method || "GET"} ${spec.url.split("?")[0]} -> HTTP ${out.status} (harusnya ${okCodes.join(",")})`
      );
    }
    try {
      return JSON.parse(out.data);
    } catch (e) {
      throw new Error(`Respons bukan JSON dari ${spec.url.split("?")[0]}: ${String(out.data).slice(0, 200)}`);
    }
  }

  function expectSuccess(body, what) {
    if (!body || body.success !== true) {
      throw new Error(`${what} gagal: ${body && body.message ? body.message : JSON.stringify(body).slice(0, 200)}`);
    }
    return body.data;
  }

  const GET = (url) => jsonCall({ url, method: "GET" });

  return {
    page,
    raw,
    base64ToBuf,

    async checkUser() {
      const body = await jsonCall({
        url: `${API}/survey/api/v1/users/check-user`,
        method: "POST",
        json: true,
        body: {},
      }, [200, 201]);
      return expectSuccess(body, "check-user");
    },

    async myInfo(surveyPeriodId) {
      return expectSuccess(await GET(`${API}/survey/api/v1/users/myinfo?surveyPeriodId=${surveyPeriodId}`), "myinfo");
    },

    async periods(surveyId) {
      return expectSuccess(await GET(`${API}/survey/api/v1/survey-periods/my?surveyId=${surveyId}`), "survey-periods/my");
    },

    async listAssignments({ surveyPeriodId, start = 0, length = 100, search = "", statusType = -1 }) {
      const body = {
        start,
        length,
        columns: ["id", "codeIdentity", "data1", "data2", "data3", "data4", "data5", "data6", "data7", "data8", "data9", "data10"]
          .map((data) => ({ data, orderable: true })),
        order: [],
        search: { value: search, regex: false },
        assignmentExtraParam: { surveyPeriodId, assignmentErrorStatusType: statusType, filterTargetType: "TARGET_ONLY" },
      };
      const resp = await jsonCall({
        url: `${API}/analytic/api/v2/assignment/datatable-all-user-survey-periode`,
        method: "POST",
        json: true,
        body,
      });
      // respon datatable TIDAK memakai amplop {success}; langsung {searchData:[...]}
      return resp;
    },

    async getAssignment(id) {
      return expectSuccess(
        await GET(`${API}/assignment-general/api/assignment/get-by-assignment-id?assignmentId=${id}`),
        "get-by-assignment-id"
      );
    },

    async getAssignmentExcludeData(id) {
      return expectSuccess(
        await GET(`${API}/assignment-general/api/assignment/get-by-id-exclude-data?id=${id}`),
        "get-by-id-exclude-data"
      );
    },

    async structure(id) {
      return expectSuccess(
        await GET(`${API}/assignment-general/api/assignment-responsibility/get-structure-approval?assignmentId=${id}`),
        "get-structure-approval"
      );
    },

    async history(id) {
      return expectSuccess(
        await GET(`${API}/assignment-general/api/assignment-history/get-by-assignment-id?assignmentId=${id}`),
        "get-by-assignment-id (history)"
      );
    },

    async historyData(id, filename) {
      return expectSuccess(
        await GET(`${API}/assignment-general/api/assignment-history/data?assignmentId=${id}&filename=${encodeURIComponent(filename)}`),
        "assignment-history/data"
      );
    },

    /** Presign GET: POST /assignment-general/api/image/presigned-url-get?surveyPeriodId=  */
    async presignDownload(surveyPeriodId, assignmentId, fileNames) {
      const body = await jsonCall({
        url: `${API}/assignment-general/api/image/presigned-url-get?surveyPeriodId=${surveyPeriodId}`,
        method: "POST",
        json: true,
        body: [{ assignmentId, fileNames }],
      });
      return expectSuccess(body, "presign-url-get");
    },

    /** Daftar assignment berpola "hasil terkecil" untuk satu kode rumah tangga/NBS. */
    async principalValues(surveyPeriodId, code) {
      const resp = await GET(
        `${API}/assignment-general/api/assignments/get-principal-values-by-smallest-code/${surveyPeriodId}/${code}`,
      );
      return resp; // array raw [{assignmentId, data1..data10}, ...] tanpa amplop success
    },

    /** Presign PUT: POST /assignment-submit/api/assignment/s3/edit/presign-url?surveyPeriodId=  */
    async presignEdit(surveyPeriodId, assignmentId, fileNames) {
      const body = await jsonCall({
        url: `${API}/assignment-submit/api/assignment/s3/edit/presign-url?surveyPeriodId=${surveyPeriodId}`,
        method: "POST",
        json: true,
        body: { assignmentId, fileNames },
      });
      return expectSuccess(body, "presign-url (s3/edit)");
    },

    /** PUT zip ke S3 pakai presigned URL (sama seperti SPA, CORS sudah dibolehkan). */
    async s3Put(presignedUrl, filename, buf) {
      const out = await raw({
        url: presignedUrl,
        method: "PUT",
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
        bodyBase64: bufToBase64(buf),
      });
      if (out.status !== 200) throw new Error(`PUT S3 -> HTTP ${out.status}`);
      return true;
    },

    /** GET file dari presigned URL (atau bucket publik). */
    async s3Get(url) {
      const out = await raw({ url, method: "GET" });
      return base64ToBuf(out.dataBase64);
    },

    /** POST /assignment-submit/api/assignment/s3/edit → status jadi EDITED */
    async s3Edit(payload) {
      const body = await jsonCall({
        url: `${API}/assignment-submit/api/assignment/s3/edit`,
        method: "POST",
        json: true,
        body: payload,
      });
      return body; // { success, message, data: { assignmentStatusId, assignmentStatusAlias, ... } }
    },

    /** Permission names (diagnostik) */
    async permissionNames(resourceKey, master = "SURVEY PERIOD") {
      const body = await jsonCall({
        url: `${API}/access-control/api/authorization/permission/names`,
        method: "POST",
        json: true,
        body: { resourceKey, resourceMasterName: master },
      });
      return body;
    },
  };
}
