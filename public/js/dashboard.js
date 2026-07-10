document.addEventListener('DOMContentLoaded', () => {
    
    const fetchMetrics = async () => {
        try {
            const response = await fetch('/dashboard/api/system/metrics');
            if (!response.ok) throw new Error('Network response was not ok');
            const data = await response.json();
            
            updateUI(data);
        } catch (error) {
            console.error('Error fetching metrics:', error);
        }
    };

    const updateUI = (data) => {
        // System Info
        setText('sys-os', data.system.os);
        setText('sys-kernel', data.system.kernel);
        setText('sys-uptime', formatUptime(data.system.uptime));
        setText('sys-hostname', data.system.hostname);
        setText('sys-public-ip', data.system.publicIp);
        setText('sys-private-ip', data.system.privateIp);

        // CPU
        setText('cpu-model', `${data.cpu.manufacturer} ${data.cpu.brand}`);
        setText('cpu-cores', `${data.cpu.cores} Cores`);
        setText('cpu-load', `${data.cpu.load.toFixed(2)}%`);

        // RAM
        const memTotalGB = (data.memory.total / 1024 / 1024 / 1024).toFixed(2);
        const memUsedGB = (data.memory.used / 1024 / 1024 / 1024).toFixed(2);
        setText('ram-usage', `${memUsedGB} / ${memTotalGB} GB`);
        
        const swapTotalGB = (data.memory.swapTotal / 1024 / 1024 / 1024).toFixed(2);
        const swapUsedGB = (data.memory.swapUsed / 1024 / 1024 / 1024).toFixed(2);
        setText('swap-usage', `${swapUsedGB} / ${swapTotalGB} GB`);

        // Network
        const rxMB = (data.network.rx_bytes / 1024 / 1024).toFixed(2);
        const txMB = (data.network.tx_bytes / 1024 / 1024).toFixed(2);
        setText('net-rx', `${rxMB} MB`);
        setText('net-tx', `${txMB} MB`);
    };

    const fetchDockerMetrics = async () => {
        try {
            const response = await fetch('/dashboard/api/docker/metrics');
            if (!response.ok) throw new Error('Network response was not ok');
            const containers = await response.json();
            
            updateDockerUI(containers);
        } catch (error) {
            console.error('Error fetching docker metrics:', error);
            const tbody = document.getElementById('docker-table-body');
            if (tbody) {
                tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 2rem; color: var(--error-color);">Error loading Docker data or Docker is not running.</td></tr>`;
            }
        }
    };

    const updateDockerUI = (containers) => {
        const tbody = document.getElementById('docker-table-body');
        if (!tbody) return;

        if (!containers || containers.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 2rem; color: var(--text-secondary);">No containers found.</td></tr>`;
            return;
        }

        let html = '';
        containers.forEach(c => {
            const isRunning = c.state === 'running';
            const statusClass = isRunning ? 'status-running' : (c.state === 'exited' || c.state === 'stopped' ? 'status-stopped' : 'status-unknown');
            const statusText = c.state.charAt(0).toUpperCase() + c.state.slice(1);
            
            const cpu = c.cpu_percent.toFixed(2);
            const memUsageMB = (c.mem_usage / 1024 / 1024).toFixed(2);
            const memPercent = c.mem_percent.toFixed(2);

            html += `
                <tr>
                    <td>
                        <span class="status-dot ${statusClass}"></span>
                        ${statusText}
                    </td>
                    <td style="font-weight: 500;">${c.name}</td>
                    <td>${cpu}%</td>
                    <td>${memUsageMB} MB (${memPercent}%)</td>
                    <td>${c.restarts}</td>
                </tr>
            `;
        });

        tbody.innerHTML = html;
    };

    const fetchDbMetrics = async () => {
        try {
            const response = await fetch('/dashboard/api/db/metrics');
            if (!response.ok) throw new Error('Network error');
            const dbData = await response.json();
            
            setText('db-version', dbData.version);
            setText('db-size', dbData.size);
            setText('db-connections', dbData.connections);
        } catch (error) {
            console.error('Error fetching DB metrics:', error);
            setText('db-version', 'Error');
        }
    };

    const fetchSecurityMetrics = async () => {
        try {
            const response = await fetch('/dashboard/api/security/metrics');
            if (!response.ok) throw new Error('Network error');
            const data = await response.json();

            if (data.error) {
                const errDiv = document.getElementById('sec-error-container');
                if (errDiv) {
                    errDiv.style.display = 'block';
                    errDiv.textContent = data.error;
                }
            }
            
            const stats = data.stats;
            setText('sec-failed', stats.failed_requests);
            setText('sec-probes', stats.env_probes + stats.git_probes + stats.wp_probes + stats.pma_probes);

            const ul = document.getElementById('sec-top-ips');
            if (ul) {
                if (stats.top_ips.length === 0) {
                    ul.innerHTML = '<li>No attacker IPs found</li>';
                } else {
                    ul.innerHTML = stats.top_ips.map(ip => `<li>${ip.ip} <span style="color:var(--error-color)">(${ip.count} hits)</span></li>`).join('');
                }
            }
        } catch (error) {
            console.error('Error fetching security metrics:', error);
        }
    };

    const setText = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    };

    const formatUptime = (seconds) => {
        const d = Math.floor(seconds / (3600*24));
        const h = Math.floor(seconds % (3600*24) / 3600);
        const m = Math.floor(seconds % 3600 / 60);
        return `${d}d ${h}h ${m}m`;
    };

    // Initial fetch
    fetchMetrics();
    fetchDockerMetrics();
    fetchDbMetrics();
    fetchSecurityMetrics();
    
    // Poll every 5 seconds
    setInterval(() => {
        fetchMetrics();
        fetchDockerMetrics();
        fetchDbMetrics();
        // Don't poll security as frequently to save file reads, or maybe every 15s.
        // For now, let's just do it every 10 seconds.
    }, 5000);

    setInterval(() => {
        fetchSecurityMetrics();
    }, 10000);
});
