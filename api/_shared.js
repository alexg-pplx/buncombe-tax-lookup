const ARCGIS_BASE = "https://gis.buncombecounty.org/arcgis/rest/services";
const CURRENT_LAYER = `${ARCGIS_BASE}/opendata/MapServer/1`;
const PREVIOUS_LAYER = `${ARCGIS_BASE}/opendata_2/FeatureServer/15`;

const CURRENT_FIELDS = "PIN,Owner,HouseNumber,StreetName,StreetType,City,CityName,State,Zipcode,Township,Acreage,Class,FireDistrict,NeighborhoodCode,TotalMarketValue,AppraisedValue,TaxValue,LandValue,BuildingValue,PropCard";
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
  FAS: { name: "Asheville (unincorporated)", zip: "28806" },
  FSB: { name: "Asheville (unincorporated)", zip: "28806" },
  FBA: { name: "Barnardsville", zip: "28709" },
  FBR: { name: "Broad River", zip: "28748" },
  FEB: { name: "East Buncombe", zip: "28778" },
  FEC: { name: "Enka/Candler", zip: "28715" },
  FFA: { name: "Fairview", zip: "28730" },
  FFB: { name: "French Broad", zip: "28806" },
  FGC: { name: "Garren Creek", zip: "28730" },
  FJU: { name: "Jupiter", zip: "28748" },
  FLE: { name: "Leicester", zip: "28748" },
  FNB: { name: "North Buncombe", zip: "28787" },
  FRC: { name: "Reems Creek", zip: "28787" },
  FRE: { name: "Reynolds", zip: "28803" },
  FRI: { name: "Riceville", zip: "28805" },
  FSK: { name: "Skyland", zip: "28776" },
  FSW: { name: "Swannanoa", zip: "28778" },
  FUH: { name: "Upper Hominy", zip: "28715" },
  FWB: { name: "West Buncombe/Leicester", zip: "28806" },
  FWO: { name: "Woodfin", zip: "28804" },
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

function buildWhereClause(searchType, query) {
  const sanitized = query.replace(/[,.'\"]/g, " ").replace(/\s+/g, " ").trim().toUpperCase();
  const sqlSafe = sanitized.replace(/'/g, "''");
  switch (searchType) {
    case "owner": {
      const words = sqlSafe.split(/\s+/).filter(Boolean);
      if (words.length === 1) return `UPPER(Owner) LIKE '%${words[0]}%'`;
      return words.map(w => `UPPER(Owner) LIKE '%${w}%'`).join(" AND ");
    }
    case "address": {
      const parts = sqlSafe.split(/\s+/);
      const isNumeric = /^\d+$/.test(parts[0]);
      if (isNumeric && parts.length > 1) {
        return `HouseNumber = '${parts[0]}' AND UPPER(StreetName) LIKE '%${parts.slice(1).join(" ")}%'`;
      }
      return `UPPER(StreetName) LIKE '%${sqlSafe}%'`;
    }
    case "pin":
      return `PIN = '${sqlSafe}'`;
    default:
      throw new Error("Invalid search type");
  }
}

function parseValue(val) {
  if (val === null || val === undefined || val === "") return 0;
  const num = typeof val === "string" ? parseInt(val, 10) : val;
  return isNaN(num) ? 0 : num;
}

module.exports = {
  CURRENT_LAYER, PREVIOUS_LAYER, CURRENT_FIELDS, PREVIOUS_FIELDS,
  queryArcGIS, buildWhereClause, parseValue,
  derivePropertyLocation, detectTaxDistrict,
};
