const express = require('express');
const router  = express.Router();
const { pool } = require('../config/db');
const securityEngine = require('../engine/securityEngine');

// ---------------------------------------------------------------------------
// Auth guard
// ---------------------------------------------------------------------------
function isAuthenticated(req, res, next) {
    if (req.isAuthenticated()) return next();
    res.status(401).json({ success: false, error: 'Unauthorized' });
}
router.use(isAuthenticated);

// ---------------------------------------------------------------------------
// GET /api/security/attackers
// Returns top 100 attackers with their live recent-score (last 1h)
// ---------------------------------------------------------------------------
router.get('/attackers', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                a.ip,
                a.total_score,
                a.offense_count,
                a.first_seen,
                a.last_seen,
                COALESCE(r.recent_score, 0) AS recent_score_1h,
                (b.ip IS NOT NULL) AS is_banned
            FROM attackers a
            LEFT JOIN (
                SELECT ip, SUM(score) AS recent_score
                FROM requests
                WHERE timestamp >= NOW() - INTERVAL '1 hour'
                GROUP BY ip
            ) r ON r.ip = a.ip
            LEFT JOIN bans b ON b.ip = a.ip AND (b.expires_at IS NULL OR b.expires_at > NOW())
            ORDER BY a.total_score DESC
            LIMIT 100
        `);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ---------------------------------------------------------------------------
// GET /api/security/bans
// Returns both auto-bans and manual blacklist entries
// ---------------------------------------------------------------------------
router.get('/bans', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, ip, reason, ban_type, expires_at, created_at
            FROM bans
            WHERE expires_at IS NULL OR expires_at > NOW()
            UNION ALL
            SELECT NULL AS id, ip, reason, 'permanent' AS ban_type, NULL AS expires_at, created_at
            FROM blacklist
            WHERE ip NOT IN (SELECT ip FROM bans WHERE expires_at IS NULL OR expires_at > NOW())
            ORDER BY created_at DESC
            LIMIT 200
        `);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ---------------------------------------------------------------------------
// POST /api/security/block
// Manually block an IP — inserts into blacklist AND bans table
// ---------------------------------------------------------------------------
router.post('/block', async (req, res) => {
    const { ip, reason } = req.body;
    if (!ip) return res.status(400).json({ success: false, error: 'IP is required' });

    // Basic IP validation (IPv4 + IPv6)
    const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$|^([0-9a-fA-F:]+)$/;
    if (!ipRegex.test(ip)) {
        return res.status(400).json({ success: false, error: 'Invalid IP address format' });
    }

    const blockReason = reason || 'Manual block via Dashboard';

    try {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Insert into blacklist (permanent manual block)
            await client.query(
                'INSERT INTO blacklist (ip, reason) VALUES ($1, $2) ON CONFLICT (ip) DO UPDATE SET reason = EXCLUDED.reason',
                [ip, blockReason]
            );

            // FIX: Insert into bans with ON CONFLICT to avoid duplicate-key crash
            // (bans.ip now has a UNIQUE constraint)
            await client.query(`
                INSERT INTO bans (ip, reason, ban_type, expires_at)
                VALUES ($1, $2, 'permanent', NULL)
                ON CONFLICT (ip) DO UPDATE
                    SET reason     = EXCLUDED.reason,
                        ban_type   = 'permanent',
                        expires_at = NULL
            `, [ip, blockReason]);

            await client.query('COMMIT');
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }

        // Resync nginx bans file
        await securityEngine.syncBansFile();
        res.json({ success: true, message: `IP ${ip} blocked successfully` });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ---------------------------------------------------------------------------
// POST /api/security/unblock
// ---------------------------------------------------------------------------
router.post('/unblock', async (req, res) => {
    const { ip } = req.body;
    if (!ip) return res.status(400).json({ success: false, error: 'IP is required' });

    try {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query('DELETE FROM bans      WHERE ip = $1', [ip]);
            await client.query('DELETE FROM blacklist  WHERE ip = $1', [ip]);
            // Reset attacker score to 0 so they don't get immediately re-banned
            await client.query('UPDATE attackers SET total_score = 0, offense_count = 0 WHERE ip = $1', [ip]);
            // Also purge their recent requests so score doesn't rebuild from history
            await client.query('DELETE FROM requests WHERE ip = $1 AND timestamp >= NOW() - INTERVAL \'1 hour\'', [ip]);
            await client.query('COMMIT');
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }

        await securityEngine.syncBansFile();
        res.json({ success: true, message: `IP ${ip} unblocked successfully` });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ---------------------------------------------------------------------------
// GET /api/security/whitelist
// ---------------------------------------------------------------------------
router.get('/whitelist', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM whitelist ORDER BY created_at DESC');
        res.json({ success: true, data: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ---------------------------------------------------------------------------
// POST /api/security/whitelist
// ---------------------------------------------------------------------------
router.post('/whitelist', async (req, res) => {
    const { ip, description } = req.body;
    if (!ip) return res.status(400).json({ success: false, error: 'IP is required' });

    try {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(
                'INSERT INTO whitelist (ip, description) VALUES ($1, $2) ON CONFLICT (ip) DO UPDATE SET description = EXCLUDED.description',
                [ip, description || '']
            );
            // Remove from bans and blacklist
            await client.query('DELETE FROM bans      WHERE ip = $1', [ip]);
            await client.query('DELETE FROM blacklist  WHERE ip = $1', [ip]);
            await client.query('COMMIT');
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }

        await securityEngine.syncBansFile();
        res.json({ success: true, message: `IP ${ip} whitelisted successfully` });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ---------------------------------------------------------------------------
// DELETE /api/security/whitelist/:ip
// ---------------------------------------------------------------------------
router.delete('/whitelist/:ip', async (req, res) => {
    const { ip } = req.params;
    try {
        const result = await pool.query('DELETE FROM whitelist WHERE ip = $1 RETURNING ip', [ip]);
        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, error: 'IP not found in whitelist' });
        }
        res.json({ success: true, message: `IP ${ip} removed from whitelist` });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ---------------------------------------------------------------------------
// GET /api/security/stats
// Returns recent attacks, most targeted URLs, top user agents
// ---------------------------------------------------------------------------
router.get('/stats', async (req, res) => {
    try {
        const [recentAttacksResult, mostTargetedUrls, topUserAgents, hourlyVolume] = await Promise.all([
            pool.query('SELECT * FROM requests ORDER BY timestamp DESC LIMIT 100'),
            pool.query('SELECT url, COUNT(*) AS count FROM requests GROUP BY url ORDER BY count DESC LIMIT 10'),
            pool.query('SELECT user_agent, COUNT(*) AS count FROM requests GROUP BY user_agent ORDER BY count DESC LIMIT 10'),
            pool.query(`
                SELECT
                    DATE_TRUNC('hour', timestamp) AS hour,
                    COUNT(*) AS request_count,
                    COUNT(DISTINCT ip) AS unique_ips
                FROM requests
                WHERE timestamp >= NOW() - INTERVAL '24 hours'
                GROUP BY hour
                ORDER BY hour ASC
            `)
        ]);

        res.json({
            success: true,
            data: {
                recent_attacks:     recentAttacksResult.rows,
                most_targeted_urls: mostTargetedUrls.rows,
                top_user_agents:    topUserAgents.rows,
                hourly_volume:      hourlyVolume.rows
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ---------------------------------------------------------------------------
// POST /api/security/ban-now
// Force-ban an IP from the attacker list immediately
// ---------------------------------------------------------------------------
router.post('/ban-now', async (req, res) => {
    const { ip, reason } = req.body;
    if (!ip) return res.status(400).json({ success: false, error: 'IP is required' });

    const banReason = reason || 'Manual force-ban from Dashboard';

    try {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            await client.query(`
                INSERT INTO bans (ip, reason, ban_type, expires_at)
                VALUES ($1, $2, 'permanent', NULL)
                ON CONFLICT (ip) DO UPDATE
                    SET reason = EXCLUDED.reason,
                        ban_type = 'permanent',
                        expires_at = NULL
            `, [ip, banReason]);

            await client.query(`
                INSERT INTO blacklist (ip, reason)
                VALUES ($1, $2)
                ON CONFLICT (ip) DO UPDATE SET reason = EXCLUDED.reason
            `, [ip, banReason]);

            await client.query('COMMIT');
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }

        await securityEngine.syncBansFile();
        res.json({ success: true, message: `IP ${ip} force-banned successfully` });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
