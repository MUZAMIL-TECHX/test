const assert = require('assert');
const fs = require('fs');
const Module = require('module');

const root = require('path').join(__dirname, '..');
const events = require(require('path').join(root, 'arslan.js'));
const originalLoad = Module._load;

// The test only needs the anti-delete module's Baileys import to be shaped
// correctly; it does not connect to WhatsApp.
Module._load = function load(request, parent, isMain) {
    if (request === '@whiskeysockets/baileys') {
        return { downloadContentFromMessage: async function* download() {} };
    }
    return originalLoad.call(this, request, parent, isMain);
};

try {
    require(require('path').join(root, 'plugins', 'antilink.js'));
    require(require('path').join(root, 'plugins', 'antidelete.js'));
} finally {
    Module._load = originalLoad;
}

const protection = events.commands.filter(command =>
    ['antilink', 'antidelete'].includes(String(command.pattern).toLowerCase())
);
assert.strictEqual(protection.length, 2, 'Both protection commands must register once');
assert.strictEqual(protection.find(command => command.pattern === 'antidelete').ownerOnly, true);
assert.strictEqual(protection.find(command => command.pattern === 'antilink').category, 'admin');

const antilink = require(require('path').join(root, 'plugins', 'antilink.js'));
assert.strictEqual(antilink.detectLinks('chat[.]whatsapp[.]com/AbCdEfGhIjK', {
    waGroup: true,
    waChannel: true,
    telegram: true,
    discord: true,
    instagram: true,
    tiktok: true,
    allLinks: true,
    shortLinks: true
}).type, 'waGroup');

const mainSource = fs.readFileSync(require('path').join(root, 'main.js'), 'utf8');
assert(mainSource.includes("const allowedOwnerCommands = new Set(['antidelete'])"));
assert(mainSource.includes('events.commands = events.commands.filter'));
assert(mainSource.includes('rememberMessages(msg?.messages || [], getBotNumber(conn), conn)'));
assert(!fs.existsSync(require('path').join(root, 'plugins', 'owner-commands.js')));

console.log('protection-command-smoke: PASS');
process.exit(0);