const { cmd } = require('../arslan');
const axios = require('axios');
const https = require('https');

const DELINE_BASE = 'https://api.deline.web.id';
const DL_TIMEOUT = 60000;

// Helper: Check if URL is Google Drive
function isGdriveUrl(str) {
    return /drive\.google\.com\/(file\/d\/|open\?id=|uc\?)/i.test(str);
}

// Helper: Parse size string to bytes
function parseSizeBytes(str) {
    if (!str) return 0;
    const m = str.match(/([\d.]+)\s*(KB|MB|GB)/i);
    if (!m) return 0;
    const n = parseFloat(m[1]);
    const u = m[2].toUpperCase();
    if (u === 'GB') return n * 1024 * 1024 * 1024;
    if (u === 'MB') return n * 1024 * 1024;
    if (u === 'KB') return n * 1024;
    return 0;
}

// Resolve Google Drive URL
async function resolveGdrive(driveUrl) {
    const { data } = await axios.get(`${DELINE_BASE}/downloader/gdrive`, {
        params: { url: driveUrl },
        timeout: 30000,
    });
    if (!data?.status || !data?.result?.downloadUrl) {
        throw new Error(data?.message || 'Failed to resolve Google Drive link');
    }
    return data.result;
}

// Download file to buffer
async function downloadBuffer(url) {
    const res = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: DL_TIMEOUT,
        maxContentLength: 100 * 1024 * 1024,
        httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    });
    return { buffer: Buffer.from(res.data), contentType: res.headers['content-type'] || '' };
}

cmd({
    pattern: "gdrive",
    alias: ["gd", "gdl", "googledrive", "drivdl"],
    react: "☁️",
    desc: "Download any Google Drive file and send it here",
    category: "downloader",
    use: ".gdrive <Google Drive URL>",
    filename: __filename
}, async (conn, mek, m, { from, q, reply }) => {
    try {
        // Get URL from args or quoted message
        let url = q || m.quoted?.text || '';

        if (!url) {
            return reply(
                `╔═══════════════════════════════════╗
║     ☁️ *GOOGLE DRIVE DOWNLOADER* ☁️  ║
╠═══════════════════════════════════╣
║                                   ║
║  ✦ *Command Usage:*              ║
║  ✦ .gdrive <Google Drive URL>    ║
║                                   ║
║  ✦ *Supported Formats:*          ║
║  ✦ drive.google.com/file/d/...   ║
║  ✦ drive.google.com/open?id=...  ║
║  ✦ drive.google.com/uc?id=...    ║
║                                   ║
║  ✦ *Features:*                   ║
║  ✦ ☁️ Direct download            ║
║  ✦ 📁 File info display          ║
║  ✦ ⚡ Fast processing             ║
║  ✦ 📊 Size limit ~90 MB          ║
║                                   ║
╚═══════════════════════════════════╝`
            );
        }

        // Validate URL
        if (!isGdriveUrl(url)) {
            return reply(
                `╔═══════════════════════════════════╗
║     ❌ *INVALID URL* ❌         ║
╠═══════════════════════════════════╣
║                                   ║
║  ✦ *Error* : Not a Google Drive link ║
║  ✦ *Status* : ❌ *Invalid*       ║
║                                   ║
║  ═══════════════════════════════  ║
║  💡 *Make sure URL starts with:* ║
║  ✦ drive.google.com/file/d/...   ║
║  ✦ drive.google.com/open?id=...  ║
║  ✦ drive.google.com/uc?id=...    ║
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
║     🔍 *RESOLVING DRIVE LINK* 🔍   ║
╠═══════════════════════════════════╣
║                                   ║
║  ✦ *URL* : ${url.substring(0, 40)}${url.length > 40 ? "..." : ""}
║  ✦ *Status* : ⏳ *Processing*      ║
║  ✦ *Mode*   : ☁️ *Google Drive*    ║
║                                   ║
╚═══════════════════════════════════╝`
        );

        // Resolve Drive link
        let meta;
        try {
            meta = await resolveGdrive(url);
        } catch (e) {
            await conn.sendMessage(from, {
                react: { text: "❌", key: m.key }
            });
            return reply(
                `╔═══════════════════════════════════╗
║     ❌ *RESOLVE FAILED* ❌      ║
╠═══════════════════════════════════╣
║                                   ║
║  ✦ *Error* : ${e.message}          ║
║  ✦ *Status* : ❌ *Failed*       ║
║                                   ║
║  ═══════════════════════════════  ║
║  💡 *Make sure:*                  ║
║  ✦ File is public/accessible     ║
║  ✦ URL is correct                ║
║  ✦ File hasn't been deleted      ║
║  ✦ Anyone with link can view     ║
║                                   ║
╚═══════════════════════════════════╝`
            );
        }

        const { downloadUrl, fileName, fileSize, mimetype } = meta;

        // Check file size limit
        const sizeBytes = parseSizeBytes(fileSize);
        if (sizeBytes > 90 * 1024 * 1024) {
            return reply(
                `╔═══════════════════════════════════╗
║     ⚠️ *FILE TOO LARGE* ⚠️     ║
╠═══════════════════════════════════╣
║                                   ║
║  ✦ *Name* : ${fileName}             ║
║  ✦ *Size* : ${fileSize}             ║
║  ✦ *Limit* : ~90 MB               ║
║                                   ║
║  ═══════════════════════════════  ║
║  📥 *Direct Download Link:*       ║
║  ${downloadUrl}                     ║
║                                   ║
╚═══════════════════════════════════╝`
            );
        }

        // Download file
        await reply(
            `╔═══════════════════════════════════╗
║     ⬇️ *DOWNLOADING FILE* ⬇️    ║
╠═══════════════════════════════════╣
║                                   ║
║  ✦ *Name* : ${fileName}             ║
║  ✦ *Size* : ${fileSize}             ║
║  ✦ *Status* : 📥 *Downloading*    ║
║                                   ║
╚═══════════════════════════════════╝`
        );

        let buffer, contentType;
        try {
            ({ buffer, contentType } = await downloadBuffer(downloadUrl));
        } catch (e) {
            return reply(
                `╔═══════════════════════════════════╗
║     ⚠️ *DOWNLOAD FAILED* ⚠️    ║
╠═══════════════════════════════════╣
║                                   ║
║  ✦ *Name* : ${fileName}             ║
║  ✦ *Size* : ${fileSize}             ║
║  ✦ *Error* : ${e.message}          ║
║                                   ║
║  ═══════════════════════════════  ║
║  📥 *Direct Download Link:*       ║
║  ${downloadUrl}                     ║
║                                   ║
╚═══════════════════════════════════╝`
            );
        }

        // Send file
        const caption = 
            `╔═══════════════════════════════════╗
║     ☁️ *GOOGLE DRIVE FILE* ☁️    ║
╠═══════════════════════════════════╣
║                                   ║
║  ✦ *Name* : ${fileName}             ║
║  ✦ *Size* : ${fileSize}             ║
║  ✦ *Type* : ${mimetype || contentType || 'unknown'}
║  ✦ *Status* : ✅ *Sent*          ║
║                                   ║
║  ═══════════════════════════════  ║
║  ✦ *Powered By* : ARSLAN-MD      ║
║  ✦ *Service* : Google Drive      ║
║                                   ║
╚═══════════════════════════════════╝`;

        try {
            await conn.sendMessage(from, {
                document: buffer,
                fileName: fileName || 'gdrive_file',
                mimetype: mimetype || contentType || 'application/octet-stream',
                caption: caption
            }, { quoted: mek });

            await conn.sendMessage(from, {
                react: { text: "✅", key: m.key }
            });

        } catch (e) {
            return reply(
                `╔═══════════════════════════════════╗
║     ⚠️ *SEND FAILED* ⚠️       ║
╠═══════════════════════════════════╣
║                                   ║
║  ✦ *Error* : ${e.message}          ║
║                                   ║
║  ═══════════════════════════════  ║
║  📥 *Direct Download Link:*       ║
║  ${downloadUrl}                     ║
║                                   ║
╚═══════════════════════════════════╝`
            );
        }

    } catch (e) {
        console.error("GDRIVE ERROR:", e);
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
║  ✦ Verify file is accessible     ║
║  ✦ Make sure file is public      ║
║                                   ║
╚═══════════════════════════════════╝`
        );
    }
});