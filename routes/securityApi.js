const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const securityEngine = require('../engine/securityEngine');

// Middleware to protect API routes
function isAuthenticated(req, res, next) {
    if (req.isAuthenticated()) return next();
    res.status(401).json({ success: false, error: 'Unauthorized' });
}

// Apply auth middleware to all security routes
router.use(isAuthenticated);

// GET /api/security/attackers
router.get('/attackers', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM attackers ORDER BY total_score DESC LIMIT 100');
        res.json({ success: true, data: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/security/bans
router.get('/bans', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM bans ORDER BY created_at DESC LIMIT 100');
        res.json({ success: true, data: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/security/block
router.post('/block', async (req, res) => {
    const { ip, reason } = req.body;
    if (!ip) return res.status(400).json({ success: false, error: 'IP is required' });

    try {
        await pool.query(
            'INSERT INTO blacklist (ip, reason) VALUES ($1, $2) ON CONFLICT (ip) DO UPDATE SET reason = EXCLUDED.reason',
            [ip, reason || 'Manual block']
        );
        // Resync
        await securityEngine.syncBansFile();
        res.json({ success: true, message: `IP ${ip} blocked successfully` });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/security/unblock
router.post('/unblock', async (req, res) => {
    const { ip } = req.body;
    if (!ip) return res.status(400).json({ success: false, error: 'IP is required' });

    try {
        // Remove from both bans and blacklist
        await pool.query('DELETE FROM bans WHERE ip = $1', [ip]);
        await pool.query('DELETE FROM blacklist WHERE ip = $1', [ip]);
        // Also reset attacker score to prevent immediate re-ban if they are still active
        await pool.query('UPDATE attackers SET total_score = 0, offense_count = 0 WHERE ip = $1', [ip]);
        
        await securityEngine.syncBansFile();
        res.json({ success: true, message: `IP ${ip} unblocked successfully` });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/security/whitelist
router.get('/whitelist', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM whitelist ORDER BY created_at DESC');
        res.json({ success: true, data: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/security/whitelist
router.post('/whitelist', async (req, res) => {
    const { ip, description } = req.body;
    if (!ip) return res.status(400).json({ success: false, error: 'IP is required' });

    try {
        await pool.query(
            'INSERT INTO whitelist (ip, description) VALUES ($1, $2) ON CONFLICT (ip) DO UPDATE SET description = EXCLUDED.description',
            [ip, description || '']
        );
        
        // Remove from bans and blacklist if it exists
        await pool.query('DELETE FROM bans WHERE ip = $1', [ip]);
        await pool.query('DELETE FROM blacklist WHERE ip = $1', [ip]);
        await securityEngine.syncBansFile();

        res.json({ success: true, message: `IP ${ip} whitelisted successfully` });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// DELETE /api/security/whitelist
router.delete('/whitelist/:ip', async (req, res) => {
    const { ip } = req.params;
    try {
        await pool.query('DELETE FROM whitelist WHERE ip = $1', [ip]);
        res.json({ success: true, message: `IP ${ip} removed from whitelist` });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/security/stats (For Heatmaps, Most targeted URLs, etc.)
router.get('/stats', async (req, res) => {
    try {
        const recentAttacksResult = await pool.query('SELECT * FROM requests ORDER BY timestamp DESC LIMIT 50');
        const mostTargetedUrls = await pool.query('SELECT url, COUNT(*) as count FROM requests GROUP BY url ORDER BY count DESC LIMIT 10');
        const topUserAgents = await pool.query('SELECT user_agent, COUNT(*) as count FROM requests GROUP BY user_agent ORDER BY count DESC LIMIT 10');
        
        res.json({
            success: true,
            data: {
                recent_attacks: recentAttacksResult.rows,
                most_targeted_urls: mostTargetedUrls.rows,
                top_user_agents: topUserAgents.rows
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
