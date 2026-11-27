const express = require('express');
const router = express.Router();

const {
    getProfile,
    updateProfile,
    getStaff,
    createStaff,
    updateStaff,
    getCustomers,
    getUsers,
    getUserById,
    createUser,
    updateUserById,
    deleteUser
} = require('../controllers/userController');

const { authenticate, optionalAuthenticate, authorize } = require('../middleware/authMiddleware');
const { register } = require('../controllers/authController');

router.get('/me', authenticate, getProfile);
router.put('/me', authenticate, updateProfile);

router.get('/staff', authenticate, authorize('admin'), getStaff);
router.post('/staff', authenticate, authorize('admin'), createStaff);
router.put('/staff/:id', authenticate, authorize('admin'), updateStaff);
router.get('/customers', authenticate, authorize('staff', 'admin'), getCustomers);

// Documented REST resource: /api/users and /api/users/:id.
router.get('/', authenticate, authorize('staff', 'admin'), getUsers);
router.post('/', optionalAuthenticate, (req, res, next) => {
    // Public POST /api/users creates customer accounts only. An authenticated
    // administrator can invite a customer or staff account through this resource.
    if (!req.user) {
        if (req.body?.role && req.body.role !== 'customer') return res.status(403).json({ success: false, message: 'Public registration can only create customer accounts.' });
        return register(req, res, next);
    }
    if (req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Only administrators can create accounts from an authenticated session.' });
    return createUser(req, res, next);
});
router.get('/:id', authenticate, getUserById);
router.put('/:id', authenticate, updateUserById);
router.patch('/:id', authenticate, updateUserById);
router.delete('/:id', authenticate, authorize('admin'), deleteUser);


module.exports = router;
