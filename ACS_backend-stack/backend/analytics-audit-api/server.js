require('../shared/supabase');
const express = require('express');
const cors = require('cors');
const { supabaseAdmin } = require('../shared/supabase');
const { respondWithDatabaseHealth } = require('../shared/health');
const { authenticate, authorize } = require('../shared/authMiddleware');
const { corsOptions } = require('../shared/serverConfig');

const app = express();
const PORT = Number(process.env.ANALYTICS_PORT || 3001);
const adminOnly = [authenticate, authorize('admin')];

app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' }));
app.get('/', (req, res) => res.json({ success: true, service: 'analytics-audit-api', message: 'Alavanza Analytics & Audit Logs API is running.' }));
app.get('/health', (req, res) => respondWithDatabaseHealth(res, supabaseAdmin, 'analytics-audit-api', [{ table: 'audit_logs', columns: 'user_id,action,entity_type,module,details,created_at' }]));

function manilaYearMonth(value) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit' }).formatToParts(new Date(value));
    return `${parts.find(part => part.type === 'year')?.value}-${parts.find(part => part.type === 'month')?.value}`;
}
function manilaMonthLabel(yearMonth) {
    const [year, month] = yearMonth.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, 15)).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}
async function safeRows(query, label) {
    const { data, error } = await query;
    if (error) {
        console.warn(`Analytics optional source ${label} unavailable:`, error.message);
        return [];
    }
    return data || [];
}
async function fetchOperationalData() {
    const [legacyOrders, waterOrders, laundryBookings, legacyPayments, orderPayments, profiles] = await Promise.all([
        safeRows(supabaseAdmin.from('orders').select('id,status,service_type'), 'orders'),
        safeRows(supabaseAdmin.from('water_orders').select('id,status,created_at'), 'water_orders'),
        safeRows(supabaseAdmin.from('laundry_bookings').select('id,status,created_at'), 'laundry_bookings'),
        safeRows(supabaseAdmin.from('payments').select('amount,payment_status,created_at'), 'payments'),
        safeRows(supabaseAdmin.from('order_payments').select('amount,payment_status,created_at,verified_at'), 'order_payments'),
        safeRows(supabaseAdmin.from('profiles').select('id,role'), 'profiles')
    ]);
    const orders = [
        ...legacyOrders.map(row => ({ ...row, service_type: row.service_type || 'Legacy' })),
        ...waterOrders.map(row => ({ ...row, service_type: 'Water' })),
        ...laundryBookings.map(row => ({ ...row, service_type: 'Laundry' }))
    ];
    const payments = [...legacyPayments, ...orderPayments.map(payment => ({ ...payment, created_at: payment.verified_at || payment.created_at }))];
    return { orders, payments, profiles };
}

app.get('/api/analytics/overview', ...adminOnly, async (req, res) => {
    try {
        const { orders, payments, profiles } = await fetchOperationalData();
        const nowMonth = manilaYearMonth(new Date());
        const monthlyRevenue = payments.filter(payment => payment.payment_status === 'verified' && payment.created_at && manilaYearMonth(payment.created_at) === nowMonth)
            .reduce((total, payment) => total + Number(payment.amount || 0), 0);
        const activeOrders = orders.filter(order => ['Pending', 'In Progress', 'Out for Delivery', 'Ready for Station Pickup'].includes(order.status)).length;
        const completedOrders = orders.filter(order => order.status === 'Completed').length;
        const totalCustomers = profiles.filter(profile => profile.role === 'customer').length;
        return res.json({ success: true, data: {
            monthly_revenue: Number(monthlyRevenue.toFixed(2)), active_orders: activeOrders,
            total_customers: totalCustomers, completed_orders: completedOrders
        } });
    } catch (error) {
        console.error('analytics overview error:', error.message);
        return res.status(500).json({ success: false, message: 'Failed to retrieve analytics overview.' });
    }
});

app.get('/api/analytics/revenue', ...adminOnly, async (req, res) => {
    try {
        const { payments } = await fetchOperationalData();
        const totals = new Map();
        for (const payment of payments) {
            if (payment.payment_status !== 'verified' || !payment.created_at) continue;
            const key = manilaYearMonth(payment.created_at);
            totals.set(key, (totals.get(key) || 0) + Number(payment.amount || 0));
        }
        const data = [...totals.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, amount]) => ({
            month: manilaMonthLabel(key), month_key: key, revenue: Number(amount.toFixed(2))
        }));
        return res.json({ success: true, count: data.length, data });
    } catch (error) {
        console.error('revenue analytics error:', error.message);
        return res.status(500).json({ success: false, message: 'Failed to retrieve revenue analytics.' });
    }
});

app.get('/api/analytics/services', ...adminOnly, async (req, res) => {
    try {
        const { orders } = await fetchOperationalData();
        const counts = new Map();
        for (const order of orders) {
            const service = order.service_type || 'Unspecified';
            counts.set(service, (counts.get(service) || 0) + 1);
        }
        const data = [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([service, total]) => ({ service, total_orders: total }));
        return res.json({ success: true, count: data.length, data, note: 'Includes legacy orders, Water orders, and Laundry bookings across all statuses.' });
    } catch (error) {
        console.error('service analytics error:', error.message);
        return res.status(500).json({ success: false, message: 'Failed to retrieve service analytics.' });
    }
});

app.get('/api/audit-logs', ...adminOnly, async (req, res) => {
    try {
        const page = Number.parseInt(req.query.page || '1', 10);
        const limit = Number.parseInt(req.query.limit || '50', 10);
        if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
            return res.status(400).json({ success: false, message: 'page must be >= 1 and limit must be between 1 and 100.' });
        }
        const from = (page - 1) * limit;
        const to = from + limit - 1;
        const { data, error, count } = await supabaseAdmin.from('audit_logs').select('*', { count: 'exact' })
            .order('created_at', { ascending: false }).range(from, to);
        if (error) throw error;

        const rows = data || [];
        const userIds = [...new Set(rows.map(row => row.user_id).filter(Boolean))];
        let profilesById = {};
        if (userIds.length) {
            const { data: profiles, error: profilesError } = await supabaseAdmin
                .from('profiles').select('id,full_name,email').in('id', userIds);
            if (profilesError) console.warn('Audit log user names could not be resolved:', profilesError.message);
            else profilesById = Object.fromEntries((profiles || []).map(profile => [profile.id, profile]));
        }
        const enriched = rows.map(row => ({
            ...row,
            user_name: profilesById[row.user_id]?.full_name || null,
            user_email: profilesById[row.user_id]?.email || null
        }));
        return res.json({ success: true, count: enriched.length, total: count || 0, page, limit, data: enriched });
    } catch (error) {
        console.error('audit log lookup error:', error.message);
        return res.status(500).json({ success: false, message: `Failed to retrieve audit logs: ${error.message}. Apply the audit_logs compatibility migration and verify its required columns.` });
    }
});

app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) return res.status(400).json({ success: false, message: 'Request body contains invalid JSON.' });
    if (err.message === 'Origin is not allowed by CORS.') return res.status(403).json({ success: false, message: err.message });
    console.error('Analytics API error:', err.message);
    return res.status(500).json({ success: false, message: 'An unexpected server error occurred.' });
});

app.listen(PORT, () => console.log(`Analytics & Audit Logs API running at http://localhost:${PORT}`));
