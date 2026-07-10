const fs = require('fs');
const readline = require('readline');

class SecurityService {
    static async getSecurityMetrics() {
        const logPath = process.env.NGINX_LOG_PATH || '/var/log/nginx/access.log';
        
        let stats = {
            env_probes: 0,
            git_probes: 0,
            wp_probes: 0,
            pma_probes: 0,
            failed_requests: 0,
            top_ips: []
        };

        if (!fs.existsSync(logPath)) {
            return { error: 'Log file not found', stats };
        }

        try {
            const fileStream = fs.createReadStream(logPath);
            const rl = readline.createInterface({
                input: fileStream,
                crlfDelay: Infinity
            });

            const ipCounts = {};
            let linesParsed = 0;
            const MAX_LINES = 10000; // Only parse the last 10k lines for performance if reading from top, or just keep a sliding window. For simplicity, we process the stream. 
            // In a real production app for gigabyte logs, you'd want `tail` or a persistent log parser.
            // We will just read sequentially.

            for await (const line of rl) {
                // Basic Nginx combined log format parsing: IP - - [Date] "Method Route HTTP" STATUS SIZE
                const parts = line.split(' ');
                if (parts.length < 9) continue;

                const ip = parts[0];
                const requestRoute = parts[6] || '';
                const status = parseInt(parts[8], 10) || 200;

                // Track IPs
                ipCounts[ip] = (ipCounts[ip] || 0) + 1;

                // Check probes
                if (requestRoute.includes('.env')) stats.env_probes++;
                if (requestRoute.includes('.git')) stats.git_probes++;
                if (requestRoute.includes('wp-admin')) stats.wp_probes++;
                if (requestRoute.includes('phpmyadmin') || requestRoute.toLowerCase().includes('pma')) stats.pma_probes++;

                // Check failures
                if (status >= 400) {
                    stats.failed_requests++;
                }
            }

            // Calculate top IPs
            const sortedIps = Object.entries(ipCounts)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .map(entry => ({ ip: entry[0], count: entry[1] }));

            stats.top_ips = sortedIps;

            return { stats };
        } catch (err) {
            console.error('Error reading security log:', err);
            return { error: 'Error reading log file', stats };
        }
    }
}

module.exports = SecurityService;
