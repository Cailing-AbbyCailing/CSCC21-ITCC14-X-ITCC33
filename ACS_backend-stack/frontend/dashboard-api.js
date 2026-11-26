document.addEventListener('DOMContentLoaded', async () => {
    if (!window.ACS_API) return;
    const isAdminPage = Boolean(document.getElementById('analytics-section'));
    const roles = isAdminPage ? ['admin'] : ['staff', 'admin'];
    try {
        const user = await ACS_API.requireRole(roles);
        if (!user) return;
        const name = document.getElementById('current-user-name');
        if (name) name.textContent = user.full_name || user.email || 'User';
        const dateNode = document.getElementById('current-date-str');
        if (dateNode) dateNode.textContent = new Date().toLocaleDateString('en-PH', { dateStyle: 'long' });

        if (isAdminPage) {
            await Promise.allSettled([loadAdminAnalytics(), loadAdminStaff(), loadAuditLogs()]);
        } else {
            const results = await Promise.allSettled([loadStaffServices(), loadStaffCustomers(), loadStaffOrders(), loadStaffSchedules(), loadSupplyInventory()]);
            const failed = results.find(result => result.status === 'rejected');
            if (failed) showDashboardMessage(`Some staff data could not be loaded: ${failed.reason?.message || 'Unknown API error'}`, true);
            bindOperationsEvents();
        }
    } catch (error) {
        console.error('Dashboard API integration error:', error);
        showDashboardMessage(error.message || 'Could not load live dashboard data.', true);
    }
});

function showDashboardMessage(message, isError = false) {
    let node = document.getElementById('api-dashboard-message');
    if (!node) {
        node = document.createElement('p');
        node.id = 'api-dashboard-message';
        node.setAttribute('role', 'status');
        node.style.cssText = 'margin:12px 0;padding:10px 12px;border-radius:8px;font-size:13px;';
        const main = document.querySelector('main') || document.body;
        main.prepend(node);
    }
    node.style.background = isError ? '#fff7ed' : '#eff6ff';
    node.style.color = isError ? '#9a3412' : '#1e40af';
    node.textContent = message;
}

function setTableMessage(tbody, message, colspan) {
    if (!tbody) return;
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = colspan;
    cell.textContent = message;
    row.append(cell);
    tbody.replaceChildren(row);
}

function money(value) {
    return `₱${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function loadAdminAnalytics() {
    try {
        const result = await ACS_API.request('analytics', '/api/analytics/overview');
        const data = result.data || {};
        const setText = (id, value) => { const node = document.getElementById(id); if (node) node.textContent = value; };
        setText('kpi-monthly-revenue', money(data.monthly_revenue));
        setText('kpi-active-orders', Number(data.active_orders || 0).toLocaleString('en-PH'));
        setText('kpi-total-customers', Number(data.total_customers || 0).toLocaleString('en-PH'));
        setText('kpi-completed-orders', Number(data.completed_orders || 0).toLocaleString('en-PH'));

        const [revenueResult, serviceResult] = await Promise.all([
            ACS_API.request('analytics', '/api/analytics/revenue'),
            ACS_API.request('analytics', '/api/analytics/services')
        ]);
        renderRevenueHistory(revenueResult.data || []);
        renderServiceOrderBreakdown(serviceResult.data || []);
    } catch (error) {
        showDashboardMessage(`Analytics API: ${error.message}`, true);
    }
}

function renderRevenueHistory(items) {
    const container = document.getElementById('revenue-history-bars');
    if (!container) return;
    if (!items.length) { container.textContent = 'No verified payment records yet.'; return; }
    const max = Math.max(...items.map(item => Number(item.revenue) || 0), 1);
    container.replaceChildren();
    for (const item of items) {
        const wrapper = document.createElement('div'); wrapper.className = 'revenue-bar-item';
        const label = document.createElement('div'); label.className = 'bar-label';
        const month = document.createElement('span'); month.textContent = item.month || item.month_key || 'Month';
        const amount = document.createElement('strong'); amount.textContent = money(item.revenue);
        label.append(month, amount);
        const track = document.createElement('div'); track.className = 'bar-track';
        const fill = document.createElement('div'); fill.className = 'bar-fill cyan-fill';
        fill.style.width = `${Math.max(2, Number(item.revenue) / max * 100)}%`;
        track.append(fill); wrapper.append(label, track); container.append(wrapper);
    }
}

function renderServiceOrderBreakdown(items) {
    const container = document.getElementById('service-order-breakdown');
    if (!container) return;
    container.replaceChildren();
    if (!items.length) { container.textContent = 'No order records yet.'; return; }
    for (const item of items) {
        const row = document.createElement('li');
        const label = document.createElement('span'); label.textContent = item.service || 'Unspecified';
        const count = document.createElement('strong'); count.textContent = `${Number(item.total_orders || 0)} orders`;
        row.append(label, count); container.append(row);
    }
}

async function loadStaffServices() {
    const grid = document.querySelector('.services-grid');
    if (!grid) return;
    let result;
    try { result = await ACS_API.request('services', '/api/services'); }
    catch (error) { grid.textContent = `Could not load service catalog: ${error.message}`; throw error; }
    const items = result.data || [];
    grid.replaceChildren();
    if (!items.length) {
        const note = document.createElement('p');
        note.textContent = 'No service catalog items were returned. Check the inventory SELECT RLS policy in Supabase.';
        grid.append(note); return;
    }
    for (const item of items) {
        const card = document.createElement('div'); card.className = 'service-card';
        const top = document.createElement('div');
        const head = document.createElement('div'); head.className = 'service-card-header';
        const icon = document.createElement('div'); icon.className = 'service-icon';
        const iconNode = document.createElement('i');
        iconNode.className = item.service_type === 'Water' ? 'fa-solid fa-droplet' : item.service_type === 'Laundry' ? 'fa-solid fa-shirt' : 'fa-solid fa-print';
        icon.append(iconNode);
        const badge = document.createElement('span'); badge.className = `status-badge ${item.availability ? 'ready' : ''}`;
        badge.textContent = item.availability ? `${item.service_type} • Available` : 'Unavailable';
        head.append(icon, badge);
        const title = document.createElement('h4'); title.textContent = item.item_name;
        const price = document.createElement('div'); price.className = 'service-price';
        price.textContent = `${money(item.selling_price)} `;
        const unit = document.createElement('span'); unit.style.cssText = 'font-size:0.75rem;color:var(--text-muted);'; unit.textContent = item.service_type === 'Laundry' ? 'per load (up to 7 kg)' : `per ${item.unit || 'unit'}`; price.append(unit);
        const detail = document.createElement('p'); detail.textContent = item.description || item.category || '';
        top.append(head, title, price, detail); card.append(top);
        const actions = document.createElement('div'); actions.style.cssText = 'margin-top:1rem;display:flex;gap:8px;flex-wrap:wrap;';
        const view = document.createElement('button'); view.type = 'button'; view.className = 'action-btn secondary sm'; view.textContent = 'View details';
        view.addEventListener('click', () => viewServiceDetails(item.id)); actions.append(view);
        const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'action-btn secondary sm'; edit.textContent = 'Edit service';
        edit.addEventListener('click', () => editService(item)); actions.append(edit);
        const user = safeStoredUser();
        if (user?.role === 'admin') {
            const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'action-btn secondary sm'; remove.textContent = 'Delete';
            remove.addEventListener('click', () => deleteService(item)); actions.append(remove);
        }
        card.append(actions); grid.append(card);
    }
}

function safeStoredUser() {
    try { return JSON.parse(sessionStorage.getItem('acs_user') || 'null'); }
    catch { return null; }
}

async function viewServiceDetails(serviceId) {
    try {
        const result = await ACS_API.request('services', `/api/services/${encodeURIComponent(serviceId)}`);
        const item = result.data;
        const details = [
            `Name: ${item.item_name || '—'}`,
            `Type: ${item.service_type || '—'}`,
            `Category: ${item.category || '—'}`,
            `Description: ${item.description || '—'}`,
            `Price: ${money(item.selling_price)} ${item.service_type === 'Laundry' ? 'per load (up to 7 kg)' : `per ${item.unit || 'unit'}`}`,
            ...(item.service_type === 'Laundry' ? [`Stored catalog unit: ${item.unit || 'not set'}`] : []),
            `Stock quantity: ${item.stock_quantity ?? '—'}`,
            `Availability: ${item.availability ? 'Available' : 'Unavailable'}`,
            `Service ID: ${item.id}`
        ].join('\\n');
        alert(details);
    } catch (error) {
        showDashboardMessage(`Could not retrieve service details: ${error.message}`, true);
    }
}

async function createServiceFromPrompt() {
    const item_name = prompt('Service / item name:');
    if (!item_name?.trim()) return;
    const serviceTypeInput = prompt('Service type: Water, Laundry, or Printing', 'Water');
    const service_type = ['water', 'laundry', 'printing'].includes((serviceTypeInput || '').trim().toLowerCase()) ? (serviceTypeInput.trim().toLowerCase()[0].toUpperCase() + serviceTypeInput.trim().toLowerCase().slice(1)) : '';
    if (!service_type) { alert('Choose Water, Laundry, or Printing.'); return; }
    const unit = service_type === 'Laundry'
        ? 'load'
        : prompt('Pricing unit (for example: gallon, piece):', 'unit');
    if (!unit?.trim()) return;
    if (service_type === 'Laundry') {
        alert('For Laundry, enter the price for one machine load (up to 7 kg).');
    }
    const pricePrompt = service_type === 'Laundry' ? 'Selling price per machine load up to 7 kg (PHP):' : 'Selling price (PHP):';
    const selling_price = Number(prompt(pricePrompt, '0'));
    if (!Number.isFinite(selling_price) || selling_price < 0) { alert('Enter a valid non-negative price.'); return; }
    const stockRaw = prompt('Stock quantity (whole number; enter 0 if not tracked):', '0');
    const stock_quantity = Number(stockRaw);
    if (!Number.isInteger(stock_quantity) || stock_quantity < 0) { alert('Stock quantity must be a non-negative whole number.'); return; }
    try {
        await ACS_API.request('services', '/api/services', {
            method: 'POST', body: { item_name: item_name.trim(), service_type, unit: unit.trim(), selling_price, stock_quantity, availability: true }
        });
        await loadStaffServices();
        showDashboardMessage('Service added to the live catalog.');
    } catch (error) { showDashboardMessage(`Could not add service: ${error.message}`, true); }
}

async function editService(item) {
    const unitPrompt = item.service_type === 'Laundry' ? 'per machine load up to 7 kg' : 'per catalog unit';
    const selling_price = Number(prompt(`New price for ${item.item_name} (${unitPrompt}, PHP):`, String(item.selling_price)));
    if (!Number.isFinite(selling_price) || selling_price < 0) { alert('Enter a valid non-negative price.'); return; }
    const availableAnswer = prompt('Availability: type yes or no', item.availability ? 'yes' : 'no');
    if (!['yes', 'no'].includes((availableAnswer || '').toLowerCase())) return;
    try {
        await ACS_API.request('services', `/api/services/${encodeURIComponent(item.id)}`, {
            method: 'PATCH', body: { selling_price, availability: availableAnswer.toLowerCase() === 'yes' }
        });
        await loadStaffServices();
        showDashboardMessage('Service details updated.');
    } catch (error) { showDashboardMessage(`Could not update service: ${error.message}`, true); }
}

async function deleteService(item) {
    if (!confirm(`Delete ${item.item_name}? This action is restricted to administrators.`)) return;
    try {
        await ACS_API.request('services', `/api/services/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
        await loadStaffServices();
        showDashboardMessage('Service removed from the catalog.');
    } catch (error) { showDashboardMessage(`Could not delete service: ${error.message}`, true); }
}

async function loadStaffCustomers() {
    const tbody = document.getElementById('staff-customers-body');
    if (!tbody) return;
    try {
        const search = document.getElementById('customer-search');
        if (search && !search.dataset.bound) {
            search.dataset.bound = 'true';
            search.addEventListener('input', () => {
                const query = search.value.trim().toLowerCase();
                tbody.querySelectorAll('tr').forEach(row => { row.hidden = query && !row.textContent.toLowerCase().includes(query); });
            });
        }
        const result = await ACS_API.request('inventory', '/api/customers');
        const items = result.data || [];
        tbody.replaceChildren();
        if (!items.length) { setTableMessage(tbody, 'No customer accounts found yet.', 7); return; }
        for (const customer of items) {
            const row = document.createElement('tr');
            const values = [customer.id?.slice(0, 8) || '—', customer.full_name || '—', customer.phone || '—', customer.email || '—', customer.default_address || '—', String(customer.order_count ?? 0)];
            for (const value of values) { const td = document.createElement('td'); td.textContent = value; row.append(td); }
            const actions = document.createElement('td');
            const viewOrders = document.createElement('button'); viewOrders.type = 'button'; viewOrders.className = 'action-btn secondary sm'; viewOrders.textContent = 'View orders';
            viewOrders.addEventListener('click', async () => {
                try {
                    const result = await ACS_API.request('inventory', `/api/customers/${encodeURIComponent(customer.id)}/orders`);
                    const summary = (result.data || []).map(order => `${order.order_type === 'water' ? 'Water' : 'Laundry'} · ${order.service_name} · ${order.status} · ${money(order.total_amount)}`).join('\n');
                    alert(`${customer.full_name || customer.email} — ${result.count} order(s)\n\n${summary || 'No orders yet.'}`);
                } catch (error) { showDashboardMessage(`Could not retrieve customer orders: ${error.message}`, true); }
            });
            actions.append(viewOrders); row.append(actions); tbody.append(row);
        }
    } catch (error) {
        setTableMessage(tbody, `Customer directory unavailable: ${error.message}`, 7);
    }
}

async function loadAdminStaff() {
    const tbody = document.getElementById('admin-staff-body');
    if (!tbody) return;
    try {
        const result = await ACS_API.request('auth', '/api/users?role=staff');
        const staff = result.data || [];
        tbody.replaceChildren();
        if (!staff.length) { setTableMessage(tbody, 'No staff accounts found. Use Add Staff Account to send an invitation.', 6); return; }
        for (const person of staff) {
            const row = document.createElement('tr');
            const values = [person.id?.slice(0, 8) || '—', person.full_name || '—', person.email || '—'];
            values.forEach((value, index) => { const td = document.createElement('td'); td.textContent = value; if (index === 0) { const strong = document.createElement('strong'); strong.textContent = value; td.replaceChildren(strong); } row.append(td); });
            const role = document.createElement('td'); role.textContent = 'Staff'; row.append(role);
            const status = document.createElement('td'); status.textContent = person.is_active === false ? 'Deactivated' : 'Active'; row.append(status);
            const actionCell = document.createElement('td');
            const button = document.createElement('button'); button.type = 'button'; button.className = 'action-btn secondary sm'; button.textContent = 'Edit';
            button.addEventListener('click', () => editStaffAccount(person)); actionCell.append(button);
            const activation = document.createElement('button'); activation.type = 'button'; activation.className = 'action-btn secondary sm'; activation.style.marginLeft = '4px';
            activation.textContent = person.is_active === false ? 'Activate' : 'Deactivate';
            activation.addEventListener('click', () => setStaffAccountActive(person, person.is_active === false));
            actionCell.append(activation); row.append(actionCell);
            tbody.append(row);
        }
    } catch (error) { setTableMessage(tbody, `Staff list unavailable: ${error.message}`, 6); }
}

async function createStaffInvite() {
    const full_name = prompt('New staff member full name:');
    if (!full_name?.trim()) return;
    const email = prompt('Staff member email address:');
    if (!email?.trim()) return;
    const phone = prompt('Phone number (optional):') || null;
    try {
        const result = await ACS_API.request('auth', '/api/users', { method: 'POST', body: { role: 'staff', full_name: full_name.trim(), email: email.trim(), phone } });
        showDashboardMessage(result.message || 'Staff invitation sent. Ask the person to check their email.');
        await loadAdminStaff();
    } catch (error) { showDashboardMessage(`Could not invite staff member: ${error.message}`, true); }
}

async function editStaffAccount(person) {
    const full_name = prompt('Staff full name:', person.full_name || '');
    if (!full_name?.trim()) return;
    const phone = prompt('Phone number (leave blank to clear):', person.phone || '');
    try {
        await ACS_API.request('auth', `/api/users/${encodeURIComponent(person.id)}`, { method: 'PUT', body: { full_name: full_name.trim(), phone: phone?.trim() || null } });
        await loadAdminStaff();
        showDashboardMessage('Staff profile updated.');
    } catch (error) { showDashboardMessage(`Could not update staff profile: ${error.message}`, true); }
}


async function setStaffAccountActive(person, active) {
    const action = active ? 'activate' : 'deactivate';
    if (!confirm(`${action.charAt(0).toUpperCase() + action.slice(1)} ${person.full_name || person.email}? ${active ? 'The account will be allowed to sign in again.' : 'The account will no longer be allowed to sign in. Existing business records will be retained.'}`)) return;
    try {
        if (active) {
            await ACS_API.request('auth', `/api/users/${encodeURIComponent(person.id)}`, { method: 'PUT', body: { is_active: true } });
        } else {
            await ACS_API.request('auth', `/api/users/${encodeURIComponent(person.id)}`, { method: 'DELETE' });
        }
        await loadAdminStaff();
        showDashboardMessage(`Staff account ${active ? 'activated' : 'deactivated'}.`);
    } catch (error) { showDashboardMessage(`Could not ${action} staff account: ${error.message}`, true); }
}

async function loadAuditLogs() {
    const tbody = document.getElementById('admin-audit-logs-body');
    if (!tbody) return;
    try {
        const result = await ACS_API.request('analytics', '/api/audit-logs?page=1&limit=50');
        const logs = result.data || [];
        tbody.replaceChildren();
        if (!logs.length) { setTableMessage(tbody, 'No audit log entries found.', 5); return; }
        for (const log of logs) {
            const row = document.createElement('tr');
            const date = log.created_at ? new Date(log.created_at).toLocaleString('en-PH') : '—';
            const values = [date, log.user_name || log.user_email || log.user_id || '—', log.action || '—', log.module || log.resource_type || '—', log.details || log.description || log.resource_id || '—'];
            values.forEach(value => { const td = document.createElement('td'); td.textContent = String(value); row.append(td); });
            tbody.append(row);
        }
    } catch (error) { setTableMessage(tbody, `Audit log lookup failed: ${error.message}`, 5); }
}

function markUnsupportedStaffModules() {
    // Kept for older HTML callers; operational modules are now loaded from their APIs.
    loadStaffOrders();
    loadStaffSchedules();
    loadSupplyInventory();
}

window.createServiceFromPrompt = createServiceFromPrompt;
window.createStaffInvite = createStaffInvite;
window.loadStaffServices = loadStaffServices;


// Orders & Fulfillment -------------------------------------------------------
let staffOrderCache = [];
let staffServiceCache = [];

function nextStatuses(current) {
    const map = {
        'Pending': ['In Progress', 'Cancelled'],
        'In Progress': ['Out for Delivery', 'Ready for Station Pickup', 'Completed', 'Cancelled'],
        'Out for Delivery': ['Completed', 'Cancelled'],
        'Ready for Station Pickup': ['Completed', 'Cancelled'],
        'Completed': [], 'Cancelled': []
    };
    return map[current] || [];
}

async function loadStaffOrders() {
    const tbody = document.getElementById('staff-orders-body');
    if (!tbody) return;
    try {
        const result = await ACS_API.request('orders', '/api/orders');
        staffOrderCache = (result.data || []).map(item => ({ ...item, order_type: item.order_type }))
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        renderStaffOrders();
    } catch (error) { setTableMessage(tbody, `Orders could not be loaded: ${error.message}`, 7); }
}

function renderStaffOrders() {
    const tbody = document.getElementById('staff-orders-body');
    if (!tbody) return;
    const search = (document.getElementById('staff-orders-search')?.value || '').trim().toLowerCase();
    const serviceFilter = document.getElementById('staff-orders-service-filter')?.value || 'ALL';
    const statusFilter = document.getElementById('staff-orders-status-filter')?.value || 'ALL';
    const rows = staffOrderCache.filter(order => {
        const service = order.order_type === 'water' ? 'Water' : 'Laundry';
        const customerText = `${order.customer?.full_name || ''} ${order.customer?.email || ''} ${order.id}`.toLowerCase();
        return (!search || customerText.includes(search)) && (serviceFilter === 'ALL' || service === serviceFilter || (serviceFilter === 'Water Refilling' && service === 'Water') || (serviceFilter === 'Laundry' && service === 'Laundry')) && (statusFilter === 'ALL' || order.status === statusFilter);
    });
    tbody.replaceChildren();
    if (!rows.length) { setTableMessage(tbody, 'No matching orders or bookings found.', 7); return; }
    for (const order of rows) {
        const row = document.createElement('tr');
        const cells = [
            order.id.slice(0, 8).toUpperCase(),
            order.customer?.full_name || order.customer?.email || order.user_id.slice(0, 8),
            `${order.order_type === 'water' ? 'Water' : 'Laundry'} · ${order.service_name}`,
            order.order_type === 'water' ? `${order.quantity} × ${order.service_name}` : `${order.weight_kg} kg · ${order.load_count || Math.ceil(Number(order.weight_kg) / 7)} load(s)`,
            money(order.total_amount),
            order.status
        ];
        for (const value of cells) { const td = document.createElement('td'); td.textContent = value; row.append(td); }
        const actions = document.createElement('td');
        const details = document.createElement('button'); details.type = 'button'; details.className = 'action-btn secondary sm'; details.textContent = 'Details';
        details.addEventListener('click', () => inspectStaffOrder(order)); actions.append(details);
        const next = nextStatuses(order.status);
        if (next.length) {
            const select = document.createElement('select'); select.style.cssText = 'max-width:140px;margin:4px;';
            const initial = document.createElement('option'); initial.value = ''; initial.textContent = 'Update status…'; select.append(initial);
            for (const status of next) { const option = document.createElement('option'); option.value = status; option.textContent = status; select.append(option); }
            const update = document.createElement('button'); update.type = 'button'; update.className = 'action-btn primary sm'; update.textContent = 'Save';
            update.addEventListener('click', async () => {
                if (!select.value) return;
                const note = prompt('Status note (optional):', '');
                try {
                    const endpoint = `/api/orders/${encodeURIComponent(order.id)}?order_type=${order.order_type}`;
                    await ACS_API.request('orders', endpoint, { method: 'PATCH', body: { order_type: order.order_type, status: select.value, status_note: note || null } });
                    showDashboardMessage('Order status updated.');
                    await loadStaffOrders();
                } catch (error) { showDashboardMessage(`Could not update order: ${error.message}`, true); }
            });
            actions.append(select, update);
        }
        row.append(actions); tbody.append(row);
    }
}

async function inspectStaffOrder(order) {
    try {
        const result = await ACS_API.request('orders', `/api/orders/${encodeURIComponent(order.id)}?order_type=${order.order_type}`);
        const record = result.data;
        const payment = record.payment;
        const lines = [
            `Customer: ${order.customer?.full_name || order.customer?.email || record.user_id}`,
            `Service: ${record.service_name}`,
            `Total: ${money(record.total_amount)}`,
            `Schedule: ${record.delivery_date} ${String(record.delivery_time).slice(0, 5)}`,
            `Fulfillment: ${record.fulfillment_type}`,
            `Address: ${record.delivery_address || 'Station pickup'}`,
            `Status: ${record.status}`,
            `Payment method: ${record.payment_method}`,
            `Payment status: ${payment?.payment_status || 'No payment record'}`,
            `GCash reference: ${payment?.reference_number || '—'}`,
            `Status history: ${(record.status_history || []).map(item => `${item.new_status} ${item.note || ''}`).join(' | ') || 'None'}`
        ];
        if (payment && payment.payment_status === 'submitted') {
            if (confirm(`${lines.join('\n')}\n\nVerify this submitted GCash payment?`)) {
                await ACS_API.request('orders', `/api/payments/${encodeURIComponent(payment.id)}/status`, { method: 'PATCH', body: { payment_status: 'verified', verification_note: 'GCash reference checked and verified by staff.' } });
                showDashboardMessage('GCash payment verified.');
            } else if (confirm('Reject this submitted GCash payment instead?')) {
                const verification_note = prompt('Reason for rejection:') || 'Payment rejected by staff.';
                await ACS_API.request('orders', `/api/payments/${encodeURIComponent(payment.id)}/status`, { method: 'PATCH', body: { payment_status: 'rejected', verification_note } });
                showDashboardMessage('GCash payment rejected. The customer can resubmit a corrected reference.', true);
            }
        } else if (payment && payment.payment_status === 'pending' && payment.payment_method === 'Cash on Delivery (COD)') {
            if (confirm(`${lines.join('\n')}\n\nConfirm that the COD amount has been collected?`)) {
                await ACS_API.request('orders', `/api/payments/${encodeURIComponent(payment.id)}/status`, { method: 'PATCH', body: { payment_status: 'verified', verification_note: 'Cash on delivery collected and verified by staff.' } });
                showDashboardMessage('COD payment marked as collected and verified.');
            } else alert(lines.join('\n'));
        } else alert(lines.join('\n'));
        await loadStaffOrders();
    } catch (error) { showDashboardMessage(`Could not retrieve order details: ${error.message}`, true); }
}

async function loadServiceOptionsForStaffOrder() {
    const type = document.getElementById('staff-create-order-type')?.value || 'water';
    const select = document.getElementById('staff-create-service-id');
    if (!select) return;
    try {
        const result = await ACS_API.request('services', `/api/services?service_type=${type === 'water' ? 'Water' : 'Laundry'}&available=true`);
        staffServiceCache = result.data || [];
        select.replaceChildren();
        if (!staffServiceCache.length) { const option = document.createElement('option'); option.value = ''; option.textContent = 'No services available'; select.append(option); return; }
        for (const service of staffServiceCache) {
            const option = document.createElement('option'); option.value = service.id;
            option.textContent = `${service.item_name} · ${money(service.selling_price)}/${service.service_type === 'Laundry' ? 'load (up to 7 kg)' : (service.unit || 'unit')}`;
            select.append(option);
        }
    } catch (error) { select.replaceChildren(); const option = document.createElement('option'); option.value = ''; option.textContent = error.message; select.append(option); }
}

async function loadCustomerOptionsForStaffOrder() {
    const select = document.getElementById('staff-create-customer-id');
    if (!select) return;
    try {
        const result = await ACS_API.request('inventory', '/api/customers');
        select.replaceChildren();
        for (const customer of result.data || []) {
            const option = document.createElement('option'); option.value = customer.id;
            option.textContent = `${customer.full_name || customer.email || 'Customer'} · ${String(customer.id).slice(0, 8)}`;
            select.append(option);
        }
        if (!select.options.length) { const option = document.createElement('option'); option.value = ''; option.textContent = 'No customer accounts'; select.append(option); }
    } catch (error) { select.replaceChildren(); const option = document.createElement('option'); option.value = ''; option.textContent = error.message; select.append(option); }
}

async function loadStaffCreateOrderSlots() {
    const type = document.getElementById('staff-create-order-type')?.value || 'water';
    const fulfillment = document.getElementById('staff-create-fulfillment')?.value || 'delivery';
    const date = document.getElementById('staff-create-date')?.value;
    const select = document.getElementById('staff-create-slot');
    if (!select || !date) return;
    try {
        const query = new URLSearchParams({ service_type: type === 'water' ? 'Water' : 'Laundry', fulfillment_type: fulfillment, date });
        const result = await ACS_API.request('orders', `/api/delivery-schedules?${query.toString()}`);
        select.replaceChildren();
        for (const slot of result.data || []) {
            const option = document.createElement('option'); option.value = slot.id;
            option.textContent = `${String(slot.start_time).slice(0, 5)}-${String(slot.end_time).slice(0, 5)} (${slot.available_capacity} left)`; select.append(option);
        }
        if (!select.options.length) { const option = document.createElement('option'); option.value = ''; option.textContent = 'No slots available'; select.append(option); }
    } catch (error) { select.replaceChildren(); const option = document.createElement('option'); option.value = ''; option.textContent = error.message; select.append(option); }
}

async function submitStaffCreatedOrder() {
    const status = document.getElementById('staff-create-order-status');
    const type = document.getElementById('staff-create-order-type').value;
    const serviceId = document.getElementById('staff-create-service-id').value;
    const customerId = document.getElementById('staff-create-customer-id').value.trim();
    const fulfillment = document.getElementById('staff-create-fulfillment').value;
    const scheduleId = document.getElementById('staff-create-slot').value;
    const paymentMethod = document.getElementById('staff-create-payment').value;
    const reference = document.getElementById('staff-create-gcash-reference').value.trim();
    if (!customerId || !serviceId || !scheduleId) { status.textContent = 'Customer UUID, service, and schedule are required.'; return; }
    if (paymentMethod === 'GCash Online Payment' && !reference) { status.textContent = 'GCash reference number is required.'; return; }
    if (fulfillment === 'delivery' && !document.getElementById('staff-create-address').value.trim()) { status.textContent = 'Delivery address is required.'; return; }
    const body = {
        customer_id: customerId, service_id: serviceId, fulfillment_type: fulfillment,
        delivery_address: document.getElementById('staff-create-address').value.trim() || null,
        schedule_id: scheduleId, payment_method: paymentMethod, reference_number: reference || null
    };
    const quantity = Number(document.getElementById('staff-create-quantity').value);
    if (type === 'water') body.quantity = quantity; else body.weight_kg = quantity;
    try {
        body.order_type = type;
        const created = await ACS_API.request('orders', '/api/orders', { method: 'POST', body });
        const paymentMessage = `Initial payment record: ${created.data.payment?.payment_status || 'pending'}.`;
        status.textContent = `Created order ${created.data.id}. ${paymentMessage}`;
        await loadStaffOrders();
    } catch (error) { status.textContent = `Could not create order: ${error.message}`; }
}

// Delivery schedule management ----------------------------------------------
async function loadStaffSchedules() {
    const container = document.getElementById('staff-schedules-grid');
    if (!container) return;
    try {
        // Retrieve active upcoming slots across all available dates.
        const all = await ACS_API.request('orders', '/api/delivery-schedules');
        const slots = all.data || [];
        container.replaceChildren();
        if (!slots.length) { container.textContent = 'No active schedule slots yet. Add the business-approved time slots above so customers can book.'; return; }
        const table = document.createElement('table'); table.className = 'data-table';
        const head = document.createElement('thead'); const trh = document.createElement('tr');
        for (const label of ['Date','Service','Fulfillment','Time','Capacity','Actions']) { const th = document.createElement('th'); th.textContent = label; trh.append(th); }
        head.append(trh); table.append(head);
        const body = document.createElement('tbody');
        for (const slot of slots) {
            const row = document.createElement('tr');
            for (const value of [slot.schedule_date, slot.service_type, slot.fulfillment_type === 'delivery' ? 'Home delivery' : 'Station pickup', `${String(slot.start_time).slice(0,5)}-${String(slot.end_time).slice(0,5)}`, `${slot.booked_count}/${slot.capacity}`]) { const td = document.createElement('td'); td.textContent = value; row.append(td); }
            const action = document.createElement('td');
            const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'action-btn secondary sm'; edit.textContent = 'Edit capacity';
            edit.addEventListener('click', async () => {
                const capacity = Number(prompt('New total capacity (must be at least the number already booked):', String(slot.capacity)));
                if (!Number.isInteger(capacity) || capacity < 1) return showDashboardMessage('Enter a positive whole-number capacity.', true);
                try { await ACS_API.request('orders', `/api/delivery-schedules/${encodeURIComponent(slot.id)}`, { method: 'PUT', body: { capacity } }); await loadStaffSchedules(); showDashboardMessage('Schedule capacity updated.'); }
                catch (error) { showDashboardMessage(`Could not update schedule: ${error.message}`, true); }
            });
            const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'action-btn secondary sm'; remove.textContent = 'Deactivate'; remove.style.marginLeft = '4px';
            remove.addEventListener('click', async () => { try { await ACS_API.request('orders', `/api/delivery-schedules/${encodeURIComponent(slot.id)}`, { method: 'DELETE' }); await loadStaffSchedules(); showDashboardMessage('Schedule slot deactivated.'); } catch (error) { showDashboardMessage(error.message, true); } });
            action.append(edit, remove); row.append(action); body.append(row);
        }
        table.append(body); container.append(table);
    } catch (error) { container.textContent = `Could not load schedule slots: ${error.message}`; }
}

// Separate supply inventory --------------------------------------------------
async function loadSupplyInventory() {
    const tbody = document.getElementById('supply-inventory-body');
    const kpis = document.getElementById('supply-inventory-kpis');
    if (!tbody) return;
    try {
        const result = await ACS_API.request('inventory', '/api/inventory');
        const items = result.data || [];
        if (kpis) {
            kpis.replaceChildren();
            for (const [label, value] of [['Total items', result.summary?.total_items || 0], ['Low stock', result.summary?.low_stock_items || 0], ['Out of stock', result.summary?.out_of_stock_items || 0]]) {
                const card = document.createElement('div'); card.className = 'kpi-card';
                const details = document.createElement('div'); details.className = 'kpi-details';
                const name = document.createElement('span'); name.className = 'kpi-label'; name.textContent = label;
                const count = document.createElement('span'); count.className = 'kpi-value'; count.textContent = String(value);
                details.append(name, count); card.append(details); kpis.append(card);
            }
        }
        tbody.replaceChildren();
        if (!items.length) { setTableMessage(tbody, 'No supply items recorded yet. Use Add Supply Item to create the supply list.', 7); return; }
        for (const item of items) {
            const row = document.createElement('tr');
            for (const value of [item.item_name, item.category || '—', `${item.quantity_on_hand} ${item.unit}`, `${item.reorder_level} ${item.unit}`, item.stock_status.replaceAll('_',' '), item.supplier || '—']) { const td = document.createElement('td'); td.textContent = value; row.append(td); }
            const actions = document.createElement('td');
            const detail = document.createElement('button'); detail.type = 'button'; detail.className = 'action-btn secondary sm'; detail.textContent = 'Details';
            detail.addEventListener('click', async () => {
                try { const result = await ACS_API.request('inventory', `/api/inventory/${encodeURIComponent(item.id)}`); const record = result.data; alert(`${record.item_name}\nCategory: ${record.category || '—'}\nQuantity: ${record.quantity_on_hand} ${record.unit}\nReorder level: ${record.reorder_level} ${record.unit}\nStatus: ${record.stock_status}\nSupplier: ${record.supplier || '—'}\nNotes: ${record.notes || '—'}`); }
                catch (error) { showDashboardMessage(`Could not retrieve supply details: ${error.message}`, true); }
            }); actions.append(detail);
            const restock = document.createElement('button'); restock.type = 'button'; restock.className = 'action-btn primary sm'; restock.textContent = 'Restock'; restock.style.marginLeft = '4px'; restock.addEventListener('click', () => restockSupplyItem(item)); actions.append(restock);
            const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'action-btn secondary sm'; edit.textContent = 'Edit'; edit.style.marginLeft = '4px'; edit.addEventListener('click', () => editSupplyItem(item)); actions.append(edit);
            const role = safeStoredUser()?.role;
            if (role === 'admin') { const del = document.createElement('button'); del.type = 'button'; del.className = 'action-btn secondary sm'; del.textContent = 'Delete'; del.style.marginLeft = '4px'; del.addEventListener('click', () => deleteSupplyItem(item)); actions.append(del); }
            row.append(actions); tbody.append(row);
        }
    } catch (error) { setTableMessage(tbody, `Supply inventory unavailable: ${error.message}`, 7); if (kpis) kpis.textContent = 'Could not load supply inventory.'; }
}
async function addSupplyItem() {
    const item_name = prompt('Supply item name:'); if (!item_name?.trim()) return;
    const category = prompt('Category (optional):') || null;
    const unit = prompt('Unit (for example: piece, bottle, cartridge):', 'piece'); if (!unit?.trim()) return;
    const quantity_on_hand = Number(prompt('Current quantity on hand:', '0'));
    const reorder_level = Number(prompt('Low-stock / reorder threshold:', '5'));
    const supplier = prompt('Supplier (optional):') || null;
    if (!Number.isFinite(quantity_on_hand) || quantity_on_hand < 0 || !Number.isFinite(reorder_level) || reorder_level < 0) return showDashboardMessage('Enter valid non-negative stock quantities.', true);
    try { await ACS_API.request('inventory', '/api/inventory', { method: 'POST', body: { item_name: item_name.trim(), category, unit: unit.trim(), quantity_on_hand, reorder_level, supplier } }); await loadSupplyInventory(); showDashboardMessage('Supply item added.'); }
    catch (error) { showDashboardMessage(`Could not add supply: ${error.message}`, true); }
}
async function restockSupplyItem(item) {
    const quantity = Number(prompt(`How many ${item.unit} should be added to ${item.item_name}?`, '1'));
    if (!Number.isFinite(quantity) || quantity <= 0) return;
    try { await ACS_API.request('inventory', `/api/inventory/${encodeURIComponent(item.id)}`, { method: 'PUT', body: { restock_quantity: quantity } }); await loadSupplyInventory(); showDashboardMessage('Supply item restocked.'); }
    catch (error) { showDashboardMessage(`Restock failed: ${error.message}`, true); }
}
async function editSupplyItem(item) {
    const item_name = prompt('Item name:', item.item_name); if (!item_name?.trim()) return;
    const quantity_on_hand = Number(prompt('Quantity on hand:', String(item.quantity_on_hand)));
    const reorder_level = Number(prompt('Reorder level:', String(item.reorder_level)));
    if (!Number.isFinite(quantity_on_hand) || quantity_on_hand < 0 || !Number.isFinite(reorder_level) || reorder_level < 0) return showDashboardMessage('Enter valid quantities.', true);
    try { await ACS_API.request('inventory', `/api/inventory/${encodeURIComponent(item.id)}`, { method: 'PUT', body: { item_name: item_name.trim(), quantity_on_hand, reorder_level } }); await loadSupplyInventory(); showDashboardMessage('Supply item updated.'); }
    catch (error) { showDashboardMessage(`Could not update supply: ${error.message}`, true); }
}
async function deleteSupplyItem(item) {
    if (!confirm(`Delete supply item ${item.item_name}?`)) return;
    try { await ACS_API.request('inventory', `/api/inventory/${encodeURIComponent(item.id)}`, { method: 'DELETE' }); await loadSupplyInventory(); showDashboardMessage('Supply item deleted.'); }
    catch (error) { showDashboardMessage(`Could not delete supply: ${error.message}`, true); }
}

function bindOperationsEvents() {
    document.getElementById('staff-orders-search')?.addEventListener('input', renderStaffOrders);
    document.getElementById('staff-orders-service-filter')?.addEventListener('change', renderStaffOrders);
    document.getElementById('staff-orders-status-filter')?.addEventListener('change', renderStaffOrders);
    document.getElementById('toggle-create-order')?.addEventListener('click', async () => {
        const panel = document.getElementById('staff-create-order-panel');
        panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
        if (panel.style.display === 'block') { await Promise.all([loadCustomerOptionsForStaffOrder(), loadServiceOptionsForStaffOrder()]); await loadStaffCreateOrderSlots(); }
    });
    document.getElementById('staff-create-order-type')?.addEventListener('change', async () => { await loadServiceOptionsForStaffOrder(); await loadStaffCreateOrderSlots(); });
    document.getElementById('staff-create-fulfillment')?.addEventListener('change', loadStaffCreateOrderSlots);
    document.getElementById('staff-create-date')?.addEventListener('change', loadStaffCreateOrderSlots);
    document.getElementById('staff-create-order-submit')?.addEventListener('click', submitStaffCreatedOrder);
    document.getElementById('staff-create-order-cancel')?.addEventListener('click', () => { document.getElementById('staff-create-order-panel').style.display = 'none'; });
    document.getElementById('schedule-create-btn')?.addEventListener('click', async () => {
        const status = document.getElementById('schedule-status');
        const body = {
            service_type: document.getElementById('schedule-service-type').value,
            fulfillment_type: document.getElementById('schedule-fulfillment').value,
            schedule_date: document.getElementById('schedule-date').value,
            start_time: document.getElementById('schedule-start').value,
            end_time: document.getElementById('schedule-end').value,
            capacity: Number(document.getElementById('schedule-capacity').value)
        };
        try { await ACS_API.request('orders', '/api/delivery-schedules', { method: 'POST', body }); status.textContent = 'Schedule slot created.'; await loadStaffSchedules(); }
        catch (error) { status.textContent = error.message; }
    });
    document.getElementById('supply-add-btn')?.addEventListener('click', addSupplyItem);
    const date = document.getElementById('schedule-date');
    if (date) {
        const today = new Date();
        const todayString = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
        const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowString = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth()+1).padStart(2,'0')}-${String(tomorrow.getDate()).padStart(2,'0')}`;
        date.min = todayString;
        date.value = tomorrowString;
    }
    const staffDate = document.getElementById('staff-create-date');
    if (staffDate) { const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate()+1); staffDate.value = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth()+1).padStart(2,'0')}-${String(tomorrow.getDate()).padStart(2,'0')}`; staffDate.min = localDateISO(); }
}
function localDateISO() { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`; }
