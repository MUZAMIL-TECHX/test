// Complete anti-delete feature:
// - .antidelete on/off command
// - original-message cache with disk persistence
// - delete-event detection
// - delivery to the connected bot account's inbox

const fs = require('fs');
const path = require('path');
const { cmd } = require('../arslan');
const config = require('../config');
const { getContentType, downloadMediaMessage } = require('@whiskeysockets/baileys');
const {
    getUserConfigFromMongoDB,
    updateUserConfigInMongoDB
} = require('./database');

const REVOKE_TYPE = 0;
const MAX_SAVED_MESSAGES = 1000;
const DATA_DIR = path.join(__dirname, '..', 'data', 'antidelete');
const messageCaches = new Map();
const settingsCache = new Map();
const loadedMessageFiles = new Set();
const saveQueues = new Map();
const saveTimers = new Map();

function cleanNumber(value) {
    return String(value || '').replace(/\D/g, '');
}

function botKey(botNumber) {
    return cleanNumber(botNumber) || 'default';
}

function messageKey(remoteJid, id) {
    return `${remoteJid || 'unknown'}:${id || 'unknown'}`;
}

function getMessageCache(botNumber) {
    const key = botKey(botNumber);
    if (!messageCaches.has(key)) messageCaches.set(key, new Map());
    return messageCaches.get(key);
}

function getSettingsFile(botNumber) {
    return path.join(DATA_DIR, `settings-${botKey(botNumber)}.json`);
}

function getMessagesFile(botNumber) {
    return path.join(DATA_DIR, `messages-${botKey(botNumber)}.json`);
}

function safeReadJson(filePath, fallback) {
    try {
        if (!fs.existsSync(filePath)) return fallback;
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
        console.error(`[ANTIDELETE] Could not read ${path.basename(filePath)}:`, error.message);
        return fallback;
    }
}

function safeWriteJson(filePath, value) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tempPath = `${filePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(value));
    fs.renameSync(tempPath, filePath);
}

function getConfiguredOwnerJid() {
    const configured = Array.isArray(config.OWNER_NUMBER)
        ? config.OWNER_NUMBER
        : String(config.OWNER_NUMBER || '').split(',');
    const number = configured.map(cleanNumber).find(Boolean);
    return number ? `${number}@s.whatsapp.net` : null;
}

function getDeliveryJids(botNumber) {
    // In a multi-session bot, the connected account is the person who paired
    // and installed that bot. Prefer it over a shared/static OWNER_NUMBER.
    const connectedNumber = cleanNumber(botNumber);
    const ownerJid = connectedNumber
        ? `${connectedNumber}@s.whatsapp.net`
        : getConfiguredOwnerJid();
    return ownerJid ? [ownerJid] : [];
}

function isEnabledValue(value) {
    return value === true || value === 'true' || value === 'on' || value === 'enabled';
}

function readLocalStatus(botNumber) {
    const key = botKey(botNumber);
    if (settingsCache.has(key)) return settingsCache.get(key);
    const saved = safeReadJson(getSettingsFile(botNumber), {});
    const enabled = isEnabledValue(saved.enabled);
    settingsCache.set(key, enabled);
    return enabled;
}

async function getAntideleteStatus(botNumber) {
    const key = botKey(botNumber);
    if (settingsCache.has(key)) return settingsCache.get(key);

    // Local status is intentionally checked first. This keeps anti-delete
    // working even if MongoDB is temporarily unavailable.
    const localStatus = readLocalStatus(botNumber);
    if (localStatus) return true;

    try {
        const remoteConfig = await getUserConfigFromMongoDB(cleanNumber(botNumber));
        const enabled = isEnabledValue(remoteConfig?.ANTIDELETE);
        settingsCache.set(key, enabled);
        return enabled;
    } catch (error) {
        console.error('[ANTIDELETE] Status lookup failed:', error.message);
        return false;
    }
}

async function setAntideleteStatus(botNumber, enabled) {
    const key = botKey(botNumber);
    const value = Boolean(enabled);
    settingsCache.set(key, value);

    try {
        safeWriteJson(getSettingsFile(botNumber), {
            enabled: value,
            updatedAt: new Date().toISOString()
        });
    } catch (error) {
        console.error('[ANTIDELETE] Local status save failed:', error.message);
    }

    // Keep the existing database setting in sync, but don't make the feature
    // unusable just because the database is temporarily offline.
    const number = cleanNumber(botNumber);
    if (number) {
        try {
            await updateUserConfigInMongoDB(number, { ANTIDELETE: value ? 'true' : 'false' });
        } catch (error) {
            console.error('[ANTIDELETE] Database status sync failed:', error.message);
        }
    }
    config.ANTIDELETE = value ? 'true' : 'false';
    return value;
}

function unwrapMessage(message) {
    let current = message;
    for (let depth = 0; current && depth < 6; depth += 1) {
        const type = getSafeContentType(current);
        const wrapper = current?.[type];
        if (
            (type === 'ephemeralMessage' ||
                type === 'viewOnceMessage' ||
                type === 'viewOnceMessageV2' ||
                type === 'viewOnceMessageV2Extension') &&
            wrapper?.message
        ) {
            current = wrapper.message;
            continue;
        }
        break;
    }
    return current || {};
}

function getSafeContentType(message) {
    try {
        return getContentType(message || {});
    } catch {
        return null;
    }
}

function describeMessage(message) {
    const content = unwrapMessage(message);
    const type = getSafeContentType(content);

    if (type === 'conversation') return { type, text: content.conversation || '' };
    if (type === 'extendedTextMessage') {
        return { type, text: content.extendedTextMessage?.text || '' };
    }
    if (type === 'imageMessage') {
        return {
            type,
            text: `Image${content.imageMessage?.caption ? `\nCaption: ${content.imageMessage.caption}` : ''}`
        };
    }
    if (type === 'videoMessage') {
        return {
            type,
            text: `Video${content.videoMessage?.caption ? `\nCaption: ${content.videoMessage.caption}` : ''}`
        };
    }
    if (type === 'audioMessage') return { type, text: 'Audio' };
    if (type === 'stickerMessage') return { type, text: 'Sticker' };
    if (type === 'documentMessage') {
        return {
            type,
            text: `Document${content.documentMessage?.fileName ? `\nFile: ${content.documentMessage.fileName}` : ''}`
        };
    }
    if (type === 'locationMessage') return { type, text: 'Location' };
    if (type === 'contactMessage') return { type, text: 'Contact' };
    if (type === 'buttonsMessage') return { type, text: 'Buttons message' };
    if (type === 'listMessage') return { type, text: 'List message' };
    return { type: type || 'unknown', text: 'Media/message' };
}

function isRevoke(protocolMessage) {
    return protocolMessage && (
        protocolMessage.type === REVOKE_TYPE ||
        protocolMessage.type === String(REVOKE_TYPE) ||
        protocolMessage.type === 'REVOKE'
    );
}

function getProtocolMessage(update) {
    const message = update?.update?.message || update?.message;
    if (!message) return null;

    let current = message;
    for (let depth = 0; current && depth < 6; depth += 1) {
        if (current.protocolMessage) return current.protocolMessage;
        const type = getSafeContentType(current);
        const wrapper = current?.[type];
        if (!wrapper || typeof wrapper !== 'object') break;
        current = wrapper.message || wrapper;
    }
    return null;
}

function rememberMessage(cache, message) {
    const remoteJid = message?.key?.remoteJid;
    const id = message?.key?.id;
    if (!remoteJid || !id || !message.message) return;
    cache.set(messageKey(remoteJid, id), message);
    while (cache.size > MAX_SAVED_MESSAGES) {
        cache.delete(cache.keys().next().value);
    }
}

function saveCacheToDisk(botNumber) {
    const key = botKey(botNumber);
    if (saveTimers.has(key)) return saveQueues.get(key);

    const previous = saveQueues.get(key) || Promise.resolve();
    const next = new Promise(resolve => {
        const timer = setTimeout(() => {
            saveTimers.delete(key);
            previous
                .catch(() => undefined)
                .then(() => {
                    const cache = getMessageCache(botNumber);
                    safeWriteJson(getMessagesFile(botNumber), [...cache.values()]);
                })
                .catch(error => {
                    console.error('[ANTIDELETE] Message save failed:', error.message);
                })
                .then(resolve);
        }, 250);
        saveTimers.set(key, timer);
    });
    saveQueues.set(key, next);
    return next;
}

function rememberMessages(messages, botNumber) {
    const cache = getMessageCache(botNumber);
    for (const message of Array.isArray(messages) ? messages : [messages]) {
        rememberMessage(cache, message);
    }
    return saveCacheToDisk(botNumber);
}

function loadSavedMessages(botNumber) {
    const key = botKey(botNumber);
    if (loadedMessageFiles.has(key)) return getMessageCache(botNumber);

    const cache = getMessageCache(botNumber);
    const saved = safeReadJson(getMessagesFile(botNumber), []);
    for (const message of Array.isArray(saved) ? saved : []) {
        rememberMessage(cache, message);
    }
    loadedMessageFiles.add(key);
    return cache;
}

async function findDeletedMessage(store, deletedKey, botNumber) {
    let message = null;
    try {
        message = await store?.loadMessage?.(deletedKey.remoteJid, deletedKey.id);
    } catch (error) {
        console.error('[ANTIDELETE] Store lookup failed:', error.message);
    }
    if (message?.message) return message;

    const cache = loadSavedMessages(botNumber);
    return cache.get(messageKey(deletedKey.remoteJid, deletedKey.id)) ||
        [...cache.values()].find(item => item.key?.id === deletedKey.id) ||
        null;
}

async function getGroupName(conn, jid) {
    try {
        const metadata = await conn.groupMetadata(jid);
        return metadata?.subject || 'Unknown Group';
    } catch {
        return 'Unknown Group';
    }
}

async function sendRecoveredRichMessage(conn, ownerJid, originalMessage) {
    try {
        await conn.sendMessage(ownerJid, { forward: originalMessage, force: true });
        return true;
    } catch (forwardError) {
        console.error('[ANTIDELETE] Original forward failed:', forwardError.message);
    }

    // Some Baileys versions cannot forward an old media message directly.
    // Download it from WhatsApp and send it as a normal message instead.
    if (typeof downloadMediaMessage !== 'function') return false;
    try {
        const content = unwrapMessage(originalMessage.message);
        const type = getSafeContentType(content);
        const media = await downloadMediaMessage(originalMessage, 'buffer', {}, {
            reuploadRequest: conn.updateMediaMessage
                ? message => conn.updateMediaMessage(message)
                : undefined
        });
        if (!media) return false;

        if (type === 'imageMessage') {
            await conn.sendMessage(ownerJid, {
                image: media,
                caption: content.imageMessage?.caption || ''
            });
            return true;
        }
        if (type === 'videoMessage') {
            await conn.sendMessage(ownerJid, {
                video: media,
                caption: content.videoMessage?.caption || ''
            });
            return true;
        }
        if (type === 'audioMessage') {
            await conn.sendMessage(ownerJid, { audio: media, mimetype: 'audio/mpeg' });
            return true;
        }
        if (type === 'documentMessage') {
            await conn.sendMessage(ownerJid, {
                document: media,
                fileName: content.documentMessage?.fileName || 'recovered-file'
            });
            return true;
        }
    } catch (downloadError) {
        console.error('[ANTIDELETE] Media recovery failed:', downloadError.message);
    }
    return false;
}

async function handleAntidelete(conn, updates, store, botNumber) {
    if (!(await getAntideleteStatus(botNumber))) return;

    const ownerJids = getDeliveryJids(botNumber);
    if (!ownerJids.length) {
        console.error('[ANTIDELETE] No connected bot number or configured owner number');
        return;
    }

    for (const update of Array.isArray(updates) ? updates : [updates]) {
        const protocolMessage = getProtocolMessage(update);
        if (!isRevoke(protocolMessage)) continue;

        const updateKey = update?.key || {};
        const protocolKey = protocolMessage.key || {};
        const deletedKey = {
            ...updateKey,
            ...protocolKey,
            remoteJid: protocolKey.remoteJid || updateKey.remoteJid
        };
        if (!deletedKey.id || !deletedKey.remoteJid) {
            console.error('[ANTIDELETE] Delete event has no original message key');
            continue;
        }

        const originalMessage = await findDeletedMessage(store, deletedKey, botNumber);
        if (!originalMessage?.message) {
            console.warn(`[ANTIDELETE] Original message was not saved: ${deletedKey.id}`);
            continue;
        }

        const from = originalMessage.key?.remoteJid || deletedKey.remoteJid;
        const sender = originalMessage.key?.participant || originalMessage.key?.remoteJid || 'unknown';
        const isGroup = from.endsWith('@g.us');
        const description = describeMessage(originalMessage.message);
        const chatName = isGroup ? await getGroupName(conn, from) : 'Private Chat';
        const senderName = originalMessage.pushName || sender.split('@')[0];
        const notice =
            `MESSAGE DELETED\n\n` +
            `From: ${senderName}\n` +
            `Number: ${sender.split('@')[0]}\n` +
            `Chat: ${chatName}\n` +
            `Message: ${description.text}\n` +
            `Type: ${isGroup ? 'Group' : 'Private'}\n` +
            `Time: ${new Date().toLocaleString()}`;

        for (const ownerJid of ownerJids) {
            try {
                await conn.sendMessage(ownerJid, {
                    text: notice,
                    ...(sender.includes('@') ? { mentions: [sender] } : {})
                });

                if (!['conversation', 'extendedTextMessage'].includes(description.type)) {
                    await sendRecoveredRichMessage(conn, ownerJid, originalMessage);
                }
                console.log(`[ANTIDELETE] Recovered ${deletedKey.id} for ${ownerJid}`);
            } catch (error) {
                console.error(`[ANTIDELETE] Delivery failed for ${ownerJid}:`, error.message);
            }
        }
    }
}

// The command lives here so the complete feature remains in one module.
cmd({
    pattern: 'antidelete',
    alias: ['ad', 'antidel'],
    desc: 'Enable/Disable anti-delete',
    category: 'owner',
    ownerOnly: true,
    react: '🛡️',
    filename: __filename
}, async (conn, mek, m, { reply, args, sender, isCreator, botNumber }) => {
    if (!isCreator) return reply('Only the bot owner can use this command.');
    const action = String(args?.[0] || '').toLowerCase();
    if (!['on', 'off', 'enable', 'disable'].includes(action)) {
        const current = await getAntideleteStatus(botNumber || sender);
        return reply(`Anti-delete is currently ${current ? 'ON' : 'OFF'}.\nUse: .antidelete on/off`);
    }

    const enabled = action === 'on' || action === 'enable';
    await setAntideleteStatus(botNumber || sender, enabled);
    return reply(
        enabled
            ? 'Anti-delete ON. Deleted group/private messages will be saved and sent to this bot account inbox.'
            : 'Anti-delete OFF. New deleted-message alerts will not be processed.'
    );
});

cmd({
    pattern: 'antidelstatus',
    alias: ['adstatus', 'checkad'],
    desc: 'Check anti-delete status',
    category: 'owner',
    ownerOnly: true,
    react: '📊',
    filename: __filename
}, async (conn, mek, m, { reply, sender, botNumber, isCreator }) => {
    if (!isCreator) return reply('Only the bot owner can use this command.');
    const current = await getAntideleteStatus(botNumber || sender);
    return reply(`Anti-delete status: ${current ? 'ON' : 'OFF'}\nDelivery: ${botNumber || sender}`);
});

module.exports = {
    handleAntidelete,
    rememberMessages,
    getAntideleteStatus,
    setAntideleteStatus
};