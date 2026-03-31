/**
 * Unit tests for Buncombe County Tax Lookup — shared logic and API handler functions.
 *
 * Run with: node tests/unit.test.js
 * No external dependencies required (pure Node.js).
 */

"use strict";

// ─── Minimal test harness ────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const errors = [];

function test(label, fn) {
  try {
    fn();
    console.log(`  ✓  ${label}`);
    passed++;
  } catch (e) {
    console.error(`  ✗  ${label}`);
    console.error(`       ${e.message}`);
    failed++;
    errors.push({ label, message: e.message });
  }
}

function expect(actual) {
  return {
    toBe(expected) {
      if (actual !== expected) {
        throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      }
    },
    toEqual(expected) {
      const a = JSON.stringify(actual);
      const e = JSON.stringify(expected);
      if (a !== e) {
        throw new Error(`Expected ${e}, got ${a}`);
      }
    },
    toBeTruthy() {
      if (!actual) throw new Error(`Expected truthy, got ${JSON.stringify(actual)}`);
    },
    toBeFalsy() {
      if (actual) throw new Error(`Expected falsy, got ${JSON.stringify(actual)}`);
    },
    toBeNull() {
      if (actual !== null) throw new Error(`Expected null, got ${JSON.stringify(actual)}`);
    },
    toBeGreaterThan(n) {
      if (!(actual > n)) throw new Error(`Expected ${actual} > ${n}`);
    },
    toBeLessThanOrEqual(n) {
      if (!(actual <= n)) throw new Error(`Expected ${actual} <= ${n}`);
    },
    toMatch(re) {
      if (!re.test(String(actual))) throw new Error(`Expected ${String(actual)} to match ${re}`);
    },
    toContain(str) {
      if (!String(actual).includes(str)) throw new Error(`Expected "${actual}" to contain "${str}"`);
    },
  };
}

function describe(label, fn) {
  console.log(`\n${label}`);
  fn();
}

// ─── Load shared module ───────────────────────────────────────────────────────
const path = require("path");
const shared = require(path.join(__dirname, "..", "api", "_shared.js"));

const {
  detectTaxDistrict,
  getTaxRate,
  estimateAnnualTax,
  derivePropertyLocation,
  sanitizePin,
  normalizePIN,
  buildWhereClause,
  parseValue,
  escapeHtml,
  getNeighborhoodData,
  getNeighborhoodPercentile,
  NEIGHBORHOOD_STATS,
  NEIGHBORHOOD_LABELS,
  TAX_RATES_PER_100,
  COMP_SALE_START_DATE,
  APPEAL_DEADLINE,
  REVALUATION_YEAR,
} = shared;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("detectTaxDistrict", () => {
  test("returns BUN CAS SAS for city=CAS", () => {
    expect(detectTaxDistrict("CAS", "")).toBe("BUN CAS SAS");
  });
  test("returns BUN CBM for city=CBM", () => {
    expect(detectTaxDistrict("CBM", "")).toBe("BUN CBM");
  });
  test("returns BUN CWV for city=CWV", () => {
    expect(detectTaxDistrict("CWV", "")).toBe("BUN CWV");
  });
  test("returns BUN CBF for city=CBF", () => {
    expect(detectTaxDistrict("CBF", "")).toBe("BUN CBF");
  });
  test("returns BUN CWO FWO for city=CWO", () => {
    expect(detectTaxDistrict("CWO", "")).toBe("BUN CWO FWO");
  });
  test("returns BUN CMT FEB for city=CMT", () => {
    expect(detectTaxDistrict("CMT", "")).toBe("BUN CMT FEB");
  });
  test("returns BUN FLE for fireDistrict=FLE", () => {
    expect(detectTaxDistrict("", "FLE")).toBe("BUN FLE");
  });
  test("returns BUN FAS for fireDistrict=FAS", () => {
    expect(detectTaxDistrict("", "FAS")).toBe("BUN FAS");
  });
  test("prefers city over fireDistrict when both provided", () => {
    expect(detectTaxDistrict("CAS", "FLE")).toBe("BUN CAS SAS");
  });
  test("returns BUN for empty city and fireDistrict", () => {
    expect(detectTaxDistrict("", "")).toBe("BUN");
  });
  test("returns BUN for null city and fireDistrict", () => {
    expect(detectTaxDistrict(null, null)).toBe("BUN");
  });
  // KEY FIX: unrecognized codes must fall back to BUN (not return null)
  test("returns BUN for unrecognized city code (never returns null)", () => {
    expect(detectTaxDistrict("UNKNOWN", "")).toBe("BUN");
  });
  test("returns BUN for unrecognized fire code (never returns null)", () => {
    expect(detectTaxDistrict("", "FXYZ")).toBe("BUN");
  });
  test("returns BUN for unrecognized city AND unrecognized fire (never returns null)", () => {
    expect(detectTaxDistrict("ZZZ", "FZZZ")).toBe("BUN");
  });
  test("is case-insensitive for city", () => {
    expect(detectTaxDistrict("cas", "")).toBe("BUN CAS SAS");
  });
  test("is case-insensitive for fire district", () => {
    expect(detectTaxDistrict("", "fle")).toBe("BUN FLE");
  });
  test("handles whitespace in codes", () => {
    expect(detectTaxDistrict("  CAS  ", "")).toBe("BUN CAS SAS");
  });
});

describe("getTaxRate", () => {
  test("returns correct rate for BUN CAS SAS", () => {
    expect(getTaxRate("BUN CAS SAS")).toBe(1.0985);
  });
  test("returns BUN rate for null district", () => {
    expect(getTaxRate(null)).toBe(TAX_RATES_PER_100["BUN"]);
  });
  test("returns BUN rate for undefined district", () => {
    expect(getTaxRate(undefined)).toBe(TAX_RATES_PER_100["BUN"]);
  });
  test("returns BUN rate for unknown district code", () => {
    expect(getTaxRate("BUN XYZW")).toBe(TAX_RATES_PER_100["BUN"]);
  });
  test("returns BUN rate for empty string", () => {
    expect(getTaxRate("")).toBe(TAX_RATES_PER_100["BUN"]);
  });
  test("all district codes in TAX_RATES_PER_100 are retrievable", () => {
    for (const code of Object.keys(TAX_RATES_PER_100)) {
      if (getTaxRate(code) !== TAX_RATES_PER_100[code]) {
        throw new Error(`Rate mismatch for district "${code}"`);
      }
    }
  });
});

describe("estimateAnnualTax", () => {
  test("calculates tax correctly for Asheville City+School at $400k", () => {
    const rate = TAX_RATES_PER_100["BUN CAS SAS"]; // 1.0985
    const expected = Math.round((400000 / 100) * rate); // 4394
    expect(estimateAnnualTax(400000, "BUN CAS SAS")).toBe(expected);
  });
  test("calculates tax correctly for county-only at $300k", () => {
    const rate = TAX_RATES_PER_100["BUN"]; // 0.5466
    const expected = Math.round((300000 / 100) * rate); // 1640
    expect(estimateAnnualTax(300000, "BUN")).toBe(expected);
  });
  test("returns integer (no cents)", () => {
    const result = estimateAnnualTax(350000, "BUN FLE");
    expect(typeof result).toBe("number");
    expect(result).toBe(Math.round(result));
  });
  test("handles null district by falling back to BUN", () => {
    const bunTax = estimateAnnualTax(200000, "BUN");
    const nullTax = estimateAnnualTax(200000, null);
    expect(nullTax).toBe(bunTax);
  });
  test("handles zero assessed value", () => {
    expect(estimateAnnualTax(0, "BUN CAS SAS")).toBe(0);
  });
  test("suggested-vs-current savings are always non-negative", () => {
    const current = estimateAnnualTax(400000, "BUN CAS SAS");
    const suggested = estimateAnnualTax(350000, "BUN CAS SAS");
    expect(Math.max(0, current - suggested)).toBeGreaterThan(0);
    expect(Math.max(0, suggested - current)).toBe(0);
  });
});

describe("derivePropertyLocation", () => {
  test("returns Asheville name and zip for city CAS", () => {
    const loc = derivePropertyLocation("CAS", "");
    expect(loc.name).toBe("Asheville");
    expect(loc.zip).toBe("28801");
  });
  test("returns Black Mountain for city CBM", () => {
    const loc = derivePropertyLocation("CBM", "");
    expect(loc.name).toBe("Black Mountain");
  });
  test("falls back to fire district when city is empty", () => {
    const loc = derivePropertyLocation("", "FLE");
    expect(loc.name).toBe("Leicester");
  });
  test("returns null for unknown codes", () => {
    expect(derivePropertyLocation("ZZZ", "FZZZ")).toBeNull();
  });
  test("returns null for empty both", () => {
    expect(derivePropertyLocation("", "")).toBeNull();
  });
  test("is case-insensitive", () => {
    const loc = derivePropertyLocation("cas", "");
    expect(loc).toBeTruthy();
    expect(loc.name).toBe("Asheville");
  });
});

describe("normalizePIN", () => {
  test("accepts 10-digit PIN", () => {
    expect(normalizePIN("9649357051")).toBe("9649357051");
  });
  test("accepts 15-digit pinnum", () => {
    expect(normalizePIN("964935705100000")).toBe("964935705100000");
  });
  test("strips non-digit characters", () => {
    expect(normalizePIN("9649-35705-1")).toBe("9649357051");
  });
  test("returns null for empty string", () => {
    expect(normalizePIN("")).toBeNull();
  });
  test("returns null for null input", () => {
    expect(normalizePIN(null)).toBeNull();
  });
  test("returns null for 9-digit string", () => {
    expect(normalizePIN("123456789")).toBeNull();
  });
  test("returns null for 11-digit string", () => {
    expect(normalizePIN("12345678901")).toBeNull();
  });
  test("returns null for 14-digit string", () => {
    expect(normalizePIN("12345678901234")).toBeNull();
  });
  test("truncates 16-digit string to 15 digits", () => {
    const result = normalizePIN("9649357051000001");
    expect(result).toBe("964935705100000");
  });
});

describe("sanitizePin", () => {
  test("accepts valid 10-digit PIN", () => {
    expect(sanitizePin("9649357051")).toBe("9649357051");
  });
  test("accepts valid 15-digit PIN", () => {
    expect(sanitizePin("964935705100000")).toBe("964935705100000");
  });
  test("strips dashes", () => {
    expect(sanitizePin("9649-357051")).toBe("9649357051");
  });
  test("returns null for invalid length", () => {
    expect(sanitizePin("123")).toBeNull();
  });
  test("returns null for empty string", () => {
    expect(sanitizePin("")).toBeNull();
  });
  test("returns null for null", () => {
    expect(sanitizePin(null)).toBeNull();
  });
});

describe("parseValue", () => {
  test("parses integer string", () => {
    expect(parseValue("450000")).toBe(450000);
  });
  test("parses number directly", () => {
    expect(parseValue(300000)).toBe(300000);
  });
  test("returns 0 for null", () => {
    expect(parseValue(null)).toBe(0);
  });
  test("returns 0 for empty string", () => {
    expect(parseValue("")).toBe(0);
  });
  test("returns 0 for non-numeric string", () => {
    expect(parseValue("abc")).toBe(0);
  });
  test("returns 0 for undefined", () => {
    expect(parseValue(undefined)).toBe(0);
  });
});

describe("buildWhereClause", () => {
  test("builds PIN clause", () => {
    const clause = buildWhereClause("pin", "9649357051");
    expect(clause).toBe("PIN = '9649357051'");
  });
  test("builds owner clause for single word", () => {
    const clause = buildWhereClause("owner", "Smith");
    expect(clause).toContain("UPPER(Owner) LIKE '%SMITH%'");
  });
  test("builds owner clause for multiple words", () => {
    const clause = buildWhereClause("owner", "John Smith");
    expect(clause).toContain("UPPER(Owner) LIKE '%JOHN%'");
    expect(clause).toContain("UPPER(Owner) LIKE '%SMITH%'");
  });
  test("builds address clause with house number", () => {
    const clause = buildWhereClause("address", "123 Main St");
    expect(clause).toContain("HouseNumber = '123'");
    expect(clause).toContain("UPPER(StreetName) LIKE '%MAIN%'");
  });
  test("builds address clause without house number", () => {
    const clause = buildWhereClause("address", "Merrimon");
    expect(clause).toContain("UPPER(StreetName) LIKE '%MERRIMON%'");
  });
  test("throws for invalid search type", () => {
    let threw = false;
    try {
      buildWhereClause("invalid", "query");
    } catch (e) {
      threw = true;
    }
    if (!threw) throw new Error("Expected error for invalid search type");
  });
  test("throws for empty owner query", () => {
    let threw = false;
    try {
      buildWhereClause("owner", "");
    } catch (e) {
      threw = true;
    }
    if (!threw) throw new Error("Expected error for empty owner query");
  });
  test("strips special characters from query", () => {
    const clause = buildWhereClause("owner", "O'Brien");
    // apostrophe should be stripped by escapeArcGIS
    if (clause.includes("'Brien")) throw new Error("Single quote not stripped");
  });
});

describe("escapeHtml", () => {
  test("escapes ampersand", () => {
    expect(shared.escapeHtml("A & B")).toBe("A &amp; B");
  });
  test("escapes less-than", () => {
    expect(shared.escapeHtml("<script>")).toBe("&lt;script&gt;");
  });
  test("escapes double quotes", () => {
    expect(shared.escapeHtml('"hello"')).toBe("&quot;hello&quot;");
  });
  test("escapes single quotes", () => {
    expect(shared.escapeHtml("it's")).toBe("it&#39;s");
  });
  test("returns empty string for null/undefined", () => {
    expect(shared.escapeHtml(null)).toBe("");
    expect(shared.escapeHtml(undefined)).toBe("");
  });
  test("returns unchanged string when no special chars", () => {
    expect(shared.escapeHtml("hello world")).toBe("hello world");
  });
});

describe("getNeighborhoodData", () => {
  const codes = Object.keys(NEIGHBORHOOD_STATS);
  test("neighborhood stats loaded (non-empty)", () => {
    if (codes.length === 0) throw new Error("NEIGHBORHOOD_STATS is empty");
  });
  test("neighborhood labels loaded (non-empty)", () => {
    if (Object.keys(NEIGHBORHOOD_LABELS).length === 0) throw new Error("NEIGHBORHOOD_LABELS is empty");
  });
  test("returns null for unknown code", () => {
    expect(getNeighborhoodData("ZZZZZ")).toBeNull();
  });
  test("returns object with required fields for known code", () => {
    const code = codes[0];
    const data = getNeighborhoodData(code);
    if (!data) throw new Error(`No data for code ${code}`);
    const required = ["code", "parcels", "medianIncrease", "medianValue2026", "medianValue2021"];
    for (const f of required) {
      if (!(f in data)) throw new Error(`Missing field ${f} in neighborhood data`);
    }
  });
  test("trimmed code lookup works", () => {
    const code = codes[0];
    const withSpaces = "  " + code + "  ";
    const result = getNeighborhoodData(withSpaces);
    if (result === null) throw new Error(`Should find code with surrounding whitespace`);
  });
  test("percentileRank is a number between 0 and 100", () => {
    const code = codes[0];
    const data = getNeighborhoodData(code);
    if (typeof data.percentileRank !== "number") throw new Error("percentileRank not a number");
    if (data.percentileRank < 0 || data.percentileRank > 100) {
      throw new Error(`percentileRank out of range: ${data.percentileRank}`);
    }
  });
});

describe("COMP_SALE_START_DATE and constants", () => {
  test("COMP_SALE_START_DATE is a valid ISO date string", () => {
    const d = new Date(COMP_SALE_START_DATE);
    if (isNaN(d.getTime())) throw new Error(`Invalid date: ${COMP_SALE_START_DATE}`);
  });
  test("COMP_SALE_START_DATE is not in the future", () => {
    const d = new Date(COMP_SALE_START_DATE);
    if (d > new Date()) throw new Error("COMP_SALE_START_DATE is in the future");
  });
  test("APPEAL_DEADLINE is a valid ISO date string", () => {
    const d = new Date(APPEAL_DEADLINE);
    if (isNaN(d.getTime())) throw new Error(`Invalid date: ${APPEAL_DEADLINE}`);
  });
  test("REVALUATION_YEAR is 2025", () => {
    expect(REVALUATION_YEAR).toBe(2025);
  });
});

describe("Tax rate consistency checks", () => {
  test("all rates are positive numbers", () => {
    for (const [code, rate] of Object.entries(TAX_RATES_PER_100)) {
      if (typeof rate !== "number" || rate <= 0) {
        throw new Error(`Invalid rate for district ${code}: ${rate}`);
      }
    }
  });
  test("BUN (county only) is the minimum rate", () => {
    const bunRate = TAX_RATES_PER_100["BUN"];
    for (const [code, rate] of Object.entries(TAX_RATES_PER_100)) {
      if (rate < bunRate) {
        throw new Error(`District ${code} rate ${rate} is less than BUN rate ${bunRate}`);
      }
    }
  });
  test("city rates are higher than county-only rate", () => {
    const bunRate = TAX_RATES_PER_100["BUN"];
    const cityDistricts = ["BUN CAS SAS", "BUN CAS", "BUN CBM", "BUN CWV", "BUN CBF", "BUN CWO FWO", "BUN CMT FEB"];
    for (const d of cityDistricts) {
      if (TAX_RATES_PER_100[d] <= bunRate) {
        throw new Error(`City district ${d} rate should be > BUN rate, got ${TAX_RATES_PER_100[d]}`);
      }
    }
  });
  test("detectTaxDistrict always returns a valid TAX_RATES_PER_100 key", () => {
    const testCases = [
      ["CAS", ""], ["CBM", ""], ["CWV", ""], ["CBF", ""], ["CWO", ""], ["CMT", ""],
      ["", "FAS"], ["", "FLE"], ["", "FEC"], ["", "FSK"], ["", "FWO"],
      ["", ""], [null, null], ["UNKNOWN", "FXYZ"],
    ];
    for (const [city, fire] of testCases) {
      const code = detectTaxDistrict(city, fire);
      if (!(code in TAX_RATES_PER_100)) {
        throw new Error(`detectTaxDistrict("${city}", "${fire}") = "${code}" is not a valid district code`);
      }
    }
  });
});

describe("estimateAnnualTax + detectTaxDistrict integration", () => {
  test("tax estimate for Asheville property is credibly higher than rural", () => {
    const ashevilleTax = estimateAnnualTax(400000, detectTaxDistrict("CAS", ""));
    const ruralTax = estimateAnnualTax(400000, detectTaxDistrict("", "FLE"));
    if (ashevilleTax <= ruralTax) {
      throw new Error(`Asheville tax (${ashevilleTax}) should be higher than rural (${ruralTax})`);
    }
  });
  test("tax for unknown location uses BUN fallback", () => {
    const district = detectTaxDistrict("ZZUNK", "FZUNK");
    expect(district).toBe("BUN");
    const tax = estimateAnnualTax(300000, district);
    const bunTax = estimateAnnualTax(300000, "BUN");
    expect(tax).toBe(bunTax);
  });
});

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`);
console.log(`Passed: ${passed}  |  Failed: ${failed}  |  Total: ${passed + failed}`);
if (errors.length > 0) {
  console.log("\nFailed tests:");
  errors.forEach(e => console.log(`  ✗ ${e.label}: ${e.message}`));
  process.exit(1);
} else {
  console.log("All tests passed ✓");
}
