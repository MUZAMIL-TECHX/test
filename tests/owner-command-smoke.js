const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const arslanPath = path.join(root, 'arslan.js');
const ownerCommandsPath = path.join(root, 'plugins', 'owner-commands.js');
const settingsPath = path.join(root, 'plugins', 'all-settings.js');
const statePath = path.join(root, 'lib', 'owner-state.js');

function loadRegistry(pluginPath, extraModules = {}) {
    const registry = [];
    const originalArslan = require.cache[require.resolve(arslanPath)];
    const originalExtra = new Map();

    require.cache[require.resolve(arslanPath)] = {
        id: arslanPath,
        filename: arslanPath,
        loaded: true,
        exports: {
            commands: registry,
            cmd(info, fn) {
                registry.push({ ...info, function: fn });
            }
        }
    };

    for (const [modulePath, exportsValue] of Object.entries(extraModules)) {
        const resolved = require.resolve(modulePath);
        originalExtra.set(resolved, require.cache[resolved]);
        require.cache[resolved] = {
            id: resolved,
            filename: resolved,
            loaded: true,
            exports: exportsValue
        };
    }

    delete require.cache[require.resolve(pluginPath)];
    require(pluginPath);

    if (originalArslan) require.cache[require.resolve(arslanPath)] = originalArslan;
    else delete require.cache[require.resolve(arslanPath)];
    for (const [resolved, original] of originalExtra.entries()) {
        if (original) require.cache[resolved] = original;
        else delete require.cache[resolved];
    }
    delete require.cache[require.resolve(pluginPath)];
    return registry;
}

(async () => {
const ownerCommands = loadRegistry(ownerCommandsPath);
assert(ownerCommands.length >= 5, 'Owner command bundle did not register');
for (const command of ownerCommands) {
    assert.strictEqual(command.ownerOnly, true, `${command.pattern} is not ownerOnly`);
    assert.ok(command.category === 'owner', `${command.pattern} has the wrong category`);
}

const settings = loadRegistry(settingsPath, {
    [path.join(root, 'lib', 'database.js')]: {
        updateUserConfig: async (number, value) => {
            savedSettings.push({ number, value });
            return true;
        }
    }
});
const savedSettings = [];
const settingsNames = new Set(settings.map(command => command.pattern));
for (const name of ['autotyping', 'anticall', 'setprefix', 'mode']) {
    assert(settingsNames.has(name), `Missing settings command: ${name}`);
}
assert(settings.every(command => command.ownerOnly === true), 'A settings command is not ownerOnly');

const typing = settings.find(command => command.pattern === 'autotyping');
const runtimeConfig = { AUTO_TYPING: 'false' };
await typing.function(null, null, null, {
    args: ['on'],
    isOwner: true,
    botNumber: '923000000000',
    config: runtimeConfig,
    reply: () => {}
});
assert.strictEqual(runtimeConfig.AUTO_TYPING, 'true', 'Autotyping did not update runtime config');
assert.strictEqual(savedSettings.at(-1).value.AUTO_TYPING, 'true', 'Autotyping did not persist');

const antiCall = settings.find(command => command.pattern === 'anticall');
runtimeConfig.ANTI_CALL = 'false';
await antiCall.function(null, null, null, {
    args: ['on'],
    isOwner: true,
    botNumber: '923000000000',
    config: runtimeConfig,
    reply: () => {}
});
assert.strictEqual(runtimeConfig.ANTI_CALL, 'true', 'Anticall did not update runtime config');

const allCommands = [...ownerCommands, ...settings];
const aliases = new Map();
for (const command of allCommands) {
    for (const name of [command.pattern, ...(Array.isArray(command.alias) ? command.alias : [])]) {
        const previous = aliases.get(name);
        assert(!previous, `Duplicate owner/settings command alias: ${name}`);
        aliases.set(name, command.pattern);
    }
}

const state = require(statePath);
const testNumber = '999999999001';
state.removeSudoNumber(testNumber);
assert.strictEqual(state.isSudoNumber(testNumber), false);
assert.strictEqual(state.addSudoNumber(testNumber), true);
assert.strictEqual(state.isSudoNumber(`${testNumber}@s.whatsapp.net`), true);
assert.strictEqual(state.removeSudoNumber(testNumber), true);
assert.strictEqual(state.isSudoNumber(testNumber), false);

const mainSource = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
assert(mainSource.includes('resolveOwnerStatus'), 'Owner resolver is not wired');
assert(mainSource.includes('cmd.ownerOnly || cmd.sudoOnly'), 'Central owner gate is not wired');
assert(mainSource.includes("sendPresenceUpdate('composing'"), 'Auto typing runtime handler is not wired');
assert(mainSource.includes('liveConfig.ANTIDELETE'), 'Database antidelete state is not wired');
assert(!mainSource.includes('registerAntiCall(socket, config)'), 'Duplicate anti-call handler is still wired');

console.log(`owner-command-smoke: PASS (${allCommands.length} owner/settings commands checked)`);
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});