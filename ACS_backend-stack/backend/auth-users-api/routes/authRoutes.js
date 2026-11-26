const express = require('express');
const router = express.Router();

const {
    register,
    login,
    logout,
    getSession,
    refreshSession
} = require('../controllers/authController');

const { authenticate } = require('../middleware/authMiddleware');

router.post('/register', register);
router.post('/login', login);
router.post('/logout', authenticate, logout);
router.get('/session', authenticate, getSession);
router.post('/refresh', refreshSession);

module.exports = router;
