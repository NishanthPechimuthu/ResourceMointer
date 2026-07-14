const fs = require('fs');
const path = require('path');
const { Tail } = require('tail');
const { pool } = require('../config/db');
const { exec } = require('child_process');

// ---------------------------------------------------------------------------
// Attack Scoring Rules
// Each key is checked (case-insensitive) against the full URL + User-Agent.
// ---------------------------------------------------------------------------
const ATTACK_RULES = {
    // Sensitive file / directory probes
    '.env':            10,
    '.git':            10,
    'wp-admin':        10,
    'wp-login.php':    10,
    'phpmyadmin':      10,
    'pma':             10,
    'vendor':           8,
    'composer.json':   10,
    'composer.lock':   10,
    'xmlrpc.php':      10,
    'config.php':      10,
    'setup.php':       10,
    'install.php':     10,
    'shell.php':       30,
    'c99.php':         30,
    'r57.php':         30,

    // Path traversal
    '../':             20,
    '..%2f':           20,
    '%2e%2e%2f':       20,
    '..%252f':         20,

    // SQL Injection
    ' union ':         50,
    ' select ':        50,
    'drop table':      50,
    '%27':             10,   // encoded single quote
    "' or '1'='1":    80,
    '1=1':             20,
    'sleep(': 40,
    'benchmark(': 40,

    // Command / code injection
    '/bin/bash':       50,
    '/bin/sh':         50,
    'cmd.exe':         50,
    'powershell':      40,
    'wget ':           40,
    'curl ':           40,
    'base64_decode':   40,
    'eval(':           40,

    // Known scanner / exploit UA substrings
    'masscan':         30,
    'zgrab':           30,
    'nuclei':          30,
    'nikto':           30,
    'sqlmap':          60,
    'nmap':            30,
    'python-requests': 15,
    'go-http-client':  15,
    'libwww-perl':     20,
};

// ---------------------------------------------------------------------------
// Volume-based scoring
// If a single IP sends more than these thresholds within one minute,
// add extra score points (flood / DDoS detection).
// ---------------------------------------------------------------------------
const VOLUME_THRESHOLD_1MIN  = 60;   // > 60 req/min → +30 pts
const VOLUME_THRESHOLD_5MIN  = 200;  // > 200 req/5min → +60 pts extra
const VOLUME_SCORE_1MIN      = 30;
const VOLUME_SCORE_5MIN      = 60;

// ---------------------------------------------------------------------------
// Auto-ban thresholds
// ---------------------------------------------------------------------------
const BAN_SCORE_THRESHOLD    = 40;   // auto-ban when recent_score >= this
const BAN_WINDOW_MINUTES     = 60;   // look-back window for scoring

// Regex to parse standard Nginx combined access log
// Example: 1.2.3.4 - - [10/Jul/2026:12:00:00 +0000] "GET /.env HTTP/1.1" 404 123 "-" "Mozilla/5.0"
const LOG_REGEX = /^(\S+) \S+ \S+ \[([^\]]+)\] "([A-Z]+) ([^"]+) HTTP\/[0-9.]+" (\d+) \d+ "[^"]*" "([^"]*)"/;

class SecurityEngine {
    constructor() {
        this.accessLogPath = process.env.NGINX_ACCESS_LOG || path.join(__dirname, '..', 'access.log');
        this.bansFilePath  = process.env.NGINX_BANS_FILE  || path.join(__dirname, '..', 'nginx-bans.conf');
        this.tail = null;

        // In-memory short-term request counter: { ip -> [ timestamp, ... ] }
        // Kept as a rolling window to detect volume floods without DB queries.
        this._requestTimes = {};
        this._requestTimesCleanupInterval = null;
    }

    // -----------------------------------------------------------------------
    // Lifecycle
    // -----------------------------------------------------------------------
    start() {
        console.log('[SecurityEngine] Starting autonomous intrusion detection...');

        if (!fs.existsSync(this.accessLogPath)) {
            console.warn(`[SecurityEngine] WARNING: Log file not found at ${this.accessLogPath}.`);
            if (!this.accessLogPath.startsWith('/var/log')) {
                fs.mkdirSync(path.dirname(this.accessLogPath), { recursive: true });
                fs.writeFileSync(this.accessLogPath, '');
            } else {
                console.error('[SecurityEngine] Cannot tail non-existent system log. Aborting start.');
                return;
            }
        }

        // Ensure bans file exists
        if (!fs.existsSync(this.bansFilePath)) {
            fs.writeFileSync(this.bansFilePath, '# NP Security Engine Auto-Generated Bans\n');
        }

        // Tail the log file
        this.tail = new Tail(this.accessLogPath, { fromBeginning: false, follow: true, flushAtEOF: true });
        this.tail.on('line',  (data)  => this.processLogLine(data));
        this.tail.on('error', (error) => console.error('[SecurityEngine] Tail error:', error));

        // Clean up old in-memory counters every 5 minutes
        this._requestTimesCleanupInterval = setInterval(() => this._cleanupMemoryCounters(), 5 * 60 * 1000);

        // Enforce existing DB bans on startup
        this.syncBansFile();

        console.log('[SecurityEngine] Engine started and monitoring:', this.accessLogPath);
    }

    stop() {
        if (this.tail) this.tail.unwatch();
        if (this._requestTimesCleanupInterval) clearInterval(this._requestTimesCleanupInterval);
    }

    // -----------------------------------------------------------------------
    // Log processing
    // -----------------------------------------------------------------------
    async processLogLine(line) {
        const match = line.match(LOG_REGEX);
        if (!match) return;

        const ip        = match[1];
        const method    = match[3];
        const url       = match[4];
        const status    = parseInt(match[5], 10);
        const userAgent = match[6];

        // Track every request in memory for volume detection
        const now = Date.now();
        if (!this._requestTimes[ip]) this._requestTimes[ip] = [];
        this._requestTimes[ip].push(now);

        // Score based on attack patterns
        let score    = 0;
        let triggers = [];

        const checkStr = (url + ' ' + userAgent).toLowerCase();

        for (const [rule, points] of Object.entries(ATTACK_RULES)) {
            if (checkStr.includes(rule.toLowerCase())) {
                score += points;
                triggers.push(rule);
            }
        }

        // Score based on HTTP error status (repeated 4xx / 5xx scanning)
        if (status === 404) { score += 2; triggers.push('404'); }
        if (status === 403) { score += 3; triggers.push('403'); }
        if (status === 401) { score += 3; triggers.push('401'); }
        if (status === 500) { score += 5; triggers.push('500'); }

        // Volume scoring (in-memory, last 1 min / 5 min)
        const times1m = this._requestTimes[ip].filter(t => t >= now - 60_000);
        const times5m = this._requestTimes[ip].filter(t => t >= now - 300_000);

        if (times5m.length > VOLUME_THRESHOLD_5MIN) {
            score += VOLUME_SCORE_5MIN;
            triggers.push(`volume:${times5m.length}req/5min`);
        } else if (times1m.length > VOLUME_THRESHOLD_1MIN) {
            score += VOLUME_SCORE_1MIN;
            triggers.push(`volume:${times1m.length}req/1min`);
        }

        // Always record if there is any score (pattern OR volume)
        if (score > 0) {
            if (process.env.NODE_ENV !== 'production' || triggers.some(t => !t.startsWith('40') && !t.startsWith('50'))) {
                console.log(`[SecurityEngine] Hit from ${ip} | Score: +${score} | Triggers: ${triggers.join(', ')}`);
            }
            await this.recordAttack(ip, method, url, userAgent, score);
        }
    }

    // -----------------------------------------------------------------------
    // DB – record attack and evaluate ban
    // -----------------------------------------------------------------------
    async recordAttack(ip, method, url, userAgent, score) {
        const client = await pool.connect();
        try {
            // Check whitelist first — whitelisted IPs are always skipped
            const wlCheck = await client.query('SELECT 1 FROM whitelist WHERE ip = $1', [ip]);
            if (wlCheck.rowCount > 0) return;

            // FIX #1: Record the individual request
            await client.query(
                'INSERT INTO requests (ip, method, url, user_agent, score) VALUES ($1, $2, $3, $4, $5)',
                [ip, method, url, userAgent, score]
            );

            // FIX #2: Correctly upsert attacker — accumulate total_score AND increment offense_count
            // The old code used EXCLUDED.total_score (wrong) — it must use the literal score value $2.
            await client.query(`
                INSERT INTO attackers (ip, total_score, offense_count, first_seen, last_seen)
                VALUES ($1, $2, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                ON CONFLICT (ip) DO UPDATE SET
                    total_score   = attackers.total_score + $2,
                    last_seen     = CURRENT_TIMESTAMP
            `, [ip, score]);

            // Evaluate and potentially apply auto-ban
            await this.evaluateBanPolicy(client, ip);

        } catch (err) {
            console.error('[SecurityEngine] Error recording attack:', err.message);
        } finally {
            client.release();
        }
    }

    // -----------------------------------------------------------------------
    // Ban policy evaluation
    // -----------------------------------------------------------------------
    async evaluateBanPolicy(client, ip) {
        // FIX #3: Calculate cumulative score within the look-back window
        const recentResult = await client.query(`
            SELECT COALESCE(SUM(score), 0) AS recent_score
            FROM requests
            WHERE ip = $1 AND timestamp >= NOW() - INTERVAL '${BAN_WINDOW_MINUTES} minutes'
        `, [ip]);

        const recentScore = parseInt(recentResult.rows[0].recent_score, 10);

        if (recentScore < BAN_SCORE_THRESHOLD) return; // Below threshold — no action

        // FIX #4: Check for an active ban (non-expired)
        const banCheck = await client.query(
            'SELECT id FROM bans WHERE ip = $1 AND (expires_at IS NULL OR expires_at > NOW())',
            [ip]
        );
        if (banCheck.rowCount > 0) return; // Already actively banned

        // Determine offense count (how many times this IP has been banned before)
        const attackerResult = await client.query('SELECT offense_count FROM attackers WHERE ip = $1', [ip]);
        const prevOffenses   = attackerResult.rows[0]?.offense_count ?? 0;
        const newOffenses    = prevOffenses + 1;

        let banType;
        let expiresSQL;

        if (newOffenses === 1) {
            banType    = '24h';
            expiresSQL = "NOW() + INTERVAL '24 hours'";
        } else if (newOffenses === 2) {
            banType    = '7d';
            expiresSQL = "NOW() + INTERVAL '7 days'";
        } else {
            banType    = 'permanent';
            expiresSQL = 'NULL';
        }

        const banReason = `Auto-ban: score ${recentScore} in ${BAN_WINDOW_MINUTES}min (offense #${newOffenses})`;
        console.warn(`[SecurityEngine] 🚫 AUTO-BAN: ${ip} | ${banType} | ${banReason}`);

        // FIX #5: Insert ban with ON CONFLICT to prevent duplicate bans crashing the flow
        await client.query(`
            INSERT INTO bans (ip, reason, ban_type, expires_at)
            VALUES ($1, $2, $3, ${expiresSQL})
            ON CONFLICT DO NOTHING
        `, [ip, banReason, banType]);

        // Update offense counter on the attacker record
        await client.query(
            'UPDATE attackers SET offense_count = $1 WHERE ip = $2',
            [newOffenses, ip]
        );

        // Push the new ban to Nginx immediately
        // Use setImmediate so we don't block the current DB transaction
        setImmediate(() => this.syncBansFile());
    }

    // -----------------------------------------------------------------------
    // Nginx sync
    // FIX #6: Robust nginx sync — writes file, validates config, reloads
    // -----------------------------------------------------------------------
    async syncBansFile() {
        try {
            const res = await pool.query(`
                SELECT DISTINCT ip FROM (
                    SELECT ip FROM bans    WHERE expires_at IS NULL OR expires_at > NOW()
                    UNION ALL
                    SELECT ip FROM blacklist
                ) combined
                ORDER BY ip
            `);

            let confContent = '# NP Security Engine Auto-Generated Bans — DO NOT EDIT MANUALLY\n';
            confContent    += `# Last updated: ${new Date().toISOString()}\n`;
            confContent    += `# Total blocked IPs: ${res.rowCount}\n\n`;

            res.rows.forEach(row => {
                confContent += `deny ${row.ip};\n`;
            });

            fs.writeFileSync(this.bansFilePath, confContent, 'utf8');
            console.log(`[SecurityEngine] Synced ${res.rowCount} blocked IPs to ${this.bansFilePath}`);

            // Reload Nginx — first test config, then reload
            exec('sudo nginx -t', (testErr, _stdout, testStderr) => {
                if (testErr) {
                    console.error('[SecurityEngine] Nginx config test FAILED — not reloading:', testStderr);
                    return;
                }
                exec('sudo nginx -s reload', (reloadErr, _out, reloadStderr) => {
                    if (reloadErr) {
                        console.error('[SecurityEngine] Nginx reload error:', reloadErr.message);
                        return;
                    }
                    if (reloadStderr && /\[(?:error|emerg|crit)\]/.test(reloadStderr)) {
                        console.error('[SecurityEngine] Nginx reload stderr:', reloadStderr);
                        return;
                    }
                    console.log(`[SecurityEngine] ✅ Nginx reloaded — ${res.rowCount} IPs blocked`);
                });
            });

        } catch (err) {
            console.error('[SecurityEngine] Error syncing bans file:', err.message);
        }
    }

    // -----------------------------------------------------------------------
    // Memory maintenance
    // -----------------------------------------------------------------------
    _cleanupMemoryCounters() {
        const cutoff = Date.now() - 10 * 60 * 1000; // keep last 10 min only
        let cleaned = 0;
        for (const ip of Object.keys(this._requestTimes)) {
            this._requestTimes[ip] = this._requestTimes[ip].filter(t => t >= cutoff);
            if (this._requestTimes[ip].length === 0) {
                delete this._requestTimes[ip];
                cleaned++;
            }
        }
        if (cleaned > 0) {
            console.log(`[SecurityEngine] Cleaned ${cleaned} idle IP counters from memory.`);
        }
    }
}

module.exports = new SecurityEngine();
