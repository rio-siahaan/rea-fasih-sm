#!/usr/bin/env node
/**
 * test-roll429.mjs — validasi READ-ONLY: buktikan rate-limit 429 itu per-akun
 * (bukan per-IP/per-organisasi) supaya rolling 2 akun benar-benar berguna.
 *
 * Cara: bom endpoint history di akun A (dari bulk-state.json) sampai 429,
 * lalu langsung 1 request history di akun B.
 *   - B LOLOS      → limit per-akun, rolling di fasih-sm WORKS.
 *   - B juga 429   → limit per-IP; rolling tidak membantu (naikkan --delay).
 *
 * Jalankan CHROME TANPA login apapun yang berubah — tidak menulis data.
 */
import { readFileSync, existsSync } from "node:fs";
import { createPool } from "./lib/pool.mjs";

const cfg = existsSync("./config.json") ? JSON.parse(readFileSync("./config.json", "utf8")) : {};
let state = {};
try { state = JSON.parse(readFileSync("./bulk-state.json", "utf8")); } catch { }
const aid0 = process.argv[2] || Object.keys(state.done || {})[0] || Object.keys(state.fail || {})[0];
if (!aid0) {
  console.error("tidak ada assignment contoh — jalankan: node test-roll429.mjs <assignmentId>");
  process.exit(1);
}

const pool = await createPool({ cfg });
console.log("Akun aktif:", pool.labels());
const good = pool.accounts.filter((a) => !a.bad);
if (!good.length) {
  console.error("Semua akun bad (login?) — selesaikan login dulu.");
  process.exit(1);
}
const A = good[0];
const B = good[1] || null;

console.log(`\nBom history di akun ${A.label} → ${aid0.slice(0, 8)} (maks 15 request, jeda 300ms)`);
let hit = false;
for (let i = 1; i <= 15; i++) {
  try {
    await A.api.history(aid0);
    process.stdout.write(`${i}… ok     \r`);
  } catch (e) {
    const m = String(e.message || e);
    if (/429|RATE_LIMIT/i.test(m)) {
      console.log(`\n[${A.label}] 429 tercapai pada request ${i}`);
      hit = true;
      break;
    }
    console.log(`\n[${A.label}] error lain: ${m.slice(0, 140)}`);
    break;
  }
  await new Promise((r) => setTimeout(r, 300));
}
if (!hit) console.log(`\n[${A.label}] 429 tidak tercapai — limit mungkin lebih longgar sekarang; hasil tetap informatif tak ada pembanding.`);

if (B) {
  console.log(`\nRequest tunggal di akun ${B.label} (${aid0.slice(0, 8)})...`);
  try {
    await B.api.history(aid0);
    console.log(`✓ ${B.label} LOLOS saat ${A.label} sedang 429 → LIMIT PER-AKUN, rolling 2 akun BERGUNA.`);
  } catch (e) {
    const m = String(e.message || e);
    if (/429|RATE_LIMIT/i.test(m)) {
      console.log(`✗ ${B.label} juga 429 → limit per-IP/per-organisasi; rolling TIDAK membantu (naikkan --delay).`);
    } else {
      console.log(`? ${B.label}: ${m.slice(0, 150)}`);
    }
  }
} else {
  console.log("(hanya 1 akun aktif buat pembanding — nyalakan Chrome kedua dulu)");
}
process.exit(0);
