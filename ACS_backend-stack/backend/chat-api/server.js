require('../shared/supabase');
const express = require('express');
const cors = require('cors');
const { supabaseAdmin } = require('../shared/supabase');
const { respondWithDatabaseHealth } = require('../shared/health');
const { authenticate, authorize } = require('../shared/authMiddleware');
const { corsOptions } = require('../shared/serverConfig');
const { writeAuditLog } = require('../shared/audit');

const app = express();
const PORT = Number(process.env.CHAT_PORT || 3005);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isUuid = value => UUID_RE.test(String(value || ''));
const isManager = user => ['staff', 'admin'].includes(user?.role);

app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' }));
app.get('/', (req, res) => res.json({ success: true, service: 'chat-api', message: 'Alavanza Live Messaging API is running.' }));
app.get('/health', (req, res) => respondWithDatabaseHealth(res, supabaseAdmin, 'chat-api', ['chat_messages']));

function fail(res, status, message) { return res.status(status).json({ success: false, message }); }
async function audit(userId, action) {
    return writeAuditLog(userId, action, 'chat');
}

// Staff/admin conversation inbox. Customer accounts are intentionally not allowed here.
app.get('/api/conversations', authenticate, authorize('staff', 'admin'), async (req, res) => {
    try {
        const { data: messages, error } = await supabaseAdmin.from('chat_messages')
            .select('id,customer_id,sender_id,message,created_at')
            .eq('channel', 'support').not('customer_id', 'is', null)
            .order('created_at', { ascending: false }).limit(1000);
        if (error) throw error;
        const latest = new Map();
        for (const message of messages || []) if (!latest.has(message.customer_id)) latest.set(message.customer_id, message);
        const customerIds = [...latest.keys()];
        let profiles = {};
        if (customerIds.length) {
            const { data: people, error: profileError } = await supabaseAdmin.from('profiles')
                .select('id,full_name,email,phone').in('id', customerIds);
            if (profileError) throw profileError;
            profiles = Object.fromEntries((people || []).map(person => [person.id, person]));
        }
        const data = [...latest.entries()].map(([customer_id, message]) => ({
            customer_id,
            customer: profiles[customer_id] || { id: customer_id, full_name: 'Customer', email: '' },
            last_message: message.message,
            last_message_at: message.created_at,
            last_message_id: message.id
        })).sort((a, b) => new Date(b.last_message_at) - new Date(a.last_message_at));
        return res.json({ success: true, count: data.length, data });
    } catch (error) {
        console.error('chat conversations failed:', error.message);
        return fail(res, 500, 'Could not load chat conversations. Apply supabase/remaining_apis_schema.sql first.');
    }
});

app.get('/api/messages', authenticate, async (req, res) => {
    const channel = req.query.channel || 'support';
    if (!['support', 'internal'].includes(channel)) return fail(res, 400, 'channel must be support or internal.');
    if (channel === 'internal' && !isManager(req.user)) return fail(res, 403, 'Internal messaging is restricted to staff and admins.');
    let customerId = req.query.customer_id;
    if (channel === 'support') {
        if (isManager(req.user)) {
            if (!customerId || !isUuid(customerId)) return fail(res, 422, 'Staff must select a valid customer_id for support messages.');
        } else {
            customerId = req.user.id;
        }
    } else {
        customerId = null;
    }
    try {
        let query = supabaseAdmin.from('chat_messages').select('id,channel,customer_id,sender_id,sender_role,message,is_read,read_at,edited_at,updated_at,created_at')
            .eq('channel', channel).order('created_at', { ascending: true }).limit(300);
        if (customerId) query = query.eq('customer_id', customerId);
        const { data, error } = await query;
        if (error) throw error;
        const senderIds = [...new Set((data || []).map(message => message.sender_id))];
        let people = {};
        if (senderIds.length) {
            const { data: profiles, error: profileError } = await supabaseAdmin.from('profiles').select('id,full_name,email').in('id', senderIds);
            if (!profileError) people = Object.fromEntries((profiles || []).map(profile => [profile.id, profile]));
        }
        const result = (data || []).map(message => ({
            ...message,
            sender_name: people[message.sender_id]?.full_name || people[message.sender_id]?.email || 'User'
        }));
        return res.json({ success: true, count: result.length, data: result });
    } catch (error) {
        console.error('chat message list failed:', error.message);
        return fail(res, 500, 'Could not load messages.');
    }
});

app.post('/api/messages', authenticate, async (req, res) => {
    const body = req.body || {};
    const channel = body.channel || 'support';
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!['support', 'internal'].includes(channel)) return fail(res, 422, 'channel must be support or internal.');
    if (!message || message.length > 4000) return fail(res, 422, 'message must contain 1 to 4000 characters.');

    let customerId = null;
    if (channel === 'support') {
        if (isManager(req.user)) {
            if (!isUuid(body.customer_id)) return fail(res, 422, 'Staff must provide the customer_id for a support reply.');
            customerId = body.customer_id;
            const { data: customer, error } = await supabaseAdmin.from('profiles').select('id,role').eq('id', customerId).maybeSingle();
            if (error) return fail(res, 500, 'Could not validate the selected customer.');
            if (!customer || customer.role !== 'customer') return fail(res, 404, 'Customer conversation not found.');
        } else {
            customerId = req.user.id;
        }
    } else if (!isManager(req.user)) {
        return fail(res, 403, 'Internal messaging is restricted to staff and admins.');
    }

    try {
        const { data, error } = await supabaseAdmin.from('chat_messages').insert({
            channel,
            customer_id: customerId,
            sender_id: req.user.id,
            sender_role: req.user.role,
            message
        }).select('id,channel,customer_id,sender_id,sender_role,message,is_read,read_at,edited_at,updated_at,created_at').single();
        if (error) throw error;
        await audit(req.user.id, `Sent ${channel} chat message ${data.id}`);
        return res.status(201).json({ success: true, message: 'Message sent.', data: {
            ...data, sender_name: req.user.full_name || req.user.email || 'User'
        } });
    } catch (error) {
        console.error('chat send failed:', error.message);
        return fail(res, 500, 'Could not send the message.');
    }
});

// Individual message resource endpoints required by the API design.
app.get('/api/messages/:id', authenticate, async (req, res) => {
    if (!isUuid(req.params.id)) return fail(res, 400, 'Message id must be a valid UUID.');
    try {
        const { data, error } = await supabaseAdmin.from('chat_messages')
            .select('id,channel,customer_id,sender_id,sender_role,message,is_read,read_at,created_at,updated_at')
            .eq('id', req.params.id).maybeSingle();
        if (error) throw error;
        if (!data) return fail(res, 404, 'Message not found.');
        const canRead = data.channel === 'internal'
            ? isManager(req.user)
            : (isManager(req.user) || data.customer_id === req.user.id);
        if (!canRead) return fail(res, 404, 'Message not found.');
        return res.json({ success: true, data });
    } catch (error) {
        console.error('single message lookup failed:', error.message);
        return fail(res, 500, 'Could not retrieve the message.');
    }
});

async function updateMessage(req, res) {
    if (!isUuid(req.params.id)) return fail(res, 400, 'Message id must be a valid UUID.');
    const body = req.body || {};
    try {
        const { data: existing, error: lookupError } = await supabaseAdmin.from('chat_messages')
            .select('id,channel,customer_id,sender_id,sender_role,message,is_read')
            .eq('id', req.params.id).maybeSingle();
        if (lookupError) throw lookupError;
        if (!existing) return fail(res, 404, 'Message not found.');
        const updates = {};
        if (body.message !== undefined) {
            if (typeof body.message !== 'string' || !body.message.trim() || body.message.trim().length > 4000) {
                return fail(res, 422, 'message must contain 1 to 4000 characters.');
            }
            if (existing.sender_id !== req.user.id && req.user.role !== 'admin') return fail(res, 403, 'Only the message sender or an administrator can edit this message.');
            updates.message = body.message.trim();
            updates.edited_at = new Date().toISOString();
        }
        if (body.is_read !== undefined) {
            if (typeof body.is_read !== 'boolean') return fail(res, 422, 'is_read must be true or false.');
            const managerReadingSupport = isManager(req.user) && existing.channel === 'support';
            const customerReadingStaffReply = req.user.role === 'customer' && existing.channel === 'support' && existing.customer_id === req.user.id && existing.sender_id !== req.user.id;
            const managerReadingInternal = isManager(req.user) && existing.channel === 'internal';
            if (!managerReadingSupport && !customerReadingStaffReply && !managerReadingInternal) {
                return fail(res, 403, 'You cannot change the read status of this message.');
            }
            updates.is_read = body.is_read;
            updates.read_at = body.is_read ? new Date().toISOString() : null;
        }
        if (!Object.keys(updates).length) return fail(res, 400, 'Provide message and/or is_read to update.');
        updates.updated_at = new Date().toISOString();
        const { data, error } = await supabaseAdmin.from('chat_messages').update(updates).eq('id', req.params.id)
            .select('id,channel,customer_id,sender_id,sender_role,message,is_read,read_at,edited_at,created_at,updated_at').single();
        if (error) throw error;
        await audit(req.user.id, `Updated chat message ${data.id}`);
        return res.json({ success: true, message: 'Message updated.', data });
    } catch (error) {
        console.error('message update failed:', error.message);
        return fail(res, 500, 'Could not update the message. Confirm chat message columns are migrated.');
    }
}
app.put('/api/messages/:id', authenticate, updateMessage);
app.patch('/api/messages/:id', authenticate, updateMessage);

app.delete('/api/messages/:id', authenticate, async (req, res) => {
    if (!isUuid(req.params.id)) return fail(res, 400, 'Message id must be a valid UUID.');
    try {
        const { data: existing, error: lookupError } = await supabaseAdmin.from('chat_messages')
            .select('id,channel,customer_id,sender_id').eq('id', req.params.id).maybeSingle();
        if (lookupError) throw lookupError;
        if (!existing) return fail(res, 404, 'Message not found.');
        const canAccess = existing.channel === 'internal' ? isManager(req.user) : (isManager(req.user) || existing.customer_id === req.user.id);
        if (!canAccess) return fail(res, 404, 'Message not found.');
        if (existing.sender_id !== req.user.id && req.user.role !== 'admin') return fail(res, 403, 'Only the message sender or an administrator can delete this message.');
        const { error } = await supabaseAdmin.from('chat_messages').delete().eq('id', req.params.id);
        if (error) throw error;
        await audit(req.user.id, `Deleted chat message ${req.params.id}`);
        return res.json({ success: true, message: 'Message deleted.', id: req.params.id });
    } catch (error) {
        console.error('message deletion failed:', error.message);
        return fail(res, 500, 'Could not delete the message.');
    }
});

app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) return fail(res, 400, 'Request body contains invalid JSON.');
    if (err.message === 'Origin is not allowed by CORS.') return fail(res, 403, err.message);
    console.error('Chat API error:', err.message);
    return fail(res, 500, 'An unexpected server error occurred.');
});

app.listen(PORT, () => console.log(`Live Messaging API running at http://localhost:${PORT}`));
