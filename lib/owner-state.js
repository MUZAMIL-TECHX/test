const fs = require('fs');
const path = require('path');

const statePath = path.join(__dirname, '..', 'data', 'sudo.json');

function cleanNumber(value) {
    return String(value || '')
        .split(':')[0]
        .split('@')[0]
        .replace(/\D/g, '');
}

function readState() {
    try {
        if (!fs.existsSync(statePath)) return { numbers: [] };
        const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        const numbers = Array.isArray(parsed)
            ? parsed
            : Array.isArray(parsed.numbers) ? parsed.numbers : [];
        return {
            numbers: [...new Set(numbers.map(cleanNumber).filter(Boolean))]
        };
    } catch {
        return { numbers: [] };
    }
}

function writeState(state) {
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(
        statePath,
        JSON.stringify({ numbers: [...new Set(state.numbers || [])] }, null, 2)
    );
}

function isSudoNumber(value) {
    const number = cleanNumber(value);
    return Boolean(number && readState().numbers.includes(number));
}

function addSudoNumber(value) {
    const number = cleanNumber(value);
    if (!number) return false;
    const state = readState();
    if (!state.numbers.includes(number)) state.numbers.push(number);
    writeState(state);
    return true;
}

function removeSudoNumber(value) {
    const number = cleanNumber(value);
    const state = readState();
    const next = state.numbers.filter(item => item !== number);
    writeState({ numbers: next });
    return next.length !== state.numbers.length;
}

function listSudoNumbers() {
    return readState().numbers;
}

module.exports = {
    cleanNumber,
    isSudoNumber,
    addSudoNumber,
    removeSudoNumber,
    listSudoNumbers
};