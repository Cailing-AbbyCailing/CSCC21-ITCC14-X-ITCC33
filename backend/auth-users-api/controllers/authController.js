const { supabase, supabaseAdmin } = require('../supabase');
const { createUserClient } = require('../supabase');
const { writeAuditLog } = require('../../shared/audit');

function publicUser(profile) {
    return {
        id: profile.id,
        full_name: profile.full_name,
        email: profile.email,
        phone: profile.phone,
        default_address: profile.default_address,
        role: profile.role,
        is_active: profile.is_active !== false,
        created_at: profile.created_at
    };
}

exports.register = async (req, res) => {
    try {
        const { full_name, email, password, phone, default_address } = req.body;

        if (
            typeof full_name !== 'string' || !full_name.trim() ||
            typeof email !== 'string' || !email.trim() ||
            typeof password !== 'string' || password.length < 8
        ) {
            return res.status(400).json({
                success: false,
                message: 'Enter your name, a valid email, and a password with at least 8 characters.'
            });
        }

        const { data, error } = await supabase.auth.signUp({
            email: email.trim().toLowerCase(),
            password,
            options: {
                data: { full_name: full_name.trim() }
            }
        });

        if (error) {
            return res.status(400).json({
                success: false,
                message: error.message
            });
        }

        if (!data.user) {
            return res.status(400).json({
                success: false,
                message: 'Supabase did not return a user record.'
            });
        }

        // force public registration to create customer accounts only
        const profileValues = {
            id: data.user.id,
            full_name: full_name.trim(),
            email: email.trim().toLowerCase(),
            phone: typeof phone === 'string' && phone.trim() ? phone.trim() : null,
            default_address: typeof default_address === 'string' && default_address.trim()
                ? default_address.trim()
                : null,
            role: 'customer',
            is_active: true
        };

        // upsert also works when a database trigger already created the profile
        const { data: profile, error: profileError } = await supabaseAdmin
            .from('profiles')
            .upsert(profileValues, { onConflict: 'id' })
            .select('id, full_name, email, phone, default_address, role, is_active, created_at')
            .single();

        if (profileError) {
            console.error('profile creation error:', profileError.message);
            return res.status(500).json({
                success: false,
                message: 'The auth account was created, but its profile could not be saved. Contact the project administrator.',
                user_id: data.user.id
            });
        }

        await writeAuditLog(data.user.id, `Registered customer account ${data.user.id}`, 'authentication', 'Customer registration completed.');

        return res.status(201).json({
            success: true,
            message: data.session
                ? 'Account created successfully.'
                : 'Account created. Check your email to confirm the account before logging in.',
            user: publicUser(profile),
            access_token: data.session?.access_token || null,
            refresh_token: data.session?.refresh_token || null,
            email_confirmation_required: !data.session
        });
    } catch (error) {
        console.error('registration error:', error.message);
        return res.status(500).json({
            success: false,
            message: 'Registration failed.'
        });
    }
};

exports.login = async (req, res) => {
    try {
        const { email, password } = req.body;

        if (typeof email !== 'string' || !email.trim() || typeof password !== 'string' || !password) {
            return res.status(400).json({
                success: false,
                message: 'Email and password are required.'
            });
        }

        const { data, error } = await supabase.auth.signInWithPassword({
            email: email.trim().toLowerCase(),
            password
        });


        if (error || !data.user || !data.session) {
            return res.status(401).json({
                success: false,
                message: 'Invalid email or password, or the email has not been confirmed.'
            });
        }

        const userSupabase = createUserClient(data.session.access_token);
        const { data: profile, error: profileError } = await userSupabase
            .from('profiles')
            .select('id, full_name, email, phone, default_address, role, is_active, created_at')
            .eq('id', data.user.id)
            .single();

        if (profileError || !profile) {
            return res.status(403).json({
                success: false,
                message: 'Your account exists, but its profile is missing or unavailable.'
            });
        }

        if (profile.is_active === false) {
            await supabase.auth.signOut();
            return res.status(403).json({ success: false, message: 'This account has been deactivated. Contact an administrator.' });
        }

        await writeAuditLog(profile.id, 'Successful login', 'authentication', `Role: ${profile.role}`);

        return res.json({
            success: true,
            message: 'Login successful.',
            access_token: data.session.access_token,
            refresh_token: data.session.refresh_token,
            expires_at: data.session.expires_at,
            user: publicUser(profile)
        });
    } catch (error) {
        console.error('login error:', error.message);
        return res.status(500).json({
            success: false,
            message: 'Login failed.'
        });
    }
};

exports.logout = async (req, res) => {
    try {
        // revoke refresh sessions; already-issued access tokens can remain valid until expiry
        const { error } = await supabaseAdmin.auth.admin.signOut(req.token, 'global');

        if (error) {
            return res.status(400).json({
                success: false,
                message: error.message
            });
        }

        await writeAuditLog(req.user.id, 'Successful logout', 'authentication', 'Global refresh sessions revoked.');

        return res.json({
            success: true,
            message: 'Signed out. Clear the saved session in the frontend.'
        });
    } catch (error) {
        console.error('logout error:', error.message);
        return res.status(500).json({
            success: false,
            message: 'Logout failed.'
        });
    }
};

exports.getSession = async (req, res) => {
    return res.json({
        success: true,
        message: 'Session is valid.',
        user: publicUser(req.user)
    });
};

exports.refreshSession = async (req, res) => {
    try {
        const { refresh_token } = req.body;

        if (typeof refresh_token !== 'string' || !refresh_token) {
            return res.status(400).json({
                success: false,
                message: 'Refresh token is required.'
            });
        }

        const { data, error } = await supabase.auth.refreshSession({
            refresh_token
        });

        if (error || !data.session) {
            return res.status(401).json({
                success: false,
                message: 'Refresh token is invalid or expired.'
            });
        }

        return res.json({
            success: true,
            access_token: data.session.access_token,
            refresh_token: data.session.refresh_token,
            expires_at: data.session.expires_at
        });
    } catch (error) {
        console.error('session refresh error:', error.message);
        return res.status(500).json({
            success: false,
            message: 'Could not refresh the session.'
        });
    }
};
