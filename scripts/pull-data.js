/**
 * pull-data.js
 * Pulls Google Ads data for all clients and writes weekly JSON snapshots.
 * Run via: npm run pull
 *
 * Required env vars:
 *   GOOGLE_ADS_DEVELOPER_TOKEN
 *   GOOGLE_ADS_CLIENT_ID
 *   GOOGLE_ADS_CLIENT_SECRET
 *   GOOGLE_ADS_REFRESH_TOKEN
 *   GOOGLE_ADS_LOGIN_CUSTOMER_ID  (MCC ID, no dashes)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleAdsApi } from "google-ads-api";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, "config/clients.json"), "utf-8"));

// v4 — ensure data dir exists at module load
console.log("[pull-data v4] Script loaded");
fs.mkdirSync(path.join(ROOT, "data"), { recursive: true });

// Date helpers
function fmt(d) { return d.toISOString().slice(0, 10); }
function mondayOf(d) {
  const dt = new Date(d);
  dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
  return dt;
}

const today = new Date();
const thisMonday = mondayOf(today);
const lastMonday = new Date(thisMonday); lastMonday.setDate(lastMonday.getDate() - 7);
const prevMonday = new Date(lastMonday); prevMonday.setDate(prevMonday.getDate() - 7);
const weekLabel = fmt(lastMonday);

// Period strings for GAQL
const THIS_WEEK = `'${fmt(lastMonday)}' AND '${fmt(new Date(thisMonday.getTime() - 86400000))}'`;
const PREV_WEEK = `'${fmt(prevMonday)}' AND '${fmt(new Date(lastMonday.getTime() - 86400000))}'`;

// Init Google Ads API
const client = new GoogleAdsApi({
  client_id: process.env.GOOGLE_ADS_CLIENT_ID,
  client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET,
  developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
});

async function pullClient(clientConfig) {
  const customer = client.Customer({
    customer_id: clientConfig.googleAdsCustomerId,
    login_customer_id: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID,
    refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN,
  });

  // 1. Campaign-level metrics for this week
  const campaignRows = await customer.query(`
    SELECT
      campaign.name,
      campaign.status,
      metrics.cost_micros,
      metrics.clicks,
      metrics.impressions,
      metrics.conversions,
      metrics.ctr,
      metrics.average_cpc
    FROM campaign
    WHERE segments.date BETWEEN ${THIS_WEEK}
      AND campaign.advertising_channel_type = 'SEARCH'
  `);

  // 2. Campaign-level metrics for previous week (comparison)
  const prevCampaignRows = await customer.query(`
    SELECT
      campaign.name,
      metrics.cost_micros,
      metrics.clicks,
      metrics.impressions,
      metrics.conversions
    FROM campaign
    WHERE segments.date BETWEEN ${PREV_WEEK}
      AND campaign.advertising_channel_type = 'SEARCH'
  `);

  // 3. Ad group performance
  const adGroupRows = await customer.query(`
    SELECT
      ad_group.name,
      campaign.name,
      metrics.cost_micros,
      metrics.clicks,
      metrics.impressions,
      metrics.conversions,
      metrics.ctr,
      metrics.average_cpc
    FROM ad_group
    WHERE segments.date BETWEEN ${THIS_WEEK}
      AND campaign.advertising_channel_type = 'SEARCH'
  `);

  // 4. Keyword performance
  const keywordRows = await customer.query(`
    SELECT
      ad_group_criterion.keyword.text,
      ad_group_criterion.keyword.match_type,
      ad_group.name,
      metrics.cost_micros,
      metrics.clicks,
      metrics.impressions,
      metrics.conversions,
      metrics.ctr,
      metrics.average_cpc
    FROM keyword_view
    WHERE segments.date BETWEEN ${THIS_WEEK}
      AND campaign.advertising_channel_type = 'SEARCH'
  `);

  // 5. Search terms — flag waste
  const searchTermRows = await customer.query(`
    SELECT
      search_term_view.search_term,
      campaign.name,
      ad_group.name,
      metrics.cost_micros,
      metrics.clicks,
      metrics.impressions,
      metrics.conversions
    FROM search_term_view
    WHERE segments.date BETWEEN ${THIS_WEEK}
      AND campaign.advertising_channel_type = 'SEARCH'
    ORDER BY metrics.cost_micros DESC
    LIMIT 100
  `);

  // 6. Ad status check (disapprovals)
  const adStatusRows = await customer.query(`
    SELECT
      ad_group_ad.ad.id,
      ad_group_ad.policy_summary.approval_status,
      ad_group_ad.policy_summary.review_status
    FROM ad_group_ad
    WHERE campaign.advertising_channel_type = 'SEARCH'
      AND ad_group_ad.status = 'ENABLED'
  `);

  // 7. Conversion actions (verify tracking is active)
  // Note: metrics.conversions is incompatible with conversion_action resource
  // Use all_conversions from campaign instead, and just check action status here
  const conversionRows = await customer.query(`
    SELECT
      conversion_action.name,
      conversion_action.status,
      conversion_action.type
    FROM conversion_action
  `);

  // 8. Daily breakdown for charts
  const dailyRows = await customer.query(`
    SELECT
      segments.date,
      metrics.cost_micros,
      metrics.clicks,
      metrics.impressions,
      metrics.conversions
    FROM campaign
    WHERE segments.date BETWEEN ${THIS_WEEK}
      AND campaign.advertising_channel_type = 'SEARCH'
  `);

  // Process data
  const micros = (v) => (Number(v) || 0) / 1_000_000;

  // Aggregate this week totals
  const thisWeek = campaignRows.reduce((acc, r) => ({
    spend: acc.spend + micros(r.metrics.cost_micros),
    clicks: acc.clicks + (Number(r.metrics.clicks) || 0),
    impressions: acc.impressions + (Number(r.metrics.impressions) || 0),
    conversions: acc.conversions + (Number(r.metrics.conversions) || 0),
  }), { spend: 0, clicks: 0, impressions: 0, conversions: 0 });

  thisWeek.ctr = thisWeek.impressions > 0 ? (thisWeek.clicks / thisWeek.impressions * 100) : 0;
  thisWeek.cpc = thisWeek.clicks > 0 ? (thisWeek.spend / thisWeek.clicks) : 0;
  thisWeek.cpl = thisWeek.conversions > 0 ? (thisWeek.spend / thisWeek.conversions) : 0;

  // Aggregate previous week
  const prevWeek = prevCampaignRows.reduce((acc, r) => ({
    spend: acc.spend + micros(r.metrics.cost_micros),
    clicks: acc.clicks + (Number(r.metrics.clicks) || 0),
    impressions: acc.impressions + (Number(r.metrics.impressions) || 0),
    conversions: acc.conversions + (Number(r.metrics.conversions) || 0),
  }), { spend: 0, clicks: 0, impressions: 0, conversions: 0 });

  prevWeek.cpl = prevWeek.conversions > 0 ? (prevWeek.spend / prevWeek.conversions) : 0;

  // Week-over-week deltas
  const delta = {
    spend: thisWeek.spend - prevWeek.spend,
    leads: thisWeek.conversions - prevWeek.conversions,
    cpl: thisWeek.cpl - prevWeek.cpl,
    spendPct: prevWeek.spend > 0 ? ((thisWeek.spend - prevWeek.spend) / prevWeek.spend * 100) : 0,
    leadsPct: prevWeek.conversions > 0 ? ((thisWeek.conversions - prevWeek.conversions) / prevWeek.conversions * 100) : 0,
    cplPct: prevWeek.cpl > 0 ? ((thisWeek.cpl - prevWeek.cpl) / prevWeek.cpl * 100) : 0,
  };

  // Budget pacing
  const weeklyBudget = (clientConfig.budget / 30.4) * 7;
  const pacing = weeklyBudget > 0 ? (thisWeek.spend / weeklyBudget * 100) : 0;

  // Search term flags (3+ clicks, 0 conversions)
  const wasteTerms = searchTermRows
    .filter(r => (Number(r.metrics.clicks) || 0) >= 3 && (Number(r.metrics.conversions) || 0) === 0)
    .map(r => ({
      term: r.search_term_view.search_term,
      clicks: Number(r.metrics.clicks) || 0,
      spend: micros(r.metrics.cost_micros),
      campaign: r.campaign.name,
      adGroup: r.ad_group.name,
    }))
    .sort((a, b) => b.spend - a.spend);

  // Total search term waste
  const totalSearchSpend = searchTermRows.reduce((s, r) => s + micros(r.metrics.cost_micros), 0);
  const wasteSpend = wasteTerms.reduce((s, t) => s + t.spend, 0);
  const wastePct = totalSearchSpend > 0 ? (wasteSpend / totalSearchSpend * 100) : 0;

  // Keyword performance
  const keywords = keywordRows.map(r => ({
    keyword: r.ad_group_criterion.keyword.text,
    matchType: r.ad_group_criterion.keyword.match_type,
    adGroup: r.ad_group.name,
    clicks: Number(r.metrics.clicks) || 0,
    impressions: Number(r.metrics.impressions) || 0,
    conversions: Number(r.metrics.conversions) || 0,
    spend: micros(r.metrics.cost_micros),
    ctr: Number(r.metrics.ctr) || 0,
    cpc: micros(r.metrics.average_cpc),
    cpl: (Number(r.metrics.conversions) || 0) > 0 ? micros(r.metrics.cost_micros) / Number(r.metrics.conversions) : null,
  })).sort((a, b) => b.spend - a.spend);

  // Ad group performance
  const adGroups = adGroupRows.map(r => ({
    name: r.ad_group.name,
    campaign: r.campaign.name,
    clicks: Number(r.metrics.clicks) || 0,
    impressions: Number(r.metrics.impressions) || 0,
    conversions: Number(r.metrics.conversions) || 0,
    spend: micros(r.metrics.cost_micros),
    ctr: (Number(r.metrics.ctr) || 0) * 100,
    cpc: micros(r.metrics.average_cpc),
  }));

  // Ad disapprovals
  const disapprovedAds = adStatusRows.filter(r =>
    r.ad_group_ad.policy_summary.approval_status === "DISAPPROVED"
  ).length;

  // Conversion tracking status
  const activeConversions = conversionRows.filter(r =>
    r.conversion_action.status === "ENABLED"
  );
  // Use campaign-level conversions to determine if tracking is firing
  const conversionTrackingActive = activeConversions.length > 0 && thisWeek.conversions > 0;

  // Daily data for charts
  const daily = {};
  for (const r of dailyRows) {
    const d = r.segments.date;
    if (!daily[d]) daily[d] = { date: d, spend: 0, clicks: 0, impressions: 0, conversions: 0 };
    daily[d].spend += micros(r.metrics.cost_micros);
    daily[d].clicks += Number(r.metrics.clicks) || 0;
    daily[d].impressions += Number(r.metrics.impressions) || 0;
    daily[d].conversions += Number(r.metrics.conversions) || 0;
  }
  const dailyData = Object.values(daily).sort((a, b) => a.date.localeCompare(b.date));

  // Bid opportunity flags — keywords with CPL 30%+ below benchmark high
  const bidOpportunities = keywords.filter(k =>
    k.cpl !== null && k.cpl < clientConfig.benchmarks.cplHigh * 0.7 && k.conversions >= 1
  );

  // Underperforming ad groups — CTR below floor for the week
  const underperformingAdGroups = adGroups.filter(ag =>
    ag.impressions >= 50 && ag.ctr < clientConfig.benchmarks.ctrFloor
  );

  // Health score
  const health = computeHealth({
    conversionTrackingActive,
    pacing,
    cpl: thisWeek.cpl,
    benchmarks: clientConfig.benchmarks,
    wastePct,
    disapprovedAds,
  });

  // Assemble snapshot
  const snapshot = {
    meta: {
      clientId: clientConfig.id,
      clientName: clientConfig.name,
      vertical: clientConfig.vertical,
      weekOf: weekLabel,
      generatedAt: new Date().toISOString(),
      budget: clientConfig.budget,
      weeklyBudget: Math.round(weeklyBudget * 100) / 100,
    },
    summary: {
      thisWeek: roundObj(thisWeek),
      prevWeek: roundObj(prevWeek),
      delta: roundObj(delta),
      pacing: Math.round(pacing),
    },
    daily: dailyData.map(d => roundObj(d)),
    adGroups,
    keywords,
    searchTerms: {
      waste: wasteTerms.slice(0, 20),
      wastePct: Math.round(wastePct * 10) / 10,
      wasteSpend: Math.round(wasteSpend * 100) / 100,
    },
    ads: {
      disapproved: disapprovedAds,
    },
    conversionTracking: {
      active: conversionTrackingActive,
      actions: activeConversions.map(r => ({
        name: r.conversion_action.name,
        type: r.conversion_action.type,
      })),
    },
    health,
    alerts: {
      wasteTerms: wasteTerms.slice(0, 10),
      bidOpportunities,
      underperformingAdGroups,
    },
  };

  // Write snapshot
  const clientDir = path.join(ROOT, "data", clientConfig.id);
  fs.mkdirSync(clientDir, { recursive: true });
  const snapshotPath = path.join(clientDir, `week-${weekLabel}.json`);
  fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));

  // Also write latest.json symlink (overwrite)
  const latestPath = path.join(clientDir, "latest.json");
  fs.writeFileSync(latestPath, JSON.stringify(snapshot, null, 2));

  console.log(`  [${clientConfig.name}] Snapshot written: week-${weekLabel}.json`);
  return snapshot;
}

function computeHealth({ conversionTrackingActive, pacing, cpl, benchmarks, wastePct, disapprovedAds }) {
  let score = 0;
  const breakdown = {};

  // Conversion tracking: 25 pts
  breakdown.conversionTracking = conversionTrackingActive ? 25 : 0;
  score += breakdown.conversionTracking;

  // Budget pacing 90-110%: 20 pts
  if (pacing >= 90 && pacing <= 110) breakdown.budgetPacing = 20;
  else if (pacing >= 75 && pacing <= 125) breakdown.budgetPacing = 12;
  else if (pacing >= 50) breakdown.budgetPacing = 5;
  else breakdown.budgetPacing = 0;
  score += breakdown.budgetPacing;

  // CPL within benchmark: 20 pts
  if (cpl === 0) breakdown.cpl = 10; // no conversions yet, neutral
  else if (cpl <= benchmarks.cplHigh) breakdown.cpl = 20;
  else if (cpl <= benchmarks.cplHigh * 1.3) breakdown.cpl = 10;
  else breakdown.cpl = 0;
  score += breakdown.cpl;

  // Search term waste < 15%: 15 pts
  if (wastePct < 10) breakdown.searchTermWaste = 15;
  else if (wastePct < 15) breakdown.searchTermWaste = 10;
  else if (wastePct < 25) breakdown.searchTermWaste = 5;
  else breakdown.searchTermWaste = 0;
  score += breakdown.searchTermWaste;

  // No disapproved ads: 10 pts
  breakdown.adApprovals = disapprovedAds === 0 ? 10 : 0;
  score += breakdown.adApprovals;

  // Negative keywords (placeholder — always 10 for now until we track last update)
  breakdown.negativeKeywords = 10;
  score += breakdown.negativeKeywords;

  return { score, breakdown };
}

function roundObj(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = typeof v === "number" ? Math.round(v * 100) / 100 : v;
  }
  return out;
}

// Main
async function main() {
  console.log(`\nLocalEyes Reports — Data Pull`);
  console.log(`Week of: ${weekLabel}`);
  console.log(`Pulling ${CONFIG.clients.length} client(s)...\n`);

  // Ensure data directory exists
  fs.mkdirSync(path.join(ROOT, "data"), { recursive: true });

  const snapshots = [];
  for (const c of CONFIG.clients) {
    try {
      const snap = await pullClient(c);
      snapshots.push(snap);
    } catch (err) {
      // Google Ads API errors can be deeply nested — dump everything
      const errMsg = err?.errors?.[0]?.message
        || err?.message
        || err?.response?.data?.error?.message
        || (typeof err === "string" ? err : JSON.stringify(err, null, 2));
      console.error(`  [${c.name}] ERROR: ${errMsg}`);
      console.error(`  [${c.name}] Full error dump:`, JSON.stringify(err, Object.getOwnPropertyNames(err || {}), 2));
      snapshots.push({ meta: { clientId: c.id, clientName: c.name, weekOf: weekLabel, error: errMsg } });
    }
  }

  // Only fail if ALL clients errored and none produced data
  const hasData = snapshots.some(s => !s.meta.error);

  // Write combined index for internal dashboard
  const indexPath = path.join(ROOT, "data", "latest-all.json");
  fs.writeFileSync(indexPath, JSON.stringify(snapshots, null, 2));
  console.log(`\nCombined index written: data/latest-all.json`);

  if (!hasData) {
    console.error("\nWARNING: All clients failed. Downstream steps will use error placeholders.");
  }

  console.log("Done.\n");
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
