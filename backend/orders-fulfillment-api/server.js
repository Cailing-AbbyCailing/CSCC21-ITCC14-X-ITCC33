'use strict';

require('../shared/supabase');
const express = require('express');
const { supabaseAdmin } = require('../shared/supabase');
const { respondWithDatabaseHealth } = require('../shared/health');
const { authenticate, authorize } = require('../shared/authMiddleware');
const { calculateLaundryPricing } = require('../shared/pricing');
const { writeAuditLog } = require('../shared/audit');

const app = express();
const KG_PER_LOAD = 7;
const PAYMENT_METHODS = ['Cash on Delivery (COD)', 'GCash Online Payment', 'Cash'];
const PAYMENT_FIELDS = 'id,order_id,payment_method,amount,payment_status,received_by,reference_number,created_at';
const STATUSES = ['Pending', 'In Progress', 'Out for Delivery', 'Ready for Station Pickup', 'Completed', 'Cancelled'];
const TRANSITIONS = {
  Pending: ['In Progress', 'Cancelled'],
  'In Progress': ['Out for Delivery', 'Ready for Station Pickup', 'Completed', 'Cancelled'],
  'Out for Delivery': ['Completed', 'Cancelled'],
  'Ready for Station Pickup': ['Completed', 'Cancelled'],
  Completed: [], Cancelled: []
};
const ARRANGEMENTS = {
  Water: {
    walk_in_refill_pickup: { fulfillment: 'station_pickup', staffOnly: true, delivery: false, pickup: false },
    walk_in_refill_delivery: { fulfillment: 'delivery', staffOnly: false, delivery: true, pickup: false },
    home_pickup_delivery: { fulfillment: 'delivery', staffOnly: false, delivery: true, pickup: true },
    home_pickup_station_pickup: { fulfillment: 'station_pickup', staffOnly: false, delivery: false, pickup: true }
  },
  Laundry: {
    drop_off_pickup: { fulfillment: 'station_pickup', staffOnly: true, delivery: false, pickup: false },
    drop_off_home_delivery: { fulfillment: 'delivery', staffOnly: false, delivery: true, pickup: false },
    home_pickup_return_delivery: { fulfillment: 'delivery', staffOnly: false, delivery: true, pickup: true },
    home_pickup_station_pickup: { fulfillment: 'station_pickup', staffOnly: false, delivery: false, pickup: true }
  }
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isUuid = v => UUID.test(String(v || ''));
const isManager = user => ['staff', 'admin'].includes(user?.role);
const now = () => new Date().toISOString();
const detailsOf = row => row?.order_details && typeof row.order_details === 'object' && !Array.isArray(row.order_details) ? row.order_details : {};
const typeOf = row => { const value = String(row?.service_type || '').toLowerCase(); return value === 'water' ? 'Water' : value === 'laundry' ? 'Laundry' : null; };
function canonicalStatus(value) { const key = String(value || 'Pending').toLowerCase(); return ({ 'pending':'Pending', 'in progress':'In Progress', 'out for delivery':'Out for Delivery', 'ready for station pickup':'Ready for Station Pickup', 'completed':'Completed', 'cancelled':'Cancelled' })[key] || String(value || 'Pending'); }
const fail = (res, status, message, extra = {}) => res.status(status).json({ success: false, message, ...extra });

app.use(express.json({ limit: '1mb' }));
app.get('/', (_req, res) => res.json({ success: true, service: 'orders-fulfillment-api', message: 'Unified Water and Laundry transaction API.' }));
app.get('/health/orders', (req, res) => respondWithDatabaseHealth(res, supabaseAdmin, 'orders-fulfillment-api', ['orders', 'payments', 'audit_logs', 'profiles', 'inventory']));
app.get('/config', (_req, res) => res.json({ success: true, data: { laundry_kg_per_load: KG_PER_LOAD, unclaimed_laundry_days: 7, storage_fee_amount: null, currency: 'PHP', schedule_model: 'per-order scheduled_at' } }));

function parseSchedule(body) {
  const raw = body.scheduled_at;
  if (raw == null || raw === '') return { value: null };
  if (typeof raw !== 'string' || Number.isNaN(new Date(raw).getTime())) return { error: 'scheduled_at must be a valid ISO-8601 datetime.' };
  if (new Date(raw).getTime() <= Date.now()) return { error: 'scheduled_at must be in the future.' };
  return { value: new Date(raw).toISOString() };
}
function addDays(iso, days) { return new Date(new Date(iso).getTime() + days * 86400000).toISOString(); }
function present(row) {
  const d = detailsOf(row);
  const safeDetails = { ...d };
  delete safeDetails.legacy_record;
  delete safeDetails.legacy_migration_snapshots;
  const readyAt = d.ready_for_pickup_notified_at || null;
  const deadline = readyAt ? addDays(readyAt, 7) : null;
  return {
    ...row,
    service_type: typeOf(row) || row.service_type,
    status: canonicalStatus(row.status),
    order_details: safeDetails,
    order_type: String(typeOf(row) || '').toLowerCase(),
    transaction_source: d.transaction_source || 'Unclassified',
    service_arrangement: d.service_arrangement || null,
    fulfillment_type: row.fulfillment_mode,
    service_id: d.service_id || null,
    service_name: d.service_name || null,
    unit_price: d.unit_price ?? null,
    quantity: d.quantity ?? null,
    weight_kg: d.weight_kg ?? null,
    load_count: d.load_count ?? null,
    delivery_address: d.delivery_address || null,
    pickup_address: d.pickup_address || row.customer_address || null,
    schedule_notes: d.schedule_notes || null,
    detergent: d.detergent || null,
    fabric_conditioner: d.fabric_conditioner || null,
    bleach_requested: Boolean(d.bleach_requested),
    bleach: d.bleach || null,
    ready_for_pickup_notified_at: readyAt,
    unclaimed_after: deadline,
    is_unclaimed: Boolean(typeOf(row) === 'Laundry' && readyAt && Date.now() > new Date(deadline).getTime() && !['Completed', 'Cancelled'].includes(canonicalStatus(row.status))),
    notification: d.latest_notification || null
  };
}
async function logEvent(userId, action, entityType, entityId, details = {}, module = 'orders') {
  return writeAuditLog(userId, action, module, { ...details, entity_id: entityId || null, entity_type: entityType });
}
async function notify(userId, order, title, message, event = 'order_update') {
  if (!userId) return;
  await writeAuditLog(userId, title, 'notifications', {
    event: 'customer_notification', notification_type: event, order_id: order.id,
    title, message, is_read: false, created_at: now()
  });
}
async function recordStatus(order, oldStatus, newStatus, actorId, note) {
  await logEvent(actorId, `Order status: ${oldStatus || 'Created'} → ${newStatus}`, 'order', order.id, {
    event: 'order_status_changed', order_id: order.id, service_type: order.service_type,
    old_status: oldStatus || null, new_status: newStatus, note: note || null
  });
}
async function getOrder(id) {
  const { data, error } = await supabaseAdmin.from('orders').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data && typeOf(data) ? data : null;
}
async function getInventoryItem(id, serviceType = null) {
  if (!isUuid(id)) return null;
  let q = supabaseAdmin.from('inventory').select('id,item_name,service_type,category,description,unit,stock_quantity,selling_price,availability').eq('id', id).eq('availability', true);
  if (serviceType) q = q.eq('service_type', serviceType);
  const { data, error } = await q.maybeSingle();
  if (error) throw error;
  return data;
}
async function validateLaundryOption(id, kind) {
  if (!id) return null;
  const item = await getInventoryItem(id, 'Laundry');
  const label = `${item?.item_name || ''} ${item?.category || ''}`.toLowerCase();
  if (!item || !label.includes(kind)) throw new Error(`Choose an available Laundry ${kind} from inventory.`);
  return { id: item.id, item_name: item.item_name };
}
async function createOrder(req, res, source) {
  const b = req.body || {};
  const serviceType = b.service_type;
  if (!['Water', 'Laundry'].includes(serviceType)) return fail(res, 422, 'service_type must be Water or Laundry.');
  const arrangementId = b.service_arrangement;
  const arrangement = ARRANGEMENTS[serviceType][arrangementId];
  if (!arrangement) return fail(res, 422, `Invalid ${serviceType} service_arrangement.`);
  if (source === 'Online' && arrangement.staffOnly) return fail(res, 403, 'This arrangement is available to staff-encoded walk-in transactions only.');
  if (source === 'Walk-in' && !isManager(req.user)) return fail(res, 403, 'Only staff/admin may encode walk-in transactions.');

  let customerId = source === 'Online' ? req.user.id : (b.customer_id || null);
  let linkedCustomer = null;
  if (customerId && !isUuid(customerId)) return fail(res, 422, 'customer_id must be a valid UUID.');
  if (source === 'Walk-in' && customerId) {
    const { data: profile, error } = await supabaseAdmin.from('profiles').select('id,role,full_name,phone,default_address').eq('id', customerId).maybeSingle();
    if (error) throw error;
    if (!profile || profile.role !== 'customer') return fail(res, 404, 'Customer profile not found.');
    linkedCustomer = profile;
  }
  if (source === 'Walk-in' && !customerId && (typeof b.customer_name !== 'string' || !b.customer_name.trim())) return fail(res, 422, 'customer_name is required for an unregistered walk-in customer.');

  const schedule = parseSchedule(b);
  if (schedule.error) return fail(res, 422, schedule.error);
  const deliveryAddress = typeof b.delivery_address === 'string' ? b.delivery_address.trim() : '';
  const pickupAddress = typeof b.pickup_address === 'string' ? b.pickup_address.trim() : '';
  if (arrangement.delivery && !deliveryAddress) return fail(res, 422, 'delivery_address is required for this arrangement.');
  if (arrangement.pickup && !pickupAddress) return fail(res, 422, 'pickup_address is required for home pickup.');
  if (b.schedule_notes != null && typeof b.schedule_notes !== 'string') return fail(res, 422, 'schedule_notes must be a string or null.');
  if (b.notes != null && typeof b.notes !== 'string') return fail(res, 422, 'notes must be a string or null.');

  const service = await getInventoryItem(b.service_id, serviceType);
  if (!service) return fail(res, 409, 'Select an available service from the current catalog.');
  let quantity, loadCount = null, total;
  let stockTrackedWaterProduct = false;
  if (serviceType === 'Water') {
    quantity = Number(b.quantity);
    if (!Number.isInteger(quantity) || quantity < 1) return fail(res, 422, 'quantity must be a positive whole number.');
    const serviceName = `${service.item_name} ${service.category || ''}`.toLowerCase();
    stockTrackedWaterProduct = /gallon|cap|inlet|handle|dispenser|accessor/.test(serviceName) && !/refill|delivery/.test(serviceName);
    if (stockTrackedWaterProduct && Number(service.stock_quantity || 0) < quantity) return fail(res, 409, 'The selected Water product does not have enough stock.');
    if (serviceName.includes('bulk') && (source !== 'Walk-in' || quantity < 10)) return fail(res, 422, 'Bulk Water Refill is available only for walk-in orders of at least 10 gallons.');
    total = Number((Number(service.selling_price) * quantity).toFixed(2));
  } else {
    quantity = Number(b.weight_kg);
    if (!Number.isFinite(quantity) || quantity <= 0) return fail(res, 422, 'weight_kg must be greater than zero.');
    const pricing = calculateLaundryPricing(quantity, Number(service.selling_price), KG_PER_LOAD);
    loadCount = pricing.loadCount;
    total = pricing.totalAmount;
  }

  let detergent = null, conditioner = null, bleach = null;
  if (serviceType === 'Laundry') {
    detergent = await validateLaundryOption(b.detergent_id, 'detergent');
    conditioner = await validateLaundryOption(b.fabric_conditioner_id, 'conditioner');
    if (b.bleach_requested !== undefined && typeof b.bleach_requested !== 'boolean') return fail(res, 422, 'bleach_requested must be boolean.');
    if (b.bleach_requested) {
      bleach = await validateLaundryOption(b.bleach_id, 'bleach');
      if (!bleach) return fail(res, 422, 'Select an available bleach product when bleach is requested.');
    }
  }

  const method = b.payment_method || (source === 'Walk-in' ? 'Cash' : 'Cash on Delivery (COD)');
  if (!PAYMENT_METHODS.includes(method)) return fail(res, 422, `payment_method must be one of: ${PAYMENT_METHODS.join(', ')}.`);
  if (source === 'Online' && method === 'Cash') return fail(res, 422, 'Online orders must use Cash on Delivery (COD) or GCash Online Payment.');
  if (method === 'GCash Online Payment' && !String(b.reference_number || '').trim() && !String(b.receipt_url || '').trim()) return fail(res, 422, 'Provide a GCash reference number or receipt URL.');
  if (b.receipt_url) {
    try { const u = new URL(b.receipt_url); if (!['http:', 'https:'].includes(u.protocol)) throw new Error(); }
    catch { return fail(res, 422, 'receipt_url must be a valid HTTP(S) URL.'); }
  }

  const stamp = now();
  const customerName = source === 'Online' ? req.user.full_name : (b.customer_name?.trim() || linkedCustomer?.full_name || null);
  const customerPhone = source === 'Online' ? req.user.phone : (b.customer_phone?.trim() || linkedCustomer?.phone || null);
  const details = {
    transaction_source: source, service_arrangement: arrangementId,
    service_id: service.id, service_name: service.item_name, unit_price: Number(service.selling_price), stock_tracked_product: stockTrackedWaterProduct,
    quantity: serviceType === 'Water' ? quantity : null,
    weight_kg: serviceType === 'Laundry' ? quantity : null, load_count: loadCount,
    delivery_address: deliveryAddress || null, pickup_address: pickupAddress || null,
    schedule_notes: b.schedule_notes?.trim() || null, notes: b.notes?.trim() || null,
    detergent, fabric_conditioner: conditioner, bleach_requested: Boolean(b.bleach_requested), bleach,
    refill_type: b.refill_type || null, receipt_url: b.receipt_url || null,
  };
  const payload = {
    user_id: customerId,
    service_type: serviceType,
    order_details: details,
    fulfillment_mode: arrangement.fulfillment,
    scheduled_at: schedule.value,
    total_price: total,
    status: 'Pending',
    customer_name: customerName,
    customer_phone: customerPhone,
    customer_address: pickupAddress || (source === 'Online' ? req.user.default_address : linkedCustomer?.default_address || null),
    special_instructions: b.notes?.trim() || null,
    payment_status: source === 'Walk-in' && method === 'Cash' ? 'verified' : (method === 'GCash Online Payment' ? 'submitted' : 'pending'),
    created_by: req.user.id,
    updated_at: stamp
  };
  const { data: order, error: orderError } = await supabaseAdmin.from('orders').insert(payload).select('*').single();
  if (orderError) throw orderError;

  const paymentPayload = {
    order_id: order.id, payment_method: method, amount: total,
    payment_status: source === 'Walk-in' && method === 'Cash' ? 'verified' : (method === 'GCash Online Payment' ? 'submitted' : 'pending'),
    received_by: source === 'Walk-in' && method === 'Cash' ? req.user.id : null,
    reference_number: String(b.reference_number || '').trim() || null
  };
  const { data: payment, error: paymentError } = await supabaseAdmin.from('payments').insert(paymentPayload).select(PAYMENT_FIELDS).single();
  if (paymentError) {
    await supabaseAdmin.from('orders').delete().eq('id', order.id);
    throw paymentError;
  }
  if (stockTrackedWaterProduct) {
    const { error: stockError } = await supabaseAdmin.rpc('acs_adjust_inventory_stock', { p_item_id: service.id, p_direction: 'OUT', p_quantity: quantity });
    if (stockError) {
      await supabaseAdmin.from('payments').delete().eq('id', payment.id);
      await supabaseAdmin.from('orders').delete().eq('id', order.id);
      if (stockError.code === 'P0001') return fail(res, 409, 'The selected Water product no longer has enough stock.');
      throw stockError;
    }
    const { error: flagError } = await supabaseAdmin.from('orders').update({ inventory_deducted: true }).eq('id', order.id);
    if (flagError) {
      await supabaseAdmin.rpc('acs_adjust_inventory_stock', { p_item_id: service.id, p_direction: 'IN', p_quantity: quantity });
      await supabaseAdmin.from('payments').delete().eq('id', payment.id);
      await supabaseAdmin.from('orders').delete().eq('id', order.id);
      throw flagError;
    }
    order.inventory_deducted = true;
    await writeAuditLog(req.user.id, 'Water product stock deducted for order', 'inventory', { event: 'inventory_stock_movement', item_id: service.id, item_name: service.item_name, direction: 'OUT', quantity, unit: service.unit, order_id: order.id });
  }
  if (b.receipt_url || (source === 'Walk-in' && method === 'Cash')) {
    await writeAuditLog(req.user.id, 'Payment supporting information recorded', 'payments', {
      event: 'payment_metadata', payment_id: payment.id, order_id: order.id,
      receipt_url: b.receipt_url || null, verification_note: source === 'Walk-in' && method === 'Cash' ? 'Walk-in cash received by staff.' : null
    });
  }
  await recordStatus(order, null, 'Pending', req.user.id, 'Transaction created.');
  await logEvent(req.user.id, 'Transaction created', 'order', order.id, { event: 'transaction_created', transaction_source: source, service_arrangement: arrangementId, payment_id: payment.id, total_price: total });
  return res.status(201).json({ success: true, message: `${serviceType} transaction created.`, data: present(order), payment });
}

async function listOrders(req, res, managerOnly = false) {
  if (managerOnly && !isManager(req.user)) return fail(res, 403, 'Staff/admin access required.');
  try {
    let q = supabaseAdmin.from('orders').select('*').order('created_at', { ascending: false }).limit(500);
    if (!isManager(req.user)) q = q.eq('user_id', req.user.id);
    if (req.query.customer_id) {
      if (!isManager(req.user) || !isUuid(req.query.customer_id)) return fail(res, 400, 'customer_id filter is staff/admin-only and must be a UUID.');
      q = q.eq('user_id', req.query.customer_id);
    }
    if (req.query.service_type && !['Water', 'Laundry'].includes(req.query.service_type)) return fail(res, 400, 'service_type must be Water or Laundry.');
    if (req.query.status && req.query.status !== 'ALL' && !STATUSES.includes(req.query.status)) return fail(res, 400, 'Invalid status filter.')
    for (const key of ['from', 'to']) {
      if (req.query[key] && !/^\d{4}-\d{2}-\d{2}$/.test(req.query[key])) return fail(res, 400, `${key} must use YYYY-MM-DD.`);
    }
    if (req.query.from) q = q.gte('created_at', `${req.query.from}T00:00:00+08:00`);
    if (req.query.to) q = q.lte('created_at', `${req.query.to}T23:59:59+08:00`);
    const { data, error } = await q;
    if (error) throw error;
    let rows = (data || []).filter(row => typeOf(row)).map(present);
    if (req.query.service_type) rows = rows.filter(r => r.service_type === req.query.service_type);
    if (req.query.status && req.query.status !== 'ALL') rows = rows.filter(r => r.status === req.query.status);
    if (req.query.transaction_source) rows = rows.filter(r => r.transaction_source === req.query.transaction_source);
    if (req.query.service_arrangement) rows = rows.filter(r => r.service_arrangement === req.query.service_arrangement);
    return res.json({ success: true, count: rows.length, data: rows });
  } catch (e) { console.error('order list:', e.message); return fail(res, 500, 'Could not retrieve orders.'); }
}

app.get('/api/orders', authenticate, (req, res) => listOrders(req, res));
app.get('/api/transactions', authenticate, authorize('staff', 'admin'), (req, res) => listOrders(req, res, true));
app.post('/api/orders', authenticate, async (req, res, next) => { try { if (isManager(req.user)) return fail(res, 403, 'Use POST /api/transactions to encode a Walk-in transaction.'); return await createOrder(req, res, 'Online'); } catch (e) { next(e); } });
app.post('/api/transactions', authenticate, authorize('staff', 'admin'), async (req, res, next) => { try { return await createOrder(req, res, 'Walk-in'); } catch (e) { next(e); } });

app.get(['/api/orders/:id', '/api/transactions/:id'], authenticate, async (req, res) => {
  if (!isUuid(req.params.id)) return fail(res, 400, 'Order id must be a valid UUID.');
  try {
    const order = await getOrder(req.params.id);
    if (!order) return fail(res, 404, 'Order not found.');
    if (!isManager(req.user) && order.user_id !== req.user.id) return fail(res, 403, 'You cannot view another customer\'s order.');
    const [payment, history] = await Promise.all([
      supabaseAdmin.from('payments').select(PAYMENT_FIELDS).eq('order_id', order.id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      supabaseAdmin.from('audit_logs').select('id,user_id,action,details,created_at').eq('entity_type', 'order').eq('entity_id', order.id).order('created_at', { ascending: true })
    ]);
    if (payment.error) throw payment.error;
    if (history.error) throw history.error;
    return res.json({ success: true, data: { ...present(order), payment: payment.data, status_history: history.data || [] } });
  } catch (e) { console.error('order detail:', e.message); return fail(res, 500, 'Could not retrieve order.'); }
});

async function updateOrder(req, res) {
  if (!isUuid(req.params.id)) return fail(res, 400, 'Order id must be a valid UUID.');
  try {
    const current = await getOrder(req.params.id);
    if (!current) return fail(res, 404, 'Order not found.');
    const manager = isManager(req.user);
    if (!manager && current.user_id !== req.user.id) return fail(res, 403, 'You cannot update another customer\'s order.');
    const b = req.body || {};
    const oldStatus = canonicalStatus(current.status);
    const updates = { updated_at: now() };
    const details = { ...detailsOf(current) };
    if (b.status !== undefined) {
      if (!manager) return fail(res, 403, 'Only staff/admin can change order status.');
      if (!STATUSES.includes(b.status) || !TRANSITIONS[oldStatus]?.includes(b.status)) return fail(res, 422, `Invalid status transition from ${oldStatus} to ${b.status}.`);
      updates.status = b.status;
      if (b.status === 'Ready for Station Pickup' && current.service_type === 'Laundry') details.ready_for_pickup_notified_at = now();
    }
    if (manager && b.scheduled_at !== undefined) {
      const schedule = parseSchedule({ scheduled_at: b.scheduled_at });
      if (schedule.error) return fail(res, 422, schedule.error);
      updates.scheduled_at = schedule.value;
    }
    if (!manager && b.status === 'Cancelled') return fail(res, 403, 'Use DELETE /api/orders/:id to request cancellation.');
    if (b.notes !== undefined) {
      if (typeof b.notes !== 'string' && b.notes !== null) return fail(res, 422, 'notes must be a string or null.');
      if (manager) updates.special_instructions = b.notes;
      else details.notes = b.notes;
    }
    if (b.schedule_notes !== undefined) details.schedule_notes = b.schedule_notes;
    updates.order_details = details;
    const { data, error } = await supabaseAdmin.from('orders').update(updates).eq('id', current.id).select('*').single();
    if (error) throw error;
    if (updates.status && updates.status !== oldStatus) {
      await recordStatus(current, oldStatus, updates.status, req.user.id, b.note);
      await notify(current.user_id, data, `Order ${updates.status}`, b.note || `Your ${current.service_type.toLowerCase()} order is now ${updates.status}.`, 'status');
    }
    return res.json({ success: true, message: 'Order updated.', data: present(data) });
  } catch (e) { console.error('order update:', e.message); return fail(res, 500, 'Could not update order.'); }
}
app.patch(['/api/orders/:id', '/api/transactions/:id'], authenticate, updateOrder);
app.put(['/api/orders/:id', '/api/transactions/:id'], authenticate, updateOrder);

app.delete('/api/orders/:id', authenticate, async (req, res) => {
  if (!isUuid(req.params.id)) return fail(res, 400, 'Order id must be a valid UUID.');
  try {
    const order = await getOrder(req.params.id);
    if (!order) return fail(res, 404, 'Order not found.');
    if (!isManager(req.user) && order.user_id !== req.user.id) return fail(res, 403, 'You cannot cancel another customer\'s order.');
    if (!['Pending', 'In Progress'].includes(canonicalStatus(order.status))) return fail(res, 409, 'This order can no longer be cancelled.');
    const orderDetails = detailsOf(order);
    if (order.inventory_deducted && !order.inventory_restored && orderDetails.stock_tracked_product && orderDetails.service_id && Number(orderDetails.quantity) > 0) {
      const { error: restoreError } = await supabaseAdmin.rpc('acs_adjust_inventory_stock', { p_item_id: orderDetails.service_id, p_direction: 'IN', p_quantity: Number(orderDetails.quantity) });
      if (restoreError) throw restoreError;
    }
    const { data, error } = await supabaseAdmin.from('orders').update({ status: 'Cancelled', updated_at: now(), inventory_restored: Boolean(order.inventory_deducted && orderDetails.stock_tracked_product) }).eq('id', order.id).select('*').single();
    if (error) throw error;
    if (order.inventory_deducted && orderDetails.stock_tracked_product) await writeAuditLog(req.user.id, 'Water product stock restored after order cancellation', 'inventory', { event: 'inventory_stock_movement', item_id: orderDetails.service_id, direction: 'IN', quantity: Number(orderDetails.quantity), order_id: order.id });
    await recordStatus(order, canonicalStatus(order.status), 'Cancelled', req.user.id, 'Cancellation requested.');
    await notify(order.user_id, data, 'Order cancelled', 'Your order has been cancelled.', 'status');
    return res.json({ success: true, message: 'Order cancelled.', data: present(data) });
  } catch (e) { console.error('order cancel:', e.message); return fail(res, 500, 'Could not cancel order.'); }
});

// Schedules are stored directly on orders.scheduled_at. No slot table is used.
app.get(['/delivery-schedules', '/api/delivery-schedules'], authenticate, authorize('staff', 'admin'), async (_req, res) => {
  try {
    const { data, error } = await supabaseAdmin.from('orders').select('id,service_type,fulfillment_mode,scheduled_at,status,user_id,customer_name,customer_phone,customer_address,order_details').not('scheduled_at', 'is', null).order('scheduled_at', { ascending: true }).limit(250);
    if (error) throw error;
    const rows = (data || []).filter(row => typeOf(row)).map(present);
    return res.json({ success: true, count: rows.length, data: rows });
  } catch (e) { console.error('schedule queue:', e.message); return fail(res, 500, 'Could not retrieve scheduled orders.'); }
});
app.patch(['/delivery-schedules/:id', '/api/delivery-schedules/:id'], authenticate, authorize('staff', 'admin'), async (req, res) => {
  if (!isUuid(req.params.id)) return fail(res, 400, 'Order id must be a UUID.');
  const schedule = parseSchedule(req.body || {});
  if (schedule.error) return fail(res, 422, schedule.error);
  try {
    const { data, error } = await supabaseAdmin.from('orders').update({ scheduled_at: schedule.value, updated_at: now() }).eq('id', req.params.id).select('*').maybeSingle();
    if (error) throw error;
    if (!data || !typeOf(data)) return fail(res, 404, 'Water/Laundry order not found.');
    await logEvent(req.user.id, 'Order schedule updated', 'order', data.id, { event: 'schedule_updated', scheduled_at: schedule.value });
    return res.json({ success: true, data: present(data) });
  } catch (e) { console.error('schedule update:', e.message); return fail(res, 500, 'Could not update order schedule.'); }
});
app.delete(['/delivery-schedules/:id', '/api/delivery-schedules/:id'], authenticate, authorize('staff', 'admin'), async (req, res) => {
  if (!isUuid(req.params.id)) return fail(res, 400, 'Order id must be a UUID.');
  try {
    const { data, error } = await supabaseAdmin.from('orders').update({ scheduled_at: null, updated_at: now() }).eq('id', req.params.id).select('*').maybeSingle();
    if (error) throw error;
    if (!data) return fail(res, 404, 'Order not found.');
    await logEvent(req.user.id, 'Order schedule cleared', 'order', data.id, { event: 'schedule_cleared' });
    return res.json({ success: true, data: present(data) });
  } catch (e) { console.error('schedule clear:', e.message); return fail(res, 500, 'Could not clear schedule.'); }
});

app.get(['/notifications', '/api/notifications'], authenticate, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin.from('audit_logs').select('id,user_id,action,entity_id,details,created_at').eq('user_id', req.user.id).eq('entity_type', 'notification').order('created_at', { ascending: false }).limit(50);
    if (error) throw error;
    const rows = (data || []).filter(r => detailsOf({ order_details: r.details }).event === 'customer_notification');
    const filtered = req.query.unread === 'true' ? rows.filter(r => !r.details?.is_read) : rows;
    return res.json({ success: true, count: filtered.length, data: filtered.map(r => ({ id: r.id, order_id: r.details.order_id, title: r.details.title, message: r.details.message, is_read: Boolean(r.details.is_read), created_at: r.created_at, read_at: r.details.read_at || null })) });
  } catch (e) { console.error('notifications:', e.message); return fail(res, 500, 'Could not retrieve notifications.'); }
});
app.patch(['/notifications/:id/read', '/api/notifications/:id/read'], authenticate, async (req, res) => {
  if (!isUuid(req.params.id)) return fail(res, 400, 'Notification id must be a UUID.');
  try {
    const { data: row, error } = await supabaseAdmin.from('audit_logs').select('*').eq('id', req.params.id).eq('user_id', req.user.id).eq('entity_type', 'notification').maybeSingle();
    if (error) throw error;
    if (!row) return fail(res, 404, 'Notification not found.');
    const details = { ...(row.details || {}), is_read: true, read_at: now() };
    const { data, error: updateError } = await supabaseAdmin.from('audit_logs').update({ details }).eq('id', row.id).select('id,details,created_at').single();
    if (updateError) throw updateError;
    return res.json({ success: true, data: { id: data.id, ...data.details, created_at: data.created_at } });
  } catch (e) { console.error('notification read:', e.message); return fail(res, 500, 'Could not mark notification as read.'); }
});

app.post(['/payments', '/api/payments'], authenticate, async (req, res) => {
  const b = req.body || {};
  if (!isUuid(b.order_id) || !PAYMENT_METHODS.includes(b.payment_method)) return fail(res, 422, 'Valid order_id and payment_method are required.');
  try {
    const order = await getOrder(b.order_id);
    if (!order) return fail(res, 404, 'Order not found.');
    if (!isManager(req.user) && order.user_id !== req.user.id) return fail(res, 403, 'You cannot pay another customer\'s order.');
    const source = detailsOf(order).transaction_source;
    if (source === 'Online' && b.payment_method === 'Cash') return fail(res, 422, 'Online orders must use Cash on Delivery (COD) or GCash Online Payment.');
    if (b.payment_method === 'GCash Online Payment' && !String(b.reference_number || '').trim() && !String(b.receipt_url || '').trim()) return fail(res, 422, 'Provide a GCash reference number or receipt URL.');
    if (b.receipt_url) { try { const u = new URL(b.receipt_url); if (!['http:', 'https:'].includes(u.protocol)) throw new Error(); } catch { return fail(res, 422, 'receipt_url must be a valid HTTP(S) URL.'); } }
    const status = source === 'Walk-in' && b.payment_method === 'Cash' ? 'verified' : (b.payment_method === 'GCash Online Payment' ? 'submitted' : 'pending');
    const { data: existing, error: lookupError } = await supabaseAdmin.from('payments').select(PAYMENT_FIELDS).eq('order_id', order.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (lookupError) throw lookupError;
    if (existing?.payment_status === 'verified') return fail(res, 409, 'This order already has a verified payment.');
    const payload = { order_id: order.id, payment_method: b.payment_method, amount: Number(order.total_price), payment_status: status, received_by: status === 'verified' ? req.user.id : null, reference_number: String(b.reference_number || '').trim() || null };
    let payment, error, created = false;
    if (existing) {
      ({ data: payment, error } = await supabaseAdmin.from('payments').update({ payment_method: payload.payment_method, payment_status: payload.payment_status, received_by: payload.received_by, reference_number: payload.reference_number }).eq('id', existing.id).select(PAYMENT_FIELDS).single());
    } else {
      ({ data: payment, error } = await supabaseAdmin.from('payments').insert(payload).select(PAYMENT_FIELDS).single());
      created = true;
    }
    if (error) throw error;
    const { error: orderUpdateError } = await supabaseAdmin.from('orders').update({ payment_status: status, updated_at: now() }).eq('id', order.id);
    if (orderUpdateError) throw orderUpdateError;
    if (b.receipt_url || status === 'verified') await writeAuditLog(req.user.id, 'Payment supporting information recorded', 'payments', { event: 'payment_metadata', payment_id: payment.id, order_id: order.id, receipt_url: b.receipt_url || null, verification_note: status === 'verified' ? 'Walk-in cash received by staff.' : null });
    return res.status(created ? 201 : 200).json({ success: true, data: payment });
  } catch (e) { console.error('payment create/update:', e.message); return fail(res, 500, 'Could not record payment.'); }
});
app.get(['/payments/:id', '/api/payments/:id'], authenticate, async (req, res) => {
  if (!isUuid(req.params.id)) return fail(res, 400, 'Payment id must be a UUID.');
  try {
    const { data, error } = await supabaseAdmin.from('payments').select(PAYMENT_FIELDS).eq('id', req.params.id).maybeSingle();
    if (error) throw error;
    if (!data) return fail(res, 404, 'Payment not found.');
    const order = await getOrder(data.order_id);
    if (!order || (!isManager(req.user) && order.user_id !== req.user.id)) return fail(res, 403, 'You cannot view this payment.');
    return res.json({ success: true, data });
  } catch (e) { console.error('payment detail:', e.message); return fail(res, 500, 'Could not retrieve payment.'); }
});
app.patch(['/payments/:id/status', '/api/payments/:id/status'], authenticate, authorize('staff', 'admin'), async (req, res) => {
  if (!isUuid(req.params.id)) return fail(res, 400, 'Payment id must be a UUID.');
  const status = req.body?.payment_status;
  const note = req.body?.verification_note;
  if (!['verified', 'rejected', 'pending', 'submitted'].includes(status)) return fail(res, 422, 'Invalid payment_status.');
  if (['verified', 'rejected'].includes(status) && (typeof note !== 'string' || !note.trim())) return fail(res, 422, 'verification_note is required when verifying or rejecting a payment.');
  try {
    const { data, error } = await supabaseAdmin.from('payments').update({ payment_status: status, received_by: req.user.id }).eq('id', req.params.id).select(PAYMENT_FIELDS).maybeSingle();
    if (error) throw error;
    if (!data) return fail(res, 404, 'Payment not found.');
    await supabaseAdmin.from('orders').update({ payment_status: status, updated_at: now() }).eq('id', data.order_id);
    await writeAuditLog(req.user.id, `Payment ${status}`, 'payments', { event: 'payment_verification', payment_id: data.id, order_id: data.order_id, payment_status: status, verification_note: note || null });
    return res.json({ success: true, data });
  } catch (e) { console.error('payment verification:', e.message); return fail(res, 500, 'Could not update payment status.'); }
});

app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) return fail(res, 400, 'Request body contains invalid JSON.');
  console.error('Orders API error:', err.message);
  return fail(res, 500, 'An unexpected server error occurred.');
});
module.exports = app;
