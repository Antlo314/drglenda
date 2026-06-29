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
