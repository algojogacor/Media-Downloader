/**
 * NexLoad — Universal Media Downloader Backend
 * Node.js 18+ | yt-dlp + ffmpeg required
 */

const express   = require('express');
const cors      = require('cors');
const path      = require('path');
const fs        = require('fs');
const { exec, spawn } = require('child_process');
const rateLimit = require('express-rate-limit');
const sanitize  = require('sanitize-filename');
const { v4: uuidv4 } = require('uuid');

const app  = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const TMP  = path.join(__dirname, 'tmp');

// ── Create tmp dir ─────────────────────────────────────────────────────────────
if (!fs.existsSync(TMP)) fs.mkdirSync(TMP, { recursive: true });

// ── Middleware ─────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: 'Too many requests, slow down.' },
});
app.use('/api/', limiter);

// ── Helpers ────────────────────────────────────────────────────────────────────
function isValidUrl(str) {
  try { new URL(str); return str.startsWith('http'); } catch { return false; }
}

function detectPlatform(url) {
  const u = url.toLowerCase();
  if (u.includes('youtube.com') || u.includes('youtu.be'))   return 'youtube';
  if (u.includes('instagram.com'))                            return 'instagram';
  if (u.includes('tiktok.com') || u.includes('vm.tiktok'))   return 'tiktok';
  if (u.includes('twitter.com') || u.includes('x.com'))      return 'twitter';
  if (u.includes('facebook.com') || u.includes('fb.watch'))  return 'facebook';
  if (u.includes('soundcloud.com'))                           return 'soundcloud';
  if (u.includes('pinterest.com') || u.includes('pin.it'))   return 'pinterest';
  if (u.includes('reddit.com') || u.includes('redd.it'))     return 'reddit';
  return 'other';
}

function getMime(ext) {
  const map = {
    mp4: 'video/mp4', webm: 'video/webm', mkv: 'video/x-matroska',
    mp3: 'audio/mpeg', m4a: 'audio/mp4', ogg: 'audio/ogg',
    opus: 'audio/opus', flac: 'audio/flac', jpg: 'image/jpeg', png: 'image/png',
  };
  return map[ext] || 'application/octet-stream';
}

// Run yt-dlp, collect stdout, return parsed JSON
function ytDlpJson(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('yt-dlp', args);
    let out = '', err = '';
    proc.stdout.on('data', d => { out += d.toString(); });
    proc.stderr.on('data', d => { err += d.toString(); });
    proc.on('error', () => reject(new Error('yt-dlp not found in PATH.')));
    proc.on('close', code => {
      if (code !== 0) return reject(new Error(err || 'yt-dlp error'));
      try { resolve(JSON.parse(out)); }
      catch { reject(new Error('Failed to parse yt-dlp output')); }
    });
  });
}

// ── Auto clean tmp every 10 min ───────────────────────────────────────────────
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
// POST /api/info
// ══════════════════════════════════════════════════════════════════════════════
app.post('/api/info', async (req, res) => {
  const { url } = req.body;
  if (!url || !isValidUrl(url)) return res.status(400).json({ error: 'Invalid URL.' });

  try {
    const info = await ytDlpJson([
      '--dump-single-json',
      '--no-warnings',
      '--no-call-home',
      '--no-check-certificate',
      '--no-playlist',
      url,
    ]);

    const videoFormats = [];
    const audioFormats = [];

    if (info.formats) {
      const seen = new Set();
      info.formats
        .filter(f => f.vcodec && f.vcodec !== 'none' && f.height)
        .sort((a, b) => (b.height || 0) - (a.height || 0))
        .forEach(f => {
          const key = String(f.height);
          if (!seen.has(key)) {
            seen.add(key);
            videoFormats.push({
              formatId: f.format_id,
              label:
                f.height >= 2160 ? '4K'
                : f.height >= 1080 ? '1080p'
                : f.height >= 720  ? '720p'
                : f.height >= 480  ? '480p'
                : f.height >= 360  ? '360p'
                : `${f.height}p`,
              sub: `${f.height}p${f.fps ? ' · ' + Math.round(f.fps) + 'fps' : ''}`,
              ext: f.ext || 'mp4',
              size: f.filesize ? `~${(f.filesize / 1024 / 1024).toFixed(0)}MB` : 'N/A',
              height: f.height,
            });
          }
        });

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
              size: f.filesize ? `~${(f.filesize / 1024 / 1024).toFixed(0)}MB` : 'N/A',
              abr,
            });
          }
        });
    }

    // Always include MP3 option for audio-capable platforms
    const platform = detectPlatform(url);
    if (!audioFormats.find(a => a.ext === 'mp3')) {
      audioFormats.unshift({
        formatId: 'bestaudio',
        label: 'MP3',
        sub: '320kbps',
        ext: 'mp3',
        size: 'N/A',
        abr: 320,
        convertToMp3: true,
      });
    }

    res.json({
      title:        info.title || 'Unknown Title',
      duration:     info.duration,
      thumb:        info.thumbnail,
      uploader:     info.uploader || info.channel || '',
      platform,
      videoFormats: videoFormats.slice(0, 6),
      audioFormats: audioFormats.slice(0, 5),
    });

  } catch (err) {
    console.error('[/api/info]', err.message);
    const msg =
      err.message.toLowerCase().includes('private')
        ? 'This content is private or geo-restricted.'
        : err.message.includes('PATH')
        ? 'Server error: yt-dlp is not installed.'
        : err.message.includes('not a')
        ? 'No downloadable media found at this URL.'
        : 'Failed to fetch media info. Check the URL and try again.';
    res.status(500).json({ error: msg });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/download
// ══════════════════════════════════════════════════════════════════════════════
app.post('/api/download', async (req, res) => {
  const { url, formatId, ext, convertToMp3, title } = req.body;
  if (!url || !isValidUrl(url)) return res.status(400).json({ error: 'Invalid URL.' });

  const id        = uuidv4();
  const safeTitle = sanitize(title || 'media').replace(/\s+/g, '_').slice(0, 60) || 'media';
  const outExt    = convertToMp3 ? 'mp3' : (ext || 'mp4');
  const outFile   = path.join(TMP, `${id}.${outExt}`);

  const args = [];

  if (convertToMp3 || ext === 'mp3') {
    args.push('-f', formatId || 'bestaudio');
    args.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
  } else if (formatId && !['bestaudio', 'bestvideo', 'best'].includes(formatId)) {
    args.push('-f', `${formatId}+bestaudio/best`);
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

  const proc = spawn('yt-dlp', args);
  let stderr = '';
  proc.stderr.on('data', d => { stderr += d.toString(); });
  proc.stdout.on('data', d => process.stdout.write(d));

  proc.on('error', () => {
    res.status(500).json({ error: 'yt-dlp not found on this server.' });
  });

  proc.on('close', code => {
    if (code !== 0) {
      console.error('[yt-dlp stderr]', stderr);
      fs.unlink(outFile, () => {});
      return res.status(500).json({ error: 'Download failed. Media may be private or unavailable.' });
    }

    // Find actual output (yt-dlp might change extension)
    let finalFile = outFile;
    if (!fs.existsSync(outFile)) {
      const match = fs.readdirSync(TMP).find(f => f.startsWith(id));
      if (match) finalFile = path.join(TMP, match);
      else return res.status(500).json({ error: 'Output file not found.' });
    }

    const actualExt = path.extname(finalFile).slice(1);
    const stat      = fs.statSync(finalFile);

    res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.${actualExt}"`);
    res.setHeader('Content-Type', getMime(actualExt));
    res.setHeader('Content-Length', stat.size);

    const stream = fs.createReadStream(finalFile);
    stream.pipe(res);
    stream.on('end',   () => fs.unlink(finalFile, () => {}));
    stream.on('error', () => res.status(500).json({ error: 'Stream error.' }));
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/health
// ══════════════════════════════════════════════════════════════════════════════
app.get('/api/health', (req, res) => {
  exec('yt-dlp --version', (e1, v1) => {
    exec('ffmpeg -version', (e2, v2) => {
      res.json({
        status: 'ok',
        ytDlp:  e1 ? 'NOT INSTALLED' : v1.trim(),
        ffmpeg: e2 ? 'NOT INSTALLED' : v2.split('\n')[0],
        node:   process.version,
      });
    });
  });
});

// ── Start ──────────────────────────────────────────────────────────────────────
app.listen(PORT, HOST, () => {
  console.log(`\n🚀 NexLoad running → http://localhost:${PORT}`);
  console.log(`   Health check   → http://localhost:${PORT}/api/health\n`);
});
