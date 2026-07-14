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

    // Returns full connection list from pg_stat_activity
    static async getConnections() {
        try {
            const res = await db.query(`
                SELECT
                    pid,
                    usename                                                           AS username,
                    application_name,
                    client_addr::text                                                 AS client_addr,
                    datname                                                           AS database,
                    state,
                    ROUND(EXTRACT(epoch FROM (NOW() - state_change))::numeric, 1)    AS state_seconds,
                    ROUND(EXTRACT(epoch FROM (NOW() - query_start))::numeric,  1)    AS query_seconds,
                    LEFT(query, 120)                                                  AS query_snippet,
                    wait_event_type,
                    wait_event,
                    (pid = pg_backend_pid())                                          AS is_self
                FROM pg_stat_activity
                WHERE datname IS NOT NULL
                ORDER BY state, state_change ASC
            `);
            return res.rows;
        } catch (err) {
            console.error('Error fetching DB connections:', err);
            return null;
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
