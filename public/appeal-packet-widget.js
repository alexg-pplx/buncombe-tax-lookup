/**
 * Appeal Packet Widget
 * Injects an appeal screening card + packet purchase flow into property pages.
 * Self-contained — does not modify the React bundle.
 */
(function() {
  'use strict';

  // Check if we're on a property page
  function getPin() {
    const hash = window.location.hash;
    const match = hash.match(/#\/property\/(\d+)/);
    return match ? match[1] : null;
  }

  function fmt(n) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
  }

  // Deadline countdown — uses appealDeadline from API response (ISO YYYY-MM-DD) or falls back to May 5 2026
  function daysUntilDeadline(isoDeadline) {
    const deadline = isoDeadline ? new Date(isoDeadline + 'T23:59:59') : new Date(2026, 4, 5);
    const now = new Date();
    return Math.max(0, Math.ceil((deadline - now) / (1000 * 60 * 60 * 24)));
  }

  function createScreeningCard(data) {
    const { subject, screening, comps, pricing, appealDeadline, taxImpact } = data;
    const card = document.createElement('div');
    card.id = 'appeal-packet-card';
    card.style.cssText = 'margin-bottom: 1.5rem;';

    const daysLeft = daysUntilDeadline(appealDeadline);

    // Rating colors
    const ratingColors = {
      strong: { bg: '#f0fdf4', border: '#86efac', text: '#166534', badge: '#16a34a', label: 'Strong Case' },
      moderate: { bg: '#fefce8', border: '#fde047', text: '#854d0e', badge: '#ca8a04', label: 'Moderate Case' },
      weak: { bg: '#fef2f2', border: '#fca5a5', text: '#991b1b', badge: '#dc2626', label: 'Weak Case' },
      insufficient: { bg: '#f5f5f5', border: '#d4d4d4', text: '#525252', badge: '#737373', label: 'Insufficient Data' },
      unsupported: { bg: '#f5f5f5', border: '#d4d4d4', text: '#525252', badge: '#737373', label: 'Not Available' },
    };
    const rc = ratingColors[screening.rating] || ratingColors.insufficient;

    const deadlineDisplay = appealDeadline
      ? new Date(appealDeadline + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
      : 'May 5, 2026';

    let html = `
      <div style="border: 1px solid ${rc.border}; border-radius: 12px; overflow: hidden; background: white;">
        <div style="padding: 20px; background: ${rc.bg}; border-bottom: 1px solid ${rc.border};">
          <div style="display: flex; justify-content: space-between; align-items: start; flex-wrap: wrap; gap: 12px;">
            <div>
              <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
                <span style="font-size: 15px; font-weight: 700; color: #1a1a1a;">Appeal Screening</span>
                <span style="display: inline-block; padding: 2px 10px; border-radius: 20px; font-size: 12px; font-weight: 600; color: white; background: ${rc.badge};">${rc.label}</span>
              </div>
              <p style="font-size: 13px; color: ${rc.text}; margin: 0; max-width: 500px;">
                ${screening.rating === 'insufficient'
                  ? 'Based on comparable sales and similar property assessments in your area, there is not enough data to evaluate your assessment. Other factors like property condition, storm damage, or record errors could still support an appeal &mdash; see below.'
                  : (screening.rating === 'weak'
                    ? 'Based on comparable sales and similar property assessments, your assessment appears to be at or near market value. Other factors like property condition, storm damage, or record errors could change this &mdash; see below.'
                    : screening.message)}
              </p>
            </div>
            <div style="text-align: right; flex-shrink: 0;">
              <div style="font-size: 10px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 2px;">Appeal Deadline</div>
              <div style="font-size: 13px; font-weight: 700; color: #1a1a1a;">${deadlineDisplay}</div>
              ${daysLeft > 0 ? `<div style="font-size: 11px; color: ${daysLeft <= 14 ? '#dc2626' : '#6b7280'}; margin-top: 1px;">${daysLeft} day${daysLeft !== 1 ? 's' : ''} remaining</div>` : '<div style="font-size: 11px; color: #dc2626; font-weight: 600;">Deadline passed</div>'}
            </div>
          </div>
    `;

    html += `</div>`; // Close header

    // ============================================================
    // PROPERTY RECORD REVIEW — shown for ALL ratings, before analysis
    // ============================================================
    const qualityLabels = {
      'FAIR': 'Fair — Economy materials, minimal features',
      'AVG': 'Average — Standard construction, meets building code',
      'AVG +': 'Above Average — Better than standard, some upgrades',
      'CUST -': 'Custom (Low) — Custom-built, modest finishes',
      'CUST': 'Custom — Individually designed, higher-end materials',
      'CUST +': 'Custom (High) — Top-tier custom construction',
      'SUPR': 'Superior — Exceptionally high quality',
      'EXCEP': 'Exceptional — Architect-designed, premium everything',
    };
    const conditionLabels = {
      'POOR': 'Poor — Major structural or functional issues',
      'BELOW NORMAL': 'Below Normal — Significant deferred maintenance',
      'NORMAL': 'Normal — Average condition, typical wear and tear',
      'GOOD': 'Good — Well-maintained, minimal issues',
      'EXCELLENT': 'Excellent — Like-new condition',
    };
    const subjectQuality = (subject.quality || '').trim();
    const subjectCondition = (subject.condition || 'NORMAL').trim();
    const qualityDisplay = qualityLabels[subjectQuality] || subjectQuality || 'Not specified';
    const conditionDisplay = conditionLabels[subjectCondition] || subjectCondition || 'Not specified';

    // Hints: flag things that commonly deserve a second look
    const qualityHint = (subjectQuality.includes('CUST') || subjectQuality.includes('SUPR') || subjectQuality.includes('EXCEP'))
      ? `<span style="display:block;font-size:11px;color:#6b7280;margin-top:4px;">Quality reflects the original construction — how your home was built, not its current state. A custom-built home from the 1970s is still "custom quality." Age and wear should be reflected in the Condition rating below, not here.</span>`
      : '';
    const conditionHint = subjectCondition === 'NORMAL'
      ? `<span style="display:block;font-size:11px;color:#b45309;margin-top:4px;">⚠ <strong>This is where most errors are.</strong> Almost every property in the county is listed as "Normal" — even homes with aging roofs, outdated systems, deferred maintenance, or Helene damage. If your home has real issues, change this. The county assessor has said condition corrections can quickly reduce your value.</span>`
      : '';

    // Build quality dropdown options
    const qualityOptions = ['FAIR','AVG','AVG +','CUST -','CUST','CUST +','SUPR','EXCEP'].map(q => {
      const lab = qualityLabels[q] || q;
      const sel = q === subjectQuality ? ' selected' : '';
      return `<option value="${q}"${sel}>${lab}</option>`;
    }).join('');

    const conditionOptions = ['POOR','BELOW NORMAL','NORMAL','GOOD','EXCELLENT'].map(c => {
      const lab = conditionLabels[c] || c;
      const sel = c === subjectCondition ? ' selected' : '';
      return `<option value="${c}"${sel}>${lab}</option>`;
    }).join('');

    html += `
      <div style="padding: 16px 20px; border-bottom: 1px solid #e5e5e5; background: #f8fafc;">
        <p style="font-size: 14px; font-weight: 700; color: #1B2A4A; margin: 0 0 4px 0;">Step 1: Review Your Property Record</p>
        <p style="font-size: 12px; color: #666; margin: 0 0 12px 0; line-height: 1.5;">This is what the county has on file. Errors here directly affect your assessed value. If anything is wrong, correct it below — we'll include the corrections in your appeal letter.</p>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px;">
          <div>
            <label style="display:block;font-size:11px;color:#888;text-transform:uppercase;margin-bottom:3px;">Heated Sq Ft</label>
            <div style="display:flex;align-items:center;gap:6px;">
              <span style="font-size:14px;font-weight:600;font-family:monospace;">${subject.sqft ? subject.sqft.toLocaleString() : 'N/A'}</span>
              <input type="text" id="prc-sqft" placeholder="Correct value" style="width:90px;padding:4px 8px;border:1px solid #d4d4d4;border-radius:4px;font-size:12px;font-family:monospace;" oninput="window.__prcCorrectionChanged()">
            </div>
          </div>
          <div>
            <label style="display:block;font-size:11px;color:#888;text-transform:uppercase;margin-bottom:3px;">Bedrooms</label>
            <div style="display:flex;align-items:center;gap:6px;">
              <span style="font-size:14px;font-weight:600;font-family:monospace;">${subject.bedrooms || 'N/A'}</span>
              <input type="text" id="prc-beds" placeholder="Correct" style="width:60px;padding:4px 8px;border:1px solid #d4d4d4;border-radius:4px;font-size:12px;" oninput="window.__prcCorrectionChanged()">
            </div>
          </div>
          <div>
            <label style="display:block;font-size:11px;color:#888;text-transform:uppercase;margin-bottom:3px;">Full Baths</label>
            <div style="display:flex;align-items:center;gap:6px;">
              <span style="font-size:14px;font-weight:600;font-family:monospace;">${subject.fullBaths || 'N/A'}</span>
              <input type="text" id="prc-fullbaths" placeholder="Correct" style="width:60px;padding:4px 8px;border:1px solid #d4d4d4;border-radius:4px;font-size:12px;" oninput="window.__prcCorrectionChanged()">
            </div>
          </div>
          <div>
            <label style="display:block;font-size:11px;color:#888;text-transform:uppercase;margin-bottom:3px;">Half Baths</label>
            <div style="display:flex;align-items:center;gap:6px;">
              <span style="font-size:14px;font-weight:600;font-family:monospace;">${subject.halfBaths || 0}</span>
              <input type="text" id="prc-halfbaths" placeholder="Correct" style="width:60px;padding:4px 8px;border:1px solid #d4d4d4;border-radius:4px;font-size:12px;" oninput="window.__prcCorrectionChanged()">
            </div>
          </div>
          <div>
            <label style="display:block;font-size:11px;color:#888;text-transform:uppercase;margin-bottom:3px;">Year Built</label>
            <div style="display:flex;align-items:center;gap:6px;">
              <span style="font-size:14px;font-weight:600;font-family:monospace;">${subject.yearBuilt || 'N/A'}</span>
              <input type="text" id="prc-yearbuilt" placeholder="Correct" style="width:70px;padding:4px 8px;border:1px solid #d4d4d4;border-radius:4px;font-size:12px;" oninput="window.__prcCorrectionChanged()">
            </div>
          </div>
          <div>
            <label style="display:block;font-size:11px;color:#888;text-transform:uppercase;margin-bottom:3px;">Acreage</label>
            <div style="display:flex;align-items:center;gap:6px;">
              <span style="font-size:14px;font-weight:600;font-family:monospace;">${subject.acreage ? subject.acreage.toFixed(2) : 'N/A'}</span>
              <input type="text" id="prc-acreage" placeholder="Correct" style="width:70px;padding:4px 8px;border:1px solid #d4d4d4;border-radius:4px;font-size:12px;" oninput="window.__prcCorrectionChanged()">
            </div>
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px;">
          <div>
            <label style="display:block;font-size:11px;color:#888;text-transform:uppercase;margin-bottom:3px;">Quality Grade</label>
            <div>
              <span style="font-size:13px;font-weight:600;">${qualityDisplay}</span>
              ${qualityHint}
              <select id="prc-quality" style="display:block;width:100%;margin-top:6px;padding:6px 8px;border:1px solid #d4d4d4;border-radius:4px;font-size:12px;background:white;" onchange="window.__prcCorrectionChanged()">
                <option value="">— No correction needed —</option>
                ${qualityOptions}
              </select>
            </div>
          </div>
          <div>
            <label style="display:block;font-size:11px;color:#888;text-transform:uppercase;margin-bottom:3px;">Condition</label>
            <div>
              <span style="font-size:13px;font-weight:600;">${conditionDisplay}</span>
              ${conditionHint}
              <select id="prc-condition" style="display:block;width:100%;margin-top:6px;padding:6px 8px;border:1px solid #d4d4d4;border-radius:4px;font-size:12px;background:white;" onchange="window.__prcCorrectionChanged()">
                <option value="">— No correction needed —</option>
                ${conditionOptions}
              </select>
            </div>
          </div>
        </div>

        <div id="prc-corrections-banner" style="display:none; background: #FFF8E6; border: 1px solid #E8D5A0; border-radius: 6px; padding: 8px 12px; margin-top: 8px;">
          <p style="font-size: 12px; color: #6B5A1E; margin: 0; font-weight: 600;">⚠ You've noted corrections. These will be included in your appeal letter. The screening analysis below is based on the county's current (uncorrected) data.</p>
        </div>

        <p style="font-size: 11px; color: #999; margin: 10px 0 0 0;">Compare against your <a href="https://prc-buncombe.spatialest.com/#/property/${subject.pin}" target="_blank" style="color: #2563eb;">full property record card</a> for complete details.</p>
      </div>
    `;

    // For weak/insufficient: constructive guidance with integrated form helper
    if (screening.rating === 'weak' || screening.rating === 'insufficient') {
      const a = screening.analysis || {};
      html += `
        <div style="padding: 16px 20px; border-bottom: 1px solid #e5e5e5;">
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 12px; margin-bottom: 14px;">
            <div style="text-align: center;">
              <div style="font-size: 10px; color: #999; text-transform: uppercase;">Your Assessment</div>
              <div style="font-size: 16px; font-weight: 700; font-family: monospace;">${fmt(subject.totalValue)}</div>
            </div>
            ${a.medianSalePrice ? `<div style="text-align: center;">
              <div style="font-size: 10px; color: #999; text-transform: uppercase;">Median Comp Sale</div>
              <div style="font-size: 16px; font-weight: 700; font-family: monospace;">${fmt(a.medianSalePrice)}</div>
            </div>` : ''}
            <div style="text-align: center;">
              <div style="font-size: 10px; color: #999; text-transform: uppercase;">Comps Found</div>
              <div style="font-size: 16px; font-weight: 700; font-family: monospace;">${a.compCount || 0}</div>
            </div>
          </div>

          <p style="font-size: 12px; color: #666; margin: 0 0 10px 0; line-height: 1.6;">Comparable sales are only one factor. You may still have grounds to appeal if any of the following apply.</p>

          <p style="font-size: 13px; color: #1B2A4A; margin: 0 0 8px 0; line-height: 1.6; font-weight: 600;">Check any that apply and we'll draft a free appeal letter for you:</p>

          <div style="display: grid; gap: 8px; margin-bottom: 14px;">
            <label style="display: flex; align-items: center; gap: 8px; font-size: 13px; color: #333; cursor: pointer;">
              <input type="checkbox" id="fa-condition" style="width: 16px; height: 16px;"
                onchange="window.__freeAppealCheckboxChanged()"> My property has condition issues or needs major repairs
            </label>
            <label style="display: flex; align-items: center; gap: 8px; font-size: 13px; color: #333; cursor: pointer;">
              <input type="checkbox" id="fa-helene" style="width: 16px; height: 16px;"
                onchange="window.__freeAppealCheckboxChanged()"> My property was damaged by Tropical Storm Helene
            </label>
            <label style="display: flex; align-items: center; gap: 8px; font-size: 13px; color: #333; cursor: pointer;">
              <input type="checkbox" id="fa-errors" style="width: 16px; height: 16px;"
                onchange="window.__freeAppealCheckboxChanged()"> The county has incorrect information on my property record
            </label>
            <label style="display: flex; align-items: center; gap: 8px; font-size: 13px; color: #333; cursor: pointer;">
              <input type="checkbox" id="fa-relief" style="width: 16px; height: 16px;"
                onchange="window.__freeAppealCheckboxChanged()"> I may qualify for tax relief programs
            </label>
          </div>

          <!-- Conditional fields container -->
          <div id="fa-conditional-fields"></div>

          <!-- Generated letter preview (shown after clicking generate) -->
          <div id="fa-letter-preview" style="display: none; margin-bottom: 14px;">

            <div style="background: #fef2f2; border: 1px solid #fca5a5; border-radius: 8px; padding: 10px 14px; margin-bottom: 14px;">
              <p style="font-size: 12px; color: #991b1b; margin: 0; font-weight: 600;">Important: Filing an appeal does not guarantee a reduction. The county may keep your value the same or increase it. Only proceed if you believe you have a legitimate reason, such as property damage, condition issues, or errors in your record.</p>
            </div>

            <p style="font-size: 12px; font-weight: 600; color: #333; margin: 0 0 8px 0;">Your appeal letter (you can edit before printing):</p>
            <textarea id="fa-letter-text" style="width: 100%; box-sizing: border-box; min-height: 300px; padding: 12px; border: 1px solid #d4d4d4; border-radius: 6px; font-size: 12px; font-family: 'Courier New', monospace; line-height: 1.6; resize: vertical; color: #333;"></textarea>
            <div style="display: flex; gap: 8px; margin-top: 8px;">
              <button onclick="window.__printFreeAppealLetter()" style="flex: 1; padding: 10px; border: none; border-radius: 6px; background: #1B2A4A; color: white; font-size: 13px; font-weight: 600; cursor: pointer;">Print This Letter</button>
              <button onclick="navigator.clipboard.writeText(document.getElementById('fa-letter-text').value).then(function(){this.textContent='Copied!'}.bind(this))" style="flex: 1; padding: 10px; border: 1px solid #d4d4d4; border-radius: 6px; background: white; color: #555; font-size: 13px; font-weight: 600; cursor: pointer;">Copy to Clipboard</button>
            </div>
            <p style="font-size: 11px; color: #999; margin: 8px 0 0 0;">Edit the letter above as needed, then print or copy.</p>
            <div style="text-align: center; margin-top: 12px; padding-top: 12px; border-top: 1px solid #e5e5e5;">
              <p style="font-size: 12px; color: #666; margin: 0 0 8px 0;">This tool is free. If it helped you, consider supporting it.</p>
              <a href="https://buymeacoffee.com/buncombetaxlookup" target="_blank" rel="noopener noreferrer" style="display: inline-block; padding: 8px 20px; background: #FFDD00; color: #000; font-size: 13px; font-weight: 600; border-radius: 6px; text-decoration: none;">Buy Me a Coffee ☕</a>
            </div>

            <div style="margin-top: 14px; padding-top: 14px; border-top: 1px solid #e5e5e5;">
              <p style="font-size: 14px; font-weight: 700; color: #1B2A4A; margin: 0 0 8px 0;">How to Submit Your Appeal</p>
              <div style="background: #fef2f2; border: 1px solid #fca5a5; border-radius: 6px; padding: 10px 14px; margin-bottom: 12px;">
                <p style="font-size: 12px; color: #991b1b; margin: 0; font-weight: 600;">Important: Appeals submitted without supporting documentation will be denied. Print ALL pages, not just the letter.</p>
              </div>
              <div style="font-size: 12px; color: #555; line-height: 1.7;">
                <p style="margin: 0 0 8px 0;"><strong>Option 1: File Online</strong> — Go to <strong>taxappeal.buncombenc.gov</strong>, search your PIN, click "Tax Appeal Request", and upload all pages as a PDF.</p>
                <p style="margin: 0 0 8px 0;"><strong>Option 2: By Phone</strong> — Call <strong>(828) 250-4940</strong> to schedule a 20-minute call with a county appraiser to discuss your value.</p>
                <p style="margin: 0 0 8px 0;"><strong>Option 3: Mail or Drop Off</strong> — Print and sign all pages, then mail or deliver to:<br>
                  <span style="display: inline-block; margin-left: 16px;">Buncombe County Tax Assessment<br>
                  <span style="margin-left: 16px;">182 College Street, Asheville, NC 28801</span></span><br>
                  <span style="font-size: 11px; color: #888;">We recommend certified mail or tracking for proof of delivery. Drop-off hours: Mon–Fri, 8 AM – 5 PM.</span></p>
                <p style="margin: 0 0 8px 0;"><strong>Option 4: Attend a Free Clinic</strong> — Bring all printed pages and your revaluation notice.</p>
              </div>
              <div style="font-size: 11px; color: #666; line-height: 1.6; margin-top: 8px;">
                <p style="margin: 0 0 4px 0;"><strong>Deadline:</strong> 30 days from the date you receive your notice of value, even after the deadline stated on the notice. The formal appeal deadline is May 5, 2026.</p>
                <p style="margin: 0 0 4px 0;"><strong>Questions:</strong> Call (828) 250-4940 or email realestate.questions@buncombenc.gov.</p>
              </div>
              <div style="background: #FFF8E6; border: 1px solid #E8D5A0; border-radius: 6px; padding: 10px 14px; margin-top: 10px;">
                <p style="font-size: 12px; color: #333; margin: 0 0 4px 0; font-weight: 600;">Strengthen your appeal with additional evidence:</p>
                <ul style="font-size: 12px; color: #555; margin: 0; padding-left: 18px; line-height: 1.8;">
                  <li>Photos of property condition issues or storm damage</li>
                  <li>Contractor estimates for needed repairs</li>
                  <li>A recent appraisal if you have one</li>
                  <li>Any other documentation that supports your case</li>
                </ul>
              </div>
            </div>
          </div>

          <!-- Generate button (hidden after letter is generated) -->
          <button id="fa-generate-btn" disabled onclick="window.__generateFreeAppealLetter()" style="
            display: block; width: 100%; padding: 12px; border: 2px solid #1B2A4A; border-radius: 8px;
            background: white; color: #1B2A4A; font-size: 14px; font-weight: 700; cursor: pointer;
            opacity: 0.4; transition: all 0.2s;
          ">Generate Free Appeal Letter</button>
          <p id="fa-generate-note" style="font-size: 11px; color: #999; text-align: center; margin: 8px 0 0 0;">
            Free — no payment required.
          </p>

          <div style="margin-top: 16px; padding-top: 14px; border-top: 1px solid #e5e5e5;">
            <p style="font-size: 12px; color: #555; margin: 0 0 6px 0; line-height: 1.6;">You can also call <strong>(828) 250-4940</strong>, email <strong>realestate.questions@buncombenc.gov</strong>, or request an appointment with an appraiser. Free appeal clinics:</p>
            <div style="font-size: 12px; color: #555; margin: 6px 0 0 0; line-height: 1.8;">
              ${(function() {
                const clinics = [
                  { d: new Date(2026,2,25), t: 'March 25, 3:30\u20136 PM', l: 'Enka-Candler Library, 1404 Sand Hill Rd' },
                  { d: new Date(2026,2,26), t: 'March 26, 6\u20138 PM', l: 'Southside Community Center, 285 Livingston St' },
                  { d: new Date(2026,3,1), t: 'April 1, 4\u20136:30 PM', l: 'Skyland/South Buncombe Library, 260 Overlook Rd' },
                  { d: new Date(2026,3,9), t: 'April 9, 4:30\u20136:30 PM', l: 'Weaverville Community Center, 60 Lakeshore Dr' },
                  { d: new Date(2026,3,16), t: 'April 16, 6\u20138:30 PM', l: 'Leicester Community Center, 2979 New Leicester Hwy' },
                ];
                const now = new Date();
                const future = clinics.filter(c => c.d >= now);
                if (future.length === 0) return '<em>Visit buncombetaxlookup.com for updated clinic information.</em>';
                return future.map(c => '\u2022 ' + c.t + ' \u2014 ' + c.l).join('<br>');
              })()}
            </div>
          </div>
        </div>
      `;
    }

    // For strong/moderate: show detailed analysis + CTA
    if (screening.rating === 'strong' || screening.rating === 'moderate') {
      const a = screening.analysis || {};
      // Only use the screening's suggested value (from market/land analysis). Don't suggest equity median — 
      // equity is an inconsistency argument, not a specific value claim.
      const suggestedVal = screening.suggestedValue || null;
      html += `
        <div style="padding: 16px 20px; border-bottom: 1px solid #e5e5e5; background: #f8fafc;">
          <p style="font-size: 14px; font-weight: 700; color: #1B2A4A; margin: 0 0 10px 0;">Step 2: Review the Evidence</p>
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 12px;">
            <div style="text-align: center;">
              <div style="font-size: 10px; color: #999; text-transform: uppercase;">Your Assessment</div>
              <div style="font-size: 16px; font-weight: 700; font-family: monospace;">${fmt(subject.totalValue)}</div>
            </div>
            ${a.medianSalePrice ? `<div style="text-align: center;">
              <div style="font-size: 10px; color: #999; text-transform: uppercase;">Median Comp Sale</div>
              <div style="font-size: 16px; font-weight: 700; font-family: monospace;">${fmt(a.medianSalePrice)}</div>
            </div>` : ''}
            ${suggestedVal ? `<div style="text-align: center;">
              <div style="font-size: 10px; color: #999; text-transform: uppercase;">Suggested Value</div>
              <div style="font-size: 16px; font-weight: 700; font-family: monospace; color: #16a34a;">${fmt(suggestedVal)}</div>
            </div>` : ''}
            <div style="text-align: center;">
              <div style="font-size: 10px; color: #999; text-transform: uppercase;">Comps Found</div>
              <div style="font-size: 16px; font-weight: 700; font-family: monospace;">${a.compCount}</div>
            </div>
            ${suggestedVal && taxImpact && taxImpact.estimatedAnnualSavings > 0 ? `<div style="text-align: center;">
              <div style="font-size: 10px; color: #999; text-transform: uppercase;">Est. Annual Savings</div>
              <div style="font-size: 16px; font-weight: 700; font-family: monospace; color: #16a34a;">~${fmt(taxImpact.estimatedAnnualSavings)}/yr</div>
            </div>` : ''}
          </div>
          ${suggestedVal ? `<p style="font-size: 11px; color: #666; margin: 10px 0 0 0; line-height: 1.5;">The suggested value of <strong>${fmt(suggestedVal)}</strong> is based on comparable sales and land data in your area. You can use this as your requested value in Step 3, or choose a different amount.${taxImpact && taxImpact.estimatedAnnualSavings > 0 ? ` At the current tax rate (${taxImpact.ratePerHundred}&#162;/$100 assessed value), this would save approximately <strong>${fmt(taxImpact.estimatedAnnualSavings)}/year</strong> in property taxes.` : ''} <span style="color: #9ca3af;">${taxImpact ? taxImpact.rateNote : 'Tax rate estimate based on 2025 district rates.'}</span></p>` : ''}
        </div>
      `;
    }

    // Evidence section — show comps and land sales
    if (screening.rating === 'strong' || screening.rating === 'moderate') {
      // Comparable sales table
      if (comps && comps.length > 0) {
        html += `
        <div style="padding: 16px 20px; border-bottom: 1px solid #e5e5e5;">
          <p style="font-size: 13px; font-weight: 700; color: #1B2A4A; margin: 0 0 10px 0;">Comparable Sales Used in This Analysis</p>
          <div style="overflow-x: auto;">
            <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
              <thead>
                <tr style="border-bottom: 2px solid #e5e5e5; text-align: left;">
                  <th style="padding: 6px 8px; color: #888; font-weight: 600;">Address</th>
                  <th style="padding: 6px 8px; color: #888; font-weight: 600; text-align: right;">Sale Price</th>
                  <th style="padding: 6px 8px; color: #888; font-weight: 600; text-align: right;">Sale Date</th>
                  <th style="padding: 6px 8px; color: #888; font-weight: 600; text-align: right;">Sq Ft</th>
                  <th style="padding: 6px 8px; color: #888; font-weight: 600; text-align: right;">Year Built</th>
                  <th style="padding: 6px 8px; color: #888; font-weight: 600; text-align: right;">Match</th>
                </tr>
              </thead>
              <tbody>`;
        comps.forEach((c, i) => {
          const matchPct = c.similarityScore ? Math.round(c.similarityScore) + '%' : '—';
          html += `
                <tr style="border-bottom: 1px solid #f0f0f0;${i % 2 === 1 ? ' background: #fafafa;' : ''}">
                  <td style="padding: 6px 8px;">${c.address || 'N/A'}</td>
                  <td style="padding: 6px 8px; text-align: right; font-family: monospace; font-weight: 600;">${fmt(c.salePrice)}</td>
                  <td style="padding: 6px 8px; text-align: right;">${c.saleDate || 'N/A'}</td>
                  <td style="padding: 6px 8px; text-align: right;">${c.sqft ? c.sqft.toLocaleString() : '—'}</td>
                  <td style="padding: 6px 8px; text-align: right;">${c.yearBuilt || '—'}</td>
                  <td style="padding: 6px 8px; text-align: right;">${matchPct}</td>
                </tr>`;
        });
        html += `
              </tbody>
            </table>
          </div>
          <p style="font-size: 11px; color: #999; margin: 8px 0 0 0;">These are qualified sales within 24 months, ranked by similarity to your property. "Match" reflects how comparable each sale is based on location, size, age, and type.</p>
        </div>`;
      }

      // Land sales table (for land-heavy properties)
      if (data.landSales && data.landSales.length > 0 && screening.arguments && screening.arguments.landValue && screening.arguments.landValue.applicable) {
        html += `
        <div style="padding: 16px 20px; border-bottom: 1px solid #e5e5e5;">
          <p style="font-size: 13px; font-weight: 700; color: #1B2A4A; margin: 0 0 10px 0;">Vacant Land Sales (Supporting Land Value Argument)</p>
          <div style="overflow-x: auto;">
            <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
              <thead>
                <tr style="border-bottom: 2px solid #e5e5e5; text-align: left;">
                  <th style="padding: 6px 8px; color: #888; font-weight: 600;">Acres</th>
                  <th style="padding: 6px 8px; color: #888; font-weight: 600; text-align: right;">Sale Price</th>
                  <th style="padding: 6px 8px; color: #888; font-weight: 600; text-align: right;">$/Acre</th>
                  <th style="padding: 6px 8px; color: #888; font-weight: 600; text-align: right;">Sale Date</th>
                  <th style="padding: 6px 8px; color: #888; font-weight: 600;">Neighborhood</th>
                </tr>
              </thead>
              <tbody>`;
        data.landSales.forEach((ls, i) => {
          html += `
                <tr style="border-bottom: 1px solid #f0f0f0;${i % 2 === 1 ? ' background: #fafafa;' : ''}">
                  <td style="padding: 6px 8px;">${ls.acreage ? ls.acreage.toFixed(2) : '—'}</td>
                  <td style="padding: 6px 8px; text-align: right; font-family: monospace; font-weight: 600;">${fmt(ls.salePrice)}</td>
                  <td style="padding: 6px 8px; text-align: right; font-family: monospace;">${fmt(Math.round(ls.pricePerAcre))}</td>
                  <td style="padding: 6px 8px; text-align: right;">${ls.saleDate || 'N/A'}</td>
                  <td style="padding: 6px 8px;">${ls.neighborhood || '—'}</td>
                </tr>`;
        });
        html += `
              </tbody>
            </table>
          </div>
          <p style="font-size: 11px; color: #999; margin: 8px 0 0 0;">Vacant land sales in and around your neighborhood, used to evaluate whether your land assessment is reasonable.</p>
        </div>`;
      }

      // Equity comps table (for equity-based arguments)
      const equityComps = data.equityComps || [];
      const equityArg = screening.arguments && screening.arguments.equity;
      if (equityComps.length > 0 && equityArg && equityArg.applicable && equityArg.strength !== 'none') {
        const medianEq = screening.analysis && screening.analysis.medianEquityAssessment ? screening.analysis.medianEquityAssessment : 0;
        html += `
        <div style="padding: 16px 20px; border-bottom: 1px solid #e5e5e5;">
          <p style="font-size: 13px; font-weight: 700; color: #1B2A4A; margin: 0 0 4px 0;">Similar Properties — Assessment Comparison</p>
          <p style="font-size: 12px; color: #666; margin: 0 0 10px 0; line-height: 1.5;">These are properties in your neighborhood with similar size and age. If your assessment is significantly higher than similar properties, that's an equity argument for your appeal.${medianEq ? ' The median assessment of these comparable properties is <strong>' + fmt(medianEq) + '</strong> vs. your <strong>' + fmt(subject.totalValue) + '</strong>.' : ''}${subject.sqft ? ' Your assessed value per square foot is <strong>$' + Math.round(subject.totalValue / subject.sqft).toLocaleString() + '/sq ft</strong>.' : ''}</p>
          <div style="overflow-x: auto;">
            <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
              <thead>
                <tr style="border-bottom: 2px solid #e5e5e5; text-align: left;">
                  <th style="padding: 6px 8px; color: #888; font-weight: 600;">Address</th>
                  <th style="padding: 6px 8px; color: #888; font-weight: 600; text-align: right;">Assessed Value</th>
                  <th style="padding: 6px 8px; color: #888; font-weight: 600; text-align: right;">$/Sq Ft</th>
                  <th style="padding: 6px 8px; color: #888; font-weight: 600; text-align: right;">Sq Ft</th>
                  <th style="padding: 6px 8px; color: #888; font-weight: 600; text-align: right;">Year Built</th>
                  <th style="padding: 6px 8px; color: #888; font-weight: 600;">Quality</th>
                </tr>
              </thead>
              <tbody>`;
        equityComps.forEach((ec, i) => {
          const isHigher = ec.assessedValue > subject.totalValue * 0.9;
          html += `
                <tr style="border-bottom: 1px solid #f0f0f0;${i % 2 === 1 ? ' background: #fafafa;' : ''}">
                  <td style="padding: 6px 8px;">${ec.address || 'N/A'}</td>
                  <td style="padding: 6px 8px; text-align: right; font-family: monospace; font-weight: 600;${ec.assessedValue === 0 ? ' color: #999;' : ''}">${ec.assessedValue > 0 ? fmt(ec.assessedValue) : '$0 (pending)'}</td>
                  <td style="padding: 6px 8px; text-align: right; font-family: monospace;">${ec.assessedValue > 0 && ec.sqft ? '$' + Math.round(ec.assessedValue / ec.sqft).toLocaleString() : '—'}</td>
                  <td style="padding: 6px 8px; text-align: right;">${ec.sqft ? ec.sqft.toLocaleString() : '—'}</td>
                  <td style="padding: 6px 8px; text-align: right;">${ec.yearBuilt || '—'}</td>
                  <td style="padding: 6px 8px;">${ec.quality || '—'}</td>
                </tr>`;
        });
        html += `
              </tbody>
            </table>
          </div>
          <p style="font-size: 11px; color: #999; margin: 8px 0 0 0;">Properties in your neighborhood with similar square footage (±30%) and age (±15 years). An "equity" argument shows the county is assessing your property inconsistently compared to similar properties.</p>
        </div>`;
      }
    }

    // CTA section — for strong/moderate cases
    if (screening.rating === 'strong' || screening.rating === 'moderate') {
      html += `
        <div style="padding: 16px 20px; border-bottom: 1px solid #e5e5e5;">

          <!-- Step 3: Value choice (BEFORE generate) -->
          <div style="margin-bottom: 14px; padding: 16px 14px; border: 1px solid #e5e5e5; border-radius: 8px; background: #f8fafc;">
            <p style="font-size: 14px; font-weight: 700; color: #1B2A4A; margin: 0 0 4px 0;">Step 3: Choose Your Requested Value</p>
            <p style="font-size: 12px; color: #666; margin: 0 0 12px 0;">This is the value you'll ask the county to set your property at. ${screening.suggestedValue ? 'Based on the evidence above, we suggest <strong>' + fmt(screening.suggestedValue) + '</strong>.' : ''}</p>
            <div style="display: grid; gap: 8px; margin-bottom: 10px;">
              <label style="display: flex; align-items: start; gap: 8px; font-size: 13px; color: #333; cursor: pointer;">
                <input type="radio" name="value-choice" id="vc-county" value="county" ${screening.suggestedValue ? '' : 'checked'} style="margin-top: 3px;"> <span>Let the county recalculate based on the evidence <span style="font-size: 11px; color: #888;">(if you're unsure, this is safe)</span></span>
              </label>
              <label style="display: flex; align-items: start; gap: 8px; font-size: 13px; color: #333; cursor: pointer;">
                <input type="radio" name="value-choice" id="vc-specific" value="specific" ${screening.suggestedValue ? 'checked' : ''} style="margin-top: 3px;" onchange="document.getElementById('vc-amount').focus()"> <span>Request a specific value: <input type="text" id="vc-amount" value="${screening.suggestedValue || ''}" placeholder="e.g. 750000" style="width: 120px; padding: 4px 8px; border: 1px solid #d4d4d4; border-radius: 4px; font-size: 13px; font-family: monospace;" onfocus="document.getElementById('vc-specific').checked=true"></span>
              </label>
            </div>
            <div style="background: #FFF8E6; border: 1px solid #E8D5A0; border-radius: 6px; padding: 8px 12px;">
              <p style="font-size: 11px; color: #6B5A1E; margin: 0; line-height: 1.6;">Not sure? Call <strong>(828) 250-4940</strong> or attend a free appeal clinic to discuss with an appraiser before submitting.</p>
            </div>
          </div>

          <!-- Step 4: Additional factors + Generate -->
          <p style="font-size: 14px; font-weight: 700; color: #1B2A4A; margin: 0 0 4px 0;">Step 4: Generate Your Appeal Letter</p>
          <p style="font-size: 12px; color: #666; margin: 0 0 10px 0;">Check any additional factors that apply, then generate your letter.</p>

          <div style="display: grid; gap: 8px; margin-bottom: 14px;">
            <label style="display: flex; align-items: center; gap: 8px; font-size: 13px; color: #333; cursor: pointer;">
              <input type="checkbox" id="fa-condition" style="width: 16px; height: 16px;"
                onchange="window.__strongAppealCheckboxChanged()"> My property has condition issues or needs major repairs
            </label>
            <label style="display: flex; align-items: center; gap: 8px; font-size: 13px; color: #333; cursor: pointer;">
              <input type="checkbox" id="fa-helene" style="width: 16px; height: 16px;"
                onchange="window.__strongAppealCheckboxChanged()"> My property was damaged by Tropical Storm Helene
            </label>
            <label style="display: flex; align-items: center; gap: 8px; font-size: 13px; color: #333; cursor: pointer;">
              <input type="checkbox" id="fa-errors" style="width: 16px; height: 16px;"
                onchange="window.__strongAppealCheckboxChanged()"> The county has incorrect information on my property record
            </label>
          </div>

          <!-- Conditional fields container -->
          <div id="fa-conditional-fields"></div>

          <button id="strong-generate-btn" onclick="window.__generateStrongAppealLetter()" style="
            display: block; width: 100%; padding: 14px; border: none; border-radius: 8px;
            background: #1B2A4A; color: white; font-size: 15px; font-weight: 700; cursor: pointer;
            transition: background 0.2s; margin-bottom: 8px;
          " onmouseover="this.style.background='#2d4470'" onmouseout="this.style.background='#1B2A4A'">
            Generate Appeal Letter — Free
          </button>
          <p id="strong-generate-note" style="font-size: 11px; color: #999; text-align: center; margin: 0 0 14px 0;">
            Free — includes appeal letter with comparable sales evidence.
          </p>

          <!-- Generated letter preview (appears AFTER clicking generate) -->
          <div id="strong-letter-preview" style="display: none; margin-bottom: 14px;">
            <p style="font-size: 12px; font-weight: 600; color: #333; margin: 0 0 8px 0;">Your appeal letter (you can edit before printing):</p>
            <textarea id="strong-letter-text" style="width: 100%; box-sizing: border-box; min-height: 400px; padding: 12px; border: 1px solid #d4d4d4; border-radius: 6px; font-size: 12px; font-family: 'Courier New', monospace; line-height: 1.6; resize: vertical; color: #333;"></textarea>
            <div style="display: flex; gap: 8px; margin-top: 8px;">
              <button onclick="window.__printStrongAppealLetter()" style="flex: 1; padding: 10px; border: none; border-radius: 6px; background: #1B2A4A; color: white; font-size: 13px; font-weight: 600; cursor: pointer;">Print This Letter</button>
              <button onclick="navigator.clipboard.writeText(document.getElementById('strong-letter-text').value).then(function(){this.textContent='Copied!'}.bind(this))" style="flex: 1; padding: 10px; border: 1px solid #d4d4d4; border-radius: 6px; background: white; color: #555; font-size: 13px; font-weight: 600; cursor: pointer;">Copy to Clipboard</button>
            </div>
            <p style="font-size: 11px; color: #999; margin: 8px 0 0 0;">Edit the letter above as needed, then print or copy.</p>
            <div style="text-align: center; margin-top: 12px; padding-top: 12px; border-top: 1px solid #e5e5e5;">
              <p style="font-size: 12px; color: #666; margin: 0 0 8px 0;">This tool is free. If it helped you, consider supporting it.</p>
              <a href="https://buymeacoffee.com/buncombetaxlookup" target="_blank" rel="noopener noreferrer" style="display: inline-block; padding: 8px 20px; background: #FFDD00; color: #000; font-size: 13px; font-weight: 600; border-radius: 6px; text-decoration: none;">Buy Me a Coffee ☕</a>
            </div>

            <div style="margin-top: 14px; padding-top: 14px; border-top: 1px solid #e5e5e5;">
              <p style="font-size: 14px; font-weight: 700; color: #1B2A4A; margin: 0 0 8px 0;">How to Submit Your Appeal</p>
              <div style="background: #fef2f2; border: 1px solid #fca5a5; border-radius: 6px; padding: 10px 14px; margin-bottom: 12px;">
                <p style="font-size: 12px; color: #991b1b; margin: 0; font-weight: 600;">Important: Appeals submitted without supporting documentation will be denied. Print ALL pages, not just the letter.</p>
              </div>
              <div style="font-size: 12px; color: #555; line-height: 1.7;">
                <p style="margin: 0 0 8px 0;"><strong>Option 1: File Online</strong> — Go to <strong>taxappeal.buncombenc.gov</strong>, search your PIN, click "Tax Appeal Request", and upload all pages as a PDF.</p>
                <p style="margin: 0 0 8px 0;"><strong>Option 2: By Phone</strong> — Call <strong>(828) 250-4940</strong> to schedule a 20-minute call with a county appraiser to discuss your value.</p>
                <p style="margin: 0 0 8px 0;"><strong>Option 3: Mail or Drop Off</strong> — Print and sign all pages, then mail or deliver to:<br>
                  <span style="display: inline-block; margin-left: 16px;">Buncombe County Tax Assessment<br>
                  <span style="margin-left: 16px;">182 College Street, Asheville, NC 28801</span></span><br>
                  <span style="font-size: 11px; color: #888;">We recommend certified mail or tracking for proof of delivery. Drop-off hours: Mon–Fri, 8 AM – 5 PM.</span></p>
                <p style="margin: 0 0 8px 0;"><strong>Option 4: Attend a Free Clinic</strong> — Bring all printed pages and your revaluation notice.</p>
              </div>
              <div style="font-size: 11px; color: #666; line-height: 1.6; margin-top: 8px;">
                <p style="margin: 0 0 4px 0;"><strong>Deadline:</strong> 30 days from the date you receive your notice of value, even after the deadline stated on the notice. The formal appeal deadline is May 5, 2026.</p>
                <p style="margin: 0 0 4px 0;"><strong>Questions:</strong> Call (828) 250-4940 or email realestate.questions@buncombenc.gov.</p>
              </div>
              <div style="background: #FFF8E6; border: 1px solid #E8D5A0; border-radius: 6px; padding: 10px 14px; margin-top: 10px;">
                <p style="font-size: 12px; color: #333; margin: 0 0 4px 0; font-weight: 600;">Strengthen your appeal with additional evidence:</p>
                <ul style="font-size: 12px; color: #555; margin: 0; padding-left: 18px; line-height: 1.8;">
                  <li>Photos of property condition issues or storm damage</li>
                  <li>Contractor estimates for needed repairs</li>
                  <li>A recent appraisal if you have one</li>
                  <li>Any other documentation that supports your case</li>
                </ul>
              </div>
            </div>
          </div>

        </div>
      `;
    }

    // Disclaimer
    html += `
      <div style="padding: 14px 20px; background: #fef2f2; border-top: 2px solid #fca5a5;">
        <p style="font-size: 13px; color: #991b1b; margin: 0; line-height: 1.6; font-weight: 500;">
          <strong>Important:</strong> This screening is based on publicly available county data and is for informational purposes only. 
          It is not legal or tax advice. Filing an appeal does not guarantee a reduction — your value may stay the same, 
          decrease, or increase. <strong>This tool is not affiliated with Buncombe County government.</strong>
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

  // --- Free Appeal Letter Helper (for weak/insufficient cases) ---

  // Store screening data globally so the free letter generator can access it
  window.__freeAppealData = null;

  // PRC Correction handler — shows/hides the corrections banner
  window.__prcCorrectionChanged = function() {
    var fields = ['prc-sqft','prc-beds','prc-fullbaths','prc-halfbaths','prc-yearbuilt','prc-acreage'];
    var hasCorrection = false;
    fields.forEach(function(id) {
      var el = document.getElementById(id);
      if (el && el.value.trim()) hasCorrection = true;
    });
    var qualityEl = document.getElementById('prc-quality');
    var conditionEl = document.getElementById('prc-condition');
    if (qualityEl && qualityEl.value) hasCorrection = true;
    if (conditionEl && conditionEl.value) hasCorrection = true;
    var banner = document.getElementById('prc-corrections-banner');
    if (banner) banner.style.display = hasCorrection ? 'block' : 'none';
  };

  // Collect PRC corrections as text lines for the appeal letter
  window.__getPrcCorrections = function(subject) {
    var lines = [];
    var sqft = (document.getElementById('prc-sqft') || {}).value;
    if (sqft && sqft.trim()) lines.push('The county records show ' + (subject.sqft || 'N/A') + ' heated square feet; the actual heated square footage is ' + sqft.trim() + '.');
    var beds = (document.getElementById('prc-beds') || {}).value;
    if (beds && beds.trim()) lines.push('The county records show ' + (subject.bedrooms || 'N/A') + ' bedrooms; the actual number is ' + beds.trim() + '.');
    var fb = (document.getElementById('prc-fullbaths') || {}).value;
    if (fb && fb.trim()) lines.push('The county records show ' + (subject.fullBaths || 'N/A') + ' full bathrooms; the actual number is ' + fb.trim() + '.');
    var hb = (document.getElementById('prc-halfbaths') || {}).value;
    if (hb && hb.trim()) lines.push('The county records show ' + (subject.halfBaths || 0) + ' half bathrooms; the actual number is ' + hb.trim() + '.');
    var yb = (document.getElementById('prc-yearbuilt') || {}).value;
    if (yb && yb.trim()) lines.push('The county records show the year built as ' + (subject.yearBuilt || 'N/A') + '; the actual year built is ' + yb.trim() + '.');
    var ac = (document.getElementById('prc-acreage') || {}).value;
    if (ac && ac.trim()) lines.push('The county records show ' + (subject.acreage ? subject.acreage.toFixed(2) : 'N/A') + ' acres; the actual acreage is ' + ac.trim() + '.');
    var qualityEl = document.getElementById('prc-quality');
    if (qualityEl && qualityEl.value && qualityEl.value !== (subject.quality || '').trim()) {
      lines.push('The county records show a quality grade of "' + (subject.quality || 'N/A') + '"; I believe the correct grade is "' + qualityEl.value + '" based on the actual construction quality of this home.');
    }
    var condEl = document.getElementById('prc-condition');
    if (condEl && condEl.value && condEl.value !== (subject.condition || 'NORMAL').trim()) {
      lines.push('The county records show the condition as "' + (subject.condition || 'NORMAL') + '"; the actual condition is "' + condEl.value + '".');
    }
    return lines;
  };

  window.__freeAppealCheckboxChanged = function() {
    var condition = document.getElementById('fa-condition');
    var helene = document.getElementById('fa-helene');
    var errors = document.getElementById('fa-errors');
    var relief = document.getElementById('fa-relief');
    var btn = document.getElementById('fa-generate-btn');
    var container = document.getElementById('fa-conditional-fields');
    if (!condition || !helene || !errors || !relief || !btn || !container) return;

    var anyChecked = condition.checked || helene.checked || errors.checked || relief.checked;
    btn.disabled = !anyChecked;
    btn.style.opacity = anyChecked ? '1' : '0.4';
    btn.style.cursor = anyChecked ? 'pointer' : 'default';

    // Build conditional fields
    var html = '';

    if (condition.checked) {
      html += '<div style="margin-bottom: 14px;">'
        + '<label style="display: block; font-size: 12px; font-weight: 600; color: #555; margin-bottom: 4px;">Briefly describe the condition issues:</label>'
        + '<textarea id="fa-condition-text" rows="3" placeholder="e.g., roof needs replacement, foundation problems, water damage" style="width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1px solid #d4d4d4; border-radius: 6px; font-size: 13px; font-family: inherit; resize: vertical;"></textarea>'
        + '</div>';
    }

    if (helene.checked) {
      html += '<div style="margin-bottom: 14px;">'
        + '<label style="display: block; font-size: 12px; font-weight: 600; color: #555; margin-bottom: 4px;">Briefly describe the storm damage:</label>'
        + '<textarea id="fa-helene-text" rows="3" placeholder="e.g., flooding in basement, roof damage, fallen trees on property" style="width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1px solid #d4d4d4; border-radius: 6px; font-size: 13px; font-family: inherit; resize: vertical;"></textarea>'
        + '<p style="font-size: 11px; color: #ca8a04; margin: 6px 0 0 0; line-height: 1.4;">Include photos with your submission — photos significantly strengthen your case.</p>'
        + '</div>';
    }

    if (errors.checked) {
      var d = window.__freeAppealData;
      var sub = d ? d.subject : {};
      html += '<div style="margin-bottom: 14px;">'
        + '<p style="font-size: 12px; font-weight: 600; color: #555; margin: 0 0 8px 0;">Review and correct your property record:</p>'
        + '<table style="width: 100%; border-collapse: collapse; font-size: 12px;">'
        + '<thead><tr>'
        + '<th style="padding: 6px 8px; text-align: left; background: #f5f5f5; border-bottom: 1px solid #d4d4d4; font-size: 11px;">Field</th>'
        + '<th style="padding: 6px 8px; text-align: left; background: #f5f5f5; border-bottom: 1px solid #d4d4d4; font-size: 11px;">On File</th>'
        + '<th style="padding: 6px 8px; text-align: left; background: #f5f5f5; border-bottom: 1px solid #d4d4d4; font-size: 11px;">Correct Value (if different)</th>'
        + '</tr></thead><tbody>';

      var fields = [
        { key: 'sqft', label: 'Total Finished Area (sq ft)', val: sub.sqft || 'N/A' },
        { key: 'yearBuilt', label: 'Year Built', val: sub.yearBuilt || 'N/A' },
        { key: 'bedrooms', label: 'Bedrooms', val: sub.bedrooms || 'N/A' },
        { key: 'fullBaths', label: 'Full Baths', val: sub.fullBaths || 'N/A' },
        { key: 'halfBaths', label: 'Half Baths', val: sub.halfBaths || 'N/A' },
        { key: 'acreage', label: 'Acreage', val: sub.acreage ? sub.acreage.toFixed(2) : 'N/A' },
        { key: 'buildingType', label: 'Building Type', val: sub.buildingType || 'N/A' },
        { key: 'condition', label: 'Condition', val: sub.condition || 'N/A' },
      ];

      for (var i = 0; i < fields.length; i++) {
        var f = fields[i];
        html += '<tr>'
          + '<td style="padding: 6px 8px; border-bottom: 1px solid #e5e5e5;">' + f.label + '</td>'
          + '<td style="padding: 6px 8px; border-bottom: 1px solid #e5e5e5; font-family: monospace;">' + f.val + '</td>'
          + '<td style="padding: 6px 8px; border-bottom: 1px solid #e5e5e5;">'
          + '<input type="text" id="fa-err-' + f.key + '" placeholder="—" style="width: 100%; box-sizing: border-box; padding: 4px 6px; border: 1px solid #d4d4d4; border-radius: 4px; font-size: 12px; font-family: inherit;">'
          + '</td></tr>';
      }

      html += '</tbody></table></div>';
    }

    if (relief.checked) {
      html += '<div style="margin-bottom: 14px; padding: 10px 12px; background: #f0f9ff; border: 1px solid #93c5fd; border-radius: 6px;">'
        + '<p style="font-size: 12px; color: #1e40af; margin: 0; line-height: 1.6;">Call <strong>(828) 250-4940</strong> to ask about eligibility for senior/disabled homeowner exclusions, agricultural present-use value, or other programs. These can significantly reduce your tax bill.</p>'
        + '</div>';
    }

    container.innerHTML = html;
  };

  // Format owner name from "LAST FIRST MIDDLE" to "First Last"
  function formatOwnerName(raw) {
    if (!raw) return '';
    // Handle multiple owners separated by semicolons
    var owners = raw.split(';').map(function(name) {
      name = name.trim();
      var parts = name.split(/\s+/);
      if (parts.length < 2) return name;
      // First part is last name, rest is first/middle
      var last = parts[0];
      var firstMiddle = parts.slice(1).join(' ');
      // Title case
      function titleCase(s) { return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase(); }
      return firstMiddle.split(/\s+/).map(titleCase).join(' ') + ' ' + titleCase(last);
    });
    return owners.join(' & ');
  }

  window.__generateFreeAppealLetter = function() {
    var d = window.__freeAppealData;
    if (!d) { alert('Property data not loaded. Please reload the page.'); return; }

    var sub = d.subject;
    var condition = document.getElementById('fa-condition');
    var helene = document.getElementById('fa-helene');
    var errors = document.getElementById('fa-errors');
    var relief = document.getElementById('fa-relief');

    var hasCondition = condition && condition.checked;
    var hasHelene = helene && helene.checked;
    var hasErrors = errors && errors.checked;
    var hasRelief = relief && relief.checked;

    var conditionText = hasCondition ? (document.getElementById('fa-condition-text') || {}).value || '' : '';
    var heleneText = hasHelene ? (document.getElementById('fa-helene-text') || {}).value || '' : '';

    // Collect record corrections
    var corrections = [];
    if (hasErrors) {
      var errFields = [
        { key: 'sqft', label: 'Total Finished Area (sq ft)', val: sub.sqft || 'N/A' },
        { key: 'yearBuilt', label: 'Year Built', val: sub.yearBuilt || 'N/A' },
        { key: 'bedrooms', label: 'Bedrooms', val: sub.bedrooms || 'N/A' },
        { key: 'fullBaths', label: 'Full Baths', val: sub.fullBaths || 'N/A' },
        { key: 'halfBaths', label: 'Half Baths', val: sub.halfBaths || 'N/A' },
        { key: 'acreage', label: 'Acreage', val: sub.acreage ? sub.acreage.toFixed(2) : 'N/A' },
        { key: 'buildingType', label: 'Building Type', val: sub.buildingType || 'N/A' },
        { key: 'condition', label: 'Condition', val: sub.condition || 'N/A' },
      ];
      for (var i = 0; i < errFields.length; i++) {
        var el = document.getElementById('fa-err-' + errFields[i].key);
        var corrected = el ? el.value.trim() : '';
        if (corrected && corrected !== '' + errFields[i].val) {
          corrections.push({ label: errFields[i].label, onFile: '' + errFields[i].val, corrected: corrected });
        }
      }
    }

    // Build letter body paragraphs
    var bodyParagraphs = [];

    if (hasCondition) {
      var para = 'The property has significant condition issues that affect its market value';
      if (conditionText.trim()) {
        para += ': ' + conditionText.trim();
      }
      para += '. I request that an appraiser inspect the property to verify its current condition.';
      bodyParagraphs.push(para);
    }

    if (hasHelene) {
      var para2 = 'The property was damaged by Tropical Storm Helene';
      if (heleneText.trim()) {
        para2 += ': ' + heleneText.trim();
      }
      para2 += '. Photos documenting the damage are attached. I request that the assessed value be adjusted to reflect the property\'s post-storm condition.';
      bodyParagraphs.push(para2);
    }

    if (hasErrors && corrections.length > 0) {
      var para3 = 'I have identified the following errors in the property record on file:';
      for (var j = 0; j < corrections.length; j++) {
        para3 += '\n  - ' + corrections[j].label + ': On file as ' + corrections[j].onFile + ', should be ' + corrections[j].corrected;
      }
      para3 += '\n\nI request that these corrections be made and the assessed value recalculated accordingly.';
      bodyParagraphs.push(para3);
    } else if (hasErrors) {
      bodyParagraphs.push('I believe there are errors in the property record on file. I request that an appraiser review the property record for accuracy and that the assessed value be recalculated accordingly.');
    }

    if (hasRelief) {
      bodyParagraphs.push('I would also like information about tax relief programs I may be eligible for.');
    }

    // Add PRC corrections from the Step 1 review card
    var prcCorrections = window.__getPrcCorrections ? window.__getPrcCorrections(sub) : [];
    if (prcCorrections.length > 0 && !hasErrors) {
      // Only add if the "errors" checkbox wasn't already checked (to avoid duplication)
      bodyParagraphs.push('I have identified the following errors in the property record on file:\n\n' + prcCorrections.join('\n') + '\n\nI request that these corrections be made and the assessed value recalculated accordingly.');
    } else if (prcCorrections.length > 0 && hasErrors) {
      // Merge PRC corrections into the existing errors paragraph
      bodyParagraphs.push('Additionally, based on my review of the property record card:\n\n' + prcCorrections.join('\n'));
    }

    var dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    var fmtValue = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(sub.totalValue);
    var ownerName = formatOwnerName(sub.owner);

    // Build plain text letter for the textarea
    var letter = dateStr + '\n\n';
    letter += 'Buncombe County Tax Assessor\'s Office\n';
    letter += '182 College Street\n';
    letter += 'Asheville, NC 28801\n\n';
    letter += 'Re: Appeal of 2026 Property Tax Assessment\n';
    letter += 'Property: ' + (sub.address || '') + '\n';
    letter += 'PIN: ' + sub.pin + '\n\n';
    letter += 'Dear Tax Assessor:\n\n';
    letter += 'I am writing to appeal the 2026 assessed value of ' + fmtValue + ' for my property at ' + (sub.address || sub.pin) + '.\n\n';
    letter += bodyParagraphs.join('\n\n') + '\n\n';
    letter += 'I am available to discuss this further or to schedule a property inspection at your convenience.\n\n';
    letter += 'Respectfully,\n\n\n\n';
    letter += '______________________________\n';
    letter += ownerName + '\n';
    letter += 'Property Owner\n';
    letter += dateStr + '\n\n';
    letter += 'Phone: ___________________\n';
    letter += 'Email: ___________________';

    // Show the letter in the textarea
    var preview = document.getElementById('fa-letter-preview');
    var textarea = document.getElementById('fa-letter-text');
    var genBtn = document.getElementById('fa-generate-btn');
    var genNote = document.getElementById('fa-generate-note');
    if (preview && textarea) {
      textarea.value = letter;
      preview.style.display = 'block';
      if (genBtn) {
        genBtn.textContent = 'Regenerate Letter';
        genBtn.style.background = '#4b5563';
        genBtn.disabled = false;
      }
      if (genNote) genNote.textContent = 'Changed your selections or corrections above? Click Regenerate to update the letter.';
      preview.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  // Print the letter from the textarea in a clean window
  window.__printFreeAppealLetter = function() {
    var textarea = document.getElementById('fa-letter-text');
    if (!textarea) return;
    var text = textarea.value;

    var printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('Please allow popups to print your appeal letter.');
      return;
    }

    var html = '<!DOCTYPE html><html><head>'
      + '<title>Appeal Letter</title>'
      + '<style>'
      + 'body { font-family: "Segoe UI", system-ui, -apple-system, sans-serif; font-size: 11pt; line-height: 1.6; max-width: 7in; margin: 0.75in auto; padding: 0; color: #000; white-space: pre-wrap; }'
      + '@media print { body { margin: 0.75in; } .no-print { display: none !important; } }'
      + '</style>'
      + '</head><body>'
      + '<div class="no-print" style="background: #1B2A4A; color: white; padding: 12px 16px; border-radius: 8px; margin-bottom: 20px; text-align: center; font-family: sans-serif;">'
      + '<button onclick="window.print()" style="padding: 8px 20px; background: white; color: #1B2A4A; border: none; border-radius: 6px; font-weight: 700; cursor: pointer; font-size: 14px;">Print / Save as PDF</button>'
      + '</div>'
      + text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      + '</body></html>';

    printWindow.document.write(html);
    printWindow.document.close();
  };

  // --- Strong/Moderate case letter generation ---
  window.__strongAppealData = null;

  window.__strongAppealCheckboxChanged = function() {
    // Show/hide conditional fields (reuse same IDs as weak case)
    var condition = document.getElementById('fa-condition');
    var helene = document.getElementById('fa-helene');
    var errors = document.getElementById('fa-errors');
    var container = document.getElementById('fa-conditional-fields');
    if (!container) return;
    var html = '';
    if (condition && condition.checked) {
      html += '<div style="margin-bottom: 10px;">'
        + '<label style="display: block; font-size: 12px; font-weight: 600; color: #555; margin-bottom: 4px;">Briefly describe the condition issues:</label>'
        + '<textarea id="fa-condition-text" rows="2" placeholder="e.g., roof needs replacement, foundation issues" style="width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1px solid #d4d4d4; border-radius: 6px; font-size: 13px; font-family: inherit; resize: vertical;"></textarea>'
        + '</div>';
    }
    if (helene && helene.checked) {
      html += '<div style="margin-bottom: 10px;">'
        + '<label style="display: block; font-size: 12px; font-weight: 600; color: #555; margin-bottom: 4px;">Briefly describe the storm damage:</label>'
        + '<textarea id="fa-helene-text" rows="2" placeholder="e.g., flooding, roof damage, fallen trees" style="width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1px solid #d4d4d4; border-radius: 6px; font-size: 13px; font-family: inherit; resize: vertical;"></textarea>'
        + '<p style="font-size: 11px; color: #888; margin: 4px 0 0 0;">Include photos with your submission.</p>'
        + '</div>';
    }
    if (errors && errors.checked) {
      var d = window.__strongAppealData;
      if (d && d.subject) {
        var sub = d.subject;
        html += '<div style="margin-bottom: 10px;">'
          + '<p style="font-size: 12px; font-weight: 600; color: #555; margin-bottom: 6px;">Correct any errors below:</p>'
          + '<table style="width: 100%; border-collapse: collapse; font-size: 12px;">'
          + '<tr style="border-bottom: 1px solid #e5e5e5;"><th style="text-align: left; padding: 4px 6px; color: #888;">Field</th><th style="text-align: left; padding: 4px 6px; color: #888;">On File</th><th style="text-align: left; padding: 4px 6px; color: #888;">Correct Value</th></tr>';
        var fields = [
          {key:'sqft',label:'Sq Ft',val:sub.sqft||'N/A'},{key:'yearBuilt',label:'Year Built',val:sub.yearBuilt||'N/A'},
          {key:'bedrooms',label:'Bedrooms',val:sub.bedrooms||'N/A'},{key:'fullBaths',label:'Full Baths',val:sub.fullBaths||'N/A'},
          {key:'halfBaths',label:'Half Baths',val:sub.halfBaths||'N/A'},{key:'acreage',label:'Acreage',val:sub.acreage?sub.acreage.toFixed(2):'N/A'},
          {key:'condition',label:'Condition',val:sub.condition||'N/A'}
        ];
        for (var i=0;i<fields.length;i++) {
          html += '<tr style="border-bottom: 1px solid #f0f0f0;"><td style="padding: 4px 6px;">' + fields[i].label + '</td><td style="padding: 4px 6px;">' + fields[i].val + '</td><td style="padding: 4px 6px;"><input id="fa-err-' + fields[i].key + '" type="text" placeholder="if different" style="width: 100%; box-sizing: border-box; padding: 4px 6px; border: 1px solid #d4d4d4; border-radius: 4px; font-size: 12px;"></td></tr>';
        }
        html += '</table></div>';
      }
    }
    container.innerHTML = html;
  };

  window.__generateStrongAppealLetter = function() {
    var d = window.__strongAppealData;
    if (!d) { alert('Property data not loaded. Please reload the page.'); return; }

    var sub = d.subject;
    var screening = d.screening;
    var args = screening.arguments || {};
    var comps = d.comps || [];
    var landSales = d.landSales || [];

    var conditionEl = document.getElementById('fa-condition');
    var heleneEl = document.getElementById('fa-helene');
    var errorsEl = document.getElementById('fa-errors');
    var hasCondition = conditionEl && conditionEl.checked;
    var hasHelene = heleneEl && heleneEl.checked;
    var hasErrors = errorsEl && errorsEl.checked;
    var conditionText = hasCondition ? (document.getElementById('fa-condition-text') || {}).value || '' : '';
    var heleneText = hasHelene ? (document.getElementById('fa-helene-text') || {}).value || '' : '';

    // Collect record corrections
    var corrections = [];
    if (hasErrors) {
      var errFields = [{key:'sqft',label:'Total Finished Area',val:sub.sqft||'N/A'},{key:'yearBuilt',label:'Year Built',val:sub.yearBuilt||'N/A'},{key:'bedrooms',label:'Bedrooms',val:sub.bedrooms||'N/A'},{key:'fullBaths',label:'Full Baths',val:sub.fullBaths||'N/A'},{key:'halfBaths',label:'Half Baths',val:sub.halfBaths||'N/A'},{key:'acreage',label:'Acreage',val:sub.acreage?sub.acreage.toFixed(2):'N/A'},{key:'condition',label:'Condition',val:sub.condition||'N/A'}];
      for (var i=0;i<errFields.length;i++) {
        var el = document.getElementById('fa-err-' + errFields[i].key);
        var corrected = el ? el.value.trim() : '';
        if (corrected && corrected !== '' + errFields[i].val) {
          corrections.push({label:errFields[i].label, onFile:''+errFields[i].val, corrected:corrected});
        }
      }
    }

    var dateStr = new Date().toLocaleDateString('en-US', {year:'numeric',month:'long',day:'numeric'});
    var fmtVal = function(n) { return '$' + Number(n).toLocaleString('en-US'); };
    var ownerName = formatOwnerName(sub.owner);
    var suggestedValue = screening.suggestedValue;

    // Build the letter
    var letter = dateStr + '\n\n';
    letter += 'Buncombe County Tax Assessor\'s Office\n';
    letter += '182 College Street\n';
    letter += 'Asheville, NC 28801\n\n';
    letter += 'Re: Appeal of 2026 Property Tax Assessment\n';
    letter += 'Property: ' + (sub.address || '') + '\n';
    letter += 'PIN: ' + sub.pin + '\n\n';
    letter += 'Dear Tax Assessor:\n\n';
    letter += 'I am writing to appeal the 2026 assessed value of ' + fmtVal(sub.totalValue) + ' for my property at ' + (sub.address || '') + '.';
    // Don't state a specific value in the opening — let the closing handle it
    letter += '\n\n';

    // Land value argument
    var landArg = args.landValue || {};
    if (landArg.applicable && landArg.strength !== 'none') {
      letter += 'The land portion of my assessment (' + fmtVal(sub.landValue) + ' for ' + sub.acreage.toFixed(2) + ' acres, or ' + fmtVal(Math.round(sub.landValue / sub.acreage)) + ' per acre) appears to exceed market rates for comparable land in the area.';
      if (landSales.length > 0) {
        var landPrices = landSales.map(function(s){return s.pricePerAcre || (s.salePrice / s.acreage);}).filter(function(p){return p > 0;});
        if (landPrices.length > 0) {
          landPrices.sort(function(a,b){return a-b;});
          var medianLandRate = landPrices[Math.floor(landPrices.length/2)];
          letter += ' Recent vacant land sales in the area show a median price of ' + fmtVal(Math.round(medianLandRate)) + ' per acre, based on ' + landSales.length + ' sales.';
        }
      }
      letter += '\n\n';
    }

    // Market value argument with comp evidence
    var marketArg = args.marketValue || {};
    if (marketArg.applicable && marketArg.strength !== 'none' && comps.length > 0) {
      var goodComps = comps.filter(function(c){return c.similarityScore > 50;});
      if (goodComps.length >= 3) {
        letter += 'The following comparable properties have sold recently in my neighborhood:\n\n';
        for (var j=0; j < Math.min(goodComps.length, 5); j++) {
          var c = goodComps[j];
          letter += '  - ' + c.address + ': sold for ' + fmtVal(c.salePrice) + ' on ' + c.saleDate;
          if (c.sqft) letter += ' (' + c.sqft.toLocaleString() + ' sq ft';
          if (c.yearBuilt) letter += ', built ' + c.yearBuilt;
          if (c.sqft || c.yearBuilt) letter += ')';
          letter += '\n';
        }
        letter += '\n';
      }
    }

    // Condition/damage/errors
    if (hasCondition) {
      letter += 'The property has significant condition issues that affect its market value';
      if (conditionText.trim()) letter += ': ' + conditionText.trim();
      letter += '. I request that an appraiser inspect the property to verify its current condition.\n\n';
    }
    if (hasHelene) {
      letter += 'The property was damaged by Tropical Storm Helene';
      if (heleneText.trim()) letter += ': ' + heleneText.trim();
      letter += '. Photos documenting the damage are attached.\n\n';
    }
    if (hasErrors && corrections.length > 0) {
      letter += 'I have identified the following errors in the property record on file:\n';
      for (var k=0;k<corrections.length;k++) {
        letter += '  - ' + corrections[k].label + ': On file as ' + corrections[k].onFile + ', should be ' + corrections[k].corrected + '\n';
      }
      letter += '\nI request that these corrections be made and the assessed value recalculated accordingly.\n\n';
    }

    // Add PRC corrections from the Step 1 review card
    var prcCorrections = window.__getPrcCorrections ? window.__getPrcCorrections(sub) : [];
    if (prcCorrections.length > 0) {
      if (!hasErrors || corrections.length === 0) {
        letter += 'I have identified the following errors in the property record on file:\n\n';
        letter += prcCorrections.join('\n') + '\n\n';
        letter += 'I request that these corrections be made and the assessed value recalculated accordingly.\n\n';
      } else {
        letter += 'Additionally, based on my review of the property record card:\n\n';
        letter += prcCorrections.join('\n') + '\n\n';
      }
    }

    // Closing — based on user's value choice
    var vcCounty = document.getElementById('vc-county');
    var vcSpecific = document.getElementById('vc-specific');
    var vcAmount = document.getElementById('vc-amount');
    var useSpecific = vcSpecific && vcSpecific.checked && vcAmount && vcAmount.value.trim();
    
    if (useSpecific) {
      var requestedVal = parseInt(vcAmount.value.trim().replace(/[$,]/g, '')) || 0;
      if (requestedVal > 0) {
        letter += 'Based on the above evidence, I respectfully request that the assessed value be adjusted to ' + fmtVal(requestedVal) + '.\n\n';
      } else {
        letter += 'Based on the above evidence, I respectfully request that the assessed value be recalculated based on current market data.\n\n';
      }
    } else {
      letter += 'Based on the above evidence, I respectfully request that the assessed value be recalculated based on current market data.\n\n';
    }

    letter += 'I am available to discuss this further or to schedule a property inspection at your convenience.\n\n';
    letter += 'Respectfully,\n\n\n\n';
    letter += '______________________________\n';
    letter += ownerName + '\n';
    letter += 'Property Owner\n';
    letter += dateStr + '\n\n';
    letter += 'Phone: ___________________\n';
    letter += 'Email: ___________________';

    // Show in textarea
    var preview = document.getElementById('strong-letter-preview');
    var textarea = document.getElementById('strong-letter-text');
    var genBtn = document.getElementById('strong-generate-btn');
    var genNote = document.getElementById('strong-generate-note');
    if (preview && textarea) {
      textarea.value = letter;
      preview.style.display = 'block';
      // Change button to "Regenerate" instead of hiding it
      if (genBtn) {
        genBtn.textContent = 'Regenerate Letter';
        genBtn.style.background = '#4b5563';
      }
      if (genNote) genNote.textContent = 'Changed your value choice or corrections above? Click Regenerate to update the letter.';
      preview.scrollIntoView({behavior:'smooth', block:'start'});
    }
  };

  window.__printStrongAppealLetter = function() {
    var textarea = document.getElementById('strong-letter-text');
    if (!textarea) return;
    var text = textarea.value;
    var d = window.__strongAppealData;
    if (!d) return;
    var sub = d.subject;
    var comps = (d.comps || []).filter(function(c){return c.similarityScore > 50;}).slice(0,5);
    var landSales = d.landSales || [];
    var fmtVal = function(n) { return '$' + Number(n).toLocaleString('en-US'); };

    var printWindow = window.open('', '_blank');
    if (!printWindow) { alert('Please allow popups to print your appeal letter.'); return; }

    var html = '<!DOCTYPE html><html><head><title>Appeal Packet</title><style>'
      + 'body { font-family: "Segoe UI", system-ui, -apple-system, sans-serif; font-size: 11pt; line-height: 1.5; max-width: 7.5in; margin: 0 auto; padding: 0.5in; color: #000; }'
      + '.letter-text { white-space: pre-wrap; font-size: 11pt; line-height: 1.6; }'
      + '.page-break { page-break-before: always; }'
      + 'table { width: 100%; border-collapse: collapse; font-size: 10pt; margin: 12px 0; }'
      + 'th { background: #1B2A4A; color: white; padding: 6px 8px; text-align: left; font-size: 9pt; text-transform: uppercase; }'
      + 'td { padding: 6px 8px; border-bottom: 1px solid #ddd; }'
      + 'tr:nth-child(even) { background: #f9f9f9; }'
      + 'h2 { font-size: 14pt; color: #1B2A4A; border-bottom: 2px solid #1B2A4A; padding-bottom: 4px; margin-top: 0; }'
      + '.source { font-size: 8pt; color: #999; margin-top: 20px; }'
      + '.record-table td:first-child { font-weight: 500; color: #555; width: 40%; }'
      + '@media print { body { margin: 0.75in; padding: 0; } .no-print { display: none !important; } }'
      + '</style></head><body>';

    // Print/Save button
    html += '<div class="no-print" style="background: #1B2A4A; color: white; padding: 12px 16px; border-radius: 8px; margin-bottom: 20px; text-align: center;">'
      + '<button onclick="window.print()" style="padding: 8px 20px; background: white; color: #1B2A4A; border: none; border-radius: 6px; font-weight: 700; cursor: pointer; font-size: 14px;">Print / Save as PDF</button></div>';

    // PAGE 1: Letter
    html += '<div class="letter-text">'
      + text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      + '</div>';

    // PAGE 2: Comparable Sales Evidence (if we have good comps or land sales)
    if (comps.length > 0 || landSales.length > 0) {
      html += '<div class="page-break"></div>';
      html += '<h2>Comparable Sales Analysis</h2>';

      // Subject summary
      html += '<div style="border: 1px solid #ddd; border-radius: 6px; padding: 10px 14px; margin-bottom: 16px; font-size: 10pt;">'
        + '<strong>' + (sub.address || '') + '</strong><br>'
        + (sub.sqft ? sub.sqft.toLocaleString() + ' sq ft' : '') 
        + (sub.acreage ? ' &middot; ' + sub.acreage.toFixed(2) + ' acres' : '')
        + (sub.yearBuilt ? ' &middot; Built ' + sub.yearBuilt : '')
        + '<br>Current Assessment: ' + fmtVal(sub.totalValue) + ' (Land: ' + fmtVal(sub.landValue) + ' | Building: ' + fmtVal(sub.buildingValue) + ')'
        + '</div>';

      // Comp sales table
      if (comps.length > 0) {
        html += '<table><thead><tr><th>Address</th><th>Sale Price</th><th>Sale Date</th><th>Sq Ft</th><th>Acres</th><th>Year Built</th></tr></thead><tbody>';
        for (var i=0; i<comps.length; i++) {
          var c = comps[i];
          html += '<tr><td>' + (c.address||'') + '</td><td>' + fmtVal(c.salePrice) + '</td><td>' + (c.saleDate||'') + '</td><td>' + (c.sqft ? c.sqft.toLocaleString() : '') + '</td><td>' + (c.acreage ? c.acreage.toFixed(2) : '') + '</td><td>' + (c.yearBuilt||'') + '</td></tr>';
        }
        html += '</tbody></table>';
      }

      // Land sales table
      if (landSales.length > 0) {
        html += '<h3 style="font-size: 12pt; color: #333; margin-top: 20px;">Vacant Land Sales</h3>';
        html += '<table><thead><tr><th>Location</th><th>Sale Price</th><th>Acreage</th><th>Price/Acre</th><th>Sale Date</th></tr></thead><tbody>';
        for (var j=0; j<Math.min(landSales.length,8); j++) {
          var ls = landSales[j];
          var ppa = ls.acreage > 0 ? fmtVal(Math.round(ls.salePrice / ls.acreage)) : '';
          html += '<tr><td>' + (ls.address||ls.pin||'') + '</td><td>' + fmtVal(ls.salePrice) + '</td><td>' + (ls.acreage ? ls.acreage.toFixed(2) : '') + '</td><td>' + ppa + '</td><td>' + (ls.saleDate||'') + '</td></tr>';
        }
        html += '</tbody></table>';
        html += '<p style="font-size: 9pt; color: #555;">Subject land assessed at ' + fmtVal(Math.round(sub.landValue/sub.acreage)) + '/acre for ' + sub.acreage.toFixed(2) + ' acres.</p>';
      }

      html += '<p style="font-size: 8pt; color: #888; margin-top: 16px;">Sales selected based on: same property type, same assessment neighborhood, similar size, qualified sales within 24 months of January 1, 2026.</p>';
      html += '<p class="source">Source: Buncombe County public records</p>';
    }

    // PAGE 3: Property Record
    html += '<div class="page-break"></div>';
    html += '<h2>Property Record &mdash; On File with Buncombe County</h2>';
    html += '<p style="font-size: 10pt; color: #555;">' + (sub.address||'') + ' &middot; PIN: ' + sub.pin + '</p>';
    html += '<table class="record-table"><tbody>';
    var records = [
      ['Year Built', sub.yearBuilt||'N/A'],
      ['Total Finished Area', sub.sqft ? sub.sqft.toLocaleString() + ' sq ft' : 'N/A'],
      ['Bedrooms', sub.bedrooms||'N/A'],
      ['Full Baths', sub.fullBaths||'N/A'],
      ['Half Baths', sub.halfBaths||'N/A'],
      ['Building Type', sub.buildingType||'N/A'],
      ['Quality', sub.quality||'N/A'],
      ['Condition', sub.condition||'N/A'],
      ['Acreage', sub.acreage ? sub.acreage.toFixed(2) : 'N/A'],
      ['Land Value', fmtVal(sub.landValue) + ' (' + Math.round(sub.landPctOfTotal) + '% of total)'],
      ['Building Value', fmtVal(sub.buildingValue)],
      ['Total Assessed Value', fmtVal(sub.totalValue)],
    ];
    for (var r=0; r<records.length; r++) {
      html += '<tr><td>' + records[r][0] + '</td><td>' + records[r][1] + '</td></tr>';
    }
    html += '</tbody></table>';
    html += '<p class="source">Source: Buncombe County public records</p>';

    html += '</body></html>';
    printWindow.document.write(html);
    printWindow.document.close();
  };

  function generatePDF(data) {
    const { property: p, comps, analysis: a, questionnaire: q, appealText, taxImpact } = data;

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
  <li>Go to <strong>taxappeal.buncombenc.gov</strong></li>
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
  <li>Download the paper appeal form from taxappeal.buncombenc.gov (or use the form mailed with your notice)</li>
  <li>Fill in the "Reason for Appeal" using the text on Page 2</li>
  <li>Write your opinion of value: <strong>${suggestedValueDisplay}</strong></li>
  <li>Sign and date the form</li>
  <li>Attach this packet as supporting documentation</li>
  <li>Mail or deliver to: <strong>Buncombe County Property Assessment, 182 College Street, Asheville, NC 28801</strong></li>
</ol>

<h3>Option 3: Appeal by Phone</h3>
<p>Call <strong>(828) 250-4940</strong> to schedule a 20-minute call with a county appraiser to discuss your value.</p>

<h3>Option 4: Attend an Appeal Clinic</h3>
<p>Bring this packet and your revaluation notice to a free appeal clinic. Visit buncombetaxlookup.com for clinic dates and locations.</p>

<div class="info">
  <strong>Important:</strong> File your appeal as soon as possible. You have 30 days from the date you receive your notice of value to appeal, even after the deadline stated on the notice. The formal appeal deadline is May 5, 2026. 
  Call (828) 250-4940 with questions.
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
  ${taxImpact ? '<br><strong>Estimated Current Tax Bill:</strong> ' + fmt(taxImpact.currentAnnualTax) + '/yr (at ' + taxImpact.ratePerHundred + '&cent;/$100 — ' + taxImpact.districtCode + ', 2025 rates)' : ''}
  ${taxImpact && taxImpact.suggestedAnnualTax && taxImpact.estimatedAnnualSavings > 0 ? '<br><strong>Estimated Tax at Suggested Value:</strong> ' + fmt(taxImpact.suggestedAnnualTax) + '/yr (savings: ~' + fmt(taxImpact.estimatedAnnualSavings) + '/yr)' : ''}
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

      // Store data for letter generators
      window.__freeAppealData = data;
      window.__strongAppealData = data;

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
