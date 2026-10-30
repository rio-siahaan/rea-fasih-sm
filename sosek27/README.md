# sosek27

Workflow khusus `data_excel/sosial27.xlsx`.

## Aturan

- Sumber: `data_excel/sosial27.xlsx`.
- Hanya baris yang **`nik` dan `nama_kk` sama-sama tidak duplikat** di file yang diproses.
- Target komentar `#0`:
  - **Blok P**: `no_kk`
  - **L Blok I**: `nik_dtsen#N` milik anggota yang NIK-nya cocok dengan NIK di file
- NIK boleh milik anggota mana pun, tidak harus kepala keluarga.
- Komentar lain dipertahankan; `#0` tidak ditulis dua kali.
- File sumber tidak diubah. Hasil ditulis ke `data_excel/sosial27_hasil.xlsx`.

## Perintah

```bash
# audit saja: buat hasil Excel + report, tanpa menulis ke FASIH
node sosek27/robot-sosial27.mjs

# tulis ke FASIH (butuh Chrome 3 port aktif)
node sosek27/robot-sosial27.mjs --write --yes

# uji satu baris
node sosek27/robot-sosial27.mjs --write --yes --limit 1

# pilih baris tertentu
node sosek27/robot-sosial27.mjs --write --yes --rows 80,115

# cek target tanpa upload
node sosek27/robot-sosial27.mjs --dry-run
```

Opsi lain:

- `--excel <path>` sumber, default `data_excel/sosial27.xlsx`
- `--out <path>` hasil, default `data_excel/sosial27_hasil.xlsx`
- `--report <path>` CSV, default `sosek27/sosial27_report.csv`
- `--json <path>` JSON, default `sosek27/sosial27_report.json`
- `--delay <ms>` jeda antar-assignment, default `2000`

## Kolom hasil di Excel

Lima kolom baru ditambahkan di kanan data lama:

| Kolom | Isi |
|---|---|
| `ASSIGNMENT ID` | ID assignment dari hyperlink `link_fasih_sm` |
| `STATUS ROBOT` | `BERHASIL`, `GAGAL`, `SUDAH ADA` (dry-run), `SIAP` (audit), `SKIP` |
| `TARGET #0` | target yang ditulis, mis. `no_kk; nik_dtsen#3` |
| `CATATAN ROBOT` | detail hasil/error/alasan skip |
| `WAKTU PROSES` | waktu proses |

Kolom asli (`KODE REMARK`, `SUDAH TINDAK LANJUT DI FASIH?`, `Kolom 1`, dll.) tidak diubah.

## Catatan teknis

- `link_fasih_sm` sering berupa sel kosong dengan hyperlink Excel. Assignment ID dibaca dari relasi hyperlink, bukan dari nilai sel.
- Posisi kolom link dicari dari header, tidak di-hardcode.
- Setelah upload, script membaca ulang assignment untuk memastikan `#0` benar-benar ada di `no_kk` dan `nik_dtsen#N`.
