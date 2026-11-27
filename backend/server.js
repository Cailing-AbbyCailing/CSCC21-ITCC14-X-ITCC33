require('./shared/supabase'); // Loads the project-root .env and validates Supabase configuration.

const express = require('express');
const cors = require('cors');
const { supabaseAdmin } = require('./shared/supabase');
const { corsOptions } = require('./shared/serverConfig');

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' }));

app.get('/', (req, res) => res.json({
    success: true,
    service: 'acs-api',
    message: 'Alavanza Commercial Space API is running.',
    version: '1.0.0',
    modules: ['auth-users', 'services', 'orders', 'inventory-customers', 'analytics-audit']
}));

app.get('/health', async (req, res) => {
    try {
        const { error } = await supabaseAdmin.from('profiles').select('id').limit(1);
        if (error) throw error;
        return res.json({
            success: true,
            service: 'acs-api',
            status: 'healthy',
            database: 'connected',
            modules: {
                auth_users: '/health/auth-users',
                services: '/health/services',
                orders: '/health/orders',
                inventory: '/health/inventory',
                analytics: '/health/analytics',
            }
        });
    } catch (error) {
        console.error('Central health check failed:', error.message);
        return res.status(503).json({
            success: false,
            service: 'acs-api',
            status: 'degraded',
            database: 'unavailable'
        });
    }
});

// Each module keeps its existing /api routes and middleware.
// The module apps no longer listen on their own ports.
app.use(require('./auth-users-api/server'));
app.use(require('./services-pricing-api/server'));
app.use(require('./orders-fulfillment-api/server'));
app.use(require('./inventory-customer-api/server'));
app.use(require('./analytics-audit-api/server'));
// Chat is outside the MasterFile scope; no chat module or chat_messages table is used.

app.use((req, res) => res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`
}));

app.use((err, req, res, next) => {
    console.error('Central ACS API error:', err.message);
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        return res.status(400).json({ success: false, message: 'Request body contains invalid JSON.' });
    }
    return res.status(500).json({ success: false, message: 'An unexpected server error occurred.' });
});

if (require.main === module) {
    app.listen(PORT, () => console.log(`ACS API running at http://localhost:${PORT}`));
}

module.exports = app;
