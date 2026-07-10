const db = require('../config/db');

class DbMonitorService {
    static async getMetrics() {
        try {
            // Get version
            const versionRes = await db.query('SELECT version();');
            const versionStr = versionRes.rows[0].version;
            // Extract just the PostgreSQL x.y.z part
            const match = versionStr.match(/PostgreSQL ([\d\.]+)/);
            const version = match ? match[1] : 'Unknown';

            // Get DB Size
            const sizeRes = await db.query('SELECT pg_size_pretty(pg_database_size(current_database())) as size;');
            const size = sizeRes.rows[0].size;

            // Get Active Connections
            const connRes = await db.query(`
                SELECT count(*) as active_connections 
                FROM pg_stat_activity 
                WHERE state = 'active' OR state = 'idle';
            `);
            const connections = connRes.rows[0].active_connections;

            // Get Active Queries
            const queryRes = await db.query(`
                SELECT query, state, extract(epoch from (now() - query_start)) as duration 
                FROM pg_stat_activity 
                WHERE state = 'active' AND pid <> pg_backend_pid()
                LIMIT 5;
            `);
            const activeQueries = queryRes.rows;

            return {
                version,
                size,
                connections,
                activeQueries
            };
        } catch (err) {
            console.error('Error fetching DB metrics:', err);
            return null;
        }
    }
}

module.exports = DbMonitorService;
