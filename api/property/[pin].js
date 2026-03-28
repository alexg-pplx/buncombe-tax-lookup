const { CURRENT_LAYER, PREVIOUS_LAYER, CURRENT_FIELDS, PREVIOUS_FIELDS, queryArcGIS, parseValue, sanitizePin, normalizePIN, derivePropertyLocation, detectTaxDistrict, getNeighborhoodData } = require("../_shared");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const pin = normalizePIN(req.query.pin) || sanitizePin(req.query.pin);
    if (!pin) return res.status(400).json({ error: "Invalid PIN" });

    const [currentResults, previousResults] = await Promise.all([
      queryArcGIS(CURRENT_LAYER, `PIN = '${pin}'`, CURRENT_FIELDS, 1),
      queryArcGIS(PREVIOUS_LAYER, `PIN = '${pin}'`, PREVIOUS_FIELDS, 1),
    ]);

    if (currentResults.length === 0) return res.status(404).json({ error: "Property not found" });

    const current = currentResults[0];
    const previous = previousResults.length > 0 ? previousResults[0] : null;
    const detectedDistrictCode = detectTaxDistrict(current.City || "", current.FireDistrict || "");
    const derivedLoc = derivePropertyLocation(current.City || "", current.FireDistrict || "");

    const neighborhoodCode = (current.NeighborhoodCode || "").trim();
    const neighborhood = getNeighborhoodData(neighborhoodCode);

    // If current values are $0 (likely appeal), fetch 2026 reappraisal value from PRC
    let reappraisalValue = null;
    const currentTotal = parseValue(current.TotalMarketValue);
    if (currentTotal === 0) {
      try {
        const prcRes = await fetch(`https://prc-buncombe.spatialest.com/api/v1/recordcard/${pin}`);
        if (prcRes.ok) {
          const prc = await prcRes.json();
          const hist = prc?.parcel?.sections?.[4]?.[0];
          if (Array.isArray(hist)) {
            const entry = hist.find(e => e.YearID === 2026 && e.ShortDescription?.includes("REAPPRAISAL"));
            if (entry?.TotalAppraisedValue) {
              const val = parseInt(String(entry.TotalAppraisedValue).replace(/[^0-9]/g, ""), 10);
              if (!isNaN(val) && val > 0) reappraisalValue = val;
            }
          }
        }
      } catch (e) {
        console.warn("PRC fetch failed:", e.message);
      }
    }

    const property = {
      pin: current.PIN,
      owner: (current.Owner || "").replace(/;/g, " & "),
      houseNumber: current.HouseNumber || "",
      streetPrefix: current.StreetPrefix || "",
      streetName: current.StreetName || "",
      streetType: current.StreetType || "",
      streetPostDirection: current.StreetPostDirection || "",
      city: current.City || "",
      cityName: derivedLoc ? derivedLoc.name : "Buncombe County",
      state: "NC",
      zipcode: derivedLoc ? derivedLoc.zip : "",
      township: current.Township || "",
      acreage: current.Acreage || 0,
      propertyClass: current.Class || "",
      fireDistrict: current.FireDistrict || "",
      neighborhoodCode,
      reappraisalValue,
      neighborhood,
      detectedDistrictCode,
      currentValue: {
        totalMarket: parseValue(current.TotalMarketValue),
        appraised: parseValue(current.AppraisedValue),
        taxValue: parseValue(current.TaxValue),
        land: parseValue(current.LandValue),
        building: parseValue(current.BuildingValue),
      },
      previousValue: previous ? {
        totalMarket: parseValue(previous.TotalMarketValue),
        appraised: parseValue(previous.AppraisedValue),
        taxValue: parseValue(previous.TaxValue),
        land: parseValue(previous.LandValue),
        building: parseValue(previous.BuildingValue),
      } : null,
      propCardUrl: current.PropCard || `https://prc-buncombe.spatialest.com/#/property/${current.PIN}`,
    };

    res.json(property);
  } catch (error) {
    console.error("Property detail error:", error);
    res.status(500).json({ error: "Failed to fetch property details" });
  }
};
