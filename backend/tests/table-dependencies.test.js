'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const ALLOWED_TABLES = new Set(['profiles', 'inventory', 'orders', 'payments', 'audit_logs']);
const LEGACY_TABLES = new Set([
    'water_orders', 'laundry_bookings', 'order_payments', 'order_status_history',
    'supply_inventory', 'delivery_schedule_slots', 'customer_notifications', 'chat_messages'
]);

function walk(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) {
    return ['tests', 'node_modules', '.git'].includes(entry.name)
        ? []
        : walk(full);
}
        return entry.isFile() && entry.name.endsWith('.js') ? [full] : [];
    });
}

test('runtime API modules query only the five original public tables', () => {
    const found = new Set();
    const references = [];
    for (const file of walk(ROOT)) {
        const source = fs.readFileSync(file, 'utf8');
        for (const match of source.matchAll(/\.from\(\s*['"]([^'"]+)['"]\s*\)/g)) {
            found.add(match[1]);
            references.push(`${path.relative(ROOT, file)} -> ${match[1]}`);
        }
    }
    const unexpected = [...found].filter(table => !ALLOWED_TABLES.has(table));
    assert.deepEqual(unexpected, [], `Unexpected runtime table queries: ${references.join(', ')}`);
    for (const legacy of LEGACY_TABLES) assert.equal(found.has(legacy), false, `${legacy} must not be queried at runtime`);
});
