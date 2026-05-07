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

// v5 — Meta Ads support + ensure data dir exists at module load
console.log("[pull-data v5] Script loaded");
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

// ─────────────────────────────────────────────
// META ADS — LocalEyes Pro Lead Gen Account
// ─────────────────────────────────────────────
async function pullMetaAccount() {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) {
    console.log("  [Meta] META_ACCESS_TOKEN not set — skipping Meta pull");
    return null;
  }

  const accountId = CONFIG.meta?.accountId;
  if (!accountId) {
    console.log("  [Meta] No meta.accountId in config — skipping");
    return null;
  }

  const API = "https://graph.facebook.com/v21.0";
  const actId = `act_${accountId}`;

  async function metaGet(endpoint, params = {}) {
    const url = new URL(`${API}/${endpoint}`);
    url.searchParams.set("access_token", token);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, typeof v === "object" ? JSON.stringify(v) : v);
    }
    const res = await fetch(url.toString());
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Meta API ${res.status}: ${body}`);
    }
    return res.json();
  }

  // Date ranges matching Google Ads (last full Mon-Sun week)
  const thisStart = fmt(lastMonday);
  const thisEnd = fmt(new Date(thisMonday.getTime() - 86400000));
  const prevStart = fmt(prevMonday);
  const prevEnd = fmt(new Date(lastMonday.getTime() - 86400000));

  // 1. Account-level insights — this week
  const thisWeekData = await metaGet(`${actId}/insights`, {
    time_range: { since: thisStart, until: thisEnd },
    fields: "spend,impressions,clicks,ctr,cpc,actions,cost_per_action_type",
    level: "account",
  });

  // 2. Account-level insights — prev week
  const prevWeekData = await metaGet(`${actId}/insights`, {
    time_range: { since: prevStart, until: prevEnd },
    fields: "spend,impressions,clicks,ctr,cpc,actions,cost_per_action_type",
    level: "account",
  });

  // 3. Campaign breakdown — this week
  const campaignData = await metaGet(`${actId}/insights`, {
    time_range: { since: thisStart, until: thisEnd },
    fields: "campaign_name,campaign_id,spend,impressions,clicks,actions,cost_per_action_type",
    level: "campaign",
    limit: 50,
  });

  // 4. Ad set breakdown — this week
  const adsetData = await metaGet(`${actId}/insights`, {
    time_range: { since: thisStart, until: thisEnd },
    fields: "adset_name,adset_id,campaign_name,spend,impressions,clicks,actions,cost_per_action_type",
    level: "adset",
    limit: 50,
  });

  // 5. Ad breakdown — this week
  const adData = await metaGet(`${actId}/insights`, {
    time_range: { since: thisStart, until: thisEnd },
    fields: "ad_name,ad_id,adset_name,campaign_name,spend,impressions,clicks,actions,cost_per_action_type",
    level: "ad",
    limit: 50,
  });

  // 6. Daily breakdown — this week
  const dailyData = await metaGet(`${actId}/insights`, {
    time_range: { since: thisStart, until: thisEnd },
    fields: "spend,impressions,clicks,actions",
    time_increment: 1,
    level: "account",
  });

  // Helper: extract leads from actions array
  function getLeads(actions) {
    if (!actions) return 0;
    const lead = actions.find(a =>
      a.action_type === "lead" || a.action_type === "onsite_conversion.lead_grouped"
    );
    return lead ? Number(lead.value) || 0 : 0;
  }

  function getCPL(costPerAction) {
    if (!costPerAction) return 0;
    const lead = costPerAction.find(a =>
      a.action_type === "lead" || a.action_type === "onsite_conversion.lead_grouped"
    );
    return lead ? Number(lead.value) || 0 : 0;
  }

  // Process this week
  const tw = thisWeekData.data?.[0] || {};
  const thisWeek = {
    spend: Number(tw.spend) || 0,
    impressions: Number(tw.impressions) || 0,
    clicks: Number(tw.clicks) || 0,
    ctr: Number(tw.ctr) || 0,
    cpc: Number(tw.cpc) || 0,
    leads: getLeads(tw.actions),
    cpl: getCPL(tw.cost_per_action_type),
  };

  // Process prev week
  const pw = prevWeekData.data?.[0] || {};
  const prevWeekMeta = {
    spend: Number(pw.spend) || 0,
    impressions: Number(pw.impressions) || 0,
    clicks: Number(pw.clicks) || 0,
    leads: getLeads(pw.actions),
    cpl: getCPL(pw.cost_per_action_type),
  };

  // Deltas
  const delta = {
    spend: thisWeek.spend - prevWeekMeta.spend,
    leads: thisWeek.leads - prevWeekMeta.leads,
    cpl: thisWeek.cpl - prevWeekMeta.cpl,
    spendPct: prevWeekMeta.spend > 0 ? ((thisWeek.spend - prevWeekMeta.spend) / prevWeekMeta.spend * 100) : 0,
    leadsPct: prevWeekMeta.leads > 0 ? ((thisWeek.leads - prevWeekMeta.leads) / prevWeekMeta.leads * 100) : 0,
    cplPct: prevWeekMeta.cpl > 0 ? ((thisWeek.cpl - prevWeekMeta.cpl) / prevWeekMeta.cpl * 100) : 0,
  };

  // Budget pacing
  const metaBudget = CONFIG.meta.budget || 0;
  const weeklyBudget = (metaBudget / 30.4) * 7;
  const pacing = weeklyBudget > 0 ? (thisWeek.spend / weeklyBudget * 100) : 0;

  // Campaign performance
  const campaigns = (campaignData.data || []).map(c => ({
    name: c.campaign_name,
    id: c.campaign_id,
    spend: Number(c.spend) || 0,
    impressions: Number(c.impressions) || 0,
    clicks: Number(c.clicks) || 0,
    leads: getLeads(c.actions),
    cpl: getCPL(c.cost_per_action_type),
  }));

  // Ad set performance
  const adsets = (adsetData.data || []).map(a => ({
    name: a.adset_name,
    id: a.adset_id,
    campaign: a.campaign_name,
    spend: Number(a.spend) || 0,
    impressions: Number(a.impressions) || 0,
    clicks: Number(a.clicks) || 0,
    leads: getLeads(a.actions),
    cpl: getCPL(a.cost_per_action_type),
  }));

  // Ad performance
  const ads = (adData.data || []).map(a => ({
    name: a.ad_name,
    id: a.ad_id,
    adset: a.adset_name,
    campaign: a.campaign_name,
    spend: Number(a.spend) || 0,
    impressions: Number(a.impressions) || 0,
    clicks: Number(a.clicks) || 0,
    leads: getLeads(a.actions),
    cpl: getCPL(a.cost_per_action_type),
  }));

  // Daily data
  const daily = (dailyData.data || []).map(d => ({
    date: d.date_start,
    spend: Number(d.spend) || 0,
    impressions: Number(d.impressions) || 0,
    clicks: Number(d.clicks) || 0,
    leads: getLeads(d.actions),
  }));

  const snapshot = {
    meta: {
      platform: "meta",
      accountId,
      accountName: "LocalEyes Pro — Lead Gen",
      weekOf: weekLabel,
      generatedAt: new Date().toISOString(),
      budget: metaBudget,
      weeklyBudget: Math.round(weeklyBudget * 100) / 100,
    },
    summary: {
      thisWeek: roundObj(thisWeek),
      prevWeek: roundObj(prevWeekMeta),
      delta: roundObj(delta),
      pacing: Math.round(pacing),
    },
    daily,
    campaigns,
    adsets,
    ads,
  };

  // Write snapshot
  const metaDir = path.join(ROOT, "data", "meta-localeyespro");
  fs.mkdirSync(metaDir, { recursive: true });
  fs.writeFileSync(path.join(metaDir, `week-${weekLabel}.json`), JSON.stringify(snapshot, null, 2));
  fs.writeFileSync(path.join(metaDir, "latest.json"), JSON.stringify(snapshot, null, 2));
  console.log(`  [LocalEyes Meta] Snapshot written: week-${weekLabel}.json`);

  return snapshot;
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

  // Pull Meta Ads data
  let metaSnapshot = null;
  try {
    metaSnapshot = await pullMetaAccount();
  } catch (err) {
    const errMsg = err?.message || JSON.stringify(err, Object.getOwnPropertyNames(err || {}), 2);
    console.error(`  [Meta] ERROR: ${errMsg}`);
  }

  // Only fail if ALL clients errored and none produced data
  const hasData = snapshots.some(s => !s.meta.error);

  // Write combined index for internal dashboard (includes Meta if available)
  const combined = { googleAds: snapshots, meta: metaSnapshot };
  const indexPath = path.join(ROOT, "data", "latest-all.json");
  fs.writeFileSync(indexPath, JSON.stringify(combined, null, 2));
  console.log(`\nCombined index written: data/latest-all.json`);

  if (!hasData && !metaSnapshot) {
    console.error("\nWARNING: All clients failed. Downstream steps will use error placeholders.");
  }

  console.log("Done.\n");
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
