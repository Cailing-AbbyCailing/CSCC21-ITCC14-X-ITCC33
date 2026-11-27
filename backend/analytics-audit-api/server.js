'use strict';
require('../shared/supabase');
const express = require('express');
const { supabaseAdmin } = require('../shared/supabase');
const { respondWithDatabaseHealth } = require('../shared/health');
const { authenticate, authorize } = require('../shared/authMiddleware');
const app = express();
const admin = [authenticate, authorize('admin')];
const LOW_STOCK_THRESHOLD = Math.max(0, Number(process.env.LOW_STOCK_THRESHOLD || 5));
const fail = (res, status, message) => res.status(status).json({ success: false, message });
app.use(express.json({ limit: '1mb' }));
app.get('/', (_req, res) => res.json({ success: true, service: 'analytics-audit-api' }));
app.get('/health/analytics', (req, res) => respondWithDatabaseHealth(res, supabaseAdmin, 'analytics-audit-api', ['orders', 'payments', 'profiles', 'inventory', 'audit_logs']));
function canonicalStatus(value) { const k = String(value || '').toLowerCase(); return ({ pending:'Pending', 'in progress':'In Progress', 'out for delivery':'Out for Delivery', 'ready for station pickup':'Ready for Station Pickup', completed:'Completed', cancelled:'Cancelled' })[k] || value; }
function monthKey(value) { const d = new Date(value); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
function monthLabel(key) { const [y, m] = key.split('-').map(Number); return new Date(Date.UTC(y, m - 1, 15)).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }); }
async function fetchAll(table, select) { const { data, error } = await supabaseAdmin.from(table).select(select).limit(5000); if (error) throw error; return data || []; }
async function getData() {
  const [orders, payments, profiles, inventory] = await Promise.all([
    fetchAll('orders', 'id,user_id,service_type,order_details,status,total_price,created_at,payment_status'),
    fetchAll('payments', 'id,order_id,payment_method,amount,payment_status,received_by,reference_number,created_at'),
    fetchAll('profiles', 'id,role'),
    fetchAll('inventory', 'id,service_type,stock_quantity,availability')
  ]);
  return { orders, payments, profiles, inventory };
}
app.get('/api/analytics/overview', ...admin, async (_req, res) => {
  try {
    const { orders, payments, profiles, inventory } = await getData();
    const currentMonth = monthKey(new Date().toISOString());
    const revenue = payments.filter(p => p.payment_status === 'verified' && monthKey(p.created_at) === currentMonth).reduce((n, p) => n + Number(p.amount || 0), 0);
    return res.json({ success: true, data: {
      monthly_revenue: Number(revenue.toFixed(2)),
      active_orders: orders.filter(o => ['Pending', 'In Progress', 'Out for Delivery', 'Ready for Station Pickup'].includes(canonicalStatus(o.status))).length,
      completed_orders: orders.filter(o => canonicalStatus(o.status) === 'Completed').length,
      total_customers: profiles.filter(p => p.role === 'customer').length,
      total_inventory_items: inventory.length,
      low_stock_items: inventory.filter(i => Number(i.stock_quantity || 0) > 0 && Number(i.stock_quantity) <= LOW_STOCK_THRESHOLD).length,
      out_of_stock_items: inventory.filter(i => Number(i.stock_quantity || 0) <= 0).length
    } });
  } catch (e) { console.error('analytics overview:', e.message); return fail(res, 500, 'Could not retrieve analytics overview.'); }
});
app.get('/api/analytics/revenue', ...admin, async (_req, res) => {
  try {
    const payments = await fetchAll('payments', 'amount,payment_status,created_at');
    const totals = new Map();
    for (const p of payments) if (p.payment_status === 'verified' && p.created_at) { const k = monthKey(p.created_at); totals.set(k, (totals.get(k) || 0) + Number(p.amount || 0)); }
    const data = [...totals.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => ({ month: monthLabel(k), month_key: k, revenue: Number(v.toFixed(2)) }));
    return res.json({ success: true, count: data.length, data });
  } catch (e) { console.error('analytics revenue:', e.message); return fail(res, 500, 'Could not retrieve revenue analytics.'); }
});
app.get('/api/analytics/services', ...admin, async (_req, res) => {
  try {
    const orders = await fetchAll('orders', 'service_type,order_details,status');
    const counts = new Map(); const sources = new Map();
    for (const o of orders) {
      counts.set(o.service_type, (counts.get(o.service_type) || 0) + 1);
      const source = o.order_details?.transaction_source || 'Unclassified';
      sources.set(source, (sources.get(source) || 0) + 1);
    }
    return res.json({ success: true, count: orders.length, data: [...counts].map(([service, total_orders]) => ({ service, total_orders })), transaction_sources: [...sources].map(([source, total]) => ({ source, total })) });
  } catch (e) { console.error('analytics services:', e.message); return fail(res, 500, 'Could not retrieve service analytics.'); }
});
app.get('/api/audit-logs', ...admin, async (req, res) => {
  const page = Number.parseInt(req.query.page || '1', 10); const limit = Number.parseInt(req.query.limit || '50', 10);
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) return fail(res, 400, 'page must be >= 1 and limit between 1 and 100.');
  try {
    const from = (page - 1) * limit;
    const { data, error, count } = await supabaseAdmin.from('audit_logs').select('*', { count: 'exact' }).order('created_at', { ascending: false }).range(from, from + limit - 1);
    if (error) throw error;
    const ids = [...new Set((data || []).map(x => x.user_id).filter(Boolean))];
    let people = {};
    if (ids.length) { const r = await supabaseAdmin.from('profiles').select('id,full_name,email').in('id', ids); if (!r.error) people = Object.fromEntries((r.data || []).map(p => [p.id, p])); }
    return res.json({ success: true, count: data.length, total: count || 0, page, limit, data: (data || []).map(row => ({ ...row, user: people[row.user_id] || null })) });
  } catch (e) { console.error('audit log list:', e.message); return fail(res, 500, 'Could not retrieve audit logs.'); }
});
module.exports = app;
