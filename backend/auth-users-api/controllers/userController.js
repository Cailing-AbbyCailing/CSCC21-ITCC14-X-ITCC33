const { supabaseAdmin } = require('../supabase');
const { writeAuditLog } = require('../../shared/audit');

function publicUser(profile) {
    return { id: profile.id, full_name: profile.full_name, email: profile.email, phone: profile.phone, default_address: profile.default_address, role: profile.role, is_active: profile.is_active !== false, created_at: profile.created_at };
}

async function auditAction(userId, action) {
    return writeAuditLog(userId, action, 'user_management');
}

exports.getProfile = async (req, res) => {
    return res.json({
        success: true,
        user: req.user
    });
};

exports.updateProfile = async (req, res) => {
    try {
        const { full_name, phone, default_address } = req.body;
        const updates = {};

        if (full_name !== undefined) {
            if (typeof full_name !== 'string' || !full_name.trim()) {
                return res.status(400).json({
                    success: false,
                    message: 'Full name must be a non-empty string.'
                });
            }
            updates.full_name = full_name.trim();
        }

        if (phone !== undefined) {
            if (phone !== null && typeof phone !== 'string') {
                return res.status(400).json({
                    success: false,
                    message: 'Phone must be a string.'
                });
            }
            updates.phone = phone?.trim() || null;
        }

        if (default_address !== undefined) {
            if (default_address !== null && typeof default_address !== 'string') {
                return res.status(400).json({
                    success: false,
                    message: 'Default address must be a string.'
                });
            }
            updates.default_address = default_address?.trim() || null;
        }

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No profile fields were provided.'
            });
        }

        const { data, error } = await req.userSupabase
            .from('profiles')
            .update(updates)
            .eq('id', req.user.id)
            .select('id, full_name, email, phone, default_address, role, is_active, created_at')
            .single();

        if (error) {
            return res.status(400).json({
                success: false,
                message: error.message
            });
        }

        await auditAction(req.user.id, 'Updated own profile');

        return res.json({
            success: true,
            message: 'Profile updated successfully.',
            user: data
        });
    } catch (error) {
        console.error('profile update error:', error.message);
        return res.status(500).json({
            success: false,
            message: 'Profile update failed.'
        });
    }
};

exports.getStaff = async (req, res) => {
    try {
        const { data, error } = await supabaseAdmin
            .from('profiles')
            .select('id, full_name, email, phone, role, created_at')
            .eq('role', 'staff')
            .order('created_at', { ascending: false });

        if (error) {
            return res.status(500).json({
                success: false,
                message: error.message
            });
        }

        return res.json({
            success: true,
            count: data.length,
            data
        });
    } catch (error) {
        console.error('staff lookup error:', error.message);
        return res.status(500).json({
            success: false,
            message: 'Could not retrieve staff accounts.'
        });
    }
};

exports.createStaff = async (req, res) => {
    try {
        const { full_name, email, phone } = req.body;

        if (
            typeof full_name !== 'string' || !full_name.trim() ||
            typeof email !== 'string' || !email.trim()
        ) {
            return res.status(400).json({
                success: false,
                message: 'Staff name and email are required.'
            });
        }

        const inviteOptions = {};
        if (process.env.INVITE_REDIRECT_URL) {
            inviteOptions.redirectTo = process.env.INVITE_REDIRECT_URL;
        }
        inviteOptions.data = { full_name: full_name.trim() };

        const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(
            email.trim().toLowerCase(),
            inviteOptions
        );

        if (error || !data.user) {
            return res.status(400).json({
                success: false,
                message: error?.message || 'Could not create the staff invitation.'
            });
        }

        const { data: profile, error: profileError } = await supabaseAdmin
            .from('profiles')
            .upsert({
                id: data.user.id,
                full_name: full_name.trim(),
                email: email.trim().toLowerCase(),
                phone: typeof phone === 'string' && phone.trim() ? phone.trim() : null,
                role: 'staff',
                is_active: true
            }, { onConflict: 'id' })
            .select('id, full_name, email, phone, role, created_at')
            .single();

        if (profileError) {
            console.error('staff profile save error:', profileError.message);
            return res.status(500).json({
                success: false,
                message: 'The invitation was created, but the staff profile could not be saved.',
                user_id: data.user.id
            });
        }

        await auditAction(req.user.id, `Invited staff account ${profile.id}: ${profile.email}`);
        return res.status(201).json({
            success: true,
            message: 'Staff invitation sent successfully.',
            user: profile
        });
    } catch (error) {
        console.error('staff creation error:', error.message);
        return res.status(500).json({
            success: false,
            message: 'Staff creation failed.'
        });
    }
};

exports.updateStaff = async (req, res) => {
    try {
        const { id } = req.params;
        const { full_name, phone } = req.body;
        const updates = {};

        if (full_name !== undefined) {
            if (typeof full_name !== 'string' || !full_name.trim()) {
                return res.status(400).json({
                    success: false,
                    message: 'Full name must be a non-empty string.'
                });
            }
            updates.full_name = full_name.trim();
        }

        if (phone !== undefined) {
            if (phone !== null && typeof phone !== 'string') {
                return res.status(400).json({
                    success: false,
                    message: 'Phone must be a string.'
                });
            }
            updates.phone = phone?.trim() || null;
        }

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No staff fields were provided.'
            });
        }

        const { data, error } = await supabaseAdmin
            .from('profiles')
            .update(updates)
            .eq('id', id)
            .eq('role', 'staff')
            .select('id, full_name, email, phone, role, created_at')
            .maybeSingle();

        if (error) {
            return res.status(400).json({
                success: false,
                message: error.message
            });
        }

        if (!data) {
            return res.status(404).json({
                success: false,
                message: 'Staff account not found.'
            });
        }

        await auditAction(req.user.id, `Updated staff account ${data.id}`);
        return res.json({
            success: true,
            message: 'Staff account updated successfully.',
            user: data
        });
    } catch (error) {
        console.error('staff update error:', error.message);
        return res.status(500).json({
            success: false,
            message: 'Staff update failed.'
        });
    }
};


exports.getCustomers = async (req, res) => {
    try {
        const { data, error } = await supabaseAdmin
            .from('profiles')
            .select('id, full_name, email, phone, default_address, role, is_active, created_at')
            .eq('role', 'customer')
            .order('created_at', { ascending: false });

        if (error) throw error;
        const customerIds = (data || []).map(customer => customer.id);
        const counts = new Map(customerIds.map(id => [id, 0]));
        if (customerIds.length) {
            const { data: orders, error: ordersError } = await supabaseAdmin
                .from('orders').select('user_id').in('user_id', customerIds);
            if (ordersError) throw ordersError;
            for (const order of orders || []) {
                counts.set(order.user_id, (counts.get(order.user_id) || 0) + 1);
            }
        }
        const customers = (data || []).map(customer => ({ ...customer, order_count: counts.get(customer.id) || 0 }));
        return res.json({ success: true, count: customers.length, data: customers });
    } catch (error) {
        console.error('customer lookup error:', error.message);
        return res.status(500).json({ success: false, message: 'Could not retrieve customer accounts and order counts. Apply the remaining API schema migration.' });
    }
};


// General REST resource used by the documented GET /api/users and GET /api/users/:id routes.
// Staff can list customer records only; administrators can list every account.
exports.getUsers = async (req, res) => {
    try {
        const requestedRole = typeof req.query.role === 'string' ? req.query.role : null;
        if (requestedRole && !['customer', 'staff', 'admin'].includes(requestedRole)) {
            return res.status(400).json({ success: false, message: 'role must be customer, staff, or admin.' });
        }
        if (req.user.role !== 'admin' && requestedRole && requestedRole !== 'customer') {
            return res.status(403).json({ success: false, message: 'Staff can only list customer accounts.' });
        }
        let query = supabaseAdmin.from('profiles')
            .select('id,full_name,email,phone,default_address,role,is_active,created_at')
            .order('created_at', { ascending: false });
        if (req.user.role !== 'admin') query = query.eq('role', 'customer');
        else if (requestedRole) query = query.eq('role', requestedRole);
        if (req.query.active !== undefined) {
            if (!['true', 'false'].includes(req.query.active)) return res.status(400).json({ success: false, message: 'active must be true or false.' });
            query = query.eq('is_active', req.query.active === 'true');
        }
        const { data, error } = await query;
        if (error) throw error;
        return res.json({ success: true, count: data.length, data: data.map(publicUser) });
    } catch (error) {
        console.error('user list failed:', error.message);
        return res.status(500).json({ success: false, message: 'Could not retrieve user accounts.' });
    }
};

exports.getUserById = async (req, res) => {
    try {
        const { id } = req.params;
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
            return res.status(400).json({ success: false, message: 'User id must be a valid UUID.' });
        }
        const canView = req.user.id === id || req.user.role === 'admin' || req.user.role === 'staff';
        if (!canView) return res.status(403).json({ success: false, message: 'You cannot view this user profile.' });
        const { data, error } = await supabaseAdmin.from('profiles')
            .select('id,full_name,email,phone,default_address,role,is_active,created_at')
            .eq('id', id).maybeSingle();
        if (error) throw error;
        if (!data || (req.user.role === 'staff' && data.role !== 'customer' && data.id !== req.user.id)) {
            return res.status(404).json({ success: false, message: 'User account not found.' });
        }
        return res.json({ success: true, data: publicUser(data) });
    } catch (error) {
        console.error('user lookup failed:', error.message);
        return res.status(500).json({ success: false, message: 'Could not retrieve the user account.' });
    }
};

// Account creation through this management resource is invitation-based. Public customer
// registration remains POST /api/auth/register and never accepts a client-selected role.
exports.createUser = async (req, res) => {
    if (req.user?.role !== 'admin') return res.status(403).json({ success: false, message: 'Only administrators can invite customer or staff accounts.' });
    try {
        const { full_name, email, phone, default_address, role = 'customer' } = req.body || {};
        if (typeof full_name !== 'string' || !full_name.trim() || typeof email !== 'string' || !/^\S+@\S+\.\S+$/.test(email.trim())) {
            return res.status(422).json({ success: false, message: 'A valid full_name and email are required.' });
        }
        if (!['customer', 'staff'].includes(role)) return res.status(422).json({ success: false, message: 'role must be customer or staff. Admin roles cannot be assigned through this endpoint.' });
        const normalizedEmail = email.trim().toLowerCase();
        const inviteOptions = { data: { full_name: full_name.trim() } };
        if (process.env.INVITE_REDIRECT_URL) inviteOptions.redirectTo = process.env.INVITE_REDIRECT_URL;
        const { data: invited, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(normalizedEmail, inviteOptions);
        if (inviteError || !invited?.user) {
            return res.status(409).json({ success: false, message: inviteError?.message || 'Could not create the account invitation.' });
        }
        const profileValues = {
            id: invited.user.id, full_name: full_name.trim(), email: normalizedEmail,
            phone: typeof phone === 'string' && phone.trim() ? phone.trim() : null,
            default_address: typeof default_address === 'string' && default_address.trim() ? default_address.trim() : null,
            role, is_active: true
        };
        const { data, error } = await supabaseAdmin.from('profiles').upsert(profileValues, { onConflict: 'id' })
            .select('id,full_name,email,phone,default_address,role,is_active,created_at').single();
        if (error) throw error;
        await auditAction(req.user.id, `Invited ${role} account ${data.id}: ${data.email}`);
        return res.status(201).json({ success: true, message: `${role} invitation sent.`, data: publicUser(data) });
    } catch (error) {
        console.error('user creation failed:', error.message);
        return res.status(500).json({ success: false, message: 'Could not create the user account.' });
    }
};

exports.updateUserById = async (req, res) => {
    try {
        const { id } = req.params;
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
            return res.status(400).json({ success: false, message: 'User id must be a valid UUID.' });
        }
        if (req.user.id !== id && req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'You may only update your own profile.' });
        const body = req.body || {};
        const updates = {};
        if (body.full_name !== undefined) {
            if (typeof body.full_name !== 'string' || !body.full_name.trim()) return res.status(422).json({ success: false, message: 'full_name must be a non-empty string.' });
            updates.full_name = body.full_name.trim();
        }
        for (const field of ['phone', 'default_address']) {
            if (body[field] !== undefined) {
                if (body[field] !== null && typeof body[field] !== 'string') return res.status(422).json({ success: false, message: `${field} must be a string or null.` });
                updates[field] = typeof body[field] === 'string' ? body[field].trim() || null : null;
            }
        }
        if (body.is_active !== undefined) {
            if (req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Only administrators can activate or deactivate accounts.' });
            if (typeof body.is_active !== 'boolean') return res.status(422).json({ success: false, message: 'is_active must be true or false.' });
            updates.is_active = body.is_active;
        }
        if (Object.keys(updates).length === 0) return res.status(400).json({ success: false, message: 'No supported user fields were provided.' });
        const { data, error } = await supabaseAdmin.from('profiles').update(updates).eq('id', id)
            .select('id,full_name,email,phone,default_address,role,is_active,created_at').maybeSingle();
        if (error) throw error;
        if (!data) return res.status(404).json({ success: false, message: 'User account not found.' });
        await auditAction(req.user.id, `Updated user account ${data.id}`);
        return res.json({ success: true, message: 'User account updated.', data: publicUser(data) });
    } catch (error) {
        console.error('user update failed:', error.message);
        return res.status(500).json({ success: false, message: 'Could not update the user account.' });
    }
};

exports.deleteUser = async (req, res) => {
    try {
        const { id } = req.params;
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
            return res.status(400).json({ success: false, message: 'User id must be a valid UUID.' });
        }
        if (req.user.id === id) return res.status(409).json({ success: false, message: 'You cannot deactivate your own account.' });
        const { data, error } = await supabaseAdmin.from('profiles').update({ is_active: false }).eq('id', id)
            .select('id,full_name,email,role,is_active').maybeSingle();
        if (error) throw error;
        if (!data) return res.status(404).json({ success: false, message: 'User account not found.' });
        // Middleware also checks is_active, so existing access tokens stop authorizing requests.
        await auditAction(req.user.id, `Deactivated user account ${data.id}`);
        return res.json({ success: true, message: 'User account deactivated. Existing API sessions are no longer accepted.', data });
    } catch (error) {
        console.error('user deactivation failed:', error.message);
        return res.status(500).json({ success: false, message: 'Could not deactivate the user account.' });
    }
};
