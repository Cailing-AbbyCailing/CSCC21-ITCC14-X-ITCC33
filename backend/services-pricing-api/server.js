require('../shared/supabase'); // Load shared root .env and validate credentials.
const express = require('express');
const cors = require('cors');
const { supabase, supabaseAdmin } = require('../shared/supabase');
const { respondWithDatabaseHealth } = require('../shared/health');
const { authenticate, optionalAuthenticate, authorize } = require('../shared/authMiddleware');
const { corsOptions } = require('../shared/serverConfig');
const { writeAuditLog } = require('../shared/audit');

const app = express();
const PORT = Number(process.env.SERVICES_PORT || 3002);
// Printing is not a customer-facing service. Printing supplies belong in staff-only inventory.
const SERVICE_TYPES = ['Water', 'Laundry'];
// Keep this aligned with the confirmed inventory columns; do not select optional timestamp columns.
const SERVICE_FIELDS = 'id, item_name, service_type, category, description, unit, stock_quantity, selling_price, availability';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isUuid = value => UUID_PATTERN.test(String(value || ''));

app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' }));
app.get('/', (req, res) => res.json({ success: true, service: 'services-pricing-api', message: 'Alavanza Services & Pricing API is running.' }));
app.get('/health/services', (req, res) => respondWithDatabaseHealth(res, supabaseAdmin, 'services-pricing-api', ['inventory']));

async function audit(userId, action) {
    return writeAuditLog(userId, action, 'services');
}

function validateOptionalText(value, field) {
    if (value !== undefined && value !== null && typeof value !== 'string') return `${field} must be a string or null.`;
    return null;
}

function validateServicePayload(body, partial = false) {
    const errors = [];
    if (!body || typeof body !== 'object' || Array.isArray(body)) return ['Request body must be a JSON object.'];

    if (!partial || body.item_name !== undefined) {
        if (typeof body.item_name !== 'string' || !body.item_name.trim()) errors.push('Item name is required and must be a non-empty string.');
    }
    if (!partial || body.service_type !== undefined) {
        if (!SERVICE_TYPES.includes(body.service_type)) errors.push(`Service type must be one of: ${SERVICE_TYPES.join(', ')}.`);
    }
    if (!partial || body.unit !== undefined) {
        if (typeof body.unit !== 'string' || !body.unit.trim()) errors.push('Unit is required and must be a non-empty string.');
    }
    if (!partial || body.selling_price !== undefined) {
        if (body.selling_price === undefined || body.selling_price === null || !Number.isFinite(Number(body.selling_price)) || Number(body.selling_price) < 0) {
            errors.push('Selling price must be a non-negative number.');
        }
    }
    if (body.stock_quantity !== undefined && (!Number.isInteger(body.stock_quantity) || body.stock_quantity < 0)) {
        errors.push('Stock quantity must be a non-negative integer.');
    }
    if (body.availability !== undefined && typeof body.availability !== 'boolean') {
        errors.push('Availability must be true or false.');
    }
    for (const field of ['category', 'description']) {
        const problem = validateOptionalText(body[field], field);
        if (problem) errors.push(problem);
    }
    return errors;
}

function normalizePayload(body, partial = false) {
    const allowed = ['item_name', 'service_type', 'category', 'description', 'unit', 'stock_quantity', 'selling_price', 'availability'];
    const result = {};
    for (const field of allowed) {
        if (body[field] !== undefined) result[field] = body[field];
    }
    for (const field of ['item_name', 'unit']) {
        if (typeof result[field] === 'string') result[field] = result[field].trim();
    }
    if (result.selling_price !== undefined) result.selling_price = Number(result.selling_price);
    if (!partial && result.stock_quantity === undefined) result.stock_quantity = 0;
    if (!partial && result.availability === undefined) result.availability = true;
    if (result.category === undefined && !partial) result.category = null;
    if (result.description === undefined && !partial) result.description = null;
    return result;
}

// Public catalog supports anonymous reads of available services. When a signed-in
// user sends a JWT, use that user's Supabase client so RLS can distinguish customers
// from staff/admins. Staff/admins can therefore manage and inspect unavailable rows.
app.get(['/api/services', '/services'], optionalAuthenticate, async (req, res) => {
    try {
        const isManager = ['staff', 'admin'].includes(req.user?.role);
        const db = req.userSupabase || supabase;
        let query = db.from('inventory').select(SERVICE_FIELDS).in('service_type', SERVICE_TYPES);
        const { service_type, available } = req.query;

        if (service_type !== undefined) {
            if (!SERVICE_TYPES.includes(service_type)) return res.status(400).json({ success: false, message: 'Invalid service_type filter.' });
            query = query.eq('service_type', service_type);
        }
        if (available !== undefined) {
            if (!['true', 'false'].includes(available)) return res.status(400).json({ success: false, message: 'available must be true or false.' });
            if (available === 'false' && !isManager) {
                return res.status(403).json({ success: false, message: 'Only staff and admins can view unavailable services.' });
            }
            query = query.eq('availability', available === 'true');
        } else if (!isManager) {
            // Anonymous visitors and customers only receive currently available catalog rows.
            query = query.eq('availability', true);
        }

        const { data, error } = await query;
        if (error) {
            console.error('service list query failed:', error.message);
            return res.status(500).json({ success: false, message: 'Failed to retrieve services. Check the inventory SELECT policy and table columns.' });
        }
        return res.json({ success: true, count: data.length, data });
    } catch (error) {
        console.error('service list error:', error.message);
        return res.status(500).json({ success: false, message: 'Failed to retrieve services.' });
    }
});

app.get(['/api/services/:id', '/services/:id'], optionalAuthenticate, async (req, res) => {
    if (!isUuid(req.params.id)) return res.status(400).json({ success: false, message: 'Service id must be a valid UUID.' });
    try {
        const db = req.userSupabase || supabase;
        const { data, error } = await db.from('inventory').select(SERVICE_FIELDS).eq('id', req.params.id).in('service_type', SERVICE_TYPES).maybeSingle();
        if (error) {
            console.error('service detail query failed:', error.message);
            return res.status(500).json({ success: false, message: 'Failed to retrieve service. Check the inventory SELECT policy.' });
        }
        if (!data) return res.status(404).json({ success: false, message: 'Service not found or not available to this account.' });
        return res.json({ success: true, data });
    } catch (error) {
        console.error('service detail error:', error.message);
        return res.status(500).json({ success: false, message: 'Failed to retrieve service.' });
    }
});

app.post(['/api/services', '/services'], authenticate, authorize('staff', 'admin'), async (req, res) => {
    try {
        const errors = validateServicePayload(req.body);
        if (errors.length) return res.status(422).json({ success: false, message: 'Service validation failed.', errors });
        const payload = normalizePayload(req.body);
        const { data, error } = await req.userSupabase.from('inventory').insert(payload).select(SERVICE_FIELDS).single();
        if (error) {
            console.error('service insert failed:', error.message);
            if (error.code === '23505') return res.status(409).json({ success: false, message: 'A service with conflicting unique values already exists.' });
            if (['23514', '22P02', '22003'].includes(error.code)) return res.status(422).json({ success: false, message: 'Service values violate a database constraint.' });
            if (error.code === '42501') return res.status(403).json({ success: false, message: 'You are not allowed to add services.' });
            return res.status(500).json({ success: false, message: 'Service could not be created.' });
        }
        await audit(req.user.id, `Created service ${data.id}: ${data.item_name}`);
        return res.status(201).json({ success: true, message: 'Service added successfully.', data });
    } catch (error) {
        console.error('service creation error:', error.message);
        return res.status(500).json({ success: false, message: 'Failed to add service.' });
    }
});

async function updateService(req, res, partial) {
    if (!isUuid(req.params.id)) return res.status(400).json({ success: false, message: 'Service id must be a valid UUID.' });
    if (req.body?.stock_quantity !== undefined) return res.status(422).json({ success: false, message: 'Use the staff inventory stock-movements endpoint to change stock_quantity.' });
    try {
        const errors = validateServicePayload(req.body, partial);
        if (errors.length) return res.status(422).json({ success: false, message: 'Service validation failed.', errors });
        const updates = normalizePayload(req.body, partial);
        if (!Object.keys(updates).length) return res.status(400).json({ success: false, message: 'Provide at least one supported service field to update.' });
        const { data, error } = await req.userSupabase.from('inventory').update(updates).eq('id', req.params.id).select(SERVICE_FIELDS).maybeSingle();
        if (error) {
            console.error('service update failed:', error.message);
            if (error.code === '23505') return res.status(409).json({ success: false, message: 'The update conflicts with an existing service.' });
            if (['23514', '22P02', '22003'].includes(error.code)) return res.status(422).json({ success: false, message: 'Service values violate a database constraint.' });
            if (error.code === '42501') return res.status(403).json({ success: false, message: 'You are not allowed to update services.' });
            return res.status(500).json({ success: false, message: 'Service could not be updated.' });
        }
        if (!data) return res.status(404).json({ success: false, message: 'Service not found.' });
        await audit(req.user.id, `Updated service ${data.id}: ${data.item_name}`);
        return res.json({ success: true, message: 'Service updated successfully.', data });
    } catch (error) {
        console.error('service update error:', error.message);
        return res.status(500).json({ success: false, message: 'Failed to update service.' });
    }
}
app.put(['/api/services/:id', '/services/:id'], authenticate, authorize('staff', 'admin'), (req, res) => updateService(req, res, false));
app.patch(['/api/services/:id', '/services/:id'], authenticate, authorize('staff', 'admin'), (req, res) => updateService(req, res, true));

// Archive catalog rows instead of physically deleting products referenced by historical orders.
app.delete(['/api/services/:id', '/services/:id'], authenticate, authorize('admin'), async (req, res) => {
    if (!isUuid(req.params.id)) return res.status(400).json({ success: false, message: 'Service id must be a valid UUID.' });
    try {
        const { data, error } = await req.userSupabase.from('inventory')
            .update({ availability: false, updated_at: new Date().toISOString() })
            .eq('id', req.params.id).select('id,item_name,service_type,availability').maybeSingle();
        if (error) {
            console.error('service archive failed:', error.message);
            return res.status(400).json({ success: false, message: 'Service could not be archived.' });
        }
        if (!data) return res.status(404).json({ success: false, message: 'Service not found.' });
        await audit(req.user.id, `Archived service ${data.id}: ${data.item_name}`);
        return res.status(200).json({ success: true, message: 'Service archived; historical order data is preserved.', data });
    } catch (error) {
        console.error('service archive error:', error.message);
        return res.status(500).json({ success: false, message: 'Failed to archive service.' });
    }
});

app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) return res.status(400).json({ success: false, message: 'Request body contains invalid JSON.' });
    if (err.message === 'Origin is not allowed by CORS.') return res.status(403).json({ success: false, message: err.message });
    console.error('Services API error:', err.message);
    return res.status(500).json({ success: false, message: 'An unexpected server error occurred.' });
});

if (require.main === module) app.listen(PORT, () => console.log(`ACS services module listening on ${PORT}`));

module.exports = app;
