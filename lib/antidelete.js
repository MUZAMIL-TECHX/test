// lib/antidelete.js
const { getContentType } = require('@whiskeysockets/baileys');
const config = require('../config');

const REVOKE_TYPE = 0;

function cleanNumber(value) {
    return String(value || '').replace(/\D/g, '');
}

function getOwnerJids(botNumber) {
    const configuredOwners = Array.isArray(config.OWNER_NUMBER)
        ? config.OWNER_NUMBER
        : String(config.OWNER_NUMBER || '').split(',');
    const numbers = configuredOwners.map(cleanNumber).filter(Boolean);

    // A connected bot account is the safest fallback when OWNER_NUMBER was
    // omitted or was left empty in the deployment environment.
    if (!numbers.length && botNumber) numbers.push(cleanNumber(botNumber));

    return [...new Set(numbers.filter(Boolean))]
        .map(number => `${number}@s.whatsapp.net`);
}

function getProtocolMessage(update) {
    const message = update?.update?.message || update?.message;
    if (!message) return null;

    // Delete notifications are normally at message.protocolMessage. The
    // small unwrap loop also handles updates wrapped by ephemeral messages.
    let current = message;
    for (let depth = 0; current && depth < 4; depth += 1) {
        if (current.protocolMessage) return current.protocolMessage;
        const type = safeContentType(current);
        if (!type || !current[type] || typeof current[type] !== 'object') break;
        current = current[type].message || current[type];
    }
    return null;
}

function safeContentType(message) {
    try {
        return getContentType(message);
    } catch {
        return null;
    }
}

function unwrapMessage(message) {
    let current = message;
    for (let depth = 0; current && depth < 5; depth += 1) {
        const type = safeContentType(current);
        if (type === 'ephemeralMessage' && current.ephemeralMessage?.message) {
            current = current.ephemeralMessage.message;
            continue;
        }
        if (type === 'viewOnceMessage' && current.viewOnceMessage?.message) {
            current = current.viewOnceMessage.message;
            continue;
        }
        if (type === 'viewOnceMessageV2' && current.viewOnceMessageV2?.message) {
            current = current.viewOnceMessageV2.message;
            continue;
        }
        break;
    }
    return current || {};
}

function describeMessage(message) {
    const content = unwrapMessage(message);
    const type = safeContentType(content);

    switch (type) {
        case 'conversation':
            return { type, text: content.conversation || '' };
        case 'extendedTextMessage':
            return { type, text: content.extendedTextMessage?.text || '' };
        case 'imageMessage':
            return {
                type,
                text: `🖼️ Image${content.imageMessage?.caption ? `\n📝 Caption: ${content.imageMessage.caption}` : ''}`
            };
        case 'videoMessage':
            return {
                type,
                text: `🎥 Video${content.videoMessage?.caption ? `\n📝 Caption: ${content.videoMessage.caption}` : ''}`
            };
        case 'audioMessage':
            return { type, text: '🎵 Audio' };
        case 'stickerMessage':
            return { type, text: '🎨 Sticker' };
        case 'documentMessage':
            return {
                type,
                text: `📄 Document${content.documentMessage?.fileName ? `\n📁 File: ${content.documentMessage.fileName}` : ''}`
            };
        case 'locationMessage':
            return { type, text: '📍 Location' };
        case 'contactMessage':
            return { type, text: '👤 Contact' };
        case 'buttonsMessage':
            return { type, text: '🔘 Buttons' };
        case 'listMessage':
            return { type, text: '📋 List' };
        default:
            return { type: type || 'unknown', text: '📨 Media/Message' };
    }
}

function isRevoke(protocolMessage) {
    return protocolMessage &&
        (protocolMessage.type === REVOKE_TYPE ||
            protocolMessage.type === String(REVOKE_TYPE) ||
            protocolMessage.type === 'REVOKE');
}

async function handleAntidelete(conn, updates, store, botNumber) {
    try {
        const ownerJids = getOwnerJids(botNumber);
        if (!ownerJids.length) {
            console.error('[ANTIDELETE] No owner number configured and no bot number available');
            return;
        }

        const updateList = Array.isArray(updates) ? updates : [updates];
        for (const update of updateList) {
            const protocolMessage = getProtocolMessage(update);
            if (!isRevoke(protocolMessage)) continue;

            const deletedMessageKey = protocolMessage.key || update?.key;
            if (!deletedMessageKey?.id || !deletedMessageKey?.remoteJid) {
                console.error('[ANTIDELETE] Delete update did not contain the original message key');
                continue;
            }

            const deletedMsg = await store?.loadMessage(
                deletedMessageKey.remoteJid,
                deletedMessageKey.id
            );
            if (!deletedMsg?.message) {
                console.warn(`[ANTIDELETE] Original message not found: ${deletedMessageKey.id}`);
                continue;
            }

            const sender = deletedMsg.key?.participant || deletedMsg.key?.remoteJid || 'unknown';
            const from = deletedMsg.key?.remoteJid || deletedMessageKey.remoteJid;
            const isGroup = from.endsWith('@g.us');
            const description = describeMessage(deletedMsg.message);
            const chatName = isGroup ? await getGroupName(conn, from) : 'Private Chat';
            const senderName = deletedMsg.pushName || sender.split('@')[0];
            const mention = sender.includes('@') ? [sender] : [];

            const antidelMsg =
                `⚠️ *MESSAGE DELETED DETECTED!*\n\n` +
                `📱 *From:* ${senderName}\n` +
                `👤 *Number:* @${sender.split('@')[0]}\n` +
                `💬 *Chat:* ${chatName}\n` +
                `📝 *Message:* ${description.text}\n` +
                `🕐 *Time:* ${new Date().toLocaleString()}\n` +
                `📌 *Type:* ${isGroup ? 'Group' : 'Private'}`;

            for (const ownerJid of ownerJids) {
                try {
                    await conn.sendMessage(ownerJid, {
                        text: antidelMsg,
                        ...(mention.length ? { mentions: mention } : {})
                    });

                    // The notification above contains text/captions. Forward
                    // the original for media, contacts, locations, stickers,
                    // and other rich messages so the owner receives the
                    // deleted content itself, not only a description.
                    if (!['conversation', 'extendedTextMessage'].includes(description.type)) {
                        await conn.sendMessage(ownerJid, {
                            forward: deletedMsg,
                            force: true
                        });
                    }
                    console.log(`[ANTIDELETE] Sent deleted message ${deletedMessageKey.id} to ${ownerJid}`);
                } catch (error) {
                    console.error(`[ANTIDELETE] Failed to send to ${ownerJid}:`, error.message);
                }
            }
        }
    } catch (error) {
        console.error('[ANTIDELETE ERROR]', error);
    }
}

async function getGroupName(conn, jid) {
    try {
        const metadata = await conn.groupMetadata(jid);
        return metadata.subject || 'Unknown Group';
    } catch {
        return 'Unknown Group';
    }
}

module.exports = { handleAntidelete };
