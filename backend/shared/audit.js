'use strict';

// Keep entity_type values stable and meaningful for the existing audit_logs schema.
// `module` remains the dashboard grouping field; `entity_type` identifies the kind
// of record affected by the event.
const ENTITY_TYPE_BY_MODULE = Object.freeze({
    authentication: 'user',
    user_management: 'user',
    orders: 'order',
    payments: 'payment',
    schedules: 'delivery_schedule',
    services: 'service',
    inventory: 'inventory',
    notifications: 'notification',
    system: 'system'
});

function normalizeModule(moduleName) {
    return String(moduleName || 'system').trim().toLowerCase() || 'system';
}

function buildAuditRow(userId, action, moduleName = 'system', details = null, now = new Date()) {
    const normalizedAction = String(action || '').trim();
    if (!normalizedAction) return null;

    const module = normalizeModule(moduleName);
    const safeDetails = details == null ? {} : (typeof details === 'object' ? details : { message: String(details) });
    // audit_logs is the original event ledger. Set entity_id as well as details
    // so order-history and inventory-history queries can filter efficiently.
    const entityIdCandidates = module === 'orders'
        ? [safeDetails.entity_id, safeDetails.order_id]
        : module === 'payments'
            ? [safeDetails.entity_id, safeDetails.payment_id, safeDetails.order_id]
            : module === 'inventory'
                ? [safeDetails.entity_id, safeDetails.item_id]
                : module === 'notifications'
                    ? [safeDetails.entity_id, safeDetails.order_id]
                    : [safeDetails.entity_id, safeDetails.user_id];
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const entityId = entityIdCandidates.find(value => typeof value === 'string' && uuidPattern.test(value)) || null;

    return {
        user_id: userId || null,
        action: normalizedAction,
        entity_type: ENTITY_TYPE_BY_MODULE[module] || module,
        entity_id: entityId,
        module,
        details: safeDetails,
        created_at: now.toISOString()
    };
}

function createAuditLogger(client, logger = console) {
    if (!client || typeof client.from !== 'function') {
        throw new TypeError('A Supabase-compatible client is required for audit logging.');
    }

    return async function writeAuditLog(userId, action, moduleName = 'system', details = null) {
        const row = buildAuditRow(userId, action, moduleName, details);
        if (!row) {
            logger.error('[AUDIT] Refusing to write an empty audit action.');
            return { success: false, error: 'Audit action is required.' };
        }

        try {
            const { error } = await client.from('audit_logs').insert(row);
            if (error) {
                logger.error(`[AUDIT] Failed to save ${row.module} event for user ${row.user_id || 'unknown'}: ${error.message}`);
                return { success: false, error: error.message };
            }
            return { success: true };
        } catch (error) {
            logger.error(`[AUDIT] Unexpected error saving ${row.module} event: ${error.message}`);
            return { success: false, error: error.message };
        }
    };
}

let defaultWriteAuditLog;
async function writeAuditLog(userId, action, moduleName = 'system', details = null) {
    // Lazy-load the production Supabase client so the row builder/logger can be unit-tested
    // with a mock client without requiring local environment variables or dependencies.
    if (!defaultWriteAuditLog) {
        const { supabaseAdmin } = require('./supabase');
        defaultWriteAuditLog = createAuditLogger(supabaseAdmin);
    }
    return defaultWriteAuditLog(userId, action, moduleName, details);
}

module.exports = { writeAuditLog, createAuditLogger, buildAuditRow, ENTITY_TYPE_BY_MODULE };
