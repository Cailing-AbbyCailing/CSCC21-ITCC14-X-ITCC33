let customerProfile = null;
let waterServices = [];
let laundryServices = [];
let printingServices = [];
let loadedOrderRows = [];
let maxLaundryKg = 20;
let laundryKgPerLoad = 7;
let lastLaundryLimitAlertValue = null;
let notificationPollHandle = null;
const seenCustomerNotifications = new Set();

function formatPeso(value) {
    return `₱${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function customerStatus(message, isError = false) {
    const node = document.getElementById('customer-api-status');
    if (!node) return;
    node.textContent = message;
    node.classList.toggle('api-status-error', isError);
}
function switchView(viewId, event) {
    document.querySelectorAll('.panel-section').forEach(section => section.classList.remove('active'));
    document.querySelectorAll('.sidebar-nav .nav-item').forEach(button => button.classList.remove('active'));
    const target = document.getElementById(viewId);
    if (target) target.classList.add('active');
    if (event?.currentTarget) event.currentTarget.classList.add('active');
    const titles = {
        'choose-service': ['Main Menu (Home)', 'Select a service, choose an available slot, and submit your order.'],
        'order-tracker': ['Track Order Status', 'Track your Water orders and Laundry bookings.'],
        'account-settings': ['Account Settings', 'Manage your profile information.']
    };
    if (titles[viewId]) {
        document.getElementById('header-title').textContent = titles[viewId][0];
        document.getElementById('header-desc').textContent = titles[viewId][1];
    }
    if (viewId === 'order-tracker') loadCustomerOrders();
}
function selectServiceTab(type) {
    document.getElementById('no-service-prompt').style.display = 'none';
    document.getElementById('tab-water-btn').classList.toggle('active', type === 'water');
    document.getElementById('tab-laundry-btn').classList.toggle('active', type === 'laundry');
    document.getElementById('tab-printing-btn').classList.toggle('active', type === 'printing');
    document.getElementById('water-form-content').classList.toggle('active', type === 'water');
    document.getElementById('laundry-form-content').classList.toggle('active', type === 'laundry');
    document.getElementById('printing-catalog-content').classList.toggle('active', type === 'printing');
    if (type !== 'printing') toggleSchedule(type);
}
function toggleSchedule(service) {
    const prefix = service === 'water' ? 'water' : 'laundry';
    const mode = document.getElementById(`${prefix}DeliveryToggle`)?.value || 'delivery';
    const schedule = document.getElementById(`${prefix}ScheduleBox`);
    const address = document.getElementById(`${prefix}AddressBox`);
    if (schedule) schedule.style.display = 'block';
    if (address) address.style.display = mode === 'delivery' ? 'block' : 'none';
}
function selectedService(selectId, items) {
    const id = document.getElementById(selectId)?.value;
    return items.find(item => String(item.id) === String(id)) || null;
}
function calculateWaterTotal() {
    const item = selectedService('waterType', waterServices);
    const qty = Math.max(1, Number(document.getElementById('waterQty')?.value || 1));
    const output = document.getElementById('waterDisplayTotal');
    if (output) output.textContent = formatPeso(item ? Number(item.selling_price || 0) * qty : 0);
}
function calculateLaundryTotal() {
    const item = selectedService('laundryType', laundryServices);
    const weightInput = document.getElementById('laundryLoads');
    let weight = Math.max(0, Number(weightInput?.value || 0));
    if (weightInput) {
        weightInput.max = String(maxLaundryKg);
        if (weight > maxLaundryKg) {
            weightInput.value = String(maxLaundryKg);
            weight = maxLaundryKg;
            if (lastLaundryLimitAlertValue !== maxLaundryKg) {
                window.alert(`Maximum laundry booking weight is ${maxLaundryKg} kg. Each machine load holds up to ${laundryKgPerLoad} kg.`);
                lastLaundryLimitAlertValue = maxLaundryKg;
            }
        } else {
            lastLaundryLimitAlertValue = null;
        }
    }
    const loadCount = weight > 0 ? Math.ceil(weight / laundryKgPerLoad) : 0;
    const total = item ? Number(item.selling_price || 0) * loadCount : 0;
    const output = document.getElementById('laundryDisplayTotal');
    if (output) output.textContent = `${formatPeso(total)}${loadCount ? ` (${loadCount} load${loadCount === 1 ? '' : 's'})` : ''}`;
}
function fillServiceSelect(selectId, items, emptyLabel) {
    const select = document.getElementById(selectId);
    if (!select) return;
    select.replaceChildren();
    if (!items.length) {
        const option = document.createElement('option'); option.value = ''; option.textContent = emptyLabel; select.append(option); return;
    }
    for (const item of items) {
        const option = document.createElement('option');
        option.value = item.id;
        const pricingUnit = item.service_type === 'Laundry' ? `load (up to ${laundryKgPerLoad} kg)` : (item.unit || 'unit');
        option.textContent = `${item.item_name} — ${formatPeso(item.selling_price)} / ${pricingUnit}`;
        select.append(option);
    }
}
function localDateString(date) {
    const y = date.getFullYear(); const m = String(date.getMonth() + 1).padStart(2, '0'); const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}
async function loadSchedules(service, keepSelection = true) {
    const prefix = service === 'water' ? 'water' : 'laundry';
    const serviceType = service === 'water' ? 'Water' : 'Laundry';
    const dateInput = document.getElementById(`${prefix}ScheduleDate`);
    const select = document.getElementById(`${prefix}ScheduleSlot`);
    const fulfillment = document.getElementById(`${prefix}DeliveryToggle`).value;
    if (!dateInput || !select || !dateInput.value) return;
    const previous = keepSelection ? select.value : '';
    select.replaceChildren();
    const loading = document.createElement('option'); loading.value = ''; loading.textContent = 'Loading available slots…'; select.append(loading);
    try {
        const query = new URLSearchParams({ service_type: serviceType, fulfillment_type: fulfillment, date: dateInput.value });
        const result = await ACS_API.request('orders', `/api/delivery-schedules?${query.toString()}`);
        const slots = result.data || [];
        select.replaceChildren();
        if (!slots.length) {
            const option = document.createElement('option'); option.value = ''; option.textContent = 'No available slots for this date'; select.append(option); return;
        }
        for (const slot of slots) {
            const option = document.createElement('option');
            option.value = slot.id;
            option.textContent = `${String(slot.start_time).slice(0, 5)}–${String(slot.end_time).slice(0, 5)} · ${slot.available_capacity} slot(s) left`;
            select.append(option);
        }
        if (previous && slots.some(slot => slot.id === previous)) select.value = previous;
    } catch (error) {
        select.replaceChildren();
        const option = document.createElement('option'); option.value = ''; option.textContent = `Could not load slots: ${error.message}`; select.append(option);
    }
}
async function loadCustomerCatalog() {
    const [waterResult, laundryResult, printingResult, configResult] = await Promise.all([
        ACS_API.request('services', '/api/services?service_type=Water&available=true'),
        ACS_API.request('services', '/api/services?service_type=Laundry&available=true'),
        ACS_API.request('services', '/api/services?service_type=Printing&available=true'),
        ACS_API.request('orders', '/config')
    ]);
    maxLaundryKg = Number(configResult?.data?.max_laundry_kg) > 0 ? Number(configResult.data.max_laundry_kg) : 20;
    laundryKgPerLoad = Number(configResult?.data?.laundry_kg_per_load) > 0 ? Number(configResult.data.laundry_kg_per_load) : 7;
    const laundryInput = document.getElementById('laundryLoads');
    if (laundryInput) laundryInput.max = String(maxLaundryKg);
    waterServices = waterResult.data || [];
    laundryServices = laundryResult.data || [];
    printingServices = printingResult.data || [];
    fillServiceSelect('waterType', waterServices, 'No available water services in catalog');
    fillServiceSelect('laundryType', laundryServices, 'No available laundry services in catalog');
    renderPrintingCatalog();
    calculateWaterTotal(); calculateLaundryTotal();
}
function renderPrintingCatalog() {
    const grid = document.getElementById('printing-catalog-grid');
    if (!grid) return;
    grid.replaceChildren();
    if (!printingServices.length) {
        const empty = document.createElement('p');
        empty.textContent = 'No available printing options are currently listed.';
        grid.append(empty);
        return;
    }
    for (const item of printingServices) {
        const card = document.createElement('article');
        card.className = 'printing-catalog-card';
        const name = document.createElement('h4'); name.textContent = item.item_name;
        const category = document.createElement('p'); category.textContent = item.category || item.description || 'Printing option';
        const price = document.createElement('strong'); price.textContent = `${formatPeso(item.selling_price)} / ${item.unit || 'unit'}`;
        card.append(name, category, price);
        grid.append(card);
    }
}
async function loadCustomerProfile() {
    const storedUser = JSON.parse(sessionStorage.getItem('acs_user') || '{}');
    if (!storedUser.id) throw new Error('No signed-in user id was found. Please sign in again.');
    const result = await ACS_API.request('auth', `/api/users/${encodeURIComponent(storedUser.id)}`);
    customerProfile = result.data;
    const values = {
        'profile-full-name': customerProfile.full_name,
        'profile-email': customerProfile.email,
        'profile-phone': customerProfile.phone,
        'profile-address': customerProfile.default_address
    };
    for (const [id, value] of Object.entries(values)) {
        const node = document.getElementById(id); if (node) node.value = value || '';
    }
    const sidebar = document.getElementById('customer-sidebar-name');
    if (sidebar) sidebar.textContent = customerProfile.full_name || customerProfile.email || 'Customer';
}
async function saveCustomerProfile() {
    const button = document.getElementById('save-customer-profile');
    const body = {
        full_name: document.getElementById('profile-full-name')?.value.trim(),
        phone: document.getElementById('profile-phone')?.value.trim() || null,
        default_address: document.getElementById('profile-address')?.value.trim() || null
    };
    if (!body.full_name) return customerStatus('Please enter your full name.', true);
    if (button) button.disabled = true;
    try {
        const result = await ACS_API.request('auth', `/api/users/${encodeURIComponent(customerProfile.id)}`, { method: 'PUT', body });
        customerProfile = result.data;
        document.getElementById('customer-sidebar-name').textContent = customerProfile.full_name || 'Customer';
        customerStatus('Your profile was saved successfully.');
    } catch (error) { customerStatus(error.message || 'Could not save your profile.', true); }
    finally { if (button) button.disabled = false; }
}
function showGcashReference(service) {
    const prefix = service === 'water' ? 'water' : 'laundry';
    const method = document.getElementById(`${prefix}PaymentMethod`)?.value;
    const group = document.getElementById(`${prefix}-gcash-reference-group`);
    if (group) group.style.display = method === 'GCash Online Payment' ? 'block' : 'none';
}
async function submitCustomerOrder(type) {
    const prefix = type === 'water' ? 'water' : 'laundry';
    const isWater = type === 'water';
    const service = selectedService(isWater ? 'waterType' : 'laundryType', isWater ? waterServices : laundryServices);
    if (!service) return customerStatus('Please select an available service.', true);
    const scheduleId = document.getElementById(`${prefix}ScheduleSlot`)?.value;
    if (!scheduleId) return customerStatus('Please choose an available date and time slot.', true);
    const fulfillmentType = document.getElementById(`${prefix}DeliveryToggle`).value;
    const address = document.getElementById(`${prefix}DeliveryAddress`)?.value.trim() || '';
    if (fulfillmentType === 'delivery' && !address) return customerStatus('Please enter your delivery address.', true);
    const paymentMethod = document.getElementById(`${prefix}PaymentMethod`).value;
    const referenceNumber = document.getElementById(`${prefix}-gcash-reference`)?.value.trim() || '';
    if (paymentMethod === 'GCash Online Payment' && !referenceNumber) return customerStatus('Enter the GCash reference number before submitting.', true);
    const quantity = Number(document.getElementById(isWater ? 'waterQty' : 'laundryLoads').value);
    if (!Number.isFinite(quantity) || quantity <= 0) return customerStatus(isWater ? 'Enter a valid quantity.' : 'Enter a valid laundry weight.', true);
    if (!isWater && quantity > maxLaundryKg) { window.alert(`Maximum laundry booking weight is ${maxLaundryKg} kg. Each machine load holds up to ${laundryKgPerLoad} kg.`); return; }

    const body = {
        service_id: service.id,
        fulfillment_type: fulfillmentType,
        delivery_address: fulfillmentType === 'delivery' ? address : null,
        schedule_id: scheduleId,
        payment_method: paymentMethod,
        reference_number: referenceNumber || null
    };
    if (isWater) body.quantity = quantity;
    else {
        body.weight_kg = quantity;
        body.detergent = document.getElementById('laundry-detergent')?.value || null;
        body.fabric_conditioner = document.getElementById('laundry-conditioner')?.value || null;
    }
    const button = document.getElementById(isWater ? 'submit-water-order' : 'submit-laundry-order');
    if (button) { button.disabled = true; button.dataset.originalText = button.textContent; button.textContent = 'Submitting…'; }
    try {
        body.order_type = type;
        const result = await ACS_API.request('orders', '/api/orders', { method: 'POST', body });
        const order = result.data;
        const paymentNote = `Payment record: ${order.payment?.payment_status || 'pending'}.`;
        customerStatus(`${result.message} Tracking ID: ${order.id}. ${paymentNote}`);
        window.alert(`${isWater ? 'Water order' : 'Laundry booking'} submitted successfully! Your order is PENDING approval from our staff/admin. Tracking ID: ${order.id}`);
        await loadCustomerOrders();
        if (isWater) {
            document.getElementById('waterQty').value = '1';
            document.getElementById('waterDeliveryAddress').value = '';
            document.getElementById('water-gcash-reference').value = '';
            calculateWaterTotal();
        } else {
            document.getElementById('laundryLoads').value = '1';
            document.getElementById('laundryDeliveryAddress').value = '';
            document.getElementById('laundry-gcash-reference').value = '';
            calculateLaundryTotal();
        }
    } catch (error) {
        customerStatus(error.message || 'Your order could not be submitted.', true);
    } finally {
        if (button) { button.disabled = false; button.textContent = button.dataset.originalText || (isWater ? 'Submit Water Order' : 'Submit Laundry Booking'); }
    }
}
async function checkCustomerNotifications(showExisting = false) {
    try {
        const result = await ACS_API.request('orders', '/api/notifications');
        const notifications = result.data || [];
        let receivedAny = false;
        for (const notification of notifications) {
            if (notification.is_read || seenCustomerNotifications.has(notification.id)) continue;
            seenCustomerNotifications.add(notification.id);
            receivedAny = true;
            if (showExisting || document.visibilityState === 'visible') {
                window.alert(`${notification.title || 'Order update'}\n\n${notification.message}`);
            }
            await ACS_API.request('orders', `/api/notifications/${encodeURIComponent(notification.id)}/read`, { method: 'PATCH', body: {} });
        }
        if (receivedAny) await loadCustomerOrders();
    } catch (error) {
        // Notification polling must not interrupt order forms or customer navigation.
        console.warn('Customer notifications could not be refreshed:', error.message);
    }
}
function startCustomerNotificationPolling() {
    if (notificationPollHandle) window.clearInterval(notificationPollHandle);
    checkCustomerNotifications(true);
    notificationPollHandle = window.setInterval(() => {
        if (document.visibilityState === 'visible') checkCustomerNotifications(false);
    }, 15000);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') checkCustomerNotifications(false);
    });
}

function renderOrderTable(rows) {
    const tbody = document.getElementById('customer-orders-body');
    if (!tbody) return;
    tbody.replaceChildren();
    if (!rows.length) {
        const row = document.createElement('tr'); const cell = document.createElement('td');
        cell.colSpan = 5; cell.textContent = 'You have not submitted any Water orders or Laundry bookings yet.'; row.append(cell); tbody.append(row); return;
    }
    for (const record of rows) {
        const row = document.createElement('tr');
        const idCell = document.createElement('td'); idCell.textContent = record.id.slice(0, 8).toUpperCase(); row.append(idCell);
        const serviceCell = document.createElement('td'); serviceCell.textContent = record.kind === 'water' ? `Water · ${record.service_name}` : `Laundry · ${record.service_name}`; row.append(serviceCell);
        const modeCell = document.createElement('td'); modeCell.textContent = record.fulfillment_type === 'station_pickup' ? 'Station pickup' : 'Home delivery'; row.append(modeCell);
        const statusCell = document.createElement('td'); statusCell.textContent = record.status; row.append(statusCell);
        const actionCell = document.createElement('td');
        const details = document.createElement('button'); details.type = 'button'; details.textContent = 'Details'; details.addEventListener('click', () => viewOrderDetails(record)); actionCell.append(details);
        if (record.status === 'Pending') {
            const edit = document.createElement('button'); edit.type = 'button'; edit.textContent = 'Edit';
            edit.addEventListener('click', () => editCustomerOrder(record)); actionCell.append(edit);
            const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel'; cancel.style.marginLeft = '6px';
            cancel.addEventListener('click', () => cancelCustomerOrder(record)); actionCell.append(cancel);
        }
        row.append(actionCell); tbody.append(row);
    }
}
async function loadCustomerOrders() {
    const tbody = document.getElementById('customer-orders-body');
    if (tbody) { tbody.replaceChildren(); const row = document.createElement('tr'); const cell = document.createElement('td'); cell.colSpan = 5; cell.textContent = 'Loading your orders…'; row.append(cell); tbody.append(row); }
    try {
        const result = await ACS_API.request('orders', '/api/orders');
        loadedOrderRows = (result.data || []).map(item => ({ ...item, kind: item.order_type }))
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        renderOrderTable(loadedOrderRows);
    } catch (error) {
        if (tbody) { tbody.replaceChildren(); const row = document.createElement('tr'); const cell = document.createElement('td'); cell.colSpan = 5; cell.textContent = `Could not load order history: ${error.message}`; row.append(cell); tbody.append(row); }
    }
}
async function viewOrderDetails(record) {
    try {
        const result = await ACS_API.request('orders', `/api/orders/${encodeURIComponent(record.id)}?order_type=${record.kind}`);
        const order = result.data;
        let payment = order.payment || null;
        if (payment?.id) {
            try { payment = (await ACS_API.request('orders', `/api/payments/${encodeURIComponent(payment.id)}`)).data; }
            catch (paymentError) { console.warn('Payment details could not be retrieved:', paymentError.message); }
        }
        const history = (order.status_history || []).map(item => `${item.new_status} · ${new Date(item.created_at).toLocaleString('en-PH')} ${item.note || ''}`).join('\n');
        alert([
            `Service: ${order.service_name}`, ...(record.kind === 'laundry' ? [`Weight: ${order.weight_kg} kg (${order.load_count || Math.ceil(Number(order.weight_kg) / laundryKgPerLoad)} load(s))`] : []), `Amount: ${formatPeso(order.total_amount)}`,
            `Scheduled: ${order.delivery_date} ${String(order.delivery_time).slice(0, 5)}`,
            `Status: ${order.status}`, `Payment: ${payment?.payment_status || 'pending'}`, `Payment reference: ${payment?.reference_number || '—'}`,
            `Status history:\n${history || 'No status history available.'}`
        ].join('\n\n'));
        if (payment?.payment_method === 'GCash Online Payment' && payment.payment_status === 'rejected') {
            const newReference = prompt('Your GCash proof was rejected. Enter the corrected GCash reference number to resubmit:');
            if (newReference?.trim()) {
                const submitted = await ACS_API.request('orders', '/api/payments', { method: 'POST', body: {
                    order_type: record.kind, order_id: order.id,
                    payment_method: 'GCash Online Payment', reference_number: newReference.trim()
                } });
                customerStatus(submitted.message || 'GCash payment proof resubmitted.');
                await loadCustomerOrders();
            }
        }
    } catch (error) { customerStatus(`Could not retrieve order details: ${error.message}`, true); }
}
async function editCustomerOrder(record) {
    const type = record.kind;
    const base = `/api/orders/${encodeURIComponent(record.id)}?order_type=${type}`;
    const quantityPrompt = type === 'water' ? 'Water container quantity:' : 'Laundry weight in kg:';
    const currentQuantity = type === 'water' ? record.quantity : record.weight_kg;
    const rawQuantity = prompt(quantityPrompt, String(currentQuantity));
    if (rawQuantity === null) return;
    const quantity = Number(rawQuantity);
    if (!Number.isFinite(quantity) || quantity <= 0 || (type === 'water' && !Number.isInteger(quantity)) || quantity > (type === 'water' ? 500 : maxLaundryKg)) {
        customerStatus(type === 'water' ? 'Enter a whole-number quantity from 1 to 500.' : `Enter a laundry weight greater than 0 and no more than ${maxLaundryKg} kg. Each load holds up to ${laundryKgPerLoad} kg.`, true);
        return;
    }
    const body = type === 'water' ? { quantity } : { weight_kg: quantity };
    if (record.fulfillment_type === 'delivery') {
        const address = prompt('Delivery address:', record.delivery_address || '');
        if (address === null) return;
        if (!address.trim()) return customerStatus('A delivery address is required.', true);
        body.delivery_address = address.trim();
    }
    const notes = prompt('Order notes (optional):', record.notes || '');
    if (notes === null) return;
    body.notes = notes.trim() || null;
    if (confirm('Would you also like to change the pickup/delivery date or time?')) {
        const newDate = prompt('New schedule date (YYYY-MM-DD):', record.delivery_date);
        if (newDate === null) return;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) return customerStatus('Enter the schedule date as YYYY-MM-DD.', true);
        try {
            const query = new URLSearchParams({ service_type: type === 'water' ? 'Water' : 'Laundry', fulfillment_type: record.fulfillment_type, date: newDate });
            const result = await ACS_API.request('orders', `/api/delivery-schedules?${query.toString()}`);
            const slots = result.data || [];
            if (!slots.length) return customerStatus('There are no available slots for that date.', true);
            const choices = slots.map((slot, index) => `${index + 1}. ${String(slot.start_time).slice(0, 5)}-${String(slot.end_time).slice(0, 5)} (${slot.available_capacity} left)`).join('\n');
            const choice = Number(prompt(`Choose a new time slot by number:\n${choices}`, '1'));
            if (!Number.isInteger(choice) || choice < 1 || choice > slots.length) return;
            body.schedule_id = slots[choice - 1].id;
        } catch (error) { return customerStatus(`Could not load replacement schedules: ${error.message}`, true); }
    }
    try {
        const result = await ACS_API.request('orders', base, { method: 'PUT', body });
        customerStatus(result.message || 'Your order was updated.');
        await loadCustomerOrders();
    } catch (error) { customerStatus(`Could not update your order: ${error.message}`, true); }
}
async function cancelCustomerOrder(record) {
    if (!confirm('Cancel this pending order?')) return;
    try {
        const endpoint = `/api/orders/${encodeURIComponent(record.id)}?order_type=${record.kind}`;
        await ACS_API.request('orders', endpoint, { method: 'DELETE', body: { order_type: record.kind, note: 'Cancelled by customer.' } });
        customerStatus('Your order was cancelled.');
        await loadCustomerOrders();
    } catch (error) { customerStatus(error.message || 'Could not cancel this order.', true); }
}

window.calculateWaterTotal = calculateWaterTotal;
window.calculateLaundryTotal = calculateLaundryTotal;
window.selectServiceTab = selectServiceTab;
window.switchView = switchView;
window.toggleSchedule = toggleSchedule;

document.addEventListener('DOMContentLoaded', async () => {
    if (!window.ACS_API) return;
    try {
        const user = await ACS_API.requireRole(['customer']);
        if (!user) return;
        const [profileResult, catalogResult] = await Promise.allSettled([loadCustomerProfile(), loadCustomerCatalog()]);
        if (profileResult.status === 'rejected') throw profileResult.reason;
        if (catalogResult.status === 'rejected') throw catalogResult.reason;
        const today = new Date();
        const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
        for (const prefix of ['water', 'laundry']) {
            const date = document.getElementById(`${prefix}ScheduleDate`);
            if (date) { date.min = localDateString(today); date.value = localDateString(tomorrow); }
        }
        await Promise.all([loadSchedules('water'), loadSchedules('laundry')]);
        const status = `Connected: profile, service catalog, order submission, tracking, and delivery schedules are using the APIs.`;
        customerStatus(status);
        startCustomerNotificationPolling();
    } catch (error) {
        customerStatus(`Could not load customer data: ${error.message}`, true);
    }
    document.getElementById('save-customer-profile')?.addEventListener('click', saveCustomerProfile);
    document.getElementById('waterQty')?.addEventListener('input', calculateWaterTotal);
    document.getElementById('laundryLoads')?.addEventListener('input', calculateLaundryTotal);
    document.getElementById('waterScheduleDate')?.addEventListener('change', () => loadSchedules('water', false));
    document.getElementById('laundryScheduleDate')?.addEventListener('change', () => loadSchedules('laundry', false));
    document.getElementById('waterDeliveryToggle')?.addEventListener('change', () => { toggleSchedule('water'); loadSchedules('water', false); });
    document.getElementById('laundryDeliveryToggle')?.addEventListener('change', () => { toggleSchedule('laundry'); loadSchedules('laundry', false); });
    document.getElementById('waterPaymentMethod')?.addEventListener('change', () => showGcashReference('water'));
    document.getElementById('laundryPaymentMethod')?.addEventListener('change', () => showGcashReference('laundry'));
    document.getElementById('submit-water-order')?.addEventListener('click', () => submitCustomerOrder('water'));
    document.getElementById('submit-laundry-order')?.addEventListener('click', () => submitCustomerOrder('laundry'));
    document.getElementById('refresh-customer-orders')?.addEventListener('click', loadCustomerOrders);
});
