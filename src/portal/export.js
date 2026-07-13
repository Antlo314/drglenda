/* =============================================================================
   UMOF Learning Portal — Export helpers (CSV + PDF)
   -----------------------------------------------------------------------------
   Both run entirely in the browser, no dependencies:
     • CSV  — builds an RFC-4180-safe file and triggers a real download.
     • PDF  — opens a clean, branded print view and invokes the browser's
              "Save as PDF". This is the standard dependency-free way to make a
              PDF on the web; swap for jsPDF later if you want one-click files.
   ========================================================================== */

/** Escape one CSV cell (quote when it contains comma, quote, or newline). */
function csvCell(value) {
  const s = value == null ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Download an array of row-objects as a CSV file.
 * @param {string[]} columns  header labels, in order
 * @param {Array<Array>} rows  each row is an array of cell values matching columns
 * @param {string} filename
 */
export function downloadCSV(columns, rows, filename) {
  const lines = [columns.map(csvCell).join(',')];
  rows.forEach((row) => lines.push(row.map(csvCell).join(',')));
  const blob = new Blob(['﻿' + lines.join('\r\n')], {
    type: 'text/csv;charset=utf-8;',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // revoke on the next tick so the download has a chance to start
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Open a branded, printable report in a new window and trigger Save-as-PDF.
 * @param {object} opts
 * @param {string} opts.title       report heading
 * @param {string} opts.subtitle    e.g. "Generated Jun 29, 2026 · 24 records"
 * @param {string[]} opts.columns   table headers
 * @param {Array<Array>} opts.rows  table rows
 */
export function exportPDF({ title, subtitle, columns, rows }) {
  const win = window.open('', '_blank', 'width=900,height=1100');
  if (!win) {
    alert('Please allow pop-ups to download the PDF report.');
    return;
  }
  const esc = (v) =>
    String(v == null ? '' : v).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

  const head = columns.map((c) => `<th>${esc(c)}</th>`).join('');
  const body = rows
    .map((r) => `<tr>${r.map((cell) => `<td>${esc(cell)}</td>`).join('')}</tr>`)
    .join('');

  win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8" />
    <title>${esc(title)}</title>
    <style>
      @page { size: landscape; margin: 16mm; }
      * { box-sizing: border-box; }
      body { font-family: Inter, Arial, sans-serif; color: #271a1c; margin: 0; padding: 28px; }
      .head { display:flex; align-items:center; gap:14px; border-bottom: 3px solid #6e1423; padding-bottom: 16px; margin-bottom: 20px; }
      .mark { width: 40px; height: 40px; border-radius: 9px; background: #6e1423; color:#fff; display:flex; align-items:center; justify-content:center; font-weight:700; font-family: Georgia, serif; }
      h1 { font-family: 'Playfair Display', Georgia, serif; color:#3f0a13; font-size: 22px; margin: 0; }
      .sub { color:#6f6266; font-size: 12px; margin-top: 2px; }
      .org { margin-left:auto; text-align:right; font-size: 11px; color:#6f6266; }
      table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
      th { text-align: left; background: #6e1423; color: #fff; padding: 8px 10px; font-weight: 600; }
      td { padding: 7px 10px; border-bottom: 1px solid #eadfd0; vertical-align: top; }
      tr:nth-child(even) td { background: #fbf6ef; }
      .foot { margin-top: 18px; font-size: 10px; color:#8a7d80; }
    </style></head>
    <body>
      <div class="head">
        <div class="mark">U</div>
        <div>
          <h1>${esc(title)}</h1>
          <div class="sub">${esc(subtitle)}</div>
        </div>
        <div class="org">Unlimited Mind of Freedom<br/>501(c)(3) · Lithonia, GA</div>
      </div>
      <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
      <div class="foot">Confidential — UMOF Learning Portal. Generated from the live CRM.</div>
      <script>window.onload = function(){ setTimeout(function(){ window.print(); }, 250); };<\/script>
    </body></html>`);
  win.document.close();
}

/**
 * Open a clean lender packet the student can show underwriting.
 * Identity + program + participation + scores + Grading Breakdown per assessment.
 *
 * @param {object} packet  from store.getStudentLenderPacket()
 * @param {object} [opts]
 * @param {'print'|'word'} [opts.mode='print']
 */
export function exportLenderPacket(packet, opts = {}) {
  const mode = opts.mode || 'print';
  const esc = (v) =>
    String(v == null ? '' : v).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

  const s = packet.student;
  const c = packet.curriculum || {};
  const st = packet.stats || {};
  const genDate = new Date(packet.generatedAt || Date.now()).toLocaleString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
  const fmt = (iso) => {
    if (!iso) return '—';
    const d = new Date(String(iso).length <= 10 ? iso + 'T00:00:00' : iso);
    if (isNaN(d.getTime())) return String(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const completed = new Set(packet.completedSessionIds || []);
  const sessionsDone = (packet.sessions || []).filter((x) => completed.has(x.id)).length;
  const sessionsTotal = (packet.sessions || []).length || st.totalSessions || 0;

  // Fixed rubric used for written / instructor-graded work (matches portal grade form).
  const RUBRIC = [
    { id: 'completed', label: 'Completed all questions', max: 20 },
    { id: 'understanding', label: 'Understanding of concepts', max: 20 },
    { id: 'reflection', label: 'Depth of reflection', max: 20 },
    { id: 'organization', label: 'Organization and clarity', max: 20 },
    { id: 'grammar', label: 'Grammar, punctuation, and sentence structure', max: 20 },
  ];
  const isRubric = (scores) =>
    scores && typeof scores === 'object' && RUBRIC.some((r) => Object.prototype.hasOwnProperty.call(scores, r.id));

  // Simple score rows + optional aligned Grading Breakdown under each graded written assessment.
  const scoreRows = (packet.assessments || [])
    .map((a) => {
      const q = a.quiz;
      const sub = a.submission;
      let status = 'Not started';
      let score = '—';
      if (sub?.status === 'graded' && sub.score != null) {
        status = 'Graded';
        score = `${sub.score}${a.unit || '%'}`;
      } else if (sub) {
        status = 'Submitted — pending grade';
      }
      return `<tr>
        <td>${esc(q.title)}</td>
        <td>${esc(status)}</td>
        <td>${esc(score)}</td>
      </tr>`;
    })
    .join('');

  const breakdownSections = (packet.assessments || [])
    .filter((a) => a.submission?.status === 'graded' && isRubric(a.submission.questionScores))
    .map((a) => {
      const max = a.quiz.maxScore || 100;
      const scores = a.submission.questionScores || {};
      const rows = RUBRIC.map(
        (r) => `<tr>
          <td class="gb-c">${esc(r.label)}</td>
          <td class="gb-p">${esc(scores[r.id] != null ? scores[r.id] : '—')}/${r.max}</td>
        </tr>`
      ).join('');
      return `<div class="gb-block">
        <h3>${esc(a.quiz.title)}</h3>
        <p class="gb-sub">Final score: <strong>${esc(a.submission.score)}${esc(a.unit || '')}</strong></p>
        <table class="gb">
          <thead><tr><th class="gb-c">Criteria</th><th class="gb-p">Points</th></tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr><td class="gb-c"><strong>Total</strong></td><td class="gb-p"><strong>${esc(a.submission.score)}/${max}</strong></td></tr></tfoot>
        </table>
      </div>`;
    })
    .join('');

  const gradingExplanation =
    packet.gradingExplanation ||
    `How UMOF grades this program

Unlimited Mind of Freedom (UMOF) evaluates students on participation in live class sessions and completion of course assessments (quizzes and written assignments).

• Multiple-choice quizzes are scored automatically: percentage of correct answers.
• Written assignments and open responses are reviewed by an instructor using a Grading Breakdown (five criteria, 20 points each, total 100): Completed all questions; Understanding of concepts; Depth of reflection; Organization and clarity; Grammar, punctuation, and sentence structure.
• The program average is the mean of all graded assessment scores.

Final grades reflect satisfactory completion of training objectives for The Entrepreneur’s Journey: Funding Masterclass. This document is a training record only — not a credit decision, income verification, or guarantee of funding.`;

  const title = `Training Record — ${s.name}`;
  const subtitle = `${c.title || 'UMOF Funding Masterclass'} · Generated ${genDate}`;

  const bodyHtml = `
    <div class="banner">Prepared by Unlimited Mind of Freedom (UMOF), 501(c)(3) · For the student’s use with lenders / underwriting</div>

    <section>
      <h2>1. Student</h2>
      <table class="kv">
        <tr><th>Full name</th><td>${esc(s.name)}</td></tr>
        <tr><th>Email</th><td>${esc(s.email)}</td></tr>
        <tr><th>Phone</th><td>${esc(s.phone || '—')}</td></tr>
        <tr><th>Cohort</th><td>${esc(s.cohort || '—')}</td></tr>
        <tr><th>Enrollment plan</th><td>${esc(s.plan || '—')}</td></tr>
        <tr><th>Enrolled</th><td>${fmt(s.enrolled)}</td></tr>
      </table>
    </section>

    <section>
      <h2>2. Program</h2>
      <table class="kv">
        <tr><th>Course</th><td>${esc(c.title || 'The Entrepreneur’s Journey: Funding Masterclass')}</td></tr>
        <tr><th>Format</th><td>${esc(c.length || '—')} · ${esc(c.format || '—')}</td></tr>
        <tr><th>Provider</th><td>Unlimited Mind of Freedom (UMOF) · 501(c)(3) · Lithonia, GA</td></tr>
      </table>
      ${c.description ? `<p class="desc">${esc(c.description)}</p>` : ''}
    </section>

    <section>
      <h2>3. Participation &amp; results</h2>
      <table class="kv">
        <tr><th>Sessions completed</th><td>${esc(st.completed ?? sessionsDone)} of ${esc(st.totalSessions ?? sessionsTotal)} (${esc(st.completionPct ?? 0)}%)</td></tr>
        <tr><th>Assessments submitted</th><td>${esc(st.quizzesTaken ?? 0)}</td></tr>
        <tr><th>Average graded score</th><td>${st.avgScore == null ? '— (no graded work yet)' : esc(st.avgScore) + '%'}</td></tr>
      </table>
    </section>

    <section>
      <h2>4. Assessment scores</h2>
      <table>
        <thead><tr><th>Assessment</th><th>Status</th><th>Score</th></tr></thead>
        <tbody>${scoreRows || '<tr><td colspan="3">No assessments on record.</td></tr>'}</tbody>
      </table>
    </section>

    ${
      breakdownSections
        ? `<section>
      <h2>5. Grading Breakdown</h2>
      <p class="desc">How each written assessment score was derived (criteria aligned with lender review).</p>
      ${breakdownSections}
    </section>`
        : ''
    }

    <section>
      <h2>${breakdownSections ? '6' : '5'}. Explanation of grading</h2>
      <div class="explain"><p>${esc(gradingExplanation).replace(/\n/g, '<br/>')}</p></div>
    </section>

    <section class="attest">
      <h2>${breakdownSections ? '7' : '6'}. Certification</h2>
      <p>I certify that the information above was produced from the live UMOF Learning Portal and accurately reflects this student’s participation and graded assessment scores for the program named above.</p>
      <div class="sign">
        <div>Instructor / authorized administrator: ________________________________</div>
        <div>Title: ________________________________ &nbsp;&nbsp; Date: ______________</div>
        <div>Organization: Unlimited Mind of Freedom (UMOF)</div>
      </div>
    </section>

    <div class="foot">
      Training record only — not a credit decision or guarantee of funding.
      Generated ${esc(genDate)}. Contact UMOF to verify authenticity.
    </div>
  `;

  const styles = `
    @page { size: letter; margin: 14mm; }
    * { box-sizing: border-box; }
    body { font-family: Inter, Calibri, Arial, sans-serif; color: #271a1c; margin: 0; padding: 24px; font-size: 11px; line-height: 1.45; }
    .banner { background: #6e1423; color: #fff; padding: 8px 12px; font-size: 10px; font-weight: 600; letter-spacing: .02em; margin: -24px -24px 18px; }
    .head { display:flex; align-items:center; gap:14px; border-bottom: 3px solid #6e1423; padding-bottom: 14px; margin-bottom: 18px; }
    .mark { width: 40px; height: 40px; border-radius: 9px; background: #6e1423; color:#fff; display:flex; align-items:center; justify-content:center; font-weight:700; font-family: Georgia, serif; font-size: 18px; }
    h1 { font-family: Georgia, serif; color:#3f0a13; font-size: 20px; margin: 0; }
    .sub { color:#6f6266; font-size: 11px; margin-top: 2px; }
    .org { margin-left:auto; text-align:right; font-size: 10px; color:#6f6266; }
    h2 { font-family: Georgia, serif; color: #6e1423; font-size: 14px; margin: 20px 0 8px; border-bottom: 1px solid #eadfd0; padding-bottom: 4px; }
    h3 { font-family: Georgia, serif; color: #3f0a13; font-size: 12px; margin: 14px 0 4px; }
    section { margin-bottom: 8px; page-break-inside: avoid; }
    table { width: 100%; border-collapse: collapse; font-size: 10.5px; margin: 6px 0 10px; }
    th { text-align: left; background: #6e1423; color: #fff; padding: 6px 8px; font-weight: 600; }
    td { padding: 6px 8px; border-bottom: 1px solid #eadfd0; vertical-align: top; }
    tr:nth-child(even) td { background: #fbf6ef; }
    table.kv th { width: 28%; background: #f3e8dc; color: #3f0a13; border-bottom: 1px solid #eadfd0; font-weight: 600; }
    table.kv td { background: #fff; }
    table.gb { table-layout: fixed; width: 100%; margin: 4px 0 12px; }
    table.gb th.gb-c, table.gb td.gb-c { width: 72%; text-align: left; }
    table.gb th.gb-p, table.gb td.gb-p { width: 28%; text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
    table.gb tfoot td { border-top: 2px solid #6e1423; background: #f3e8dc; }
    .gb-block { margin-bottom: 10px; page-break-inside: avoid; }
    .gb-sub { margin: 0 0 4px; color: #6f6266; font-size: 10.5px; }
    .explain { background: #fbf6ef; border-left: 3px solid #6e1423; padding: 12px 14px; margin: 6px 0; }
    .explain p { margin: 0; line-height: 1.55; white-space: normal; }
    .desc { color: #4a4042; margin: 6px 0 10px; }
    .attest { border: 2px solid #6e1423; padding: 12px 14px; border-radius: 6px; margin-top: 16px; }
    .sign { margin-top: 16px; display: flex; flex-direction: column; gap: 12px; font-size: 11px; }
    .foot { margin-top: 18px; font-size: 9px; color:#8a7d80; border-top: 1px solid #eadfd0; padding-top: 8px; }
  `;

  const htmlDoc = `<!DOCTYPE html><html><head><meta charset="utf-8" />
    <title>${esc(title)}</title>
    <style>${styles}</style></head>
    <body>
      <div class="head">
        <div class="mark">U</div>
        <div>
          <h1>${esc(title)}</h1>
          <div class="sub">${esc(subtitle)}</div>
        </div>
        <div class="org">Unlimited Mind of Freedom<br/>501(c)(3) · Lithonia, GA</div>
      </div>
      ${bodyHtml}
      ${mode === 'print' ? '<script>window.onload = function(){ setTimeout(function(){ window.print(); }, 300); };</script>' : ''}
    </body></html>`;

  if (mode === 'word') {
    const blob = new Blob(['\ufeff', htmlDoc], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = opts.filename || `umof-lender-packet-${(s.name || 'student').replace(/\s+/g, '-').toLowerCase()}.doc`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }

  const win = window.open('', '_blank', 'width=900,height=1100');
  if (!win) {
    alert('Please allow pop-ups to download the lender packet PDF.');
    return;
  }
  win.document.write(htmlDoc);
  win.document.close();
}

/**
 * Download a branded Word document (.doc). Uses the standard, dependency-free
 * Word-HTML format, which Word/Google Docs/Pages all open cleanly.
 * @param {object} opts {title, subtitle, columns, rows, filename}
 */
export function exportWord({ title, subtitle, columns, rows, filename }) {
  const esc = (v) =>
    String(v == null ? '' : v).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const head = columns.map((c) => `<th>${esc(c)}</th>`).join('');
  const body = rows
    .map((r) => `<tr>${r.map((cell) => `<td>${esc(cell)}</td>`).join('')}</tr>`)
    .join('');

  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
  <head><meta charset="utf-8" /><title>${esc(title)}</title>
  <!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View></w:WordDocument></xml><![endif]-->
  <style>
    body { font-family: Calibri, Arial, sans-serif; color: #271a1c; }
    h1 { font-family: Georgia, serif; color: #6e1423; font-size: 18pt; margin: 0 0 2pt; }
    .sub { color: #6f6266; font-size: 9pt; margin-bottom: 12pt; }
    table { border-collapse: collapse; width: 100%; font-size: 9pt; }
    th { background: #6e1423; color: #ffffff; text-align: left; padding: 5pt 7pt; border: 1px solid #6e1423; }
    td { padding: 5pt 7pt; border: 1px solid #d9c9b0; vertical-align: top; }
    .org { color: #6f6266; font-size: 8pt; margin-top: 10pt; }
  </style></head>
  <body>
    <h1>${esc(title)}</h1>
    <div class="sub">${esc(subtitle)}</div>
    <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
    <p class="org">Unlimited Mind of Freedom · 501(c)(3) · Lithonia, GA — Confidential, generated from the live CRM.</p>
  </body></html>`;

  const blob = new Blob(['﻿', html], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'crm.doc';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
