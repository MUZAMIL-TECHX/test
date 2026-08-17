// Adapter between the 7x anti-delete implementation and this bot's
// cmd(...) plugin/event architecture.
'use strict';

const { cmd } = require('../arslan');
const ultra = require('./antidelete-ultra');

cmd({
    pattern: ultra.command,
    alias: ultra.aliases,
    desc: ultra.description,
    usage: ultra.usage,
    category: ultra.category,
    ownerOnly: true,
    react: '🛡️',
    filename: __filename
}, async (conn, mek, m, { args, from }) => {
    return ultra.handler(conn, mek, args, { chatId: from });
});

async function rememberMessages(messages, botNumber, conn) {
    for (const message of Array.isArray(messages) ? messages : [messages]) {
        await ultra.storeMessage(conn, message);
    }
    return true;
}

async function handleAntidelete(conn, updates) {
    for (const update of Array.isArray(updates) ? updates : [updates]) {
        await ultra.handleMessageRevocation(conn, update);
    }
    return true;
}

module.exports = {
    handleAntidelete,
    rememberMessages,
    getAntideleteStatus: ultra.loadAntideleteConfig,
    setAntideleteStatus: async (_botNumber, enabled) => {
        const current = await ultra.loadAntideleteConfig();
        current.enabled = Boolean(enabled);
        await ultra.saveAntideleteConfig(current);
        return current.enabled;
    }
};