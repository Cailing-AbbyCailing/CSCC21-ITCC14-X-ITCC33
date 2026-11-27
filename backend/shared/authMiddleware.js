const { supabase, createUserClient } = require('./supabase');

async function authenticate(req, res, next) {
    try {
        const header = req.get('authorization') || '';
        if (!header.startsWith('Bearer ')) {
            return res.status(401).json({ success: false, message: 'Authentication required. Send Authorization: Bearer <access_token>.' });
        }

        const token = header.slice(7).trim();
        if (!token) {
            return res.status(401).json({ success: false, message: 'Authentication token is missing.' });
        }

        // Ask Supabase Auth to verify the JWT. Never trust a role sent by the client.
        const { data: authData, error: authError } = await supabase.auth.getUser(token);
        if (authError || !authData?.user) {
            return res.status(401).json({ success: false, message: 'Invalid or expired access token.' });
        }

        const userSupabase = createUserClient(token);
        const { data: profile, error: profileError } = await userSupabase
            .from('profiles')
            .select('id, full_name, email, phone, default_address, role, is_active, created_at')
            .eq('id', authData.user.id)
            .single();

        if (profileError || !profile) {
            return res.status(403).json({ success: false, message: 'No accessible profile is linked to this account.' });
        }

        if (profile.is_active === false) {
            return res.status(403).json({ success: false, message: 'This account has been deactivated. Contact an administrator.' });
        }

        if (!['admin', 'staff', 'customer'].includes(profile.role)) {
            return res.status(403).json({ success: false, message: 'This account has no recognized application role.' });
        }

        req.user = profile;
        req.token = token;
        req.userSupabase = userSupabase;
        req.authUser = authData.user;
        return next();
    } catch (error) {
        console.error('authentication middleware error:', error.message);
        return res.status(500).json({ success: false, message: 'Could not verify the session.' });
    }
}

// Allows anonymous public catalog requests while still validating a token when supplied.
// If the browser sends a Bearer token, the normal authenticate() checks apply.
async function optionalAuthenticate(req, res, next) {
    const header = req.get('authorization') || '';
    if (!header) return next();
    return authenticate(req, res, next);
}

function authorize(...allowedRoles) {
    return (req, res, next) => {
        if (!req.user || !allowedRoles.includes(req.user.role)) {
            return res.status(403).json({ success: false, message: 'You do not have permission to perform this action.' });
        }
        return next();
    };
}

function allowRoles(...allowedRoles) {
    return [authenticate, authorize(...allowedRoles)];
}

module.exports = { authenticate, optionalAuthenticate, authorize, allowRoles };
