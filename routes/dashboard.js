const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');

// Middleware to protect routes
function isAuthenticated(req, res, next) {
    if (req.isAuthenticated()) return next();
    res.status(401).redirect('/auth/login');
}

router.use(isAuthenticated);

router.get('/', dashboardController.renderDashboard);

router.get('/security', (req, res) => {
    res.render('dashboard/security', { user: req.user, title: 'Security Analytics' });
});

router.get('/api/system/metrics', dashboardController.getMetricsAPI);
router.get('/api/docker/metrics', dashboardController.getDockerAPI);
router.get('/api/db/metrics', dashboardController.getDbAPI);
router.get('/api/security/metrics', dashboardController.getSecurityAPI);

module.exports = router;
