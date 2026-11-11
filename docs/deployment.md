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

## Deploy otomatis dari GitHub

Dua workflow di `.github/workflows/` men-deploy sendiri setiap ada push:

| Branch | Worker | Domain | Database |
| --- | --- | --- | --- |
| `main` | `adcast` | `adcast.biz.id` | D1 `adcast`, R2 `adcast-media` |
| `dev` | `adcast-dev` | `dev.adcast.biz.id` | D1 `adcast-dev`, R2 `adcast-media-dev` |

Dev sengaja memakai Worker, D1, dan R2 sendiri. Kalau hanya domainnya yang berbeda, data dev akan masuk ke database produksi.

Setelah tes lolos, workflow menjalankan migrasi D1 lalu deploy. Wrangler otomatis memakai config hasil build (`.wrangler/deploy/config.json`), jadi aset statis dan Worker ikut naik bersama.

### Sekali saja: siapkan resource dev

```sh
pnpm exec wrangler d1 create adcast-dev
pnpm exec wrangler r2 bucket create adcast-media-dev
```

Salin config produksi lalu ubah bagian dev:

```sh
cp wrangler.jsonc wrangler.dev.jsonc
```

- `name` → `adcast-dev`
- `routes` → `dev.adcast.biz.id`
- `d1_databases` → database `adcast-dev` beserta `database_id` barunya
- `r2_buckets` → `adcast-media-dev`
- `triggers.crons` boleh dihapus supaya dev tidak ikut menjalankan cron produksi
- blok `migrations` Durable Object tetap dibiarkan

`wrangler.dev.jsonc` sudah masuk `.gitignore`, jadi tidak ikut ter-commit.

### Sekali saja: isi secret per environment

Workflow memakai GitHub Environment (`production` dan `development`) supaya kredensial produksi tidak bisa dibaca job dev. Buat dulu kedua environment di **Settings → Environments → New environment**.

Secret yang dipakai:

| Environment | Secret | Isi |
| --- | --- | --- |
| `production` | `CLOUDFLARE_API_TOKEN` | Token dengan izin Workers Scripts: Edit, D1: Edit, R2: Edit, Workers Routes: Edit, DNS: Edit |
| `production` | `CLOUDFLARE_ACCOUNT_ID` | Account id Cloudflare |
| `production` | `WRANGLER_CONFIG_MAIN` | Isi file `wrangler.jsonc` produksi |
| `development` | `CLOUDFLARE_API_TOKEN` | Token terpisah bila bisa, dengan izin yang sama |
| `development` | `CLOUDFLARE_ACCOUNT_ID` | Account id Cloudflare |
| `development` | `WRANGLER_CONFIG_DEV` | Isi file `wrangler.dev.jsonc` |

Lewat `gh`:

```sh
gh secret set CLOUDFLARE_API_TOKEN --env production --body "<token-produksi>"
gh secret set CLOUDFLARE_ACCOUNT_ID --env production --body "<account-id>"
gh secret set WRANGLER_CONFIG_MAIN --env production < wrangler.jsonc

gh secret set CLOUDFLARE_API_TOKEN --env development --body "<token-dev>"
gh secret set CLOUDFLARE_ACCOUNT_ID --env development --body "<account-id>"
gh secret set WRANGLER_CONFIG_DEV --env development < wrangler.dev.jsonc
```

Kalau `wrangler.jsonc` atau `wrangler.dev.jsonc` diubah (misalnya ganti domain atau database), perbarui secret environment yang sesuai. Workflow membaca config dari secret, bukan dari repo.

### Sekali saja: secret milik Worker

Secret runtime tidak ikut di-deploy oleh workflow. Setel manual per environment:

```sh
# Produksi
pnpm exec wrangler secret put ADMIN_EMAILS
pnpm exec wrangler secret put QRIS_PAYLOAD

# Dev — sengaja tanpa QRIS_PAYLOAD supaya pembelian paket mati
pnpm exec wrangler secret put ADMIN_EMAILS --config wrangler.dev.jsonc
```

Secret lain (`GOOGLE_*`, `DROPBOX_APP_KEY`, `ONEDRIVE_CLIENT_ID`, `VAPID_*`) diisi dengan cara yang sama bila dipakai di environment tersebut.

### Setelah itu

- Push ke `main` → deploy produksi.
- Push ke `dev` → deploy dev.
- Workflow juga bisa dijalankan manual lewat tab **Actions**. Deploy produksi tetap hanya mau berjalan dari branch `main`.
- Untuk mengunci produksi, buka **Settings → Environments → production** lalu tambahkan required reviewer.
- `dev.adcast.biz.id` harus berada di zone Cloudflare yang sama; Wrangler membuat record DNS dan sertifikatnya sendiri.

## Catatan operasional

- **Cron harian**: `triggers.crons` di `wrangler.jsonc` berjalan 19:00 UTC (02:00 WIB) untuk menghapus upload milik paket yang berakhir lebih dari 30 hari lalu.
- **Free tier yang perlu dipantau**: 100k request Worker per hari, 10 GB R2, 5 GB D1, dan 10 ms CPU per request. Hashing password (PBKDF2 100k iterasi) adalah request terberat; kalau login gagal dengan error 1102, pindah ke Workers Paid.
- **Rahasia tetap lokal**: `.dev.vars` dan `wrangler.jsonc` sudah masuk `.gitignore`. Jangan pernah commit keduanya.
- **Regenerasi tipe**: jalankan `pnpm types` setiap kali binding di `wrangler.jsonc` berubah.
