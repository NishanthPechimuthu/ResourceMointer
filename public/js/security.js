async function fetchSecurityData() {
    try {
        // Fetch Bans
        const bansRes = await fetch('/api/security/bans');
        const bansData = await bansRes.json();
        if (bansData.success) {
            updateBansTable(bansData.data);
        }

        // Fetch Stats (Recent Attacks)
        const statsRes = await fetch('/api/security/stats');
        const statsData = await statsRes.json();
        if (statsData.success) {
            updateAttacksTable(statsData.data.recent_attacks);
        }
    } catch (err) {
        console.error('Failed to fetch security data', err);
    }
}

function updateBansTable(bans) {
    const tbody = document.getElementById('bans-table-body');
    if (!bans || bans.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 2rem; color: var(--text-secondary);">No active bans</td></tr>';
        return;
    }

    tbody.innerHTML = bans.map(ban => {
        let expires = ban.expires_at ? new Date(ban.expires_at).toLocaleString() : 'Permanent';
        let badgeColor = ban.ban_type === 'permanent' ? 'var(--error-color)' : 'var(--warning-color)';
        
        return `
            <tr>
                <td style="padding: 1rem; border-bottom: 1px solid var(--border-color); color: var(--text-primary); font-family: monospace;">${ban.ip}</td>
                <td style="padding: 1rem; border-bottom: 1px solid var(--border-color); color: var(--text-secondary);">${ban.reason || '-'}</td>
                <td style="padding: 1rem; border-bottom: 1px solid var(--border-color);">
                    <span style="background: ${badgeColor}; color: white; padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.8rem; font-weight: 600; text-transform: uppercase;">
                        ${ban.ban_type}
                    </span>
                </td>
                <td style="padding: 1rem; border-bottom: 1px solid var(--border-color); color: var(--text-secondary);">${expires}</td>
                <td style="padding: 1rem; border-bottom: 1px solid var(--border-color); text-align: right;">
                    <button class="btn-primary" style="padding: 0.4rem 0.8rem; font-size: 0.85rem; background: var(--bg-elevated); color: var(--text-primary); border: 1px solid var(--border-color);" onclick="unblockIp('${ban.ip}')">Unblock</button>
                </td>
            </tr>
        `;
    }).join('');
}

function updateAttacksTable(attacks) {
    const tbody = document.getElementById('attacks-table-body');
    if (!attacks || attacks.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 2rem; color: var(--text-secondary);">No recent attacks recorded</td></tr>';
        return;
    }

    tbody.innerHTML = attacks.map(attack => `
        <tr>
            <td style="padding: 1rem; border-bottom: 1px solid var(--border-color); color: var(--text-secondary); white-space: nowrap;">${new Date(attack.timestamp).toLocaleTimeString()}</td>
            <td style="padding: 1rem; border-bottom: 1px solid var(--border-color); color: var(--error-color); font-family: monospace;">${attack.ip}</td>
            <td style="padding: 1rem; border-bottom: 1px solid var(--border-color); color: var(--text-primary); word-break: break-all;">
                <span style="color: var(--accent-secondary); font-weight: 600; margin-right: 0.5rem;">${attack.method}</span>
                ${attack.url}
            </td>
            <td style="padding: 1rem; border-bottom: 1px solid var(--border-color); font-weight: 600; color: var(--error-color);">+${attack.score}</td>
        </tr>
    `).join('');
}

async function blockIp() {
    const ip = document.getElementById('block-ip').value.trim();
    if (!ip) return;

    try {
        const res = await fetch('/api/security/block', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ip, reason: 'Manual Block from Dashboard' })
        });
        const data = await res.json();
        if (data.success) {
            document.getElementById('block-ip').value = '';
            fetchSecurityData();
        } else {
            alert('Error blocking IP: ' + data.error);
        }
    } catch (err) {
        console.error(err);
    }
}

async function unblockIp(ip) {
    if (!confirm(`Are you sure you want to unblock ${ip}?`)) return;
    try {
        const res = await fetch('/api/security/unblock', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ip })
        });
        const data = await res.json();
        if (data.success) {
            fetchSecurityData();
        } else {
            alert('Error unblocking IP: ' + data.error);
        }
    } catch (err) {
        console.error(err);
    }
}

async function whitelistIp() {
    const ip = document.getElementById('whitelist-ip').value.trim();
    if (!ip) return;

    try {
        const res = await fetch('/api/security/whitelist', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ip, description: 'Added via Dashboard' })
        });
        const data = await res.json();
        if (data.success) {
            document.getElementById('whitelist-ip').value = '';
            fetchSecurityData();
        } else {
            alert('Error whitelisting IP: ' + data.error);
        }
    } catch (err) {
        console.error(err);
    }
}

// Initial fetch
fetchSecurityData();
// Poll every 10 seconds
setInterval(fetchSecurityData, 10000);
