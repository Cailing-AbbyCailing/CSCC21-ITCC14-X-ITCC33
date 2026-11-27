'use strict';
require('../shared/supabase');
const express = require('express');
const { supabaseAdmin } = require('../shared/supabase');
const { respondWithDatabaseHealth } = require('../shared/health');
const { authenticate, authorize } = require('../shared/authMiddleware');
const { writeAuditLog } = require('../shared/audit');
const app = express();
const manager = [authenticate, authorize('staff', 'admin')];
const TYPES = ['Water', 'Laundry', 'Printing'];
const FIELDS = 'id,item_name,service_type,category,description,unit,stock_quantity,selling_price,availability,created_at,updated_at';
const LOW_STOCK_THRESHOLD = Math.max(0, Number(process.env.LOW_STOCK_THRESHOLD || 5));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isUuid = v => UUID.test(String(v || ''));
const fail = (res, status, message) => res.status(status).json({ success: false, message });
app.use(express.json({ limit: '1mb' }));
app.get('/', (_req, res) => res.json({ success: true, service: 'inventory-customer-api' }));
app.get('/health/inventory', (req, res) => respondWithDatabaseHealth(res, supabaseAdmin, 'inventory-customer-api', ['inventory', 'orders', 'profiles', 'audit_logs']));
function stockStatus(row) {
  const qty = Number(row.stock_quantity || 0);
  return { ...row, stock_status: qty <= 0 ? 'out_of_stock' : qty <= LOW_STOCK_THRESHOLD ? 'low_stock' : 'in_stock', low_stock_threshold: LOW_STOCK_THRESHOLD };
}
async function audit(userId, action, details = {}) { return writeAuditLog(userId, action, 'inventory', details); }
function validate(body, partial = false) {
  const errors = [];
  if (!body || typeof body !== 'object' || Array.isArray(body)) return ['Request body must be an object.'];
  if (!partial || body.item_name !== undefined) if (typeof body.item_name !== 'string' || !body.item_name.trim()) errors.push('item_name is required.');
  if (!partial || body.service_type !== undefined) if (!TYPES.includes(body.service_type)) errors.push('service_type must be Water, Laundry, or Printing.');
  if (!partial || body.unit !== undefined) if (typeof body.unit !== 'string' || !body.unit.trim()) errors.push('unit is required.');
  if (body.stock_quantity !== undefined && (!Number.isInteger(Number(body.stock_quantity)) || Number(body.stock_quantity) < 0)) errors.push('stock_quantity must be a non-negative integer.');
  if (body.selling_price !== undefined && (!Number.isFinite(Number(body.selling_price)) || Number(body.selling_price) < 0)) errors.push('selling_price must be a non-negative number.');
  if (body.availability !== undefined && typeof body.availability !== 'boolean') errors.push('availability must be boolean.');
  for (const k of ['category', 'description']) if (body[k] !== undefined && body[k] !== null && typeof body[k] !== 'string') errors.push(`${k} must be a string or null.`);
  return errors;
}
app.get(['/api/inventory', '/api/supplies'], ...manager, async (req, res) => {
  try {
    let q = supabaseAdmin.from('inventory').select(FIELDS).order('service_type').order('item_name');
    if (req.query.service_type) {
      if (!TYPES.includes(req.query.service_type)) return fail(res, 400, 'Invalid service_type.');
      q = q.eq('service_type', req.query.service_type);
    }
    const { data, error } = await q;
    if (error) throw error;
    const rows = (data || []).map(stockStatus);
    return res.json({ success: true, count: rows.length, summary: { total_items: rows.length, low_stock_items: rows.filter(x => x.stock_status === 'low_stock').length, out_of_stock_items: rows.filter(x => x.stock_status === 'out_of_stock').length, by_service: Object.fromEntries(TYPES.map(t => [t, rows.filter(x => x.service_type === t).length])) }, data: rows });
  } catch (e) { console.error('inventory list:', e.message); return fail(res, 500, 'Could not retrieve inventory.'); }
});
app.get(['/api/inventory/:id', '/api/supplies/:id'], ...manager, async (req, res) => {
  if (!isUuid(req.params.id)) return fail(res, 400, 'Invalid inventory id.');
  try {
    const { data, error } = await supabaseAdmin.from('inventory').select(FIELDS).eq('id', req.params.id).maybeSingle();
    if (error) throw error;
    return data ? res.json({ success: true, data: stockStatus(data) }) : fail(res, 404, 'Inventory item not found.');
  } catch (e) { console.error('inventory detail:', e.message); return fail(res, 500, 'Could not retrieve inventory item.'); }
});
app.post(['/api/inventory', '/api/supplies'], ...manager, async (req, res) => {
  const errors = validate(req.body);
  if (errors.length) return res.status(422).json({ success: false, message: 'Inventory validation failed.', errors });
  const b = req.body;
  try {
    const payload = { item_name: b.item_name.trim(), service_type: b.service_type, category: b.category?.trim() || null, description: b.description?.trim() || null, unit: b.unit.trim(), stock_quantity: b.stock_quantity === undefined ? 0 : Number(b.stock_quantity), selling_price: b.selling_price === undefined ? 0 : Number(b.selling_price), availability: b.availability === undefined ? true : b.availability };
    const { data, error } = await supabaseAdmin.from('inventory').insert(payload).select(FIELDS).single();
    if (error) throw error;
    await audit(req.user.id, 'Inventory item created', { event: 'inventory_created', item_id: data.id, service_type: data.service_type });
    return res.status(201).json({ success: true, data: stockStatus(data) });
  } catch (e) { console.error('inventory create:', e.message); return fail(res, 500, 'Could not create inventory item.'); }
});
async function updateInventory(req, res) {
  if (!isUuid(req.params.id)) return fail(res, 400, 'Invalid inventory id.');
  const errors = validate(req.body, true);
  if (errors.length) return res.status(422).json({ success: false, message: 'Inventory validation failed.', errors });
  const b = req.body || {};
  if (b.stock_quantity !== undefined) return fail(res, 422, 'Use the stock-movements endpoint to change stock_quantity.');
  const updates = {};
  for (const k of ['item_name', 'service_type', 'category', 'description', 'unit', 'selling_price', 'availability']) if (b[k] !== undefined) updates[k] = typeof b[k] === 'string' ? b[k].trim() : b[k];
  if (!Object.keys(updates).length) return fail(res, 400, 'Provide at least one supported field.');
  updates.updated_at = new Date().toISOString();
  try {
    const { data, error } = await supabaseAdmin.from('inventory').update(updates).eq('id', req.params.id).select(FIELDS).maybeSingle();
    if (error) throw error;
    if (!data) return fail(res, 404, 'Inventory item not found.');
    await audit(req.user.id, 'Inventory item updated', { event: 'inventory_updated', item_id: data.id, changed_fields: Object.keys(updates) });
    return res.json({ success: true, data: stockStatus(data) });
  } catch (e) { console.error('inventory update:', e.message); return fail(res, 500, 'Could not update inventory item.'); }
}
app.patch(['/api/inventory/:id', '/api/supplies/:id'], ...manager, updateInventory);
app.put(['/api/inventory/:id', '/api/supplies/:id'], ...manager, updateInventory);
app.post(['/api/inventory/:id/stock-movements', '/api/supplies/:id/stock-movements'], ...manager, async (req, res) => {
  if (!isUuid(req.params.id)) return fail(res, 400, 'Invalid inventory id.');
  const direction = req.body?.direction;
  const quantity = Number(req.body?.quantity);
  if (!['IN', 'OUT'].includes(direction) || !Number.isInteger(quantity) || quantity <= 0) return fail(res, 422, 'direction must be IN or OUT and quantity must be a positive whole number.');
  try {
    const { data, error } = await supabaseAdmin.rpc('acs_adjust_inventory_stock', { p_item_id: req.params.id, p_direction: direction, p_quantity: quantity });
    if (error?.code === 'P0002') return fail(res, 404, 'Inventory item not found.');
    if (error?.code === 'P0001') return fail(res, 409, 'Stock-out exceeds available stock.');
    if (error) throw error;
    await audit(req.user.id, `Inventory stock ${direction}`, { event: 'inventory_stock_movement', item_id: data.id, item_name: data.item_name, direction, quantity, unit: data.unit, resulting_stock: data.stock_quantity, note: req.body?.note || null });
    if (Number(data.stock_quantity) <= LOW_STOCK_THRESHOLD) {
      await audit(req.user.id, 'Low stock alert', { event: 'low_stock_alert', item_id: data.id, item_name: data.item_name, stock_quantity: data.stock_quantity, threshold: LOW_STOCK_THRESHOLD });
    }
    return res.json({ success: true, data: stockStatus(data) });
  } catch (e) { console.error('stock movement:', e.message); return fail(res, 500, 'Could not record stock movement. Apply the SQL helper function first.'); }
});
async function moveStock(req, res, direction) {
  if (!isUuid(req.params.id)) return fail(res, 400, 'Invalid inventory id.');
  const quantity = Number(req.body?.quantity ?? req.body?.restock_quantity);
  if (!Number.isInteger(quantity) || quantity <= 0) return fail(res, 422, 'quantity must be a positive whole number.');
  try {
    const { data, error } = await supabaseAdmin.rpc('acs_adjust_inventory_stock', { p_item_id: req.params.id, p_direction: direction, p_quantity: quantity });
    if (error?.code === 'P0002') return fail(res, 404, 'Inventory item not found.');
    if (error?.code === 'P0001') return fail(res, 409, 'Stock-out exceeds available stock.');
    if (error) throw error;
    await audit(req.user.id, `Inventory stock ${direction}`, { event: 'inventory_stock_movement', item_id: data.id, item_name: data.item_name, direction, quantity, unit: data.unit, resulting_stock: data.stock_quantity, note: req.body?.note || null });
    if (Number(data.stock_quantity) <= LOW_STOCK_THRESHOLD) {
      await audit(req.user.id, 'Low stock alert', { event: 'low_stock_alert', item_id: data.id, item_name: data.item_name, stock_quantity: data.stock_quantity, threshold: LOW_STOCK_THRESHOLD });
    }
    return res.json({ success: true, data: stockStatus(data) });
  } catch (e) { console.error('stock movement:', e.message); return fail(res, 500, 'Could not record stock movement.'); }
}
app.post(['/api/inventory/:id/restock', '/api/supplies/:id/restock'], ...manager, (req, res) => moveStock(req, res, 'IN'));
app.post(['/api/inventory/:id/stock-out', '/api/supplies/:id/stock-out'], ...manager, (req, res) => moveStock(req, res, 'OUT'));
app.delete(['/api/inventory/:id', '/api/supplies/:id'], authenticate, authorize('admin'), async (req, res) => {
  if (!isUuid(req.params.id)) return fail(res, 400, 'Invalid inventory id.');
  try {
    const { data, error } = await supabaseAdmin.from('inventory').update({ availability: false }).eq('id', req.params.id).select('id,item_name,service_type,availability').maybeSingle();
    if (error) throw error;
    if (!data) return fail(res, 404, 'Inventory item not found.');
    await audit(req.user.id, 'Inventory item archived', { event: 'inventory_archived', item_id: data.id });
    return res.json({ success: true, data });
  } catch (e) { console.error('inventory archive:', e.message); return fail(res, 500, 'Could not archive inventory item.'); }
});
app.get('/api/customers', ...manager, async (_req, res) => {
  try {
    const { data: customers, error } = await supabaseAdmin.from('profiles').select('id,full_name,email,phone,default_address,created_at').eq('role', 'customer').order('created_at', { ascending: false });
    if (error) throw error;
    const ids = (customers || []).map(c => c.id);
    const counts = new Map(ids.map(id => [id, 0]));
    if (ids.length) {
      const { data: orders, error: orderError } = await supabaseAdmin.from('orders').select('user_id').in('user_id', ids);
      if (orderError) throw orderError;
      for (const o of orders || []) counts.set(o.user_id, (counts.get(o.user_id) || 0) + 1);
    }
    return res.json({ success: true, count: customers.length, data: customers.map(c => ({ ...c, order_count: counts.get(c.id) || 0 })) });
  } catch (e) { console.error('customers:', e.message); return fail(res, 500, 'Could not retrieve customer records.'); }
});
app.get('/api/customers/:id/orders', ...manager, async (req, res) => {
  if (!isUuid(req.params.id)) return fail(res, 400, 'Invalid customer id.');
  try {
    const { data, error } = await supabaseAdmin.from('orders').select('*').eq('user_id', req.params.id).order('created_at', { ascending: false });
    if (error) throw error;
    const rows = (data || []).filter(row => ['water', 'laundry'].includes(String(row.service_type || '').toLowerCase()));
    return res.json({ success: true, count: rows.length, data: rows });
  } catch (e) { console.error('customer orders:', e.message); return fail(res, 500, 'Could not retrieve customer order history.'); }
});
app.use((err, req, res, next) => { console.error('Inventory API error:', err.message); return fail(res, 500, 'An unexpected inventory API error occurred.'); });
module.exports = app;
