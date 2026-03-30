/**
 * Data Usage Tracker – Core Application
 *
 * All data is persisted in localStorage under the key "dut_entries" (array of
 * entry objects) and "dut_settings" (daily-limit + categories).
 *
 * Entry schema:
 * {
 *   id:         string   – UUID v4
 *   date:       string   – "YYYY-MM-DD"
 *   app:        string   – app / service name
 *   category:   string   – e.g. "Streaming", "Social", …
 *   downloaded: number   – MB
 *   uploaded:   number   – MB
 *   note:       string   – optional
 * }
 *
 * Settings schema:
 * {
 *   dailyLimitMB: number   – 0 = no limit
 * }
 */

'use strict';

/* ─────────────────────────────────────────────────────────────────────────────
   Constants & helpers
───────────────────────────────────────────────────────────────────────────── */

const STORAGE_KEY_ENTRIES  = 'dut_entries';
const STORAGE_KEY_SETTINGS = 'dut_settings';

const CATEGORIES = ['Streaming', 'Social Media', 'Gaming', 'Work', 'Browsing', 'Downloads', 'Other'];

const CATEGORY_BADGE = {
  'Streaming':    'badge-blue',
  'Social Media': 'badge-pink',
  'Gaming':       'badge-orange',
  'Work':         'badge-cyan',
  'Browsing':     'badge-green',
  'Downloads':    'badge-slate',
  'Other':        'badge-slate',
};

/** Generate a UUID v4 (RFC 4122-compliant). */
function uuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for older browsers
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Format bytes / MB for display. */
function formatMB(mb) {
  if (mb >= 1024) return (mb / 1024).toFixed(2) + ' GB';
  return mb.toFixed(mb < 1 ? 3 : 1) + ' MB';
}

/** Today's date string "YYYY-MM-DD". */
function today() {
  return new Date().toISOString().slice(0, 10);
}

/** Return a human-readable date string "Mon, 28 Mar 2026".
 * @param {string} dateStr - A date string in "YYYY-MM-DD" format.
 * The T00:00:00 suffix ensures parsing in the local timezone
 * rather than UTC, preventing off-by-one date shifts.
 */
function friendlyDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

/** Past N dates (newest last). */
function lastNDates(n) {
  const dates = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

/** Escape HTML for safe insertion via innerHTML. */
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ─────────────────────────────────────────────────────────────────────────────
   Storage
───────────────────────────────────────────────────────────────────────────── */

function loadEntries() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_ENTRIES);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveEntries(entries) {
  localStorage.setItem(STORAGE_KEY_ENTRIES, JSON.stringify(entries));
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SETTINGS);
    return raw ? JSON.parse(raw) : { dailyLimitMB: 0 };
  } catch {
    return { dailyLimitMB: 0 };
  }
}

function saveSettings(settings) {
  localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(settings));
}

/* ─────────────────────────────────────────────────────────────────────────────
   State
───────────────────────────────────────────────────────────────────────────── */

let entries  = loadEntries();
let settings = loadSettings();
let chartInstance = null;
let chartRange = 7; // days shown on chart
let searchQuery = '';

/* ─────────────────────────────────────────────────────────────────────────────
   DOM refs (populated in init)
───────────────────────────────────────────────────────────────────────────── */

let $  = {}; // collected DOM refs

function grabRefs() {
  $ = {
    currentDate:       document.getElementById('current-date'),
    // Stat cards
    statTotalToday:    document.getElementById('stat-total-today'),
    statDownToday:     document.getElementById('stat-down-today'),
    statUpToday:       document.getElementById('stat-up-today'),
    statEntries:       document.getElementById('stat-entries'),
    statLimitLabel:    document.getElementById('stat-limit-label'),
    limitBarFill:      document.getElementById('limit-bar-fill'),
    limitBarUsed:      document.getElementById('limit-bar-used'),
    limitBarMax:       document.getElementById('limit-bar-max'),
    // Form
    form:              document.getElementById('entry-form'),
    fDate:             document.getElementById('f-date'),
    fApp:              document.getElementById('f-app'),
    fCategory:         document.getElementById('f-category'),
    fDown:             document.getElementById('f-down'),
    fUp:               document.getElementById('f-up'),
    fNote:             document.getElementById('f-note'),
    // Chart
    chartCanvas:       document.getElementById('chart-canvas'),
    chartTab7:         document.getElementById('tab-7'),
    chartTab14:        document.getElementById('tab-14'),
    chartTab30:        document.getElementById('tab-30'),
    // Table
    tableBody:         document.getElementById('entries-body'),
    tableEmpty:        document.getElementById('entries-empty'),
    searchInput:       document.getElementById('search-input'),
    btnExport:         document.getElementById('btn-export'),
    btnClearAll:       document.getElementById('btn-clear-all'),
    // Settings modal
    btnSettings:       document.getElementById('btn-settings'),
    modalBackdrop:     document.getElementById('modal-settings'),
    modalClose:        document.getElementById('modal-close'),
    btnCancelSettings: document.getElementById('btn-cancel-settings'),
    sLimitMB:          document.getElementById('s-limit-mb'),
    btnSaveSettings:   document.getElementById('btn-save-settings'),
    // Toast
    toastContainer:    document.getElementById('toast-container'),
  };
}

/* ─────────────────────────────────────────────────────────────────────────────
   Toasts
───────────────────────────────────────────────────────────────────────────── */

function showToast(message, type = 'info', duration = 3000) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  $.toastContainer.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity .3s';
    setTimeout(() => el.remove(), 300);
  }, duration);
}

/* ─────────────────────────────────────────────────────────────────────────────
   Derived data helpers
───────────────────────────────────────────────────────────────────────────── */

function getTodayEntries() {
  const t = today();
  return entries.filter(e => e.date === t);
}

/** Compute total downloaded and uploaded MB for a given date in one pass.
 * @param {string} dateStr - "YYYY-MM-DD"
 * @returns {{ dl: number, ul: number }}
 */
  return entries
    .filter(e => e.date === dateStr)
    .reduce((acc, e) => ({ dl: acc.dl + e.downloaded, ul: acc.ul + e.uploaded }), { dl: 0, ul: 0 });
}

/* ─────────────────────────────────────────────────────────────────────────────
   Dashboard / stat cards
───────────────────────────────────────────────────────────────────────────── */

function renderStats() {
  const t = today();
  const todayEntries = getTodayEntries();
  const totalDL = todayEntries.reduce((s, e) => s + e.downloaded, 0);
  const totalUL = todayEntries.reduce((s, e) => s + e.uploaded, 0);
  const total   = totalDL + totalUL;

  $.statTotalToday.textContent = formatMB(total);
  $.statDownToday.textContent  = formatMB(totalDL);
  $.statUpToday.textContent    = formatMB(totalUL);
  $.statEntries.textContent    = String(todayEntries.length);

  // Limit bar
  const limit = settings.dailyLimitMB;
  if (limit > 0) {
    const pct = Math.min((total / limit) * 100, 100);
    $.limitBarFill.style.width = pct + '%';
    $.limitBarFill.classList.toggle('warn',   pct >= 70 && pct < 90);
    $.limitBarFill.classList.toggle('danger', pct >= 90);
    $.limitBarUsed.textContent = formatMB(total);
    $.limitBarMax.textContent  = 'of ' + formatMB(limit);
    $.statLimitLabel.textContent = `Daily limit: ${Math.round(pct)}% used`;
  } else {
    $.limitBarFill.style.width = '0%';
    $.limitBarFill.classList.remove('warn', 'danger');
    $.limitBarUsed.textContent = '';
    $.limitBarMax.textContent  = '';
    $.statLimitLabel.textContent = 'No daily limit set';
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   Chart (Chart.js)
───────────────────────────────────────────────────────────────────────────── */

function buildChartData(range) {
  const dates = lastNDates(range);
  const labels = dates.map(d => {
    const dt = new Date(d + 'T00:00:00');
    return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  });
  const dlData = dates.map(d => parseFloat((sumForDate(d).dl / 1024).toFixed(3)));
  const ulData = dates.map(d => parseFloat((sumForDate(d).ul / 1024).toFixed(3)));
  return { labels, dlData, ulData };
}

function renderChart() {
  if (!window.Chart) return;
  const { labels, dlData, ulData } = buildChartData(chartRange);

  if (chartInstance) {
    chartInstance.data.labels           = labels;
    chartInstance.data.datasets[0].data = dlData;
    chartInstance.data.datasets[1].data = ulData;
    chartInstance.update();
    return;
  }

  const ctx = $.chartCanvas.getContext('2d');
  chartInstance = new window.Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Downloaded (GB)',
          data: dlData,
          backgroundColor: 'rgba(79,70,229,.7)',
          borderRadius: 5,
          borderSkipped: false,
        },
        {
          label: 'Uploaded (GB)',
          data: ulData,
          backgroundColor: 'rgba(6,182,212,.6)',
          borderRadius: 5,
          borderSkipped: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          labels: { color: '#94a3b8', boxWidth: 14, font: { size: 12 } },
        },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y.toFixed(3)} GB`,
          },
        },
      },
      scales: {
        x: {
          ticks: { color: '#64748b', maxRotation: 45 },
          grid:  { color: 'rgba(255,255,255,.04)' },
        },
        y: {
          ticks: {
            color: '#64748b',
            callback: v => v + ' GB',
          },
          grid:  { color: 'rgba(255,255,255,.06)' },
          beginAtZero: true,
        },
      },
    },
  });
}

/* ─────────────────────────────────────────────────────────────────────────────
   Entries table
───────────────────────────────────────────────────────────────────────────── */

function filteredEntries() {
  const q = searchQuery.trim().toLowerCase();
  if (!q) return entries.slice().sort((a, b) => b.date.localeCompare(a.date));
  return entries
    .filter(e =>
      e.app.toLowerCase().includes(q) ||
      e.category.toLowerCase().includes(q) ||
      e.date.includes(q) ||
      (e.note && e.note.toLowerCase().includes(q))
    )
    .sort((a, b) => b.date.localeCompare(a.date));
}

function renderTable() {
  const rows = filteredEntries();

  if (rows.length === 0) {
    $.tableBody.innerHTML = '';
    $.tableEmpty.classList.remove('hidden');
    return;
  }

  $.tableEmpty.classList.add('hidden');
  $.tableBody.innerHTML = rows.map(e => {
    const total = e.downloaded + e.uploaded;
    const badgeClass = CATEGORY_BADGE[e.category] || 'badge-slate';
    return `<tr>
      <td>${escHtml(friendlyDate(e.date))}</td>
      <td>${escHtml(e.app)}</td>
      <td><span class="badge ${badgeClass}">${escHtml(e.category)}</span></td>
      <td>${escHtml(formatMB(e.downloaded))}</td>
      <td>${escHtml(formatMB(e.uploaded))}</td>
      <td><strong>${escHtml(formatMB(total))}</strong></td>
      <td class="text-right">
        <button class="btn btn-danger" data-delete="${escHtml(e.id)}" title="Delete entry">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
          </svg>
        </button>
      </td>
    </tr>`;
  }).join('');
}

/* ─────────────────────────────────────────────────────────────────────────────
   Full re-render
───────────────────────────────────────────────────────────────────────────── */

function render() {
  renderStats();
  renderChart();
  renderTable();
}

/* ─────────────────────────────────────────────────────────────────────────────
   Entry CRUD
───────────────────────────────────────────────────────────────────────────── */

function addEntry(data) {
  const entry = {
    id:         uuid(),
    date:       data.date,
    app:        data.app.trim(),
    category:   data.category,
    downloaded: parseFloat(data.downloaded) || 0,
    uploaded:   parseFloat(data.uploaded)   || 0,
    note:       data.note.trim(),
  };
  entries.push(entry);
  saveEntries(entries);
}

function deleteEntry(id) {
  entries = entries.filter(e => e.id !== id);
  saveEntries(entries);
}

/* ─────────────────────────────────────────────────────────────────────────────
   CSV Export
───────────────────────────────────────────────────────────────────────────── */

function exportCSV() {
  const header = ['Date', 'App / Service', 'Category', 'Downloaded (MB)', 'Uploaded (MB)', 'Total (MB)', 'Note'];
  const rows = entries
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date))
    .map(e => [
      e.date,
      `"${e.app.replace(/"/g, '""')}"`,
      e.category,
      e.downloaded.toFixed(3),
      e.uploaded.toFixed(3),
      (e.downloaded + e.uploaded).toFixed(3),
      `"${(e.note || '').replace(/"/g, '""')}"`,
    ].join(','));

  const csv = [header.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `data-usage-${today()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Exported to CSV', 'success');
}

/* ─────────────────────────────────────────────────────────────────────────────
   Settings modal
───────────────────────────────────────────────────────────────────────────── */

function openSettings() {
  $.sLimitMB.value = settings.dailyLimitMB || '';
  $.modalBackdrop.classList.add('open');
  $.sLimitMB.focus();
}

function closeSettings() {
  $.modalBackdrop.classList.remove('open');
}

function saveSettingsFromModal() {
  const raw = parseFloat($.sLimitMB.value);
  settings.dailyLimitMB = (!isNaN(raw) && raw > 0) ? raw : 0;
  saveSettings(settings);
  closeSettings();
  render();
  showToast('Settings saved', 'success');
}

/* ─────────────────────────────────────────────────────────────────────────────
   Form helpers
───────────────────────────────────────────────────────────────────────────── */

function resetForm() {
  $.fDate.value     = today();
  $.fApp.value      = '';
  $.fDown.value     = '';
  $.fUp.value       = '';
  $.fNote.value     = '';
  $.fCategory.value = 'Other';
}

function handleFormSubmit(e) {
  e.preventDefault();

  const app = $.fApp.value.trim();
  if (!app) { showToast('Please enter an app or service name', 'error'); $.fApp.focus(); return; }

  const dl = parseFloat($.fDown.value) || 0;
  const ul = parseFloat($.fUp.value)   || 0;
  if (dl < 0 || ul < 0) { showToast('Values must be non-negative', 'error'); return; }
  if (dl === 0 && ul === 0) { showToast('Enter at least one non-zero value', 'error'); return; }

  addEntry({
    date:       $.fDate.value || today(),
    app,
    category:   $.fCategory.value,
    downloaded: dl,
    uploaded:   ul,
    note:       $.fNote.value,
  });

  resetForm();
  render();
  showToast('Entry added', 'success');
  $.fApp.focus();
}

/* ─────────────────────────────────────────────────────────────────────────────
   Event wiring
───────────────────────────────────────────────────────────────────────────── */

function wireEvents() {
  // Form submit
  $.form.addEventListener('submit', handleFormSubmit);

  // Delete entry (event delegation on table body)
  $.tableBody.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-delete]');
    if (!btn) return;
    const id = btn.dataset.delete;
    deleteEntry(id);
    render();
    showToast('Entry deleted', 'info');
  });

  // Search
  $.searchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value;
    renderTable();
  });

  // Chart range tabs
  [$.chartTab7, $.chartTab14, $.chartTab30].forEach(btn => {
    btn.addEventListener('click', () => {
      [$.chartTab7, $.chartTab14, $.chartTab30].forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      chartRange = parseInt(btn.dataset.range, 10);
      renderChart();
    });
  });

  // Export
  $.btnExport.addEventListener('click', exportCSV);

  // Clear all
  $.btnClearAll.addEventListener('click', () => {
    if (!entries.length) { showToast('Nothing to clear', 'info'); return; }
    if (!confirm('Delete ALL entries? This cannot be undone.')) return;
    entries = [];
    saveEntries(entries);
    render();
    showToast('All entries cleared', 'info');
  });

  // Settings
  $.btnSettings.addEventListener('click', openSettings);
  $.modalClose.addEventListener('click', closeSettings);
  $.btnCancelSettings.addEventListener('click', closeSettings);
  $.btnSaveSettings.addEventListener('click', saveSettingsFromModal);
  $.modalBackdrop.addEventListener('click', (e) => {
    if (e.target === $.modalBackdrop) closeSettings();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSettings();
  });
}

/* ─────────────────────────────────────────────────────────────────────────────
   Init
───────────────────────────────────────────────────────────────────────────── */

function init() {
  grabRefs();

  // Set live date in header
  $.currentDate.textContent = new Date().toLocaleDateString(undefined, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  // Pre-fill form date
  $.fDate.value = today();
  $.fDate.max   = today();

  wireEvents();
  render();

  // Auto-refresh stats & chart every minute (keep live totals accurate)
  setInterval(() => {
    $.currentDate.textContent = new Date().toLocaleDateString(undefined, {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
    renderStats();
  }, 60_000);
}

// Wait for DOM + Chart.js CDN script
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
