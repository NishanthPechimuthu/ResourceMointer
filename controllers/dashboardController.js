const SystemService = require('../services/systemService');

exports.renderDashboard = async (req, res) => {
    // Initial server render (could pass initial data here, but client-side fetching is cleaner for auto-updating)
    res.render('dashboard/index', { 
        title: 'NP Server Dashboard',
        user: req.user
    });
};

exports.getMetricsAPI = async (req, res) => {
    const metrics = await SystemService.getMetrics();
    if (!metrics) {
        return res.status(500).json({ error: 'Failed to retrieve metrics' });
    }
    res.json(metrics);
};

const DockerService = require('../services/dockerService');
const DbMonitorService = require('../services/dbMonitorService');
const SecurityService = require('../services/securityService');

exports.getDockerAPI = async (req, res) => {
    const containers = await DockerService.getContainers();
    if (containers === null) {
        return res.status(500).json({ error: 'Docker not available or inaccessible' });
    }
    res.json(containers);
};

exports.getDbAPI = async (req, res) => {
    const metrics = await DbMonitorService.getMetrics();
    if (!metrics) {
        return res.status(500).json({ error: 'Failed to retrieve DB metrics' });
    }
    res.json(metrics);
};

exports.getSecurityAPI = async (req, res) => {
    const data = await SecurityService.getSecurityMetrics();
    res.json(data);
};
