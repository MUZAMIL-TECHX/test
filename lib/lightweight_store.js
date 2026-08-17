'use strict';

const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, '..', 'data', 'runtime-settings.json');

function readStore() {
    try {
        if (!fs.existsSync(STORE_PATH)) return {};
        const value = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
        return value && typeof value === 'object' ? value : {};
    } catch {
        return {};
    }
}

function writeStore(value) {
    fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
    const tempPath = `${STORE_PATH}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(value, null, 2));
    fs.renameSync(tempPath, STORE_PATH);
}

async function getSetting(namespace, key) {
    return readStore()?.[namespace]?.[key] ?? null;
}

async function saveSetting(namespace, key, value) {
    const store = readStore();
    if (!store[namespace] || typeof store[namespace] !== 'object') store[namespace] = {};
    store[namespace][key] = value;
    writeStore(store);
    return value;
}

module.exports = { getSetting, saveSetting };