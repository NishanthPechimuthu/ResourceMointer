const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

router.get('/login', authController.renderLogin);
router.post('/login', authController.loginSubmit);
router.get('/logout', authController.logout);

module.exports = router;
