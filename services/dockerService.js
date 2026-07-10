const si = require('systeminformation');

class DockerService {
    static async getContainers() {
        try {
            // true parameter fetches extended info like CPU and Mem
            const containers = await si.dockerContainers(true);
            return containers.map(container => ({
                id: container.id.substring(0, 12),
                name: container.name,
                image: container.image,
                state: container.state,
                cpu_percent: container.cpuPercent || 0,
                mem_percent: container.memPercent || 0,
                mem_usage: container.memUsage || 0,
                restarts: container.restartCount || 0
            }));
        } catch (err) {
            console.error('Error fetching docker containers:', err);
            return null; // Null indicates error or docker not available
        }
    }
}

module.exports = DockerService;
