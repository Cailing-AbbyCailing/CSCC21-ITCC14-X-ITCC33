'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { respondWithDatabaseHealth } = require('../shared/health');

function createResponse() {
    return {
        statusCode: null,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; }
    };
}

function mockSupabase(failingTables = [], failingSelections = []) {
    return {
        from(table) {
            let selection = '*';
            return {
                select(columns) { selection = columns; return this; },
                limit() {
                    const selectionKey = `${table}:${selection}`;
                    const failed = failingTables.includes(table) || failingSelections.includes(selectionKey);
                    return Promise.resolve({ error: failed ? { message: 'table/column unavailable' } : null });
                }
            };
        }
    };
}

test('health endpoint reports healthy only when required Supabase tables are reachable', async () => {
    const response = createResponse();
    await respondWithDatabaseHealth(response, mockSupabase(), 'test-api', ['profiles', 'inventory']);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.status, 'ok');
    assert.deepEqual(response.body.checks, { profiles: 'connected', inventory: 'connected' });
});

test('health endpoint returns 503 when a required Supabase table is unavailable', async () => {
    const response = createResponse();
    await respondWithDatabaseHealth(response, mockSupabase(['audit_logs']), 'test-api', ['audit_logs']);
    assert.equal(response.statusCode, 503);
    assert.equal(response.body.status, 'degraded');
    assert.deepEqual(response.body.checks, { audit_logs: 'unavailable' });
});

test('health endpoint validates required columns when a column list is supplied', async () => {
    const response = createResponse();
    await respondWithDatabaseHealth(
        response,
        mockSupabase([], ['audit_logs:user_id,action,entity_type,module,details,created_at']),
        'analytics-audit-api',
        [{ table: 'audit_logs', columns: 'user_id,action,entity_type,module,details,created_at' }]
    );
    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.body.checks, { audit_logs: 'unavailable' });
});
