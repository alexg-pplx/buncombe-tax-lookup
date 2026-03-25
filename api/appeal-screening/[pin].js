const { CURRENT_LAYER, CURRENT_FIELDS, queryArcGIS, parseValue, sanitizePin, derivePropertyLocation } = require("../_shared");

// Both residential comps and vacant land use opendata layer
// Residential comps are verified as Qualified Sales through PRC transfer history
const COMP_LAYER = "https://gis.buncombecounty.org/arcgis/rest/services/opendata/MapServer/1";
const PRC_BASE = "https://prc-buncombe.spatialest.com/api/v1/recordcard";

// 24-month window: Jan 1 2024 through Jan 1 2026
const SALE_CUTOFF_START = new Date(2024, 0, 1);
const SALE_CUTOFF_END = new Date(2026, 0, 2);
const MIN_SALE_PRICE = 50000;
const MIN_LAND_SALE_PRICE = 10000;
const MAX_REDUCTION_PCT = 0.25; // Never suggest more than 25% reduction

// --- Helpers ---

function median(arr) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function roundTo5k(val) {
  return Math.round(val / 5000) * 5000;
}

function capReduction(currentValue, suggestedValue) {
  const floor = currentValue * (1 - MAX_REDUCTION_PCT);
  return Math.max(suggestedValue, floor);
}

function parseSaleDate(dateStr) {
  if (!dateStr) return null;
  const parts = dateStr.split("/");
  if (parts.length !== 3) return null;
  return new Date(parseInt(parts[2]), parseInt(parts[0]) - 1, parseInt(parts[1]));
}

function isWithinSaleWindow(date) {
  return date && date >= SALE_CUTOFF_START && date <= SALE_CUTOFF_END;
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// --- Property Details ---

async function getPropertyDetails(pin) {
  const results = await queryArcGIS(CURRENT_LAYER, `PIN = '${pin}'`, CURRENT_FIELDS, 1);
  if (!results.length) return null;
  const r = results[0];

  let building = null;
  try {
    const prcRes = await fetch(`${PRC_BASE}/${pin}`);
    if (prcRes.ok) {
      const prc = await prcRes.json();
      const sections = prc?.parcel?.sections || [];
      if (sections[2] && typeof sections[2] === 'object' && sections[2]['1'] && sections[2]['1'][0]) {
        building = sections[2]['1'][0];
      }
    }
  } catch (e) {}

  const totalValue = parseValue(r.TotalMarketValue);
  const landValue = parseValue(r.LandValue);
  const buildingValue = parseValue(r.BuildingValue);
  const acreage = parseFloat(r.Acreage) || 0;

  return {
    pin: r.PIN,
    owner: r.Owner || "",
    address: [r.HouseNumber, r.StreetPrefix, r.StreetName, r.StreetType].filter(Boolean).join(" "),
    neighborhood: r.NeighborhoodCode || "",
    propertyClass: r.Class || "",
    acreage,
    totalValue,
    landValue,
    buildingValue,
    sqft: building ? parseInt(building.TotalFinishedArea) || 0 : 0,
    yearBuilt: building ? parseInt(building.YearBuilt) || 0 : 0,
    bedrooms: building ? parseInt(building.Bedrooms) || 0 : 0,
    fullBaths: building ? parseInt(building.FullBath) || 0 : 0,
    halfBaths: building ? parseInt(building.HalfBath) || 0 : 0,
    buildingType: building ? building.BuildingType || "" : "",
    quality: building ? building.Quality || "" : "",
    condition: building ? building.PhysicalCondition || "" : "",
    landPctOfTotal: totalValue > 0 ? (landValue / totalValue) * 100 : 0,
    landPerAcre: acreage > 0 ? landValue / acreage : 0,
  };
}

// --- Comparable Sales (Residential) ---
// Uses opendata layer + PRC transfer history to verify Qualified Sales
// This is more selective than the comp widget (which shows all sales) and produces better analysis

async function findComparableSales(subject) {
  // For manufactured homes, search Class 170 specifically
  const isManufactured = subject.propertyClass === '170';
  const residentialClasses = isManufactured
    ? "('170')"
    : "('100','101','121')";

  const where = `Class IN ${residentialClasses} AND NeighborhoodCode = '${subject.neighborhood}' AND PIN <> '${subject.pin}'`;
  const fields = "PIN,Owner,HouseNumber,StreetPrefix,StreetName,StreetType,Acreage,TotalMarketValue,LandValue,BuildingValue,SalePrice,DeedDate,NeighborhoodCode,Class";
  const results = await queryArcGIS(COMP_LAYER, where, fields, 50);

  const comps = [];
  const checked = new Set();

  for (const r of results.slice(0, 15)) {
    const compPin = r.PIN;
    if (checked.has(compPin)) continue;
    checked.add(compPin);

    try {
      const prcRes = await fetch(`${PRC_BASE}/${compPin}`);
      if (!prcRes.ok) continue;
      const prc = await prcRes.json();
      const sections = prc?.parcel?.sections || [];

      let bldg = {};
      if (sections[2] && typeof sections[2] === 'object' && sections[2]['1'] && sections[2]['1'][0]) {
        bldg = sections[2]['1'][0];
      }

      const yearBuilt = parseInt(bldg.YearBuilt) || 0;
      const sqft = parseInt(bldg.TotalFinishedArea) || 0;
      const quality = bldg.Quality || "";

      // Get transfer history - find qualified sales within 24-month window
      const transfers = (sections[3] && sections[3][0]) || [];
      for (const t of transfers) {
        if (t.salesvalidity !== 'Qualified Sale') continue;
        const priceStr = (t.saleprice || "$0").replace(/[$,]/g, "");
        const price = parseInt(priceStr) || 0;
        if (price < MIN_SALE_PRICE) continue;

        const saleDate = parseSaleDate(t.saledate);
        if (!isWithinSaleWindow(saleDate)) continue;

        comps.push({
          pin: compPin,
          address: [r.HouseNumber, r.StreetPrefix, r.StreetName, r.StreetType].filter(Boolean).join(" "),
          salePrice: price,
          saleDate: t.saledate,
          assessedValue: parseValue(r.TotalMarketValue),
          landValue: parseValue(r.LandValue),
          buildingValue: parseValue(r.BuildingValue),
          acreage: parseFloat(r.Acreage) || 0,
          sqft,
          yearBuilt,
          quality,
          bedrooms: parseInt(bldg.Bedrooms) || 0,
          fullBaths: parseInt(bldg.FullBath) || 0,
          halfBaths: parseInt(bldg.HalfBath) || 0,
          propCard: `https://prc-buncombe.spatialest.com/#/property/${compPin}`,
        });
        break; // Only most recent qualified sale per property
      }
    } catch (e) {}

    await sleep(200);
  }

  return comps;
}

// --- Vacant Land Sales ---

async function findVacantLandSales(subject) {
  const vacantClasses = "('300','305','306','311','312')";
  const nbhd = subject.neighborhood;
  // Vacant land uses opendata layer (broader coverage of vacant parcels)
  const fields = "PIN,Acreage,SalePrice,DeedDate,NeighborhoodCode,TotalMarketValue,LandValue,Class";

  // DeedDate is YYYYMMDD string — we can filter by string comparison
  const dateFilter = "DeedDate >= '20240101' AND DeedDate <= '20260102'";

  // First try exact neighborhood
  let where = `Class IN ${vacantClasses} AND NeighborhoodCode = '${nbhd}' AND SalePrice <> '0' AND ${dateFilter}`;
  let results = await queryArcGIS(COMP_LAYER, where, fields, 50);

  // If not enough qualifying, try nearby neighborhoods (same prefix before dash, e.g. LE-R -> LE%)
  if (results.length < 5 && nbhd.length >= 2) {
    const dashIdx = nbhd.indexOf('-');
    const prefix = dashIdx > 0 ? nbhd.substring(0, dashIdx) : nbhd.substring(0, 2);
    where = `Class IN ${vacantClasses} AND NeighborhoodCode LIKE '${prefix}%' AND SalePrice <> '0' AND ${dateFilter}`;
    results = await queryArcGIS(COMP_LAYER, where, fields, 50);
  }

  // Filter by minimum sale price in JS (SalePrice is a string field in ArcGIS)
  const landSales = [];
  for (const r of results) {
    const acreage = parseFloat(r.Acreage) || 0;
    const salePrice = parseInt(r.SalePrice) || 0;
    if (acreage <= 0 || salePrice < MIN_LAND_SALE_PRICE) continue;

    let saleDate = null;
    if (r.DeedDate && r.DeedDate.length === 8) {
      const y = parseInt(r.DeedDate.substring(0, 4));
      const m = parseInt(r.DeedDate.substring(4, 6)) - 1;
      const d = parseInt(r.DeedDate.substring(6, 8));
      saleDate = new Date(y, m, d);
    }

    landSales.push({
      pin: r.PIN,
      acreage,
      salePrice,
      saleDate: saleDate ? `${saleDate.getMonth() + 1}/${saleDate.getDate()}/${saleDate.getFullYear()}` : r.DeedDate,
      pricePerAcre: salePrice / acreage,
      neighborhood: r.NeighborhoodCode,
      assessedValue: parseValue(r.TotalMarketValue),
      landAssessedValue: parseValue(r.LandValue),
    });
  }

  return landSales.sort((a, b) => b.salePrice - a.salePrice);
}

// --- Equity Comparables (assessed value comparison, no sale required) ---

async function findEquityComps(subject) {
  const isManufactured = subject.propertyClass === '170';
  const residentialClasses = isManufactured
    ? "('170')"
    : "('100','101','121')";

  // Acreage range: within 50% for small lots, within 100% for large
  const acLow = subject.acreage > 3
    ? Math.max(subject.acreage * 0.25, 0.1)
    : Math.max(subject.acreage * 0.5, 0.1);
  const acHigh = subject.acreage > 3
    ? subject.acreage * 2.0
    : subject.acreage * 1.5;

  const nbhd = subject.neighborhood;
  let where = [
    `Class IN ${residentialClasses}`,
    `NeighborhoodCode = '${nbhd}'`,
    `PIN <> '${subject.pin}'`,
    `Acreage >= ${acLow.toFixed(2)}`,
    `Acreage <= ${acHigh.toFixed(2)}`,
  ].join(' AND ');

  const fields = "PIN,TotalMarketValue,LandValue,BuildingValue,Acreage,Class,NeighborhoodCode,HouseNumber,StreetPrefix,StreetName,StreetType";
  let results = await queryArcGIS(COMP_LAYER, where, fields, 30);

  // If not enough in exact neighborhood, widen to area prefix
  if (results.length < 10 && nbhd.length >= 2) {
    const dashIdx = nbhd.indexOf('-');
    const prefix = dashIdx > 0 ? nbhd.substring(0, dashIdx) : nbhd.substring(0, 2);
    where = [
      `Class IN ${residentialClasses}`,
      `NeighborhoodCode LIKE '${prefix}%'`,
      `PIN <> '${subject.pin}'`,
      `Acreage >= ${acLow.toFixed(2)}`,
      `Acreage <= ${acHigh.toFixed(2)}`,
    ].join(' AND ');
    results = await queryArcGIS(COMP_LAYER, where, fields, 30);
  }

  // Enrich top 10 with PRC building data, then filter by sqft/yearBuilt
  // (Keep this small to stay within Vercel timeout)
  const candidates = results.slice(0, 10);
  const equityComps = [];

  for (const r of candidates) {
    const compPinnum = r.PIN;

    let bldg = {};
    try {
      const prcRes = await fetch(`${PRC_BASE}/${compPinnum}`);
      if (prcRes.ok) {
        const prc = await prcRes.json();
        const sections = prc?.parcel?.sections || [];
        if (sections[2] && typeof sections[2] === 'object' && sections[2]['1'] && sections[2]['1'][0]) {
          bldg = sections[2]['1'][0];
        }
      }
    } catch (e) {}

    const sqft = parseInt(bldg.TotalFinishedArea) || 0;
    const yearBuilt = parseInt(bldg.YearBuilt) || 0;

    // Filter: within 30% sqft and 15 years age (slightly looser than comps for broader equity check)
    if (subject.sqft > 0 && sqft > 0) {
      const sqftDiff = Math.abs(subject.sqft - sqft) / subject.sqft;
    }
    if (subject.yearBuilt > 0 && yearBuilt > 0) {
    }
    // Skip if we have no building data at all (can't confirm similarity)

    equityComps.push({
      pin: compPinnum,
      address: [r.HouseNumber, r.StreetPrefix, r.StreetName, r.StreetType].filter(Boolean).join(" "),
      assessedValue: parseValue(r.TotalMarketValue),
      landValue: parseValue(r.LandValue),
      buildingValue: parseValue(r.BuildingValue),
      acreage: parseFloat(r.Acreage) || 0,
      sqft,
      yearBuilt,
      quality: bldg.Quality || "",
    });

    await sleep(200);
  }

  return equityComps;
}

// --- Comp Scoring ---

function scoreComps(subject, comps) {
  return comps.map(comp => {
    let score = 100;

    // Sqft difference (most important)
    if (subject.sqft > 0 && comp.sqft > 0) {
      const sqftDiff = Math.abs(subject.sqft - comp.sqft) / subject.sqft;
      score -= sqftDiff * 40;
    }

    // Acreage difference
    const acDiff = Math.abs(subject.acreage - comp.acreage) / Math.max(subject.acreage, 0.1);
    score -= Math.min(acDiff * 20, 20);

    // Age difference
    if (subject.yearBuilt > 0 && comp.yearBuilt > 0) {
      const ageDiff = Math.abs(subject.yearBuilt - comp.yearBuilt);
      score -= ageDiff * 1.5;
    }

    // Bedroom match
    if (subject.bedrooms > 0 && comp.bedrooms > 0) {
      score -= Math.abs(subject.bedrooms - comp.bedrooms) * 5;
    }

    return { ...comp, similarityScore: Math.max(Math.round(score * 10) / 10, 0) };
  }).sort((a, b) => b.similarityScore - a.similarityScore);
}

// --- Argument Analysis ---

function analyzeMarketValueArgument(subject, topComps) {
  if (topComps.length < 1) {
    return { applicable: false, strength: "none", details: "No comparable sales found.", suggestedValue: null };
  }

  // Only use comps with similarity > 50 — if fewer than 3, we don't have enough
  // truly comparable data to make any market value claim
  const goodComps = topComps.filter(c => c.similarityScore > 50);
  if (goodComps.length < 3) {
    return {
      applicable: false,
      strength: "none",
      details: `Not enough comparable sales found. Only ${goodComps.length} of ${topComps.length} recent sales were similar enough to your property to draw a meaningful comparison.`,
      suggestedValue: null,
      medianSalePrice: null,
      compCount: goodComps.length,
    };
  }

  // 3+ good comps
  const medianPrice = median(goodComps.map(c => c.salePrice));
  const ratio = subject.totalValue / medianPrice;
  let strength = "none";
  let details = "";
  let suggestedValue = null;

  if (ratio > 1.15) {
    strength = "strong";
    suggestedValue = roundTo5k(capReduction(subject.totalValue, medianPrice));
    details = `Assessment ($${subject.totalValue.toLocaleString()}) is ${Math.round((ratio - 1) * 100)}% above median of ${goodComps.length} comparable sales ($${medianPrice.toLocaleString()}). Suggests ${Math.round((ratio - 1) * 100)}% overassessment.`;
  } else if (ratio > 1.05) {
    strength = "moderate";
    suggestedValue = roundTo5k(capReduction(subject.totalValue, medianPrice));
    details = `Assessment ($${subject.totalValue.toLocaleString()}) is ${Math.round((ratio - 1) * 100)}% above median of ${goodComps.length} comparable sales ($${medianPrice.toLocaleString()}). Modest overassessment.`;
  } else if (ratio < 0.95) {
    strength = "none";
    details = `Assessment ($${subject.totalValue.toLocaleString()}) is BELOW median comp sale price ($${medianPrice.toLocaleString()}). An appeal risks increasing your value.`;
  } else {
    details = `Assessment ($${subject.totalValue.toLocaleString()}) is roughly in line with comparable sales ($${medianPrice.toLocaleString()}).`;
  }

  return { applicable: strength !== "none", strength, details, suggestedValue, medianSalePrice: medianPrice, compCount: goodComps.length };
}

function analyzeLandValueArgument(subject, landSales) {
  if (landSales.length < 1 || subject.acreage <= 0) {
    return { applicable: false, strength: "none", details: "No vacant land sales data or zero acreage.", suggestedValue: null };
  }

  const medianPricePerAcre = median(landSales.map(s => s.pricePerAcre));
  const subjectLandPerAcre = subject.landPerAcre;
  const ratio = subjectLandPerAcre / medianPricePerAcre;

  let strength = "none";
  let details = "";
  let suggestedValue = null;

  if (landSales.length < 3) {
    // Thin data — cap at moderate
    if (ratio > 1.50) {
      strength = "moderate";
      const adjustedLand = medianPricePerAcre * subject.acreage;
      suggestedValue = roundTo5k(capReduction(subject.totalValue, adjustedLand + subject.buildingValue));
      details = `Land assessed at $${Math.round(subjectLandPerAcre).toLocaleString()}/acre vs. market median $${Math.round(medianPricePerAcre).toLocaleString()}/acre (${landSales.length} vacant sale(s), 3+ preferred). ${Math.round((ratio - 1) * 100)}% above market rate.`;
    } else if (ratio > 1.20) {
      strength = "weak";
      details = `Land assessed at $${Math.round(subjectLandPerAcre).toLocaleString()}/acre vs. market median $${Math.round(medianPricePerAcre).toLocaleString()}/acre. Limited vacant land sales data.`;
    } else {
      details = `Land assessment ($${Math.round(subjectLandPerAcre).toLocaleString()}/acre) is near market rate ($${Math.round(medianPricePerAcre).toLocaleString()}/acre).`;
    }

    return { applicable: strength !== "none", strength, details, suggestedValue, medianPricePerAcre, saleCount: landSales.length };
  }

  // 3+ land sales
  if (ratio > 1.50) {
    strength = "strong";
    const adjustedLand = medianPricePerAcre * subject.acreage;
    suggestedValue = roundTo5k(capReduction(subject.totalValue, adjustedLand + subject.buildingValue));
    details = `Land assessed at $${Math.round(subjectLandPerAcre).toLocaleString()}/acre — ${Math.round((ratio - 1) * 100)}% above market median of $${Math.round(medianPricePerAcre).toLocaleString()}/acre from ${landSales.length} vacant land sales. Strong evidence of land overassessment.`;
  } else if (ratio > 1.20) {
    strength = "moderate";
    const adjustedLand = medianPricePerAcre * subject.acreage;
    suggestedValue = roundTo5k(capReduction(subject.totalValue, adjustedLand + subject.buildingValue));
    details = `Land assessed at $${Math.round(subjectLandPerAcre).toLocaleString()}/acre — ${Math.round((ratio - 1) * 100)}% above market median of $${Math.round(medianPricePerAcre).toLocaleString()}/acre from ${landSales.length} vacant land sales.`;
  } else {
    details = `Land assessment ($${Math.round(subjectLandPerAcre).toLocaleString()}/acre) appears consistent with market rate ($${Math.round(medianPricePerAcre).toLocaleString()}/acre) from ${landSales.length} vacant land sales.`;
  }

  return { applicable: strength !== "none", strength, details, suggestedValue, medianPricePerAcre, saleCount: landSales.length };
}

function analyzeEquityArgument(subject, equityComps) {
  if (equityComps.length < 2) {
    return {
      applicable: false, strength: "none",
      details: `Only ${equityComps.length} similar propert${equityComps.length === 1 ? 'y' : 'ies'} found in your neighborhood — not enough to evaluate equity.`,
      equityComps: equityComps.length, medianEquityAssessment: null, subjectVsEquityMedian: null,
    };
  }

  const medianAssessment = median(equityComps.map(c => c.assessedValue));
  const ratio = medianAssessment > 0 ? subject.totalValue / medianAssessment : 0;
  const pctAbove = Math.round((ratio - 1) * 100);

  let strength = "none";
  let details = "";

  // Check how similar the equity comps are (quality mismatch weakens the argument)
  const qualityMatches = equityComps.filter(c => c.quality === subject.quality).length;
  const qualityMatchRate = qualityMatches / equityComps.length;
  const weakQuality = qualityMatchRate < 0.3 && equityComps.length < 5;

  if (ratio > 1.20) {
    strength = equityComps.length >= 3 ? "strong" : "moderate";
    details = `Your property is assessed at $${subject.totalValue.toLocaleString()} while ${equityComps.length} similar properties (same neighborhood, similar size and age) are assessed at a median of $${medianAssessment.toLocaleString()} — ${pctAbove}% higher than comparable assessments. This suggests inequitable treatment.`;
  } else if (ratio > 1.10) {
    strength = equityComps.length >= 3 ? "moderate" : "weak";
    details = `Your property is assessed at $${subject.totalValue.toLocaleString()} while ${equityComps.length} similar properties are assessed at a median of $${medianAssessment.toLocaleString()} — ${pctAbove}% above. A modest equity gap.`;
  } else if (ratio < 0.95) {
    strength = "none";
    details = `Your property ($${subject.totalValue.toLocaleString()}) is assessed BELOW the median of ${equityComps.length} similar properties ($${medianAssessment.toLocaleString()}). No equity issue — an appeal risks an increase.`;
  } else {
    details = `Your assessment ($${subject.totalValue.toLocaleString()}) is in line with ${equityComps.length} similar properties (median $${medianAssessment.toLocaleString()}). No equity issue found.`;
  }

  // Downgrade if equity comps don't match quality well
  if (weakQuality && (strength === "strong" || strength === "moderate")) {
    details += ` Available comps differ significantly from your property, weakening this comparison.`;
    if (strength === "strong") strength = "moderate";
    else if (strength === "moderate") strength = "weak";
  }

  // Downgrade for land-heavy properties — total assessment gap may be driven by land
  // acreage differences, not building overassessment
  const isLandHeavy = subject.landPctOfTotal > 30 && subject.acreage > 3;
  if (isLandHeavy && (strength === "strong" || strength === "moderate")) {
    const medianCompAcreage = median(equityComps.map(c => c.acreage));
    if (subject.acreage > medianCompAcreage * 1.5) {
      details += ` Your property has significantly more acreage (${subject.acreage.toFixed(1)} vs median ${medianCompAcreage.toFixed(1)}), which may account for much of the assessment difference.`;
      if (strength === "strong") strength = "moderate";
      else if (strength === "moderate") strength = "weak";
    }
  }

  return {
    applicable: strength !== "none",
    strength,
    details,
    equityComps: equityComps.length,
    medianEquityAssessment: medianAssessment,
    subjectVsEquityMedian: Math.round(ratio * 100),
  };
}

// --- Main Analysis ---

function analyzeAppealStrength(subject, scoredComps, landSales, equityComps) {
  const topComps = scoredComps.slice(0, 5);
  const avgSimilarity = topComps.length > 0
    ? topComps.reduce((s, c) => s + c.similarityScore, 0) / topComps.length
    : 0;

  // Run each argument
  const marketArg = analyzeMarketValueArgument(subject, topComps);
  const isLandHeavy = (subject.landPctOfTotal > 40 && subject.acreage > 1) || (subject.landPctOfTotal > 30 && subject.acreage > 3);
  const landArg = isLandHeavy ? analyzeLandValueArgument(subject, landSales || []) : { applicable: false, strength: "none", details: "Property is not land-heavy; land argument not evaluated.", suggestedValue: null };
  const equityArg = analyzeEquityArgument(subject, equityComps || []);

  // --- Apply downgrades ---
  let isSignificantlyNewer = false;
  let isCustomQuality = subject.quality && subject.quality.toUpperCase().includes('CUST');

  // 1. Subject significantly newer than comps (15+ years) — weaken ALL comps-based arguments
  if (subject.yearBuilt > 0 && topComps.some(c => c.yearBuilt > 0)) {
    const compYears = topComps.filter(c => c.yearBuilt > 0).map(c => c.yearBuilt);
    const avgCompYear = compYears.reduce((s, y) => s + y, 0) / compYears.length;
    if (subject.yearBuilt - avgCompYear > 15) {
      isSignificantlyNewer = true;
      const newerNote = ` Your home (built ${subject.yearBuilt}) is significantly newer than available comps (avg. built ${Math.round(avgCompYear)}), which likely accounts for much of the value difference.`;
      // Downgrade market AND equity — newer homes justify higher values
      if (marketArg.strength === "strong") marketArg.strength = "moderate";
      if (marketArg.strength === "moderate") marketArg.strength = "weak";
      if (equityArg.strength === "strong") equityArg.strength = "moderate";
      if (equityArg.strength === "moderate") equityArg.strength = "weak";
      marketArg.details += newerNote;
      equityArg.details += newerNote;
    }
  }

  // 2. Custom quality — weakens comparison to standard comps
  if (isCustomQuality) {
    const custNote = " Your property is rated custom quality, which may justify higher values vs. standard-quality comps.";
    // Custom + newer is a very strong explanation for higher values
    if (isSignificantlyNewer) {
      if (marketArg.strength === "moderate") marketArg.strength = "weak";
      if (equityArg.strength === "moderate") equityArg.strength = "weak";
    } else {
      if (marketArg.strength === "strong") marketArg.strength = "moderate";
    }
    marketArg.details += custNote;
  }

  // 3. Low avg similarity (< 50) — never rate strong; equity is also unreliable with bad comps
  if (avgSimilarity < 50 && topComps.length > 0) {
    if (marketArg.strength === "strong") marketArg.strength = "moderate";
    if (equityArg.strength === "strong") equityArg.strength = "moderate";
    if (avgSimilarity < 35) {
      if (marketArg.strength === "moderate") marketArg.strength = "weak";
      if (equityArg.strength === "moderate") equityArg.strength = "weak";
      const weakNote = " Available comps differ significantly from your property, weakening this comparison.";
      marketArg.details += weakNote;
      equityArg.details += weakNote;
    }
  }

  // 4. Too few comps — cap at moderate
  if (topComps.length < 3) {
    if (marketArg.strength === "strong") marketArg.strength = "moderate";
    if (equityArg.strength === "strong") equityArg.strength = "moderate";
  }

  // 5. Equity override: if equity shows assessment is IN LINE with similar properties,
  // downgrade market value argument — the "overassessment vs sales" is misleading
  if (equityArg.subjectVsEquityMedian != null && equityArg.equityComps >= 3) {
    const eqRatio = equityArg.subjectVsEquityMedian; // e.g. 102 means 2% above median
    if (eqRatio <= 110 && (marketArg.strength === "strong" || marketArg.strength === "moderate")) {
      // Subject is within 10% of similar property assessments — market argument is misleading
      const overrideNote = ` However, equity analysis shows your assessment is consistent with ${equityArg.equityComps} similar properties in your neighborhood (within ${eqRatio <= 100 ? 'below' : (eqRatio - 100) + '% of'} their median assessment of $${(equityArg.medianEquityAssessment || 0).toLocaleString()}). The comparable sales may not reflect your property type.`;
      marketArg.details += overrideNote;
      marketArg.strength = "weak";
    }
  }

  // 6. Custom quality with insufficient equity data — can't validate market argument,
  // so cap market at weak (conservative: don't tell custom homeowners to appeal
  // based solely on comps that don't match their build quality)
  if (isCustomQuality && equityArg.equityComps < 3 && marketArg.strength === "moderate") {
    marketArg.details += " Insufficient similar properties found to validate this comparison for your custom-quality home.";
    marketArg.strength = "weak";
  }

  // --- Determine overall rating ---
  const strengths = [marketArg.strength, landArg.strength, equityArg.strength];
  const hasStrong = strengths.includes("strong");
  const hasModerate = strengths.includes("moderate");
  const hasWeak = strengths.some(s => s === "weak");

  let rating, score, message, riskWarning = null, suggestedValue = null;

  // Collect suggested values from applicable arguments, pick the HIGHER (more conservative)
  const suggestedValues = [marketArg.suggestedValue, landArg.suggestedValue].filter(v => v != null && v > 0);
  if (suggestedValues.length > 0) {
    suggestedValue = Math.max(...suggestedValues);
    suggestedValue = roundTo5k(suggestedValue);
  }

  // Check if we have ANY applicable arguments
  const anyApplicable = marketArg.applicable || landArg.applicable || (equityArg.applicable && equityArg.strength !== 'none');
  
  // Even if market/land/equity arguments are all "none" (not applicable or no case),
  // the equity analysis may have found enough similar properties to confirm the assessment is fair.
  // That's a useful result — "your assessment is in line with similar properties."
  const equityConfirmsFair = !equityArg.applicable && equityArg.equityComps >= 3;
  
  if (!anyApplicable && !hasStrong && !hasModerate && !hasWeak && !equityConfirmsFair) {
    rating = "insufficient";
    score = 0;
    message = "Not enough comparable data to evaluate your assessment. The properties that have sold recently in your area differ too much from yours to draw a reliable conclusion.";
    suggestedValue = null;
    riskWarning = null;
  } else if (!anyApplicable && !hasStrong && !hasModerate && !hasWeak && equityConfirmsFair) {
    // Equity found similar properties and assessment is in line — that's a definitive "fair" result
    rating = "weak";
    score = 15;
    message = `Your assessment appears to be in line with ${equityArg.equityComps} similar properties in your area (median assessment: $${equityArg.medianEquityAssessment?.toLocaleString() || 'N/A'}). Based on this, we do not recommend filing an appeal based on comparable sales.`;
    riskWarning = "Your assessment is consistent with similar properties in your area. Filing an appeal risks your value staying the same or increasing.";
    suggestedValue = null;
  } else if (hasStrong) {
    rating = "strong";
    score = 85;
    const strongArgs = [];
    if (marketArg.strength === "strong") strongArgs.push("market value");
    if (landArg.strength === "strong") strongArgs.push("land value");
    if (equityArg.strength === "strong") strongArgs.push("equity");
    message = `Strong evidence of overassessment based on ${strongArgs.join(" and ")} analysis. Data suggests a potential ${suggestedValue ? Math.round((1 - suggestedValue / subject.totalValue) * 100) : 10}%+ reduction may be supported.`;
  } else if (hasModerate) {
    rating = "moderate";
    score = 55;
    const modArgs = [];
    if (marketArg.strength === "moderate") modArgs.push("market value");
    if (landArg.strength === "moderate") modArgs.push("land value");
    if (equityArg.strength === "moderate") modArgs.push("equity");
    message = `Moderate evidence of overassessment based on ${modArgs.join(" and ")} analysis. A 5-10% reduction may be possible, but the evidence is not overwhelming.`;
  } else if (hasWeak) {
    rating = "weak";
    score = 25;
    message = "Your assessment appears to be at or near market value based on available data. We do not recommend filing an appeal.";
    riskWarning = "Filing an appeal when your property is assessed at or near market value risks the county INCREASING your assessed value. Proceed only if you have additional evidence not captured here (e.g., property condition issues, errors in the county's records).";
    suggestedValue = null;
  } else {
    // All "none" — assessment looks fair or below market
    rating = "weak";
    score = 15;
    message = "Your assessment appears to be at or below market value. Filing an appeal could result in your value staying the same or increasing.";
    riskWarning = "Based on comparable sales, your assessed value appears reasonable. Filing an appeal risks your value INCREASING. We do not recommend proceeding.";
    suggestedValue = null;
  }

  // If we have no comps at all but have some land sales, that's thin
  if (topComps.length === 0 && landSales && landSales.length > 0) {
    if (rating === "strong") rating = "moderate";
    score = Math.min(score, 55);
    message += " Note: No residential comparable sales found — evaluation is based on land data only.";
  }

  // Build analysis summary — only show median if we had enough good comps
  const medianSalePrice = (rating !== 'insufficient' && marketArg.medianSalePrice) ? marketArg.medianSalePrice : null;
  const subjectPerSqft = subject.sqft > 0 ? subject.totalValue / subject.sqft : 0;
  const compPerSqftValues = topComps.filter(c => c.sqft > 0).map(c => c.salePrice / c.sqft);
  const medianCompPerSqft = compPerSqftValues.length > 0 ? median(compPerSqftValues) : 0;

  return {
    rating,
    score,
    message,
    riskWarning,
    suggestedValue,
    arguments: {
      marketValue: {
        applicable: marketArg.applicable,
        strength: marketArg.strength,
        details: marketArg.details,
      },
      landValue: {
        applicable: landArg.applicable,
        strength: landArg.strength,
        details: landArg.details,
      },
      equity: {
        applicable: equityArg.applicable,
        strength: equityArg.strength,
        details: equityArg.details,
      },
    },
    analysis: {
      compCount: topComps.length,
      goodCompCount: topComps.filter(c => c.similarityScore > 50).length,
      medianSalePrice,
      assessmentVsMedianSale: medianSalePrice ? Math.round((subject.totalValue / medianSalePrice) * 100) : null,
      subjectPerSqft: Math.round(subjectPerSqft),
      medianCompPerSqft: Math.round(medianCompPerSqft),
      subjectLandPerAcre: Math.round(subject.landPerAcre),
      avgCompSimilarity: Math.round(avgSimilarity),
      landPctOfTotal: Math.round(subject.landPctOfTotal),
      landSaleCount: landSales ? landSales.length : 0,
      isLandHeavy,
      equityCompCount: equityComps ? equityComps.length : 0,
      medianEquityAssessment: equityArg.medianEquityAssessment,
      subjectVsEquityMedian: equityArg.subjectVsEquityMedian,
    },
  };
}

// --- Handler ---

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const pin = sanitizePin(req.query.pin);
    if (!pin) return res.status(400).json({ error: "Invalid PIN" });

    const subject = await getPropertyDetails(pin);
    if (!subject) return res.status(404).json({ error: "Property not found" });

    // Only screen residential properties
    if (!['100', '101', '121', '170', '180'].includes(subject.propertyClass)) {
      return res.json({
        subject,
        screening: {
          rating: "unsupported",
          score: 0,
          message: "Appeal screening is currently available for residential properties only.",
          riskWarning: null,
          suggestedValue: null,
          arguments: {
            marketValue: { applicable: false, strength: "none", details: "" },
            landValue: { applicable: false, strength: "none", details: "" },
            equity: { applicable: false, strength: "none", details: "" },
          },
          analysis: {},
        },
        comps: [],
        landSales: [],
      });
    }

    // Run all three searches IN PARALLEL to stay within Vercel timeout
    const isLandHeavy = (subject.landPctOfTotal > 40 && subject.acreage > 1) || (subject.landPctOfTotal > 30 && subject.acreage > 3);
    const [rawComps, landSales, equityComps] = await Promise.all([
      findComparableSales(subject).catch(e => { console.error('Comp search error:', e.message); return []; }),
      isLandHeavy ? findVacantLandSales(subject).catch(e => { console.error('Land search error:', e.message); return []; }) : Promise.resolve([]),
      findEquityComps(subject).catch(e => { console.error('Equity search error:', e.message); return []; }),
    ]);
    const scoredComps = scoreComps(subject, rawComps);

    // Run analysis
    const screening = analyzeAppealStrength(subject, scoredComps, landSales, equityComps);

    // Pricing tier
    let priceTier = 15;
    if (subject.totalValue < 200000) priceTier = 10;
    else if (subject.totalValue > 500000) priceTier = 25;

    res.json({
      subject,
      screening,
      comps: scoredComps.slice(0, 8),
      landSales: landSales.slice(0, 10),
      equityComps: equityComps.slice(0, 10),

      pricing: {
        amount: priceTier,
        tier: subject.totalValue < 200000 ? "under200k" : subject.totalValue > 500000 ? "over500k" : "200to500k",
      },
    });
  } catch (error) {
    console.error("Appeal screening error:", error);
    res.status(500).json({ error: "Screening failed" });
  }
};
