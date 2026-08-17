/*****************************************************************************
 *  plugins/antilink.js — REDXMINI-BOT ULTRA v8
 *  Developed by Abdul Rehman Rajpoot
 *
 *  v6 BUG FIXES (over v5):
 *  ✅ safeDelete: tries message.key as-is FIRST (preserves @lid participant
 *     format), then falls back to normSender as participant. Fixes
 *     "sometimes doesn't delete" caused by WhatsApp rejecting constructed keys.
 *  ✅ normParticipant removed: kick/ban/remove now use normSender (resolved
 *     by resolveSender to real @s.whatsapp.net). Fixes @lid → wrong short
 *     JID like 18@s.whatsapp.net causing "internal error" on groupParticipantsUpdate.
 *  ✅ Action order fixed: delete FIRST, then react, then warn. Previously
 *     reaction + warning fired before delete → user saw "handled" but message
 *     stayed.
 *  ✅ _notAdminWarned rate limit: 30 min → 5 min. Prevents 30-min silent
 *     gap where antilink detects but shows nothing.
 *  ✅ Delete failed path: sends brief alert so group knows message wasn't
 *     actually removed (instead of silent fail).
 *  ✅ Kick/ban error messages: cleaned up, won't appear as "internal error".
 *  ✅ Bot admin check: if isAdmin throws, do a direct groupMetadata fallback
 *     before giving up.
 *****************************************************************************/

'use strict';
const fs = require('fs');
const path = require('path');
const { cmd } = require('../arslan');

const CONFIG_PATH = path.join(__dirname, '..', 'data', 'antilink.json');

/* ─── JID helpers ─────────────────────────────────────────────────────────── */
function phoneNum(jid) {
    if (!jid) return '';
    return String(jid).split(':')[0].split('@')[0].replace(/\D/g, '');
}
function toSWJid(jid) {
    const n = phoneNum(jid);
    // Only convert if result looks like a real phone number (≥7 digits)
    return (n && n.length >= 7) ? `${n}@s.whatsapp.net` : null;
}
function samePhone(a, b) {
    const na = phoneNum(a), nb = phoneNum(b);
    return !!(na && nb && (na === nb || na.slice(-9) === nb.slice(-9)));
}

/* ─── Default config ─────────────────────────────────────────────────────── */
const DEFAULT_CONFIG = {
    enabled:     false,
    mode:        'warn',
    maxWarnings: 3,
    whitelist:   [],
    types: {
        waGroup:    true,
        waChannel:  true,
        telegram:   true,
        discord:    true,
        instagram:  false,  // off by default (many groups share reels legitimately)
        tiktok:     false,  // off by default
        allLinks:   true,
        shortLinks: true,
    }
};

/* ─── Store helpers ──────────────────────────────────────────────────────── */
// ✅ SPEED FIX: readConfig ran a DB/file read on EVERY group message with
// zero caching — the single biggest per-message cost in groups, since
// antilink checks plain chatter, not just commands. antibot.js/antiflood.js
// already use a 10s TTL cache for exactly this; ports the same pattern.
const _cfgCache = new Map(); // chatId → { val, ts }
const _CFG_TTL  = 10000;

function readAllConfigs() {
    try {
        if (!fs.existsSync(CONFIG_PATH)) return {};
        const value = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        return value && typeof value === 'object' ? value : {};
    } catch (e) {
        console.error('[ANTILINK] readConfig error:', e.message);
        return {};
    }
}

async function readConfig(chatId) {
    const cached = _cfgCache.get(chatId);
    if (cached && Date.now() - cached.ts < _CFG_TTL) return cached.val;
    let val;
    try {
        const c = readAllConfigs()[chatId];
        val = c ? { ...DEFAULT_CONFIG, ...c, types: { ...DEFAULT_CONFIG.types, ...(c.types || {}) } }
                : { ...DEFAULT_CONFIG, types: { ...DEFAULT_CONFIG.types } };
    } catch (e) {
        console.error('[ANTILINK] readConfig error:', e.message);
        val = { ...DEFAULT_CONFIG, types: { ...DEFAULT_CONFIG.types } };
    }
    _cfgCache.set(chatId, { val, ts: Date.now() });
    return val;
}
async function writeConfig(chatId, config) {
    _cfgCache.set(chatId, { val: config, ts: Date.now() });
    try {
        const all = readAllConfigs();
        all[chatId] = config;
        fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
        const tempPath = `${CONFIG_PATH}.tmp`;
        fs.writeFileSync(tempPath, JSON.stringify(all, null, 2));
        fs.renameSync(tempPath, CONFIG_PATH);
    }
    catch (e) { console.error('[ANTILINK] writeConfig error:', e.message); }
}

/* ─── In-memory state ────────────────────────────────────────────────────── */
const warningCount      = new Map();
const shadowBanned      = new Set();
const _notAdminWarned   = new Map();  // chatId → timestamp

/* ─── Link detection ─────────────────────────────────────────────────────── */
/* ─── ADVANCED v7: evasion-resistant normalization ──────────────────────────
 * People dodge link filters with cyrillic/fullwidth look-alike characters,
 * bracketed dots ("chat[.]whatsapp[.]com"), and spelled-out separators
 * ("chat dot whatsapp dot com" / "chat (dot) whatsapp (dot) com"). Regex
 * link patterns never match those directly — this folds them back to plain
 * ASCII text before detection runs, so the SAME patterns below catch the
 * evaded forms without needing a separate rule per evasion trick. */
const HOMOGLYPH_MAP = {
    // Cyrillic look-alikes → Latin
    'а':'a','е':'e','о':'o','р':'p','с':'c','х':'x','у':'y','і':'i','ѕ':'s','һ':'h',
    'А':'A','Е':'E','О':'O','Р':'P','С':'C','Х':'X','У':'Y','І':'I',
};
function foldHomoglyphs(text) {
    let out = '';
    for (const ch of text) out += HOMOGLYPH_MAP[ch] || ch;
    // Fullwidth ASCII block (！-～, U+FF01–FF5E) → plain ASCII (offset -0xFEE0)
    out = out.replace(/[\uFF01-\uFF5E]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
    return out;
}
function foldSpelledOutSeparators(text) {
    return text
        .replace(/\s*[\(\[\{]\s*dot\s*[\)\]\}]\s*/gi, '.')
        .replace(/\s+dot\s+/gi, '.')
        .replace(/\s*[\(\[\{]\s*at\s*[\)\]\}]\s*/gi, '@')
        .replace(/\[\.\]|\{\.\}|\(\.\)/g, '.');
}

function detectLinks(text, enabledTypes) {
    if (!text) return null;

    let normalized = foldHomoglyphs(text);
    normalized = foldSpelledOutSeparators(normalized);
    normalized = normalized
        .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, '')
        .replace(/(\w)\s+\./g, '$1.')
        .replace(/\.\s+(\w)/g, '.$1');

    if (/wa\.me\/\+?[0-9]{7,15}(?:\?.*)?$/i.test(normalized)) return null;

    const patterns = {
        waGroup:    /chat\.whatsapp\.com\/[A-Za-z0-9+_/=-]{10,}/i,
        waChannel:  /(?:wa\.me\/channel|whatsapp\.com\/channel)\/[A-Za-z0-9+_/=-]{10,}/i,
        telegram:   /(?:t\.me|telegram\.me|telegram\.dog)\/(?:\+|joinchat\/)?[A-Za-z0-9_-]+/i,
        discord:    /(?:discord\.gg|discord\.com\/invite|discordapp\.com\/invite)\/[A-Za-z0-9-]+/i,
        shortLinks: /(?:bit\.ly|tinyurl\.com|goo\.gl|ow\.ly|buff\.ly|rebrand\.ly|t\.co|is\.gd|cutt\.ly|rb\.gy|tiny\.cc|shorturl\.at|qr\.ae|bl\.ink|snip\.ly)\/[A-Za-z0-9_-]+/i,
        instagram:  /(?:instagram\.com|instagr\.am)\/(?:p|reel|tv|stories|share)\/[A-Za-z0-9_-]+/i,
        tiktok:     /(?:tiktok\.com\/@[A-Za-z0-9_.]+\/video|vm\.tiktok\.com)\/[A-Za-z0-9_-]+/i,
        allLinks:   /(?:https?:\/\/|ftp:\/\/|www\.)[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z]{2,}\b[-a-zA-Z0-9()@:%_+.~#?&/=]*/i,
    };

    const priority = ['waGroup','waChannel','telegram','discord','instagram','tiktok','shortLinks','allLinks'];
    for (const type of priority) {
        if (enabledTypes[type] === false) continue;
        const pat = patterns[type];
        if (!pat) continue;
        const m = pat.exec(normalized) || pat.exec(text);
        if (m) return { type, match: m[0] };
    }
    return null;
}

function isWhitelisted(match, whitelist) {
    if (!whitelist?.length) return false;
    const lower = String(match).toLowerCase();
    return whitelist.some(w => lower.includes(w.toLowerCase()));
}

function extractTexts(message) {
    const m = message.message || {};
    return [
        m.conversation,
        m.extendedTextMessage?.text,
        m.imageMessage?.caption,
        m.videoMessage?.caption,
        m.documentMessage?.caption,
        m.audioMessage?.caption,
        m.buttonsMessage?.contentText,
        m.listMessage?.description,
        m.extendedTextMessage?.contextInfo?.quotedMessage?.conversation,
        m.extendedTextMessage?.contextInfo?.quotedMessage?.extendedTextMessage?.text,
    ].filter(Boolean);
}

/* ─── safeDelete v6 ─────────────────────────────────────────────────────────
 *  FIX: Try message.key AS-IS first. WhatsApp may require exact participant
 *  JID format (@lid or @s.whatsapp.net) that was stored server-side.
 *  Fallback: rebuild key with normSender as participant.
 * ─────────────────────────────────────────────────────────────────────────── */
async function safeDelete(sock, chatId, message, normSender) {
    // Attempt 1: use original message.key (exact format WhatsApp stored)
    try {
        await sock.sendMessage(chatId, { delete: message.key });
        return true;
    } catch (e1) {
        // Attempt 2: fallback with resolved @s.whatsapp.net participant
        try {
            const fallbackKey = {
                remoteJid:   chatId,
                fromMe:      false,
                id:          message.key.id,
                participant: normSender,  // already resolved by resolveSender()
            };
            await sock.sendMessage(chatId, { delete: fallbackKey });
            return true;
        } catch (e2) {
            console.error('[ANTILINK] delete failed (both attempts):', e2.message);
            return false;
        }
    }
}

async function safeSend(sock, chatId, payload) {
    try { await sock.sendMessage(chatId, payload); }
    catch (e) { console.error('[ANTILINK] send failed:', e.message); }
}

/* ─── Bot admin check with fallback ─────────────────────────────────────── */
async function checkAdmin(sock, chatId, normSender, suppliedMeta) {
    try {
        const meta = suppliedMeta || await sock.groupMetadata(chatId);
        const botNum = phoneNum(sock.user?.id);
        const senderNum = phoneNum(normSender);
        let isBotAdmin = false, isSenderAdmin = false;
        for (const p of (meta?.participants || [])) {
            const pNum = phoneNum(p.id);
            const isAdm = p.admin === 'admin' || p.admin === 'superadmin';
            if (isAdm && botNum && (pNum === botNum || pNum.slice(-9) === botNum.slice(-9))) isBotAdmin = true;
            if (isAdm && senderNum && (pNum === senderNum || pNum.slice(-9) === senderNum.slice(-9))) isSenderAdmin = true;
        }
        return { isBotAdmin, isSenderAdmin };
    } catch (e) {
        console.error('[ANTILINK] admin check error:', e.message);
        return { isBotAdmin: false, isSenderAdmin: false };
    }
}

/* ─── Main detection handler ─────────────────────────────────────────────── */
async function handleLinkDetection(sock, chatId, message, userMessage, senderId, runtime = {}) {
    try {
        if (!chatId.endsWith('@g.us')) return;

        const config = await readConfig(chatId);
        if (!config?.enabled) return;

        const m = message.message || {};
        if (m.protocolMessage || m.contactMessage || m.locationMessage) return;

        // Collect and scan texts
        const texts = extractTexts(message);
        if (userMessage && !texts.includes(userMessage)) texts.unshift(userMessage);

        let detected = null;
        for (const t of texts) {
            detected = detectLinks(t, config.types || DEFAULT_CONFIG.types);
            if (detected) break;
        }
        if (!detected) return;
        if (isWhitelisted(detected.match, config.whitelist)) return;

        // normSender: already resolved by resolveSender() in messageHandler
        // Use it directly — don't try to re-derive from message.key.participant
        // (message.key.participant may be @lid which toSWJid converts to a wrong short JID)
        const normSender  = toSWJid(senderId) || senderId;
        const botPhone    = phoneNum(sock.user?.id);

        if (botPhone && samePhone(normSender, botPhone)) return;

        if (runtime.isOwner) return;

        // ── Admin check (with fallback on error) ───────────────────────────
        const adminState = (typeof runtime.isBotAdmin === 'boolean' &&
            typeof runtime.isSenderAdmin === 'boolean')
            ? { isBotAdmin: runtime.isBotAdmin, isSenderAdmin: runtime.isSenderAdmin }
            : await checkAdmin(sock, chatId, normSender, runtime.groupMetadata);
        if (adminState.isSenderAdmin) return;
        const isBotAdmin = adminState.isBotAdmin;

        const senderShort = phoneNum(normSender) || normSender.split('@')[0];
        const typeLabel   = detected.type.replace(/([A-Z])/g, ' $1').trim();
        const warningKey  = `${chatId}:${normSender}`;

        // ── STEP 1: Delete (BEFORE react/warn — so action is real first) ───
        let deleted = false;
        if (isBotAdmin) {
            deleted = await safeDelete(sock, chatId, message, normSender);
        } else {
            // Not admin — rate-limited warning (5 min, was 30)
            const last = _notAdminWarned.get(chatId) || 0;
            if (Date.now() - last > 5 * 60_000) {
                _notAdminWarned.set(chatId, Date.now());
                await safeSend(sock, chatId, {
                    text: `⚠️ *Antilink:* Detected a *${typeLabel}* link — make me admin so I can delete it.`
                });
            }
        }

        // ── STEP 2: React (after delete attempt) ───────────────────────────
        try { await sock.sendMessage(chatId, { react: { text: '🚫', key: message.key } }); } catch {}

        // ── STEP 3: If delete failed (bot is admin but delete errored), warn ─
        if (isBotAdmin && !deleted) {
            await safeSend(sock, chatId, {
                text: `⚠️ @${senderShort} — ${typeLabel} link detected but couldn't delete it. Check my permissions.`,
                mentions: [normSender]
            });
            return;
        }

        // ── STEP 4: Mode-based follow-up action ────────────────────────────
        if (config.mode === 'delete') return;  // delete only, no extra action

        if (config.mode === 'shadowban') {
            shadowBanned.add(`${chatId}:${normSender}`);
            await safeSend(sock, chatId, {
                text: `🚫 @${senderShort} — Link detected. You are now restricted.`,
                mentions: [normSender]
            });
            return;
        }

        // FIX: Use normSender for groupParticipantsUpdate (not derived @lid).
        // normSender = resolveSender() output = real @s.whatsapp.net JID.
        if (config.mode === 'ban') {
            if (isBotAdmin) {
                try {
                    await sock.groupParticipantsUpdate(chatId, [normSender], 'remove');
                    await sock.updateBlockStatus(normSender, 'block').catch(() => {});
                    await safeSend(sock, chatId, {
                        text: `🚫 @${senderShort} banned for *${typeLabel}* link.`,
                        mentions: [normSender]
                    });
                } catch (e) {
                    console.error('[ANTILINK] ban failed:', e.message);
                    await safeSend(sock, chatId, {
                        text: `⚠️ @${senderShort} — Could not complete ban. Check my admin permissions.`,
                        mentions: [normSender]
                    });
                }
            } else {
                await safeSend(sock, chatId, {
                    text: `🚫 @${senderShort} shared *${typeLabel}* — make me admin to ban.`,
                    mentions: [normSender]
                });
            }
            return;
        }

        if (config.mode === 'kick') {
            if (isBotAdmin) {
                try {
                    await sock.groupParticipantsUpdate(chatId, [normSender], 'remove');
                    await safeSend(sock, chatId, {
                        text: `🚫 @${senderShort} removed for *${typeLabel}* link.`,
                        mentions: [normSender]
                    });
                } catch (e) {
                    console.error('[ANTILINK] kick failed:', e.message);
                    await safeSend(sock, chatId, {
                        text: `⚠️ @${senderShort} — Could not remove. Check my admin permissions.`,
                        mentions: [normSender]
                    });
                }
            } else {
                await safeSend(sock, chatId, {
                    text: `🚫 @${senderShort} shared *${typeLabel}* — make me admin to kick.`,
                    mentions: [normSender]
                });
            }
            return;
        }

        // ── MODE: warn (default) ───────────────────────────────────────────
        let warns = (warningCount.get(warningKey) || 0) + 1;
        warningCount.set(warningKey, warns);
        const max = config.maxWarnings || 3;

        if (warns < max) {
            await safeSend(sock, chatId, {
                text: `⚠️ *Antilink Warning ${warns}/${max}*\n\n@${senderShort}, *${typeLabel}* links are not allowed!\n_${max - warns} more warning(s) before removal._`,
                mentions: [normSender]
            });
        } else {
            warningCount.set(warningKey, 0);
            if (isBotAdmin) {
                try {
                    await sock.groupParticipantsUpdate(chatId, [normSender], 'remove');
                    await safeSend(sock, chatId, {
                        text: `🚫 @${senderShort} removed — reached max warnings for *${typeLabel}* links.`,
                        mentions: [normSender]
                    });
                } catch (e) {
                    console.error('[ANTILINK] warn-kick failed:', e.message);
                    await safeSend(sock, chatId, {
                        text: `⚠️ @${senderShort} hit warn limit — could not remove. Check my permissions.`,
                        mentions: [normSender]
                    });
                }
            } else {
                await safeSend(sock, chatId, {
                    text: `⚠️ @${senderShort} hit warn limit — make me admin to remove.`,
                    mentions: [normSender]
                });
            }
        }
    } catch (e) {
        console.error('[ANTILINK] handleLinkDetection error:', e.message);
    }
}

function isShadowBanned(chatId, senderId) {
    const norm = toSWJid(senderId) || senderId;
    return shadowBanned.has(`${chatId}:${norm}`);
}

/* ─── Command handler ────────────────────────────────────────────────────── */
cmd({
    pattern: 'antilink',
    alias: ['alink', 'linkblock', 'linkprotect'],
    desc: 'Ultra link protection — delete, warn, kick, whitelist and type controls',
    category: 'admin',
    react: '🔗',
    filename: __filename
}, async (sock, message, m, context = {}) => {
    const chatId = context.from || message.key.remoteJid;
    const reply = context.reply || ((text) => sock.sendMessage(chatId, { text }, { quoted: message }));
    const args = Array.isArray(context.args) ? context.args : [];

    if (!context.isGroup) return reply('❌ This command only works in groups.');
    if (!context.isAdmins && !context.isOwner) return reply('❌ You need to be a group admin to use this command.');
    if (!context.isBotAdmins) return reply('❌ Make me a group admin before enabling anti-link.');

    const config = await readConfig(chatId);
    const action = args[0]?.toLowerCase();

    if (!action || action === 'status') {
        const types = config.types || DEFAULT_CONFIG.types;
        const activeTypes = Object.entries(types).filter(([, value]) => value).map(([key]) => key);
        return reply(
            `🔗 *ANTILINK ULTRA v8 — Status*\n\n` +
            `Status: ${config.enabled ? '✅ ON' : '❌ OFF'}\n` +
            `Mode: ${(config.mode || 'warn').toUpperCase()}\n` +
            `Max warns: ${config.mode === 'kick' || config.mode === 'ban' ? 'Instant' : config.maxWarnings}\n` +
            `Whitelist: ${config.whitelist?.length || 0} domain(s)\n` +
            `Active types: ${activeTypes.join(', ')}\n\n` +
            `Use: .antilink on/off, mode, max, whitelist, toggle, types or reset`
        );
    }

    if (action === 'on') {
        config.enabled = true;
        await writeConfig(chatId, config);
        return reply(`✅ *Antilink ENABLED*\nMode: ${config.mode} | Max warns: ${config.maxWarnings}`);
    }
    if (action === 'off') {
        config.enabled = false;
        await writeConfig(chatId, config);
        return reply('❌ Antilink disabled.');
    }

    if (action === 'mode') {
        const modes = ['warn', 'kick', 'delete', 'shadowban', 'ban'];
        const mode = args[1]?.toLowerCase();
        if (!modes.includes(mode)) return reply(`❌ Modes: ${modes.join(' | ')}`);
        config.mode = mode;
        await writeConfig(chatId, config);
        return reply(`✅ Mode → *${mode.toUpperCase()}*`);
    }

    if (action === 'max') {
        const maxWarnings = parseInt(args[1], 10);
        if (isNaN(maxWarnings) || maxWarnings < 1) return reply('❌ Usage: `.antilink max <number>`');
        config.maxWarnings = maxWarnings;
        await writeConfig(chatId, config);
        return reply(`✅ Max warnings: *${maxWarnings}*`);
    }

    if (action === 'whitelist') {
        const subcommand = args[1]?.toLowerCase();
        const domain = args[2]?.toLowerCase();
        if (!config.whitelist) config.whitelist = [];
        if (subcommand === 'add' && domain) {
            if (!config.whitelist.includes(domain)) config.whitelist.push(domain);
            await writeConfig(chatId, config);
            return reply(`✅ Added: \`${domain}\``);
        }
        if (subcommand === 'remove' && domain) {
            config.whitelist = config.whitelist.filter(item => item !== domain);
            await writeConfig(chatId, config);
            return reply(`✅ Removed: \`${domain}\``);
        }
        if (subcommand === 'list') {
            return reply(config.whitelist.length
                ? `✅ Whitelist:\n${config.whitelist.map((item, index) => `${index + 1}. \`${item}\``).join('\n')}`
                : '📭 Whitelist empty.');
        }
        return reply('❌ Usage: `.antilink whitelist add|remove|list <domain>`');
    }

    if (action === 'types') {
        const types = { ...DEFAULT_CONFIG.types, ...(config.types || {}) };
        return reply(`🔘 *Types:*\n\n${Object.entries(types).map(([key, value]) => `${value ? '✅' : '❌'} ${key}`).join('\n')}\n\nToggle: \`.antilink toggle <type>\``);
    }

    if (action === 'toggle') {
        const type = args[1]?.toLowerCase();
        const types = { ...DEFAULT_CONFIG.types, ...(config.types || {}) };
        if (!type || !(type in types)) return reply(`❌ Types: ${Object.keys(types).join(', ')}`);
        types[type] = !types[type];
        config.types = types;
        await writeConfig(chatId, config);
        return reply(`✅ \`${type}\`: ${types[type] ? 'ON ✅' : 'OFF ❌'}`);
    }

    if (action === 'reset') {
        await writeConfig(chatId, { ...DEFAULT_CONFIG, types: { ...DEFAULT_CONFIG.types } });
        for (const key of warningCount.keys()) if (key.startsWith(chatId)) warningCount.delete(key);
        for (const key of shadowBanned) if (key.startsWith(chatId)) shadowBanned.delete(key);
        return reply('🔄 Antilink reset to defaults.');
    }

    return reply('❌ Unknown. Use `.antilink status`');
});

// The main message loop dispatches all `on: body` registrations. This keeps
// detection active for normal text, captions and quoted messages.
cmd({
    pattern: 'antilink_handler',
    on: 'body',
    dontAddCommandList: true,
    filename: __filename
}, async (sock, message, m, context = {}) => {
    if (!context.body) return;
    return handleLinkDetection(
        sock,
        context.from,
        message,
        context.body,
        context.sender,
        {
            isOwner: context.isOwner,
            isSenderAdmin: context.isAdmins,
            isBotAdmin: context.isBotAdmins,
            groupMetadata: context.groupMetadata
        }
    );
});

module.exports = { handleLinkDetection, isShadowBanned, detectLinks };
