const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');
const DbMonitorService = require('../services/dbMonitorService');

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

router.get('/api/system/metrics',   dashboardController.getMetricsAPI);
router.get('/api/docker/metrics',   dashboardController.getDockerAPI);
router.get('/api/db/metrics',       dashboardController.getDbAPI);
router.get('/api/security/metrics', dashboardController.getSecurityAPI);

// GET /dashboard/api/db/connections — list all pg_stat_activity connections
router.get('/api/db/connections', async (req, res) => {
    try {
        const connections = await DbMonitorService.getConnections();
        if (connections === null) {
            return res.status(500).json({ success: false, error: 'Failed to fetch connections' });
        }
        res.json({ success: true, data: connections });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /dashboard/api/db/connections/:pid/terminate — kill a backend by PID
router.post('/api/db/connections/:pid/terminate', async (req, res) => {
    const pid = parseInt(req.params.pid, 10);
    if (!pid || isNaN(pid) || pid <= 0) {
        return res.status(400).json({ success: false, error: 'Invalid PID' });
    }
    try {
        const result = await DbMonitorService.terminateConnection(pid);
        if (!result.terminated) {
            return res.status(404).json({ success: false, error: `PID ${pid} not found or could not be terminated` });
        }
        res.json({ success: true, message: `Connection PID ${pid} terminated successfully` });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
