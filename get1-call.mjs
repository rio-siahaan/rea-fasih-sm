/** get1-call.mjs — cek bentuk respons get-by-assignment-id tanpa history */
import { findFasihPage } from "./lib/cdp.mjs";
import { createFasihApi } from "./lib/api.mjs";

const page = await findFasihPage(9222);
const api = createFasihApi(page);
try {
  const d = await api.getAssignment("0d0e1e37-09ec-44b8-92ac-d6b94309d604");
  console.log("keys:", Object.keys(d).length);
  console.log("storage_key:", d.storage_key, "| type:", d.storage_type);
  console.log("survey_period_id:", d.survey_period_id);
  console.log("punya data:", typeof d.data, d.data ? String(d.data).length : "NULL");
  if (d.data) {
    const dj = JSON.parse(d.data);
    console.log("answers:", (dj.answers || []).length);
    console.log("sample dataKey:", (dj.answers || [])[0] && dj.answers[0].dataKey);
  }
  console.log("data1..10:", d.data1, d.data2, "| region:", JSON.stringify(d.region).slice(0, 80));
} finally {
  page.close();
}
