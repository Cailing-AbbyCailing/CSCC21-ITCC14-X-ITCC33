'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAuditLogger, buildAuditRow } = require('../shared/audit');

function mockClient(result = { error: null }) {
    const captured = { table: null, row: null };
    return {
        captured,
        from(table) {
            captured.table = table;
            return {
                insert(row) {
                    captured.row = row;
                    return Promise.resolve(result);
                }
            };
        }
    };
}

function mockLogger() {
    return { errors: [], error(message) { this.errors.push(message); } };
}

test('audit row supplies required entity_type for authentication events', () => {
    const row = buildAuditRow('user-123', 'Successful login', 'authentication', 'Role: customer', new Date('2026-11-26T00:00:00.000Z'));
    assert.equal(row.entity_type, 'user');
    assert.equal(row.module, 'authentication');
    assert.equal(row.user_id, 'user-123');
    assert.equal(row.action, 'Successful login');
});

test('audit row maps business modules to useful entity types', () => {
    assert.equal(buildAuditRow('u1', 'Updated order', 'orders').entity_type, 'order');
    assert.equal(buildAuditRow('u1', 'Verified payment', 'payments').entity_type, 'payment');
    assert.equal(buildAuditRow('u1', 'Updated schedule', 'schedules').entity_type, 'delivery_schedule');
    assert.equal(buildAuditRow('u1', 'Updated service', 'services').entity_type, 'service');
});

test('audit logger inserts entity_type with each audit record', async () => {
    const client = mockClient();
    const logger = mockLogger();
    const writeAuditLog = createAuditLogger(client, logger);
    const result = await writeAuditLog('user-123', 'Successful login', 'authentication', 'Role: customer');

    assert.deepEqual(result, { success: true });
    assert.equal(client.captured.table, 'audit_logs');
    assert.equal(client.captured.row.entity_type, 'user');
    assert.equal(client.captured.row.module, 'authentication');
    assert.equal(logger.errors.length, 0);
});

test('audit logger reports Supabase insert failures without hiding them', async () => {
    const client = mockClient({ error: { message: 'entity_type is required' } });
    const logger = mockLogger();
    const writeAuditLog = createAuditLogger(client, logger);
    const result = await writeAuditLog('user-123', 'Successful login', 'authentication');

    assert.equal(result.success, false);
    assert.equal(result.error, 'entity_type is required');
    assert.equal(logger.errors.length, 1);
});

test('audit row stores order entity_id for status history lookups', () => {
    const orderId = '550e8400-e29b-41d4-a716-446655440000';
    const row = buildAuditRow('user-123', 'Order status changed', 'orders', { order_id: orderId });
    assert.equal(row.entity_type, 'order');
    assert.equal(row.entity_id, orderId);
});

test('audit row stores inventory entity_id for stock movement history', () => {
    const itemId = '550e8400-e29b-41d4-a716-446655440001';
    const row = buildAuditRow('user-123', 'Inventory stock-in', 'inventory', { item_id: itemId });
    assert.equal(row.entity_type, 'inventory');
    assert.equal(row.entity_id, itemId);
});

test('audit row stores notification events using the existing audit_logs schema', () => {
    const orderId = '550e8400-e29b-41d4-a716-446655440002';
    const row = buildAuditRow('550e8400-e29b-41d4-a716-446655440003', 'Laundry ready for pickup', 'notifications', { order_id: orderId, event: 'customer_notification' });
    assert.equal(row.entity_type, 'notification');
    assert.equal(row.entity_id, orderId);
    assert.equal(row.details.event, 'customer_notification');
});
