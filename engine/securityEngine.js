const fs = require('fs');
const path = require('path');
const { Tail } = require('tail');
const { pool } = require('../config/db');
const { exec } = require('child_process');

// Attack Scoring Rules
const ATTACK_RULES = {
    // Files and Directories
    '.env': 10,
    '.git': 10,
    'wp-admin': 10,
    'wp-login.php': 10,
    'phpmyadmin': 10,
    'vendor': 10,
    'composer.json': 10,
    'composer.lock': 10,
    'xmlrpc.php': 10,
    
    // Path Traversal
    '../': 20,
    '..%2f': 20,
    '%2e%2e%2f': 20,

    // SQL Injection
    'UNION': 50,
    'SELECT': 50,
    'DROP TABLE': 50,
    '%27': 10, // Single quote
    
    // Command Injection
    '/bin/bash': 50,
    'cmd.exe': 50,
    'wget': 50,
    'curl': 50
};

// Regex to parse standard Nginx combined access log
// Example: 1.2.3.4 - - [10/Jul/2026:12:00:00 +0000] "GET /.env HTTP/1.1" 404 123 "-" "Mozilla/5.0"
const LOG_REGEX = /^(\S+) \S+ \S+ \[([^\]]+)\] "([A-Z]+) ([^"]+) HTTP\/[0-9.]+" \d+ \d+ "[^"]*" "([^"]*)"/;

class SecurityEngine {
    constructor() {
        this.accessLogPath = process.env.NGINX_ACCESS_LOG || path.join(__dirname, '..', 'access.log');
        this.bansFilePath = process.env.NGINX_BANS_FILE || path.join(__dirname, '..', 'nginx-bans.conf');
        this.tail = null;
    }

    start() {
        console.log('[SecurityEngine] Starting autonomous intrusion detection...');
        
        if (!fs.existsSync(this.accessLogPath)) {
            console.warn(`[SecurityEngine] WARNING: Log file not found at ${this.accessLogPath}. Engine will wait for it to be created.`);
            // Create empty file if it's meant to be in a local dev dir, otherwise wait
            if (!this.accessLogPath.startsWith('/var/log')) {
                fs.mkdirSync(path.dirname(this.accessLogPath), { recursive: true });
                fs.writeFileSync(this.accessLogPath, '');
            } else {
                return; // Cannot tail a non-existent root level log
            }
        }

        // Initialize empty bans file if not exists
        if (!fs.existsSync(this.bansFilePath)) {
            fs.writeFileSync(this.bansFilePath, '# NP Security Engine Auto-Generated Bans\n');
        }

        this.tail = new Tail(this.accessLogPath, { fromBeginning: false, follow: true });
        
        this.tail.on('line', (data) => {
            this.processLogLine(data);
        });

        this.tail.on('error', (error) => {
            console.error('[SecurityEngine] Tail error:', error);
        });
        
        // Ensure bans are enforced on startup
        this.syncBansFile();
    }

    async processLogLine(line) {
        const match = line.match(LOG_REGEX);
        if (!match) return;

        const ip = match[1];
        const method = match[3];
        const url = match[4];
        const userAgent = match[5];

        let score = 0;
        let triggers = [];

        const checkString = (url + ' ' + userAgent).toUpperCase();

        for (const [rule, points] of Object.entries(ATTACK_RULES)) {
            if (checkString.includes(rule.toUpperCase())) {
                score += points;
                triggers.push(rule);
            }
        }

        if (score > 0) {
            console.log(`[SecurityEngine] Attack detected from ${ip}. Score: ${score}. Triggers: ${triggers.join(', ')}`);
            await this.recordAttack(ip, method, url, userAgent, score);
        }
    }

    async recordAttack(ip, method, url, userAgent, score) {
        const client = await pool.connect();
        try {
            // Check whitelist
            const wlCheck = await client.query('SELECT ip FROM whitelist WHERE ip = $1', [ip]);
            if (wlCheck.rows.length > 0) return; // Ignore whitelisted IPs

            // Record request
            await client.query(
                'INSERT INTO requests (ip, method, url, user_agent, score) VALUES ($1, $2, $3, $4, $5)',
                [ip, method, url, userAgent, score]
            );

            // Upsert attacker
            await client.query(`
                INSERT INTO attackers (ip, total_score, offense_count, first_seen, last_seen)
                VALUES ($1, $2, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                ON CONFLICT (ip) DO UPDATE SET 
                    total_score = attackers.total_score + EXCLUDED.total_score,
                    last_seen = CURRENT_TIMESTAMP
            `, [ip, score]);

            // Evaluate Ban Policy (score > 40 within 1 hour)
            await this.evaluateBanPolicy(client, ip);

        } catch (err) {
            console.error('[SecurityEngine] Error recording attack:', err);
        } finally {
            client.release();
        }
    }

    async evaluateBanPolicy(client, ip) {
        // Calculate total score in the last hour
        const recentRequests = await client.query(`
            SELECT SUM(score) as recent_score 
            FROM requests 
            WHERE ip = $1 AND timestamp >= NOW() - INTERVAL '1 hour'
        `, [ip]);

        const recentScore = parseInt(recentRequests.rows[0].recent_score || 0);

        if (recentScore >= 40) {
            // Check if already banned and valid
            const banCheck = await client.query('SELECT id FROM bans WHERE ip = $1 AND (expires_at IS NULL OR expires_at > NOW())', [ip]);
            if (banCheck.rows.length > 0) return; // Already banned

            // Apply Ban
            const attacker = await client.query('SELECT offense_count FROM attackers WHERE ip = $1', [ip]);
            const offenses = (attacker.rows[0]?.offense_count || 0) + 1;

            let banDurationStr = '';
            let expiresAtQuery = '';
            
            if (offenses === 1) {
                banDurationStr = '24h';
                expiresAtQuery = "NOW() + INTERVAL '24 hours'";
            } else if (offenses === 2) {
                banDurationStr = '7d';
                expiresAtQuery = "NOW() + INTERVAL '7 days'";
            } else {
                banDurationStr = 'permanent';
                expiresAtQuery = "NULL"; // Permanent
            }

            console.log(`[SecurityEngine] Banning ${ip} for ${banDurationStr} (Offense #${offenses})`);

            await client.query(`
                INSERT INTO bans (ip, reason, ban_type, expires_at)
                VALUES ($1, $2, $3, ${expiresAtQuery})
            `, [ip, `Exceeded score threshold (Score: ${recentScore})`, banDurationStr]);

            await client.query('UPDATE attackers SET offense_count = $1 WHERE ip = $2', [offenses, ip]);

            // Update Nginx
            this.syncBansFile();
        }
    }

    async syncBansFile() {
        try {
            const res = await pool.query(`
                SELECT ip FROM bans WHERE expires_at IS NULL OR expires_at > NOW()
                UNION
                SELECT ip FROM blacklist
            `);
            
            let confContent = '# NP Security Engine Auto-Generated Bans\n';
            res.rows.forEach(row => {
                confContent += `deny ${row.ip};\n`;
            });

            fs.writeFileSync(this.bansFilePath, confContent);
            console.log(`[SecurityEngine] Synced ${res.rows.length} blocked IPs to Nginx config.`);
            
            // Reload Nginx to apply changes
            exec('sudo nginx -s reload', (error, stdout, stderr) => {
                if (error) {
                    console.error(`[SecurityEngine] Error reloading Nginx: ${error.message}`);
                    return;
                }
                if (stderr) {
                    console.error(`[SecurityEngine] Nginx reload stderr: ${stderr}`);
                    return;
                }
                console.log(`[SecurityEngine] Nginx reloaded successfully`);
            });
            
        } catch (err) {
            console.error('[SecurityEngine] Error syncing bans file:', err);
        }
    }
}

module.exports = new SecurityEngine();
