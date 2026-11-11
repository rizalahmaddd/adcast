# Kebijakan Keamanan

## Melaporkan Celah Keamanan

Mohon **jangan** melaporkan celah keamanan lewat issue publik.

Laporkan secara privat lewat tab **Security → Report a vulnerability** di repo GitHub ini (GitHub Private Vulnerability Reporting). Sertakan:

- Jenis celah dan potensi dampaknya,
- Langkah terperinci untuk mereproduksi masalah,
- Versi atau commit yang terdampak.

Laporan akan ditinjau dan ditanggapi secepatnya. Setelah perbaikan dirilis, pelapor akan dicantumkan di catatan rilis jika berkenan.

## Versi yang Didukung

Perbaikan keamanan hanya dirilis untuk versi terbaru di branch `main`.

## Catatan untuk Pengguna yang Self-Host

- `.dev.vars` dan `wrangler.jsonc` memuat secret serta id resource; keduanya tidak boleh masuk version control.
- Simpan `GOOGLE_CLIENT_SECRET`, `VAPID_PRIVATE_KEY`, `ADMIN_EMAILS`, dan `QRIS_PAYLOAD` sebagai secret Worker (`wrangler secret put`), bukan sebagai `vars`.
- Ganti kata sandi akun operator dan `ADMIN_EMAILS` bila sebuah deployment pernah dibagikan ke publik.
