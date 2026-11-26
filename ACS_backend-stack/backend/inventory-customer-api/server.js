require('../shared/supabase');
const express = require('express');
const cors = require('cors');
const { supabaseAdmin } = require('../shared/supabase');
const { respondWithDatabaseHealth } = require('../shared/health');
const { authenticate, authorize } = require('../shared/authMiddleware');
const { corsOptions } = require('../shared/serverConfig');
const { writeAuditLog } = require('../shared/audit');

const app = express();
const PORT = Number(process.env.INVENTORY_PORT || 3004);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isUuid = value => UUID_RE.test(String(value || ''));
const manager = [authenticate, authorize('staff', 'admin')];
const FIELDS = 'id,item_name,category,unit,quantity_on_hand,reorder_level,supplier,notes,created_by,created_at,updated_at';

app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' }));
app.get('/', (req, res) => res.json({ success: true, service: 'inventory-customer-api', message: 'Alavanza Supply Inventory API is running.' }));
app.get('/health', (req, res) => respondWithDatabaseHealth(res, supabaseAdmin, 'inventory-customer-api', ['supply_inventory']));

function fail(res, status, message) { return res.status(status).json({ success: false, message }); }
function withStockStatus(item) {
    const quantity = Number(item.quantity_on_hand);
    const reorder = Number(item.reorder_level);
    const stock_status = quantity <= 0 ? 'out_of_stock' : quantity <= reorder ? 'low_stock' : 'in_stock';
    return { ...item, stock_status };
}
async function audit(userId, action) {
    return writeAuditLog(userId, action, 'supply_inventory');
}
function validateBody(body, partial = false) {
    const errors = [];
    if (!body || typeof body !== 'object' || Array.isArray(body)) return ['Request body must be a JSON object.'];
    if (!partial || body.item_name !== undefined) if (typeof body.item_name !== 'string' || !body.item_name.trim()) errors.push('item_name is required.');
    if (!partial || body.unit !== undefined) if (typeof body.unit !== 'string' || !body.unit.trim()) errors.push('unit is required.');
    for (const key of ['quantity_on_hand', 'reorder_level']) {
        if ((!partial || body[key] !== undefined) && (!Number.isFinite(Number(body[key])) || Number(body[key]) < 0)) errors.push(`${key} must be a non-negative number.`);
    }
    for (const key of ['category', 'supplier', 'notes']) {
        if (body[key] !== undefined && body[key] !== null && typeof body[key] !== 'string') errors.push(`${key} must be a string or null.`);
    }
    return errors;
}


// Customer directory and order counts are part of the Inventory & Customer Records API.
app.get('/api/customers', ...manager, async (req, res) => {
    try {
        const { data: customers, error } = await supabaseAdmin.from('profiles')
            .select('id,full_name,email,phone,default_address,created_at')
            .eq('role', 'customer').order('created_at', { ascending: false });
        if (error) throw error;
        const ids = (customers || []).map(customer => customer.id);
        const orderCounts = new Map(ids.map(id => [id, 0]));
        if (ids.length) {
            const [water, laundry] = await Promise.all([
                supabaseAdmin.from('water_orders').select('user_id').in('user_id', ids),
                supabaseAdmin.from('laundry_bookings').select('user_id').in('user_id', ids)
            ]);
            if (water.error) throw water.error;
            if (laundry.error) throw laundry.error;
            for (const row of [...(water.data || []), ...(laundry.data || [])]) orderCounts.set(row.user_id, (orderCounts.get(row.user_id) || 0) + 1);
        }
        const data = (customers || []).map(customer => ({ ...customer, order_count: orderCounts.get(customer.id) || 0 }));
        return res.json({ success: true, count: data.length, data });
    } catch (error) {
        console.error('customer directory failed:', error.message);
        return fail(res, 500, 'Could not retrieve customer records. Apply supabase/remaining_apis_schema.sql first.');
    }
});

app.get('/api/customers/:id/orders', ...manager, async (req, res) => {
    if (!isUuid(req.params.id)) return fail(res, 400, 'Customer id must be a valid UUID.');
    try {
        const [water, laundry] = await Promise.all([
            supabaseAdmin.from('water_orders').select('*').eq('user_id', req.params.id).order('created_at', { ascending: false }),
            supabaseAdmin.from('laundry_bookings').select('*').eq('user_id', req.params.id).order('created_at', { ascending: false })
        ]);
        if (water.error) throw water.error;
        if (laundry.error) throw laundry.error;
        const data = [
            ...(water.data || []).map(item => ({ ...item, order_type: 'water' })),
            ...(laundry.data || []).map(item => ({ ...item, order_type: 'laundry' }))
        ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        return res.json({ success: true, count: data.length, data });
    } catch (error) {
        console.error('customer order history failed:', error.message);
        return fail(res, 500, 'Could not retrieve customer order history.');
    }
});

app.get(['/api/inventory', '/api/supplies'], ...manager, async (req, res) => {
    try {
        const { data, error } = await supabaseAdmin.from('supply_inventory').select(FIELDS).order('item_name');
        if (error) throw error;
        const items = (data || []).map(withStockStatus);
        const summary = {
            total_items: items.length,
            low_stock_items: items.filter(item => item.stock_status === 'low_stock').length,
            out_of_stock_items: items.filter(item => item.stock_status === 'out_of_stock').length
        };
        return res.json({ success: true, count: items.length, summary, data: items });
    } catch (error) {
        console.error('supply list failed:', error.message);
        return fail(res, 500, 'Could not retrieve supply inventory. Apply supabase/remaining_apis_schema.sql first.');
    }
});

app.get(['/api/inventory/:id', '/api/supplies/:id'], ...manager, async (req, res) => {
    if (!isUuid(req.params.id)) return fail(res, 400, 'Supply id must be a valid UUID.');
    try {
        const { data, error } = await supabaseAdmin.from('supply_inventory').select(FIELDS).eq('id', req.params.id).maybeSingle();
        if (error) throw error;
        if (!data) return fail(res, 404, 'Supply item not found.');
        return res.json({ success: true, data: withStockStatus(data) });
    } catch (error) {
        console.error('supply detail failed:', error.message);
        return fail(res, 500, 'Could not retrieve supply details.');
    }
});

app.post(['/api/inventory', '/api/supplies'], ...manager, async (req, res) => {
    const errors = validateBody(req.body);
    if (errors.length) return res.status(422).json({ success: false, message: 'Supply validation failed.', errors });
    try {
        const body = req.body;
        const payload = {
            item_name: body.item_name.trim(), unit: body.unit.trim(),
            quantity_on_hand: Number(body.quantity_on_hand), reorder_level: Number(body.reorder_level),
            category: body.category?.trim() || null, supplier: body.supplier?.trim() || null,
            notes: body.notes?.trim() || null, created_by: req.user.id
        };
        const { data, error } = await supabaseAdmin.from('supply_inventory').insert(payload).select(FIELDS).single();
        if (error) throw error;
        await audit(req.user.id, `Created supply inventory item ${data.id}: ${data.item_name}`);
        return res.status(201).json({ success: true, message: 'Supply item created.', data: withStockStatus(data) });
    } catch (error) {
        console.error('supply creation failed:', error.message);
        return fail(res, 500, 'Could not create supply item.');
    }
});

async function updateInventoryItem(req, res) {
    if (!isUuid(req.params.id)) return fail(res, 400, 'Supply id must be a valid UUID.');
    if (req.body?.restock_quantity !== undefined) {
        const quantity = Number(req.body.restock_quantity);
        if (!Number.isFinite(quantity) || quantity <= 0) return fail(res, 422, 'restock_quantity must be a positive number.');
        try {
            const { data, error } = await supabaseAdmin.rpc('restock_supply_inventory', { p_item_id: req.params.id, p_quantity: quantity });
            if (error?.code === 'P0002') return fail(res, 404, 'Supply item not found.');
            if (error) throw error;
            if (!data) return fail(res, 404, 'Supply item not found.');
            await audit(req.user.id, `Restocked supply item ${data.id} by ${quantity} ${data.unit}`);
            return res.json({ success: true, message: 'Supply stock updated.', data: withStockStatus(data) });
        } catch (error) {
            console.error('inventory restock failed:', error.message);
            return fail(res, 500, 'Could not restock supply item. Confirm the Supabase restock function exists.');
        }
    }
    const errors = validateBody(req.body, true);
    if (errors.length) return res.status(422).json({ success: false, message: 'Supply validation failed.', errors });
    const allowed = ['item_name', 'unit', 'category', 'quantity_on_hand', 'reorder_level', 'supplier', 'notes'];
    const updates = {};
    for (const key of allowed) if (req.body[key] !== undefined) updates[key] = ['quantity_on_hand', 'reorder_level'].includes(key) ? Number(req.body[key]) : (typeof req.body[key] === 'string' ? req.body[key].trim() : null);
    if (!Object.keys(updates).length) return fail(res, 400, 'Provide at least one supply field to update.');
    updates.updated_at = new Date().toISOString();
    try {
        const { data, error } = await supabaseAdmin.from('supply_inventory').update(updates).eq('id', req.params.id).select(FIELDS).maybeSingle();
        if (error) throw error;
        if (!data) return fail(res, 404, 'Supply item not found.');
        await audit(req.user.id, `Updated supply inventory item ${data.id}: ${data.item_name}`);
        return res.json({ success: true, message: 'Supply item updated.', data: withStockStatus(data) });
    } catch (error) {
        console.error('supply update failed:', error.message);
        return fail(res, 500, 'Could not update supply item.');
    }
}

app.put(['/api/inventory/:id', '/api/supplies/:id'], ...manager, updateInventoryItem);
app.patch(['/api/inventory/:id', '/api/supplies/:id'], ...manager, updateInventoryItem);

app.post(['/api/inventory/:id/restock', '/api/supplies/:id/restock'], ...manager, async (req, res) => {
    if (!isUuid(req.params.id)) return fail(res, 400, 'Supply id must be a valid UUID.');
    const quantity = Number(req.body?.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) return fail(res, 422, 'quantity must be a positive number.');
    try {
        const { data, error } = await supabaseAdmin.rpc('restock_supply_inventory', {
            p_item_id: req.params.id,
            p_quantity: quantity
        });
        if (error?.code === 'P0002') return fail(res, 404, 'Supply item not found.');
        if (error) throw error;
        if (!data) return fail(res, 404, 'Supply item not found.');
        await audit(req.user.id, `Restocked supply item ${data.id} by ${quantity} ${data.unit}`);
        return res.json({ success: true, message: 'Supply stock updated.', data: withStockStatus(data) });
    } catch (error) {
        console.error('supply restock failed:', error.message);
        return fail(res, 500, 'Could not restock supply item.');
    }
});

app.delete(['/api/inventory/:id', '/api/supplies/:id'], ...manager, async (req, res) => {
    if (req.user.role !== 'admin') return fail(res, 403, 'Only administrators can delete supply inventory items.');
    if (!isUuid(req.params.id)) return fail(res, 400, 'Supply id must be a valid UUID.');
    try {
        const { data, error } = await supabaseAdmin.from('supply_inventory').delete().eq('id', req.params.id).select('id,item_name').maybeSingle();
        if (error) throw error;
        if (!data) return fail(res, 404, 'Supply item not found.');
        await audit(req.user.id, `Deleted supply inventory item ${data.id}: ${data.item_name}`);
        return res.json({ success: true, message: 'Supply item deleted.', data });
    } catch (error) {
        console.error('supply delete failed:', error.message);
        return fail(res, 500, 'Could not delete supply item.');
    }
});

app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) return fail(res, 400, 'Request body contains invalid JSON.');
    if (err.message === 'Origin is not allowed by CORS.') return fail(res, 403, err.message);
    console.error('Inventory API error:', err.message);
    return fail(res, 500, 'An unexpected server error occurred.');
});

app.listen(PORT, () => console.log(`Supply Inventory API running at http://localhost:${PORT}`));
