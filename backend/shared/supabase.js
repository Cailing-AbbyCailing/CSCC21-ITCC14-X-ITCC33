const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const { createClient } = require('@supabase/supabase-js');
const { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY } = process.env;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
        'Missing Supabase environment variables. Set SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY in the project-root .env file.'
    );
}

function authOptions() {
    return { auth: { autoRefreshToken: false, persistSession: false } };
}

// Used for public sign-in/sign-up and public catalog reads.
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, authOptions());

// Server-only privileged client. Never expose this client or its key to the browser.
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, authOptions());

// A Supabase client carrying the signed-in user's JWT. RLS applies to these queries.
function createUserClient(token) {
    if (typeof token !== 'string' || !token.trim()) {
        throw new Error('A user access token is required to create a user-scoped Supabase client.');
    }
    return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        ...authOptions(),
        global: { headers: { Authorization: `Bearer ${token}` } }
    });
}

module.exports = { supabase, supabaseAdmin, createUserClient };
