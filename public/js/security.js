// =============================================================================
// NP Security Dashboard — Frontend Controller
// CSP-compliant: zero inline onclick= handlers, all via event delegation
// =============================================================================

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------
async function fetchSecurityData() {
    await Promise.allSettled([
        fetchBans(),
        fetchAttackers(),
        fetchStats()
    ]);
}

async function fetchBans() {
    try {
        const res  = await fetch('/api/security/bans');
        const data = await res.json();
        if (data.success) {
            updateBansTable(data.data);
            updateStat('stat-total-bans', data.data.length);
        }
    } catch (err) {
        console.error('[Security] fetchBans error:', err);
    }
}

async function fetchAttackers() {
    try {
        const res  = await fetch('/api/security/attackers');
        const data = await res.json();
        if (data.success) {
            updateAttackersTable(data.data);
            updateStat('stat-total-attackers', data.data.length);
            const autoBanned = data.data.filter(a => a.is_banned).length;
            updateStat('stat-auto-banned', autoBanned);
        }
    } catch (err) {
        console.error('[Security] fetchAttackers error:', err);
    }
}

async function fetchStats() {
    try {
        const res  = await fetch('/api/security/stats');
        const data = await res.json();
        if (data.success) {
            updateAttacksTable(data.data.recent_attacks);
            updateStat('stat-recent-attacks', data.data.recent_attacks.length);
        }
    } catch (err) {
        console.error('[Security] fetchStats error:', err);
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function updateStat(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

function scoreColor(score) {
    if (score >= 100) return 'var(--error-color)';
    if (score >= 40)  return '#f97316';
    if (score >= 10)  return 'var(--warning-color)';
    return 'var(--text-secondary)';
}

function threatBarColor(score) {
    if (score >= 100) return '#ef4444';
    if (score >= 40)  return '#f97316';
    if (score >= 10)  return '#eab308';
    return '#22c55e';
}

function formatRelative(dateStr) {
    if (!dateStr) return '—';
    const diff = Date.now() - new Date(dateStr).getTime();
    const sec  = Math.floor(diff / 1000);
    if (sec < 60)  return `${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60)  return `${min}m ago`;
    const hr  = Math.floor(min / 60);
    if (hr  < 24)  return `${hr}h ago`;
    return new Date(dateStr).toLocaleDateString();
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Table renderers — all buttons use data-* attributes, NO onclick=
// ---------------------------------------------------------------------------
function updateAttackersTable(attackers) {
    const tbody = document.getElementById('attackers-table-body');
    if (!attackers || attackers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--text-secondary);">No attackers recorded yet.</td></tr>';
        return;
    }

    const maxScore = Math.max(...attackers.map(a => a.total_score), 1);

    tbody.innerHTML = attackers.map(a => {
        const safeIp    = escapeHtml(a.ip);
        const barWidth  = Math.min(100, Math.round((a.total_score / maxScore) * 100));
        const color1h   = scoreColor(a.recent_score_1h);

        const statusBadge = a.is_banned
            ? `<span style="background:var(--error-color);color:#fff;padding:0.2rem 0.5rem;border-radius:4px;font-size:0.75rem;font-weight:600;">BANNED</span>`
            : a.recent_score_1h >= 40
            ? `<span style="background:#f97316;color:#fff;padding:0.2rem 0.5rem;border-radius:4px;font-size:0.75rem;font-weight:600;">⚠ NEAR LIMIT</span>`
            : `<span style="background:rgba(34,197,94,0.2);color:#22c55e;padding:0.2rem 0.5rem;border-radius:4px;font-size:0.75rem;font-weight:600;">ACTIVE</span>`;

        // Use data-action + data-ip — NO onclick=
        const banBtn = a.is_banned
            ? `<button class="btn-primary sec-action" data-action="unblock" data-ip="${safeIp}" style="padding:0.3rem 0.7rem;font-size:0.8rem;background:var(--bg-elevated);color:var(--text-primary);border:1px solid var(--border-color);">Unblock</button>`
            : `<button class="btn-primary sec-action" data-action="ban-now" data-ip="${safeIp}" style="padding:0.3rem 0.7rem;font-size:0.8rem;background:var(--error-color);">Ban Now</button>`;

        return `
            <tr>
                <td style="padding:0.75rem 1rem;border-bottom:1px solid var(--border-color);color:var(--text-primary);font-family:monospace;font-size:0.9rem;">${safeIp}</td>
                <td style="padding:0.75rem 1rem;border-bottom:1px solid var(--border-color);">
                    <span style="color:${scoreColor(a.total_score)};font-weight:700;">${a.total_score}</span>
                    <div class="threat-bar"><div class="threat-bar-fill" style="width:${barWidth}%;background:${threatBarColor(a.total_score)};"></div></div>
                </td>
                <td style="padding:0.75rem 1rem;border-bottom:1px solid var(--border-color);font-weight:600;color:${color1h};">${a.recent_score_1h}</td>
                <td style="padding:0.75rem 1rem;border-bottom:1px solid var(--border-color);color:var(--text-secondary);">${a.offense_count}</td>
                <td style="padding:0.75rem 1rem;border-bottom:1px solid var(--border-color);color:var(--text-secondary);font-size:0.85rem;">${formatRelative(a.last_seen)}</td>
                <td style="padding:0.75rem 1rem;border-bottom:1px solid var(--border-color);">${statusBadge}</td>
                <td style="padding:0.75rem 1rem;border-bottom:1px solid var(--border-color);text-align:right;">${banBtn}</td>
            </tr>
        `;
    }).join('');
}

function updateBansTable(bans) {
    const tbody = document.getElementById('bans-table-body');
    if (!bans || bans.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:2rem;color:var(--text-secondary);">No active bans</td></tr>';
        return;
    }

    tbody.innerHTML = bans.map(ban => {
        const safeIp     = escapeHtml(ban.ip);
        const expires    = ban.expires_at ? new Date(ban.expires_at).toLocaleString() : 'Permanent';
        const badgeColor = ban.ban_type === 'permanent' ? 'var(--error-color)' : 'var(--warning-color)';
        return `
            <tr>
                <td style="padding:0.75rem 1rem;border-bottom:1px solid var(--border-color);color:var(--text-primary);font-family:monospace;">${safeIp}</td>
                <td style="padding:0.75rem 1rem;border-bottom:1px solid var(--border-color);color:var(--text-secondary);max-width:300px;word-break:break-word;">${escapeHtml(ban.reason || '—')}</td>
                <td style="padding:0.75rem 1rem;border-bottom:1px solid var(--border-color);">
                    <span style="background:${badgeColor};color:#fff;padding:0.2rem 0.5rem;border-radius:4px;font-size:0.78rem;font-weight:600;text-transform:uppercase;">${escapeHtml(ban.ban_type)}</span>
                </td>
                <td style="padding:0.75rem 1rem;border-bottom:1px solid var(--border-color);color:var(--text-secondary);font-size:0.85rem;">${expires}</td>
                <td style="padding:0.75rem 1rem;border-bottom:1px solid var(--border-color);text-align:right;">
                    <button class="btn-primary sec-action" data-action="unblock" data-ip="${safeIp}" style="padding:0.3rem 0.7rem;font-size:0.8rem;background:var(--bg-elevated);color:var(--text-primary);border:1px solid var(--border-color);">Unblock</button>
                </td>
            </tr>
        `;
    }).join('');
}

function updateAttacksTable(attacks) {
    const tbody = document.getElementById('attacks-table-body');
    if (!attacks || attacks.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:2rem;color:var(--text-secondary);">No recent attacks recorded</td></tr>';
        return;
    }

    tbody.innerHTML = attacks.map(attack => `
        <tr>
            <td style="padding:0.75rem 1rem;border-bottom:1px solid var(--border-color);color:var(--text-secondary);white-space:nowrap;font-size:0.85rem;">${new Date(attack.timestamp).toLocaleTimeString()}</td>
            <td style="padding:0.75rem 1rem;border-bottom:1px solid var(--border-color);color:var(--error-color);font-family:monospace;">${escapeHtml(attack.ip)}</td>
            <td style="padding:0.75rem 1rem;border-bottom:1px solid var(--border-color);color:var(--text-primary);word-break:break-all;font-size:0.85rem;">
                <span style="color:var(--accent-secondary);font-weight:600;margin-right:0.4rem;">${escapeHtml(attack.method)}</span>${escapeHtml(attack.url)}
            </td>
            <td style="padding:0.75rem 1rem;border-bottom:1px solid var(--border-color);font-weight:700;color:${scoreColor(attack.score)};">+${attack.score}</td>
        </tr>
    `).join('');
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
function showStatus(msg, isError = false) {
    const el = document.getElementById('override-status');
    if (!el) return;
    el.style.display      = 'block';
    el.style.background   = isError ? 'rgba(239,68,68,0.15)' : 'rgba(34,197,94,0.15)';
    el.style.color        = isError ? '#ef4444' : '#22c55e';
    el.style.border       = `1px solid ${isError ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.3)'}`;
    el.style.borderRadius = '8px';
    el.style.padding      = '0.75rem';
    el.textContent        = msg;
    setTimeout(() => { el.style.display = 'none'; }, 4000);
}

async function blockIp() {
    const ip     = document.getElementById('block-ip').value.trim();
    const reason = document.getElementById('block-reason').value.trim();
    if (!ip) { showStatus('❌ Please enter an IP address.', true); return; }

    const btn = document.getElementById('btn-block-ip');
    btn.disabled    = true;
    btn.textContent = 'Blocking...';

    try {
        const res  = await fetch('/api/security/block', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ip, reason: reason || 'Manual block from Dashboard' })
        });
        const data = await res.json();
        if (data.success) {
            document.getElementById('block-ip').value     = '';
            document.getElementById('block-reason').value = '';
            showStatus(`✅ IP ${ip} blocked and nginx updated.`);
            fetchSecurityData();
        } else {
            showStatus(`❌ Error: ${data.error}`, true);
        }
    } catch (err) {
        showStatus(`❌ Network error: ${err.message}`, true);
    } finally {
        btn.disabled    = false;
        btn.textContent = 'Block';
    }
}

async function banNow(ip) {
    if (!confirm(`Force-ban ${ip} permanently? Nginx will be updated immediately.`)) return;

    try {
        const res  = await fetch('/api/security/ban-now', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ip, reason: 'Force-banned from Security Dashboard' })
        });
        const data = await res.json();
        if (data.success) {
            showStatus(`✅ IP ${ip} force-banned and nginx updated.`);
            fetchSecurityData();
        } else {
            showStatus(`❌ Error: ${data.error}`, true);
        }
    } catch (err) {
        showStatus(`❌ Network error: ${err.message}`, true);
    }
}

async function unblockIp(ip) {
    if (!confirm(`Unblock ${ip}? Their attack score will be reset to zero.`)) return;

    try {
        const res  = await fetch('/api/security/unblock', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ip })
        });
        const data = await res.json();
        if (data.success) {
            showStatus(`✅ IP ${ip} unblocked successfully.`);
            fetchSecurityData();
        } else {
            showStatus(`❌ Error: ${data.error}`, true);
        }
    } catch (err) {
        showStatus(`❌ Network error: ${err.message}`, true);
    }
}

async function whitelistIp() {
    const ip  = document.getElementById('whitelist-ip').value.trim();
    if (!ip) { showStatus('❌ Please enter an IP address.', true); return; }

    const btn = document.getElementById('btn-whitelist-ip');
    btn.disabled    = true;
    btn.textContent = 'Allowing...';

    try {
        const res  = await fetch('/api/security/whitelist', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ip, description: 'Added via Dashboard' })
        });
        const data = await res.json();
        if (data.success) {
            document.getElementById('whitelist-ip').value = '';
            showStatus(`✅ IP ${ip} whitelisted — will never be auto-banned.`);
            fetchSecurityData();
        } else {
            showStatus(`❌ Error: ${data.error}`, true);
        }
    } catch (err) {
        showStatus(`❌ Network error: ${err.message}`, true);
    } finally {
        btn.disabled    = false;
        btn.textContent = 'Allow';
    }
}

// ---------------------------------------------------------------------------
// Event delegation — handles ALL dynamic table buttons (no onclick= needed)
// A single listener on document catches clicks on any .sec-action button,
// reads data-action and data-ip, then dispatches the correct function.
// ---------------------------------------------------------------------------
document.addEventListener('click', function (e) {
    const btn = e.target.closest('.sec-action');
    if (!btn) return;

    const action = btn.dataset.action;
    const ip     = btn.dataset.ip;
    if (!ip) return;

    if (action === 'unblock')  unblockIp(ip);
    if (action === 'ban-now')  banNow(ip);
});

// Static button bindings (replaces onclick= on EJS buttons)
document.addEventListener('DOMContentLoaded', function () {
    const blockBtn     = document.getElementById('btn-block-ip');
    const whitelistBtn = document.getElementById('btn-whitelist-ip');

    if (blockBtn)     blockBtn.addEventListener('click', blockIp);
    if (whitelistBtn) whitelistBtn.addEventListener('click', whitelistIp);

    // Also allow pressing Enter in the IP input fields
    const blockIpInput = document.getElementById('block-ip');
    const wlIpInput    = document.getElementById('whitelist-ip');
    if (blockIpInput) blockIpInput.addEventListener('keydown', e => { if (e.key === 'Enter') blockIp(); });
    if (wlIpInput)    wlIpInput.addEventListener('keydown',    e => { if (e.key === 'Enter') whitelistIp(); });
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
fetchSecurityData();
setInterval(fetchSecurityData, 15000);
