const { NEIGHBORHOOD_STATS, NEIGHBORHOOD_LABELS, getNeighborhoodPercentile } = require("./_shared");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const allMedians = Object.values(NEIGHBORHOOD_STATS).map(n => n.median_increase);
    allMedians.sort((a, b) => a - b);

    const neighborhoods = Object.entries(NEIGHBORHOOD_STATS).map(([code, data]) => {
      const below = allMedians.filter(m => m < data.median_increase).length;
      const percentileRank = Math.round((below / allMedians.length) * 100);
      const labelInfo = NEIGHBORHOOD_LABELS[code] || {};
      return {
        code,
        label: labelInfo.label || "",
        descriptor: labelInfo.descriptor || "",
        topStreets: labelInfo.topStreets || [],
        parcels: data.parcels,
        medianIncrease: data.median_increase,
        meanIncrease: data.mean_increase,
        p25: data.p25,
        p75: data.p75,
        medianValue2026: data.median_2026,
        medianValue2021: data.median_2021,
        area: data.area,
        percentileRank,
      };
    });

    neighborhoods.sort((a, b) => b.medianIncrease - a.medianIncrease);

    res.json({
      neighborhoods,
      count: neighborhoods.length,
      countyMedian: 62.7,
      countyMean: 66.0,
    });
  } catch (error) {
    console.error("Neighborhoods error:", error);
    res.status(500).json({ error: "Failed to load neighborhood data" });
  }
};
