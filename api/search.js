const { CURRENT_LAYER, CURRENT_FIELDS, queryArcGIS, buildWhereClause, parseValue, derivePropertyLocation } = require("./_shared");

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const { type, q } = req.query;
    if (!type || !q) return res.status(400).json({ error: "Missing search type or query" });
    if (!["owner", "address", "pin"].includes(type)) return res.status(400).json({ error: "Invalid search type" });

    const where = buildWhereClause(type, q);
    const currentResults = await queryArcGIS(CURRENT_LAYER, where, CURRENT_FIELDS, 50);

    const results = currentResults.map(r => {
      const loc = derivePropertyLocation(r.City || "", r.FireDistrict || "");
      return {
        pin: r.PIN,
        owner: r.Owner || "",
        address: [r.HouseNumber, r.StreetPrefix, r.StreetName, r.StreetType, r.StreetPostDirection].filter(Boolean).join(" "),
        cityName: loc ? loc.name : "Buncombe County",
        totalMarketValue: parseValue(r.TotalMarketValue),
      };
    });

    res.json({ results, count: results.length });
  } catch (error) {
    console.error("Search error:", error);
    res.status(500).json({ error: error.message || "Search failed" });
  }
};
