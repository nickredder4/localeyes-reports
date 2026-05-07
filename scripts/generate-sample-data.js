/**
 * generate-sample-data.js
 * Creates 8 weeks of realistic sample data so you can preview dashboards
 * without connecting to the Google Ads API.
 *
 * Run: node scripts/generate-sample-data.js
 * Then: npm run build && npm run dev
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, "config/clients.json"), "utf-8"));

function fmt(d) { return d.toISOString().slice(0, 10); }
function rand(min, max) { return Math.round((Math.random() * (max - min) + min) * 100) / 100; }
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

const sampleSearchTerms = {
  "supreme-tree-experts": {
    good: ["tree removal near me", "tree service salt lake city", "emergency tree removal", "tree trimming cost", "tree cutting service"],
    waste: ["tree removal cost estimator", "free tree removal programs", "tree service jobs hiring", "how to remove tree stump diy", "tree removal insurance"],
  },
  "mega-roofing": {
    good: ["roof repair near me", "roof leak repair", "emergency roof repair", "roofing contractor orlando"],
    waste: ["roofing jobs hiring", "diy roof repair", "free roof inspection scam", "roof repair cost calculator"],
  },
};

const sampleKeywords = {
  "supreme-tree-experts": [
    { keyword: "tree removal near me", matchType: "EXACT", adGroup: "Tree Removal" },
    { keyword: "tree removal service", matchType: "PHRASE", adGroup: "Tree Removal" },
    { keyword: "emergency tree removal", matchType: "EXACT", adGroup: "Tree Removal" },
    { keyword: "tree cutting service", matchType: "PHRASE", adGroup: "Tree Removal" },
    { keyword: "tree trimming near me", matchType: "EXACT", adGroup: "Tree Trimming" },
    { keyword: "tree trimming service", matchType: "PHRASE", adGroup: "Tree Trimming" },
    { keyword: "tree pruning service", matchType: "EXACT", adGroup: "Tree Trimming" },
  ],
  "mega-roofing": [
    { keyword: "roof repair near me", matchType: "EXACT", adGroup: "Roof Repair" },
    { keyword: "roof leak repair", matchType: "EXACT", adGroup: "Roof Repair" },
    { keyword: "roofing contractor", matchType: "PHRASE", adGroup: "Roof Repair" },
    { keyword: "emergency roof repair", matchType: "EXACT", adGroup: "Roof Repair" },
    { keyword: "roof repair service", matchType: "PHRASE", adGroup: "Roof Repair" },
    { keyword: "fix roof leak", matchType: "PHRASE", adGroup: "Roof Repair" },
  ],
};

function generateWeek(clientConfig, weekDate, weekNum) {
  const weekLabel = fmt(weekDate);
  const budget = clientConfig.budget;
  const weeklyBudget = (budget / 30.4) * 7;
  const vertical = clientConfig.vertical;

  // Realistic ranges by vertical
  const isTree = vertical === "tree-service";
  const cpcRange = isTree ? [4, 12] : [12, 35];
  const ctrRange = isTree ? [4.5, 7.5] : [3.0, 5.0];
  const cvrRange = isTree ? [5, 9] : [3, 5.5];

  // Generate daily data for 7 days
  const daily = [];
  let totalClicks = 0, totalImpressions = 0, totalSpend = 0, totalConversions = 0;

  for (let d = 0; d < 7; d++) {
    const date = new Date(weekDate);
    date.setDate(date.getDate() + d);
    const dailyBudget = weeklyBudget / 7;
    const spend = rand(dailyBudget * 0.8, dailyBudget * 1.15);
    const cpc = rand(...cpcRange);
    const clicks = Math.round(spend / cpc);
    const ctr = rand(...ctrRange) / 100;
    const impressions = Math.round(clicks / ctr);
    const cvr = rand(...cvrRange) / 100;
    const conversions = Math.random() < cvr * clicks ? randInt(0, Math.ceil(clicks * cvr * 1.5)) : 0;

    daily.push({ date: fmt(date), spend: Math.round(spend * 100) / 100, clicks, impressions, conversions });
    totalSpend += spend;
    totalClicks += clicks;
    totalImpressions += impressions;
    totalConversions += conversions;
  }

  // Ensure at least some conversions
  if (totalConversions === 0 && weekNum > 1) totalConversions = randInt(1, 3);

  const thisWeek = {
    spend: Math.round(totalSpend * 100) / 100,
    clicks: totalClicks,
    impressions: totalImpressions,
    conversions: totalConversions,
    ctr: totalImpressions > 0 ? Math.round(totalClicks / totalImpressions * 10000) / 100 : 0,
    cpc: totalClicks > 0 ? Math.round(totalSpend / totalClicks * 100) / 100 : 0,
    cpl: totalConversions > 0 ? Math.round(totalSpend / totalConversions * 100) / 100 : 0,
  };

  // Fake previous week (just offset)
  const prevConversions = Math.max(0, totalConversions + randInt(-2, 2));
  const prevSpend = totalSpend * rand(0.85, 1.15);
  const prevWeek = {
    spend: Math.round(prevSpend * 100) / 100,
    clicks: Math.round(totalClicks * rand(0.85, 1.15)),
    impressions: Math.round(totalImpressions * rand(0.85, 1.15)),
    conversions: prevConversions,
    cpl: prevConversions > 0 ? Math.round(prevSpend / prevConversions * 100) / 100 : 0,
  };

  const delta = {
    spend: Math.round((thisWeek.spend - prevWeek.spend) * 100) / 100,
    leads: thisWeek.conversions - prevWeek.conversions,
    cpl: Math.round((thisWeek.cpl - prevWeek.cpl) * 100) / 100,
    spendPct: prevWeek.spend > 0 ? Math.round((thisWeek.spend - prevWeek.spend) / prevWeek.spend * 10000) / 100 : 0,
    leadsPct: prevWeek.conversions > 0 ? Math.round((thisWeek.conversions - prevWeek.conversions) / prevWeek.conversions * 10000) / 100 : 0,
    cplPct: prevWeek.cpl > 0 ? Math.round((thisWeek.cpl - prevWeek.cpl) / prevWeek.cpl * 10000) / 100 : 0,
  };

  const pacing = Math.round(thisWeek.spend / weeklyBudget * 100);

  // Keywords
  const kwData = (sampleKeywords[clientConfig.id] || []).map(kw => {
    const clicks = randInt(1, 8);
    const impressions = Math.round(clicks / (rand(3, 8) / 100));
    const conversions = Math.random() < 0.35 ? randInt(0, 2) : 0;
    const spend = clicks * rand(...cpcRange);
    return {
      ...kw,
      clicks,
      impressions,
      conversions,
      spend: Math.round(spend * 100) / 100,
      ctr: Math.round(clicks / impressions * 10000) / 100,
      cpc: Math.round(spend / clicks * 100) / 100,
      cpl: conversions > 0 ? Math.round(spend / conversions * 100) / 100 : null,
    };
  });

  // Search term waste
  const terms = sampleSearchTerms[clientConfig.id] || { good: [], waste: [] };
  const wasteTerms = terms.waste.slice(0, randInt(1, 4)).map(t => ({
    term: t,
    clicks: randInt(3, 7),
    spend: rand(8, 25),
    campaign: `${clientConfig.name.split(" ").map(w => w[0]).join("")} — Search`,
    adGroup: kwData[0]?.adGroup || "General",
  }));
  const wasteSpend = wasteTerms.reduce((s, t) => s + t.spend, 0);
  const wastePct = totalSpend > 0 ? Math.round(wasteSpend / totalSpend * 1000) / 10 : 0;

  // Ad groups
  const adGroupNames = [...new Set(kwData.map(k => k.adGroup))];
  const adGroups = adGroupNames.map(name => ({
    name,
    campaign: `${clientConfig.name.split(" ").map(w => w[0]).join("")} — Search`,
    clicks: randInt(5, 20),
    impressions: randInt(100, 400),
    conversions: randInt(0, 4),
    spend: rand(20, 60),
    ctr: rand(3.0, 7.0),
    cpc: rand(...cpcRange),
  }));

  // Health
  const conversionTrackingActive = weekNum > 0;
  const disapprovedAds = Math.random() < 0.1 ? 1 : 0;
  const health = computeHealth(conversionTrackingActive, pacing, thisWeek.cpl, clientConfig.benchmarks, wastePct, disapprovedAds);

  return {
    meta: {
      clientId: clientConfig.id,
      clientName: clientConfig.name,
      vertical: clientConfig.vertical,
      weekOf: weekLabel,
      generatedAt: new Date().toISOString(),
      budget: clientConfig.budget,
      weeklyBudget: Math.round(weeklyBudget * 100) / 100,
    },
    summary: { thisWeek, prevWeek, delta, pacing },
    daily,
    adGroups,
    keywords: kwData,
    searchTerms: { waste: wasteTerms, wastePct, wasteSpend: Math.round(wasteSpend * 100) / 100 },
    ads: { disapproved: disapprovedAds },
    conversionTracking: {
      active: conversionTrackingActive,
      actions: [{ name: "Phone Calls", type: "CALL_FROM_ADS", conversions: totalConversions }],
    },
    health,
    alerts: {
      wasteTerms,
      bidOpportunities: kwData.filter(k => k.cpl !== null && k.cpl < clientConfig.benchmarks.cplHigh * 0.7),
      underperformingAdGroups: adGroups.filter(ag => ag.ctr < clientConfig.benchmarks.ctrFloor),
    },
  };
}

function computeHealth(trackingActive, pacing, cpl, benchmarks, wastePct, disapproved) {
  let score = 0;
  const breakdown = {};
  breakdown.conversionTracking = trackingActive ? 25 : 0;
  score += breakdown.conversionTracking;
  if (pacing >= 90 && pacing <= 110) breakdown.budgetPacing = 20;
  else if (pacing >= 75 && pacing <= 125) breakdown.budgetPacing = 12;
  else if (pacing >= 50) breakdown.budgetPacing = 5;
  else breakdown.budgetPacing = 0;
  score += breakdown.budgetPacing;
  if (cpl === 0) breakdown.cpl = 10;
  else if (cpl <= benchmarks.cplHigh) breakdown.cpl = 20;
  else if (cpl <= benchmarks.cplHigh * 1.3) breakdown.cpl = 10;
  else breakdown.cpl = 0;
  score += breakdown.cpl;
  if (wastePct < 10) breakdown.searchTermWaste = 15;
  else if (wastePct < 15) breakdown.searchTermWaste = 10;
  else if (wastePct < 25) breakdown.searchTermWaste = 5;
  else breakdown.searchTermWaste = 0;
  score += breakdown.searchTermWaste;
  breakdown.adApprovals = disapproved === 0 ? 10 : 0;
  score += breakdown.adApprovals;
  breakdown.negativeKeywords = 10;
  score += breakdown.negativeKeywords;
  return { score, breakdown };
}

// Meta sample data
function generateMetaWeek(weekDate, weekNum) {
  const weekLabel = fmt(weekDate);
  const metaConfig = CONFIG.meta || { budget: 500, benchmarks: { cplLow: 15, cplHigh: 50 } };
  const weeklyBudget = (metaConfig.budget / 30.4) * 7;

  const daily = [];
  let totalSpend = 0, totalClicks = 0, totalImpressions = 0, totalLeads = 0;

  for (let d = 0; d < 7; d++) {
    const date = new Date(weekDate);
    date.setDate(date.getDate() + d);
    const spend = rand(15, 30);
    const impressions = randInt(800, 2500);
    const clicks = randInt(8, 35);
    const leads = Math.random() < 0.5 ? randInt(0, 3) : 0;

    daily.push({ date: fmt(date), spend: Math.round(spend * 100) / 100, impressions, clicks, leads });
    totalSpend += spend;
    totalImpressions += impressions;
    totalClicks += clicks;
    totalLeads += leads;
  }
  if (totalLeads === 0 && weekNum > 1) totalLeads = randInt(1, 4);

  const thisWeek = {
    spend: Math.round(totalSpend * 100) / 100,
    impressions: totalImpressions,
    clicks: totalClicks,
    ctr: totalImpressions > 0 ? Math.round(totalClicks / totalImpressions * 10000) / 100 / 100 : 0,
    cpc: totalClicks > 0 ? Math.round(totalSpend / totalClicks * 100) / 100 : 0,
    leads: totalLeads,
    cpl: totalLeads > 0 ? Math.round(totalSpend / totalLeads * 100) / 100 : 0,
  };

  const prevLeads = Math.max(0, totalLeads + randInt(-2, 2));
  const prevSpend = totalSpend * rand(0.85, 1.15);
  const prevWeek = {
    spend: Math.round(prevSpend * 100) / 100,
    impressions: Math.round(totalImpressions * rand(0.85, 1.15)),
    clicks: Math.round(totalClicks * rand(0.85, 1.15)),
    leads: prevLeads,
    cpl: prevLeads > 0 ? Math.round(prevSpend / prevLeads * 100) / 100 : 0,
  };

  const delta = {
    spend: Math.round((thisWeek.spend - prevWeek.spend) * 100) / 100,
    leads: thisWeek.leads - prevWeek.leads,
    cpl: Math.round((thisWeek.cpl - prevWeek.cpl) * 100) / 100,
    spendPct: prevWeek.spend > 0 ? Math.round((thisWeek.spend - prevWeek.spend) / prevWeek.spend * 10000) / 100 : 0,
    leadsPct: prevWeek.leads > 0 ? Math.round((thisWeek.leads - prevWeek.leads) / prevWeek.leads * 10000) / 100 : 0,
    cplPct: prevWeek.cpl > 0 ? Math.round((thisWeek.cpl - prevWeek.cpl) / prevWeek.cpl * 10000) / 100 : 0,
  };

  const pacing = Math.round(thisWeek.spend / weeklyBudget * 100);

  const campaigns = [
    { name: "Tree Service Owners — Lookalike", id: "120001", spend: rand(40, 80), impressions: randInt(2000, 5000), clicks: randInt(20, 60), leads: randInt(1, 5), cpl: rand(15, 40) },
    { name: "Tree Service Owners — Interest", id: "120002", spend: rand(30, 60), impressions: randInt(1500, 4000), clicks: randInt(15, 45), leads: randInt(0, 3), cpl: rand(20, 50) },
  ];

  const adsets = [
    { name: "LAL 1% — US Wide", id: "130001", campaign: campaigns[0].name, spend: rand(20, 40), impressions: randInt(1000, 2500), clicks: randInt(10, 30), leads: randInt(0, 3), cpl: rand(15, 45) },
    { name: "LAL 3% — US Wide", id: "130002", campaign: campaigns[0].name, spend: rand(15, 30), impressions: randInt(800, 2000), clicks: randInt(8, 25), leads: randInt(0, 2), cpl: rand(20, 50) },
    { name: "Interest — Arborist + Landscaping", id: "130003", campaign: campaigns[1].name, spend: rand(15, 30), impressions: randInt(800, 2000), clicks: randInt(8, 20), leads: randInt(0, 2), cpl: rand(20, 55) },
  ];

  const ads = [
    { name: "Video — Before/After Tree Job", id: "140001", adset: adsets[0].name, campaign: campaigns[0].name, spend: rand(10, 25), impressions: randInt(500, 1500), clicks: randInt(5, 15), leads: randInt(0, 2), cpl: rand(15, 50) },
    { name: "Image — Growth Stats", id: "140002", adset: adsets[0].name, campaign: campaigns[0].name, spend: rand(8, 20), impressions: randInt(400, 1200), clicks: randInt(4, 12), leads: randInt(0, 2), cpl: rand(18, 55) },
    { name: "Carousel — Case Studies", id: "140003", adset: adsets[2].name, campaign: campaigns[1].name, spend: rand(8, 18), impressions: randInt(300, 1000), clicks: randInt(3, 10), leads: randInt(0, 1), cpl: rand(20, 60) },
  ];

  return {
    meta: {
      platform: "meta",
      accountId: metaConfig.accountId || "1523727968790479",
      accountName: "LocalEyes Pro — Lead Gen",
      weekOf: weekLabel,
      generatedAt: new Date().toISOString(),
      budget: metaConfig.budget,
      weeklyBudget: Math.round(weeklyBudget * 100) / 100,
    },
    summary: { thisWeek, prevWeek, delta, pacing },
    daily,
    campaigns,
    adsets,
    ads,
  };
}

// Main
function main() {
  console.log("\nGenerating 12 weeks of sample data...\n");

  const allLatest = [];
  let metaLatest = null;

  for (const client of CONFIG.clients) {
    const dir = path.join(ROOT, "data", client.id);
    fs.mkdirSync(dir, { recursive: true });

    for (let w = 11; w >= 0; w--) {
      const weekDate = new Date();
      weekDate.setDate(weekDate.getDate() - (w * 7) - weekDate.getDay() + 1);
      const snap = generateWeek(client, weekDate, 12 - w);
      const filePath = path.join(dir, `week-${snap.meta.weekOf}.json`);
      fs.writeFileSync(filePath, JSON.stringify(snap, null, 2));
      console.log(`  [${client.name}] week-${snap.meta.weekOf}.json`);

      if (w === 0) {
        fs.writeFileSync(path.join(dir, "latest.json"), JSON.stringify(snap, null, 2));
        allLatest.push(snap);
      }
    }
  }

  // Generate Meta sample data
  const metaDir = path.join(ROOT, "data", "meta-localeyespro");
  fs.mkdirSync(metaDir, { recursive: true });

  for (let w = 11; w >= 0; w--) {
    const weekDate = new Date();
    weekDate.setDate(weekDate.getDate() - (w * 7) - weekDate.getDay() + 1);
    const snap = generateMetaWeek(weekDate, 12 - w);
    fs.writeFileSync(path.join(metaDir, `week-${snap.meta.weekOf}.json`), JSON.stringify(snap, null, 2));
    console.log(`  [LocalEyes Meta] week-${snap.meta.weekOf}.json`);

    if (w === 0) {
      fs.writeFileSync(path.join(metaDir, "latest.json"), JSON.stringify(snap, null, 2));
      metaLatest = snap;
    }
  }

  // New combined format: { googleAds: [...], meta: {...} }
  const combined = { googleAds: allLatest, meta: metaLatest };
  fs.writeFileSync(path.join(ROOT, "data", "latest-all.json"), JSON.stringify(combined, null, 2));
  console.log("\nSample data generated. Run: npm run build && npm run dev\n");
}

main();
