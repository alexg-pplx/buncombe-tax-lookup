const ARCGIS_BASE = "https://gis.buncombecounty.org/arcgis/rest/services";
const CURRENT_LAYER = `${ARCGIS_BASE}/opendata/MapServer/1`;
const PREVIOUS_LAYER = `${ARCGIS_BASE}/opendata_2/FeatureServer/15`;

const CURRENT_FIELDS = "PIN,Owner,HouseNumber,StreetPrefix,StreetName,StreetType,StreetPostDirection,City,CityName,State,Zipcode,Township,Acreage,Class,FireDistrict,NeighborhoodCode,TotalMarketValue,AppraisedValue,TaxValue,LandValue,BuildingValue,PropCard";
const PREVIOUS_FIELDS = "PIN,Owner,TotalMarketValue,AppraisedValue,TaxValue,LandValue,BuildingValue";

const CITY_TO_DISTRICT = {
  CAS: "BUN CAS SAS", CBM: "BUN CBM", CWV: "BUN CWV",
  CBF: "BUN CBF", CWO: "BUN CWO FWO", CMT: "BUN CMT FEB",
};

const FIRE_TO_DISTRICT = {
  FAS: "BUN FAS", FSB: "BUN FSB", FBA: "BUN FBA", FBR: "BUN FBR",
  FEB: "BUN FEB", FEC: "BUN FEC", FFA: "BUN FFA", FFB: "BUN FFB",
  FGC: "BUN FGC", FJU: "BUN FJU", FLE: "BUN FLE", FNB: "BUN FNB",
  FRC: "BUN FRC", FRE: "BUN FRE", FRI: "BUN FRI", FSK: "BUN FSK",
  FSW: "BUN FSW", FUH: "BUN FUH", FWB: "BUN FWB", FWO: "BUN FWO",
};

const CITY_CODE_TO_NAME = {
  CAS: { name: "Asheville", zip: "28801" },
  CBM: { name: "Black Mountain", zip: "28711" },
  CWV: { name: "Weaverville", zip: "28787" },
  CBF: { name: "Biltmore Forest", zip: "28803" },
  CWO: { name: "Woodfin", zip: "28804" },
  CMT: { name: "Montreat", zip: "28757" },
};

const FIRE_CODE_TO_AREA = {
  FAS: { name: "Asheville", zip: "28805" },
  FSB: { name: "Asheville", zip: "28806" },
  FBA: { name: "Barnardsville", zip: "28709" },
  FBR: { name: "Black Mountain", zip: "28711" },
  FEB: { name: "Black Mountain", zip: "28711" },
  FEC: { name: "Candler", zip: "28715" },
  FFA: { name: "Fairview", zip: "28730" },
  FFB: { name: "Alexander", zip: "28701" },
  FGC: { name: "Fairview", zip: "28730" },
  FJU: { name: "Weaverville", zip: "28787" },
  FLE: { name: "Leicester", zip: "28748" },
  FNB: { name: "Weaverville", zip: "28787" },
  FRC: { name: "Weaverville", zip: "28787" },
  FRE: { name: "Asheville", zip: "28803" },
  FRI: { name: "Asheville", zip: "28805" },
  FSK: { name: "Arden", zip: "28704" },
  FSW: { name: "Swannanoa", zip: "28778" },
  FUH: { name: "Candler", zip: "28715" },
  FWB: { name: "Asheville", zip: "28806" },
  FWO: { name: "Asheville", zip: "28804" },
};

function derivePropertyLocation(city, fireDistrict) {
  const cityCode = (city || "").trim().toUpperCase();
  const fireCode = (fireDistrict || "").trim().toUpperCase();
  if (cityCode && CITY_CODE_TO_NAME[cityCode]) return CITY_CODE_TO_NAME[cityCode];
  if (fireCode && FIRE_CODE_TO_AREA[fireCode]) return FIRE_CODE_TO_AREA[fireCode];
  return null;
}

function detectTaxDistrict(city, fireDistrict) {
  const cityCode = (city || "").trim().toUpperCase();
  const fireCode = (fireDistrict || "").trim().toUpperCase();
  if (cityCode && CITY_TO_DISTRICT[cityCode]) return CITY_TO_DISTRICT[cityCode];
  if (fireCode && FIRE_TO_DISTRICT[fireCode]) return FIRE_TO_DISTRICT[fireCode];
  if (!cityCode && !fireCode) return "BUN";
  return null;
}

async function queryArcGIS(layerUrl, where, outFields, limit = 50) {
  const params = new URLSearchParams({
    where, outFields, f: "json", returnGeometry: "false",
    resultRecordCount: String(limit),
  });
  const response = await fetch(`${layerUrl}/query?${params.toString()}`);
  const data = await response.json();
  if (data.error) throw new Error(data.error.message || "ArcGIS query failed");
  return (data.features || []).map(f => f.attributes);
}

function escapeArcGIS(str) {
  // Remove any characters that could break ArcGIS WHERE clause syntax
  // Allow only alphanumeric, spaces, and hyphens
  return str.replace(/[^a-zA-Z0-9\s\-]/g, "").trim();
}

function buildWhereClause(searchType, query) {
  const sanitized = escapeArcGIS(query).toUpperCase();
  switch (searchType) {
    case "owner": {
      const words = sanitized.split(/\s+/).filter(Boolean);
      if (words.length === 0) throw new Error("Empty search query");
      if (words.length === 1) return `UPPER(Owner) LIKE '%${words[0]}%'`;
      return words.map(w => `UPPER(Owner) LIKE '%${w}%'`).join(" AND ");
    }
    case "address": {
      const STREET_TYPES = new Set(["ST", "RD", "AVE", "DR", "LN", "CT", "CIR", "WAY", "PL", "BLVD",
        "TRL", "LOOP", "RUN", "PKWY", "HWY", "EXT", "XING", "TER", "TERR", "PATH", "PASS", "COVE"]);
      const PREFIXES = new Set(["N", "S", "E", "W", "NE", "NW", "SE", "SW"]);
      const parts = sanitized.split(/\s+/);
      const isNumeric = /^\d+$/.test(parts[0]);
      let houseNum = "";
      let streetWords = [];
      if (isNumeric && parts.length > 1) {
        houseNum = parts[0];
        streetWords = parts.slice(1);
      } else {
        streetWords = parts;
      }
      if (streetWords.length > 1 && STREET_TYPES.has(streetWords[streetWords.length - 1])) {
        streetWords = streetWords.slice(0, -1);
      }
      if (streetWords.length > 1 && PREFIXES.has(streetWords[0])) {
        streetWords = streetWords.slice(1);
      }
      const streetName = streetWords.join(" ");
      if (houseNum && streetName) {
        return `HouseNumber = '${houseNum}' AND UPPER(StreetName) LIKE '%${streetName}%'`;
      }
      if (streetName) {
        return `UPPER(StreetName) LIKE '%${streetName}%'`;
      }
      return `UPPER(StreetName) LIKE '%${sanitized}%'`;
    }
    case "pin": {
      // PINs are strictly numeric — reject anything else
      const cleanPin = sanitized.replace(/[^0-9]/g, "");
      if (!cleanPin) throw new Error("Invalid PIN");
      return `PIN = '${cleanPin}'`;
    }
    default:
      throw new Error("Invalid search type");
  }
}

function parseValue(val) {
  if (val === null || val === undefined || val === "") return 0;
  const num = typeof val === "string" ? parseInt(val, 10) : val;
  return isNaN(num) ? 0 : num;
}

// Load neighborhood stats and labels
const path = require("path");
const fs = require("fs");
let NEIGHBORHOOD_STATS = {};
try {
  const raw = fs.readFileSync(path.join(__dirname, "data", "neighborhood-stats.json"), "utf-8");
  NEIGHBORHOOD_STATS = JSON.parse(raw);
} catch (e) {
  console.warn("neighborhood-stats.json not found", e.message);
}

let NEIGHBORHOOD_LABELS = {};
try {
  const raw = fs.readFileSync(path.join(__dirname, "data", "neighborhood-labels.json"), "utf-8");
  NEIGHBORHOOD_LABELS = JSON.parse(raw);
} catch (e) {
  console.warn("neighborhood-labels.json not found", e.message);
}

function getNeighborhoodPercentile(code) {
  const entry = NEIGHBORHOOD_STATS[code];
  if (!entry) return null;
  const allMedians = Object.values(NEIGHBORHOOD_STATS).map(n => n.median_increase);
  const below = allMedians.filter(m => m < entry.median_increase).length;
  return Math.round((below / allMedians.length) * 100);
}

function getNeighborhoodData(code) {
  const trimmed = (code || "").trim();
  const data = NEIGHBORHOOD_STATS[trimmed];
  if (!data) return null;
  const labelInfo = NEIGHBORHOOD_LABELS[trimmed] || {};
  return {
    code: trimmed,
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
    percentileRank: getNeighborhoodPercentile(trimmed),
  };
}

function sanitizePin(pin) {
  // PINs are numeric only (10 or 15 digits)
  const clean = (pin || "").replace(/[^0-9]/g, "");
  if (!clean || (clean.length !== 10 && clean.length !== 15)) return null;
  return clean;
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

module.exports = {
  CURRENT_LAYER, PREVIOUS_LAYER, CURRENT_FIELDS, PREVIOUS_FIELDS,
  queryArcGIS, buildWhereClause, parseValue, sanitizePin, escapeHtml,
  derivePropertyLocation, detectTaxDistrict,
  NEIGHBORHOOD_STATS, NEIGHBORHOOD_LABELS, getNeighborhoodData, getNeighborhoodPercentile,
};
