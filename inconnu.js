const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    jidNormalizedUser,
    Browsers,
    DisconnectReason,
    jidDecode,
    downloadContentFromMessage,
    getContentType,
} = require('@whiskeysockets/baileys');

const config = require('./config');
const { groupEvents } = require('./lib/groupEvents');
const events = require('./inconnuboy');
const { sms } = require('./lib/msg');
const {
    connectdb,
    getUserConfigFromMongoDB,
    updateUserConfigInMongoDB,
    saveOTPToMongoDB,
    verifyOTPFromMongoDB,
    incrementStats,
    getStatsForNumber
} = require('./lib/database');
const { handleAntidelete } = require('./lib/antidelete');

const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const pino = require('pino');
const crypto = require('crypto');
const FileType = require('file-type');
const axios = require('axios');
const moment = require('moment-timezone');

const prefix = config.PREFIX;
const mode = config.MODE || config.WORK_TYPE;
const router = express.Router();


connectdb();

const activeSockets = new Map();
const socketCreationTime = new Map();


function createInconnuboyStore() {
    const store = {
        messages: {},
        bind(ev) {
            ev.on('messages.upsert', ({ messages }) => {
                for (const msg of messages) {
                    const jid = msg.key && msg.key.remoteJid;
                    if (!jid) continue;
                    if (!store.messages[jid]) store.messages[jid] = [];
                    store.messages[jid].push(msg);
                    if (store.messages[jid].length > 200) store.messages[jid].shift();
                }
            });
        },
        async loadMessage(jid, id) {
            if (!store.messages[jid]) return null;
            return store.messages[jid].find(m => m.key && m.key.id === id) || null;
        }
    };
    return store;
}

// Utility functions
const createSerial = (size) => crypto.randomBytes(size).toString('hex').slice(0, size);

const getGroupAdmins = (participants) => {
    let admins = [];
    for (let i of participants) {
        if (i.admin == null) continue;
        admins.push(i.id);
    }
    return admins;
};

function isNumberAlreadyConnected(number) {
    return activeSockets.has(number.replace(/[^0-9]/g, ''));
}

async function resetPairingState(number) {
    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const socket = activeSockets.get(sanitizedNumber);

    if (socket) {
        try {
            socket.ev.removeAllListeners();
            await Promise.resolve(socket.ws?.close());
        } catch (error) {
            inconnuboyLog(`Previous socket cleanup warning for ${sanitizedNumber}: ${error.message}`, 'warning');
        }
        activeSockets.delete(sanitizedNumber);
        socketCreationTime.delete(sanitizedNumber);
    }

    const sessionPath = path.join(__dirname, 'session', `session_${sanitizedNumber}`);
    if (fs.existsSync(sessionPath)) {
        await fs.remove(sessionPath);
    }
    inconnuboyLog(`♻️ Fresh pairing state ready for ${sanitizedNumber}`, 'info');
}

function getConnectionStatus(number) {
    const n = number.replace(/[^0-9]/g, '');
    const isConnected = activeSockets.has(n);
    const connectionTime = socketCreationTime.get(n);
    return {
        isConnected,
        connectionTime: connectionTime ? new Date(connectionTime).toLocaleString() : null,
        uptime: connectionTime ? Math.floor((Date.now() - connectionTime) / 1000) : 0
    };
}

function getDisconnectStatus(lastDisconnect) {
    const error = lastDisconnect && lastDisconnect.error;
    return error && (
        error.output?.statusCode ||
        error.data?.statusCode ||
        error.statusCode
    );
}

// Pairing codes are requested once the underlying WebSocket is open. Waiting
// for `connection === "open"` is too late for an unregistered socket: Baileys
// normally emits that event only after the phone has completed the link flow.
function waitForSocketReady(socket, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
        let settled = false;
        let pollTimer;
        const finish = (callback, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            clearInterval(pollTimer);
            socket.ev.off('connection.update', onUpdate);
            callback(value);
        };
        const onUpdate = (update) => {
            if (socket.ws?.readyState === 1 || update.isOnline === true) {
                finish(resolve);
                return;
            }
            if (update.connection === 'close') {
                const status = getDisconnectStatus(update.lastDisconnect);
                finish(reject, new Error(`WhatsApp socket closed before the pairing code was issued${status ? ` (${status})` : ''}`));
            }
        };
        const timeout = setTimeout(() => {
            finish(reject, new Error('WhatsApp socket did not become ready in time'));
        }, timeoutMs);
        pollTimer = setInterval(() => {
            if (socket.ws?.readyState === 1) finish(resolve);
        }, 100);
        socket.ev.on('connection.update', onUpdate);
        if (socket.ws?.readyState === 1) finish(resolve);
    });
}

function inconnuboyLog(message, type = 'info') {
    const icons = { info: '📝', success: '✅', error: '❌', warning: '⚠️', debug: '🐛' };
    console.log(`${icons[type] || '📝'} [MUZAMIL-XD] ${new Date().toISOString()}: ${message}`);
}

function hasRegisteredCredentials(number) {
    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const credsPath = path.join(__dirname, 'session', `session_${sanitizedNumber}`, 'creds.json');
    try {
        if (!fs.existsSync(credsPath)) return false;
        const raw = fs.readFileSync(credsPath, 'utf8');
        if (!raw.trim()) return false;
        const creds = JSON.parse(raw);
        return creds.registered === true && !!creds.me;
    } catch (_) {
        return false;
    }
}

// Load Plugins
const pluginsDir = path.join(__dirname, 'plugins');
if (!fs.existsSync(pluginsDir)) fs.mkdirSync(pluginsDir, { recursive: true });
const pluginFiles = fs.readdirSync(pluginsDir).filter(f => f.endsWith('.js'));
inconnuboyLog(`Loading ${pluginFiles.length} plugins...`, 'info');
for (const file of pluginFiles) {
    try { require(path.join(pluginsDir, file)); }
    catch (e) { inconnuboyLog(`Failed to load plugin ${file}: ${e.message}`, 'error'); }
}


async function setupCallHandlers(socket, number) {
    socket.ev.on('call', async (calls) => {
        try {
            const userConfig = await getUserConfigFromMongoDB(number);
            if (userConfig.ANTI_CALL !== 'true') return;
            for (const call of calls) {
                if (call.status !== 'offer') continue;
                await socket.rejectCall(call.id, call.from);
                await socket.sendMessage(call.from, {
                    text: userConfig.REJECT_MSG || config.REJECT_MSG
                });
                inconnuboyLog(`Auto-rejected call for ${number} from ${call.from}`, 'info');
            }
        } catch (err) {
            inconnuboyLog(`Anti-call error for ${number}: ${err.message}`, 'error');
        }
    });
}

function setupAutoRestart(socket, number, authState = null) {
    let restartAttempts = 0;
    const maxRestartAttempts = 3;

    socket.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const statusCode = getDisconnectStatus(lastDisconnect);
            const errorMessage = lastDisconnect && lastDisconnect.error && lastDisconnect.error.message;
            inconnuboyLog(`Connection closed for ${number}: ${statusCode} - ${errorMessage}`, 'warning');

            if (statusCode === 401 || (errorMessage && errorMessage.includes('401'))) {
                inconnuboyLog(`Manual unlink detected for ${number}, cleaning up...`, 'warning');
                const sanitizedNumber = number.replace(/[^0-9]/g, '');
                activeSockets.delete(sanitizedNumber);
                socketCreationTime.delete(sanitizedNumber);
                socket.ev.removeAllListeners();
                return;
            }

            const isNormalError = statusCode === 408 || (errorMessage && errorMessage.includes('QR refs attempts ended'));
            if (isNormalError) { inconnuboyLog(`Normal closure for ${number}, no restart needed.`, 'info'); return; }

            // A 515/restart-required close is part of the normal pairing
            // handshake. Once creds.update has persisted registered credentials,
            // reconnect with the same auth folder instead of deleting it. The
            // old code deleted that folder while WhatsApp was still finishing
            // login, which left the phone stuck on "Logging in...".
            const registeredCredentials = Boolean(
                socket.user ||
                authState?.creds?.registered ||
                hasRegisteredCredentials(number)
            );
            if (!registeredCredentials) {
                const sanitizedNumber = number.replace(/[^0-9]/g, '');
                if (activeSockets.get(sanitizedNumber) === socket) {
                    activeSockets.delete(sanitizedNumber);
                    socketCreationTime.delete(sanitizedNumber);
                }
                const sessionPath = path.join(__dirname, 'session', `session_${sanitizedNumber}`);
                await fs.remove(sessionPath).catch(() => {});
                inconnuboyLog(`Pairing socket closed before login for ${number}; generate a fresh code.`, 'warning');
                return;
            }

            if (restartAttempts < maxRestartAttempts) {
                restartAttempts++;
                inconnuboyLog(`Reconnecting ${number} (${restartAttempts}/${maxRestartAttempts}) in 10s...`, 'warning');
                const sanitizedNumber = number.replace(/[^0-9]/g, '');
                if (activeSockets.get(sanitizedNumber) === socket) {
                    activeSockets.delete(sanitizedNumber);
                    socketCreationTime.delete(sanitizedNumber);
                }
                socket.ev.removeAllListeners();
                await delay(10000);
                try {
                    await inconnuboyPair(number, null, { reconnect: true });
                } catch (e) { inconnuboyLog(`Reconnection failed for ${number}: ${e.message}`, 'error'); }
            } else {
                inconnuboyLog(`Max restart attempts reached for ${number}.`, 'error');
            }
        }
        if (connection === 'open') { restartAttempts = 0; }
    });
}


async function inconnuboyPair(number, res = null, { reconnect = false } = {}) {
    let connectionLockKey;
    const sanitizedNumber = number.replace(/[^0-9]/g, '');

    try {
        if (!/^\d{10,15}$/.test(sanitizedNumber)) {
            if (res && !res.headersSent) {
                return res.status(400).json({
                    success: false,
                    status: 'invalid_number',
                    error: 'Use a valid WhatsApp number with country code (10 to 15 digits).'
                });
            }
            return;
        }

        const sessionPath = path.join(__dirname, 'session', `session_${sanitizedNumber}`);

        connectionLockKey = `inconnuboy_lock_${sanitizedNumber}`;
        if (global[connectionLockKey]) {
            if (res && !res.headersSent) return res.status(409).json({ success: false, status: 'connection_in_progress', message: 'A pairing request is already being prepared for this number.' });
            return;
        }
        global[connectionLockKey] = true;

        if (!reconnect) {
            await resetPairingState(sanitizedNumber);
        } else if (isNumberAlreadyConnected(sanitizedNumber)) {
            return;
        }

        // A new browser request starts clean, but an automatic reconnect must
        // keep the auth folder written by creds.update. Removing it here
        // invalidated the newly accepted pairing code before the handshake
        // could finish.
        if (!reconnect && fs.existsSync(sessionPath)) {
            await fs.remove(sessionPath);
            inconnuboyLog(`Cleaned leftover local session for ${sanitizedNumber}`, 'info');
        }

        const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
        const logger = pino({ level: process.env.NODE_ENV === 'production' ? 'fatal' : 'debug' });

        const inconnuboyStore = createInconnuboyStore();

        const conn = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger),
            },
            printQRInTerminal: false,
            logger: pino({ level: "silent" }),
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 0,
            keepAliveIntervalMs: 10000,
            emitOwnEvents: true,
            fireInitQueries: true,
            generateHighQualityLinkPreview: true,
            syncFullHistory: false,
            markOnlineOnConnect: false,
            browser: Browsers.macOS('Safari'),
            getMessage: async (key) => {
                const msg = await inconnuboyStore.loadMessage(key.remoteJid, key.id);
                return msg && msg.message ? msg.message : { conversation: 'MUZAMIL-XD' };
            }
        });

        socketCreationTime.set(sanitizedNumber, Date.now());
        activeSockets.set(sanitizedNumber, conn);
        inconnuboyStore.bind(conn.ev);

        // Attach this before requesting the code. During pairing Baileys can
        // emit several creds.update events immediately after the request, and
        // missing those events leaves WhatsApp accepting the code but unable
        // to complete the login handshake.
        let credsSaveInFlight = Promise.resolve();
        conn.ev.on('creds.update', () => {
            credsSaveInFlight = credsSaveInFlight
                .then(() => saveCreds())
                .catch(error => {
                    inconnuboyLog(`Temporary auth state save failed for ${sanitizedNumber}: ${error.message}`, 'error');
                });
            return credsSaveInFlight;
        });

        // Setup handlers
        setupCallHandlers(conn, number);
        setupAutoRestart(conn, number, state);

        // decodeJid utility
        conn.decodeJid = jid => {
            if (!jid) return jid;
            if (/:\d+@/gi.test(jid)) {
                const decode = jidDecode(jid) || {};
                return (decode.user && decode.server && decode.user + '@' + decode.server) || jid;
            }
            return jid;
        };

        conn.downloadAndSaveMediaMessage = async (message, filename, attachExtension = true) => {
            const quoted = message.msg ? message.msg : message;
            const mime = (message.msg || message).mimetype || '';
            const messageType = message.mtype ? message.mtype.replace(/Message/gi, '') : mime.split('/')[0];
            const stream = await downloadContentFromMessage(quoted, messageType);
            let buffer = Buffer.from([]);
            for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
            const type = await FileType.fromBuffer(buffer);
            const trueFileName = attachExtension ? (filename + '.' + type.ext) : filename;
            await fs.writeFileSync(trueFileName, buffer);
            return trueFileName;
        };

        // Pairing Code
        const isRegistered = Boolean(conn.authState?.creds?.registered || state.creds.registered);
        if (!isRegistered) {
            inconnuboyLog(`🔐 Starting NEW pairing process for ${sanitizedNumber}`, 'info');
            try {
                // Baileys needs a live WebSocket before the code is issued, but
                // it must not wait for the post-login `open` event.
                await waitForSocketReady(conn);
                await delay(2500);
                const code = await conn.requestPairingCode(sanitizedNumber);
                inconnuboyLog(`Pairing Code for ${sanitizedNumber}: ${code}`, 'success');
                if (res && !res.headersSent) {
                    res.json({
                        success: true,
                        status: 'pairing_pending',
                        code,
                        number: sanitizedNumber,
                        message: 'Enter this code in WhatsApp > Linked devices > Link a device.',
                        repeatable: true,
                        sessionPersistence: false
                    });
                }
            } catch (error) {
                inconnuboyLog(`Failed to request pairing code: ${error.message}`, 'error');
                await resetPairingState(sanitizedNumber);
                if (res && !res.headersSent) {
                    res.status(500).send({ error: 'Failed to get pairing code', status: 'error', message: error.message });
                }
                throw error;
            }
        } else if (!reconnect) {
            inconnuboyLog(`Unexpected registered auth state for fresh pairing ${sanitizedNumber}`, 'warning');
            await resetPairingState(sanitizedNumber);
            if (res && !res.headersSent) {
                return res.status(409).json({ success: false, status: 'fresh_pairing_required', message: 'Fresh pairing state could not be prepared.' });
            }
            return;
        } else {
            inconnuboyLog(`♻️ Reconnected with saved auth for ${sanitizedNumber}`, 'info');
        }

        // Anti-delete
        conn.ev.on('messages.update', async (updates) => {
            await handleAntidelete(conn, updates, inconnuboyStore);
        });

        // Connection update
        conn.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;
            if (connection === 'open') {
                inconnuboyLog(`Connected: ${sanitizedNumber}`, 'success');
                const userJid = jidNormalizedUser(conn.user.id);
                await conn.sendMessage(userJid, {
                    image: { url: config.IMAGE_PATH },
                    caption: `\n╭────────────────────◇\n│✦ *_MUZAMIL-XD_ — CONNECTED* 🔥\n│✦ Type *${prefix}menu* to see all commands 💫\n│✦ Prefix 『 ${prefix} 』  Mode 〔${mode}〕\n╰────────────────────○\n*© POWERED BY _MUZAMIL-XD_ • Muzamil Khan*`
                });
            }
            if (connection === 'close') {
                const reason = getDisconnectStatus(lastDisconnect);
                if (reason === DisconnectReason.loggedOut) inconnuboyLog(`Session logged out.`, 'error');
            }
        });


        conn.ev.on('messages.upsert', async (msg) => {
            try {
                let mek = msg.messages[0];
                if (!mek.message) return;

                const userConfig = await getUserConfigFromMongoDB(number);

                mek.message = (getContentType(mek.message) === 'ephemeralMessage')
                    ? mek.message.ephemeralMessage.message
                    : mek.message;

                if (userConfig.READ_MESSAGE === 'true') await conn.readMessages([mek.key]);

                // Newsletter reactions
                const newsletterJids = ['120363408959647312@newsletter'];
                const newsEmojis = ['❤️', '👍', '😮', '😎', '💀', '💫', '🔥', '👑'];
                if (mek.key && newsletterJids.includes(mek.key.remotelid)) {
                    try {
                        const serverId = mek.newsletterServerId;
                        if (serverId) {
                            const emoji = newsEmojis[Math.floor(Math.random() * newsEmojis.length)];
                            await conn.newsletterReactMessage(mek.key.remotelid, serverId.toString(), emoji);
                        }
                    } catch (_) {}
                }
                // ================= GROUP WELCOME / GOODBYE =================
conn.ev.on('group-participants.update', async (update) => {
    await groupEvents(conn, update);
});

                // Status handling
                if (mek.key && mek.key.remoteJid === 'status@broadcast') {
                    if (userConfig.AUTO_VIEW_STATUS === 'true') await conn.readMessages([mek.key]);
                    if (userConfig.AUTO_LIKE_STATUS === 'true') {
                        const botJid = await conn.decodeJid(conn.user.id);
                        const emojis = userConfig.AUTO_LIKE_EMOJI || config.AUTO_LIKE_EMOJI;
                        const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
                        await conn.sendMessage(mek.key.remoteJid, { react: { text: randomEmoji, key: mek.key } }, { statusJidList: [mek.key.participant, botJid] });
                    }
                    if (userConfig.AUTO_STATUS_REPLY === 'true') {
                        const user = mek.key.participant;
                        await conn.sendMessage(user, { text: userConfig.AUTO_STATUS_MSG || config.AUTO_STATUS_MSG }, { quoted: mek });
                    }
                    return;
                }

                const m = sms(conn, mek);
                const type = getContentType(mek.message);
                const from = mek.key.remoteJid;
                const body = (type === 'conversation') ? mek.message.conversation
                    : (type === 'extendedTextMessage') ? mek.message.extendedTextMessage.text : '';

                const isCmd = body.startsWith(config.PREFIX);
                const command = isCmd ? body.slice(config.PREFIX.length).trim().split(' ').shift().toLowerCase() : '';
                const args = body.trim().split(/ +/).slice(1);
                const q = args.join(' ');
                const text = q;
                const isGroup = from.endsWith('@g.us');

                const sender = mek.key.fromMe
                    ? (conn.user.id.split(':')[0] + '@s.whatsapp.net')
                    : (mek.key.participant || mek.key.remoteJid);
                const senderNumber = sender.split('@')[0];
                const botNumber = conn.user.id.split(':')[0];
                const botNumber2 = await jidNormalizedUser(conn.user.id);
                const pushname = mek.pushName || 'User';

                const isMe = botNumber.includes(senderNumber);
                const isOwner = config.OWNER_NUMBER.includes(senderNumber) || isMe;
                const isCreator = isOwner;

                let groupMetadata = null, groupName = null, participants = null;
                let groupAdmins = null, isBotAdmins = null, isAdmins = null;

                if (isGroup) {
                    try {
                        groupMetadata = await conn.groupMetadata(from);
                        groupName = groupMetadata.subject;
                        participants = groupMetadata.participants;
                        groupAdmins = getGroupAdmins(participants);
                        isBotAdmins = groupAdmins.includes(botNumber2);
                        isAdmins = groupAdmins.includes(sender);
                    } catch (_) {}
                }

                if (userConfig.AUTO_TYPING === 'true') await conn.sendPresenceUpdate('composing', from);
                if (userConfig.AUTO_RECORDING === 'true') await conn.sendPresenceUpdate('recording', from);

                const myquoted = {
                    key: { remoteJid: 'status@broadcast', participant: '13135550002@s.whatsapp.net', fromMe: false, id: createSerial(16).toUpperCase() },
                    message: { contactMessage: {
                        displayName: '© MUZAMIL-XD • Muzamil Khan',
                        vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:Muzamil Khan\nORG:MUZAMIL-XD;\nTEL;type=CELL;type=VOICE;waid=923433740855:923433740855\nEND:VCARD`,
                        contextInfo: { stanzaId: createSerial(16).toUpperCase(), participant: '0@s.whatsapp.net', quotedMessage: { conversation: '© MUZAMIL-XD' } }
                    }},
                    messageTimestamp: Math.floor(Date.now() / 1000),
                    status: 1, verifiedBizName: 'Meta'
                };

                const reply = (text) => conn.sendMessage(from, { text }, { quoted: myquoted });
                const l = reply;

                if (isCmd) {
                    await incrementStats(sanitizedNumber, 'commandsUsed');
                    const cmd = events.commands.find(c => c.pattern === command) || events.commands.find(c => c.alias && c.alias.includes(command));
                    if (cmd) {
                        if (config.WORK_TYPE === 'private' && !isOwner) return;
                        if (cmd.react) conn.sendMessage(from, { react: { text: cmd.react, key: mek.key } });
                        try {
                            cmd.function(conn, mek, m, { from, quoted: mek, body, isCmd, command, args, q, text, isGroup, sender, senderNumber, botNumber2, botNumber, pushname, isMe, isOwner, isCreator, groupMetadata, groupName, participants, groupAdmins, isBotAdmins, isAdmins, reply, config, myquoted });
                        } catch (e) { inconnuboyLog(`PLUGIN ERROR [${command}]: ${e.message}`, 'error'); }
                    }
                }

                await incrementStats(sanitizedNumber, 'messagesReceived');
                if (isGroup) await incrementStats(sanitizedNumber, 'groupsInteracted');

                events.commands.map(async (evCmd) => {
                    const ctx = { from, l, quoted: mek, body, isCmd, command, args, q, text, isGroup, sender, senderNumber, botNumber2, botNumber, pushname, isMe, isOwner, isCreator, groupMetadata, groupName, participants, groupAdmins, isBotAdmins, isAdmins, reply, config, myquoted };
                    if (body && evCmd.on === 'body') evCmd.function(conn, mek, m, ctx);
                    else if (mek.q && evCmd.on === 'text') evCmd.function(conn, mek, m, ctx);
                    else if ((evCmd.on === 'image' || evCmd.on === 'photo') && mek.type === 'imageMessage') evCmd.function(conn, mek, m, ctx);
                    else if (evCmd.on === 'sticker' && mek.type === 'stickerMessage') evCmd.function(conn, mek, m, ctx);
                });

            } catch (e) { inconnuboyLog(`Message handler error: ${e.message}`, 'error'); }
        });

    } catch (err) {
        inconnuboyLog(`inconnuboyPair error: ${err.message}`, 'error');
        if (res && !res.headersSent) return res.json({ error: 'Internal Server Error', details: err.message });
    } finally {
        if (connectionLockKey) global[connectionLockKey] = false;
    }
}


router.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

async function handlePairingApi(req, res) {
    const number = req.params.number || req.query.number;
    if (!number) {
        return res.status(400).json({
            success: false,
            status: 'invalid_request',
            error: 'Number is required.'
        });
    }

    // Every API pairing request starts a fresh socket. Pairing credentials are
    // not persisted, so the same number can request another code later.
    return inconnuboyPair(number, res);
}

// Browser-friendly API format:
// GET /generatepaircode=923433740855
// GET /generatepaircode/923433740855
// GET /code?number=923433740855 (legacy compatibility)
router.get('/generatepaircode=:number', handlePairingApi);
router.get('/generatepaircode/:number', handlePairingApi);
router.get('/code', handlePairingApi);
router.get('/status', async (req, res) => {
    const { number } = req.query;
    if (!number) {
        const list = Array.from(activeSockets.keys()).map(n => { const s = getConnectionStatus(n); return { number: n, status: 'connected', connectionTime: s.connectionTime, uptime: `${s.uptime} seconds` }; });
        return res.json({ totalActive: activeSockets.size, connections: list });
    }
    const s = getConnectionStatus(number);
    res.json({ number, isConnected: s.isConnected, connectionTime: s.connectionTime, uptime: `${s.uptime} seconds` });
});
router.get('/disconnect', async (req, res) => {
    const { number } = req.query;
    if (!number) return res.status(400).json({ error: 'Number required' });
    const n = number.replace(/[^0-9]/g, '');
    if (!activeSockets.has(n)) return res.status(404).json({ error: 'Not found' });
    try {
        const socket = activeSockets.get(n);
        await socket.ws.close(); socket.ev.removeAllListeners();
        activeSockets.delete(n); socketCreationTime.delete(n);
        res.json({ status: 'success', message: 'Disconnected' });
    } catch (e) { res.status(500).json({ error: 'Failed to disconnect' }); }
});
router.get('/active', (req, res) => res.json({ count: activeSockets.size, numbers: Array.from(activeSockets.keys()) }));
router.get('/ping', (req, res) => res.json({ status: 'active', message: 'MUZAMIL-XD is running', activeSessions: activeSockets.size }));
router.get('/update-config', async (req, res) => {
    const { number, config: configString } = req.query;
    if (!number || !configString) return res.status(400).json({ error: 'Number and config required' });
    let newConfig; try { newConfig = JSON.parse(configString); } catch (_) { return res.status(400).json({ error: 'Invalid config' }); }
    const n = number.replace(/[^0-9]/g, '');
    const socket = activeSockets.get(n);
    if (!socket) return res.status(404).json({ error: 'No active session' });
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    await saveOTPToMongoDB(n, otp, newConfig);
    try {
        await socket.sendMessage(jidNormalizedUser(socket.user.id), { text: `*🔐 MUZAMIL-XD — CONFIG UPDATE*\n\nOTP: *${otp}*\nValid 5 minutes` });
        res.json({ status: 'otp_sent' });
    } catch (e) { res.status(500).json({ error: 'Failed to send OTP' }); }
});
router.get('/verify-otp', async (req, res) => {
    const { number, otp } = req.query;
    if (!number || !otp) return res.status(400).json({ error: 'Number and OTP required' });
    const n = number.replace(/[^0-9]/g, '');
    const verification = await verifyOTPFromMongoDB(n, otp);
    if (!verification.valid) return res.status(400).json({ error: verification.error });
    await updateUserConfigInMongoDB(n, verification.config);
    const socket = activeSockets.get(n);
    if (socket) await socket.sendMessage(jidNormalizedUser(socket.user.id), { text: '*✅ CONFIG UPDATED*' });
    res.json({ status: 'success' });
});
router.get('/stats', async (req, res) => {
    const { number } = req.query;
    if (!number) return res.status(400).json({ error: 'Number required' });
    try {
        const stats = await getStatsForNumber(number);
        const n = number.replace(/[^0-9]/g, '');
        const s = getConnectionStatus(n);
        res.json({ number: n, connectionStatus: s.isConnected ? 'Connected' : 'Disconnected', uptime: s.uptime, stats });
    } catch (e) { res.status(500).json({ error: 'Failed' }); }
});



function cleanupLocalAuthState() {
    activeSockets.forEach((socket, number) => {
        try { socket.ws.close(); } catch (_) {}
        activeSockets.delete(number); socketCreationTime.delete(number);
    });
    const sessionDir = path.join(__dirname, 'session');
    if (fs.existsSync(sessionDir)) fs.emptyDirSync(sessionDir);
}

process.on('exit', cleanupLocalAuthState);
process.on('SIGINT', () => {
    cleanupLocalAuthState();
    process.exit(0);
});
process.on('SIGTERM', () => {
    cleanupLocalAuthState();
    process.exit(0);
});

process.on('uncaughtException', (err) => {
    inconnuboyLog(`Uncaught exception: ${err.message}`, 'error');
});

module.exports = router;
