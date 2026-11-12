# Panduan Memulai

AdCast berjalan di Cloudflare Workers, jadi pengembangan lokal memakai `wrangler dev` lewat plugin Vite dengan D1 dan R2 tiruan di dalam `.wrangler/`.

## Yang dibutuhkan

- Node.js 22 atau lebih baru
- pnpm 10
- Akun Cloudflare (baru dibutuhkan saat deploy, tidak untuk pengembangan lokal)

## 1. Pasang dependensi

```sh
pnpm install
```

## 2. Buat konfigurasi Worker

Config asli tidak ikut di repo karena memuat account id, id database, dan domain. Salin dari template:

```sh
cp wrangler.example.jsonc wrangler.jsonc
```

Untuk lokal, `database_id` boleh diisi UUID apa pun, misalnya:

```jsonc
"database_id": "00000000-0000-0000-0000-000000000000"
```

Saat deploy, ganti dengan id asli dari `wrangler d1 create`.

## 3. Siapkan database lokal

```sh
pnpm db:migrate
```

Perintah ini menjalankan `wrangler d1 migrations apply adcast --local` dan membuat database SQLite di `.wrangler/state/`.

## 4. Variabel lokal (opsional)

```sh
cp .dev.vars.example .dev.vars
```

Tidak ada satu pun yang wajib. Fitur yang tidak punya kuncinya otomatis disembunyikan dari UI:

- `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` untuk masuk dengan Google
- `GOOGLE_API_KEY` untuk impor Google Drive
- `DROPBOX_APP_KEY`, `ONEDRIVE_CLIENT_ID` untuk impor cloud lain
- `VAPID_*` untuk push notification (`node scripts/gen-vapid.mjs` membuat pasangan kuncinya)
- `ADMIN_EMAILS` untuk membuka `/pembayaran` sebagai operator
- `QRIS_PAYLOAD` untuk mengaktifkan pembelian paket

## 5. Jalankan

```sh
pnpm dev
```

Buka <http://localhost:5173>.

1. Buka `/daftar` dan buat usaha pertama. Akun pertama di sebuah usaha menjadi pemilik.
2. Buka `/player` di tab atau jendela lain. Halaman itu menampilkan QR dan kode 6 karakter — itulah calon TV.
3. Dari HP, pindai QR tersebut (atau buka **Layar** di dashboard dan masukkan kodenya). TV langsung menerima token dan siap dipakai.
4. Tambahkan video di **Video** (YouTube atau tautan https paling cepat, karena paket Gratis tidak menyimpan file), susun **Playlist**, lalu kirim ke layar.

## 6. Menjalankan pemeriksaan

```sh
pnpm test                  # unit test (jadwal, pembayaran, waktu salat, TOTP)
pnpm typecheck             # TypeScript strict untuk worker, web, dan node
node scripts/smoke.mjs     # test API end-to-end, butuh `pnpm dev` tetap berjalan
```

`scripts/smoke.mjs` mendaftarkan tenant baru, memasangkan perangkat, menjalankan siaran, dan memeriksa pembayaran. Pastikan `ADMIN_EMAILS=admin@adcast.test` ada di `.dev.vars`, dan `QRIS_PAYLOAD` terisi bila ingin bagian pembayaran ikut diuji.

## Tips

- `.dev.vars` dan `wrangler.jsonc` tidak boleh di-commit. Keduanya sudah ada di `.gitignore`.
- Data lokal bisa direset kapan saja dengan menghapus `.wrangler/state/` lalu menjalankan `pnpm db:migrate` lagi.
- `pnpm types` membuat ulang `worker-configuration.d.ts` setelah binding di `wrangler.jsonc` berubah.
