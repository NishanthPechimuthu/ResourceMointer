const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

router.get('/login', authController.renderLogin);
router.post('/login', authController.loginSubmit);

router.get('/totp', authController.renderTotp);
router.post('/totp', authController.totpSubmit);

router.get('/logout', authController.logout);

module.exports = router;
