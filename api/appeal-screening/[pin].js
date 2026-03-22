const { CURRENT_LAYER, CURRENT_FIELDS, queryArcGIS, parseValue, derivePropertyLocation } = require("../_shared");

// County comp criteria: within few miles, ±10 years age, same property type, 
// similar sqft/acreage, sold within 24 months before Jan 1 2026, qualified sales only
const COMP_LAYER = "https://gis.buncombecounty.org/arcgis/rest/services/opendata/MapServer/1";
const PRC_BASE = "https://prc-buncombe.spatialest.com/api/v1/recordcard";

async function getPropertyDetails(pin) {
  const results = await queryArcGIS(CURRENT_LAYER, `PIN = '${pin}'`, CURRENT_FIELDS, 1);
  if (!results.length) return null;
  const r = results[0];
  
  // Get PRC data for building details
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
  
  return {
    pin: r.PIN,
    owner: r.Owner || "",
    address: [r.HouseNumber, r.StreetPrefix, r.StreetName, r.StreetType].filter(Boolean).join(" "),
    neighborhood: r.NeighborhoodCode || "",
    propertyClass: r.Class || "",
    acreage: parseFloat(r.Acreage) || 0,
    totalValue: parseValue(r.TotalMarketValue),
    landValue: parseValue(r.LandValue),
    buildingValue: parseValue(r.BuildingValue),
    sqft: building ? parseInt(building.TotalFinishedArea) || 0 : 0,
    yearBuilt: building ? parseInt(building.YearBuilt) || 0 : 0,
    bedrooms: building ? parseInt(building.Bedrooms) || 0 : 0,
    fullBaths: building ? parseInt(building.FullBath) || 0 : 0,
    halfBaths: building ? parseInt(building.HalfBath) || 0 : 0,
    buildingType: building ? building.BuildingType || "" : "",
    quality: building ? building.Quality || "" : "",
    condition: building ? building.PhysicalCondition || "" : "",
    landPctOfTotal: parseValue(r.LandValue) / Math.max(parseValue(r.TotalMarketValue), 1) * 100,
  };
}

async function findComparableSales(subject) {
  // Get recent sales in the same neighborhood, same class
  const where = `Class = '${subject.propertyClass}' AND NeighborhoodCode = '${subject.neighborhood}' AND SalePrice IS NOT NULL AND SalePrice <> '0' AND PIN <> '${subject.pin}'`;
  const fields = "PIN,Owner,HouseNumber,StreetPrefix,StreetName,StreetType,Acreage,TotalMarketValue,LandValue,BuildingValue,SalePrice,DeedDate,NeighborhoodCode";
  const results = await queryArcGIS(COMP_LAYER, where, fields, 50);
  
  // Fetch PRC data for qualified sales and building details
  const comps = [];
  const checked = new Set();
  
  for (const r of results.slice(0, 20)) {
    const compPin = r.PIN;
    if (checked.has(compPin)) continue;
    checked.add(compPin);
    
    try {
      const prcRes = await fetch(`${PRC_BASE}/${compPin}`);
      if (!prcRes.ok) continue;
      const prc = await prcRes.json();
      const sections = prc?.parcel?.sections || [];
      
      // Get building info
      let bldg = {};
      if (sections[2] && typeof sections[2] === 'object' && sections[2]['1'] && sections[2]['1'][0]) {
        bldg = sections[2]['1'][0];
      }
      
      const yearBuilt = parseInt(bldg.YearBuilt) || 0;
      const sqft = parseInt(bldg.TotalFinishedArea) || 0;
      
      // Get transfer history - find qualified sales
      const transfers = (sections[3] && sections[3][0]) || [];
      for (const t of transfers) {
        if (t.salesvalidity !== 'Qualified Sale') continue;
        const priceStr = (t.saleprice || "$0").replace(/[$,]/g, "");
        const price = parseInt(priceStr) || 0;
        if (price < 50000) continue;
        
        // Parse sale date
        const dateParts = (t.saledate || "").split("/");
        if (dateParts.length !== 3) continue;
        const saleDate = new Date(parseInt(dateParts[2]), parseInt(dateParts[0]) - 1, parseInt(dateParts[1]));
        
        // Filter: sold within 24 months before Jan 1, 2026
        const cutoffStart = new Date(2024, 0, 1);
        const cutoffEnd = new Date(2026, 0, 1);
        if (saleDate < cutoffStart || saleDate > cutoffEnd) continue;
        
        // Filter: similar age (±10 years)
        if (yearBuilt > 0 && subject.yearBuilt > 0 && Math.abs(yearBuilt - subject.yearBuilt) > 10) continue;
        
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
          bedrooms: parseInt(bldg.Bedrooms) || 0,
          fullBaths: parseInt(bldg.FullBath) || 0,
          halfBaths: parseInt(bldg.HalfBath) || 0,
          propCard: `https://prc-buncombe.spatialest.com/#/property/${compPin}`,
        });
        break; // Only use the most recent qualified sale per property
      }
    } catch (e) {}
    
    // Rate limit protection
    await new Promise(r => setTimeout(r, 200));
  }
  
  return comps;
}

function scoreComps(subject, comps) {
  // Score each comp by similarity to subject
  return comps.map(comp => {
    let score = 100;
    
    // Sqft difference (most important)
    if (subject.sqft > 0 && comp.sqft > 0) {
      const sqftDiff = Math.abs(subject.sqft - comp.sqft) / subject.sqft;
      score -= sqftDiff * 40; // Up to 40 points off for size difference
    }
    
    // Acreage difference
    const acDiff = Math.abs(subject.acreage - comp.acreage) / Math.max(subject.acreage, 0.1);
    score -= Math.min(acDiff * 20, 20);
    
    // Age difference
    if (subject.yearBuilt > 0 && comp.yearBuilt > 0) {
      const ageDiff = Math.abs(subject.yearBuilt - comp.yearBuilt);
      score -= ageDiff * 1.5; // 1.5 points per year
    }
    
    // Bedroom match
    if (subject.bedrooms > 0 && comp.bedrooms > 0) {
      score -= Math.abs(subject.bedrooms - comp.bedrooms) * 5;
    }
    
    return { ...comp, similarityScore: Math.max(score, 0) };
  }).sort((a, b) => b.similarityScore - a.similarityScore);
}

function analyzeAppealStrength(subject, comps) {
  if (comps.length === 0) {
    return {
      rating: "insufficient",
      score: 0,
      message: "Not enough comparable sales data in your neighborhood to evaluate your assessment.",
      riskWarning: null,
      suggestedValue: null,
      analysis: { compCount: 0 },
    };
  }
  
  // Use top 5 comps
  const topComps = comps.slice(0, 5);
  
  // Assessment-to-sale ratios
  const ratios = topComps.map(c => c.assessedValue / c.salePrice);
  const avgRatio = ratios.reduce((s, r) => s + r, 0) / ratios.length;
  
  // Per-sqft comparison
  const subjectPerSqft = subject.sqft > 0 ? subject.totalValue / subject.sqft : 0;
  const compPerSqft = topComps
    .filter(c => c.sqft > 0)
    .map(c => c.salePrice / c.sqft);
  const medianCompPerSqft = compPerSqft.length > 0
    ? compPerSqft.sort((a, b) => a - b)[Math.floor(compPerSqft.length / 2)]
    : 0;
  
  // Suggested value based on comp median per-sqft
  const suggestedByComps = medianCompPerSqft > 0 && subject.sqft > 0
    ? Math.round(medianCompPerSqft * subject.sqft / 1000) * 1000
    : null;
  
  // Per-acre land comparison  
  const subjectLandPerAcre = subject.acreage > 0 ? subject.landValue / subject.acreage : 0;
  const compLandPerAcre = topComps
    .filter(c => c.acreage > 0)
    .map(c => c.landValue / c.acreage);
  const medianCompLandPerAcre = compLandPerAcre.length > 0
    ? compLandPerAcre.sort((a, b) => a - b)[Math.floor(compLandPerAcre.length / 2)]
    : 0;
  
  // Determine rating
  let rating, score, message, riskWarning = null, suggestedValue = null;
  
  // Check if comps suggest assessment is too high
  const medianSalePrice = topComps.map(c => c.salePrice).sort((a, b) => a - b)[Math.floor(topComps.length / 2)];
  const assessmentVsMedianSale = subject.totalValue / medianSalePrice;
  
  if (assessmentVsMedianSale > 1.15 && subjectPerSqft > medianCompPerSqft * 1.1) {
    // Assessment is significantly above comp sales
    rating = "strong";
    score = 85;
    suggestedValue = suggestedByComps;
    message = `Your assessed value of $${subject.totalValue.toLocaleString()} appears to be above market value based on ${topComps.length} comparable sales. Similar properties have sold for a median of $${medianSalePrice.toLocaleString()}.`;
  } else if (assessmentVsMedianSale > 1.05) {
    rating = "moderate";
    score = 60;
    suggestedValue = suggestedByComps;
    message = `Your assessed value may be slightly above market value. Comparable sales suggest a median value around $${medianSalePrice.toLocaleString()}, but the difference is modest.`;
  } else if (assessmentVsMedianSale < 0.95) {
    rating = "weak";
    score = 20;
    riskWarning = "Based on comparable sales, your assessed value appears to be at or below market value. Filing an appeal could result in your value staying the same or INCREASING. We do not recommend proceeding.";
    message = `Similar properties have sold for a median of $${medianSalePrice.toLocaleString()}, which is above your assessed value of $${subject.totalValue.toLocaleString()}.`;
  } else {
    rating = "weak";
    score = 35;
    message = `Your assessed value appears to be roughly in line with comparable sales (median: $${medianSalePrice.toLocaleString()}). There may not be enough evidence to support a reduction.`;
  }
  
  // Check for insufficient/poor comp quality
  if (topComps.length < 3) {
    rating = "insufficient";
    score = Math.min(score, 30);
    message = `Only ${topComps.length} comparable sale(s) found. The county typically wants 3+ comps within similar criteria. ${message}`;
  }
  
  // Check for high similarity score variance (comps aren't very similar)
  const avgSimilarity = topComps.reduce((s, c) => s + c.similarityScore, 0) / topComps.length;
  if (avgSimilarity < 50) {
    message += " Note: Available comps differ significantly from your property in size, age, or acreage, which weakens the comparison.";
    score = Math.max(score - 15, 0);
  }
  
  return {
    rating, // "strong", "moderate", "weak", "insufficient"
    score,  // 0-100
    message,
    riskWarning,
    suggestedValue,
    analysis: {
      compCount: topComps.length,
      medianSalePrice,
      assessmentVsMedianSale: Math.round(assessmentVsMedianSale * 100),
      subjectPerSqft: Math.round(subjectPerSqft),
      medianCompPerSqft: Math.round(medianCompPerSqft),
      subjectLandPerAcre: Math.round(subjectLandPerAcre),
      medianCompLandPerAcre: Math.round(medianCompLandPerAcre),
      avgCompSimilarity: Math.round(avgSimilarity),
      landPctOfTotal: Math.round(subject.landPctOfTotal),
    },
  };
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();
  
  try {
    const { pin } = req.query;
    if (!pin) return res.status(400).json({ error: "PIN required" });
    
    // Get subject property details
    const subject = await getPropertyDetails(pin);
    if (!subject) return res.status(404).json({ error: "Property not found" });
    
    // Only screen residential properties
    if (!['100', '101', '121'].includes(subject.propertyClass)) {
      return res.json({
        subject,
        screening: {
          rating: "unsupported",
          score: 0,
          message: "Appeal screening is currently available for residential properties only.",
          riskWarning: null,
          suggestedValue: null,
          analysis: {},
        },
        comps: [],
      });
    }
    
    // Find comparable sales
    const rawComps = await findComparableSales(subject);
    const scoredComps = scoreComps(subject, rawComps);
    const screening = analyzeAppealStrength(subject, scoredComps);
    
    // Determine pricing tier
    let priceTier = 15;
    if (subject.totalValue < 200000) priceTier = 10;
    else if (subject.totalValue > 500000) priceTier = 25;
    
    res.json({
      subject,
      screening,
      comps: scoredComps.slice(0, 8),
      pricing: {
        amount: priceTier,
        tier: subject.totalValue < 200000 ? "under200k" : subject.totalValue > 500000 ? "over500k" : "200to500k",
      },
    });
  } catch (error) {
    console.error("Appeal screening error:", error);
    res.status(500).json({ error: error.message || "Screening failed" });
  }
};
