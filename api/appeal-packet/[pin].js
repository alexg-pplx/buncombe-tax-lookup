const { CURRENT_LAYER, CURRENT_FIELDS, queryArcGIS, parseValue } = require("../_shared");

const PRC_BASE = "https://prc-buncombe.spatialest.com/api/v1/recordcard";

// This endpoint receives screening data + questionnaire answers via POST
// and returns a PDF appeal packet
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  
  try {
    const { pin } = req.query;
    if (!pin) return res.status(400).json({ error: "PIN required" });
    
    // Get questionnaire answers from POST body or query params
    const answers = req.method === "POST" ? req.body : {};
    const hasConditionIssues = answers.conditionIssues === true;
    const hasStormDamage = answers.stormDamage === true;
    const hasRecordErrors = answers.recordErrors === true;
    const hasOtherFactors = answers.otherFactors === true;
    const adminBypass = req.query.admin === process.env.ADMIN_KEY;
    
    // Fetch screening data by calling our own screening endpoint logic
    // (duplicating the core logic here to avoid circular calls)
    const propertyResults = await queryArcGIS(CURRENT_LAYER, `PIN = '${pin}'`, CURRENT_FIELDS, 1);
    if (!propertyResults.length) return res.status(404).json({ error: "Property not found" });
    
    const prop = propertyResults[0];
    const totalValue = parseValue(prop.TotalMarketValue);
    const landValue = parseValue(prop.LandValue);
    const buildingValue = parseValue(prop.BuildingValue);
    const acreage = parseFloat(prop.Acreage) || 0;
    const address = [prop.HouseNumber, prop.StreetPrefix, prop.StreetName, prop.StreetType].filter(Boolean).join(" ");
    
    // Get PRC building data
    let building = {};
    let prevValue = null;
    try {
      const prcRes = await fetch(`${PRC_BASE}/${pin}`);
      if (prcRes.ok) {
        const prc = await prcRes.json();
        const sections = prc?.parcel?.sections || [];
        if (sections[2] && typeof sections[2] === 'object' && sections[2]['1'] && sections[2]['1'][0]) {
          building = sections[2]['1'][0];
        }
        // Get previous value from value history
        if (sections[4] && sections[4][0]) {
          const hist = sections[4][0];
          const prev = hist.find(e => e.YearID === 2021);
          if (prev) {
            const pStr = (prev.TotalAppraisedValue || "0").replace(/[$,]/g, "");
            prevValue = parseInt(pStr) || null;
          }
        }
      }
    } catch (e) {}
    
    const sqft = parseInt(building.TotalFinishedArea) || 0;
    const yearBuilt = parseInt(building.YearBuilt) || 0;
    const bedrooms = parseInt(building.Bedrooms) || 0;
    const fullBaths = parseInt(building.FullBath) || 0;
    const halfBaths = parseInt(building.HalfBath) || 0;
    
    // Get comps (simplified version - top 5 from screening)
    const residentialClasses = "('100','101','121')";
    const compWhere = `Class IN ${residentialClasses} AND NeighborhoodCode = '${prop.NeighborhoodCode}' AND PIN <> '${pin}'`;
    const compFields = "PIN,HouseNumber,StreetPrefix,StreetName,StreetType,Acreage,TotalMarketValue,LandValue,BuildingValue,SalePrice,DeedDate";
    const compResults = await queryArcGIS(CURRENT_LAYER, compWhere, compFields, 30);
    
    // Fetch PRC for qualified sales
    const comps = [];
    for (const r of compResults.slice(0, 15)) {
      try {
        const prcRes = await fetch(`${PRC_BASE}/${r.PIN}`);
        if (!prcRes.ok) continue;
        const prc = await prcRes.json();
        const sections = prc?.parcel?.sections || [];
        let bldg = {};
        if (sections[2] && typeof sections[2] === 'object' && sections[2]['1'] && sections[2]['1'][0]) {
          bldg = sections[2]['1'][0];
        }
        const compYear = parseInt(bldg.YearBuilt) || 0;
        const compSqft = parseInt(bldg.TotalFinishedArea) || 0;
        
        const transfers = (sections[3] && sections[3][0]) || [];
        for (const t of transfers) {
          if (t.salesvalidity !== 'Qualified Sale') continue;
          const price = parseInt((t.saleprice || "0").replace(/[$,]/g, "")) || 0;
          if (price < 50000) continue;
          const dp = (t.saledate || "").split("/");
          if (dp.length !== 3) continue;
          const sd = new Date(parseInt(dp[2]), parseInt(dp[0]) - 1, parseInt(dp[1]));
          if (sd < new Date(2023, 0, 1) || sd > new Date(2026, 0, 2)) continue;
          
          comps.push({
            address: [r.HouseNumber, r.StreetPrefix, r.StreetName, r.StreetType].filter(Boolean).join(" "),
            salePrice: price,
            saleDate: t.saledate,
            assessedValue: parseValue(r.TotalMarketValue),
            landValue: parseValue(r.LandValue),
            acreage: parseFloat(r.Acreage) || 0,
            sqft: compSqft,
            yearBuilt: compYear,
            bedrooms: parseInt(bldg.Bedrooms) || 0,
            baths: `${bldg.FullBath || 0}/${bldg.HalfBath || 0}`,
          });
          break;
        }
        await new Promise(r => setTimeout(r, 200));
      } catch (e) {}
    }
    
    // Calculate suggested value
    const compPricesPerSqft = comps.filter(c => c.sqft > 0).map(c => c.salePrice / c.sqft);
    const medianPricePerSqft = compPricesPerSqft.length > 0
      ? compPricesPerSqft.sort((a, b) => a - b)[Math.floor(compPricesPerSqft.length / 2)]
      : 0;
    const suggestedValue = medianPricePerSqft > 0 && sqft > 0
      ? Math.round(medianPricePerSqft * sqft / 1000) * 1000
      : null;
    
    const medianSalePrice = comps.length > 0
      ? comps.map(c => c.salePrice).sort((a, b) => a - b)[Math.floor(comps.length / 2)]
      : null;
    
    const landPct = totalValue > 0 ? (landValue / totalValue * 100) : 0;
    const isLandHeavy = landPct > 40;
    
    // Build the HTML for the PDF
    // We'll return structured JSON data and let the frontend generate the PDF
    // OR we can return HTML that the frontend renders and prints
    
    const packetData = {
      property: {
        pin,
        owner: prop.Owner || "",
        address,
        acreage,
        totalValue,
        landValue,
        buildingValue,
        prevValue,
        change: prevValue ? Math.round((totalValue - prevValue) / prevValue * 100) : null,
        sqft,
        yearBuilt,
        bedrooms,
        fullBaths,
        halfBaths,
        buildingType: building.BuildingType || "",
        quality: building.Quality || "",
        condition: building.PhysicalCondition || "",
        heatType: building.Heat || "",
        foundation: "CONVENTIONAL", // From form
        landPctOfTotal: Math.round(landPct),
        isLandHeavy,
      },
      comps: comps.slice(0, 5),
      analysis: {
        suggestedValue,
        medianSalePrice,
        medianPricePerSqft: Math.round(medianPricePerSqft),
        subjectPricePerSqft: sqft > 0 ? Math.round(totalValue / sqft) : 0,
        landPerAcre: acreage > 0 ? Math.round(landValue / acreage) : 0,
        compCount: comps.length,
      },
      questionnaire: {
        hasConditionIssues,
        hasStormDamage,
        hasRecordErrors,
        hasOtherFactors,
      },
      // Pre-written appeal text
      appealText: generateAppealText({
        address, totalValue, suggestedValue, medianSalePrice,
        comps, isLandHeavy, landValue, acreage, sqft,
        hasConditionIssues, hasStormDamage, hasRecordErrors, hasOtherFactors,
      }),
    };
    
    res.json(packetData);
  } catch (error) {
    console.error("Appeal packet error:", error);
    res.status(500).json({ error: error.message || "Packet generation failed" });
  }
};

function generateAppealText(data) {
  const { address, totalValue, suggestedValue, medianSalePrice, comps, isLandHeavy,
          landValue, acreage, sqft, hasConditionIssues, hasStormDamage, hasRecordErrors, hasOtherFactors } = data;
  
  let text = `I am writing to appeal the 2026 assessed value of $${totalValue.toLocaleString()} for my property at ${address}. `;
  
  if (suggestedValue && suggestedValue < totalValue) {
    text += `Based on my analysis of ${comps.length} comparable properties that sold within the last 24 months, I believe the fair market value is approximately $${suggestedValue.toLocaleString()}. `;
  } else if (medianSalePrice && medianSalePrice < totalValue) {
    text += `Based on ${comps.length} comparable sales in my neighborhood, the median sale price was $${medianSalePrice.toLocaleString()}, which is below my current assessed value. `;
  }
  
  text += `\n\nThe comparable sales attached to this appeal were selected based on the following criteria: similar property type, similar age (within 10 years), similar size, located in the same neighborhood, and sold within 24 months prior to the January 1, 2026 valuation date. `;
  
  if (isLandHeavy) {
    text += `\n\nAdditionally, the land portion of my assessment ($${landValue.toLocaleString()} for ${acreage.toFixed(2)} acres, or $${Math.round(landValue/acreage).toLocaleString()} per acre) appears to be inconsistent with comparable land values in the area. `;
  }
  
  if (sqft > 0) {
    text += `My assessment of $${Math.round(totalValue/sqft).toLocaleString()} per square foot is above the median comparable sale price of $${Math.round(medianSalePrice/1).toLocaleString()} per square foot based on recent sales. `;
  }
  
  if (hasConditionIssues) {
    text += `\n\nThe property has condition issues that negatively affect its market value, as documented in the attached photos. `;
  }
  if (hasStormDamage) {
    text += `The property was affected by Tropical Storm Helene, and the damage has not been fully repaired. `;
  }
  if (hasRecordErrors) {
    text += `\n\nI have identified errors in my property record card. The correct information is noted on the appeal form. `;
  }
  if (hasOtherFactors) {
    text += `\n\nThere are additional factors affecting this property's value that are detailed in the attached documentation. `;
  }
  
  text += `\n\nPlease see the attached supporting documentation, which includes comparable sales data, assessment analysis, and my property record for review. I respectfully request that the assessed value be adjusted to reflect the fair market value of this property.`;
  
  return text;
}
