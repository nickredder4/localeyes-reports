/**
 * generate-email.js
 * Reads latest snapshots and sends Nick a weekly optimization email via Gmail API.
 *
 * Required env vars:
 *   GMAIL_CLIENT_ID
 *   GMAIL_CLIENT_SECRET
 *   GMAIL_REFRESH_TOKEN
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { google } from "googleapis";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, "config/clients.json"), "utf-8"));

function arrow(val) { return val > 0 ? "▲" : val < 0 ? "▼" : "—"; }
function pct(val) { return `${val > 0 ? "+" : ""}${Math.round(val)}%`; }
function usd(val) { return `$${val.toFixed(2)}`; }

function buildClientSection(snap) {
  if (snap.meta.error) {
    return `
═══ ${snap.meta.clientName.toUpperCase()} ═══
❌ DATA PULL FAILED: ${snap.meta.error}
`;
  }

  const s = snap.summary;
  const lines = [];

  lines.push(`═══ ${snap.meta.clientName.toUpperCase()} ═══`);
  lines.push(`Spend: ${usd(s.thisWeek.spend)} / ${usd(snap.meta.weeklyBudget)} weekly budget (${s.pacing}% paced)`);
  lines.push(`Leads: ${s.thisWeek.conversions}  |  CPL: ${s.thisWeek.cpl > 0 ? usd(s.thisWeek.cpl) : "N/A"}  |  ${arrow(s.delta.leadsPct)} ${pct(s.delta.leadsPct)} vs last week`);
  lines.push(`Clicks: ${s.thisWeek.clicks}  |  CTR: ${s.thisWeek.ctr.toFixed(1)}%  |  CPC: ${usd(s.thisWeek.cpc)}`);
  lines.push(`Health Score: ${snap.health.score}/100`);
  lines.push("");

  // Action items
  const actions = [];

  // Search term waste
  if (snap.alerts.wasteTerms.length > 0) {
    actions.push(`${snap.alerts.wasteTerms.length} search terms to review as potential negatives:`);
    for (const t of snap.alerts.wasteTerms.slice(0, 5)) {
      actions.push(`   "${t.term}" — ${t.clicks} clicks, ${usd(t.spend)}, 0 conv`);
    }
    if (snap.alerts.wasteTerms.length > 5) {
      actions.push(`   ... and ${snap.alerts.wasteTerms.length - 5} more (see full data)`);
    }
  }

  // Bid opportunities
  if (snap.alerts.bidOpportunities.length > 0) {
    for (const k of snap.alerts.bidOpportunities.slice(0, 3)) {
      actions.push(`Keyword "${k.keyword}" CPL at ${usd(k.cpl)} — well below benchmark, consider bid increase`);
    }
  }

  // Underperforming ad groups
  if (snap.alerts.underperformingAdGroups.length > 0) {
    for (const ag of snap.alerts.underperformingAdGroups) {
      actions.push(`Ad group "${ag.name}" CTR at ${ag.ctr.toFixed(1)}% (below ${snap.meta.vertical === "tree-service" ? "3%" : "3%"} floor) — review ad copy`);
    }
  }

  // Disapproved ads
  if (snap.ads.disapproved > 0) {
    actions.push(`${snap.ads.disapproved} disapproved ad(s) — fix immediately`);
  }

  // Conversion tracking
  if (!snap.conversionTracking.active) {
    actions.push(`⚠️ CRITICAL: No active conversions detected this week — verify tracking setup`);
  }

  // Budget pacing
  if (s.pacing < 80) {
    actions.push(`Budget underspending at ${s.pacing}% — check bid levels and keyword volume`);
  } else if (s.pacing > 120) {
    actions.push(`Budget overspending at ${s.pacing}% — check for bid inflation or broad match leakage`);
  }

  if (actions.length > 0) {
    lines.push("⚠️  ACTION ITEMS:");
    for (const a of actions) lines.push(`• ${a}`);
  }

  // Healthy checks
  const healthy = [];
  if (snap.conversionTracking.active) healthy.push("Conversion tracking verified");
  if (s.pacing >= 80 && s.pacing <= 120) healthy.push(`Budget pacing healthy (${s.pacing}%)`);
  if (snap.ads.disapproved === 0) healthy.push("No disapproved ads");
  if (snap.searchTerms.wastePct < 15) healthy.push(`Search term waste low (${snap.searchTerms.wastePct}%)`);

  if (healthy.length > 0) {
    lines.push("");
    lines.push("✅ HEALTHY:");
    for (const h of healthy) lines.push(`• ${h}`);
  }

  // Top keywords
  const topKw = snap.keywords.filter(k => k.conversions > 0).sort((a, b) => a.cpl - b.cpl).slice(0, 3);
  if (topKw.length > 0) {
    lines.push("");
    lines.push("🏆 TOP KEYWORDS:");
    for (const k of topKw) {
      lines.push(`• "${k.keyword}" [${k.matchType}] — ${k.conversions} conv, ${usd(k.cpl)} CPL`);
    }
  }

  // Health breakdown
  lines.push("");
  lines.push(`HEALTH BREAKDOWN: Tracking ${snap.health.breakdown.conversionTracking}/25 | Pacing ${snap.health.breakdown.budgetPacing}/20 | CPL ${snap.health.breakdown.cpl}/20 | Waste ${snap.health.breakdown.searchTermWaste}/15 | Ads ${snap.health.breakdown.adApprovals}/10 | Negatives ${snap.health.breakdown.negativeKeywords}/10`);

  return lines.join("\n");
}

function buildEmailBody(snapshots) {
  const lines = [];
  const weekLabel = snapshots[0]?.meta?.weekOf || "Unknown";

  lines.push("LOCALEYES PRO — WEEKLY OPTIMIZATION REPORT");
  lines.push(`Week of ${weekLabel}`);
  lines.push("═".repeat(50));
  lines.push("");

  // Quick overview table
  lines.push("OVERVIEW");
  lines.push("─".repeat(50));
  for (const snap of snapshots) {
    if (snap.meta.error) {
      lines.push(`${snap.meta.clientName}: ❌ Pull failed`);
    } else {
      const s = snap.summary;
      const healthEmoji = snap.health.score >= 85 ? "🟢" : snap.health.score >= 65 ? "🟡" : "🔴";
      lines.push(`${snap.meta.clientName}: ${s.thisWeek.conversions} leads | ${usd(s.thisWeek.spend)} spent | ${s.thisWeek.cpl > 0 ? usd(s.thisWeek.cpl) + " CPL" : "No conv"} | ${healthEmoji} ${snap.health.score}`);
    }
  }
  lines.push("");

  // Per-client sections
  for (const snap of snapshots) {
    lines.push(buildClientSection(snap));
    lines.push("");
  }

  lines.push("═".repeat(50));
  lines.push("Generated automatically by LocalEyes Reports");

  return lines.join("\n");
}

async function sendEmail(subject, body) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
  );
  oauth2Client.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });

  const gmail = google.gmail({ version: "v1", auth: oauth2Client });

  const to = CONFIG.settings.emailTo;
  const raw = Buffer.from(
    `To: ${to}\r\n` +
    `Subject: ${subject}\r\n` +
    `Content-Type: text/plain; charset=utf-8\r\n` +
    `\r\n` +
    body
  ).toString("base64url");

  await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw },
  });

  console.log(`Email sent to ${to}`);
}

async function main() {
  console.log("\nLocalEyes Reports — Email Generator\n");

  // Read combined snapshot
  const allPath = path.join(ROOT, "data", "latest-all.json");
  if (!fs.existsSync(allPath)) {
    console.error("No data found. Run 'npm run pull' first.");
    process.exit(1);
  }

  const snapshots = JSON.parse(fs.readFileSync(allPath, "utf-8"));
  const weekLabel = snapshots[0]?.meta?.weekOf || "Unknown";
  const subject = `LocalEyes Weekly Report — ${weekLabel}`;
  const body = buildEmailBody(snapshots);

  // Write a copy locally for review
  const emailDir = path.join(ROOT, "data", "emails");
  fs.mkdirSync(emailDir, { recursive: true });
  fs.writeFileSync(path.join(emailDir, `${weekLabel}.txt`), body);
  console.log(`Email draft saved: data/emails/${weekLabel}.txt`);

  // Send via Gmail if credentials are available
  if (process.env.GMAIL_REFRESH_TOKEN) {
    await sendEmail(subject, body);
  } else {
    console.log("Gmail credentials not set — email saved locally only.");
    console.log("Set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, and GMAIL_REFRESH_TOKEN to enable sending.");
  }
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
