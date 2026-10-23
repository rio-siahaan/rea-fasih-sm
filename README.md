# fasih-sm

Otomasi workflow **FASIH-SM** (`fasih-sm.bps.go.id`) — fetching data, download paket,
perubahan, upload ke S3, dan perubahan status assignment menjadi `EDITED`.

Alat ini berjalan **melalui browser Anda sendiri** (Chrome DevTools Protocol):
login SSO dilakukan manual oleh user; tool hanya mengeksekusi fetch di dalam
halaman yang sudah login, sehingga cookie SSO, header XSRF, dan proteksi F5
otomatis tertangani seperti SPA aslinya.

## Persiapan

1. Jalankan Chrome dengan remote debugging (file user terpisah, tanpa mengganggu profil utama):

   ```
   chrome.exe --remote-debugging-port=9222 --user-data-dir="%TEMP%\opencode\chrome-fasih"
   ```

2. Login SSO BPS dan buka `fasih-sm.bps.go.id` sampai masuk halaman survei.
3. Perintah fasih-sm dijalankan dari folder ini.

## Perintah

| Perintah | Fungsi |
|---|---|
| `node fasih-sm.mjs doctor` | cek koneksi CDP + informasi sesi (user, periode, izin) |
| `node fasih-sm.mjs whoami` | detail user + daftar izin pada periode aktif |
| `node fasih-sm.mjs list --start 0 --length 25` | fetch data assignment (datatable) |
| `node fasih-sm.mjs detail <assignmentId>` | detail satu assignment |
| `node fasih-sm.mjs history <assignmentId>` | daftar riwayat/versi basePath (zip) |
| `node fasih-sm.mjs data <assignmentId>` | data terakhir (data.json + data1..10) |
| `node fasih-sm.mjs download <assignmentId>` | unduh paket zip (presign GET → S3) |
| `node fasih-sm.mjs unzip <file> --out <dir>` | bongkar isi zip |
| `node fasih-sm.mjs pack <data.json> --out <zip>` | kemas zip baru dari data.json |
| `node fasih-sm.mjs upload <assignmentId> --file <zip> --yes` | upload zip (presign PUT → S3) + `s3/edit` → status EDITED |
| `node fasih-sm.mjs edit <assignmentId> --transform <modul.mjs> --yes` | siklus penuh: unduh → ubah → unggah → status EDITED |
| `node fasih-sm.mjs bulk-edit --excel <file.xlsx> [--dry] [--yes] [--limit N] [--resume]` | edit massal dari Excel (Rio_rumus2) → semua assignment jadi EDITED |
| `node fasih-sm.mjs bulk-snapshot [--noData]` | READ-ONLY — bekukan riwayat + data terkini semua assignment DONE ke `snapshot-*.json` (audit sebelum operasi massal) |
| `node fasih-sm.mjs export-template [--from <excel>] [--out <csv>]` | buat template Excel format baru dgn nama+link+diagnosa (read-only) |
| `node fasih-sm.mjs bulk-repair [--yes] [--limit N] [--resume] [--excel <file>] [--map bulk-map.json]` | PEMULIHAN: paket TERBARU (freshness check) + nilai Excel (lama/baru) + komentar per baris → EDITED |

Opsi umum: `--port 9222`, `--period <surveyPeriodId>`, `--survey <surveyId>`
(nilai default di `config.json`). Semua perintah yang menulis data menuntut
konfirmasi `y` atau flag `--yes`.

## Dua akun (pool anti-429)

`config.json` dapat berisi `accounts` — tiap akun = satu Chrome instance
dengan port debugging sendiri (login SSO/external SSO dilakukan manual per
Chrome):

```json
{
  "cdpPort": 9222,
  "accounts": [
    { "label": "A", "port": 9222 },
    { "label": "B", "port": 9223 }
  ]
}
```

Semua perintah bulk memakai pool: kalau satu akun kena 429 di
`assignment-history/*`, akun itu masuk cooldown (30 dtk → 2× → maks 5 mnt)
dan assignment berikutnya jalan di akun lain. Satu assignment selalu
dikerjakan satu akun penuh (fetch → patch → upload → `s3/edit`) supaya
sender/metadata satu identitas per paket; kolom `acct` dicatat di
`bulk-state.json` / `bulk-komentar.json` / `bulk-repair.json`.

- `node fasih-sm.mjs doctor` kini menampilkan identitas SEMUA akun di pool.
- `node test-roll429.mjs` — validasi read-only: bom history di akun A sampai
  429 lalu 1 request history di akun B → kalau B lolos, limit per-akun
  (rolling berguna); kalau B juga 429, limit per-IP (naikkan `--delay`).
- Tanpa `accounts` di config, perilaku lama (akun tunggal) dipakai.
- `node diag-affected.mjs` mendukung `--resume`: progress disimpan di
  `bulk-affected.progress.json` setiap 10 assignment; jalankan ulang dengan
  `--resume` untuk melanjutkan scan yang terputus. Jeda antar assignment bisa
  ditambah lewat env: `DELAY_MS=1500 node diag-affected.mjs --resume`.

## Peta API (hasil reverse-engineering)

Semua path relatif ke `https://fasih-sm.bps.go.id/app/api`:

- `GET  survey/api/v1/users/check-user` — identitas sesi login
- `GET  survey/api/v1/users/myinfo?surveyPeriodId=<p>` — info peran user
- `POST analytic/api/v2/assignment/datatable-all-user-survey-periode` — daftar
  assignment (filter `{surveyPeriodId}`, paginasi `{start,length}`)
- `GET  assignment-general/api/assignment/get-by-assignment-id?assignmentId=<id>` —
  detail lengkap
- `GET  assignment-general/api/assignment-history/get-by-assignment-id?assignmentId=<id>` —
  riwayat; `basePath` berisi nama zip paket di S3
- `GET  assignment-general/api/assignment-history/data?assignmentId=<id>&filename=<zip>`
  — berisi `data1..data10`, `region.id`, dan data formulir terakhir
- `POST assignment-general/api/image/presigned-url-get?surveyPeriodId=<p>` —
  presign **GET**; body: `[{"assignmentId":"…","fileNames":["<zip>"]}]`
- `POST assignment-submit/api/assignment/s3/edit/presign-url?surveyPeriodId=<p>` —
  presign **PUT**; body: `{"assignmentId":"…","fileNames":["<zip>"]}`
- `PUT  https://sisnas-fasih-assignment.obj.bps.go.id/<periode>_data/<assignmentId>/<zip>?X-Amz-…`
  dengan header `Content-Type: application/zip` +
  `Content-Disposition: attachment; filename="<zip>"`
- `POST assignment-submit/api/assignment/s3/edit` — penanda terakhir (seperti tombol
  Kirim SPA). Isi:

  ```json
  {
    "filename": "<id>_<timestamp>.zip",
    "start": "0",
    "end": "<ukuran-1>",
    "length": "<ukuran>",
    "md5": "<md5 hex zip>",
    "surveyPeriodeId": "<p>",
    "assignmentId": "<id>",
    "createStatus": "false",
    "draftStatus": "false",
    "regionId": "<region id>",
    "sourceFrom": "SCM-EDIT",
    "data1": "…", "data2": "…", "data3": "…", "data4": "…",
    "data5": "…", "data6": "…", "data7": "…", "data8": "…",
    "data9": "…", "data10": "…"
  }
  ```

  Respons berisi `assignmentStatusAlias` — mis. `EDITED BY Admin Kabupaten`.

Paket zip berisi `data.json` (hasil jawaban FormGear); nama berkas baru ikut
pola `<assignmentId>_<Date.now()>.zip`.

## Modul transform

Untuk `edit`, berikan berkas modul JS yang diekspor fungsinya:

```js
// transform-demo.mjs — contoh: perbarui field tertentu di data.json
export default async function modify({ assignmentId, entries, dataJson, meta }) {
  dataJson.updatedBy = "fasih-sm";
  return { dataJson };          // atau { entries } untuk mengubah isi zip secara bebas
}
```

Fungsi menerima `{ assignmentId, entries, dataJson, meta }` dan
menampilkan `{ dataJson }` (data.json diubah) atau `{ entries }` (konten zip penuh).

## bulk-edit (edit massal dari Excel)

> **Rate limit server**: endpoint `assignment-history/*` dikunci HTTP 429
> (`RATE_LIMIT_EXCEEDED`) bila diakses terlalu cepat. `bulk-edit` memberi jeda
> 800 ms antar assignment (`--delay`), dan bila tetap kena 429 menunggu 25 dtk
> lalu mengulang (maks 8 percobaan/request). Untuk 607 assignment, fase
> fetch+apply bisa 20–40 menit.

Sumber data: Excel hasil rumus user (mis. `Rio_rumus2 (1).xlsx`) dengan header di
baris 3, kolom antara lain `nama_usaha`, `link_fasih_sm`, `status_rasio`,
`ntb_baru`, `biaya_operasional_baru`, `biaya_produksi_baru`, `cek_rasio`,
`flag_perubahan_besar`.

Aturan pikir (dikonfirmasi user):

- 1 baris = 1 usaha; baris dengan `link_fasih_sm` sama = assignment yang sama.
- Baris ↔ blok usaha di dalam data.json dicocokkan lewat `nama_usaha`
  (normalisasi huruf besar/tanda baca; multi-usaha punya indeks `#N` berbeda,
  blok tambahan biasanya indeks `#1001+`).
- Field form yang ditulis per usaha `#N`:
  `biaya_produksi` ← kolom Z, `operasional` ← kolom Y,
  `total_pengeluaran` ← biaya_pembelian(lama) + prod_baru + op_baru +
  non_operasional(lama) + gaji(lama). NTB baru seperti kolom W otomatis
  berlaku karena = nilai_pendapatan − total_pengeluaran.
- Dilewati otomatis: `status_rasio` "Sesuai" (tidak berubah) dan "Output <= 0".
- Baris bertanda `flag_perubahan_besar` "Cek" tetap diproses, ditandai [CEK].

## bulk-repair (pemulihan data tertimpa + komentar #4)

Untuk assignment hasil `diag-affected.mjs` (`bulk-affected.json`): data.json
diambil dari **paket TERBARU milik orang lain** (basis pemulihan), nilai Excel
(biaya_produksi/operasional/total_pengeluaran) diterapkan di atasnya, komentar
lama "Perbaikan nilai biaya…" dibersihkan, `#4` ditulis di field yang diubah,
lalu paket 4-file diunggah + status EDITED. **Freshness check**: sebelum tulis,
history ditarik ulang — kalau ada paket lebih baru dari yang tercatat (responden
mengirim lagi / perbaikan manual user), itulah yang dipakai sebagai basis.
Laporan: `bulk-repair.json` (dengan `acct` per assignment; resume otomatis dari
laporan — yang sudah OK dilewati). Data `data1..data10`, `region`, `comment`
rekor diambil dari get-by-assignment-id saat itu.

## Format Excel baru + export-template + --map

**Format baru** (header terdeteksi otomatis; semua kolom nilai optional — baris
yang kosong semua dilewati):

| Kolom | Ditolis ke |
|---|---|
| `nama_usaha`, `link_fasih_sm` | penyimak blok `#N` & assignment |
| `biaya_pembelian_baru` | `biaya_pembelian#N` |
| `biaya_produksi_baru` | `biaya_produksi#N` |
| `biaya_operasional_baru` | `operasional#N` |
| `nilai_pendapatan_baru` | `nilai_pendapatan#N` |
| `nilai_pendapatan_lainnya_baru` | `pendapatan_lain#N` |
| `kategori_baru` | `kategori#N` (fallback `kategori_2025#N`) |
| `kode_kbli_baru` | `kbli_akhir#N` (fallback `kbli#N` → `kbli_prelist#N`; string kode polos) |
| `komentar` | teks manual per baris → comment.json (kosong → default `#4`) |

`total_pengeluaran` dihitung ulang = pembelian + produksi + operasional +
non_operasional(lama) + gaji(lama) — NTB otomatis benar. Uji unit: `uji-baru.mjs`.

**`export-template`** (read-only): membuat template CSV format baru —
`--from <excel>` memilih sumber baris (default Excel lama), kolom nilai +
komentar dikosongkan untuk diisi, kolom `diag` diisi verdict `bulk-map.json`
kalau sudah ada. Simpan sebagai .xlsx setelah diisi.

**`--map bulk-map.json`** pada `bulk-repair`: baris TANPA-MATCH/NO-FIELD ybs
dirutekan langsung ke `(assignment, idx)` hasil diag-unmatched (MOVED/REINDEX);
pentargetan MOVED yang belum ada di daftar terdampak otomatis jadi pekerjaan
tambah. Baris NONE tetap manual (link di `bulk-misses.csv`).

**`--sheet` dan `--all`** pada `bulk-repair`: `--sheet Sheet2` memilih sheet
Excel (file "yang tersisa rio.xlsx" bekerja di Sheet2, format baru dengan
kolom `kategori_baru`/`kode_kbli_baru`/`komentar` di kolom terakhir; baris
Tindak Lanjut "Sudah" otomatis dilewati). `--all` menambahkan semua assignment
dari Excel ke daftar kerja (bukan hanya `bulk-affected.json`).

**diag-unmatched mode Excel** (tanpa Chrome dulu):
```powershell
node diag-unmatched.mjs --excel "yang tersisa rio.xlsx" --sheet Sheet2
```
memetakan SEMUA baris Sheet2: kandidat rumah tangga diambil dari cache
(`bulk-cache/`) — tanpa 429. Pass lanjutan (butuh Chrome aktif):
```powershell
node diag-unmatched.mjs --excel ... --sheet Sheet2 --only-none --net --out bulk-map-s2.json
```
`--only-none` menahan MOVED/REINDEX lama, hanya cap sisa. Verdict SELF = blok
cocok di assignment sendiri (dilakukan alur tulis biasa, tidak perlu peta).

## bulk-snapshot

Read-only: untuk semua id di `bulk-state.done` → tarik history + data paket
terkini → simpan `snapshot-<timestamp>.json` (distribusi templateVersion
tercetak di akhir). `--noData` buang isi `data` (lebih kecil).

Alur:

1. `--dry` (opsional) — fetch data semua assignment (2 API call per
   assignment), hitung diff, buat laporan konsol + `bulk-plan.json`.
   `--dry` hanya jaring pengaman: diperlukan bila cache belum lengkap; bila
   cache sudah ada, boleh langsung apply.
2. tanpa `--dry` — konfirmasi (atau `--yes`), lalu per assignment: patch
   data.json → zip baru → presign PUT → S3 → `s3/edit` (status EDITED).
   Progres & status ditulis ke `bulk-state.json` (bisa diulang dengan
   `--resume` supaya yang sudah selesai dilewati), laporan akhir ke
   `bulk-report.json`.

Komentar (catatan sebelah input, "komentar" di UI):

- Ketika SPA menyimpan, zip berisi `data.json` + `comment.json` +
  `media.json` + `reference.zip`; server menyimpan `comment.json` ke field
  record `comment`. `bulk-edit` mengirim paket yang sama: pada tiap field
  yang diubah ditambahkan komentar ke struktur
  `{dataKey:"",notes:[{dataKey:"<field>#N",comments:[{comment,datetime,sender}]}]}`,
  mengikuti komentar lama yang sudah ada di record.
- Teks default: "Perbaikan nilai biaya produksi & biaya operasional sesuai
  perhitungan admin" — ubah dengan `--komentar "teks"`.
- Pengirim (`sender`) otomatis = username user yang login di record.

Monitor: `node fasih-sm.mjs bulk-status` (baca `bulk-progress.json` +
`bulk-state.json`); `--watch` refresh otomatis, `--detail` tampilkan tiap
assignment. `bulk-progress.json` berisi peta setiap nomor baris Excel →
status (`data-ok | fetch-fail | resolusi | applying | teredit | gagal`).

Guard kios terpisah: record yang blok usahanya tidak memiliki kunci
`biaya_produksi#N` & `operasional#N` (template kios terpisah, dataKeys-nya
`total_pengeluaran#N`/`total_pendapatan#N`) tidak cocok strategi rumus —
`computeChanges` melewati baris tersebut dengan alasan "template tak cocok"
sehingga tidak ditulis nilai yang salah makna.

`node fasih-sm.mjs bulk-revert-suspect [--komentar "..."]` — kembalikan
nilai lama untuk daftarassignment di `bulk-suspect.json` (hasil
`diag-suspect.mjs`): data.json dikirim ulang apa adanya dari cache pra-edit
(+ `comment.json` berisi catatan revisi, + `media.json`, `reference.zip`),
status tetap EDITED. Laporan: `bulk-revert.json`.

Catatan: baris yang `nama_usaha`-nya tidak ketemu di data.json (mis. link
pada Excel menunjuk assignment keluarga tanpa usaha, atau nama berubah)
dilaporkan sebagai "Tanpa match" dan tidak ditulis — perbaiki Excel lalu
jalankan ulang.

## File lain di folder ini (perangkat pengembang)

- `capture-cdp.mjs` — perekaman permintaan/respons CDP pasif (natanya analisis pengembangan);
  `analyze-capture.mjs`, `grep-captures.mjs`, `dump-post.mjs` — alat bantu analisis hasil.
- `shot.mjs` — hasil tangkapan layar CDP Tab aktif.
- `captures/` — hasil perekaman (tetap berisi data nyata Anda; jangan dibagikan).
- `scripts/` — salinan bundel SPA untuk referensi analisis statis.

## Catatan teknis penting

- **CSRF**: semua POST API memakai header `X-XSRF-TOKEN` yang nilainya persis
  cookie `XSRF-TOKEN` (dibaca via `document.cookie`; perhatikan `slice(11)` —
  off-by-one menyebabkan 403 Invalid CSRF Token).
- **S3**: PUT/GET ke `sisnas-fasih-assignment.obj.bps.go.id` HARUS dijalankan
  tanpa `credentials: "include"` dan tanpa header CSRF (CORS bucket hanya
  `Access-Control-Allow-Origin: *`; wildcard tidak boleh dipasangkan dengan
  cookies — kalau dilanggar, browser memblokir dengan `TypeError: Failed to fetch`).
- Data formulir diambil dari `assignment-history/data`; isi zip-nya `data.json`
  berupa JSON string `answers[]` FormGear.
- Paket lama berformat `.7z` tidak bisa dibongkar di sini — program membangun
  `data.json` baru dari endpoint riwayat (fallback) sebelum di-zip ulang.
