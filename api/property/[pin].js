const { CURRENT_LAYER, PREVIOUS_LAYER, CURRENT_FIELDS, PREVIOUS_FIELDS, queryArcGIS, parseValue, derivePropertyLocation, detectTaxDistrict } = require("../_shared");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const { pin } = req.query;

    const [currentResults, previousResults] = await Promise.all([
      queryArcGIS(CURRENT_LAYER, `PIN = '${pin}'`, CURRENT_FIELDS, 1),
      queryArcGIS(PREVIOUS_LAYER, `PIN = '${pin}'`, PREVIOUS_FIELDS, 1),
    ]);

    if (currentResults.length === 0) return res.status(404).json({ error: "Property not found" });

    const current = currentResults[0];
    const previous = previousResults.length > 0 ? previousResults[0] : null;
    const detectedDistrictCode = detectTaxDistrict(current.City || "", current.FireDistrict || "");
    const derivedLoc = derivePropertyLocation(current.City || "", current.FireDistrict || "");

    const property = {
      pin: current.PIN,
      owner: current.Owner || "",
      houseNumber: current.HouseNumber || "",
      streetName: current.StreetName || "",
      streetType: current.StreetType || "",
      city: current.City || "",
      cityName: derivedLoc ? derivedLoc.name : (current.CityName || ""),
      state: "NC",
      zipcode: derivedLoc ? derivedLoc.zip : (current.Zipcode || ""),
      mailingCity: current.CityName || "",
      mailingZip: current.Zipcode || "",
      township: current.Township || "",
      acreage: current.Acreage || 0,
      propertyClass: current.Class || "",
      fireDistrict: current.FireDistrict || "",
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
    res.status(500).json({ error: error.message || "Failed to fetch property details" });
  }
};
