# Saran fitur AdCast berikutnya

Catatan 11 November 2026. Urutan di bawah adalah urutan yang saya sarankan untuk dikerjakan: paling berguna bagi pelanggan dan paling murah dibangun lebih dulu.

## Layak dikerjakan

### 1. Teks berjalan
Satu baris teks yang bergerak di bawah tayangan: promo hari ini, pengumuman, nomor antrean, jam buka.

- Kenapa: hampir selalu diminta untuk layar toko, klinik, dan ruang tunggu. Pelanggan bisa mengganti pesan tanpa membuat video baru.
- Bentuknya: teks diatur per cabang atau per kiriman tayangan, dengan pilihan kecepatan dan warna latar. TV menggambar teksnya sendiri di atas video atau foto.
- Biaya jalan: nol. Hanya teks yang ikut dikirim bersama perintah tayang.
- Paket: semua paket. Fitur ini membantu orang betah di paket Gratis sampai butuh lebih banyak layar.

### 2. Layar tegak (portrait)
Pengaturan putar 90° atau 270° per layar, untuk TV yang dipasang berdiri.

- Kenapa: banyak layar promosi di mal, apotek, dan lobi dipasang tegak. Tanpa ini pelanggan harus memutar videonya sendiri sebelum upload.
- Bentuknya: pilihan orientasi di "Ubah layar". TV memutar tampilannya lewat CSS, tidak ada proses ulang file.
- Biaya jalan: nol.
- Paket: semua paket.

### 3. Masa berlaku konten
Tanggal mulai dan tanggal selesai per media.

- Kenapa: promo yang sudah lewat masih tayang adalah keluhan klasik. Dengan ini promo berhenti sendiri saat periodenya habis.
- Bentuknya: dua kolom tanggal opsional di media. Item di luar masa berlakunya dilewati saat playlist disusun untuk TV.
- Hal yang perlu diputuskan: playlist yang semua isinya kedaluwarsa sebaiknya menampilkan layar diam atau tetap memutar item terakhir.
- Paket: semua paket.

### 4. Pengumuman darurat
Satu tombol untuk menimpa semua layar (atau satu cabang) dengan pesan teks besar, lalu kembali ke tayangan semula saat dimatikan.

- Kenapa: berguna untuk "toko tutup lebih awal", "antrean pindah ke lantai 2", atau keadaan darurat. Saat ini caranya harus kirim tayangan baru lalu kirim ulang yang lama.
- Bentuknya: pesan disimpan terpisah dari tayangan, jadi tayangan yang sedang berjalan tidak hilang.
- Paket: Pro ke atas, karena paling berguna bagi yang punya banyak layar.

### 5. Laporan mingguan otomatis
Ringkasan statistik dikirim tiap minggu lewat email atau WhatsApp: persentase online tiap layar, konten terbanyak tayang, layar yang sering offline.

- Kenapa: pemilik usaha jarang membuka dashboard. Laporan yang datang sendiri membuat mereka merasakan nilai langganannya, dan itu menahan mereka berhenti.
- Bentuknya: tugas terjadwal mingguan yang membaca data statistik yang sudah ada.
- Biaya jalan: butuh layanan pengirim email (banyak yang gratis sampai ribuan email per bulan). WhatsApp lebih mahal dan butuh akun bisnis resmi.
- Paket: Bisnis. Ini pembeda yang jelas dari Pro.

## Layak dipikirkan setelah itu

- **Pembayaran otomatis.** Konfirmasi manual cukup selama pesanan masih beberapa per hari. Begitu lebih dari itu, pindah ke payment gateway dengan QRIS dinamis supaya paket aktif sendiri. Biayanya potongan per transaksi.
- **Pengingat perpanjangan.** Notifikasi H-7 dan H-1 ke pemilik usaha lewat email. Sekarang pengingat hanya muncul kalau dashboard dibuka.
- **Aplikasi Android TV.** Sekarang TV membuka halaman pemutar lewat browser. Aplikasi kecil yang langsung membuka pemutar saat TV menyala menghilangkan langkah manual setelah mati listrik.
- **Bagi layar.** Video di satu sisi, foto atau teks di sisi lain. Berguna, tetapi pengerjaannya lumayan dan baru terasa nilainya setelah teks berjalan ada.

## Tidak saya sarankan dulu

- **Editor atau template desain di dalam aplikasi.** Pengerjaannya besar, dan pelanggan umumnya sudah membuat materi di Canva lalu tinggal upload.
- **Siaran langsung (live streaming).** Biaya server dan kerumitannya jauh di atas fitur lain, dan YouTube Live sudah bisa ditayangkan lewat tautan YouTube.

## Catatan soal harga

Hitungan biaya per pelanggan ada di README bagian "What a tenant costs to run". Ringkasnya, biaya terbesar adalah storage upload (sekitar Rp 5.000 per bulan untuk kuota Pro yang terisi penuh), jadi fitur yang tidak menambah file tersimpan aman untuk diberikan ke semua paket. Yang belum saya hitung adalah potongan QRIS untuk merchant Anda.
