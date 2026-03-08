# 🚀 Cara Deploy NexLoad ke Railway

---

## Langkah 1 — Buat akun GitHub
1. Buka https://github.com dan daftar (gratis)
2. Klik tombol **"+"** → **"New repository"**
3. Nama repo: `nexload`
4. Set ke **Public** atau **Private** (bebas)
5. Klik **"Create repository"**

---

## Langkah 2 — Upload file ke GitHub

### Cara termudah (tanpa Git/terminal):
1. Di halaman repo GitHub yang baru dibuat, klik **"uploading an existing file"**
2. Upload semua file ini satu per satu atau sekaligus:
   - `server.js`
   - `package.json`
   - `nixpacks.toml`
   - `.gitignore`
   - folder `public/` → `public/index.html`
3. Klik **"Commit changes"**

### Atau pakai terminal (kalau sudah install Git):
```bash
cd nexload
git init
git add .
git commit -m "first commit"
git remote add origin https://github.com/USERNAME/nexload.git
git push -u origin main
```

---

## Langkah 3 — Deploy ke Railway

1. Buka https://railway.app
2. Klik **"Login"** → pilih **"Login with GitHub"**
3. Klik **"New Project"**
4. Pilih **"Deploy from GitHub repo"**
5. Pilih repo `nexload` yang tadi dibuat
6. Railway langsung mulai build otomatis ✅

---

## Langkah 4 — Dapat URL publik

1. Setelah build selesai (1-2 menit), klik tab **"Settings"**
2. Scroll ke bagian **"Networking"**
3. Klik **"Generate Domain"**
4. Kamu dapat URL seperti: `nexload-production.up.railway.app`

**Share URL itu ke teman-teman — selesai! 🎉**

---

## Langkah 5 — Cek apakah berjalan normal

Buka URL ini di browser:
```
https://nexload-production.up.railway.app/api/health
```

Kalau berhasil, akan muncul:
```json
{
  "status": "ok",
  "ytDlp": "2024.xx.xx",
  "node": "v20.x.x"
}
```

---

## ⚠️ Catatan Penting

- **Free tier Railway**: 500 jam/bulan — lebih dari cukup untuk 3-4 user
- Kalau mau project tetap nyala 24/7, tambahkan kartu kredit di Railway 
  (tetap gratis sampai $5/bulan, sangat jarang terpakai untuk pemakaian kecil)
- yt-dlp akan otomatis update sendiri setiap deploy ulang

---

## ❓ Troubleshooting

| Masalah | Solusi |
|---|---|
| Build gagal | Cek apakah semua file terupload ke GitHub |
| "yt-dlp not found" | Pastikan file `nixpacks.toml` ada di repo |
| Download gagal | Video mungkin private atau geo-restricted |
| URL tidak muncul | Klik "Generate Domain" di tab Settings → Networking |
