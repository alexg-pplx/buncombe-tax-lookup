/**
 * Comparable Sales Widget
 * Injects a "Similar Properties That Recently Sold" section into the property detail page.
 * Placed between the Tax Bill Estimator and the Appeals Guide.
 * Self-contained — does not modify any existing React code.
 */
(function () {
  "use strict";

  const POLL_INTERVAL = 500;
  const MAX_POLLS = 60;
  let currentPin = null;
  let widgetEl = null;

  function formatCurrency(n) {
    if (n === null || n === undefined) return "—";
    return "$" + Number(n).toLocaleString("en-US");
  }

  function formatDate(d) {
    if (!d) return "—";
    // Handle YYYYMMDD format
    if (/^\d{8}$/.test(d)) {
      const y = d.substring(0, 4);
      const m = d.substring(4, 6);
      const day = d.substring(6, 8);
      return `${m}/${day}/${y}`;
    }
    // Handle MM/DD/YYYY
    if (d.includes("/")) return d;
    return d;
  }

  function formatSqft(n) {
    if (!n) return "—";
    return Number(n).toLocaleString("en-US") + " sq ft";
  }

  function getAssessmentLabel(ratio) {
    if (ratio === null) return null;
    if (ratio > 110)
      return {
        text: "Assessed well above sale price",
        color: "#dc2626",
        bg: "#fef2f2",
      };
    if (ratio > 105)
      return {
        text: "Assessed above sale price",
        color: "#ea580c",
        bg: "#fff7ed",
      };
    if (ratio >= 95)
      return {
        text: "Assessed near sale price",
        color: "#16a34a",
        bg: "#f0fdf4",
      };
    if (ratio >= 85)
      return {
        text: "Assessed below sale price",
        color: "#2563eb",
        bg: "#eff6ff",
      };
    return {
      text: "Assessed well below sale price",
      color: "#7c3aed",
      bg: "#f5f3ff",
    };
  }

  function createWidget(data) {
    const el = document.createElement("div");
    el.id = "comparables-widget";
    el.style.cssText =
      "margin-bottom:1.5rem;font-family:inherit;";

    const { subject, comparables, summary } = data;

    if (!comparables || comparables.length === 0) {
      el.innerHTML = buildCard(
        "Similar Properties That Recently Sold",
        '<p style="color:#6b7280;font-size:0.875rem;padding:1rem 0;">No comparable recent sales found in this neighborhood. This may mean few properties have sold recently, or this property type is uncommon in the area.</p>'
      );
      return el;
    }

    // Build summary insight — check if comps are actually similar before making claims
    let insightHtml = "";
    const sv = summary.subjectVsComps;
    const subjectBldg = subject.building || {};
    if (sv && comparables.length > 0) {
      // Check how similar the comps actually are to the subject
      const subjectSqft = subjectBldg.sqft || 0;
      const subjectYear = subjectBldg.yearBuilt || 0;
      const subjectAcres = subject.acreage || 0;
      
      let similarCount = 0;
      for (const comp of comparables) {
        let isSimilar = true;
        if (subjectSqft > 0 && comp.sqft > 0) {
          const sqftDiff = Math.abs(subjectSqft - comp.sqft) / subjectSqft;
          if (sqftDiff > 0.4) isSimilar = false;
        }
        if (subjectYear > 0 && comp.yearBuilt > 0) {
          if (Math.abs(subjectYear - comp.yearBuilt) > 20) isSimilar = false;
        }
        if (subjectAcres > 0 && comp.acreage > 0) {
          const acDiff = Math.abs(subjectAcres - comp.acreage) / Math.max(subjectAcres, 0.1);
          if (acDiff > 1.0) isSimilar = false;
        }
        if (isSimilar) similarCount++;
      }
      
      const compsAreSimilar = similarCount >= 3;
      
      if (compsAreSimilar) {
        // Comps are genuinely similar — safe to make a comparison
        const dir = sv.percentDifference > 5 ? "above" : sv.percentDifference < -5 ? "below" : "in line with";
        const absPct = Math.abs(sv.percentDifference);
        if (dir === "in line with") {
          insightHtml = `<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:0.75rem 1rem;margin-bottom:1rem;font-size:0.875rem;color:#15803d;">
            <strong>Your assessed value (${formatCurrency(sv.subjectAssessed)}) is in line with recent comparable sales</strong> (median sale price: ${formatCurrency(sv.medianSalePrice)}).
          </div>`;
        } else if (dir === "above") {
          insightHtml = `<div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:0.75rem 1rem;margin-bottom:1rem;font-size:0.875rem;color:#9a3412;">
            <strong>Your assessed value (${formatCurrency(sv.subjectAssessed)}) is ${absPct}% above the median recent sale price</strong> of similar properties (${formatCurrency(sv.medianSalePrice)}). This could support an appeal if you believe the county over-valued your property.
          </div>`;
        } else {
          insightHtml = `<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:0.75rem 1rem;margin-bottom:1rem;font-size:0.875rem;color:#1e40af;">
            <strong>Your assessed value (${formatCurrency(sv.subjectAssessed)}) is ${absPct}% below the median recent sale price</strong> of similar properties (${formatCurrency(sv.medianSalePrice)}).
          </div>`;
        }
      } else {
        // Comps aren't good matches — show data without making a judgment
        insightHtml = `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:0.75rem 1rem;margin-bottom:1rem;font-size:0.875rem;color:#475569;">
          Showing recent sales in your neighborhood. These properties differ from yours in size, age, or acreage, so a direct value comparison may not be appropriate.
        </div>`;
      }
    }

    // Subject property details
    let subjectDetailHtml = "";
    if (subject.building || subject.acreage) {
      const b = subject.building || {};
      const parts = [];
      if (b.sqft) parts.push(formatSqft(b.sqft));
      if (subject.acreage) parts.push(Number(subject.acreage).toFixed(2) + " acres");
      if (b.bedrooms) parts.push(b.bedrooms + " bed");
      if (b.fullBath || b.halfBath) {
        const baths = (b.fullBath || 0) + (b.halfBath ? b.halfBath * 0.5 : 0);
        parts.push(baths + " bath");
      }
      if (b.yearBuilt) parts.push("Built " + b.yearBuilt);
      if (b.buildingType) parts.push(b.buildingType.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()));
      if (parts.length > 0) {
        subjectDetailHtml = `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:0.625rem 1rem;margin-bottom:1rem;font-size:0.8125rem;color:#475569;">
          <strong>Your property:</strong> ${parts.join(" · ")}
        </div>`;
      }
    }

    // Build comparables table
    let tableHtml = `<div style="overflow-x:auto;-webkit-overflow-scrolling:touch;">
      <table style="width:100%;border-collapse:collapse;font-size:0.8125rem;min-width:720px;">
        <thead>
          <tr style="border-bottom:2px solid #e2e8f0;text-align:left;">
            <th style="padding:0.5rem 0.75rem;font-weight:600;color:#374151;">Address</th>
            <th style="padding:0.5rem 0.75rem;font-weight:600;color:#374151;">Sale Price</th>
            <th style="padding:0.5rem 0.75rem;font-weight:600;color:#374151;">Sale Date</th>
            <th style="padding:0.5rem 0.75rem;font-weight:600;color:#374151;">2026 Value</th>
            <th style="padding:0.5rem 0.75rem;font-weight:600;color:#374151;">Sq Ft</th>
            <th style="padding:0.5rem 0.75rem;font-weight:600;color:#374151;">Acres</th>
            <th style="padding:0.5rem 0.75rem;font-weight:600;color:#374151;">Bed/Bath</th>
            <th style="padding:0.5rem 0.75rem;font-weight:600;color:#374151;">Year Built</th>
          </tr>
        </thead>
        <tbody>`;

    comparables.forEach((comp, i) => {
      const bgColor = i % 2 === 0 ? "#ffffff" : "#f9fafb";
      const label = getAssessmentLabel(comp.assessmentRatio);
      const ratioTag = label
        ? `<div style="display:inline-block;font-size:0.6875rem;padding:0.125rem 0.375rem;border-radius:4px;margin-top:0.25rem;background:${label.bg};color:${label.color};white-space:nowrap;">${label.text}</div>`
        : "";

      const baths = (comp.fullBath || 0) + (comp.halfBath ? comp.halfBath * 0.5 : 0);
      const bedBath = comp.bedrooms ? `${comp.bedrooms}/${baths || "—"}` : "—";
      const acresDisplay = comp.acreage ? Number(comp.acreage).toFixed(2) : "—";

      // Link address to PRC property card (has photos, full details)
      const addressDisplay = comp.propCard
        ? `<a href="${comp.propCard}" target="_blank" rel="noopener noreferrer" style="color:#0369a1;text-decoration:none;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">${comp.address || "—"}<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;margin-left:3px;vertical-align:middle;opacity:0.5;"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a>`
        : (comp.address || "—");

      tableHtml += `
        <tr style="background:${bgColor};border-bottom:1px solid #f1f5f9;">
          <td style="padding:0.5rem 0.75rem;font-weight:500;color:#1f2937;">${addressDisplay}</td>
          <td style="padding:0.5rem 0.75rem;color:#1f2937;font-weight:600;">${formatCurrency(comp.salePrice)}</td>
          <td style="padding:0.5rem 0.75rem;color:#6b7280;">${formatDate(comp.saleDate)}</td>
          <td style="padding:0.5rem 0.75rem;color:#1f2937;">
            ${formatCurrency(comp.assessedValue2026)}
            ${ratioTag}
          </td>
          <td style="padding:0.5rem 0.75rem;color:#6b7280;">${comp.sqft ? Number(comp.sqft).toLocaleString() : "—"}</td>
          <td style="padding:0.5rem 0.75rem;color:#6b7280;">${acresDisplay}</td>
          <td style="padding:0.5rem 0.75rem;color:#6b7280;">${bedBath}</td>
          <td style="padding:0.5rem 0.75rem;color:#6b7280;">${comp.yearBuilt || "—"}</td>
        </tr>`;
    });

    tableHtml += `</tbody></table></div>`;

    // Note about data
    const noteHtml = `<p style="font-size:0.75rem;color:#9ca3af;margin-top:0.75rem;line-height:1.5;">
      Showing ${comparables.length} of ${summary.totalFound} recent sales in ${subject.neighborhoodCode ? "neighborhood " + subject.neighborhoodCode + " and surrounding area" : "the area"}. 
      Click any address to view the full property record card with photos. Sales data is from Buncombe County public records. "2026 Value" is the county's new assessed value, not the sale price.
      ${summary.averageAssessmentRatio ? "Average assessment-to-sale ratio: " + summary.averageAssessmentRatio + "%." : ""}
    </p>`;

    const bodyHtml = insightHtml + subjectDetailHtml + tableHtml + noteHtml;

    el.innerHTML = buildCard("Similar Properties That Recently Sold", bodyHtml);
    return el;
  }

  function buildCard(title, bodyHtml) {
    // Match the existing card styling from the React app
    return `
      <div style="border:1px solid hsl(214.3 31.8% 91.4%);border-radius:0.75rem;background:white;box-shadow:0 1px 2px 0 rgb(0 0 0 / 0.05);">
        <div style="padding:1.25rem 1.5rem 0.75rem;">
          <h3 style="font-size:1rem;font-weight:600;color:#0f172a;display:flex;align-items:center;gap:0.5rem;">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:#0ea5e9;flex-shrink:0;"><path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/></svg>
            ${title}
          </h3>
          <p style="font-size:0.75rem;color:#6b7280;margin-top:0.25rem;">
            How does your assessed value compare to what similar properties actually sold for?
          </p>
        </div>
        <div style="padding:0 1.5rem 1.25rem;">
          ${bodyHtml}
        </div>
      </div>`;
  }

  function createLoadingWidget() {
    const el = document.createElement("div");
    el.id = "comparables-widget";
    el.style.cssText = "margin-bottom:1.5rem;";
    el.innerHTML = buildCard(
      "Similar Properties That Recently Sold",
      `<div style="padding:1.5rem 0;text-align:center;">
        <div style="display:inline-block;width:1.25rem;height:1.25rem;border:2px solid #e2e8f0;border-top-color:#0ea5e9;border-radius:50%;animation:comp-spin 0.8s linear infinite;"></div>
        <p style="color:#6b7280;font-size:0.8125rem;margin-top:0.5rem;">Finding comparable sales in your area...</p>
      </div>
      <style>@keyframes comp-spin{to{transform:rotate(360deg)}}</style>`
    );
    return el;
  }

  function injectWidget(widget) {
    // Remove existing widget if present
    const existing = document.getElementById("comparables-widget");
    if (existing) existing.remove();

    // Strategy: Insert after tax-estimator section, before the appeals section
    const taxEstimator = document.getElementById("tax-estimator");
    if (taxEstimator) {
      // The tax estimator is inside a card (parent with mb-6 class)
      let cardEl = taxEstimator;
      // Walk up to find the card container (usually 2-3 levels up)
      for (let i = 0; i < 5; i++) {
        if (
          cardEl.parentElement &&
          cardEl.parentElement.id !== "root" &&
          !cardEl.parentElement.matches('[class*="max-w"]')
        ) {
          cardEl = cardEl.parentElement;
        } else break;
      }
      // Insert after this card
      if (cardEl.nextElementSibling) {
        cardEl.parentElement.insertBefore(widget, cardEl.nextElementSibling);
      } else {
        cardEl.parentElement.appendChild(widget);
      }
      return true;
    }

    // Fallback: look for "Think Your Value" heading and insert before its container
    const allH3 = document.querySelectorAll("h3");
    for (const h3 of allH3) {
      if (h3.textContent.includes("Think Your Value")) {
        let container = h3;
        for (let i = 0; i < 5; i++) {
          if (container.parentElement) container = container.parentElement;
          else break;
          // Stop when we find a card-like container
          if (
            container.style?.marginBottom ||
            container.className?.includes("mb-")
          )
            break;
        }
        container.parentElement.insertBefore(widget, container);
        return true;
      }
    }

    return false;
  }

  function getPinFromHash() {
    const hash = window.location.hash;
    const match = hash.match(/\/property\/(\d+)/);
    return match ? match[1] : null;
  }

  async function loadComparables(pin) {
    if (currentPin === pin && widgetEl) return; // Already loaded
    currentPin = pin;

    // Show loading state
    const loading = createLoadingWidget();
    let injected = false;
    let polls = 0;

    // Poll for the tax-estimator element to appear (React renders async)
    const pollInterval = setInterval(() => {
      polls++;
      if (polls > MAX_POLLS) {
        clearInterval(pollInterval);
        return;
      }
      if (!injected && document.getElementById("tax-estimator")) {
        injected = injectWidget(loading);
        if (injected) clearInterval(pollInterval);
      }
    }, POLL_INTERVAL);

    // Fetch data
    try {
      const res = await fetch(`/api/comparables/${pin}`);
      if (!res.ok) throw new Error("API error: " + res.status);
      const data = await res.json();

      widgetEl = createWidget(data);

      // Replace loading with actual content
      clearInterval(pollInterval);

      // Wait for DOM if not yet injected
      if (!injected) {
        let waitPolls = 0;
        const waitInterval = setInterval(() => {
          waitPolls++;
          if (waitPolls > MAX_POLLS) {
            clearInterval(waitInterval);
            return;
          }
          if (document.getElementById("tax-estimator")) {
            injectWidget(widgetEl);
            clearInterval(waitInterval);
          }
        }, POLL_INTERVAL);
      } else {
        injectWidget(widgetEl);
      }
    } catch (err) {
      console.warn("Comparables fetch failed:", err);
      clearInterval(pollInterval);
      const errorEl = document.getElementById("comparables-widget");
      if (errorEl) errorEl.remove();
    }
  }

  function checkRoute() {
    const pin = getPinFromHash();
    if (pin) {
      loadComparables(pin);
    } else {
      // Not on a property page — clean up
      currentPin = null;
      widgetEl = null;
      const existing = document.getElementById("comparables-widget");
      if (existing) existing.remove();
    }
  }

  // Listen for hash changes (React hash router)
  window.addEventListener("hashchange", () => {
    currentPin = null;
    widgetEl = null;
    checkRoute();
  });

  // Initial check
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", checkRoute);
  } else {
    checkRoute();
  }
})();
