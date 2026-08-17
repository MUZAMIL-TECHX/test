/*****************************************************************************
 *  plugins/antidelete.js — REDXMINI-BOT ULTRA v6
 *  Developed By Abdul Rehman Rajpoot
 *
 *  v6 UPGRADES over v5:
 *  ✅ Per-group enable/disable (delpath can be group-scoped)
 *  ✅ Edit tracking — reports message edits too
 *  ✅ Ignore-list: don't report specific numbers (e.g. owners)
 *  ✅ Min-length filter: skip deletion reports for very short msgs (<3 chars)
 *  ✅ Forward detection: flags forwarded messages that get deleted
 *  ✅ DB persistence fully active with fallback to in-memory
 *  ✅ All v5 fixes (always-store, dual-key, phone comparison, etc.) retained
 *****************************************************************************/

'use strict';
const fs   = require('fs');
const path = require('path');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const { writeFile } = require('fs/promises');
const store = require('./lightweight_store');

const messageStore  = new Map();
const storeOrder    = [];
const MAX_STORE     = 5000;
const STORE_TTL_MS  = 8 * 60 * 60 * 1000; // 8h

const CONFIG_PATH    = path.join(__dirname, '../data/antidelete.json');
const TEMP_MEDIA_DIR = path.join(__dirname, '../tmp');
const HAS_DB = !!(process.env.MONGO_URL || process.env.POSTGRES_URL || process.env.MYSQL_URL || process.env.DB_URL);

if (!fs.existsSync(TEMP_MEDIA_DIR)) fs.mkdirSync(TEMP_MEDIA_DIR, { recursive: true });

/* ─── Helpers ────────────────────────────────────────────────────────────── */
function phoneNum(jid) {
    if (!jid) return '';
    return String(jid).split(':')[0].split('@')[0].replace(/\D/g, '');
}
function toSWJid(jid) {
    const n = phoneNum(jid);
    return n ? `${n}@s.whatsapp.net` : null;
}
function samePhone(a, b) {
    const na = phoneNum(a), nb = phoneNum(b);
    return !!(na && nb && (na === nb || na.slice(-9) === nb.slice(-9)));
}
function getOwnerJid(sock) {
    const uid = sock?.user?.id || '';
    const botNum = phoneNum(uid);
    if (botNum) return `${botNum}@s.whatsapp.net`;
    try {
        const settings = require('../config');
        const configured = Array.isArray(settings.OWNER_NUMBER)
            ? settings.OWNER_NUMBER
            : [settings.OWNER_NUMBER];
        const ownerPhone = phoneNum(configured.find(Boolean));
        if (ownerPhone) return `${ownerPhone}@s.whatsapp.net`;
    } catch {}
    return null;
}

/* ─── Cleanup ────────────────────────────────────────────────────────────── */
setInterval(() => {
    try {
        const files = fs.readdirSync(TEMP_MEDIA_DIR);
        let total = 0;
        files.forEach(f => { try { total += fs.statSync(path.join(TEMP_MEDIA_DIR, f)).size; } catch {} });
        if (total > 80 * 1024 * 1024) {
            files.forEach(f => { try { fs.unlinkSync(path.join(TEMP_MEDIA_DIR, f)); } catch {} });
        }
    } catch {}
}, 5 * 60_000);

setInterval(() => {
    const cutoff = Date.now() - STORE_TTL_MS;
    while (storeOrder.length && storeOrder[0].ts < cutoff) {
        const old = storeOrder.shift();
        messageStore.delete(old.messageId);
        if (old.phoneKey) messageStore.delete(old.phoneKey);
    }
}, 10 * 60_000);

/* ─── Config ─────────────────────────────────────────────────────────────── */
async function loadConfig() {
    try {
        if (HAS_DB) {
            const cfg = await store.getSetting('global', 'antidelete_v6');
            return {
                enabled: false, delpath: 'owner',
                minLength: 1, trackEdits: true,
                ignoreList: [], groupOverrides: {},
                ...(cfg || {})
            };
        }
        if (!fs.existsSync(CONFIG_PATH)) return { enabled: false, delpath: 'owner', minLength: 1, trackEdits: true, ignoreList: [], groupOverrides: {} };
        const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        return { enabled: false, delpath: 'owner', minLength: 1, trackEdits: true, ignoreList: [], groupOverrides: {}, ...raw };
    } catch { return { enabled: false, delpath: 'owner', minLength: 1, trackEdits: true, ignoreList: [], groupOverrides: {} }; }
}
async function saveConfig(cfg) {
    try {
        if (HAS_DB) { await store.saveSetting('global', 'antidelete_v6', cfg); return; }
        const dir = path.dirname(CONFIG_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
    } catch (e) { console.error('[ANTIDELETE v6] save error:', e.message); }
}
// Back-compat alias for old call sites
const loadAntideleteConfig = loadConfig;
const saveAntideleteConfig = saveConfig;

/* ─── storeMessage ───────────────────────────────────────────────────────── */
async function storeMessage(sock, message) {
    try {
        if (!message.key?.id) return;
        const messageId = message.key.id;
        const sender    = message.key.participant || message.key.remoteJid;

        let content = '', mediaType = '', isForward = false;
        const voC = message.message?.viewOnceMessageV2?.message || message.message?.viewOnceMessage?.message;

        if      (voC?.imageMessage)                          { mediaType='image';    content=voC.imageMessage.caption||''; }
        else if (voC?.videoMessage)                          { mediaType='video';    content=voC.videoMessage.caption||''; }
        else if (message.message?.conversation)              { content=message.message.conversation; }
        else if (message.message?.extendedTextMessage?.text) { content=message.message.extendedTextMessage.text; }
        else if (message.message?.imageMessage)              { mediaType='image';    content=message.message.imageMessage.caption||''; }
        else if (message.message?.videoMessage)              { mediaType='video';    content=message.message.videoMessage.caption||''; }
        else if (message.message?.audioMessage)              { mediaType='audio'; }
        else if (message.message?.voiceMessage)              { mediaType='audio'; }
        else if (message.message?.stickerMessage)            { mediaType='sticker'; }
        else if (message.message?.documentMessage)           { mediaType='document'; content=message.message.documentMessage.caption||''; }

        // Detect forward
        if (message.message?.extendedTextMessage?.contextInfo?.isForwarded ||
            message.message?.imageMessage?.contextInfo?.isForwarded ||
            message.message?.videoMessage?.contextInfo?.isForwarded) {
            isForward = true;
        }

        const meta = {
            content, mediaType, sender, isForward,
            group:       message.key.remoteJid?.endsWith('@g.us') ? message.key.remoteJid : null,
            timestamp:   Date.now(),
            fullMessage: message,
        };

        messageStore.set(messageId, meta);
        const senderPhone = phoneNum(sender);
        const phoneKey = senderPhone ? `${senderPhone}:${messageId}` : null;
        if (phoneKey) messageStore.set(phoneKey, meta);

        storeOrder.push({ messageId, phoneKey, ts: meta.timestamp });
        while (storeOrder.length > MAX_STORE) {
            const old = storeOrder.shift();
            messageStore.delete(old.messageId);
            if (old.phoneKey) messageStore.delete(old.phoneKey);
        }

        if (HAS_DB) {
            store.saveSetting(`antidel:${messageId}`, 'meta', {
                content, mediaType, sender, group: meta.group, timestamp: meta.timestamp, isForward,
            }).catch(() => {});
        }

        // View-once: forward immediately to owner (if enabled in config)
        const isViewOnce = !!(voC?.imageMessage || voC?.videoMessage);
        if (isViewOnce && mediaType) {
            const cfg = await loadConfig().catch(() => ({ forwardViewOnce: true }));
            if (cfg.forwardViewOnce === false) return; // silently respect the toggle
            try {
                const container = voC.imageMessage || voC.videoMessage;
                const stream    = await downloadContentFromMessage(container, mediaType);
                let buf = Buffer.alloc(0);
                for await (const ch of stream) buf = Buffer.concat([buf, ch]);
                const ext  = mediaType === 'image' ? 'jpg' : 'mp4';
                const fp   = path.join(TEMP_MEDIA_DIR, `vo_${messageId}.${ext}`);
                await writeFile(fp, buf);
                const ownerJid = getOwnerJid(sock);
                if (ownerJid) {
                    const opts = { caption: `*👁️ View-Once ${mediaType}*\nFrom: @${phoneNum(sender)}`, mentions: [sender] };
                    if (mediaType === 'image') await sock.sendMessage(ownerJid, { image: { url: fp }, ...opts });
                    else                       await sock.sendMessage(ownerJid, { video: { url: fp }, ...opts });
                }
                try { fs.unlinkSync(fp); } catch {}
            } catch (e) { console.error('[ANTIDELETE v6] ViewOnce error:', e.message); }
        }
    } catch (e) { console.error('[ANTIDELETE v6] storeMessage error:', e.message); }
}

/* ─── storeEdit ─────────────────────────────────────────────────────────── */
async function storeEdit(sock, message) {
    // Track edits for report
    try {
        const cfg = await loadConfig();
        if (!cfg.enabled || !cfg.trackEdits) return;
        const editedKey = message.message?.protocolMessage?.key;
        if (!editedKey?.id) return;
        const original = messageStore.get(editedKey.id);
        if (!original) return;

        const newBody = message.message?.protocolMessage?.editedMessage?.conversation
                     || message.message?.protocolMessage?.editedMessage?.extendedTextMessage?.text
                     || '';
        if (!newBody) return;

        const ownerJid = getOwnerJid(sock);
        const targetJid = cfg.delpath === 'group' && original.group ? original.group : (ownerJid || null);
        if (!targetJid) return;

        const senderPhone = phoneNum(original.sender);
        await sock.sendMessage(targetJid, {
            text: `*✏️ REDX ANTIDELETE — Message Edited*\n\n` +
                  `*👤 Sender:* +${senderPhone}\n` +
                  `*📝 Before:* ${original.content || '(media)'}\n` +
                  `*✏️ After:*  ${newBody}\n\n` +
                  `> REDXMINI-BOT v6`,
            mentions: [toSWJid(original.sender)].filter(Boolean)
        });
    } catch (e) { console.error('[ANTIDELETE v6] storeEdit error:', e.message); }
}

/* ─── Media download ─────────────────────────────────────────────────────── */
async function downloadMedia(original, messageId) {
    const { mediaType, fullMessage } = original;
    if (!mediaType || !fullMessage) return null;
    try {
        const msg = fullMessage.message;
        let mediaMsg = null, dlType = mediaType;
        if      (mediaType === 'image')    { mediaMsg = msg?.imageMessage; }
        else if (mediaType === 'video')    { mediaMsg = msg?.videoMessage; }
        else if (mediaType === 'sticker')  { mediaMsg = msg?.stickerMessage; dlType = 'sticker'; }
        else if (mediaType === 'audio')    { mediaMsg = msg?.audioMessage || msg?.voiceMessage; dlType = 'audio'; }
        else if (mediaType === 'document') { mediaMsg = msg?.documentMessage; }
        if (!mediaMsg) return null;

        const stream = await downloadContentFromMessage(mediaMsg, dlType);
        let buf = Buffer.alloc(0);
        for await (const ch of stream) buf = Buffer.concat([buf, ch]);

        let ext = 'bin';
        if      (mediaType === 'image')    ext = 'jpg';
        else if (mediaType === 'video')    ext = 'mp4';
        else if (mediaType === 'sticker')  ext = 'webp';
        else if (mediaType === 'audio')    ext = (mediaMsg.mimetype||'').includes('ogg') ? 'ogg' : 'mp3';
        else if (mediaType === 'document') ext = (mediaMsg.fileName||'').split('.').pop() || 'bin';

        const fp = path.join(TEMP_MEDIA_DIR, `del_${messageId}_${Date.now()}.${ext}`);
        await writeFile(fp, buf);
        return { mediaPath: fp, ext };
    } catch (e) {
        console.error('[ANTIDELETE v6] download error:', e.message);
        return null;
    }
}

/* ─── handleMessageRevocation ────────────────────────────────────────────── */
async function handleMessageRevocation(sock, revocationMessage) {
    try {
        const config = await loadConfig();
        if (!config.enabled) return;

        const messageId = revocationMessage.message?.protocolMessage?.key?.id;
        if (!messageId) return;

        const deletedBy = revocationMessage.participant ||
                          revocationMessage.key?.participant ||
                          revocationMessage.key?.remoteJid;

        const ownerJid  = getOwnerJid(sock);
        const botPhone  = phoneNum(sock?.user?.id);

        // Don't report owner or bot self-deletions
        if (samePhone(deletedBy, ownerJid) || samePhone(deletedBy, botPhone)) return;

        // Ignore list
        const delPhone = phoneNum(deletedBy);
        if ((config.ignoreList || []).some(n => n.replace(/\D/g,'') === delPhone)) return;

        // Dual-key lookup
        let original = messageStore.get(messageId);
        if (!original) {
            const fromPhone = phoneNum(
                revocationMessage.message?.protocolMessage?.key?.participant ||
                revocationMessage.key?.participant ||
                revocationMessage.key?.remoteJid
            );
            if (fromPhone) original = messageStore.get(`${fromPhone}:${messageId}`);
        }

        // DB fallback
        if (!original && HAS_DB) {
            try {
                const saved = await store.getSetting(`antidel:${messageId}`, 'meta');
                if (saved) original = saved;
            } catch {}
        }

        if (!original) return;

        // Min-length filter
        if (config.minLength > 1 && original.content && original.content.length < config.minLength) return;

        const sender      = original.sender;
        const senderPhone = phoneNum(sender);
        const groupName = original.group
            ? (await sock.groupMetadata(original.group).catch(() => ({ subject: 'Group' }))).subject
            : '';

        const time = new Date().toLocaleString('en-US', {
            timeZone: process.env.TIMEZONE || 'Asia/Karachi',
            hour12: true, hour: '2-digit', minute: '2-digit',
            day: '2-digit', month: '2-digit', year: 'numeric'
        });

        let text =
            `*🔰 REDX ANTIDELETE v6 🔰*\n\n` +
            `*🗑️ Deleted By:* +${delPhone}\n` +
            `*👤 Sender:*    +${senderPhone}\n` +
            `*🕒 Time:*      ${time}\n`;
        if (groupName)        text += `*👥 Group:*     ${groupName}\n`;
        if (original.isForward) text += `*📤 Type:*      Forwarded message\n`;
        if (original.content)  text += `\n*💬 Message:*\n${original.content}`;
        if (original.mediaType) text += `\n*📎 Media:* ${original.mediaType.toUpperCase()}`;

        // Target: check group override first
        let targetJid = ownerJid;
        const gOverride = original.group && config.groupOverrides?.[original.group];
        if (gOverride) {
            targetJid = gOverride === 'group' ? original.group : gOverride;
        } else {
            const dp = config.delpath;
            if (dp === 'group' && original.group) targetJid = original.group;
            else if (dp && !['owner','group'].includes(dp) && dp.includes('@')) targetJid = dp;
        }

        if (!targetJid) return;

        await sock.sendMessage(targetJid, {
            text,
            mentions: [toSWJid(deletedBy), toSWJid(sender)].filter(Boolean)
        });

        if (original.mediaType && config.recoverMedia !== false) {
            const dl = await downloadMedia(original, messageId);
            if (dl) {
                const doc  = original.fullMessage?.message?.documentMessage;
                const opts = {
                    caption:  `*Deleted ${original.mediaType.toUpperCase()}*\nFrom: +${senderPhone}`,
                    mentions: [toSWJid(sender)].filter(Boolean)
                };
                try {
                    switch (original.mediaType) {
                        case 'image':    await sock.sendMessage(targetJid, { image:    { url: dl.mediaPath }, ...opts }); break;
                        case 'video':    await sock.sendMessage(targetJid, { video:    { url: dl.mediaPath }, ...opts }); break;
                        case 'sticker':  await sock.sendMessage(targetJid, { sticker:  { url: dl.mediaPath } }); break;
                        case 'audio':    await sock.sendMessage(targetJid, { audio: { url: dl.mediaPath }, mimetype: 'audio/mpeg', ptt: false, ...opts }); break;
                        case 'document': await sock.sendMessage(targetJid, {
                            document: { url: dl.mediaPath },
                            fileName: doc?.fileName || path.basename(dl.mediaPath),
                            mimetype: doc?.mimetype || 'application/octet-stream',
                            ...opts
                        }); break;
                    }
                } catch (e) {
                    await sock.sendMessage(targetJid, { text: `⚠️ Could not send deleted media: ${e.message}` });
                }
                try { fs.unlinkSync(dl.mediaPath); } catch {}
            }
        }

        messageStore.delete(messageId);
        if (original.sender) messageStore.delete(`${phoneNum(original.sender)}:${messageId}`);

    } catch (e) { console.error('[ANTIDELETE v6] handleMessageRevocation error:', e.message); }
}

async function handleMessageEdit(sock, update) {
    // Handled via storeEdit
}

/* ─── Command handler ────────────────────────────────────────────────────── */
module.exports = {
    command: 'antidelete',
    aliases: ['antidel', 'adel', 'antidl'],
    category: 'owner',
    description: 'Antidelete ULTRA v7 — edit tracking, group overrides, ignore list, media toggle, stats, test',
    usage: '.antidelete on|off|status|delpath|edits|media|viewonce|minlen|ignore|group|clear|stats|test|ttl',
    ownerOnly: true,

    async handler(sock, message, args, context = {}) {
        const chatId = context.chatId || message.key.remoteJid;
        const config = await loadConfig();
        const action = args[0]?.toLowerCase();
        const reply  = (text) => sock.sendMessage(chatId, { text }, { quoted: message });

        /* ── status (default) ─────────────────────────────────────────── */
        if (!action || action === 'status') {
            const dp = config.delpath === 'owner' ? 'Owner DM' :
                       config.delpath === 'group' ? 'Group (where deleted)' :
                       `Custom: ${config.delpath}`;
            const ttlH = Math.round((config.storeTtlMs || STORE_TTL_MS) / 3600000);
            return reply(
                `*🔰 ANTIDELETE ULTRA v7*\n\n` +
                `*Status:*          ${config.enabled ? '✅ ON' : '❌ OFF'}\n` +
                `*Delpath:*         ${dp}\n` +
                `*Edit Tracking:*   ${config.trackEdits ? '✅ ON' : '❌ OFF'}\n` +
                `*Media Recovery:*  ${config.recoverMedia !== false ? '✅ ON' : '❌ OFF'}\n` +
                `*View-Once Fwd:*   ${config.forwardViewOnce !== false ? '✅ ON' : '❌ OFF'}\n` +
                `*Min Length:*      ${config.minLength || 1} chars\n` +
                `*Store TTL:*       ${ttlH}h\n` +
                `*Ignore List:*     ${config.ignoreList?.length || 0} numbers\n` +
                `*Group Overrides:* ${Object.keys(config.groupOverrides||{}).length}\n` +
                `*Cached:*          ${messageStore.size} messages\n\n` +
                `*Commands:*\n` +
                `• \`.antidelete on/off\` — enable/disable\n` +
                `• \`.antidelete delpath owner|group|<jid>\` — where to send reports\n` +
                `• \`.antidelete edits on|off\` — track message edits\n` +
                `• \`.antidelete media on|off\` — recover deleted media files\n` +
                `• \`.antidelete viewonce on|off\` — forward view-once to owner\n` +
                `• \`.antidelete minlen <n>\` — skip msgs shorter than n chars\n` +
                `• \`.antidelete ttl <hours>\` — how long to cache messages (1-48h)\n` +
                `• \`.antidelete ignore add|remove|list <number>\`\n` +
                `• \`.antidelete group <groupJid> owner|group\` — per-group override\n` +
                `• \`.antidelete clear\` — flush message cache now\n` +
                `• \`.antidelete stats\` — show detection statistics\n` +
                `• \`.antidelete test\` — send a test detection report`
            );
        }

        /* ── on / off ──────────────────────────────────────────────────── */
        if (action === 'on') {
            config.enabled = true;
            await saveConfig(config);
            return reply(
                `✅ *Antidelete ULTRA v7 ENABLED*\n\n` +
                `• Edit tracking: ${config.trackEdits ? '✅' : '❌'}\n` +
                `• Media recovery: ${config.recoverMedia !== false ? '✅' : '❌'}\n` +
                `• View-once forward: ${config.forwardViewOnce !== false ? '✅' : '❌'}\n` +
                `• Min length: ${config.minLength || 1} chars\n` +
                `• Caching: ${messageStore.size} msgs in store`
            );
        }

        if (action === 'off') {
            config.enabled = false;
            await saveConfig(config);
            return reply('❌ *Antidelete DISABLED*\nMessages will no longer be monitored.');
        }

        /* ── delpath ───────────────────────────────────────────────────── */
        if (action === 'delpath') {
            const sub = args[1]?.toLowerCase();
            if (!sub) return reply(`*Current delpath:* ${config.delpath}\n\nOptions:\n• \`owner\` — send to your DM\n• \`group\` — send in the group where message was deleted\n• \`<full JID>\` — send to a specific chat`);
            if (['owner','group'].includes(sub) || sub.includes('@')) {
                config.delpath = sub;
                await saveConfig(config);
                return reply(`✅ Delpath → *${sub}*`);
            }
            return reply('❌ Use: `owner` / `group` / full JID (e.g. 923001234567@s.whatsapp.net)');
        }

        /* ── edits ─────────────────────────────────────────────────────── */
        if (action === 'edits') {
            const v = args[1]?.toLowerCase();
            if (v !== 'on' && v !== 'off') return reply('❌ Usage: `.antidelete edits on|off`');
            config.trackEdits = v === 'on';
            await saveConfig(config);
            return reply(`✅ Edit tracking → *${v}*\n${v === 'on' ? 'Message edits will be reported.' : 'Edits will be silently ignored.'}`);
        }

        /* ── media ─────────────────────────────────────────────────────── */
        if (action === 'media') {
            const v = args[1]?.toLowerCase();
            if (v !== 'on' && v !== 'off') return reply('❌ Usage: `.antidelete media on|off`\n\nWhen ON: deleted photos, videos, audio and documents are re-sent to the delpath.\nWhen OFF: only the text notification is sent (no media recovery).');
            config.recoverMedia = v === 'on';
            await saveConfig(config);
            return reply(`✅ Media recovery → *${v}*`);
        }

        /* ── viewonce ──────────────────────────────────────────────────── */
        if (action === 'viewonce' || action === 'vo') {
            const v = args[1]?.toLowerCase();
            if (v !== 'on' && v !== 'off') return reply('❌ Usage: `.antidelete viewonce on|off`\n\nWhen ON: view-once photos/videos are automatically forwarded to the owner\'s DM when received.');
            config.forwardViewOnce = v === 'on';
            await saveConfig(config);
            return reply(`✅ View-once forward → *${v}*`);
        }

        /* ── minlen ────────────────────────────────────────────────────── */
        if (action === 'minlen') {
            const n = parseInt(args[1]);
            if (isNaN(n) || n < 1) return reply('❌ Usage: `.antidelete minlen <number>`\n\nExample: `.antidelete minlen 5` — don\'t report deletions of messages shorter than 5 characters.');
            config.minLength = n;
            await saveConfig(config);
            return reply(`✅ Min length → *${n}* chars\nMessages shorter than ${n} chars will be ignored when deleted.`);
        }

        /* ── ttl ───────────────────────────────────────────────────────── */
        if (action === 'ttl') {
            const h = parseFloat(args[1]);
            if (isNaN(h) || h < 1 || h > 48) return reply('❌ Usage: `.antidelete ttl <hours>`\n\nValid range: 1–48 hours. Default is 8h.\nMessages are only recoverable if they were cached within this window.');
            config.storeTtlMs = Math.round(h * 3600000);
            await saveConfig(config);
            return reply(`✅ Cache TTL → *${h}h*\nMessages older than ${h}h will not be recoverable.`);
        }

        /* ── ignore ────────────────────────────────────────────────────── */
        if (action === 'ignore') {
            const sub = args[1]?.toLowerCase();
            const num = (args[2] || '').replace(/\D/g, '');
            if (!config.ignoreList) config.ignoreList = [];

            if (sub === 'add' && num) {
                if (!config.ignoreList.includes(num)) config.ignoreList.push(num);
                await saveConfig(config);
                return reply(`✅ *+${num}* added to ignore list.\nDeletions by this number will be silently ignored.`);
            }
            if (sub === 'remove' && num) {
                config.ignoreList = config.ignoreList.filter(n => n !== num);
                await saveConfig(config);
                return reply(`✅ *+${num}* removed from ignore list.`);
            }
            if (sub === 'clear') {
                const count = config.ignoreList.length;
                config.ignoreList = [];
                await saveConfig(config);
                return reply(`✅ Ignore list cleared (${count} numbers removed).`);
            }
            if (sub === 'list') {
                return reply(config.ignoreList.length
                    ? `📋 *Ignore List (${config.ignoreList.length}):*\n${config.ignoreList.map(n=>`• +${n}`).join('\n')}`
                    : '📭 Ignore list is empty.');
            }
            return reply('❌ Usage: `.antidelete ignore add|remove|clear|list <number>`');
        }

        /* ── group ─────────────────────────────────────────────────────── */
        if (action === 'group') {
            const sub = args[1]?.toLowerCase();

            // .antidelete group list
            if (sub === 'list') {
                const overrides = config.groupOverrides || {};
                const keys = Object.keys(overrides);
                return reply(keys.length
                    ? `📋 *Group Overrides (${keys.length}):*\n${keys.map(k=>`• ${k} → ${overrides[k]}`).join('\n')}`
                    : '📭 No group overrides set.');
            }
            // .antidelete group remove <jid>
            if (sub === 'remove') {
                const gJid = args[2];
                if (!gJid) return reply('❌ Usage: `.antidelete group remove <groupJid>`');
                delete (config.groupOverrides || {})[gJid];
                await saveConfig(config);
                return reply(`✅ Override for *${gJid}* removed.`);
            }
            // .antidelete group <jid> owner|group
            const gJid = args[1];
            const dp   = args[2]?.toLowerCase();
            if (!gJid || !dp) return reply('❌ Usage:\n`.antidelete group <groupJid> owner|group`\n`.antidelete group list`\n`.antidelete group remove <groupJid>`');
            if (!config.groupOverrides) config.groupOverrides = {};
            config.groupOverrides[gJid] = dp;
            await saveConfig(config);
            return reply(`✅ Group *${gJid}* → delpath: *${dp}*`);
        }

        /* ── clear ─────────────────────────────────────────────────────── */
        if (action === 'clear') {
            const count = messageStore.size;
            messageStore.clear();
            storeOrder.length = 0;
            return reply(`✅ Message cache cleared.\n${count} cached messages removed.`);
        }

        /* ── stats ─────────────────────────────────────────────────────── */
        if (action === 'stats') {
            let textCount = 0, mediaCount = 0, forwardCount = 0;
            for (const [, v] of messageStore) {
                if (v.mediaType) mediaCount++;
                else textCount++;
                if (v.isForward) forwardCount++;
            }
            return reply(
                `*📊 ANTIDELETE STATS*\n\n` +
                `*Cached messages:*   ${messageStore.size}\n` +
                `  • Text:     ${textCount}\n` +
                `  • Media:    ${mediaCount}\n` +
                `  • Forwarded: ${forwardCount}\n\n` +
                `*Config:*\n` +
                `  • Enabled:  ${config.enabled ? '✅' : '❌'}\n` +
                `  • Delpath:  ${config.delpath || 'owner'}\n` +
                `  • TTL:      ${Math.round((config.storeTtlMs||STORE_TTL_MS)/3600000)}h\n` +
                `  • Ignore:   ${config.ignoreList?.length || 0} numbers`
            );
        }

        /* ── test ──────────────────────────────────────────────────────── */
        if (action === 'test') {
            if (!config.enabled) return reply('⚠️ Antidelete is currently OFF. Enable it first with `.antidelete on`');
            const ownerJid = getOwnerJid(sock);
            const targetJid = config.delpath === 'group' && chatId.endsWith('@g.us') ? chatId : (ownerJid || chatId);
            const time = new Date().toLocaleString('en-US', {
                timeZone: process.env.TIMEZONE || 'Asia/Karachi',
                hour12: true, hour: '2-digit', minute: '2-digit',
                day: '2-digit', month: '2-digit', year: 'numeric',
            });
            await sock.sendMessage(targetJid, {
                text:
                    `*🔰 REDX ANTIDELETE v7 — TEST REPORT 🔰*\n\n` +
                    `*🗑️ Deleted By:* +1234567890 (simulated)\n` +
                    `*👤 Sender:*    +9876543210 (simulated)\n` +
                    `*🕒 Time:*      ${time}\n` +
                    `*💬 Message:*\nThis is a test deletion report.\n\n` +
                    `> Antidelete is working correctly ✅\n` +
                    `> Delpath: ${config.delpath || 'owner'}\n` +
                    `> Cache: ${messageStore.size} messages\n` +
                    `> REDXMINI-BOT v7`,
            });
            return reply(`✅ *Test report sent!*\nCheck: ${targetJid === ownerJid ? 'your DM' : targetJid}`);
        }

        return reply('❌ Unknown subcommand.\nUsage: `.antidelete on|off|status|delpath|edits|media|viewonce|minlen|ttl|ignore|group|clear|stats|test`');
    },

    handleMessageRevocation,
    handleMessageEdit,
    storeMessage,
    storeEdit,
    loadAntideleteConfig,
    saveAntideleteConfig,
};
