require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5500,http://127.0.0.1:5500')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);

const corsOptions = {
    origin(origin, callback) {
        // Postman/curl requests have no Origin header; browser origins must be allow-listed.
        if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
        return callback(new Error('Origin is not allowed by CORS.'));
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    optionsSuccessStatus: 204
};

module.exports = { corsOptions, allowedOrigins };
