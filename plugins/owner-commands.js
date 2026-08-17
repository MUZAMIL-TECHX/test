const { cmd } = require('../arslan');
const {
    addSudoNumber,
    removeSudoNumber,
    listSudoNumbers
} = require('../lib/owner-state');

cmd({
    pattern: 'ownerinfo',
    alias: ['ownerstatus', 'ownercheck'],
    desc: 'Show owner permission status',
    category: 'owner',
    ownerOnly: true,
    react: '👑',
    filename: __filename
}, async (conn, mek, m, { reply, isOwner, isRealOwner, sender, botNumber }) => {
    return reply(
        `👑 *Owner Permission Status*\n\n` +
        `🔐 Access: ${isOwner ? '✅ Granted' : '❌ Denied'}\n` +
        `⭐ Real owner: ${isRealOwner ? '✅ Yes' : '❌ No'}\n` +
        `👤 Sender: ${sender}\n` +
        `🤖 Bot number: ${botNumber || 'unknown'}`
    );
});

cmd({
    pattern: 'sudo',
    alias: ['addsudo', 'delsudo', 'listsudo'],
    desc: 'Manage trusted sudo users',
    category: 'owner',
    ownerOnly: true,
    strictOwner: true,
    react: '🔐',
    filename: __filename
}, async (conn, mek, m, { args, reply }) => {
    const action = String(args[0] || '').toLowerCase();
    const target = args[1];

    if (action === 'list' || action === 'show' || !action) {
        const users = listSudoNumbers();
        return reply(
            `🔐 *Sudo Users*\n\n` +
            (users.length ? users.map((number, index) => `${index + 1}. ${number}`).join('\n') : 'No sudo users added.') +
            `\n\nUsage: .sudo add 923xxxxxxxxx\n.sudo del 923xxxxxxxxx`
        );
    }

    if (action === 'add' || action === 'set') {
        if (!addSudoNumber(target)) return reply('❌ Valid phone number required.');
        return reply(`✅ Sudo access granted to ${String(target).replace(/\D/g, '')}.`);
    }

    if (action === 'del' || action === 'remove' || action === 'delete') {
        if (!removeSudoNumber(target)) return reply('ℹ️ This number is not in the sudo list.');
        return reply(`✅ Sudo access removed from ${String(target || '').replace(/\D/g, '')}.`);
    }

    return reply('Usage: .sudo add/del/list <phone-number>');
});

cmd({
    pattern: 'monitor',
    alias: ['system', 'health', 'botstatus'],
    desc: 'Show bot health and connection status',
    category: 'owner',
    ownerOnly: true,
    react: '📊',
    filename: __filename
}, async (conn, mek, m, { reply, botNumber }) => {
    return reply(
        `📊 *Bot Monitor*\n\n` +
        `✅ Process: online\n` +
        `⏱️ Uptime: ${Math.floor(process.uptime())} seconds\n` +
        `🧠 Memory: ${Math.round(process.memoryUsage().rss / 1024 / 1024)} MB\n` +
        `🤖 Session: ${botNumber || 'unknown'}`
    );
});

cmd({
    pattern: 'gcleave',
    alias: ['leavegroup'],
    desc: 'Leave the current group',
    category: 'owner',
    ownerOnly: true,
    react: '🚪',
    filename: __filename
}, async (conn, mek, m, { from, isGroup, reply }) => {
    if (!isGroup) return reply('❌ This command only works inside a group.');
    await reply('🚪 Leaving this group...');
    return conn.groupLeave(from);
});

cmd({
    pattern: 'pinchat',
    alias: ['pin', 'unpinchat'],
    desc: 'Pin or unpin the current chat',
    category: 'owner',
    ownerOnly: true,
    react: '📌',
    filename: __filename
}, async (conn, mek, m, { from, args, reply }) => {
    if (typeof conn.chatModify !== 'function') {
        return reply('❌ This Baileys version does not support chat pinning.');
    }
    const action = String(args[0] || 'on').toLowerCase();
    const pin = !['off', 'false', 'unpin'].includes(action);
    await conn.chatModify({ pin }, from);
    return reply(pin ? '✅ Chat pinned.' : '✅ Chat unpinned.');
});

cmd({
    pattern: 'statuspost',
    alias: ['status'],
    desc: 'Post text to WhatsApp status',
    category: 'owner',
    ownerOnly: true,
    react: '📢',
    filename: __filename
}, async (conn, mek, m, { q, reply }) => {
    if (!q) return reply('Usage: .statuspost your status text');
    await conn.sendMessage('status@broadcast', { text: q });
    return reply('✅ Status posted.');
});