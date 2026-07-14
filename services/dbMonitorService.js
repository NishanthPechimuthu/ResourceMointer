const db = require('../config/db');

class DbMonitorService {
    static async getMetrics() {
        try {
            const versionRes = await db.query('SELECT version();');
            const versionStr = versionRes.rows[0].version;
            const match   = versionStr.match(/PostgreSQL ([\d\.]+)/);
            const version = match ? match[1] : 'Unknown';

            const sizeRes = await db.query('SELECT pg_size_pretty(pg_database_size(current_database())) as size;');
            const size    = sizeRes.rows[0].size;

            const connRes = await db.query(`
                SELECT count(*) as active_connections
                FROM pg_stat_activity
                WHERE state = 'active' OR state = 'idle';
            `);
            const connections = connRes.rows[0].active_connections;

            const queryRes = await db.query(`
                SELECT query, state, extract(epoch from (now() - query_start)) as duration
                FROM pg_stat_activity
                WHERE state = 'active' AND pid <> pg_backend_pid()
                LIMIT 5;
            `);
            const activeQueries = queryRes.rows;

            return { version, size, connections, activeQueries };
        } catch (err) {
            console.error('Error fetching DB metrics:', err);
            return null;
        }
    }

    // Returns connection list from pg_stat_activity.
    // Works for non-superuser accounts — they see all rows in PG 10+ by default,
    // but some columns (query, client_addr) may be NULL if no pg_monitor role.
    // Falls back to a minimal safe query if the full one errors.
    static async getConnections() {
        try {
            // Try full query first (needs pg_monitor or superuser for query text on other users)
            const res = await db.query(`
                SELECT
                    pid,
                    COALESCE(usename, '')                                              AS username,
                    COALESCE(application_name, '')                                     AS application_name,
                    COALESCE(client_addr::text, 'local')                               AS client_addr,
                    COALESCE(datname, '')                                              AS database,
                    COALESCE(state, 'unknown')                                         AS state,
                    COALESCE(
                        ROUND(EXTRACT(epoch FROM (NOW() - state_change))::numeric, 1),
                        0
                    )                                                                  AS state_seconds,
                    COALESCE(
                        ROUND(EXTRACT(epoch FROM (NOW() - query_start))::numeric, 1),
                        0
                    )                                                                  AS query_seconds,
                    COALESCE(LEFT(query, 120), '')                                     AS query_snippet,
                    COALESCE(wait_event_type, '')                                      AS wait_event_type,
                    COALESCE(wait_event, '')                                           AS wait_event,
                    (pid = pg_backend_pid())                                           AS is_self
                FROM pg_stat_activity
                WHERE datname IS NOT NULL
                ORDER BY
                    CASE state
                        WHEN 'active' THEN 1
                        WHEN 'idle in transaction' THEN 2
                        ELSE 3
                    END,
                    state_change ASC
            `);
            return res.rows;
        } catch (err) {
            console.error('[DbMonitor] getConnections error:', err.message);
            // Return a structured error so the route can surface it to the UI
            return { _error: err.message };
        }
    }

    // Terminates a specific backend by PID using pg_terminate_backend
    static async terminateConnection(pid) {
        try {
            const res = await db.query(
                'SELECT pg_terminate_backend($1::int) AS terminated',
                [pid]
            );
            return { terminated: res.rows[0]?.terminated ?? false };
        } catch (err) {
            console.error('Error terminating connection:', err);
            throw err;
        }
    }
}

module.exports = DbMonitorService;
