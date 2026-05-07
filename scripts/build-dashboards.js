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

// Load historical data for trend charts (last 8 weeks)
function loadHistory(clientId) {
  const dir = path.join(ROOT, "data", clientId);
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir)
    .filter(f => f.startsWith("week-") && f.endsWith(".json"))
    .sort()
    .slice(-8);
  return files.map(f => JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")));
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
function buildInternalDashboard(allSnapshots) {
  const clientTabs = allSnapshots.filter(s => !s.meta.error);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>LocalEyes Pro — Internal Dashboard</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f1923; color: #e0e0e0; line-height: 1.5; }
  .container { max-width: 1100px; margin: 0 auto; padding: 20px; }

  .header { display: flex; justify-content: space-between; align-items: center; padding: 20px 0; border-bottom: 1px solid #1e2d3d; margin-bottom: 24px; }
  .header h1 { font-size: 22px; color: #fff; }
  .header .date { color: #7a8a9e; font-size: 14px; }

  .tabs { display: flex; gap: 8px; margin-bottom: 24px; flex-wrap: wrap; }
  .tab { padding: 8px 20px; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 500; background: #1a2733; color: #7a8a9e; border: 1px solid #1e2d3d; transition: all 0.2s; }
  .tab:hover { background: #1e2d3d; color: #fff; }
  .tab.active { background: #2E75B6; color: #fff; border-color: #2E75B6; }

  .panel { display: none; }
  .panel.active { display: block; }

  .overview-grid { display: grid; grid-template-columns: 1fr; gap: 12px; margin-bottom: 24px; }
  .overview-row { display: grid; grid-template-columns: 2fr repeat(5, 1fr) 80px; gap: 0; background: #1a2733; border-radius: 8px; padding: 16px 20px; align-items: center; }
  .overview-row.header-row { background: transparent; padding: 8px 20px; color: #546778; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
  .overview-row .client-name { font-weight: 600; color: #fff; }
  .overview-row .metric { text-align: right; font-size: 14px; }
  .overview-row .health { text-align: center; font-size: 14px; font-weight: 600; }

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

  .health-bar { display: flex; gap: 4px; margin-top: 16px; }
  .health-segment { height: 8px; border-radius: 4px; }

  .alert-item { padding: 10px 14px; background: #141e28; border-radius: 6px; margin-bottom: 8px; font-size: 13px; border-left: 3px solid #E67E22; }
  .alert-item.critical { border-left-color: #ef5350; }
  .alert-item.good { border-left-color: #4caf50; }

  @media (max-width: 768px) {
    .overview-row { grid-template-columns: 1fr 1fr; gap: 8px; }
    .overview-row.header-row { display: none; }
    .detail-grid { grid-template-columns: repeat(2, 1fr); }
  }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>LocalEyes Pro &mdash; Agency Dashboard</h1>
    <div class="date">${allSnapshots[0]?.meta?.weekOf ? "Week of " + allSnapshots[0].meta.weekOf : ""}</div>
  </div>

  <div class="tabs">
    <div class="tab active" onclick="showPanel('overview')">Overview</div>
    ${clientTabs.map(s => `<div class="tab" onclick="showPanel('${s.meta.clientId}')">${s.meta.clientName}</div>`).join("\n    ")}
  </div>

  <!-- OVERVIEW PANEL -->
  <div class="panel active" id="panel-overview">
    <div class="overview-grid">
      <div class="overview-row header-row">
        <div>Client</div><div class="metric">Spend</div><div class="metric">Pacing</div><div class="metric">Leads</div><div class="metric">CPL</div><div class="metric">Trend</div><div class="health">Health</div>
      </div>
      ${clientTabs.map(s => {
        const sm = s.summary;
        return `<div class="overview-row">
        <div class="client-name">${s.meta.clientName}</div>
        <div class="metric">${usd(sm.thisWeek.spend)}</div>
        <div class="metric">${sm.pacing}%</div>
        <div class="metric">${sm.thisWeek.conversions}</div>
        <div class="metric">${sm.thisWeek.cpl > 0 ? usd(sm.thisWeek.cpl) : "N/A"}</div>
        <div class="metric ${arrowClass(sm.delta.leadsPct)}">${arrow(sm.delta.leadsPct)} ${pctStr(sm.delta.leadsPct)}</div>
        <div class="health">${healthEmoji(s.health.score)} ${s.health.score}</div>
      </div>`;
      }).join("\n      ")}
    </div>

    <!-- Agency totals -->
    <div class="detail-grid">
      <div class="detail-card">
        <div class="label">Total Spend</div>
        <div class="value">${usd(clientTabs.reduce((s, c) => s + c.summary.thisWeek.spend, 0))}</div>
        <div class="sub">${clientTabs.length} active clients</div>
      </div>
      <div class="detail-card">
        <div class="label">Total Leads</div>
        <div class="value">${clientTabs.reduce((s, c) => s + c.summary.thisWeek.conversions, 0)}</div>
        <div class="sub">across all accounts</div>
      </div>
      <div class="detail-card">
        <div class="label">Avg CPL</div>
        <div class="value">${(() => {
          const totalSpend = clientTabs.reduce((s, c) => s + c.summary.thisWeek.spend, 0);
          const totalConv = clientTabs.reduce((s, c) => s + c.summary.thisWeek.conversions, 0);
          return totalConv > 0 ? usd(totalSpend / totalConv) : "N/A";
        })()}</div>
        <div class="sub">agency-wide</div>
      </div>
      <div class="detail-card">
        <div class="label">Avg Health</div>
        <div class="value">${Math.round(clientTabs.reduce((s, c) => s + c.health.score, 0) / (clientTabs.length || 1))}</div>
        <div class="sub">target: 85+</div>
      </div>
    </div>
  </div>

  <!-- CLIENT DETAIL PANELS -->
  ${clientTabs.map(snap => {
    const s = snap.summary;
    const history = loadHistory(snap.meta.clientId);
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
      <h3>8-Week Trends</h3>
      <div class="chart-container"><canvas id="chart-${snap.meta.clientId}"></canvas></div>
    </div>

    <!-- Alerts -->
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

    <!-- Top Keywords -->
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

    <script>
    (function() {
      const ctx = document.getElementById('chart-${snap.meta.clientId}').getContext('2d');
      new Chart(ctx, {
        type: 'line',
        data: {
          labels: ${JSON.stringify(hLabels)},
          datasets: [
            { label: 'Leads', data: ${JSON.stringify(hLeads)}, borderColor: '#4caf50', backgroundColor: 'rgba(76,175,80,0.1)', fill: true, tension: 0.3, yAxisID: 'y' },
            { label: 'CPL', data: ${JSON.stringify(hCPL)}, borderColor: '#E67E22', borderDash: [5,5], fill: false, tension: 0.3, yAxisID: 'y1' },
            { label: 'Health', data: ${JSON.stringify(hHealth)}, borderColor: '#2E75B6', borderDash: [2,2], fill: false, tension: 0.3, yAxisID: 'y2', hidden: true },
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
    })();
    </script>
  </div>`;
  }).join("\n  ")}
</div>

<script>
function showPanel(id) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById('panel-' + id).classList.add('active');
  event.target.classList.add('active');
}
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
  const allSnapshots = JSON.parse(fs.readFileSync(allPath, "utf-8"));

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
  fs.writeFileSync(path.join(PUBLIC, "internal", "index.html"), buildInternalDashboard(allSnapshots));
  console.log("  Built: public/internal/index.html");

  console.log("\nDone. Run 'npm run dev' to preview locally.\n");
}

main();
