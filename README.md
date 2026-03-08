# 🚀 NexLoad — Universal Media Downloader

Zero ads. No watermarks. 8 platforms. Fully self-hosted.

---

## ✅ Supported Platforms
- YouTube (up to 4K + MP3 extraction)
- Instagram (Reels, Posts, Stories)
- TikTok (no watermark)
- Twitter / X
- Facebook (public videos)
- SoundCloud
- Pinterest
- Reddit (video + audio merged)

---

## 📦 Requirements

- **Node.js** v18 or newer → https://nodejs.org
- **yt-dlp** (the download engine) → https://github.com/yt-dlp/yt-dlp
- **ffmpeg** (for merging audio/video and MP3 conversion)

---

## ⚙️ Installation

### 1. Install yt-dlp

**Linux / macOS:**
```bash
sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
  -o /usr/local/bin/yt-dlp
sudo chmod a+rx /usr/local/bin/yt-dlp
```

**Windows (via winget):**
```
winget install yt-dlp
```

**Windows (via scoop):**
```
scoop install yt-dlp
```

### 2. Install ffmpeg

**Linux:**
```bash
sudo apt install ffmpeg        # Debian/Ubuntu
sudo dnf install ffmpeg        # Fedora
```

**macOS:**
```bash
brew install ffmpeg
```

**Windows:**
Download from https://ffmpeg.org/download.html and add to PATH.

### 3. Install Node.js dependencies

```bash
cd nexload
npm install
```

---

## ▶️ Running the server

```bash
node server.js
```

Then open your browser at: **http://localhost:3000**

For development with auto-reload:
```bash
npm run dev
```

---

## 🔍 Verify everything works

Visit: http://localhost:3000/api/health

You should see:
```json
{
  "status": "ok",
  "ytDlp": "2024.xx.xx",
  "node": "v20.x.x"
}
```

---

## 📁 Project Structure

```
nexload/
├── server.js          ← Express backend (API)
├── package.json
├── tmp/               ← Temporary files (auto-cleaned every 30min)
└── public/
    └── index.html     ← Frontend UI
```

---

## ⚠️ Notes

- **Only download content you own or have rights to download.**
- Private/geo-restricted videos may fail — this is expected.
- The `tmp/` folder is auto-cleaned every 30 minutes.
- Rate limited to 20 requests/minute per IP to prevent abuse.

---

## 🛠️ Troubleshooting

| Problem | Fix |
|---|---|
| `yt-dlp not found` | Re-install yt-dlp and make sure it's in PATH |
| No video+audio merge | Install ffmpeg |
| Instagram fails | Instagram increasingly restricts public access |
| Port 3000 in use | `PORT=8080 node server.js` |
