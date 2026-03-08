/**
 * NexLoad — Universal Media Downloader Backend
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
const HOST = '0.0.0.0';
const TMP  = path.join(__dirname, 'tmp');

// yt-dlp binary: prefer /app/yt-dlp (Railway), fallback to system PATH
const YTDLP = fs.existsSync(path.join(__dirname, 'yt-dlp'))
  ? path.join(__dirname, 'yt-dlp')
  : 'yt-dlp';

if (!fs.existsSync(TMP)) fs.mkdirSync(TMP, { recursive: true });

app.set('trust proxy', 1);
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/', rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Too many requests.' },
}));

// ── Common yt-dlp flags (bypass bot detection) ─────────────────────────────
const COMMON_FLAGS = [
  '--no-warnings',
  '--no-check-certificate',
  '--no-playlist',
  '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  '--add-header', 'Accept-Language:en-US,en;q=0.9',
  '--extractor-args', 'youtube:player_client=web,default',
];

function isValidUrl(s) {
  try { new URL(s); return s.startsWith('http'); } catch { return false; }
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
  const map = { mp4:'video/mp4', webm:'video/webm', mkv:'video/x-matroska',
    mp3:'audio/mpeg', m4a:'audio/mp4', ogg:'audio/ogg', opus:'audio/opus',
    flac:'audio/flac', jpg:'image/jpeg', png:'image/png' };
  return map[ext] || 'application/octet-stream';
}

function friendlyError(stderr) {
  const s = (stderr || '').toLowerCase();
  if (s.includes('sign in') || s.includes('login') || s.includes('cookies'))
    return 'This content requires login. For Instagram, please use a public post/reel URL.';
  if (s.includes('private'))
    return 'This content is private.';
  if (s.includes('not available') || s.includes('unavailable'))
    return 'This content is unavailable or has been removed.';
  if (s.includes('geo') || s.includes('country'))
    return 'This content is geo-restricted.';
  if (s.includes('rate') || s.includes('429'))
    return 'Rate limited by platform. Please try again in a moment.';
  if (s.includes('unsupported url') || s.includes('no video formats'))
    return 'No downloadable media found at this URL.';
  // Return first meaningful line of stderr for debugging
  const line = (stderr || '').split('\n').find(l => l.trim() && !l.startsWith('WARNING'));
  return line ? `Error: ${line.trim()}` : 'Failed to fetch media. Try another URL.';
}

function ytDlpJson(args) {
  return new Promise((resolve, reject) => {
    console.log('[yt-dlp]', YTDLP, args.join(' '));
    const proc = spawn(YTDLP, args);
    let out = '', err = '';
    proc.stdout.on('data', d => { out += d.toString(); });
    proc.stderr.on('data', d => { err += d.toString(); });
    proc.on('error', e => reject(new Error('yt-dlp binary not found: ' + e.message)));
    proc.on('close', code => {
      console.log('[yt-dlp exit]', code, err.slice(0, 300));
      if (code !== 0) return reject(Object.assign(new Error(friendlyError(err)), { stderr: err }));
      try { resolve(JSON.parse(out)); }
      catch { reject(new Error('Failed to parse yt-dlp output')); }
    });
  });
}

// ── Cleanup tmp every 10 min ───────────────────────────────────────────────
setInterval(() => {
  fs.readdir(TMP, (_, files) => {
    if (!files) return;
    const now = Date.now();
    files.forEach(f => {
      const fp = path.join(TMP, f);
      fs.stat(fp, (e, s) => { if (!e && now - s.mtimeMs > 1800000) fs.unlink(fp, () => {}); });
    });
  });
}, 600000);

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/health
// ══════════════════════════════════════════════════════════════════════════════
app.get('/api/health', (req, res) => {
  exec(`${YTDLP} --version`, (e1, v1) => {
    exec('ffmpeg -version', (e2, v2) => {
      res.json({
        status:   'ok',
        ytDlp:    e1 ? 'NOT INSTALLED — ' + e1.message : v1.trim(),
        ytDlpPath: YTDLP,
        ffmpeg:   e2 ? 'NOT INSTALLED' : v2.split('\n')[0],
        node:     process.version,
        tmpDir:   TMP,
      });
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/test?url=... — quick debug endpoint
// ══════════════════════════════════════════════════════════════════════════════
app.get('/api/test', (req, res) => {
  const url = req.query.url || 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
  const proc = spawn(YTDLP, ['--get-title', '--no-warnings', url]);
  let out = '', err = '';
  proc.stdout.on('data', d => { out += d.toString(); });
  proc.stderr.on('data', d => { err += d.toString(); });
  proc.on('error', e => res.json({ ok: false, error: e.message }));
  proc.on('close', code => res.json({ ok: code === 0, title: out.trim(), error: err.trim(), ytdlpPath: YTDLP }));
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/info
// ══════════════════════════════════════════════════════════════════════════════
app.post('/api/info', async (req, res) => {
  const { url } = req.body;
  if (!url || !isValidUrl(url)) return res.status(400).json({ error: 'Invalid URL.' });

  const platform = detectPlatform(url);

  // Instagram warning — needs cookies
  if (platform === 'instagram') {
    // Still try, but note it may fail
    console.log('[info] Instagram URL — may require cookies');
  }

  try {
    const info = await ytDlpJson([
      '--dump-single-json',
      ...COMMON_FLAGS,
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
              label: f.height >= 2160 ? '4K' : f.height >= 1080 ? '1080p'
                   : f.height >= 720  ? '720p' : f.height >= 480  ? '480p'
                   : f.height >= 360  ? '360p' : `${f.height}p`,
              sub: `${f.height}p${f.fps ? ' · ' + Math.round(f.fps) + 'fps' : ''}`,
              ext: f.ext || 'mp4',
              size: f.filesize ? `~${(f.filesize/1024/1024).toFixed(0)}MB` : 'N/A',
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
              size: f.filesize ? `~${(f.filesize/1024/1024).toFixed(0)}MB` : 'N/A',
              abr,
            });
          }
        });
    }

    if (!audioFormats.find(a => a.ext === 'mp3')) {
      audioFormats.unshift({ formatId:'bestaudio', label:'MP3', sub:'320kbps', ext:'mp3', size:'N/A', abr:320, convertToMp3:true });
    }

    // Detect image post (no video, no audio — just a photo)
    const isImagePost = videoFormats.length === 0 && audioFormats.filter(a => !a.convertToMp3).length === 0;
    const imageFormats = [];
    if (isImagePost || (info.ext && ['jpg','jpeg','png','webp'].includes(info.ext))) {
      imageFormats.push({ formatId: 'best', label: 'JPG', sub: 'Original', ext: info.ext || 'jpg', size: info.filesize ? '~' + (info.filesize/1024/1024).toFixed(1) + 'MB' : 'N/A', isImage: true });
    }
    // Also check if any format is image type
    if (info.formats) {
      info.formats.filter(f => f.ext && ['jpg','jpeg','png','webp'].includes(f.ext)).forEach(f => {
        if (!imageFormats.length) imageFormats.push({ formatId: f.format_id, label: (f.ext || 'jpg').toUpperCase(), sub: 'Original Quality', ext: f.ext || 'jpg', size: f.filesize ? '~' + (f.filesize/1024/1024).toFixed(1) + 'MB' : 'N/A', isImage: true });
      });
    }

    res.json({
      title:        info.title || 'Unknown Title',
      duration:     info.duration,
      thumb:        info.thumbnail,
      uploader:     info.uploader || info.channel || '',
      platform,
      isImagePost:  imageFormats.length > 0 && videoFormats.length === 0,
      videoFormats: imageFormats.length > 0 && videoFormats.length === 0 ? imageFormats : videoFormats.slice(0, 6),
      audioFormats: imageFormats.length > 0 && videoFormats.length === 0 ? [] : audioFormats.slice(0, 5),
    });

  } catch (err) {
    console.error('[/api/info error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/download
// ══════════════════════════════════════════════════════════════════════════════
app.post('/api/download', async (req, res) => {
  const { url, formatId, ext, convertToMp3, isImage, title } = req.body;
  if (!url || !isValidUrl(url)) return res.status(400).json({ error: 'Invalid URL.' });

  const id        = uuidv4();
  const safeTitle = sanitize(title || 'media').replace(/\s+/g, '_').slice(0, 60) || 'media';
  const outExt    = convertToMp3 ? 'mp3' : (ext || 'mp4');
  const outFile   = path.join(TMP, `${id}.${outExt}`);

  const args = [...COMMON_FLAGS];

  if (isImage) {
    // Image post — just download best image format
    args.push('-f', formatId || 'best');
  } else if (convertToMp3 || ext === 'mp3') {
    args.push('-f', formatId || 'bestaudio', '-x', '--audio-format', 'mp3', '--audio-quality', '0');
  } else if (formatId && !['bestaudio','bestvideo','best'].includes(formatId)) {
    args.push('-f', `${formatId}+bestaudio/best`, '--merge-output-format', 'mp4');
  } else {
    args.push('-f', 'bestvideo+bestaudio/best', '--merge-output-format', 'mp4');
  }

  args.push('-o', outFile, url);
  console.log('[download] yt-dlp', args.join(' '));

  const proc = spawn(YTDLP, args);
  let stderr = '';
  proc.stderr.on('data', d => { stderr += d.toString(); });
  proc.stdout.on('data', d => process.stdout.write(d));
  proc.on('error', () => res.status(500).json({ error: 'yt-dlp not found.' }));
  proc.on('close', code => {
    if (code !== 0) {
      console.error('[download fail]', stderr);
      fs.unlink(outFile, () => {});
      return res.status(500).json({ error: friendlyError(stderr) });
    }

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

app.listen(PORT, HOST, () => {
  console.log(`\n🚀 NexLoad running → http://localhost:${PORT}`);
  console.log(`   yt-dlp path     → ${YTDLP}`);
  console.log(`   Health check    → http://localhost:${PORT}/api/health\n`);
});
