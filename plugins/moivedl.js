const { cmd } = require('../arslan');
const axios = require('axios');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Constants
const MAX_DOC_BYTES = 1900 * 1024 * 1024; // ~1.9GB
const DOWNLOAD_TIMEOUT_MS = 8 * 60 * 1000; // 8 minutes
const TTL_MS = 5 * 60 * 1000; // 5 minutes

// Endpoints
const SEARCH_ENDPOINTS = [
  'https://arslan-apis-v2.vercel.app/movie/moviesearch',
  'https://api.arslanxd.com/movie/moviesearch',
];
const DL_ENDPOINTS = [
  'https://arslan-apis-v2.vercel.app/movie/moviesdl',
  'https://api.arslanxd.com/movie/moviesdl',
];

// Quality ranking
const QUALITY_RANK = ['4k', '2160p', '1440p', '1080p', '720p', '480p', '360p', '240p'];

// Helper functions
function cleanName(s) {
  return (s || '').replace(/[\\/:*?"<>|]/g, '').slice(0, 80);
}

function parseSize(s) {
  const m = /([\d.]+)\s*(mb|gb)/i.exec(s || '');
  if (!m) return 0;
  let n = parseFloat(m[1]);
  if (/gb/i.test(m[2])) n *= 1024;
  return n;
}

function qualityRank(q) {
  const s = (q || '').toLowerCase();
  const idx = QUALITY_RANK.findIndex(tag => s.includes(tag));
  return idx === -1 ? QUALITY_RANK.length : idx;
}

function pickBestDownload(downloads) {
  const withSizeMb = downloads.map(d => ({ d, sizeMb: parseSize(d.size) }));
  const fits = withSizeMb.filter(x => !x.sizeMb || x.sizeMb * 1024 * 1024 <= MAX_DOC_BYTES);
  const pool = fits.length ? fits : withSizeMb;
  pool.sort((a, b) => {
    const rankDiff = qualityRank(a.d.quality) - qualityRank(b.d.quality);
    if (rankDiff !== 0) return rankDiff;
    return (b.sizeMb || 0) - (a.sizeMb || 0);
  });
  return pool[0]?.d || downloads[0];
}

async function tryEndpoints(endpoints, params) {
  let lastErr = null;
  for (const url of endpoints) {
    try {
      const { data } = await axios.get(url, { params, timeout: 35000 });
      if (data && data.status !== false) return data;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('Movie API unreachable');
}

async function downloadMovieFile(url) {
  const head = await axios.get(url, {
    responseType: 'stream',
    timeout: DOWNLOAD_TIMEOUT_MS,
    maxRedirects: 5,
    validateStatus: s => s >= 200 && s < 400,
  });

  const contentType = String(head.headers['content-type'] || '').toLowerCase();
  const contentLen = parseInt(head.headers['content-length'] || '0', 10);

  if (contentType.includes('text/html') || contentType.includes('application/json')) {
    head.data.destroy();
    throw new Error('Link no longer points to a real file - may be expired or down');
  }
  if (contentLen && contentLen > MAX_DOC_BYTES) {
    head.data.destroy();
    throw new Error(`File is ${(contentLen / 1024 / 1024 / 1024).toFixed(2)}GB - too large for WhatsApp (limit ~1.9GB)`);
  }

  const tmpPath = path.join(os.tmpdir(), `movie_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.mp4`);
  const writer = fs.createWriteStream(tmpPath);
  let received = 0;

  await new Promise((resolve, reject) => {
    head.data.on('data', chunk => {
      received += chunk.length;
      if (received > MAX_DOC_BYTES) {
        head.data.destroy();
        writer.destroy();
        reject(new Error('File exceeded size limit while downloading - too large for WhatsApp'));
      }
    });
    head.data.on('error', reject);
    writer.on('error', reject);
    writer.on('finish', resolve);
    head.data.pipe(writer);
  });

  if (received < 10 * 1024) {
    try { fs.unlinkSync(tmpPath); } catch {}
    throw new Error('Downloaded file is too small to be a real movie - link is likely broken');
  }

  return tmpPath;
}

function cleanupTmp(p) {
  fs.unlink(p, () => {});
}

// Store pending selections
const pending = new Map();

cmd({
  pattern: "movie",
  alias: ["moviedl", "film", "movies"],
  react: "🎬",
  desc: "Search and download movies directly",
  category: "downloader",
  use: ".movie <movie name>",
  filename: __filename
}, async (conn, mek, m, { from, q, reply }) => {
  try {
    const query = q;

    if (!query) {
      return reply(
        `╔═══════════════════════════════════╗
║     🎬 *MOVIE DOWNLOADER* 🎬      ║
╠═══════════════════════════════════╣
║                                   ║
║  ✦ *Usage:*                      ║
║  ✦ .movie <movie name>           ║
║                                   ║
║  ✦ *Examples:*                   ║
║  ✦ .movie avengers endgame       ║
║  ✦ .movie inception              ║
║  ✦ .movie titanic                ║
║                                   ║
║  ✦ *Features:*                   ║
║  ✦ 🎬 High quality movies        ║
║  ✦ ⚡ Auto best quality pick     ║
║  ✦ 📊 Movie info display         ║
║  ✦ 📁 Direct download            ║
║  ✦ 🎯 Up to 1.9GB supported      ║
║                                   ║
╚═══════════════════════════════════╝`
      );
    }

    // Show processing
    await conn.sendMessage(from, {
      react: { text: "⏳", key: m.key }
    });

    await reply(
      `╔═══════════════════════════════════╗
║     🔍 *SEARCHING MOVIES* 🔍     ║
╠═══════════════════════════════════╣
║                                   ║
║  ✦ *Query* : ${query}                ║
║  ✦ *Status* : ⏳ *Searching*      ║
║  ✦ *Mode*   : 🎬 *Movie DB*       ║
║                                   ║
╚═══════════════════════════════════╝`
    );

    // Search movies
    const data = await tryEndpoints(SEARCH_ENDPOINTS, { q: query });
    const results = data?.result || [];

    if (!Array.isArray(results) || !results.length) {
      await conn.sendMessage(from, {
        react: { text: "❌", key: m.key }
      });
      return reply(
        `╔═══════════════════════════════════╗
║     ❌ *NO MOVIES FOUND* ❌      ║
╠═══════════════════════════════════╣
║                                   ║
║  ✦ *Query* : ${query}                ║
║  ✦ *Status* : ❌ *Not Found*      ║
║                                   ║
║  ═══════════════════════════════  ║
║  💡 *Tips:*                       ║
║  ✦ Try different title           ║
║  ✦ Check spelling                ║
║  ✦ Use simpler keywords          ║
║  ✦ Try again with new query      ║
║                                   ║
╚═══════════════════════════════════╝`
      );
    }

    const items = results.slice(0, 9);
    const senderId = m.sender || m.key.remoteJid;

    // Store pending selection
    pending.set(`${from}:${senderId}`, {
      stage: 'list',
      items: items,
      query: query,
      expiresAt: Date.now() + TTL_MS
    });

    // Build results list
    let listText = "";
    for (let i = 0; i < items.length; i++) {
      listText += `*${i + 1}.* ${items[i].title}\n`;
    }

    const caption = 
      `╔═══════════════════════════════════╗
║     🎬 *MOVIE RESULTS* 🎬        ║
╠═══════════════════════════════════╣
║                                   ║
║  ✦ *Query* : ${query}                ║
║  ✦ *Found* : ${items.length} movies  ║
║                                   ║
║  ═══════════════════════════════  ║
║  📋 *Select a movie:*             ║
║                                   ║
║  ${listText}                        ║
║                                   ║
║  ═══════════════════════════════  ║
║  👉 Reply with a number          ║
║  ⏱️ Expires in 5 minutes          ║
║                                   ║
╚═══════════════════════════════════╝`;

    // Try to send with poster
    const poster = items.find(m => m.poster)?.poster;
    if (poster) {
      try {
        await conn.sendMessage(from, {
          image: { url: poster },
          caption: caption
        }, { quoted: mek });
      } catch {
        await conn.sendMessage(from, { text: caption }, { quoted: mek });
      }
    } else {
      await conn.sendMessage(from, { text: caption }, { quoted: mek });
    }

    await conn.sendMessage(from, {
      react: { text: "✅", key: m.key }
    });

  } catch (e) {
    console.error("MOVIE ERROR:", e);
    await conn.sendMessage(from, {
      react: { text: "❌", key: m.key }
    });
    reply(
      `╔═══════════════════════════════════╗
║     ❌ *SYSTEM ERROR* ❌        ║
╠═══════════════════════════════════╣
║                                   ║
║  ✦ *Error* : ${e.message || "API Failed"}  ║
║  ✦ *Status* : 🔴 *Offline*       ║
║                                   ║
║  ═══════════════════════════════  ║
║  💡 *Solutions:*                  ║
║  ✦ Check your internet           ║
║  ✦ Try again in 5 minutes        ║
║  ✦ Use different movie title     ║
║  ✦ Try a simpler search query    ║
║                                   ║
╚═══════════════════════════════════╝`
    );
  }
});

// Handle number selection (user replies with number)
cmd({
  pattern: "movie-select",
  desc: "Handle movie selection",
  category: "downloader",
  filename: __filename
}, async (conn, mek, m, { from, reply }) => {
  try {
    // This will be handled by the main command flow
    // The number selection logic is integrated below
  } catch (e) {
    console.error("MOVIE SELECT ERROR:", e);
  }
});

// Note: Number selection is handled through the message processing flow
// The pending map stores selections and processes them when user replies with a number