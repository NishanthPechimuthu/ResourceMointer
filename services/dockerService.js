const si = require('systeminformation');

class DockerService {
    static async getContainers() {
        try {
            const containers = await si.dockerContainers();
            
            // Fetch stats for running containers
            const detailedContainers = await Promise.all(containers.map(async (container) => {
                let cpuPercent = 0;
                let memPercent = 0;
                let memUsage = 0;

                if (container.state === 'running') {
                    try {
                        const stats = await si.dockerContainerStats(container.id);
                        if (stats && stats.length > 0) {
                            cpuPercent = stats[0].cpuPercent || 0;
                            memPercent = stats[0].memPercent || 0;
                            memUsage = stats[0].memUsage || 0;
                        }
                    } catch (statErr) {
                        // Ignore individual stat errors
                    }
                }

                return {
                    id: container.id.substring(0, 12),
                    name: container.name,
                    image: container.image,
                    state: container.state,
                    cpu_percent: cpuPercent,
                    mem_percent: memPercent,
                    mem_usage: memUsage,
                    restarts: container.restartCount || 0
                };
            }));

            return detailedContainers;
        } catch (err) {
            console.error('Error fetching docker containers:', err);
            return null; // Null indicates error or docker not available
        }
    }
}

module.exports = DockerService;
