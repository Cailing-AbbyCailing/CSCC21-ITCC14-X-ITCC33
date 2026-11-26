require('../shared/supabase');
const express = require('express');
const cors = require('cors');
const { supabaseAdmin } = require('../shared/supabase');
const { respondWithDatabaseHealth } = require('../shared/health');
const { authenticate, optionalAuthenticate, authorize } = require('../shared/authMiddleware');
const { corsOptions } = require('../shared/serverConfig');
const { calculateLaundryPricing } = require('../shared/pricing');
const { writeAuditLog } = require('../shared/audit');

const app = express();
const PORT = Number(process.env.ORDERS_PORT || 3003);
const PAYMENT_METHODS = ['Cash on Delivery (COD)', 'GCash Online Payment'];
const ORDER_TYPES = ['water', 'laundry'];
// MAX_LAUNDRY_KG is the maximum weight in one customer booking. Each machine load
// is separately limited by LAUNDRY_KG_PER_LOAD and partial loads are rounded up.
const MAX_LAUNDRY_KG = Number(process.env.MAX_LAUNDRY_KG || 20);
const LAUNDRY_KG_PER_LOAD = Number(process.env.LAUNDRY_KG_PER_LOAD || 7);
if (!Number.isFinite(MAX_LAUNDRY_KG) || MAX_LAUNDRY_KG <= 0) {
    throw new Error('MAX_LAUNDRY_KG must be a positive number.');
}
if (!Number.isFinite(LAUNDRY_KG_PER_LOAD) || LAUNDRY_KG_PER_LOAD <= 0) {
    throw new Error('LAUNDRY_KG_PER_LOAD must be a positive number.');
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isUuid = value => UUID_RE.test(String(value || ''));
const isManager = user => ['staff', 'admin'].includes(user?.role);
const statusTransitions = {
    'Pending': ['In Progress', 'Cancelled'],
    'In Progress': ['Out for Delivery', 'Ready for Station Pickup', 'Completed', 'Cancelled'],
    'Out for Delivery': ['Completed', 'Cancelled'],
    'Ready for Station Pickup': ['Completed', 'Cancelled'],
    'Completed': [],
    'Cancelled': []
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' }));
app.get('/', (req, res) => res.json({ success: true, service: 'orders-fulfillment-api', message: 'Alavanza Orders & Fulfillment API is running.' }));
app.get('/health', (req, res) => respondWithDatabaseHealth(res, supabaseAdmin, 'orders-fulfillment-api', ['delivery_schedule_slots', 'water_orders', { table: 'laundry_bookings', columns: 'id,user_id,weight_kg,unit_price,total_amount,load_count,schedule_id' }, 'order_payments']));
app.get('/config', (req, res) => res.json({ success: true, data: { max_laundry_kg: MAX_LAUNDRY_KG, laundry_kg_per_load: LAUNDRY_KG_PER_LOAD, currency: 'PHP' } }));

function fail(res, status, message, extra = {}) {
    return res.status(status).json({ success: false, message, ...extra });
}

function orderTable(type) {
    return type === 'water' ? 'water_orders' : 'laundry_bookings';
}

function orderLabel(type) {
    return type === 'water' ? 'Water order' : 'Laundry booking';
}

async function audit(userId, action, moduleName = 'orders', details = null) {
    return writeAuditLog(userId, action, moduleName, details);
}

async function getOrder(type, id) {
    const { data, error } = await supabaseAdmin.from(orderTable(type)).select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return data;
}

async function getService(serviceId, expectedType) {
    const { data, error } = await supabaseAdmin.from('inventory')
        .select('id,item_name,service_type,unit,selling_price,availability')
        .eq('id', serviceId).maybeSingle();
    if (error) throw error;
    if (!data || data.availability !== true || data.service_type !== expectedType) return null;
    return data;
}

async function getSlot(slotId, serviceType, fulfillmentType) {
    if (!isUuid(slotId)) return null;
    const { data, error } = await supabaseAdmin.from('delivery_schedule_slots')
        .select('*').eq('id', slotId).eq('service_type', serviceType)
        .eq('fulfillment_type', fulfillmentType).eq('is_active', true).maybeSingle();
    if (error) throw error;
    return data && slotHasNotStarted(data) ? data : null;
}

async function getSlotByDateTime(scheduleDate, deliveryTime, serviceType, fulfillmentType) {
    if (!parseDate(scheduleDate) || !parseTime(deliveryTime)) return null;
    const { data, error } = await supabaseAdmin.from('delivery_schedule_slots')
        .select('*').eq('service_type', serviceType).eq('fulfillment_type', fulfillmentType)
        .eq('schedule_date', scheduleDate).eq('start_time', deliveryTime).eq('is_active', true).maybeSingle();
    if (error) throw error;
    return data && slotHasNotStarted(data) ? data : null;
}

async function reserveSlot(slotId) {
    const { data, error } = await supabaseAdmin.rpc('reserve_delivery_schedule_slot', { p_schedule_id: slotId });
    if (error) throw error;
    return data;
}

async function releaseSlot(slotId) {
    if (!slotId) return;
    const { error } = await supabaseAdmin.rpc('release_delivery_schedule_slot', { p_schedule_id: slotId });
    if (error) console.warn('Could not release schedule slot:', error.message);
}

async function createCustomerNotification(userId, orderType, orderId, title, message) {
    const { error } = await supabaseAdmin.from('customer_notifications').insert({
        user_id: userId, order_type: orderType, order_id: orderId, title, message
    });
    if (error) console.error('Customer notification could not be saved:', error.message);
}

async function addHistory(type, id, oldStatus, newStatus, changedBy, note) {
    const { error } = await supabaseAdmin.from('order_status_history').insert({
        order_type: type, order_id: id, old_status: oldStatus || null,
        new_status: newStatus, changed_by: changedBy || null, note: note || null
    });
    if (error) console.warn('Could not write order status history:', error.message);
}

function normalizePaymentMethod(value) {
    return PAYMENT_METHODS.includes(value) ? value : null;
}

function todayInManila() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function timeNowInManila() {
    return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
}
function slotHasNotStarted(slot) {
    const today = todayInManila();
    return slot.schedule_date > today || (slot.schedule_date === today && formatTime(slot.start_time) > timeNowInManila());
}
function parseDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function parseTime(value) {
    return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value);
}

function formatTime(value) {
    return String(value || '').slice(0, 5);
}

function addLinks(type, order) {
    const base = `/api/orders/${order.id}?order_type=${type}`;
    const typeBase = type === 'water' ? `/water-orders/${order.id}` : `/laundry-bookings/${order.id}`;
    return {
        ...order, order_type: type,
        _links: {
            self: { href: base, method: 'GET' },
            update: { href: base, method: 'PUT' },
            cancel: { href: base, method: 'DELETE' },
            type_resource: { href: typeBase, method: 'GET' }
        }
    };
}

async function createOrder(type, req, res) {
    const body = req.body || {};
    if (isManager(req.user) && !body.customer_id) return fail(res, 422, 'Staff/admin-created orders must include a customer_id.');
    const customerId = isManager(req.user) ? body.customer_id : req.user.id;
    if (!isUuid(customerId)) return fail(res, 400, 'customer_id must be a valid UUID.');
    if (isManager(req.user)) {
        const { data: targetCustomer, error: customerError } = await supabaseAdmin.from('profiles').select('id,role').eq('id', customerId).maybeSingle();
        if (customerError) return fail(res, 500, 'Could not validate the selected customer.');
        if (!targetCustomer || targetCustomer.role !== 'customer') return fail(res, 404, 'The selected customer account was not found.');
    }

    for (const field of ['notes', 'detergent', 'fabric_conditioner']) {
        if (body[field] !== undefined && body[field] !== null && typeof body[field] !== 'string') {
            return fail(res, 422, `${field} must be a string or null.`);
        }
    }
    const serviceId = body.service_id;
    if (!isUuid(serviceId)) return fail(res, 422, 'Select a valid service from the current catalog.');

    const expectedServiceType = type === 'water' ? 'Water' : 'Laundry';
    let quantity;
    if (type === 'water') {
        quantity = Number(body.quantity);
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > 500) return fail(res, 422, 'quantity must be a whole number between 1 and 500.');
    } else {
        quantity = Number(body.weight_kg);
        if (!Number.isFinite(quantity) || quantity <= 0) return fail(res, 422, 'weight_kg must be greater than 0.');
        if (quantity > MAX_LAUNDRY_KG) return fail(res, 422, `Maximum laundry booking weight is ${MAX_LAUNDRY_KG} kg. A machine load holds up to ${LAUNDRY_KG_PER_LOAD} kg.`, { code: 'LAUNDRY_MAX_WEIGHT_EXCEEDED', max_weight_kg: MAX_LAUNDRY_KG, kg_per_load: LAUNDRY_KG_PER_LOAD });
    }

    const fulfillmentType = body.fulfillment_type || 'delivery';
    if (!['delivery', 'station_pickup'].includes(fulfillmentType)) return fail(res, 422, 'fulfillment_type must be delivery or station_pickup.');
    const deliveryAddress = typeof body.delivery_address === 'string' ? body.delivery_address.trim() : '';
    if (fulfillmentType === 'delivery' && !deliveryAddress) return fail(res, 422, 'delivery_address is required for home delivery.');

    const paymentMethod = normalizePaymentMethod(body.payment_method);
    if (!paymentMethod) return fail(res, 422, 'Choose Cash on Delivery (COD) or GCash Online Payment.');
    if (body.reference_number !== undefined && body.reference_number !== null && typeof body.reference_number !== 'string') return fail(res, 422, 'reference_number must be a string or null.');
    if (body.receipt_url !== undefined && body.receipt_url !== null && typeof body.receipt_url !== 'string') return fail(res, 422, 'receipt_url must be a string or null.');
    const referenceNumber = typeof body.reference_number === 'string' ? body.reference_number.trim() : null;
    const receiptUrl = typeof body.receipt_url === 'string' ? body.receipt_url.trim() : null;
    if (receiptUrl) {
        let parsedReceiptUrl;
        try { parsedReceiptUrl = new URL(receiptUrl); } catch { return fail(res, 422, 'receipt_url must be a valid HTTP(S) URL.'); }
        if (!['http:', 'https:'].includes(parsedReceiptUrl.protocol)) return fail(res, 422, 'receipt_url must be a valid HTTP(S) URL.');
    }
    if (paymentMethod === 'GCash Online Payment' && !referenceNumber && !receiptUrl) {
        return fail(res, 422, 'For GCash, provide a reference number or receipt URL before submitting the order.');
    }

    let selectedSlot = null;
    if (body.schedule_id !== undefined) {
        if (!isUuid(body.schedule_id)) return fail(res, 422, 'schedule_id must be a valid UUID.');
        selectedSlot = await getSlot(body.schedule_id, expectedServiceType, fulfillmentType);
    } else if (body.delivery_date !== undefined || body.delivery_time !== undefined) {
        selectedSlot = await getSlotByDateTime(body.delivery_date, body.delivery_time, expectedServiceType, fulfillmentType);
    }
    if (!selectedSlot) return fail(res, 422, 'Choose a valid available schedule_id, or provide a matching delivery_date and delivery_time from the published schedule.');

    let reserved = false;
    try {
        const service = await getService(serviceId, expectedServiceType);
        const slot = selectedSlot;
        if (!service) return fail(res, 409, 'The selected service is unavailable or does not match this order type. Refresh the service catalog.');
        if (!slot) return fail(res, 409, 'The selected schedule is unavailable. Refresh the available schedules.');

        // Date and time are authoritative from the published schedule, never a client-supplied price.
        await reserveSlot(slot.id);
        reserved = true;
        // Laundry inventory selling_price is the price per full/partial machine load.
        // Water remains priced per catalog unit.
        const unitPrice = Number(service.selling_price);
        const laundryPricing = type === 'laundry'
            ? calculateLaundryPricing(quantity, unitPrice, LAUNDRY_KG_PER_LOAD)
            : null;
        const loadCount = laundryPricing?.loadCount ?? null;
        const totalAmount = laundryPricing?.totalAmount ?? Number((unitPrice * quantity).toFixed(2));
        const common = {
            user_id: customerId,
            service_id: service.id,
            service_name: service.item_name,
            unit_price: unitPrice,
            total_amount: totalAmount,
            fulfillment_type: fulfillmentType,
            delivery_address: fulfillmentType === 'delivery' ? deliveryAddress : null,
            delivery_date: slot.schedule_date,
            delivery_time: formatTime(slot.start_time),
            schedule_id: slot.id,
            payment_method: paymentMethod,
            status: 'Pending',
            notes: typeof body.notes === 'string' ? body.notes.trim() || null : null
        };
        const orderPayload = type === 'water'
            ? { ...common, quantity }
            : {
                ...common,
                weight_kg: quantity,
                load_count: loadCount,
                detergent: typeof body.detergent === 'string' ? body.detergent.trim() || null : null,
                fabric_conditioner: typeof body.fabric_conditioner === 'string' ? body.fabric_conditioner.trim() || null : null
            };
        const { data: order, error: orderError } = await supabaseAdmin.from(orderTable(type)).insert(orderPayload).select('*').single();
        if (orderError) throw orderError;

        const paymentPayload = {
            order_type: type,
            order_id: order.id,
            user_id: customerId,
            payment_method: paymentMethod,
            amount: totalAmount,
            payment_status: paymentMethod === 'GCash Online Payment' && (referenceNumber || receiptUrl) ? 'submitted' : 'pending',
            reference_number: referenceNumber || null,
            receipt_url: receiptUrl || null
        };
        const { data: payment, error: paymentError } = await supabaseAdmin.from('order_payments').insert(paymentPayload).select('*').single();
        if (paymentError) {
            await supabaseAdmin.from(orderTable(type)).delete().eq('id', order.id);
            await releaseSlot(slot.id);
            reserved = false;
            throw paymentError;
        }

        await addHistory(type, order.id, null, 'Pending', req.user.id, 'Order created.');
        await audit(req.user.id, `Created ${type} order ${order.id}`);
        reserved = false;
        return res.status(201).json({
            success: true,
            message: `${orderLabel(type)} created successfully.`,
            data: { ...addLinks(type, order), payment: { id: payment.id, payment_status: payment.payment_status } }
        });
    } catch (error) {
        if (reserved) await releaseSlot(selectedSlot?.id);
        console.error(`${type} order creation failed:`, error.message);
        const conflict = /slot|schedule|available/i.test(error.message || '');
        return fail(res, conflict ? 409 : 500, conflict ? 'The selected schedule is full or no longer available.' : 'Could not create the order. Check the database migration and required service/schedule records.');
    }
}

async function listOrders(type, req, res) {
    try {
        let query = supabaseAdmin.from(orderTable(type)).select('*').order('created_at', { ascending: false });
        if (!isManager(req.user)) query = query.eq('user_id', req.user.id);
        if (req.query.status && req.query.status !== 'ALL') {
            const allowedStatuses = Object.keys(statusTransitions);
            if (!allowedStatuses.includes(req.query.status)) return fail(res, 400, `status must be one of: ${allowedStatuses.join(', ')}.`);
            query = query.eq('status', req.query.status);
        }
        if (req.query.from) {
            if (!parseDate(req.query.from)) return fail(res, 400, 'from must use YYYY-MM-DD.');
            query = query.gte('delivery_date', req.query.from);
        }
        if (req.query.to) {
            if (!parseDate(req.query.to)) return fail(res, 400, 'to must use YYYY-MM-DD.');
            query = query.lte('delivery_date', req.query.to);
        }
        const { data, error } = await query.limit(250);
        if (error) throw error;
        let profiles = {};
        if (isManager(req.user) && data.length) {
            const ids = [...new Set(data.map(row => row.user_id))];
            const { data: people, error: profileError } = await supabaseAdmin.from('profiles').select('id,full_name,email,phone').in('id', ids);
            if (!profileError) profiles = Object.fromEntries((people || []).map(person => [person.id, person]));
        }
        const result = data.map(row => ({ ...addLinks(type, row), customer: profiles[row.user_id] || null }));
        return res.json({ success: true, count: result.length, data: result });
    } catch (error) {
        console.error(`${type} order list failed:`, error.message);
        return fail(res, 500, 'Could not retrieve orders. Apply supabase/remaining_apis_schema.sql first.');
    }
}

async function getOrderDetails(type, req, res) {
    if (!isUuid(req.params.id)) return fail(res, 400, 'Order id must be a valid UUID.');
    try {
        const order = await getOrder(type, req.params.id);
        if (!order || (!isManager(req.user) && order.user_id !== req.user.id)) return fail(res, 404, 'Order not found.');
        const [{ data: history }, { data: payment }] = await Promise.all([
            supabaseAdmin.from('order_status_history').select('*').eq('order_type', type).eq('order_id', order.id).order('created_at', { ascending: true }),
            supabaseAdmin.from('order_payments').select('*').eq('order_type', type).eq('order_id', order.id).maybeSingle()
        ]);
        return res.json({ success: true, data: { ...addLinks(type, order), status_history: history || [], payment: payment || null } });
    } catch (error) {
        console.error(`${type} order lookup failed:`, error.message);
        return fail(res, 500, 'Could not retrieve order details.');
    }
}

async function updateOrder(type, req, res) {
    if (!isUuid(req.params.id)) return fail(res, 400, 'Order id must be a valid UUID.');
    const body = req.body || {};
    let newSchedule = null;
    let newSlotReserved = false;
    try {
        const existing = await getOrder(type, req.params.id);
        if (!existing || (!isManager(req.user) && existing.user_id !== req.user.id)) return fail(res, 404, 'Order not found.');
        const manager = isManager(req.user);
        if (body.status !== undefined && !manager) return fail(res, 403, 'Only staff and administrators can update order status.');
        if (body.status_note !== undefined && body.status_note !== null && typeof body.status_note !== 'string') return fail(res, 422, 'status_note must be a string or null.');
        if (body.notes !== undefined && body.notes !== null && typeof body.notes !== 'string') return fail(res, 422, 'notes must be a string or null.');
        if (['Completed', 'Cancelled'].includes(existing.status)) return fail(res, 409, `A ${existing.status.toLowerCase()} order cannot be modified.`);
        if (!manager && existing.status !== 'Pending') return fail(res, 409, 'Only pending orders can be edited by the customer.');

        const updates = {};
        let requestedScheduleId = body.schedule_id;
        if (body.delivery_date !== undefined || body.delivery_time !== undefined) {
            if (body.delivery_date === undefined || body.delivery_time === undefined) return fail(res, 422, 'Provide both delivery_date and delivery_time when changing the schedule.');
            const slotByDateTime = await getSlotByDateTime(body.delivery_date, body.delivery_time, type === 'water' ? 'Water' : 'Laundry', existing.fulfillment_type);
            if (!slotByDateTime) return fail(res, 409, 'No available published schedule matches that date and time.');
            requestedScheduleId = slotByDateTime.id;
        }
        const scheduleChanged = requestedScheduleId !== undefined && requestedScheduleId !== existing.schedule_id;
        if (scheduleChanged) {
            if (!isUuid(requestedScheduleId)) return fail(res, 422, 'schedule_id must be a valid UUID.');
            if (!newSchedule) newSchedule = await getSlot(requestedScheduleId, type === 'water' ? 'Water' : 'Laundry', existing.fulfillment_type);
            if (!newSchedule) return fail(res, 409, 'The selected schedule is no longer available.');
        }

        if (manager && body.status !== undefined) {
            if (!statusTransitions[existing.status]?.includes(body.status)) return fail(res, 409, `Invalid status transition from ${existing.status} to ${body.status}.`);
            if (body.status === 'Out for Delivery' && existing.fulfillment_type !== 'delivery') return fail(res, 409, 'Only home-delivery orders can move to Out for Delivery.');
            if (body.status === 'Ready for Station Pickup' && existing.fulfillment_type !== 'station_pickup') return fail(res, 409, 'Only station-pickup orders can move to Ready for Station Pickup.');
            updates.status = body.status;
        }
        if (body.notes !== undefined) updates.notes = typeof body.notes === 'string' ? body.notes.trim() || null : null;
        if (body.delivery_address !== undefined) {
            if (existing.fulfillment_type === 'delivery' && (typeof body.delivery_address !== 'string' || !body.delivery_address.trim())) return fail(res, 422, 'A delivery address is required.');
            updates.delivery_address = body.delivery_address?.trim() || null;
        }
        if (body.payment_method !== undefined) {
            return fail(res, 422, 'Payment method cannot be changed after order creation. Cancel the pending order and submit a new one with the correct method.');
        }
        if (type === 'water' && body.quantity !== undefined) {
            const quantity = Number(body.quantity);
            if (!Number.isInteger(quantity) || quantity < 1 || quantity > 500) return fail(res, 422, 'quantity must be between 1 and 500.');
            updates.quantity = quantity;
            updates.total_amount = Number((Number(existing.unit_price) * quantity).toFixed(2));
        }
        if (type === 'laundry' && body.weight_kg !== undefined) {
            const weight = Number(body.weight_kg);
            if (!Number.isFinite(weight) || weight <= 0) return fail(res, 422, 'weight_kg must be greater than 0.');
            if (weight > MAX_LAUNDRY_KG) return fail(res, 422, `Maximum laundry booking weight is ${MAX_LAUNDRY_KG} kg. A machine load holds up to ${LAUNDRY_KG_PER_LOAD} kg.`, { code: 'LAUNDRY_MAX_WEIGHT_EXCEEDED', max_weight_kg: MAX_LAUNDRY_KG, kg_per_load: LAUNDRY_KG_PER_LOAD });
            const laundryPricing = calculateLaundryPricing(weight, Number(existing.unit_price), LAUNDRY_KG_PER_LOAD);
            updates.weight_kg = weight;
            updates.load_count = laundryPricing.loadCount;
            updates.total_amount = laundryPricing.totalAmount;
        }
        if (type === 'laundry') {
            for (const field of ['detergent', 'fabric_conditioner']) {
                if (body[field] !== undefined && body[field] !== null && typeof body[field] !== 'string') {
                    return fail(res, 422, `${field} must be a string or null.`);
                }
            }
            if (body.detergent !== undefined) updates.detergent = typeof body.detergent === 'string' ? body.detergent.trim() || null : null;
            if (body.fabric_conditioner !== undefined) updates.fabric_conditioner = typeof body.fabric_conditioner === 'string' ? body.fabric_conditioner.trim() || null : null;
        }
        // Check payment lock before reserving replacement capacity. Returning a 409
        // must never leave an extra booked slot behind.
        if (updates.total_amount !== undefined) {
            const { data: existingPayment, error: paymentLookupError } = await supabaseAdmin.from('order_payments')
                .select('payment_status').eq('order_type', type).eq('order_id', existing.id).maybeSingle();
            if (paymentLookupError) throw paymentLookupError;
            if (existingPayment?.payment_status === 'verified') {
                return fail(res, 409, 'This order payment is already verified. Its quantity/weight and total can no longer be changed.');
            }
        }
        if (scheduleChanged) {
            await reserveSlot(newSchedule.id);
            newSlotReserved = true;
            updates.schedule_id = newSchedule.id;
            updates.delivery_date = newSchedule.schedule_date;
            updates.delivery_time = formatTime(newSchedule.start_time);
        }
        if (!Object.keys(updates).length) return fail(res, 400, 'No supported fields were provided for update.');
        updates.updated_at = new Date().toISOString();
        let data;
        let error;
        if (updates.total_amount !== undefined) {
            // The RPC updates the order and its payment amount in one PostgreSQL transaction.
            const result = await supabaseAdmin.rpc('update_order_and_payment', {
                p_order_type: type,
                p_order_id: existing.id,
                p_updates: updates
            });
            data = result.data;
            error = result.error;
        } else {
            const result = await supabaseAdmin.from(orderTable(type)).update(updates)
                .eq('id', existing.id).select('*').single();
            data = result.data;
            error = result.error;
        }
        if (error) {
            if (newSlotReserved) { await releaseSlot(newSchedule.id); newSlotReserved = false; }
            throw error;
        }
        if (!data) throw new Error('The order update did not return an updated record.');
        if (scheduleChanged) {
            await releaseSlot(existing.schedule_id);
            newSlotReserved = false;
        }
        if (updates.status) {
            await addHistory(type, existing.id, existing.status, updates.status, req.user.id, body.status_note || body.notes || null);
            if (updates.status === 'Cancelled') await releaseSlot(data.schedule_id);
            const customerMessages = {
                'In Progress': ['Order approved', `Your ${type === 'water' ? 'water order' : 'laundry booking'} has been approved by our staff/admin and is now being processed.`],
                'Out for Delivery': ['Order out for delivery', 'Your order is now out for delivery.'],
                'Ready for Station Pickup': ['Order ready for pickup', 'Your order is ready for pickup at the station.'],
                'Completed': ['Order completed', 'Your order has been marked as completed.'],
                'Cancelled': ['Order cancelled', 'Your order has been cancelled. Please contact staff if you have questions.']
            };
            const notification = customerMessages[updates.status];
            if (notification) await createCustomerNotification(data.user_id, type, data.id, notification[0], notification[1]);
        }
        await audit(req.user.id, `Updated ${type} order ${existing.id}${updates.status ? ` to ${updates.status}` : ''}`);
        return res.json({ success: true, message: `${orderLabel(type)} updated successfully.`, data: addLinks(type, data) });
    } catch (error) {
        if (newSlotReserved && newSchedule?.id) { await releaseSlot(newSchedule.id); newSlotReserved = false; }
        console.error(`${type} order update failed:`, error.message);
        if (/verified|already verified/i.test(error.message || '')) {
            return fail(res, 409, 'This order payment is already verified. Its quantity/weight and total can no longer be changed.');
        }
        if (error.code === 'P0001' || /slot|schedule|available/i.test(error.message || '')) {
            return fail(res, 409, 'The selected schedule is full or no longer available. Refresh available schedules.');
        }
        return fail(res, 500, 'Could not update the order.');
    }
}

async function cancelOrder(type, req, res) {
    if (!isUuid(req.params.id)) return fail(res, 400, 'Order id must be a valid UUID.');
    try {
        const existing = await getOrder(type, req.params.id);
        if (!existing || (!isManager(req.user) && existing.user_id !== req.user.id)) return fail(res, 404, 'Order not found.');
        if (existing.status === 'Completed' || existing.status === 'Cancelled') return fail(res, 409, `A ${existing.status.toLowerCase()} order cannot be cancelled.`);
        if (!isManager(req.user) && existing.status !== 'Pending') return fail(res, 409, 'Only pending orders can be cancelled by the customer.');
        const { data, error } = await supabaseAdmin.from(orderTable(type)).update({ status: 'Cancelled', updated_at: new Date().toISOString() }).eq('id', existing.id).select('*').single();
        if (error) throw error;
        await releaseSlot(existing.schedule_id);
        await addHistory(type, existing.id, existing.status, 'Cancelled', req.user.id, typeof req.body?.note === 'string' ? req.body.note : 'Order cancelled.');
        await audit(req.user.id, `Cancelled ${type} order ${existing.id}`);
        return res.json({ success: true, message: `${orderLabel(type)} cancelled.`, data: addLinks(type, data) });
    } catch (error) {
        console.error(`${type} order cancellation failed:`, error.message);
        return fail(res, 500, 'Could not cancel the order.');
    }
}

for (const type of ORDER_TYPES) {
    const base = type === 'water' ? '/water-orders' : '/laundry-bookings';
    const apiBase = `/api${base}`;
    app.get([base, apiBase], authenticate, (req, res) => listOrders(type, req, res));
    app.post([base, apiBase], authenticate, (req, res) => createOrder(type, req, res));
    app.get([`${base}/:id`, `${apiBase}/:id`], authenticate, (req, res) => getOrderDetails(type, req, res));
    app.put([`${base}/:id`, `${apiBase}/:id`], authenticate, (req, res) => updateOrder(type, req, res));
    app.patch([`${base}/:id`, `${apiBase}/:id`], authenticate, (req, res) => updateOrder(type, req, res));
    app.delete([`${base}/:id`, `${apiBase}/:id`], authenticate, (req, res) => cancelOrder(type, req, res));
}

// Unified Orders REST resource from Chapter III. Water orders and laundry bookings remain
// separate database tables and are represented by order_type in this shared collection.
async function resolveUnifiedOrderType(id, requestedType) {
    if (!isUuid(id)) return { error: 400, message: 'Order id must be a valid UUID.' };
    if (requestedType !== undefined && !ORDER_TYPES.includes(requestedType)) {
        return { error: 400, message: 'order_type must be water or laundry.' };
    }
    if (requestedType !== undefined) return { type: requestedType };
    const [water, laundry] = await Promise.all([getOrder('water', id), getOrder('laundry', id)]);
    if (water && laundry) return { error: 409, message: 'This order id exists in both order resources. Supply order_type=water or order_type=laundry.' };
    if (water) return { type: 'water' };
    if (laundry) return { type: 'laundry' };
    return { error: 404, message: 'Order not found.' };
}

app.get('/api/orders', authenticate, async (req, res) => {
    try {
        if (req.query.order_type && !ORDER_TYPES.includes(req.query.order_type)) return fail(res, 400, 'order_type must be water or laundry.');
        if (req.query.customer_id && (!isManager(req.user) || !isUuid(req.query.customer_id))) return fail(res, 400, 'customer_id filter is valid only for staff/admin and must be a UUID.');
        if (req.query.status && req.query.status !== 'ALL' && !Object.keys(statusTransitions).includes(req.query.status)) return fail(res, 400, `status must be one of: ${Object.keys(statusTransitions).join(', ')}.`);
        if (req.query.from && !parseDate(req.query.from)) return fail(res, 400, 'from must use YYYY-MM-DD.');
        if (req.query.to && !parseDate(req.query.to)) return fail(res, 400, 'to must use YYYY-MM-DD.');
        if (req.query.from && req.query.to && req.query.from > req.query.to) return fail(res, 400, 'from must be on or before to.');
        const types = req.query.order_type ? [req.query.order_type] : ORDER_TYPES;
        const results = await Promise.all(types.map(async type => {
            let query = supabaseAdmin.from(orderTable(type)).select('*').order('created_at', { ascending: false });
            if (!isManager(req.user)) query = query.eq('user_id', req.user.id);
            if (req.query.customer_id && isManager(req.user)) query = query.eq('user_id', req.query.customer_id);
            if (req.query.status && req.query.status !== 'ALL') query = query.eq('status', req.query.status);
            if (req.query.from) query = query.gte('delivery_date', req.query.from);
            if (req.query.to) query = query.lte('delivery_date', req.query.to);
            const { data, error } = await query.limit(250);
            if (error) throw error;
            return (data || []).map(row => ({ ...addLinks(type, row), order_type: type }));
        }));
        const rows = results.flat().sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 500);
        let profiles = {};
        if (isManager(req.user) && rows.length) {
            const ids = [...new Set(rows.map(row => row.user_id))];
            const { data: people, error } = await supabaseAdmin.from('profiles').select('id,full_name,email,phone').in('id', ids);
            if (error) throw error;
            profiles = Object.fromEntries((people || []).map(person => [person.id, person]));
        }
        const data = rows.map(row => ({ ...row, customer: profiles[row.user_id] || null }));
        return res.json({ success: true, count: data.length, data });
    } catch (error) {
        console.error('unified order list failed:', error.message);
        return fail(res, 500, 'Could not retrieve orders. Confirm the Orders & Fulfillment migration is applied.');
    }
});

app.post('/api/orders', authenticate, async (req, res) => {
    const type = req.body?.order_type;
    if (!ORDER_TYPES.includes(type)) return fail(res, 422, 'order_type is required and must be water or laundry.');
    return createOrder(type, req, res);
});

app.get('/api/orders/:id', authenticate, async (req, res) => {
    try {
        const resolved = await resolveUnifiedOrderType(req.params.id, req.query.order_type);
        if (resolved.error) return fail(res, resolved.error, resolved.message);
        return getOrderDetails(resolved.type, req, res);
    } catch (error) {
        console.error('unified order lookup failed:', error.message);
        return fail(res, 500, 'Could not retrieve order details.');
    }
});

app.put('/api/orders/:id', authenticate, async (req, res) => {
    try {
        const requestedType = req.query.order_type ?? req.body?.order_type;
        const resolved = await resolveUnifiedOrderType(req.params.id, requestedType);
        if (resolved.error) return fail(res, resolved.error, resolved.message);
        return updateOrder(resolved.type, req, res);
    } catch (error) {
        console.error('unified order update lookup failed:', error.message);
        return fail(res, 500, 'Could not update the order.');
    }
});
app.patch('/api/orders/:id', authenticate, async (req, res) => {
    try {
        const requestedType = req.query.order_type ?? req.body?.order_type;
        const resolved = await resolveUnifiedOrderType(req.params.id, requestedType);
        if (resolved.error) return fail(res, resolved.error, resolved.message);
        return updateOrder(resolved.type, req, res);
    } catch (error) {
        console.error('unified order patch lookup failed:', error.message);
        return fail(res, 500, 'Could not update the order.');
    }
});
app.delete('/api/orders/:id', authenticate, async (req, res) => {
    try {
        const requestedType = req.query.order_type ?? req.body?.order_type;
        const resolved = await resolveUnifiedOrderType(req.params.id, requestedType);
        if (resolved.error) return fail(res, resolved.error, resolved.message);
        return cancelOrder(resolved.type, req, res);
    } catch (error) {
        console.error('unified order delete lookup failed:', error.message);
        return fail(res, 500, 'Could not cancel the order.');
    }
});


app.get(['/delivery-schedules', '/api/delivery-schedules'], optionalAuthenticate, async (req, res) => {
    try {
        let query = supabaseAdmin.from('delivery_schedule_slots').select('*')
            .eq('is_active', true).order('schedule_date').order('start_time');
        if (req.query.service_type) {
            if (!['Water', 'Laundry'].includes(req.query.service_type)) return fail(res, 400, 'service_type must be Water or Laundry.');
            query = query.eq('service_type', req.query.service_type);
        }
        if (req.query.fulfillment_type) {
            if (!['delivery', 'station_pickup'].includes(req.query.fulfillment_type)) return fail(res, 400, 'Invalid fulfillment_type.');
            query = query.eq('fulfillment_type', req.query.fulfillment_type);
        }
        if (req.query.date) {
            if (!parseDate(req.query.date)) return fail(res, 400, 'date must use YYYY-MM-DD.');
            query = query.eq('schedule_date', req.query.date);
        } else {
            query = query.gte('schedule_date', todayInManila());
        }
        const { data, error } = await query.limit(250);
        if (error) throw error;
        const available = (data || []).filter(slot => slot.booked_count < slot.capacity && slotHasNotStarted(slot)); 
        return res.json({ success: true, count: available.length, data: available.map(slot => ({
            ...slot, available_capacity: Math.max(0, slot.capacity - slot.booked_count)
        })) });
    } catch (error) {
        console.error('schedule list failed:', error.message);
        return fail(res, 500, 'Could not retrieve delivery/pickup schedules.');
    }
});

app.post(['/delivery-schedules', '/api/delivery-schedules'], authenticate, authorize('staff', 'admin'), async (req, res) => {
    const b = req.body || {};
    if (!['Water', 'Laundry'].includes(b.service_type) || !['delivery', 'station_pickup'].includes(b.fulfillment_type) || !parseDate(b.schedule_date) || b.schedule_date < todayInManila() || !parseTime(b.start_time) || !parseTime(b.end_time) || !Number.isInteger(Number(b.capacity)) || Number(b.capacity) < 1) {
        return fail(res, 422, 'Provide service_type, fulfillment_type, schedule_date, start_time, end_time, and a positive integer capacity.');
    }
    if (b.end_time <= b.start_time) return fail(res, 422, 'end_time must be later than start_time.');
    if (b.notes !== undefined && b.notes !== null && typeof b.notes !== 'string') return fail(res, 422, 'notes must be a string or null.');
    if (b.schedule_date === todayInManila() && b.start_time <= timeNowInManila()) return fail(res, 422, 'For today, start_time must be later than the current Philippine time.');
    try {
        const { data, error } = await supabaseAdmin.from('delivery_schedule_slots').insert({
            service_type: b.service_type, fulfillment_type: b.fulfillment_type,
            schedule_date: b.schedule_date, start_time: b.start_time, end_time: b.end_time,
            capacity: Number(b.capacity), notes: typeof b.notes === 'string' ? b.notes.trim() || null : null,
            created_by: req.user.id
        }).select('*').single();
        if (error?.code === '23505') return fail(res, 409, 'A schedule slot already exists for this service, fulfillment type, date, and start time.');
        if (error) throw error;
        await audit(req.user.id, `Created ${b.service_type} ${b.fulfillment_type} schedule ${data.id}`, 'schedules');
        return res.status(201).json({ success: true, message: 'Schedule slot created.', data });
    } catch (error) {
        console.error('schedule creation failed:', error.message);
        return fail(res, 500, 'Could not create the schedule slot.');
    }
});

app.put(['/delivery-schedules/:id', '/api/delivery-schedules/:id'], authenticate, authorize('staff', 'admin'), async (req, res) => {
    if (!isUuid(req.params.id)) return fail(res, 400, 'Schedule id must be a valid UUID.');
    const b = req.body || {};
    const updates = {};
    if (b.capacity !== undefined) {
        const capacity = Number(b.capacity);
        if (!Number.isInteger(capacity) || capacity < 1) return fail(res, 422, 'capacity must be a positive integer.');
        updates.capacity = capacity;
    }
    if (b.is_active !== undefined) {
        if (typeof b.is_active !== 'boolean') return fail(res, 422, 'is_active must be true or false.');
        updates.is_active = b.is_active;
    }
    if (b.notes !== undefined) {
        if (b.notes !== null && typeof b.notes !== 'string') return fail(res, 422, 'notes must be a string or null.');
        updates.notes = typeof b.notes === 'string' ? b.notes.trim() || null : null;
    }
    if (!Object.keys(updates).length) return fail(res, 400, 'Provide capacity, is_active, or notes to update.');
    try {
        const { data, error } = await supabaseAdmin.from('delivery_schedule_slots').update(updates).eq('id', req.params.id).select('*').maybeSingle();
        if (error?.code === '23514') return fail(res, 409, 'Capacity cannot be lower than the number of existing bookings.');
        if (error) throw error;
        if (!data) return fail(res, 404, 'Schedule slot not found.');
        await audit(req.user.id, `Updated delivery schedule ${data.id}`, 'schedules');
        return res.json({ success: true, data });
    } catch (error) {
        console.error('schedule update failed:', error.message);
        return fail(res, 500, 'Could not update schedule slot.');
    }
});

app.delete(['/delivery-schedules/:id', '/api/delivery-schedules/:id'], authenticate, authorize('staff', 'admin'), async (req, res) => {
    if (!isUuid(req.params.id)) return fail(res, 400, 'Schedule id must be a valid UUID.');
    try {
        const { data, error } = await supabaseAdmin.from('delivery_schedule_slots').update({ is_active: false }).eq('id', req.params.id).select('*').maybeSingle();
        if (error) throw error;
        if (!data) return fail(res, 404, 'Schedule slot not found.');
        await audit(req.user.id, `Deactivated delivery schedule ${data.id}`, 'schedules');
        return res.json({ success: true, message: 'Schedule slot deactivated.', data });
    } catch (error) {
        console.error('schedule deactivation failed:', error.message);
        return fail(res, 500, 'Could not deactivate schedule slot.');
    }
});

// Customer notifications are persisted so customers can receive updates after signing back in.
app.get(['/notifications', '/api/notifications'], authenticate, async (req, res) => {
    try {
        let query = supabaseAdmin.from('customer_notifications').select('*').order('created_at', { ascending: false }).limit(50);
        if (!isManager(req.user)) query = query.eq('user_id', req.user.id);
        else if (req.query.user_id && isUuid(req.query.user_id)) query = query.eq('user_id', req.query.user_id);
        const { data, error } = await query;
        if (error) throw error;
        return res.json({ success: true, count: (data || []).length, data: data || [] });
    } catch (error) {
        console.error('Notification retrieval failed:', error.message);
        return fail(res, 500, 'Could not retrieve notifications. Apply the latest Supabase migration.');
    }
});

app.patch(['/notifications/:id/read', '/api/notifications/:id/read'], authenticate, async (req, res) => {
    if (!isUuid(req.params.id)) return fail(res, 400, 'Notification id must be a valid UUID.');
    try {
        let query = supabaseAdmin.from('customer_notifications').update({ is_read: true, read_at: new Date().toISOString() }).eq('id', req.params.id);
        if (!isManager(req.user)) query = query.eq('user_id', req.user.id);
        const { data, error } = await query.select('*').maybeSingle();
        if (error) throw error;
        if (!data) return fail(res, 404, 'Notification not found.');
        return res.json({ success: true, data });
    } catch (error) {
        console.error('Notification update failed:', error.message);
        return fail(res, 500, 'Could not mark notification as read.');
    }
});

// Payments: POST submits/updates proof against an existing water order or laundry booking.
app.post(['/payments', '/api/payments'], authenticate, async (req, res) => {
    const b = req.body || {};
    if (!ORDER_TYPES.includes(b.order_type) || !isUuid(b.order_id)) return fail(res, 422, 'order_type (water or laundry) and a valid order_id are required.');
    const paymentMethod = normalizePaymentMethod(b.payment_method);
    if (!paymentMethod) return fail(res, 422, 'Choose a supported payment_method.');
    if (b.reference_number !== undefined && b.reference_number !== null && typeof b.reference_number !== 'string') return fail(res, 422, 'reference_number must be a string or null.');
    if (b.receipt_url !== undefined && b.receipt_url !== null && typeof b.receipt_url !== 'string') return fail(res, 422, 'receipt_url must be a string or null.');
    const referenceNumber = typeof b.reference_number === 'string' ? b.reference_number.trim() : null;
    const receiptUrl = typeof b.receipt_url === 'string' ? b.receipt_url.trim() : null;
    if (receiptUrl) {
        let parsedReceiptUrl;
        try { parsedReceiptUrl = new URL(receiptUrl); } catch { return fail(res, 422, 'receipt_url must be a valid HTTP(S) URL.'); }
        if (!['http:', 'https:'].includes(parsedReceiptUrl.protocol)) return fail(res, 422, 'receipt_url must be a valid HTTP(S) URL.');
    }
    if (paymentMethod === 'GCash Online Payment' && !referenceNumber && !receiptUrl) return fail(res, 422, 'GCash submission requires a reference_number or receipt_url.');
    try {
        const order = await getOrder(b.order_type, b.order_id);
        if (!order || (!isManager(req.user) && order.user_id !== req.user.id)) return fail(res, 404, 'Order not found.');
        if (paymentMethod !== order.payment_method) return fail(res, 409, 'Payment method must match the method selected for the order.');
        const { data: currentPayment, error: currentPaymentError } = await supabaseAdmin.from('order_payments').select('id,payment_status').eq('order_type', b.order_type).eq('order_id', b.order_id).maybeSingle();
        if (currentPaymentError) throw currentPaymentError;
        if (currentPayment?.payment_status === 'verified') return fail(res, 409, 'This payment has already been verified and cannot be resubmitted.');
        const { data, error } = await supabaseAdmin.from('order_payments').upsert({
            order_type: b.order_type, order_id: b.order_id, user_id: order.user_id,
            payment_method: paymentMethod, amount: Number(order.total_amount),
            payment_status: paymentMethod === 'GCash Online Payment' ? 'submitted' : 'pending',
            reference_number: referenceNumber || null, receipt_url: receiptUrl || null,
            updated_at: new Date().toISOString()
        }, { onConflict: 'order_type,order_id' }).select('*').single();
        if (error) throw error;
        await audit(req.user.id, `Submitted payment record ${data.id} for ${b.order_type} order ${b.order_id}`, 'payments');
        return res.status(201).json({ success: true, message: 'Payment record submitted.', data });
    } catch (error) {
        console.error('payment submission failed:', error.message);
        return fail(res, 500, 'Could not submit payment record.');
    }
});

app.get(['/payments/:id', '/api/payments/:id'], authenticate, async (req, res) => {
    if (!isUuid(req.params.id)) return fail(res, 400, 'Payment id must be a valid UUID.');
    try {
        const { data, error } = await supabaseAdmin.from('order_payments').select('*').eq('id', req.params.id).maybeSingle();
        if (error) throw error;
        if (!data || (!isManager(req.user) && data.user_id !== req.user.id)) return fail(res, 404, 'Payment record not found.');
        return res.json({ success: true, data });
    } catch (error) {
        console.error('payment lookup failed:', error.message);
        return fail(res, 500, 'Could not retrieve payment details.');
    }
});

app.patch(['/payments/:id/status', '/api/payments/:id/status'], authenticate, authorize('staff', 'admin'), async (req, res) => {
    if (!isUuid(req.params.id)) return fail(res, 400, 'Payment id must be a valid UUID.');
    const { payment_status, verification_note } = req.body || {};
    if (!['verified', 'rejected'].includes(payment_status)) return fail(res, 422, 'payment_status must be verified or rejected.');
    if (verification_note !== undefined && verification_note !== null && typeof verification_note !== 'string') return fail(res, 422, 'verification_note must be a string or null.');
    try {
        const { data, error } = await supabaseAdmin.from('order_payments').update({
            payment_status, verified_by: req.user.id,
            verified_at: payment_status === 'verified' ? new Date().toISOString() : null,
            verification_note: typeof verification_note === 'string' ? verification_note.trim() || null : null,
            updated_at: new Date().toISOString()
        }).eq('id', req.params.id).select('*').maybeSingle();
        if (error) throw error;
        if (!data) return fail(res, 404, 'Payment record not found.');
        await audit(req.user.id, `${payment_status} payment ${data.id}`, 'payments');
        return res.json({ success: true, message: `Payment ${payment_status}.`, data });
    } catch (error) {
        console.error('payment verification failed:', error.message);
        return fail(res, 500, 'Could not update payment status.');
    }
});

app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) return fail(res, 400, 'Request body contains invalid JSON.');
    if (err.message === 'Origin is not allowed by CORS.') return fail(res, 403, err.message);
    console.error('Orders API error:', err.message);
    return fail(res, 500, 'An unexpected server error occurred.');
});

app.listen(PORT, () => console.log(`Orders & Fulfillment API running at http://localhost:${PORT}`));
