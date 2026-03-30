/**
 * Data Usage Tracker – app.js
 *
 * Tracks in-browser data usage using:
 *  - Performance Resource Timing API (sizes of loaded resources)
 *  - Network Information API (connection type / speed)
 *  - localStorage (session history persistence)
 */

(function () {
  'use strict';

  /* =====================================================================
     Constants & helpers
     ===================================================================== */

  const HISTORY_KEY = 'dut_history';
  const LIMIT_KEY   = 'dut_limit';   // stored as bytes
  const MAX_HISTORY = 20;
  const REFRESH_MS  = 2000;

  /** Convert bytes to a human-readable string */
  function formatBytes(bytes) {
    if (bytes === 0 || bytes == null) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const val = bytes / Math.pow(1024, i);
    return `${val.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
  }

  /** Convert bytes per second to a human-readable string */
  function formatRate(bps) {
    return formatBytes(bps) + '/s';
  }

  /** Pad number with leading zero */
  function pad(n) { return String(n).padStart(2, '0'); }

  /** Format elapsed seconds as HH:MM:SS */
  function formatDuration(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
  }

  /** Color per resource type */
  const TYPE_COLORS = {
    script:     '#4f8ef7',
    css:        '#a78bfa',
    img:        '#34d399',
    fetch:      '#fb923c',
    xmlhttprequest: '#fb923c',
    font:       '#f472b6',
    document:   '#fbbf24',
    media:      '#22d3ee',
    other:      '#8b92b8',
  };

  function typeColor(type) {
    return TYPE_COLORS[type] || TYPE_COLORS.other;
  }

  function typePillHtml(type) {
    const color = typeColor(type);
    return `<span class="type-pill" style="background:${color}22;color:${color}">${type}</span>`;
  }

  /* =====================================================================
     State
     ===================================================================== */

  const sessionStart = Date.now();
  let limitBytes = null;

  /* =====================================================================
     DOM references
     ===================================================================== */

  const $ = id => document.getElementById(id);

  const elTotal         = $('stat-total');
  const elTotalReqs     = $('stat-total-requests');
  const elDuration      = $('stat-duration');
  const elStart         = $('stat-start');
  const elNetType       = $('stat-network-type');
  const elNetSpeed      = $('stat-network-speed');
  const elRate          = $('stat-rate');
  const elBanner        = $('network-banner');
  const elBreakdown     = $('breakdown-grid');
  const elBadgeRes      = $('badge-resources');
  const elBadgeTop      = $('badge-top');
  const elTbody         = $('resources-tbody');
  const elEmptyRow      = $('empty-row');
  const elHistoryList   = $('history-list');
  const elLimitStatus   = $('limit-status');
  const elLimitBar      = $('limit-bar');
  const elLimitText     = $('limit-text');
  const elChartCanvas   = $('chart-canvas');
  const elChartEmpty    = $('chart-empty');

  /* =====================================================================
     Network Information API
     ===================================================================== */

  function updateNetworkInfo() {
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (conn) {
      const type = conn.effectiveType || conn.type || 'unknown';
      elNetType.textContent = type.toUpperCase();
      const downlink = conn.downlink;
      elNetSpeed.textContent = downlink != null ? `${downlink} Mbps downlink` : '–';
    } else {
      elNetType.textContent = 'Unknown';
      elNetSpeed.textContent = 'API not supported';
    }
  }

  /* =====================================================================
     Online / offline banner
     ===================================================================== */

  function showBanner(online) {
    elBanner.classList.remove('hidden', 'online', 'offline');
    if (online) {
      elBanner.classList.add('online');
      elBanner.textContent = '✓ Back online';
      setTimeout(() => elBanner.classList.add('hidden'), 3000);
    } else {
      elBanner.classList.add('offline');
      elBanner.textContent = '⚠ You are offline. Data shown is from before disconnection.';
    }
  }

  window.addEventListener('online',  () => showBanner(true));
  window.addEventListener('offline', () => showBanner(false));

  if (!navigator.onLine) showBanner(false);

  /* =====================================================================
     Performance API – resource scanning
     ===================================================================== */

  /**
   * Normalise a PerformanceResourceTiming entry into a plain object.
   * transferSize is the over-the-wire size (0 for cached); fall back to
   * encodedBodySize (compressed) then decodedBodySize.
   */
  function normaliseEntry(entry) {
    const size =
      (entry.transferSize  > 0 ? entry.transferSize  : null) ??
      (entry.encodedBodySize > 0 ? entry.encodedBodySize : null) ??
      entry.decodedBodySize ?? 0;

    // Derive a friendly initiator type
    let type = (entry.initiatorType || 'other').toLowerCase();
    if (type === 'xmlhttprequest') type = 'fetch';
    if (type === 'css')            type = 'css';

    const duration = entry.responseEnd - entry.startTime;

    // Strip query strings for display
    let name = entry.name;
    try {
      const url = new URL(name);
      name = url.pathname.split('/').pop() || url.hostname;
      if (!name) name = url.hostname;
    } catch (_) {
      name = name.split('/').pop() || name;
    }

    return {
      fullUrl:  entry.name,
      name,
      type,
      size,
      duration: Math.round(duration),
      protocol: entry.nextHopProtocol || '–',
    };
  }

  /** Aggregate all performance resource entries */
  function getResourceData() {
    const raw = performance.getEntriesByType('resource');
    return raw.map(normaliseEntry);
  }

  /* =====================================================================
     Render helpers
     ===================================================================== */

  /** Aggregate by type */
  function aggregateByType(entries) {
    const map = {};
    for (const e of entries) {
      if (!map[e.type]) map[e.type] = { size: 0, count: 0 };
      map[e.type].size  += e.size;
      map[e.type].count += 1;
    }
    return map;
  }

  function renderBreakdown(byType) {
    const types = Object.keys(byType).sort((a, b) => byType[b].size - byType[a].size);
    if (types.length === 0) {
      elBreakdown.innerHTML = '<p class="empty-cell">No resources yet.</p>';
      return;
    }
    elBreakdown.innerHTML = types.map(t => `
      <div class="breakdown-card" style="border-left: 3px solid ${typeColor(t)}">
        <div class="type-label">${t}</div>
        <div class="type-size">${formatBytes(byType[t].size)}</div>
        <div class="type-count">${byType[t].count} resource${byType[t].count !== 1 ? 's' : ''}</div>
      </div>
    `).join('');
  }

  function renderTable(entries) {
    // top 50 by size
    const top = [...entries].sort((a, b) => b.size - a.size).slice(0, 50);
    elBadgeTop.textContent = top.length;

    if (top.length === 0) {
      elTbody.innerHTML = '<tr id="empty-row"><td colspan="5" class="empty-cell">No resources loaded yet.</td></tr>';
      return;
    }

    elTbody.innerHTML = top.map(e => `
      <tr>
        <td title="${e.fullUrl}">${e.name}</td>
        <td>${typePillHtml(e.type)}</td>
        <td>${formatBytes(e.size)}</td>
        <td>${e.duration} ms</td>
        <td>${e.protocol}</td>
      </tr>
    `).join('');
  }

  /** Draw bar chart on canvas */

  /**
   * Fallback for ctx.roundRect (not available in all browsers).
   * Draws a rectangle with rounded top corners only.
   */
  function drawRoundedBar(ctx, x, y, w, h, r) {
    if (h <= 0) { ctx.rect(x, y, w, h); return; }
    const radius = Math.min(r, w / 2, h);
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.arcTo(x + w, y,     x + w, y + radius,     radius);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x,     y + h);
    ctx.arcTo(x,      y + radius, x + radius, y,    radius);
    ctx.closePath();
  }

  function renderChart(byType) {
    const ctx = elChartCanvas.getContext('2d');
    const types = Object.keys(byType).sort((a, b) => byType[b].size - byType[a].size);

    if (types.length === 0) {
      elChartCanvas.classList.add('hidden');
      elChartEmpty.classList.remove('hidden');
      return;
    }

    elChartCanvas.classList.remove('hidden');
    elChartEmpty.classList.add('hidden');

    // HiDPI
    const dpr   = window.devicePixelRatio || 1;
    const W     = elChartCanvas.offsetWidth  || 800;
    const H     = 220;
    elChartCanvas.width  = W * dpr;
    elChartCanvas.height = H * dpr;
    elChartCanvas.style.width  = W + 'px';
    elChartCanvas.style.height = H + 'px';
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, W, H);

    const pad    = { top: 20, right: 20, bottom: 50, left: 70 };
    const chartW = W - pad.left - pad.right;
    const chartH = H - pad.top  - pad.bottom;
    const maxVal = Math.max(...types.map(t => byType[t].size));

    const barW   = Math.min(60, (chartW / types.length) * 0.6);
    const step   = chartW / types.length;

    // Grid lines
    ctx.strokeStyle = '#2e3350';
    ctx.lineWidth   = 1;
    const gridLines = 4;
    for (let i = 0; i <= gridLines; i++) {
      const y = pad.top + chartH - (i / gridLines) * chartH;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(pad.left + chartW, y);
      ctx.stroke();

      // Y labels
      ctx.fillStyle   = '#8b92b8';
      ctx.font        = '11px system-ui';
      ctx.textAlign   = 'right';
      ctx.fillText(formatBytes((i / gridLines) * maxVal), pad.left - 6, y + 4);
    }

    // Bars
    types.forEach((type, idx) => {
      const x       = pad.left + idx * step + (step - barW) / 2;
      const barH    = maxVal > 0 ? (byType[type].size / maxVal) * chartH : 0;
      const y       = pad.top + chartH - barH;
      const color   = typeColor(type);

      // Bar fill
      ctx.fillStyle = color + '99';
      ctx.beginPath();
      drawRoundedBar(ctx, x, y, barW, barH, 4);
      ctx.fill();

      // Bar border
      ctx.strokeStyle = color;
      ctx.lineWidth   = 1.5;
      ctx.beginPath();
      drawRoundedBar(ctx, x, y, barW, barH, 4);
      ctx.stroke();

      // Value label
      if (barH > 16) {
        ctx.fillStyle   = '#fff';
        ctx.font        = 'bold 10px system-ui';
        ctx.textAlign   = 'center';
        ctx.fillText(formatBytes(byType[type].size), x + barW / 2, y + 13);
      }

      // X label
      ctx.fillStyle   = '#8b92b8';
      ctx.font        = '11px system-ui';
      ctx.textAlign   = 'center';
      ctx.fillText(type, x + barW / 2, pad.top + chartH + 18);
    });
  }

  /* =====================================================================
     Limit bar
     ===================================================================== */

  function renderLimit(totalBytes) {
    if (limitBytes == null) {
      elLimitStatus.classList.add('hidden');
      return;
    }
    elLimitStatus.classList.remove('hidden');

    const pct = Math.min(100, (totalBytes / limitBytes) * 100);
    elLimitBar.style.width = pct + '%';
    elLimitBar.className   = 'limit-bar';
    if (pct >= 90) elLimitBar.classList.add('danger');
    else if (pct >= 70) elLimitBar.classList.add('warn');

    elLimitText.textContent =
      `${formatBytes(totalBytes)} of ${formatBytes(limitBytes)} used (${pct.toFixed(1)}%)`;

    // Alert once per threshold crossing
    if (pct >= 100 && !window._alertedFull) {
      window._alertedFull = true;
      showToast('⚠ You have reached your data limit!', 'danger');
    } else if (pct >= 80 && !window._alertedWarn) {
      window._alertedWarn = true;
      showToast('⚠ You have used 80% of your data limit.', 'warn');
    }
  }

  /* =====================================================================
     Toast notifications
     ===================================================================== */

  function showToast(msg, level) {
    const colors = {
      danger:  '#f87171',
      warn:    '#fbbf24',
      success: '#34d399',
    };
    const bg = colors[level] || colors.success;
    const t = document.createElement('div');
    t.style.cssText = `
      position:fixed; bottom:1.5rem; right:1.5rem; z-index:9999;
      padding:0.75rem 1.25rem; border-radius:8px; font-size:0.875rem;
      font-weight:600; max-width:320px; box-shadow:0 4px 20px rgba(0,0,0,0.5);
      background:${bg};
      color:#1a1d27;
    `;
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 5000);
  }

  /* =====================================================================
     History
     ===================================================================== */

  function loadHistory() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; }
    catch (_) { return []; }
  }

  function saveHistory(history) {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
  }

  function renderHistory() {
    const history = loadHistory();
    if (history.length === 0) {
      elHistoryList.innerHTML = '<p class="empty-cell">No history yet.</p>';
      return;
    }
    elHistoryList.innerHTML = history.map(h => `
      <div class="history-item">
        <div>
          <span class="h-size">${formatBytes(h.bytes)}</span>
          <span style="color:var(--text-muted);margin-left:0.5rem">${h.requests} requests</span>
        </div>
        <div class="h-date">${h.date}</div>
      </div>
    `).join('');
  }

  function persistCurrentSession(totalBytes, requestCount) {
    const history = loadHistory();
    const now = new Date();
    history.unshift({
      bytes:    totalBytes,
      requests: requestCount,
      date:     now.toLocaleString(),
    });
    saveHistory(history);
  }

  /* =====================================================================
     Main update loop
     ===================================================================== */

  function update() {
    const entries    = getResourceData();
    const totalBytes = entries.reduce((s, e) => s + e.size, 0);
    const byType     = aggregateByType(entries);

    // Summary cards
    elTotal.textContent     = formatBytes(totalBytes);
    elTotalReqs.textContent = `${entries.length} request${entries.length !== 1 ? 's' : ''}`;
    elBadgeRes.textContent  = entries.length;

    const elapsedSec = (Date.now() - sessionStart) / 1000;
    elDuration.textContent  = formatDuration(elapsedSec);
    elStart.textContent     = `Started at ${new Date(sessionStart).toLocaleTimeString()}`;

    const rate = elapsedSec > 0 ? totalBytes / elapsedSec : 0;
    elRate.textContent      = formatRate(rate);

    updateNetworkInfo();
    renderBreakdown(byType);
    renderTable(entries);
    renderChart(byType);
    renderLimit(totalBytes);
    renderHistory();
  }

  /* =====================================================================
     Button wiring
     ===================================================================== */

  $('btn-refresh').addEventListener('click', update);

  $('btn-reset').addEventListener('click', () => {
    if (!confirm('Save this session to history and reset?')) return;

    // Save before clearing
    const entries    = getResourceData();
    const totalBytes = entries.reduce((s, e) => s + e.size, 0);
    persistCurrentSession(totalBytes, entries.length);

    // Clear performance buffer and reload
    performance.clearResourceTimings();
    window._alertedFull = false;
    window._alertedWarn = false;
    update();
    showToast('Session reset. History saved.', 'success');
  });

  $('btn-set-limit').addEventListener('click', () => {
    const val  = parseFloat($('limit-value').value);
    const unit = $('limit-unit').value;
    if (isNaN(val) || val <= 0) { alert('Please enter a valid positive number.'); return; }

    const multipliers = { KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 };
    limitBytes = val * multipliers[unit];
    localStorage.setItem(LIMIT_KEY, limitBytes);
    window._alertedFull = false;
    window._alertedWarn = false;
    update();
  });

  $('btn-clear-limit').addEventListener('click', () => {
    limitBytes = null;
    localStorage.removeItem(LIMIT_KEY);
    $('limit-value').value = '';
    elLimitStatus.classList.add('hidden');
  });

  $('btn-clear-history').addEventListener('click', () => {
    if (!confirm('Clear all history?')) return;
    localStorage.removeItem(HISTORY_KEY);
    renderHistory();
  });

  /* =====================================================================
     Restore persisted limit
     ===================================================================== */

  (function restoreLimit() {
    const stored = localStorage.getItem(LIMIT_KEY);
    if (stored) {
      limitBytes = parseFloat(stored);
      // Show the stored value in MB for convenience
      $('limit-value').value = (limitBytes / (1024 ** 2)).toFixed(2);
      $('limit-unit').value  = 'MB';
    }
  })();

  /* =====================================================================
     PerformanceObserver – live updates as new resources load
     ===================================================================== */

  if (window.PerformanceObserver) {
    try {
      const obs = new PerformanceObserver(() => update());
      obs.observe({ type: 'resource', buffered: true });
    } catch (_) {
      // fallback to polling
    }
  }

  /* =====================================================================
     Polling fallback & timer
     ===================================================================== */

  setInterval(update, REFRESH_MS);

  /* =====================================================================
     Initial render
     ===================================================================== */

  update();

})();
