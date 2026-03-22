/**
 * Appeal Packet Widget
 * Injects an appeal screening card + packet purchase flow into property pages.
 * Self-contained — does not modify the React bundle.
 */
(function() {
  'use strict';

  const ADMIN_KEY = 'kendra2026';
  const STRIPE_LINK_BASE = 'https://buy.stripe.com'; // Placeholder — will be replaced with real Stripe links
  
  // Check if we're on a property page
  function getPin() {
    const hash = window.location.hash;
    const match = hash.match(/#\/property\/(\d+)/);
    return match ? match[1] : null;
  }

  function fmt(n) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
  }

  // Deadline countdown
  function daysUntilDeadline() {
    const deadline = new Date(2026, 4, 5); // May 5, 2026
    const now = new Date();
    return Math.max(0, Math.ceil((deadline - now) / (1000 * 60 * 60 * 24)));
  }

  function createScreeningCard(data) {
    const { subject, screening, comps, pricing } = data;
    const card = document.createElement('div');
    card.id = 'appeal-packet-card';
    card.style.cssText = 'margin-bottom: 1.5rem;';

    const daysLeft = daysUntilDeadline();
    const isAdmin = new URLSearchParams(window.location.search).get('admin') === ADMIN_KEY;

    // Rating colors
    const ratingColors = {
      strong: { bg: '#f0fdf4', border: '#86efac', text: '#166534', badge: '#16a34a', label: 'Strong Case' },
      moderate: { bg: '#fefce8', border: '#fde047', text: '#854d0e', badge: '#ca8a04', label: 'Moderate Case' },
      weak: { bg: '#fef2f2', border: '#fca5a5', text: '#991b1b', badge: '#dc2626', label: 'Weak Case' },
      insufficient: { bg: '#f5f5f5', border: '#d4d4d4', text: '#525252', badge: '#737373', label: 'Insufficient Data' },
      unsupported: { bg: '#f5f5f5', border: '#d4d4d4', text: '#525252', badge: '#737373', label: 'Not Available' },
    };
    const rc = ratingColors[screening.rating] || ratingColors.insufficient;

    let html = `
      <div style="border: 1px solid ${rc.border}; border-radius: 12px; overflow: hidden; background: white;">
        <div style="padding: 20px; background: ${rc.bg}; border-bottom: 1px solid ${rc.border};">
          <div style="display: flex; justify-content: space-between; align-items: start; flex-wrap: wrap; gap: 12px;">
            <div>
              <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
                <span style="font-size: 15px; font-weight: 700; color: #1a1a1a;">Appeal Screening</span>
                <span style="display: inline-block; padding: 2px 10px; border-radius: 20px; font-size: 12px; font-weight: 600; color: white; background: ${rc.badge};">${rc.label}</span>
              </div>
              <p style="font-size: 13px; color: ${rc.text}; margin: 0; max-width: 500px;">${screening.message}</p>
            </div>
            ${daysLeft > 0 ? `<div style="text-align: right; flex-shrink: 0;">
              <div style="font-size: 22px; font-weight: 800; color: #dc2626;">${daysLeft}</div>
              <div style="font-size: 10px; color: #991b1b; text-transform: uppercase; letter-spacing: 0.5px;">days until deadline</div>
            </div>` : ''}
          </div>
    `;

    // Risk warning
    if (screening.riskWarning) {
      html += `
          <div style="margin-top: 12px; padding: 10px 14px; background: #fef2f2; border: 1px solid #fca5a5; border-radius: 8px;">
            <p style="font-size: 12px; color: #991b1b; margin: 0; font-weight: 600;">⚠️ ${screening.riskWarning}</p>
          </div>
      `;
    }

    html += `</div>`; // Close header

    // Analysis details
    if (screening.analysis && screening.analysis.compCount > 0) {
      const a = screening.analysis;
      html += `
        <div style="padding: 16px 20px; border-bottom: 1px solid #e5e5e5;">
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 12px;">
            <div style="text-align: center;">
              <div style="font-size: 10px; color: #999; text-transform: uppercase;">Your Assessment</div>
              <div style="font-size: 16px; font-weight: 700; font-family: monospace;">${fmt(subject.totalValue)}</div>
            </div>
            ${screening.suggestedValue ? `<div style="text-align: center;">
              <div style="font-size: 10px; color: #999; text-transform: uppercase;">Suggested Value</div>
              <div style="font-size: 16px; font-weight: 700; font-family: monospace; color: #166534;">${fmt(screening.suggestedValue)}</div>
            </div>` : ''}
            <div style="text-align: center;">
              <div style="font-size: 10px; color: #999; text-transform: uppercase;">Median Comp Sale</div>
              <div style="font-size: 16px; font-weight: 700; font-family: monospace;">${fmt(a.medianSalePrice || 0)}</div>
            </div>
            <div style="text-align: center;">
              <div style="font-size: 10px; color: #999; text-transform: uppercase;">Comps Found</div>
              <div style="font-size: 16px; font-weight: 700; font-family: monospace;">${a.compCount}</div>
            </div>
          </div>
        </div>
      `;
    }

    // CTA section — only show for strong/moderate cases
    if (screening.rating === 'strong' || screening.rating === 'moderate' || isAdmin) {
      html += `
        <div style="padding: 20px;" id="appeal-packet-cta">
          <div style="text-align: center; margin-bottom: 16px;">
            <p style="font-size: 15px; font-weight: 700; color: #1a1a1a; margin: 0 0 6px 0;">Get Your Appeal Packet</p>
            <p style="font-size: 13px; color: #666; margin: 0;">A ready-to-submit evidence package with comparable sales, assessment analysis, and a pre-written appeal letter.</p>
          </div>

          <div id="appeal-questionnaire" style="margin-bottom: 16px;">
            <p style="font-size: 12px; font-weight: 600; color: #666; margin: 0 0 10px 0; text-transform: uppercase; letter-spacing: 0.5px;">Quick questions to strengthen your case:</p>
            <div style="display: grid; gap: 8px;">
              <label style="display: flex; align-items: center; gap: 8px; font-size: 13px; color: #333; cursor: pointer;">
                <input type="checkbox" id="aq-condition" style="width: 16px; height: 16px;"> Does your property need major repairs?
              </label>
              <label style="display: flex; align-items: center; gap: 8px; font-size: 13px; color: #333; cursor: pointer;">
                <input type="checkbox" id="aq-storm" style="width: 16px; height: 16px;"> Was your property affected by Tropical Storm Helene?
              </label>
              <label style="display: flex; align-items: center; gap: 8px; font-size: 13px; color: #333; cursor: pointer;">
                <input type="checkbox" id="aq-errors" style="width: 16px; height: 16px;"> Is any information on your property record incorrect?
              </label>
              <label style="display: flex; align-items: center; gap: 8px; font-size: 13px; color: #333; cursor: pointer;">
                <input type="checkbox" id="aq-other" style="width: 16px; height: 16px;"> Are there other factors affecting your property's value?
              </label>
            </div>
          </div>

          <button id="appeal-packet-buy" onclick="window.__generateAppealPacket('${subject.pin}')" style="
            display: block; width: 100%; padding: 14px; border: none; border-radius: 8px;
            background: #1B2A4A; color: white; font-size: 15px; font-weight: 700; cursor: pointer;
            transition: background 0.2s;
          " onmouseover="this.style.background='#2d4470'" onmouseout="this.style.background='#1B2A4A'">
            ${isAdmin ? 'Generate Packet (Admin)' : `Get Appeal Packet — $${pricing.amount}`}
          </button>

          <p style="font-size: 11px; color: #999; text-align: center; margin: 10px 0 0 0;">
            Includes cover letter, comparable sales analysis, assessment review, and step-by-step filing instructions.
          </p>
        </div>
      `;
    }

    // Disclaimer
    html += `
      <div style="padding: 12px 20px; background: #fafafa; border-top: 1px solid #e5e5e5;">
        <p style="font-size: 10px; color: #999; margin: 0; line-height: 1.5;">
          This screening is based on publicly available county data and is for informational purposes only. 
          It is not legal or tax advice. Filing an appeal does not guarantee a reduction — your value may stay the same, 
          decrease, or increase. Not affiliated with Buncombe County government.
        </p>
      </div>
    `;

    html += `</div>`; // Close card
    card.innerHTML = html;
    return card;
  }

  // Generate and download the appeal packet
  window.__generateAppealPacket = async function(pin) {
    const btn = document.getElementById('appeal-packet-buy');
    if (!btn) return;
    const origText = btn.textContent;
    btn.textContent = 'Generating your packet...';
    btn.disabled = true;
    btn.style.opacity = '0.7';

    try {
      const answers = {
        conditionIssues: document.getElementById('aq-condition')?.checked || false,
        stormDamage: document.getElementById('aq-storm')?.checked || false,
        recordErrors: document.getElementById('aq-errors')?.checked || false,
        otherFactors: document.getElementById('aq-other')?.checked || false,
      };

      const res = await fetch(`/api/appeal-packet/${pin}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(answers),
      });

      if (!res.ok) throw new Error('Failed to generate packet');
      const data = await res.json();

      // Generate PDF in the browser using the returned data
      generatePDF(data);

      btn.textContent = '✓ Packet Downloaded';
      btn.style.background = '#166534';
      setTimeout(() => {
        btn.textContent = origText;
        btn.style.background = '#1B2A4A';
        btn.style.opacity = '1';
        btn.disabled = false;
      }, 3000);
    } catch (err) {
      console.error('Packet generation failed:', err);
      btn.textContent = 'Error — try again';
      btn.style.background = '#dc2626';
      setTimeout(() => {
        btn.textContent = origText;
        btn.style.background = '#1B2A4A';
        btn.style.opacity = '1';
        btn.disabled = false;
      }, 3000);
    }
  };

  function generatePDF(data) {
    const { property: p, comps, analysis: a, questionnaire: q, appealText } = data;

    // Build printable HTML and open in new window for printing/saving as PDF
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('Please allow popups to download your appeal packet.');
      return;
    }

    const compsTable = comps.map((c, i) => `
      <tr>
        <td style="padding: 8px; border-bottom: 1px solid #e5e5e5;">${c.address}</td>
        <td style="padding: 8px; border-bottom: 1px solid #e5e5e5; text-align: right;">${fmt(c.salePrice)}</td>
        <td style="padding: 8px; border-bottom: 1px solid #e5e5e5; text-align: center;">${c.saleDate}</td>
        <td style="padding: 8px; border-bottom: 1px solid #e5e5e5; text-align: right;">${c.sqft ? c.sqft.toLocaleString() : 'N/A'}</td>
        <td style="padding: 8px; border-bottom: 1px solid #e5e5e5; text-align: right;">${c.acreage ? c.acreage.toFixed(2) : 'N/A'}</td>
        <td style="padding: 8px; border-bottom: 1px solid #e5e5e5; text-align: center;">${c.yearBuilt || 'N/A'}</td>
        <td style="padding: 8px; border-bottom: 1px solid #e5e5e5; text-align: center;">${c.bedrooms || 'N/A'}/${c.baths || 'N/A'}</td>
      </tr>
    `).join('');

    const suggestedValueDisplay = a.suggestedValue ? fmt(a.suggestedValue) : fmt(a.medianSalePrice || p.totalValue);

    const html = `<!DOCTYPE html>
<html>
<head>
  <title>Appeal Packet — ${p.address}</title>
  <style>
    @media print { body { margin: 0; } .no-print { display: none; } .page-break { page-break-before: always; } }
    body { font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; color: #1a1a1a; line-height: 1.6; max-width: 800px; margin: 0 auto; padding: 20px; font-size: 13px; }
    h1 { font-size: 22px; color: #1B2A4A; margin-bottom: 4px; }
    h2 { font-size: 16px; color: #1B2A4A; border-bottom: 2px solid #1B2A4A; padding-bottom: 4px; margin-top: 30px; }
    h3 { font-size: 14px; color: #333; margin-top: 20px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th { background: #1B2A4A; color: white; padding: 8px; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
    .highlight { background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; padding: 12px 16px; margin: 12px 0; }
    .warning { background: #fef2f2; border: 1px solid #fca5a5; border-radius: 8px; padding: 12px 16px; margin: 12px 0; }
    .info { background: #f0f9ff; border: 1px solid #93c5fd; border-radius: 8px; padding: 12px 16px; margin: 12px 0; }
    .disclaimer { font-size: 10px; color: #999; border-top: 1px solid #e5e5e5; padding-top: 12px; margin-top: 30px; }
  </style>
</head>
<body>

<div class="no-print" style="background: #1B2A4A; color: white; padding: 16px; border-radius: 8px; margin-bottom: 20px; text-align: center;">
  <p style="margin: 0 0 8px 0; font-weight: 700;">Your Appeal Packet is Ready</p>
  <p style="margin: 0 0 12px 0; font-size: 12px; opacity: 0.8;">Press Ctrl+P (or Cmd+P on Mac) to save as PDF or print.</p>
  <button onclick="window.print()" style="padding: 10px 24px; background: white; color: #1B2A4A; border: none; border-radius: 6px; font-weight: 700; cursor: pointer; font-size: 14px;">Save as PDF / Print</button>
</div>

<!-- PAGE 1: INSTRUCTIONS -->
<h1>Property Tax Appeal Packet</h1>
<p style="color: #666; margin-top: 0;">Prepared for: <strong>${p.owner}</strong> — ${p.address}</p>
<p style="color: #666;">PIN: ${p.pin} · Assessed Value: ${fmt(p.totalValue)} · Date: ${new Date().toLocaleDateString()}</p>

<h2>How to Submit Your Appeal</h2>

<h3>Option 1: Submit Online (Recommended)</h3>
<ol>
  <li>Go to <strong>tax.buncombenc.gov</strong></li>
  <li>Search for your property using PIN: <strong>${p.pin}</strong></li>
  <li>Click "Tax Appeal Request"</li>
  <li>Review your property record — check that all details are correct</li>
  <li>Click "Next" then choose "File Online"</li>
  <li>In the "Reason for Appeal" box, copy and paste the appeal text from Page 2 of this packet</li>
  <li>For "Opinion of Value," enter: <strong>${suggestedValueDisplay}</strong></li>
  <li>Enter your name, phone, and email</li>
  <li>Select "Property Owner"</li>
  <li>Upload this entire packet as a PDF under "Supporting Documentation"</li>
  <li>Click "Review" and submit</li>
</ol>

<h3>Option 2: Mail or Drop Off</h3>
<ol>
  <li>Print this entire packet</li>
  <li>Download the paper appeal form from tax.buncombenc.gov (or use the form mailed with your notice)</li>
  <li>Fill in the "Reason for Appeal" using the text on Page 2</li>
  <li>Write your opinion of value: <strong>${suggestedValueDisplay}</strong></li>
  <li>Sign and date the form</li>
  <li>Attach this packet as supporting documentation</li>
  <li>Mail or deliver to: <strong>Buncombe County Property Assessment, 182 College Street, Asheville, NC 28801</strong></li>
</ol>

<h3>Option 3: Attend an Appeal Clinic</h3>
<p>Bring this packet and your revaluation notice to a free appeal clinic. Visit buncombetaxlookup.com for clinic dates and locations.</p>

<div class="info">
  <strong>Important:</strong> File your appeal as soon as possible. The formal appeal deadline is May 5, 2026. 
  Call (828) 250-4940 to confirm your specific deadline or if you have questions.
  Allow at least 90 days for your appeal to be processed.
</div>

${q.hasConditionIssues || q.hasStormDamage ? `
<div class="warning">
  <strong>You indicated property condition or storm damage issues.</strong> Include photos showing the damage or condition problems 
  with your appeal submission. Photos significantly strengthen your case. You can upload them online or include printed copies 
  if mailing.
</div>
` : ''}

${q.hasRecordErrors ? `
<div class="warning">
  <strong>You indicated errors in your property record.</strong> When filling out the appeal form, use the "Actual" column 
  to correct any incorrect information (square footage, bedrooms, bathrooms, etc.). Record corrections can directly 
  affect your assessed value.
</div>
` : ''}

<!-- PAGE 2: COVER LETTER -->
<div class="page-break"></div>
<h2>Appeal Letter</h2>
<p style="margin-bottom: 4px;">To: Buncombe County Property Assessment Office</p>
<p style="margin-top: 0; margin-bottom: 4px;">From: ${p.owner}</p>
<p style="margin-top: 0; margin-bottom: 4px;">Property: ${p.address} (PIN: ${p.pin})</p>
<p style="margin-top: 0; margin-bottom: 4px;">Date: ${new Date().toLocaleDateString()}</p>
<p style="margin-top: 0;">Current Assessed Value: ${fmt(p.totalValue)}</p>

<div style="margin: 20px 0; padding: 16px; background: #fafafa; border: 1px solid #e5e5e5; border-radius: 8px; white-space: pre-wrap; font-size: 13px; line-height: 1.8;">
${appealText}
</div>

<p style="margin-top: 20px; font-weight: 600;">Suggested Opinion of Value: ${suggestedValueDisplay}</p>
<p style="font-size: 11px; color: #666;">If you prefer a different value, you may cross out the amount above and write your preferred value, or enter a different amount on the county's online form.</p>

<p style="margin-top: 40px;">Signature: _____________________________________ &nbsp;&nbsp;&nbsp; Date: _______________</p>

<!-- PAGE 3: COMPARABLE SALES EVIDENCE -->
<div class="page-break"></div>
<h2>Comparable Sales Analysis</h2>

<div class="highlight">
  <strong>Subject Property:</strong> ${p.address}<br>
  ${p.sqft ? p.sqft.toLocaleString() + ' sq ft · ' : ''}${p.acreage.toFixed(2)} acres · Built ${p.yearBuilt || 'N/A'} · ${p.bedrooms} bed · ${p.fullBaths}${p.halfBaths ? '.' + (p.halfBaths * 5) : ''} bath<br>
  <strong>Current Assessment:</strong> ${fmt(p.totalValue)} (Land: ${fmt(p.landValue)} · Building: ${fmt(p.buildingValue)})
  ${p.prevValue ? '<br><strong>Previous Assessment (2021):</strong> ' + fmt(p.prevValue) + ' (Change: +' + p.change + '%)' : ''}
</div>

<p>The following comparable properties were selected based on Buncombe County's published criteria: similar property type, 
similar age (within 10 years), similar size, located in the same assessment neighborhood (${p.neighborhood || 'N/A'}), 
and sold within 24 months prior to the January 1, 2026 valuation date. All sales are qualified sales as recorded in 
the county's property record system.</p>

<table>
  <thead>
    <tr>
      <th>Address</th>
      <th style="text-align: right;">Sale Price</th>
      <th style="text-align: center;">Date</th>
      <th style="text-align: right;">Sq Ft</th>
      <th style="text-align: right;">Acres</th>
      <th style="text-align: center;">Built</th>
      <th style="text-align: center;">Bed/Bath</th>
    </tr>
  </thead>
  <tbody>
    ${compsTable}
  </tbody>
</table>

${a.medianSalePrice ? `
<div class="highlight" style="margin-top: 16px;">
  <strong>Median comparable sale price:</strong> ${fmt(a.medianSalePrice)}<br>
  <strong>Your assessed value:</strong> ${fmt(p.totalValue)} (${Math.round(p.totalValue / a.medianSalePrice * 100)}% of median sale)<br>
  ${a.medianPricePerSqft > 0 ? `<strong>Median price per sq ft:</strong> $${a.medianPricePerSqft}/sqft (yours: $${a.subjectPricePerSqft}/sqft)` : ''}
</div>
` : ''}

<!-- PROPERTY RECORD SNAPSHOT -->
<h2>Property Record — On File</h2>
<p>The following information is what the county has on file for your property. Review carefully and note any errors on your appeal form.</p>

<table>
  <thead><tr><th>Field</th><th>On File</th></tr></thead>
  <tbody>
    <tr><td style="padding: 6px 8px; border-bottom: 1px solid #e5e5e5;">Year Built</td><td style="padding: 6px 8px; border-bottom: 1px solid #e5e5e5;">${p.yearBuilt || 'N/A'}</td></tr>
    <tr><td style="padding: 6px 8px; border-bottom: 1px solid #e5e5e5;">Total Finished Area</td><td style="padding: 6px 8px; border-bottom: 1px solid #e5e5e5;">${p.sqft ? p.sqft.toLocaleString() + ' sq ft' : 'N/A'}</td></tr>
    <tr><td style="padding: 6px 8px; border-bottom: 1px solid #e5e5e5;">Bedrooms</td><td style="padding: 6px 8px; border-bottom: 1px solid #e5e5e5;">${p.bedrooms || 'N/A'}</td></tr>
    <tr><td style="padding: 6px 8px; border-bottom: 1px solid #e5e5e5;">Full Baths</td><td style="padding: 6px 8px; border-bottom: 1px solid #e5e5e5;">${p.fullBaths || 'N/A'}</td></tr>
    <tr><td style="padding: 6px 8px; border-bottom: 1px solid #e5e5e5;">Half Baths</td><td style="padding: 6px 8px; border-bottom: 1px solid #e5e5e5;">${p.halfBaths || 'N/A'}</td></tr>
    <tr><td style="padding: 6px 8px; border-bottom: 1px solid #e5e5e5;">Building Type</td><td style="padding: 6px 8px; border-bottom: 1px solid #e5e5e5;">${p.buildingType || 'N/A'}</td></tr>
    <tr><td style="padding: 6px 8px; border-bottom: 1px solid #e5e5e5;">Quality</td><td style="padding: 6px 8px; border-bottom: 1px solid #e5e5e5;">${p.quality || 'N/A'}</td></tr>
    <tr><td style="padding: 6px 8px; border-bottom: 1px solid #e5e5e5;">Condition</td><td style="padding: 6px 8px; border-bottom: 1px solid #e5e5e5;">${p.condition || 'N/A'}</td></tr>
    <tr><td style="padding: 6px 8px; border-bottom: 1px solid #e5e5e5;">Acreage</td><td style="padding: 6px 8px; border-bottom: 1px solid #e5e5e5;">${p.acreage.toFixed(2)}</td></tr>
    <tr><td style="padding: 6px 8px; border-bottom: 1px solid #e5e5e5;">Land Value</td><td style="padding: 6px 8px; border-bottom: 1px solid #e5e5e5;">${fmt(p.landValue)} (${p.landPctOfTotal}% of total)</td></tr>
    <tr><td style="padding: 6px 8px; border-bottom: 1px solid #e5e5e5;">Building Value</td><td style="padding: 6px 8px; border-bottom: 1px solid #e5e5e5;">${fmt(p.buildingValue)}</td></tr>
  </tbody>
</table>

<div class="disclaimer">
  <strong>Disclaimer:</strong> This appeal packet is provided for informational purposes to assist you in exercising your right to 
  appeal your property assessment under North Carolina General Statute 105-322. It is not legal or tax advice. Filing an appeal 
  does not guarantee a reduction in assessed value — your value may stay the same, decrease, or increase. The comparable sales data, 
  analyses, and suggested values contained in this packet are based on publicly available county data and are estimates only. 
  You are responsible for reviewing all information for accuracy before submitting. buncombetaxlookup.com is not affiliated with 
  Buncombe County government.<br><br>
  Data sources: Buncombe County GIS (gis.buncombecounty.org) · Buncombe County Property Record Cards (prc-buncombe.spatialest.com)<br>
  Generated by buncombetaxlookup.com on ${new Date().toLocaleDateString()}
</div>

</body>
</html>`;

    printWindow.document.write(html);
    printWindow.document.close();
  }

  // Main: inject the screening card into the property page
  async function init() {
    const pin = getPin();
    if (!pin) return;

    // Wait for the page to load
    await new Promise(r => setTimeout(r, 2000));

    // Check if already injected
    if (document.getElementById('appeal-packet-card')) return;

    // Find insertion point — after the comparable sales widget or before the appeals section
    const appealSection = document.querySelector('[data-testid="appeal-expand"]')?.closest('.mb-6')
      || document.querySelector('h2, h3, [class*="CardTitle"]');
    
    // Try to find the appeals card by looking for "Think Your Value Is Wrong"
    let insertBefore = null;
    const cards = document.querySelectorAll('[class*="Card"], [class*="card"]');
    for (const card of cards) {
      if (card.textContent.includes('Think Your Value Is Wrong')) {
        insertBefore = card;
        break;
      }
    }

    if (!insertBefore) {
      // Fallback: insert before the last card in the main content
      const mainContent = document.querySelector('.max-w-5xl');
      if (mainContent) {
        const children = mainContent.children;
        insertBefore = children[children.length - 2]; // Before the "How It Works" callout
      }
    }

    if (!insertBefore) return;

    // Show loading state
    const loading = document.createElement('div');
    loading.id = 'appeal-packet-card';
    loading.innerHTML = '<div style="padding: 20px; text-align: center; color: #999; font-size: 13px;">Analyzing appeal potential...</div>';
    insertBefore.parentNode.insertBefore(loading, insertBefore);

    try {
      const res = await fetch(`/api/appeal-screening/${pin}`);
      if (!res.ok) throw new Error('Screening failed');
      const data = await res.json();

      const card = createScreeningCard(data);
      loading.replaceWith(card);
    } catch (err) {
      console.error('Appeal screening failed:', err);
      loading.remove();
    }
  }

  // Run on hash change (SPA navigation)
  window.addEventListener('hashchange', () => {
    const existing = document.getElementById('appeal-packet-card');
    if (existing) existing.remove();
    setTimeout(init, 1500);
  });

  // Initial run
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 2000));
  } else {
    setTimeout(init, 2000);
  }
})();
