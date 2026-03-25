/**
 * Vercel Cron: Daily Appeal Tracker
 * Runs daily at 5:00 AM ET (10:00 UTC)
 * 
 * 1. Queries Buncombe County GIS for all $0 non-exempt residential parcels
 * 2. Fetches actual values from Property Record Card system for new $0 PINs
 * 3. Calculates appeal statistics
 * 4. Updates appeal-stats.json if numbers changed
 * 5. Logs results to Google Sheet
 * 6. Sends Telegram alert if significant changes detected
 */

const { queryArcGIS, parseValue } = require("../_shared");
const fs = require("fs");
const path = require("path");

const CURRENT_LAYER = "https://gis.buncombecounty.org/arcgis/rest/services/opendata/MapServer/1";
const PRC_BASE = "https://prc-buncombe.spatialest.com/api/v1/recordcard";
const APPEAL_STATS_PATH = path.join(__dirname, "..", "..", "public", "appeal-stats.json");

// Exempt property classes (government, churches, utilities, etc.)
const EXEMPT_CLASSES = new Set([
  "600", "601", "602", "603", "604", "605", "610", "611", "612",
  "700", "701", "702", "703", "704", "705", "710", "711", "712",
  "800", "801", "802", "803", "804", "805", "810", "811", "812",
  "900", "901", "902", "903", "904", "905", "910", "911", "912",
]);

// Thresholds
const REDEPLOY_THRESHOLD_PCT = 0.5; // Redeploy if corrected increase shifts by 0.5+ pct points
const ALERT_THRESHOLD_NEW_APPEALS = 50; // Telegram alert if 50+ new appeals
const TOTAL_2021_TAX_BASE = 46150000000; // ~$46.15B (2021 base for increase calculation)
const COUNTY_ANTICIPATED = 10000;

// Google Sheets config
const GOOGLE_SHEETS_ID = process.env.GOOGLE_SHEETS_APPEAL_TRACKER_ID;
const GOOGLE_SHEETS_API_KEY = process.env.GOOGLE_SHEETS_API_KEY; // Service account or API key

// Telegram config
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Pipedream webhook for Google Sheets (simpler than direct API)
const PIPEDREAM_SHEETS_WEBHOOK = process.env.PIPEDREAM_SHEETS_WEBHOOK;

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Step 1: Get all $0 non-exempt parcels from GIS
 */
async function getZeroParcels() {
  const where = "TotalMarketValue = 0 OR TotalMarketValue IS NULL";
  const fields = "PIN,Class,TotalMarketValue,Owner";
  
  // GIS has a max return limit, so paginate
  const allParcels = [];
  let offset = 0;
  const pageSize = 2000;
  
  while (true) {
    const params = new URLSearchParams({
      where, outFields: fields, f: "json",
      returnGeometry: "false",
      resultRecordCount: String(pageSize),
      resultOffset: String(offset),
    });
    
    const response = await fetch(`${CURRENT_LAYER}/query?${params.toString()}`);
    const data = await response.json();
    if (data.error) throw new Error(data.error.message || "ArcGIS query failed");
    
    const features = (data.features || []).map(f => f.attributes);
    if (features.length === 0) break;
    
    allParcels.push(...features);
    if (features.length < pageSize) break;
    offset += pageSize;
  }
  
  // Filter out exempt classes
  return allParcels.filter(p => !EXEMPT_CLASSES.has(String(p.Class || "")));
}

/**
 * Step 2: Load previous state (last run's PINs)
 */
function loadPreviousState() {
  try {
    const raw = fs.readFileSync(APPEAL_STATS_PATH, "utf-8");
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

/**
 * Step 3: For new $0 PINs, check PRC for actual reappraisal value
 */
async function lookupPRCValues(pins) {
  const results = [];
  let checked = 0;
  
  for (const pin of pins) {
    try {
      const res = await fetch(`${PRC_BASE}/${pin}`);
      if (!res.ok) {
        results.push({ pin, value: 0, hasReappraisal: false });
        continue;
      }
      
      const prc = await res.json();
      const sections = prc?.parcel?.sections || [];
      
      // Check for REAPPRAISAL value in the valuation section
      let reappraisalValue = 0;
      if (sections[1] && typeof sections[1] === "object") {
        const valuations = sections[1];
        // Look through valuation entries for "REAPPRAISAL" type
        for (const key of Object.keys(valuations)) {
          const entries = valuations[key];
          if (Array.isArray(entries)) {
            for (const entry of entries) {
              if (entry && entry.CardType === "REAPPRAISAL" && entry.TotalMarketValue) {
                const val = parseInt(String(entry.TotalMarketValue).replace(/[$,]/g, "")) || 0;
                if (val > 0) reappraisalValue = val;
              }
            }
          }
        }
      }
      
      results.push({ pin, value: reappraisalValue, hasReappraisal: reappraisalValue > 0 });
    } catch (e) {
      results.push({ pin, value: 0, hasReappraisal: false });
    }
    
    checked++;
    // Rate limit: pause every 10 requests
    if (checked % 10 === 0) await sleep(500);
  }
  
  return results;
}

/**
 * Step 4: Log results to Google Sheet via Google Sheets API
 * Uses a service account JWT for authentication
 */
async function logToGoogleSheet(data) {
  if (!GOOGLE_SHEETS_ID) {
    console.log("No Google Sheets ID configured, skipping sheet logging");
    return;
  }
  
  // Try Pipedream webhook first (simplest), fall back to direct API
  if (PIPEDREAM_SHEETS_WEBHOOK) {
    try {
      const resp = await fetch(PIPEDREAM_SHEETS_WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spreadsheetId: GOOGLE_SHEETS_ID,
          values: [
            data.date,
            data.time,
            String(data.totalZeroNonExempt),
            data.newZeroPins,
            data.removedPins,
            String(data.confirmedAppeals),
            data.appealChange,
            data.totalAppealValue,
            data.avgAppealValue,
            String(data.genuinelyZero),
            data.correctedTaxBase2026,
            data.correctedIncreasePct,
            data.redeployed ? "Yes" : "No",
            data.notes,
          ],
        }),
      });
      if (resp.ok) {
        console.log("Logged to Google Sheet via Pipedream");
        return;
      }
    } catch (e) {
      console.error("Pipedream webhook failed:", e.message);
    }
  }
  
  // Direct Google Sheets API append (requires API key with sheet edit access)
  if (GOOGLE_SHEETS_API_KEY) {
    try {
      const range = "Sheet1!A:N";
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEETS_ID}/values/${range}:append?valueInputOption=USER_ENTERED&key=${GOOGLE_SHEETS_API_KEY}`;
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          values: [[
            data.date,
            data.time,
            data.totalZeroNonExempt,
            data.newZeroPins,
            data.removedPins,
            data.confirmedAppeals,
            data.appealChange,
            data.totalAppealValue,
            data.avgAppealValue,
            data.genuinelyZero,
            data.correctedTaxBase2026,
            data.correctedIncreasePct,
            data.redeployed ? "Yes" : "No",
            data.notes,
          ]],
        }),
      });
      if (resp.ok) {
        console.log("Logged to Google Sheet via API");
        return;
      }
      console.error("Google Sheets API error:", await resp.text());
    } catch (e) {
      console.error("Google Sheets API failed:", e.message);
    }
  }
  
  console.log("Sheet logging skipped — no working method available");
}

/**
 * Step 5: Send Telegram alert
 */
async function sendTelegramAlert(message) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log("Telegram not configured, skipping alert");
    return;
  }
  
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: "Markdown",
      }),
    });
  } catch (e) {
    console.error("Failed to send Telegram alert:", e.message);
  }
}

/**
 * Main handler
 */
module.exports = async function handler(req, res) {
  // Verify this is a cron invocation (Vercel sets this header)
  const authHeader = req.headers["authorization"];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    // Also allow manual trigger with query param for testing
    if (req.query.secret !== process.env.CRON_SECRET) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }
  
  const startTime = Date.now();
  const now = new Date();
  const etDate = now.toLocaleDateString("en-US", { timeZone: "America/New_York" });
  const etTime = now.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour12: true });
  
  try {
    console.log(`[Appeal Tracker] Starting scan at ${etDate} ${etTime}`);
    
    // Load previous state
    const prevStats = loadPreviousState();
    const prevAppeals = prevStats?.confirmedAppeals || 0;
    const prevZeroCount = prevStats?.totalZeroNonExempt || 0;
    
    // Get current $0 parcels
    const zeroParcels = await getZeroParcels();
    const currentZeroPins = new Set(zeroParcels.map(p => p.PIN));
    const totalZeroNonExempt = zeroParcels.length;
    
    // Determine new and removed PINs (vs last known state)
    // For incremental scanning, we'd need the previous PIN list
    // Since we're starting fresh, we'll do a full PRC lookup on first run
    // and then only check new PINs on subsequent runs
    
    // For now, check ALL $0 PINs against PRC to classify them
    // This is expensive on first run but the cron has up to 60s on Vercel Hobby
    // We'll batch and be smart about it
    
    let confirmedAppeals = 0;
    let totalAppealValue = 0;
    let genuinelyZero = 0;
    
    // To stay within timeout, only do PRC lookups for a sample if there are too many
    const MAX_PRC_LOOKUPS = 100; // Stay within Vercel timeout
    const pinsToCheck = [...currentZeroPins];
    
    if (pinsToCheck.length <= MAX_PRC_LOOKUPS) {
      // Check all
      const results = await lookupPRCValues(pinsToCheck);
      for (const r of results) {
        if (r.hasReappraisal) {
          confirmedAppeals++;
          totalAppealValue += r.value;
        } else {
          genuinelyZero++;
        }
      }
    } else {
      // Use previous stats as baseline and only check new PINs
      // Carry forward previous appeal/zero counts and adjust
      if (prevStats && prevStats._knownPins) {
        const prevPinSet = new Set(prevStats._knownPins);
        const newPins = pinsToCheck.filter(p => !prevPinSet.has(p));
        const removedPins = [...prevPinSet].filter(p => !currentZeroPins.has(p));
        
        // Start from previous counts, subtract removed, add new
        confirmedAppeals = prevStats.confirmedAppeals || 0;
        totalAppealValue = prevStats.totalAppealValue || 0;
        genuinelyZero = prevStats.genuinelyZero || 0;
        
        // Assume removed PINs were evenly split between appeals and genuinely zero
        // (conservative approximation)
        if (removedPins.length > 0 && (confirmedAppeals + genuinelyZero) > 0) {
          const appealRatio = confirmedAppeals / (confirmedAppeals + genuinelyZero);
          const removedAppeals = Math.round(removedPins.length * appealRatio);
          const removedZero = removedPins.length - removedAppeals;
          confirmedAppeals = Math.max(0, confirmedAppeals - removedAppeals);
          genuinelyZero = Math.max(0, genuinelyZero - removedZero);
          // Adjust total value proportionally
          if (prevStats.confirmedAppeals > 0) {
            totalAppealValue = Math.round(totalAppealValue * (confirmedAppeals / prevStats.confirmedAppeals));
          }
        }
        
        // Check new PINs
        if (newPins.length > 0) {
          const batchSize = Math.min(newPins.length, MAX_PRC_LOOKUPS);
          const results = await lookupPRCValues(newPins.slice(0, batchSize));
          for (const r of results) {
            if (r.hasReappraisal) {
              confirmedAppeals++;
              totalAppealValue += r.value;
            } else {
              genuinelyZero++;
            }
          }
        }
      } else {
        // No previous state — use counts from the existing static file
        confirmedAppeals = prevStats?.confirmedAppeals || 0;
        totalAppealValue = prevStats?.totalAppealValue || 0;
        genuinelyZero = prevStats?.genuinelyZero || 0;
      }
    }
    
    const avgAppealValue = confirmedAppeals > 0 ? totalAppealValue / confirmedAppeals : 0;
    const correctedTaxBase2026 = TOTAL_2021_TAX_BASE * 1.678 + totalAppealValue; // Approximate
    const correctedIncreasePct = ((correctedTaxBase2026 / TOTAL_2021_TAX_BASE) - 1) * 100;
    
    // Calculate changes
    const appealChange = confirmedAppeals - prevAppeals;
    const newZeroPins = totalZeroNonExempt - prevZeroCount;
    
    // Build updated stats
    const newStats = {
      lastUpdated: now.toISOString().split("T")[0],
      totalZeroNonExempt,
      confirmedAppeals,
      totalAppealValue: Math.round(totalAppealValue),
      avgAppealValue: Math.round(avgAppealValue * 100) / 100,
      genuinelyZero,
      countyAnticipated: COUNTY_ANTICIPATED,
      correctedTaxBase2026: Math.round(correctedTaxBase2026),
      correctedIncreasePct: Math.round(correctedIncreasePct * 10) / 10,
      source: "Buncombe County GIS + Property Record Card System",
      wlosArticleUrl: "https://wlos.com/news/local/buncombe-county-appeals-property-value-assessment-homeowners-value-market-rent-community-commissioners-appraiser-tax-residents",
      // Store PIN list for incremental scanning (not exposed to frontend)
      _knownPins: [...currentZeroPins],
    };
    
    // Determine if we should redeploy
    const prevIncrease = prevStats?.correctedIncreasePct || 0;
    const shouldRedeploy = Math.abs(correctedIncreasePct - prevIncrease) >= REDEPLOY_THRESHOLD_PCT;
    
    // Write updated stats (without internal _knownPins for the public file)
    const publicStats = { ...newStats };
    delete publicStats._knownPins;
    
    // Note: In Vercel serverless, we can't write to the filesystem permanently.
    // Instead, we'll trigger a GitHub commit to update the file.
    // For now, we'll use the Vercel deploy hook or GitHub API.
    
    let redeployed = false;
    let notes = "";
    
    if (shouldRedeploy || Math.abs(appealChange) >= 10) {
      // Update via GitHub API
      redeployed = await updateGitHubFile(publicStats);
      if (redeployed) {
        notes = `Redeployed: increase shifted from ${prevIncrease}% to ${correctedIncreasePct.toFixed(1)}%`;
      }
    } else {
      notes = "No significant changes, skipping redeploy";
    }
    
    // Log to Google Sheet
    const sheetData = {
      date: etDate,
      time: etTime,
      totalZeroNonExempt,
      newZeroPins: newZeroPins >= 0 ? `+${newZeroPins}` : String(newZeroPins),
      removedPins: "—", // We'd need more tracking for this
      confirmedAppeals,
      appealChange: appealChange >= 0 ? `+${appealChange}` : String(appealChange),
      totalAppealValue: `$${Math.round(totalAppealValue).toLocaleString()}`,
      avgAppealValue: `$${Math.round(avgAppealValue).toLocaleString()}`,
      genuinelyZero,
      correctedTaxBase2026: `$${Math.round(correctedTaxBase2026).toLocaleString()}`,
      correctedIncreasePct: `${correctedIncreasePct.toFixed(1)}%`,
      redeployed,
      notes,
    };
    
    await logToGoogleSheet(sheetData);
    
    // Send Telegram alert if significant
    if (Math.abs(appealChange) >= ALERT_THRESHOLD_NEW_APPEALS) {
      const direction = appealChange > 0 ? "increased" : "decreased";
      const alertMsg = [
        `🏠 *Buncombe Appeal Tracker Update*`,
        ``,
        `Appeals ${direction} by ${Math.abs(appealChange)} (now ${confirmedAppeals.toLocaleString()} total)`,
        `Total $0 parcels: ${totalZeroNonExempt.toLocaleString()}`,
        `Total appeal value: $${Math.round(totalAppealValue).toLocaleString()}`,
        `Corrected increase: ${correctedIncreasePct.toFixed(1)}%`,
        redeployed ? `\n✅ Site redeployed with updated numbers` : "",
      ].filter(Boolean).join("\n");
      
      await sendTelegramAlert(alertMsg);
    }
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[Appeal Tracker] Complete in ${elapsed}s. Appeals: ${confirmedAppeals} (${appealChange >= 0 ? "+" : ""}${appealChange})`);
    
    return res.status(200).json({
      success: true,
      elapsed: `${elapsed}s`,
      stats: publicStats,
      changes: {
        appealChange,
        newZeroPins,
        redeployed,
      },
      notes,
    });
    
  } catch (error) {
    console.error("[Appeal Tracker] Error:", error);
    
    // Try to alert on failure
    await sendTelegramAlert(`❌ *Appeal Tracker Failed*\n\nError: ${error.message}\nTime: ${etDate} ${etTime}`);
    
    return res.status(500).json({ error: error.message });
  }
};

/**
 * Update appeal-stats.json via GitHub API and trigger Vercel redeploy
 */
async function updateGitHubFile(stats) {
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const REPO = "kendraferguson14/buncombe-tax-lookup";
  const FILE_PATH = "public/appeal-stats.json";
  
  if (!GITHUB_TOKEN) {
    console.log("No GitHub token configured, skipping file update");
    return false;
  }
  
  try {
    // Get current file SHA
    const getRes = await fetch(`https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`, {
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: "application/vnd.github.v3+json",
      },
    });
    
    if (!getRes.ok) {
      console.error("Failed to get file from GitHub:", await getRes.text());
      return false;
    }
    
    const fileData = await getRes.json();
    const sha = fileData.sha;
    
    // Update the file
    const content = Buffer.from(JSON.stringify(stats, null, 2)).toString("base64");
    const updateRes = await fetch(`https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: `[cron] Update appeal stats - ${stats.confirmedAppeals} appeals, ${stats.correctedIncreasePct}% increase`,
        content,
        sha,
      }),
    });
    
    if (!updateRes.ok) {
      console.error("Failed to update GitHub file:", await updateRes.text());
      return false;
    }
    
    console.log("[Appeal Tracker] GitHub file updated, Vercel will auto-deploy");
    return true;
  } catch (e) {
    console.error("GitHub update error:", e.message);
    return false;
  }
}
