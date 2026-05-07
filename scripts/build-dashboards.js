/**
 * build-dashboards.js
 * Reads JSON snapshots and generates static HTML dashboards.
 * Output goes to public/ for Cloudflare Pages / Netlify deployment.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, "config/clients.json"), "utf-8"));

function usd(v) { return `$${Number(v).toFixed(2)}`; }
function arrow(v) { return v > 0 ? "&#9650;" : v < 0 ? "&#9660;" : "&#8212;"; }
function arrowClass(v, invert = false) {
  if (v === 0) return "neutral";
  const up = invert ? v < 0 : v > 0;
  return up ? "up" : "down";
}
function pctStr(v) { return `${v > 0 ? "+" : ""}${Math.round(v)}%`; }
function healthEmoji(s) { return s >= 85 ? "&#x1F7E2;" : s >= 65 ? "&#x1F7E1;" : "&#x1F534;"; }

// Load historical data for trend charts (last N weeks)
function loadHistory(clientId, maxWeeks = 12) {
  const dir = path.join(ROOT, "data", clientId);
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir)
    .filter(f => f.startsWith("week-") && f.endsWith(".json"))
    .sort()
    .slice(-maxWeeks);
  return files.map(f => JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")));
}

// Load Meta history
function loadMetaHistory(maxWeeks = 12) {
  return loadHistory("meta-localeyespro", maxWeeks);
}

// ─────────────────────────────────────────────
// CLIENT DASHBOARD
// ─────────────────────────────────────────────
function buildClientDashboard(clientConfig, snap) {
  const s = snap.summary;
  const history = loadHistory(clientConfig.id);
  const historyLabels = history.map(h => h.meta.weekOf);
  const historyLeads = history.map(h => h.summary.thisWeek.conversions);
  const historyCPL = history.map(h => h.summary.thisWeek.cpl);
  const historySpend = history.map(h => h.summary.thisWeek.spend);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${clientConfig.name} — Performance Report</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f7fa; color: #1a1a2e; line-height: 1.5; }
  .container { max-width: 900px; margin: 0 auto; padding: 20px; }

  .header { background: linear-gradient(135deg, #1F3864 0%, #2E75B6 100%); color: white; padding: 32px; border-radius: 12px; margin-bottom: 24px; }
  .header h1 { font-size: 24px; font-weight: 700; margin-bottom: 4px; }
  .header .subtitle { opacity: 0.8; font-size: 14px; }

  .scorecard { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin-bottom: 24px; }
  .card { background: white; border-radius: 10px; padding: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
  .card .label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; color: #666; margin-bottom: 4px; }
  .card .value { font-size: 28px; font-weight: 700; color: #1F3864; }
  .card .delta { font-size: 13px; margin-top: 4px; }
  .card .delta.up { color: #2e7d32; }
  .card .delta.down { color: #c62828; }
  .card .delta.neutral { color: #666; }

  .section { background: white; border-radius: 10px; padding: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); margin-bottom: 24px; }
  .section h2 { font-size: 16px; font-weight: 600; color: #1F3864; margin-bottom: 16px; }

  .chart-container { position: relative; height: 260px; }

  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th { text-align: left; padding: 10px 12px; border-bottom: 2px solid #e0e0e0; color: #666; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
  td { padding: 10px 12px; border-bottom: 1px solid #f0f0f0; }
  tr:hover { background: #f8f9fa; }

  .footer { text-align: center; padding: 24px; color: #999; font-size: 13px; }
  .updated { text-align: center; color: #999; font-size: 12px; margin-bottom: 20px; }

  @media (max-width: 600px) {
    .scorecard { grid-template-columns: repeat(2, 1fr); }
    .card .value { font-size: 22px; }
    .container { padding: 12px; }
  }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>${clientConfig.name}</h1>
    <div class="subtitle">Weekly Performance Report &mdash; Week of ${snap.meta.weekOf}</div>
  </div>

  <div class="updated">Last updated: ${new Date(snap.meta.generatedAt).toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</div>

  <div class="scorecard">
    <div class="card">
      <div class="label">Leads</div>
      <div class="value">${s.thisWeek.conversions}</div>
      <div class="delta ${arrowClass(s.delta.leadsPct)}">${arrow(s.delta.leadsPct)} ${pctStr(s.delta.leadsPct)} vs last week</div>
    </div>
    <div class="card">
      <div class="label">Ad Spend</div>
      <div class="value">${usd(s.thisWeek.spend)}</div>
      <div class="delta ${arrowClass(s.delta.spendPct)}">${arrow(s.delta.spendPct)} ${pctStr(s.delta.spendPct)} vs last week</div>
    </div>
    <div class="card">
      <div class="label">Cost Per Lead</div>
      <div class="value">${s.thisWeek.cpl > 0 ? usd(s.thisWeek.cpl) : "N/A"}</div>
      <div class="delta ${arrowClass(s.delta.cplPct, true)}">${arrow(s.delta.cplPct)} ${pctStr(s.delta.cplPct)} vs last week</div>
    </div>
    <div class="card">
      <div class="label">Phone Calls</div>
      <div class="value">${s.thisWeek.conversions}</div>
      <div class="delta neutral">via Google Ads</div>
    </div>
  </div>

  <div class="section">
    <h2>8-Week Trend</h2>
    <div class="chart-container">
      <canvas id="trendChart"></canvas>
    </div>
  </div>

  <div class="section">
    <h2>Daily Breakdown</h2>
    <table>
      <thead><tr><th>Date</th><th>Spend</th><th>Clicks</th><th>Leads</th></tr></thead>
      <tbody>
        ${snap.daily.map(d => `<tr><td>${d.date}</td><td>${usd(d.spend)}</td><td>${d.clicks}</td><td>${d.conversions}</td></tr>`).join("\n        ")}
      </tbody>
    </table>
  </div>

  <div class="footer">Managed by LocalEyes Pro</div>
</div>

<script>
const ctx = document.getElementById('trendChart').getContext('2d');
new Chart(ctx, {
  type: 'line',
  data: {
    labels: ${JSON.stringify(historyLabels)},
    datasets: [
      {
        label: 'Leads',
        data: ${JSON.stringify(historyLeads)},
        borderColor: '#2E75B6',
        backgroundColor: 'rgba(46,117,182,0.1)',
        fill: true,
        tension: 0.3,
        yAxisID: 'y',
      },
      {
        label: 'Cost Per Lead',
        data: ${JSON.stringify(historyCPL)},
        borderColor: '#E67E22',
        borderDash: [5, 5],
        fill: false,
        tension: 0.3,
        yAxisID: 'y1',
      }
    ]
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { intersect: false, mode: 'index' },
    plugins: { legend: { position: 'bottom' } },
    scales: {
      y: { beginAtZero: true, title: { display: true, text: 'Leads' }, position: 'left' },
      y1: { beginAtZero: true, title: { display: true, text: 'CPL ($)' }, position: 'right', grid: { drawOnChartArea: false } },
    }
  }
});
</script>
</body>
</html>`;
}

// ─────────────────────────────────────────────
// INTERNAL DASHBOARD (Mitch)
// ─────────────────────────────────────────────
function buildInternalDashboard(allSnapshots, metaSnapshot) {
  const clientTabs = allSnapshots.filter(s => !s.meta.error);
  const hasMeta = !!metaSnapshot;

  // Load all historical data for date range selector (up to 12 weeks)
  const allHistory = {};
  for (const snap of clientTabs) {
    allHistory[snap.meta.clientId] = loadHistory(snap.meta.clientId, 12);
  }
  const metaHistory = loadMetaHistory(12);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>LocalEyes Pro — Internal Dashboard</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns@3.0.0/dist/chartjs-adapter-date-fns.bundle.min.js"></script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f1923; color: #e0e0e0; line-height: 1.5; }
  .container { max-width: 1100px; margin: 0 auto; padding: 20px; }

  .header { display: flex; justify-content: space-between; align-items: center; padding: 20px 0; border-bottom: 1px solid #1e2d3d; margin-bottom: 24px; flex-wrap: wrap; gap: 12px; }
  .header h1 { font-size: 22px; color: #fff; }
  .header-right { display: flex; align-items: center; gap: 16px; }
  .header .date { color: #7a8a9e; font-size: 14px; }

  /* Date Range Selector */
  .date-range { display: flex; align-items: center; gap: 8px; }
  .date-range label { font-size: 12px; color: #546778; text-transform: uppercase; letter-spacing: 0.5px; }
  .date-range select, .date-range input[type="date"] {
    background: #1a2733; color: #e0e0e0; border: 1px solid #1e2d3d; border-radius: 6px;
    padding: 6px 10px; font-size: 13px; cursor: pointer; outline: none;
  }
  .date-range select:hover, .date-range input[type="date"]:hover { border-color: #2E75B6; }
  .date-range select:focus, .date-range input[type="date"]:focus { border-color: #2E75B6; box-shadow: 0 0 0 2px rgba(46,117,182,0.2); }
  .custom-range { display: none; align-items: center; gap: 6px; margin-top: 8px; }
  .custom-range.visible { display: flex; }
  .custom-range span { color: #546778; font-size: 12px; }

  .tabs { display: flex; gap: 8px; margin-bottom: 24px; flex-wrap: wrap; }
  .tab { padding: 8px 20px; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 500; background: #1a2733; color: #7a8a9e; border: 1px solid #1e2d3d; transition: all 0.2s; }
  .tab:hover { background: #1e2d3d; color: #fff; }
  .tab.active { background: #2E75B6; color: #fff; border-color: #2E75B6; }
  .tab.meta-tab { border-color: #1877F2; }
  .tab.meta-tab.active { background: #1877F2; border-color: #1877F2; }

  .panel { display: none; }
  .panel.active { display: block; }

  .overview-grid { display: grid; grid-template-columns: 1fr; gap: 12px; margin-bottom: 24px; }
  .overview-row { display: grid; grid-template-columns: 2fr repeat(5, 1fr) 80px; gap: 0; background: #1a2733; border-radius: 8px; padding: 16px 20px; align-items: center; }
  .overview-row.header-row { background: transparent; padding: 8px 20px; color: #546778; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
  .overview-row .client-name { font-weight: 600; color: #fff; }
  .overview-row .metric { text-align: right; font-size: 14px; }
  .overview-row .health { text-align: center; font-size: 14px; font-weight: 600; }

  .platform-badge { display: inline-block; font-size: 10px; padding: 2px 6px; border-radius: 3px; margin-left: 8px; font-weight: 600; vertical-align: middle; }
  .badge-google { background: rgba(66,133,244,0.2); color: #4285F4; }
  .badge-meta { background: rgba(24,119,242,0.2); color: #1877F2; }

  .up { color: #4caf50; }
  .down { color: #ef5350; }
  .neutral { color: #7a8a9e; }

  .detail-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 24px; }
  .detail-card { background: #1a2733; border-radius: 10px; padding: 20px; }
  .detail-card .label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #546778; margin-bottom: 4px; }
  .detail-card .value { font-size: 26px; font-weight: 700; color: #fff; }
  .detail-card .sub { font-size: 12px; color: #7a8a9e; margin-top: 4px; }

  .section { background: #1a2733; border-radius: 10px; padding: 24px; margin-bottom: 24px; }
  .section h3 { font-size: 14px; font-weight: 600; color: #fff; margin-bottom: 16px; }

  .chart-container { position: relative; height: 240px; }

  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; padding: 10px 12px; border-bottom: 1px solid #1e2d3d; color: #546778; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
  td { padding: 10px 12px; border-bottom: 1px solid #141e28; }
  tr:hover { background: #141e28; }

  .alert-item { padding: 10px 14px; background: #141e28; border-radius: 6px; margin-bottom: 8px; font-size: 13px; border-left: 3px solid #E67E22; }
  .alert-item.critical { border-left-color: #ef5350; }
  .alert-item.good { border-left-color: #4caf50; }

  .range-info { background: #141e28; border-radius: 6px; padding: 8px 14px; margin-bottom: 16px; font-size: 12px; color: #7a8a9e; display: flex; align-items: center; gap: 8px; }
  .range-info .icon { font-size: 14px; }

  @media (max-width: 768px) {
    .overview-row { grid-template-columns: 1fr 1fr; gap: 8px; }
    .overview-row.header-row { display: none; }
    .detail-grid { grid-template-columns: repeat(2, 1fr); }
    .header { flex-direction: column; align-items: flex-start; }
    .date-range { flex-wrap: wrap; }
  }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>LocalEyes Pro &mdash; Agency Dashboard</h1>
    <div class="header-right">
      <div class="date-range">
        <label>Range:</label>
        <select id="dateRangeSelect" onchange="onRangeChange()">
          <option value="1">This Week</option>
          <option value="4" selected>Last 4 Weeks</option>
          <option value="8">Last 8 Weeks</option>
          <option value="12">Last 12 Weeks</option>
          <option value="custom">Custom</option>
        </select>
      </div>
      <div class="date">${allSnapshots[0]?.meta?.weekOf ? "Week of " + allSnapshots[0].meta.weekOf : ""}</div>
    </div>
  </div>
  <div class="custom-range" id="customRange">
    <label style="font-size:12px;color:#546778;">From:</label>
    <input type="date" id="customStart" onchange="onCustomRangeChange()" />
    <span>&mdash;</span>
    <label style="font-size:12px;color:#546778;">To:</label>
    <input type="date" id="customEnd" onchange="onCustomRangeChange()" />
  </div>

  <div id="rangeInfo" class="range-info" style="display:none;">
    <span class="icon">&#128197;</span>
    <span id="rangeInfoText"></span>
  </div>

  <div class="tabs">
    <div class="tab active" onclick="showPanel('overview')">Overview</div>
    ${clientTabs.map(s => `<div class="tab" onclick="showPanel('${s.meta.clientId}')">${s.meta.clientName} <span class="platform-badge badge-google">GA</span></div>`).join("\n    ")}
    ${hasMeta ? `<div class="tab meta-tab" onclick="showPanel('meta-localeyespro')">LocalEyes Meta <span class="platform-badge badge-meta">META</span></div>` : ""}
  </div>

  <!-- OVERVIEW PANEL -->
  <div class="panel active" id="panel-overview">
    <div class="overview-grid">
      <div class="overview-row header-row">
        <div>Account</div><div class="metric">Spend</div><div class="metric">Pacing</div><div class="metric">Leads</div><div class="metric">CPL</div><div class="metric">Trend</div><div class="health">Health</div>
      </div>
      ${clientTabs.map(s => {
        const sm = s.summary;
        return `<div class="overview-row">
        <div class="client-name">${s.meta.clientName} <span class="platform-badge badge-google">GA</span></div>
        <div class="metric">${usd(sm.thisWeek.spend)}</div>
        <div class="metric">${sm.pacing}%</div>
        <div class="metric">${sm.thisWeek.conversions}</div>
        <div class="metric">${sm.thisWeek.cpl > 0 ? usd(sm.thisWeek.cpl) : "N/A"}</div>
        <div class="metric ${arrowClass(sm.delta.leadsPct)}">${arrow(sm.delta.leadsPct)} ${pctStr(sm.delta.leadsPct)}</div>
        <div class="health">${healthEmoji(s.health.score)} ${s.health.score}</div>
      </div>`;
      }).join("\n      ")}
      ${hasMeta ? (() => {
        const ms = metaSnapshot.summary;
        return `<div class="overview-row">
        <div class="client-name">LocalEyes Lead Gen <span class="platform-badge badge-meta">META</span></div>
        <div class="metric">${usd(ms.thisWeek.spend)}</div>
        <div class="metric">${ms.pacing}%</div>
        <div class="metric">${ms.thisWeek.leads}</div>
        <div class="metric">${ms.thisWeek.cpl > 0 ? usd(ms.thisWeek.cpl) : "N/A"}</div>
        <div class="metric ${arrowClass(ms.delta.leadsPct)}">${arrow(ms.delta.leadsPct)} ${pctStr(ms.delta.leadsPct)}</div>
        <div class="health">&mdash;</div>
      </div>`;
      })() : ""}
    </div>

    <!-- Agency totals -->
    <div class="detail-grid">
      <div class="detail-card">
        <div class="label">Total Ad Spend</div>
        <div class="value">${usd(clientTabs.reduce((s, c) => s + c.summary.thisWeek.spend, 0) + (hasMeta ? metaSnapshot.summary.thisWeek.spend : 0))}</div>
        <div class="sub">${clientTabs.length} client${clientTabs.length !== 1 ? "s" : ""} + agency Meta</div>
      </div>
      <div class="detail-card">
        <div class="label">Client Leads (Google)</div>
        <div class="value">${clientTabs.reduce((s, c) => s + c.summary.thisWeek.conversions, 0)}</div>
        <div class="sub">across client accounts</div>
      </div>
      <div class="detail-card">
        <div class="label">Agency Leads (Meta)</div>
        <div class="value">${hasMeta ? metaSnapshot.summary.thisWeek.leads : "—"}</div>
        <div class="sub">tree service prospects</div>
      </div>
      <div class="detail-card">
        <div class="label">Avg Client Health</div>
        <div class="value">${Math.round(clientTabs.reduce((s, c) => s + c.health.score, 0) / (clientTabs.length || 1))}</div>
        <div class="sub">target: 85+</div>
      </div>
    </div>
  </div>

  <!-- CLIENT DETAIL PANELS (Google Ads) -->
  ${clientTabs.map(snap => {
    const s = snap.summary;
    const history = allHistory[snap.meta.clientId] || [];
    const hLabels = history.map(h => h.meta.weekOf);
    const hLeads = history.map(h => h.summary.thisWeek.conversions);
    const hCPL = history.map(h => h.summary.thisWeek.cpl);
    const hSpend = history.map(h => h.summary.thisWeek.spend);
    const hHealth = history.map(h => h.health.score);

    return `<div class="panel" id="panel-${snap.meta.clientId}">
    <div class="detail-grid">
      <div class="detail-card">
        <div class="label">Leads</div>
        <div class="value">${s.thisWeek.conversions}</div>
        <div class="sub ${arrowClass(s.delta.leadsPct)}">${arrow(s.delta.leadsPct)} ${pctStr(s.delta.leadsPct)} WoW</div>
      </div>
      <div class="detail-card">
        <div class="label">Spend</div>
        <div class="value">${usd(s.thisWeek.spend)}</div>
        <div class="sub">${s.pacing}% of ${usd(snap.meta.weeklyBudget)} weekly</div>
      </div>
      <div class="detail-card">
        <div class="label">Cost Per Lead</div>
        <div class="value">${s.thisWeek.cpl > 0 ? usd(s.thisWeek.cpl) : "N/A"}</div>
        <div class="sub ${arrowClass(s.delta.cplPct, true)}">${arrow(s.delta.cplPct)} ${pctStr(s.delta.cplPct)} WoW</div>
      </div>
      <div class="detail-card">
        <div class="label">CTR</div>
        <div class="value">${s.thisWeek.ctr}%</div>
        <div class="sub">CPC: ${usd(s.thisWeek.cpc)}</div>
      </div>
      <div class="detail-card">
        <div class="label">Health Score</div>
        <div class="value">${healthEmoji(snap.health.score)} ${snap.health.score}/100</div>
        <div class="sub">
          T:${snap.health.breakdown.conversionTracking} P:${snap.health.breakdown.budgetPacing} C:${snap.health.breakdown.cpl} W:${snap.health.breakdown.searchTermWaste} A:${snap.health.breakdown.adApprovals} N:${snap.health.breakdown.negativeKeywords}
        </div>
      </div>
    </div>

    <div class="section">
      <h3>Trend</h3>
      <div class="chart-container"><canvas id="chart-${snap.meta.clientId}"></canvas></div>
    </div>

    <div class="section">
      <h3>Alerts &amp; Actions</h3>
      ${snap.alerts.wasteTerms.length > 0 ? snap.alerts.wasteTerms.slice(0, 5).map(t =>
        `<div class="alert-item">"${t.term}" &mdash; ${t.clicks} clicks, ${usd(t.spend)}, 0 conversions</div>`
      ).join("\n      ") : '<div class="alert-item good">No wasted search terms this week</div>'}
      ${snap.ads.disapproved > 0 ? `<div class="alert-item critical">${snap.ads.disapproved} disapproved ad(s)</div>` : ""}
      ${!snap.conversionTracking.active ? '<div class="alert-item critical">Conversion tracking not firing</div>' : ""}
      ${s.pacing < 80 ? `<div class="alert-item">Budget underspending at ${s.pacing}%</div>` : ""}
      ${snap.alerts.bidOpportunities.length > 0 ? snap.alerts.bidOpportunities.slice(0, 3).map(k =>
        `<div class="alert-item good">"${k.keyword}" CPL at ${usd(k.cpl)} &mdash; bid increase opportunity</div>`
      ).join("\n      ") : ""}
    </div>

    <div class="section">
      <h3>Keyword Performance</h3>
      <table>
        <thead><tr><th>Keyword</th><th>Match</th><th>Clicks</th><th>Conv</th><th>Spend</th><th>CPL</th></tr></thead>
        <tbody>
          ${snap.keywords.slice(0, 12).map(k => `<tr>
            <td>${k.keyword}</td><td>${k.matchType}</td><td>${k.clicks}</td>
            <td>${k.conversions}</td><td>${usd(k.spend)}</td><td>${k.cpl !== null ? usd(k.cpl) : "—"}</td>
          </tr>`).join("\n          ")}
        </tbody>
      </table>
    </div>
  </div>`;
  }).join("\n  ")}

  <!-- META ADS PANEL -->
  ${hasMeta ? (() => {
    const ms = metaSnapshot.summary;
    const mhLabels = metaHistory.map(h => h.meta.weekOf);
    const mhLeads = metaHistory.map(h => h.summary.thisWeek.leads);
    const mhCPL = metaHistory.map(h => h.summary.thisWeek.cpl);
    const mhSpend = metaHistory.map(h => h.summary.thisWeek.spend);

    return `<div class="panel" id="panel-meta-localeyespro">
    <div class="detail-grid">
      <div class="detail-card">
        <div class="label">Leads</div>
        <div class="value">${ms.thisWeek.leads}</div>
        <div class="sub ${arrowClass(ms.delta.leadsPct)}">${arrow(ms.delta.leadsPct)} ${pctStr(ms.delta.leadsPct)} WoW</div>
      </div>
      <div class="detail-card">
        <div class="label">Spend</div>
        <div class="value">${usd(ms.thisWeek.spend)}</div>
        <div class="sub">${ms.pacing}% of ${usd(metaSnapshot.meta.weeklyBudget)} weekly</div>
      </div>
      <div class="detail-card">
        <div class="label">Cost Per Lead</div>
        <div class="value">${ms.thisWeek.cpl > 0 ? usd(ms.thisWeek.cpl) : "N/A"}</div>
        <div class="sub ${arrowClass(ms.delta.cplPct, true)}">${arrow(ms.delta.cplPct)} ${pctStr(ms.delta.cplPct)} WoW</div>
      </div>
      <div class="detail-card">
        <div class="label">CTR</div>
        <div class="value">${(ms.thisWeek.ctr * 100).toFixed(2)}%</div>
        <div class="sub">CPC: ${usd(ms.thisWeek.cpc)}</div>
      </div>
      <div class="detail-card">
        <div class="label">Impressions</div>
        <div class="value">${ms.thisWeek.impressions.toLocaleString()}</div>
        <div class="sub">${ms.thisWeek.clicks} clicks</div>
      </div>
    </div>

    <div class="section">
      <h3>Trend</h3>
      <div class="chart-container"><canvas id="chart-meta"></canvas></div>
    </div>

    <!-- Campaign Breakdown -->
    <div class="section">
      <h3>Campaign Performance</h3>
      <table>
        <thead><tr><th>Campaign</th><th>Spend</th><th>Impressions</th><th>Clicks</th><th>Leads</th><th>CPL</th></tr></thead>
        <tbody>
          ${metaSnapshot.campaigns.map(c => `<tr>
            <td>${c.name}</td><td>${usd(c.spend)}</td><td>${c.impressions.toLocaleString()}</td>
            <td>${c.clicks}</td><td>${c.leads}</td><td>${c.cpl > 0 ? usd(c.cpl) : "—"}</td>
          </tr>`).join("\n          ")}
        </tbody>
      </table>
    </div>

    <!-- Ad Set Breakdown -->
    <div class="section">
      <h3>Ad Set Performance</h3>
      <table>
        <thead><tr><th>Ad Set</th><th>Campaign</th><th>Spend</th><th>Clicks</th><th>Leads</th><th>CPL</th></tr></thead>
        <tbody>
          ${metaSnapshot.adsets.slice(0, 12).map(a => `<tr>
            <td>${a.name}</td><td style="color:#546778;font-size:12px">${a.campaign}</td><td>${usd(a.spend)}</td>
            <td>${a.clicks}</td><td>${a.leads}</td><td>${a.cpl > 0 ? usd(a.cpl) : "—"}</td>
          </tr>`).join("\n          ")}
        </tbody>
      </table>
    </div>

    <!-- Ad Breakdown -->
    <div class="section">
      <h3>Ad Performance</h3>
      <table>
        <thead><tr><th>Ad</th><th>Ad Set</th><th>Spend</th><th>Clicks</th><th>Leads</th><th>CPL</th></tr></thead>
        <tbody>
          ${metaSnapshot.ads.slice(0, 12).map(a => `<tr>
            <td>${a.name}</td><td style="color:#546778;font-size:12px">${a.adset}</td><td>${usd(a.spend)}</td>
            <td>${a.clicks}</td><td>${a.leads}</td><td>${a.cpl > 0 ? usd(a.cpl) : "—"}</td>
          </tr>`).join("\n          ")}
        </tbody>
      </table>
    </div>

    <!-- Daily Breakdown -->
    <div class="section">
      <h3>Daily Breakdown</h3>
      <table>
        <thead><tr><th>Date</th><th>Spend</th><th>Impressions</th><th>Clicks</th><th>Leads</th></tr></thead>
        <tbody>
          ${metaSnapshot.daily.map(d => `<tr>
            <td>${d.date}</td><td>${usd(d.spend)}</td><td>${d.impressions.toLocaleString()}</td>
            <td>${d.clicks}</td><td>${d.leads}</td>
          </tr>`).join("\n          ")}
        </tbody>
      </table>
    </div>
  </div>`;
  })() : ""}
</div>

<script>
// ── Historical data (embedded at build time) ──
const ALL_HISTORY = ${JSON.stringify(
  Object.fromEntries(
    clientTabs.map(s => [s.meta.clientId, (allHistory[s.meta.clientId] || []).map(h => ({
      weekOf: h.meta.weekOf,
      spend: h.summary.thisWeek.spend,
      leads: h.summary.thisWeek.conversions,
      cpl: h.summary.thisWeek.cpl,
      ctr: h.summary.thisWeek.ctr,
      cpc: h.summary.thisWeek.cpc,
      health: h.health.score,
    }))])
  )
)};

const META_HISTORY = ${JSON.stringify(metaHistory.map(h => ({
  weekOf: h.meta.weekOf,
  spend: h.summary.thisWeek.spend,
  leads: h.summary.thisWeek.leads,
  cpl: h.summary.thisWeek.cpl,
  ctr: h.summary.thisWeek.ctr,
  cpc: h.summary.thisWeek.cpc,
})))};

// ── Chart instances ──
const charts = {};

function destroyCharts() {
  for (const [id, chart] of Object.entries(charts)) {
    chart.destroy();
    delete charts[id];
  }
}

function buildCharts(weekCount) {
  destroyCharts();

  // Google Ads client charts
  ${clientTabs.map(snap => {
    return `(function() {
    const el = document.getElementById('chart-${snap.meta.clientId}');
    if (!el) return;
    const hist = (ALL_HISTORY['${snap.meta.clientId}'] || []).slice(-weekCount);
    const ctx = el.getContext('2d');
    charts['${snap.meta.clientId}'] = new Chart(ctx, {
      type: 'line',
      data: {
        labels: hist.map(h => h.weekOf),
        datasets: [
          { label: 'Leads', data: hist.map(h => h.leads), borderColor: '#4caf50', backgroundColor: 'rgba(76,175,80,0.1)', fill: true, tension: 0.3, yAxisID: 'y' },
          { label: 'CPL', data: hist.map(h => h.cpl), borderColor: '#E67E22', borderDash: [5,5], fill: false, tension: 0.3, yAxisID: 'y1' },
          { label: 'Health', data: hist.map(h => h.health), borderColor: '#2E75B6', borderDash: [2,2], fill: false, tension: 0.3, yAxisID: 'y2', hidden: true },
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { intersect: false, mode: 'index' },
        plugins: { legend: { position: 'bottom', labels: { color: '#7a8a9e' } } },
        scales: {
          x: { ticks: { color: '#546778' }, grid: { color: '#1e2d3d' } },
          y: { beginAtZero: true, title: { display: true, text: 'Leads', color: '#7a8a9e' }, position: 'left', ticks: { color: '#546778' }, grid: { color: '#1e2d3d' } },
          y1: { beginAtZero: true, title: { display: true, text: 'CPL ($)', color: '#7a8a9e' }, position: 'right', ticks: { color: '#546778' }, grid: { drawOnChartArea: false } },
          y2: { display: false, min: 0, max: 100 },
        }
      }
    });
  })();`;
  }).join("\n  ")}

  // Meta chart
  ${hasMeta ? `(function() {
    const el = document.getElementById('chart-meta');
    if (!el) return;
    const hist = META_HISTORY.slice(-weekCount);
    const ctx = el.getContext('2d');
    charts['meta'] = new Chart(ctx, {
      type: 'line',
      data: {
        labels: hist.map(h => h.weekOf),
        datasets: [
          { label: 'Leads', data: hist.map(h => h.leads), borderColor: '#1877F2', backgroundColor: 'rgba(24,119,242,0.1)', fill: true, tension: 0.3, yAxisID: 'y' },
          { label: 'CPL', data: hist.map(h => h.cpl), borderColor: '#E67E22', borderDash: [5,5], fill: false, tension: 0.3, yAxisID: 'y1' },
          { label: 'Spend', data: hist.map(h => h.spend), borderColor: '#4caf50', borderDash: [2,2], fill: false, tension: 0.3, yAxisID: 'y1', hidden: true },
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { intersect: false, mode: 'index' },
        plugins: { legend: { position: 'bottom', labels: { color: '#7a8a9e' } } },
        scales: {
          x: { ticks: { color: '#546778' }, grid: { color: '#1e2d3d' } },
          y: { beginAtZero: true, title: { display: true, text: 'Leads', color: '#7a8a9e' }, position: 'left', ticks: { color: '#546778' }, grid: { color: '#1e2d3d' } },
          y1: { beginAtZero: true, title: { display: true, text: '$ Amount', color: '#7a8a9e' }, position: 'right', ticks: { color: '#546778' }, grid: { drawOnChartArea: false } },
        }
      }
    });
  })();` : ""}
}

function onRangeChange() {
  const sel = document.getElementById('dateRangeSelect');
  const customEl = document.getElementById('customRange');
  const rangeInfo = document.getElementById('rangeInfo');

  if (sel.value === 'custom') {
    customEl.classList.add('visible');
    return;
  }
  customEl.classList.remove('visible');

  const weeks = parseInt(sel.value);
  buildCharts(weeks);

  if (weeks === 1) {
    rangeInfo.style.display = 'none';
  } else {
    rangeInfo.style.display = 'flex';
    document.getElementById('rangeInfoText').textContent = 'Showing trend data for the last ' + weeks + ' weeks. Scorecards show the most recent week.';
  }
}

function onCustomRangeChange() {
  const start = document.getElementById('customStart').value;
  const end = document.getElementById('customEnd').value;
  if (!start || !end) return;

  // Filter history to matching date range
  const allWeeks = Object.values(ALL_HISTORY)[0]?.map(h => h.weekOf) || META_HISTORY.map(h => h.weekOf);
  const filtered = allWeeks.filter(w => w >= start && w <= end);
  const weekCount = filtered.length || 1;
  buildCharts(weekCount);

  const rangeInfo = document.getElementById('rangeInfo');
  rangeInfo.style.display = 'flex';
  document.getElementById('rangeInfoText').textContent = 'Showing ' + weekCount + ' week(s) from ' + start + ' to ' + end + '. Scorecards show the most recent week.';
}

function showPanel(id) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById('panel-' + id).classList.add('active');
  event.target.closest('.tab').classList.add('active');
}

// Initial render
buildCharts(4);
</script>
</body>
</html>`;
}

// ─────────────────────────────────────────────
// LANDING PAGE (index)
// ─────────────────────────────────────────────
function buildIndex() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>LocalEyes Pro Reports</title>
<style>
  body { font-family: -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #f5f7fa; color: #333; }
  .box { text-align: center; }
  h1 { font-size: 20px; color: #1F3864; }
  p { color: #666; margin-top: 8px; font-size: 14px; }
</style>
</head>
<body>
<div class="box">
  <h1>LocalEyes Pro</h1>
  <p>Report dashboards are accessed via direct link.</p>
</div>
</body>
</html>`;
}

// ─────────────────────────────────────────────
// MAIN BUILD
// ─────────────────────────────────────────────
function main() {
  console.log("\nLocalEyes Reports — Dashboard Builder\n");

  // Read combined data
  const allPath = path.join(ROOT, "data", "latest-all.json");
  if (!fs.existsSync(allPath)) {
    console.error("No data found. Run 'npm run pull' first.");
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(allPath, "utf-8"));

  // Support both old format (array) and new format ({ googleAds: [...], meta: {...} })
  const allSnapshots = Array.isArray(raw) ? raw : (raw.googleAds || []);
  const metaSnapshot = Array.isArray(raw) ? null : (raw.meta || null);

  // Build index
  fs.writeFileSync(path.join(PUBLIC, "index.html"), buildIndex());
  console.log("  Built: public/index.html");

  // Build client dashboards
  for (const clientConfig of CONFIG.clients) {
    const snap = allSnapshots.find(s => s.meta.clientId === clientConfig.id);
    if (!snap || snap.meta.error) {
      console.log(`  Skipped: ${clientConfig.name} (no data or error)`);
      continue;
    }
    const dir = path.join(PUBLIC, "c", clientConfig.slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "index.html"), buildClientDashboard(clientConfig, snap));
    console.log(`  Built: public/c/${clientConfig.slug}/index.html`);
  }

  // Build internal dashboard
  fs.mkdirSync(path.join(PUBLIC, "internal"), { recursive: true });
  fs.writeFileSync(path.join(PUBLIC, "internal", "index.html"), buildInternalDashboard(allSnapshots, metaSnapshot));
  console.log("  Built: public/internal/index.html");
  if (metaSnapshot) {
    console.log("  ↳ Meta Ads tab included");
  }

  console.log("\nDone. Run 'npm run dev' to preview locally.\n");
}

main();
