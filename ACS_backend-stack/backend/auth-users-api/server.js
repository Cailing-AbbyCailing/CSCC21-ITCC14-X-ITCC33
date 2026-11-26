require('../shared/supabase'); // Load and validate the shared root .env before booting.
const { supabaseAdmin } = require('../shared/supabase');
const { respondWithDatabaseHealth } = require('../shared/health');
const express = require('express');
const cors = require('cors');
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const { corsOptions } = require('../shared/serverConfig');

const app = express();
const PORT = Number(process.env.AUTH_USERS_PORT || 3000);

app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' }));
app.get('/', (req, res) => res.json({ success: true, service: 'auth-users-api', message: 'Alavanza Auth & Users API is running.' }));
app.get('/health', (req, res) => respondWithDatabaseHealth(res, supabaseAdmin, 'auth-users-api', ['profiles']));
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);

app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        return res.status(400).json({ success: false, message: 'Request body contains invalid JSON.' });
    }
    if (err.message === 'Origin is not allowed by CORS.') return res.status(403).json({ success: false, message: err.message });
    console.error('Auth API error:', err.message);
    return res.status(500).json({ success: false, message: 'An unexpected server error occurred.' });
});

app.listen(PORT, () => console.log(`Auth & Users API running at http://localhost:${PORT}`));
