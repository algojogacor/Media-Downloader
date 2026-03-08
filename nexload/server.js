/**
 * NexLoad — Universal Media Downloader Backend
 * Requires: Node.js 18+, yt-dlp installed on system
 *
 * Install yt-dlp:
 *   Linux/Mac:  sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && sudo chmod a+rx /usr/local/bin/yt-dlp
 *   Windows:    winget install yt-dlp  OR  scoop install yt-dlp
 *   Then run:   npm install && node server.js
 */

const express    = require('express');
const cors       = require('cors');
const path       = require('path');
const fs         = require('fs');
const { exec, spawn } = require('child_process');
const rateLimit  = require('express-rate-limit');
const sanitize   = require('sanitize-filename');
const { v4: uuidv4 } = require('uuid');
const ytDlp      = require('yt-dlp-exec');

const app  = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0'; // Railway requires 0.0.0.0
const TMP  = path.join(__dirname, 'tmp');

// ── Create tmp dir ────────────────────────────────────────────────────────────
if (!fs.existsSync(TMP)) fs.mkdirSync(TMP, { recursive: true });

// ── Middleware ─────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiting — prevent abuse
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20,
  message: { error: 'Too many requests, slow down.' }
});
app.use('/api/', limiter);

// ── Platform detection ─────────────────────────────────────────────────────────
function detectPlatform(url) {
  const u = url.toLowerCase();
  if (u.includes('youtube.com') || u.includes('youtu.be'))   return 'youtube';
  if (u.includes('instagram.com'))                            return 'instagram';
  if (u.includes('tiktok.com') || u.includes('vm.tiktok'))   return 'tiktok';
  if (u.includes('twitter.com') || u.includes('x.com'))      return 'twitter';
  if (u.includes('facebook.com') || u.includes('fb.watch'))  return 'facebook';
  if (u.includes('soundcloud.com'))                          return 'soundcloud';
  if (u.includes('pinterest.com') || u.includes('pin.it'))   return 'pinterest';
  if (u.includes('reddit.com') || u.includes('redd.it'))     return 'reddit';
  return 'other';
}

function isValidUrl(str) {
  try { new URL(str); return str.startsWith('http'); } catch { return false; }
}

// ── Clean up old tmp files (>30 min) ─────────────────────────────────────────
setInterval(() => {
  fs.readdir(TMP, (err, files) => {
    if (err) return;
    const now = Date.now();
    files.forEach(f => {
      const fp = path.join(TMP, f);
      fs.stat(fp, (e, s) => {
        if (!e && now - s.mtimeMs > 30 * 60 * 1000) fs.unlink(fp, () => {});
      });
    });
  });
}, 10 * 60 * 1000);

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/info  — fetch video info + available formats
// Body: { url: string }
// ══════════════════════════════════════════════════════════════════════════════
app.post('/api/info', async (req, res) => {
  const { url } = req.body;

  if (!url || !isValidUrl(url)) {
    return res.status(400).json({ error: 'Invalid URL.' });
  }

  try {
    const info = await ytDlp(url, {
      dumpSingleJson: true,
      noWarnings: true,
      noCallHome: true,
      noCheckCertificate: true,
      preferFreeFormats: true,
      youtubeSkipDashManifest: false,
    });

    // Build clean format list
    const videoFormats = [];
    const audioFormats = [];

    if (info.formats) {
      // Video formats (with video stream)
      const seen = new Set();
      info.formats
        .filter(f => f.vcodec && f.vcodec !== 'none' && f.height)
        .sort((a, b) => (b.height || 0) - (a.height || 0))
        .forEach(f => {
          const key = `${f.height}`;
          if (!seen.has(key)) {
            seen.add(key);
            videoFormats.push({
              formatId: f.format_id,
              label: f.height >= 2160 ? '4K'
                   : f.height >= 1080 ? '1080p'
                   : f.height >= 720  ? '720p'
                   : f.height >= 480  ? '480p'
                   : f.height >= 360  ? '360p'
                   : `${f.height}p`,
              sub: `${f.height}p · ${f.fps || ''}fps`,
              ext: f.ext || 'mp4',
              size: f.filesize
                ? `~${(f.filesize / 1024 / 1024).toFixed(0)}MB`
                : 'N/A',
              height: f.height,
            });
          }
        });

      // Audio-only formats
      const aSeen = new Set();
      info.formats
        .filter(f => f.acodec && f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none'))
        .sort((a, b) => (b.abr || 0) - (a.abr || 0))
        .forEach(f => {
          const abr = Math.round(f.abr || 0);
          const key = `${f.ext}-${abr}`;
          if (!aSeen.has(key)) {
            aSeen.add(key);
            audioFormats.push({
              formatId: f.format_id,
              label: (f.ext || 'mp3').toUpperCase(),
              sub: abr ? `${abr}kbps` : 'Best',
              ext: f.ext || 'mp3',
              size: f.filesize
                ? `~${(f.filesize / 1024 / 1024).toFixed(0)}MB`
                : 'N/A',
              abr,
            });
          }
        });
    }

    // Always offer MP3 conversion option for YouTube
    const platform = detectPlatform(url);
    if (['youtube', 'soundcloud', 'instagram', 'tiktok', 'facebook'].includes(platform)) {
      if (!audioFormats.find(a => a.ext === 'mp3')) {
        audioFormats.unshift({ formatId: 'bestaudio', label: 'MP3', sub: '320kbps', ext: 'mp3', size: 'N/A', abr: 320, convertToMp3: true });
      }
    }

    res.json({
      title:    info.title || 'Unknown Title',
      duration: info.duration,
      thumb:    info.thumbnail,
      uploader: info.uploader || info.channel || '',
      platform: detectPlatform(url),
      videoFormats: videoFormats.slice(0, 6),
      audioFormats: audioFormats.slice(0, 5),
    });

  } catch (err) {
    console.error('[/api/info]', err.message);
    const msg = err.message?.includes('Private')
      ? 'This content is private or geo-restricted.'
      : err.message?.includes('not a')
      ? 'Could not find downloadable media at this URL.'
      : 'Failed to fetch media info. Check the URL and try again.';
    res.status(500).json({ error: msg });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/download  — download & stream file to client
// Body: { url, formatId, ext, convertToMp3 }
// ══════════════════════════════════════════════════════════════════════════════
app.post('/api/download', async (req, res) => {
  const { url, formatId, ext, convertToMp3, title } = req.body;

  if (!url || !isValidUrl(url)) {
    return res.status(400).json({ error: 'Invalid URL.' });
  }

  const id       = uuidv4();
  const safeTitle = sanitize(title || 'media').replace(/\s+/g, '_').slice(0, 60);
  const outExt   = convertToMp3 ? 'mp3' : (ext || 'mp4');
  const outFile  = path.join(TMP, `${id}.${outExt}`);

  // Build yt-dlp arguments
  const args = [];

  if (convertToMp3 || ext === 'mp3') {
    // Audio extraction + convert to mp3
    args.push('-f', formatId || 'bestaudio');
    args.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
  } else if (formatId && formatId !== 'bestaudio' && formatId !== 'bestvideo') {
    // Merge best audio with selected video format
    args.push('-f', `${formatId}+bestaudio/best[height<=${getHeightFromFormatId(formatId)}]/best`);
    args.push('--merge-output-format', 'mp4');
  } else {
    args.push('-f', 'bestvideo+bestaudio/best');
    args.push('--merge-output-format', 'mp4');
  }

  args.push(
    '--no-warnings',
    '--no-call-home',
    '--no-check-certificate',
    '--no-playlist',
    '-o', outFile,
    url
  );

  console.log(`[download] yt-dlp ${args.join(' ')}`);

  // Spawn yt-dlp process
  const proc = spawn('yt-dlp', args);
  let stderr = '';

  proc.stderr.on('data', d => { stderr += d.toString(); });
  proc.stdout.on('data', d => { process.stdout.write(d); });

  proc.on('close', async (code) => {
    if (code !== 0) {
      console.error('[yt-dlp stderr]', stderr);
      fs.unlink(outFile, () => {});
      return res.status(500).json({ error: 'Download failed. The media may be restricted or unavailable.' });
    }

    // Find actual output file (yt-dlp may add extension)
    let finalFile = outFile;
    if (!fs.existsSync(outFile)) {
      // Search for file with this id
      const files = fs.readdirSync(TMP).filter(f => f.startsWith(id));
      if (files.length) finalFile = path.join(TMP, files[0]);
      else return res.status(500).json({ error: 'Output file not found after processing.' });
    }

    const stat    = fs.statSync(finalFile);
    const mime    = getMime(path.extname(finalFile).slice(1));
    const dlName  = `${safeTitle}.${path.extname(finalFile).slice(1)}`;

    res.setHeader('Content-Disposition', `attachment; filename="${dlName}"`);
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Length', stat.size);

    const stream = fs.createReadStream(finalFile);
    stream.pipe(res);
    stream.on('end', () => {
      fs.unlink(finalFile, () => {});
    });
    stream.on('error', () => {
      res.status(500).json({ error: 'Error streaming file.' });
    });
  });

  proc.on('error', (err) => {
    console.error('[spawn error]', err);
    res.status(500).json({
      error: 'yt-dlp not found. Please install it: https://github.com/yt-dlp/yt-dlp#installation'
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/health
// ══════════════════════════════════════════════════════════════════════════════
app.get('/api/health', (req, res) => {
  exec('yt-dlp --version', (err, stdout) => {
    res.json({
      status: 'ok',
      ytDlp: err ? 'NOT INSTALLED' : stdout.trim(),
      node: process.version,
    });
  });
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function getMime(ext) {
  const map = {
    mp4: 'video/mp4',
    webm: 'video/webm',
    mkv: 'video/x-matroska',
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    ogg: 'audio/ogg',
    opus: 'audio/opus',
    flac: 'audio/flac',
    jpg: 'image/jpeg',
    png: 'image/png',
  };
  return map[ext] || 'application/octet-stream';
}

function getHeightFromFormatId(id) {
  // Fallback: if format_id doesn't encode height, use 1080
  const match = String(id).match(/(\d{3,4})p/);
  return match ? match[1] : '1080';
}

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, HOST, () => {
  console.log(`\n🚀 NexLoad running at http://${HOST}:${PORT}`);
  console.log(`   Check yt-dlp: http://localhost:${PORT}/api/health\n`);
});
