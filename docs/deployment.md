# Deploy ke Cloudflare

Semua bagian AdCast tinggal di satu akun Cloudflare: satu Worker (API + aset statis), satu database D1, satu bucket R2, dan Durable Objects untuk kanal realtime.

## 1. Login wrangler

```sh
pnpm exec wrangler login
```

## 2. Buat resource

```sh
pnpm exec wrangler d1 create adcast
pnpm exec wrangler r2 bucket create adcast-media
```

`wrangler d1 create` mencetak `database_id`. Simpan nilainya.

## 3. Siapkan `wrangler.jsonc`

Config asli tidak ikut di repo. Salin dari template lalu isi:

```sh
cp wrangler.example.jsonc wrangler.jsonc
```

- `database_id` → id dari langkah 2
- `account_id` → buka komentarnya bila akun Cloudflare kamu lebih dari satu
- `routes` → buka komentarnya dan ganti dengan domain sendiri, atau hapus untuk memakai `*.workers.dev`

```jsonc
"routes": [{ "pattern": "adcast.example.com", "custom_domain": true }],
```

Domain harus berada di akun yang sama. Wrangler membuat record DNS dan sertifikatnya sendiri.

## 4. Jalankan migrasi ke database produksi

```sh
pnpm db:migrate:remote
```

## 5. Setel secret

Semua secret opsional; fitur yang tidak punya kuncinya tidak muncul di UI.

| Secret | Untuk |
| --- | --- |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Masuk dengan Google. Redirect URI: `https://<domain>/api/auth/google/callback` |
| `GOOGLE_API_KEY` | Impor Google Drive (butuh Picker API + Drive API, scope `drive.readonly`) |
| `DROPBOX_APP_KEY` | Impor Dropbox |
| `ONEDRIVE_CLIENT_ID` | Impor OneDrive. Redirect URI: `https://<domain>/onedrive-picker.html` |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Push notification saat layar offline (`node scripts/gen-vapid.mjs`) |
| `ADMIN_EMAILS` | Email operator (dipisah koma) yang boleh mengonfirmasi pembayaran di `/pembayaran` |
| `QRIS_PAYLOAD` | Teks QRIS statis merchant yang dipakai di `/paket` |

```sh
pnpm exec wrangler secret put ADMIN_EMAILS
pnpm exec wrangler secret put QRIS_PAYLOAD
```

### Urutan yang penting untuk `QRIS_PAYLOAD`

`QRIS_PAYLOAD` dulunya ditulis di `vars` pada `wrangler.jsonc`. Sekarang tempatnya hanya di secret, karena config ikut dipublikasikan. Wrangler menolak satu nama yang ada di `vars` sekaligus sebagai secret, jadi pada deployment pertama:

1. `wrangler secret put QRIS_PAYLOAD` (tempel payload merchant),
2. baru `pnpm deploy` dengan `wrangler.jsonc` yang sudah tidak punya blok `vars`.

Kalau urutannya dibalik, aplikasi tetap aman tetapi pembelian paket ditolak: `/paket` menyembunyikan tombol beli dan `POST /api/billing/orders` menjawab 400 "Pembayaran belum disiapkan di server ini". Setelah secret masuk, semuanya langsung jalan tanpa deploy ulang.

Untuk memakai merchant lain, ambil teks di balik gambar QRIS statis (aplikasi pembaca QR bisa menampilkannya) lalu simpan sebagai `QRIS_PAYLOAD` yang baru.

## 6. Deploy

```sh
pnpm deploy
```

`pnpm deploy` menjalankan `pnpm build` (TypeScript + Vite) lalu `wrangler deploy`.

## 7. Periksa hasilnya

```sh
curl -s https://<domain>/api/auth/config
pnpm exec wrangler tail
```

- Buka `https://<domain>/daftar` lalu buat usaha pertama.
- Buka `/paket`: kartu paket muncul, dan tombol beli aktif hanya kalau `QRIS_PAYLOAD` valid.
- Buka `https://<domain>/player` di TV atau HP: halaman player harus memuat dan menampilkan kode pairing.

## Catatan operasional

- **Cron harian**: `triggers.crons` di `wrangler.jsonc` berjalan 19:00 UTC (02:00 WIB) untuk menghapus upload milik paket yang berakhir lebih dari 30 hari lalu.
- **Free tier yang perlu dipantau**: 100k request Worker per hari, 10 GB R2, 5 GB D1, dan 10 ms CPU per request. Hashing password (PBKDF2 100k iterasi) adalah request terberat; kalau login gagal dengan error 1102, pindah ke Workers Paid.
- **Rahasia tetap lokal**: `.dev.vars` dan `wrangler.jsonc` sudah masuk `.gitignore`. Jangan pernah commit keduanya.
- **Regenerasi tipe**: jalankan `pnpm types` setiap kali binding di `wrangler.jsonc` berubah.
