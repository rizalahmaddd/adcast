# Berkontribusi

Terima kasih sudah tertarik berkontribusi ke AdCast!

## Alur Kontribusi

1. Buka issue terlebih dahulu untuk perubahan besar atau usulan fitur baru, agar arah perbaikan bisa disepakati sebelum menulis kode.
2. Fork repository ini, lalu buat branch baru dari `main`.
3. Jalankan project mengikuti panduan [docs/getting-started.md](./docs/getting-started.md).
4. Pastikan seluruh pemeriksaan lolos sebelum mengajukan Pull Request:

   ```sh
   pnpm typecheck
   pnpm test
   pnpm build
   ```

5. Untuk perubahan skema database, tambahkan file migrasi baru di `migrations/`:

   ```sh
   pnpm exec wrangler d1 migrations create adcast <nama_migrasi>
   ```

   Migrasi yang sudah pernah dirilis jangan diubah; selalu buat file baru.

## Panduan Kode

- TypeScript strict, tanpa `any` implisit.
- Teks yang dilihat pengguna memakai Bahasa Indonesia; nama variabel dan komentar teknis tetap Bahasa Inggris seperti kode yang sudah ada.
- Tulis komentar hanya untuk menjelaskan *alasan*, bukan mengulang apa yang sudah jelas dari kode.
- Setiap query database wajib memfilter `tenant_id` dari sesi, bukan dari body request.
- **Penting:** jangan pernah meng-commit `.dev.vars` atau `wrangler.jsonc` milikmu. Keduanya memuat secret dan id resource produksi, dan sudah ada di `.gitignore`.

## Melaporkan Masalah

Gunakan fitur **Issues** untuk melaporkan bug atau usulan fitur. Untuk celah keamanan, ikuti instruksi privat di [SECURITY.md](./SECURITY.md).
