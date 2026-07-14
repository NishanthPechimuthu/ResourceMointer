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
                if (errDiv) { errDiv.style.display = 'block'; errDiv.textContent = data.error; }
            }

            const stats = data.stats;
            setText('sec-failed', stats.failed_requests);
            setText('sec-probes', stats.env_probes + stats.git_probes + stats.wp_probes + stats.pma_probes);
        } catch (error) {
            console.error('Error fetching security metrics:', error);
        }
    };

    const fetchSpammingIps = async () => {
        const tbody = document.getElementById('spam-ips-body');
        if (!tbody) return;
        try {
            const res  = await fetch('/api/security/attackers');
            const data = await res.json();
            if (!data.success) throw new Error(data.error);

            const attackers = data.data.slice(0, 10); // show top 10

            if (attackers.length === 0) {
                tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:1.5rem;color:var(--text-secondary);">No attackers detected.</td></tr>';
                return;
            }

            tbody.innerHTML = attackers.map(a => {
                const score    = a.total_score;
                const scoreClr = score >= 100 ? 'var(--error-color)' : score >= 40 ? '#f97316' : 'var(--warning-color)';
                const diff     = Date.now() - new Date(a.last_seen).getTime();
                const min      = Math.floor(diff / 60000);
                const lastSeen = min < 60 ? `${min}m ago` : `${Math.floor(min/60)}h ago`;
                const statusBadge = a.is_banned
                    ? `<span style="background:var(--error-color);color:#fff;padding:0.15rem 0.45rem;border-radius:4px;font-size:0.72rem;font-weight:700;">BANNED</span>`
                    : score >= 40
                    ? `<span style="background:#f97316;color:#fff;padding:0.15rem 0.45rem;border-radius:4px;font-size:0.72rem;font-weight:700;">⚠ HIGH</span>`
                    : `<span style="background:rgba(34,197,94,0.2);color:#22c55e;padding:0.15rem 0.45rem;border-radius:4px;font-size:0.72rem;font-weight:700;">ACTIVE</span>`;
                const ip = String(a.ip).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
                const actionBtn = a.is_banned
                    ? `<button class="btn-primary dash-spam-action" data-action="unblock" data-ip="${ip}" style="padding:0.25rem 0.6rem;font-size:0.78rem;background:var(--bg-elevated);color:var(--text-primary);border:1px solid var(--border-color);">Unblock</button>`
                    : `<button class="btn-primary dash-spam-action" data-action="block" data-ip="${ip}" style="padding:0.25rem 0.6rem;font-size:0.78rem;background:var(--error-color);">Block</button>`;
                return `
                    <tr>
                        <td style="padding:0.5rem 0.75rem;border-bottom:1px solid var(--border-color);font-family:monospace;color:var(--text-primary);">${ip}</td>
                        <td style="padding:0.5rem 0.75rem;border-bottom:1px solid var(--border-color);font-weight:700;color:${scoreClr};">${score}</td>
                        <td style="padding:0.5rem 0.75rem;border-bottom:1px solid var(--border-color);color:var(--text-secondary);">${a.offense_count}</td>
                        <td style="padding:0.5rem 0.75rem;border-bottom:1px solid var(--border-color);color:var(--text-secondary);">${lastSeen}</td>
                        <td style="padding:0.5rem 0.75rem;border-bottom:1px solid var(--border-color);">${statusBadge}</td>
                        <td style="padding:0.5rem 0.75rem;border-bottom:1px solid var(--border-color);text-align:right;">${actionBtn}</td>
                    </tr>`;
            }).join('');
        } catch (err) {
            console.error('Error fetching attackers:', err);
            if (tbody) tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:1.5rem;color:var(--error-color);">Error loading data.</td></tr>';
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
    fetchSpammingIps();

    // Poll every 5 seconds for system metrics
    setInterval(() => {
        fetchMetrics();
        fetchDockerMetrics();
        fetchDbMetrics();
    }, 5000);

    // Poll security every 15 seconds
    setInterval(() => {
        fetchSecurityMetrics();
        fetchSpammingIps();
    }, 15000);

    // Event delegation for spam-IPs Block / Unblock buttons (CSP-safe — no onclick=)
    document.addEventListener('click', async (e) => {
        const btn = e.target.closest('.dash-spam-action');
        if (!btn) return;

        const action = btn.dataset.action;
        const ip     = btn.dataset.ip;
        if (!ip) return;

        btn.disabled    = true;
        btn.textContent = action === 'block' ? 'Blocking...' : 'Unblocking...';

        const statusEl = document.getElementById('spam-block-status');

        try {
            const endpoint = action === 'block' ? '/api/security/ban-now' : '/api/security/unblock';
            const res  = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ip, reason: 'Quick-block from Dashboard home' })
            });
            const data = await res.json();
            if (data.success) {
                if (statusEl) {
                    statusEl.style.display = 'inline';
                    statusEl.textContent   = `✅ ${ip} ${action === 'block' ? 'blocked' : 'unblocked'}!`;
                    setTimeout(() => { statusEl.style.display = 'none'; }, 3000);
                }
                fetchSpammingIps(); // refresh table
            } else {
                alert('Error: ' + data.error);
                btn.disabled    = false;
                btn.textContent = action === 'block' ? 'Block' : 'Unblock';
            }
        } catch (err) {
            alert('Network error: ' + err.message);
            btn.disabled    = false;
            btn.textContent = action === 'block' ? 'Block' : 'Unblock';
        }
    });

}); // end DOMContentLoaded
