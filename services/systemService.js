const si = require('systeminformation');
const axios = require('axios');

class SystemService {
    static async getMetrics() {
        try {
            const [
                cpu,
                cpuLoad,
                mem,
                osInfo,
                diskLayout,
                fsSize,
                networkInterfaces,
                networkStats,
                time
            ] = await Promise.all([
                si.cpu(),
                si.currentLoad(),
                si.mem(),
                si.osInfo(),
                si.diskLayout(),
                si.fsSize(),
                si.networkInterfaces(),
                si.networkStats()
            ]);

            // Try to get Public IP (timeout of 2s to not block UI if offline)
            let publicIp = 'Unknown';
            try {
                const ipRes = await axios.get('https://api.ipify.org?format=json', { timeout: 2000 });
                if (ipRes.data && ipRes.data.ip) {
                    publicIp = ipRes.data.ip;
                }
            } catch (err) {
                // Ignore failure
            }

            // Get default interface private IP
            const defaultInterface = networkInterfaces.find(iface => iface.default) || networkInterfaces[0];
            const privateIp = defaultInterface ? defaultInterface.ip4 : 'Unknown';

            // Calculate network traffic (sum of all interfaces)
            let rx_bytes = 0;
            let tx_bytes = 0;
            networkStats.forEach(stat => {
                rx_bytes += stat.rx_bytes;
                tx_bytes += stat.tx_bytes;
            });

            return {
                system: {
                    hostname: osInfo.hostname,
                    os: `${osInfo.distro} ${osInfo.release}`,
                    kernel: osInfo.kernel,
                    uptime: si.time().uptime,
                    publicIp: publicIp,
                    privateIp: privateIp
                },
                cpu: {
                    manufacturer: cpu.manufacturer,
                    brand: cpu.brand,
                    cores: cpu.cores,
                    load: cpuLoad.currentLoad
                },
                memory: {
                    total: mem.total,
                    used: mem.active,
                    free: mem.free,
                    swapTotal: mem.swaptotal,
                    swapUsed: mem.swapused
                },
                disk: {
                    // Summarize main drive for now
                    layout: diskLayout,
                    filesystems: fsSize
                },
                network: {
                    rx_bytes,
                    tx_bytes
                }
            };

        } catch (err) {
            console.error('Error fetching system metrics:', err);
            return null;
        }
    }
}

module.exports = SystemService;
