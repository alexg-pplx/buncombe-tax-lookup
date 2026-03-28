const { queryArcGIS, parseValue, sanitizePin, normalizePIN, COMP_SALE_START_DATE } = require("../_shared");

// Use property_bc_dis layer which has actual sale prices (not stamps values)
const SALES_LAYER = "https://gis.buncombecounty.org/arcgis/rest/services/property_bc_dis/MapServer/1";

const PRC_BASE = "https://prc-buncombe.spatialest.com/api/v1";

async function getRecordCard(pin) {
  try {
    const res = await fetch(`${PRC_BASE}/recordcard/${pin}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const sections = data?.parcel?.sections;
    if (!sections || !Array.isArray(sections)) return null;

    // Section 2 = buildings
    const buildings = sections[2];
    if (!buildings) return null;

    // Get first building data
    let bldg = null;
    if (typeof buildings === "object" && !Array.isArray(buildings)) {
      const key = Object.keys(buildings).find(
        (k) => k !== "title" && buildings[k]
      );
      if (key) {
        const val = buildings[key];
        if (Array.isArray(val)) {
          bldg = val.find((b) => b.buildingId === 1) || val[0];
        }
      }
    }

    if (!bldg) return null;

    return {
      yearBuilt: bldg.YearBuilt || null,
      bedrooms: parseInt(bldg.Bedrooms) || null,
      fullBath: parseInt(bldg.FullBath) || 0,
      halfBath: parseInt(bldg.HalfBath) || 0,
      sqft: parseInt(String(bldg.TotalFinishedArea).replace(/,/g, "")) || null,
      buildingType: bldg.BuildingType || null,
      quality: bldg.Quality || null,
      stories: parseFloat(bldg.StoryHeight) || null,
    };
  } catch (e) {
    console.warn("PRC fetch failed for", pin, e.message);
    return null;
  }
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const rawPin = normalizePIN(req.query.pin) || sanitizePin(req.query.pin);
    if (!rawPin) return res.status(400).json({ error: "Invalid PIN" });

    // Accept both 10-digit pin and 15-digit pinnum formats
    // The site's hash router uses 15-digit pinnum (e.g., 964935705100000)
    // The property_bc_dis layer has both pin (10-digit) and pinnum (15-digit)
    const isFullPin = rawPin.length > 10;
    const pinField = isFullPin ? "pinnum" : "pin";
    const pin = rawPin;

    // Step 1: Get subject property details from GIS (property_bc_dis has real sale prices)
    // Note: property_bc_dis returns mixed-case field names: pin, owner, streetname are lowercase
    // but NeighborhoodCode, HouseNumber, StreetType, SalePrice, TotalMarketValue, etc. are as-is
    const subjectResults = await queryArcGIS(
      SALES_LAYER,
      `${pinField} = '${pin}'`,
      "pin,pinnum,NeighborhoodCode,Class,Acreage,TotalMarketValue,LandValue,BuildingValue,SalePrice,DeedDate",
      1
    );

    if (subjectResults.length === 0) {
      return res.status(404).json({ error: "Property not found" });
    }

    const subject = subjectResults[0];
    const neighborhoodCode = (subject.NeighborhoodCode || "").trim();
    const propertyClass = (subject.Class || "").trim();
    const subjectValue = parseValue(subject.TotalMarketValue);
    // Use the 10-digit pin for exclusion and response (consistent field)
    const subjectPin10 = subject.pin;

    // Step 2: Get subject building details from PRC
    // PRC API requires the full 15-digit pinnum (not the 10-digit pin)
    const subjectPinnum = subject.pinnum || (subjectPin10 + "00000");
    const subjectBuilding = await getRecordCard(subjectPinnum);

    // Step 3: Find comparable sales from GIS
    // Group residential classes together (100, 101, 121) so a 101 property gets 100 and 121 comps too
    // Manufactured homes (170) search their own class
    const residentialClasses = ['100', '101', '121'];
    const isManufactured = propertyClass === '170';
    const classFilter = isManufactured
      ? `Class = '170'`
      : (residentialClasses.includes(propertyClass)
        ? `Class IN ('100','101','121')`
        : `Class = '${propertyClass}'`);
    
    const salesWhere = [
      `NeighborhoodCode = '${neighborhoodCode}'`,
      classFilter,
      `SalePrice > 50000`,
      `DeedDate >= '${COMP_SALE_START_DATE.replace(/-/g, '')}'`,
      `pin <> '${subjectPin10}'`,
    ].join(" AND ");

    let sales = await queryArcGIS(
      SALES_LAYER,
      salesWhere,
      "pin,pinnum,owner,HouseNumber,streetname,StreetType,SalePrice,DeedDate,TotalMarketValue,LandValue,BuildingValue,Acreage,NeighborhoodCode",
      50
    );

    // If not enough results in same neighborhood, expand to wider search
    if (sales.length < 3 && neighborhoodCode) {
      const area = neighborhoodCode.split("-")[0];
      if (area) {
        const widerWhere = [
          `NeighborhoodCode LIKE '${area}-%'`,
          classFilter,
          `SalePrice > 50000`,
          `DeedDate >= '${COMP_SALE_START_DATE.replace(/-/g, '')}'`,
          `pin <> '${subjectPin10}'`,
        ].join(" AND ");
        const widerSales = await queryArcGIS(
          SALES_LAYER,
          widerWhere,
          "pin,pinnum,owner,HouseNumber,streetname,StreetType,SalePrice,DeedDate,TotalMarketValue,LandValue,BuildingValue,Acreage,NeighborhoodCode",
          50
        );
        // Combine, dedup by pin
        const seen = new Set(sales.map((s) => s.pin));
        for (const s of widerSales) {
          if (!seen.has(s.pin)) {
            sales.push(s);
            seen.add(s.pin);
          }
        }
      }
    }

    // Step 4: Enrich top candidates with building details from PRC
    // Sort by deed date (most recent first), limit to enriching top 10
    sales.sort((a, b) => {
      const da = a.DeedDate || "0";
      const db = b.DeedDate || "0";
      return db.localeCompare(da);
    });

    const topSales = sales.slice(0, 10);

    // Fetch building details for each (with controlled concurrency)
    const enriched = [];
    for (let i = 0; i < topSales.length; i += 3) {
      const batch = topSales.slice(i, i + 3);
      const results = await Promise.all(
        batch.map(async (sale) => {
          // PRC needs 15-digit pinnum, not 10-digit pin
          const salePinnum = sale.pinnum || (sale.pin + "00000");
          const building = await getRecordCard(salePinnum);
          const salePrice = sale.SalePrice || 0;
          const assessedValue = parseValue(sale.TotalMarketValue);
          const ratio =
            salePrice > 0
              ? Math.round((assessedValue / salePrice) * 100)
              : null;

          return {
            pin: sale.pin,
            pinnum: salePinnum,
            address: [sale.HouseNumber, sale.streetname, sale.StreetType]
              .filter(Boolean)
              .join(" "),
            owner: sale.owner || null,
            propCard: `https://prc-buncombe.spatialest.com/#/property/${salePinnum}`,
            salePrice,
            saleDate: sale.DeedDate || null,
            assessedValue2026: assessedValue,
            assessmentRatio: ratio,
            acreage: sale.Acreage || 0,
            neighborhoodCode: (sale.NeighborhoodCode || "").trim(),
            yearBuilt: building?.yearBuilt || null,
            bedrooms: building?.bedrooms || null,
            fullBath: building?.fullBath || null,
            halfBath: building?.halfBath || null,
            sqft: building?.sqft || null,
            buildingType: building?.buildingType || null,
          };
        })
      );
      enriched.push(...results);
    }

    // Step 5: Score comparables by similarity to subject
    const subjectSqft = subjectBuilding?.sqft || null;
    const subjectYearBuilt = subjectBuilding?.yearBuilt || null;
    const subjectBedrooms = subjectBuilding?.bedrooms || null;

    const scored = enriched.map((comp) => {
      let score = 0;
      // Neighborhood match (same vs area)
      if (comp.neighborhoodCode === neighborhoodCode) score += 30;
      else score += 15;
      // Sqft similarity
      if (subjectSqft && comp.sqft) {
        const pctDiff = Math.abs(comp.sqft - subjectSqft) / subjectSqft;
        if (pctDiff < 0.1) score += 25;
        else if (pctDiff < 0.2) score += 20;
        else if (pctDiff < 0.3) score += 15;
        else if (pctDiff < 0.5) score += 5;
      }
      // Year built similarity
      if (subjectYearBuilt && comp.yearBuilt) {
        const diff = Math.abs(comp.yearBuilt - subjectYearBuilt);
        if (diff <= 5) score += 15;
        else if (diff <= 10) score += 10;
        else if (diff <= 20) score += 5;
      }
      // Bedroom match
      if (subjectBedrooms && comp.bedrooms) {
        const diff = Math.abs(comp.bedrooms - subjectBedrooms);
        if (diff === 0) score += 15;
        else if (diff === 1) score += 10;
        else if (diff === 2) score += 5;
      }
      // Recency bonus
      if (comp.saleDate) {
        const year = parseInt(comp.saleDate.substring(0, 4));
        if (year >= 2025) score += 15;
        else if (year >= 2024) score += 10;
        else score += 5;
      }
      return { ...comp, similarityScore: score };
    });

    // Sort by similarity score, take top 8
    scored.sort((a, b) => b.similarityScore - a.similarityScore);
    const comparables = scored.slice(0, 8);

    // Step 6: Compute summary stats
    const withRatios = comparables.filter((c) => c.assessmentRatio !== null);
    const avgRatio =
      withRatios.length > 0
        ? Math.round(
            withRatios.reduce((s, c) => s + c.assessmentRatio, 0) /
              withRatios.length
          )
        : null;
    const overAssessed = withRatios.filter((c) => c.assessmentRatio > 105);
    const underAssessed = withRatios.filter((c) => c.assessmentRatio < 95);

    // Compare subject to recent sales
    const salesWithPrice = comparables.filter((c) => c.salePrice > 0);
    const medianSalePrice =
      salesWithPrice.length > 0
        ? salesWithPrice
            .map((c) => c.salePrice)
            .sort((a, b) => a - b)[Math.floor(salesWithPrice.length / 2)]
        : null;

    let subjectVsComps = null;
    if (medianSalePrice && subjectValue > 0) {
      const diff = subjectValue - medianSalePrice;
      const pct = Math.round((diff / medianSalePrice) * 100);
      subjectVsComps = {
        subjectAssessed: subjectValue,
        medianSalePrice,
        difference: diff,
        percentDifference: pct,
      };
    }

    res.json({
      subject: {
        pin: subjectPin10,
        pinnum: subjectPinnum,
        propCard: `https://prc-buncombe.spatialest.com/#/property/${subjectPinnum}`,
        assessedValue: subjectValue,
        acreage: subject.Acreage || 0,
        neighborhoodCode,
        propertyClass,
        building: subjectBuilding,
      },
      comparables,
      summary: {
        totalFound: sales.length,
        displayed: comparables.length,
        averageAssessmentRatio: avgRatio,
        overAssessedCount: overAssessed.length,
        underAssessedCount: underAssessed.length,
        subjectVsComps,
      },
    });
  } catch (error) {
    console.error("Comparables error:", error);
    res
      .status(500)
      .json({ error: "Failed to fetch comparables" });
  }
};
