/* =============================================================================
   UMOF Learning Portal — App shell, router & views
   ========================================================================== */

import './portal.css';
import * as store from './store.js';
import {
  login, logout, currentUser, initAuth, clearCachedUser, refreshSessionUser,
  signUp, requestPasswordReset, updatePassword, updateDisplayName, onAuthEvent,
  normalizeEmail, mapAuthError,
} from './auth.js';
import { downloadCSV, exportPDF, exportWord } from './export.js';
import { USE_SUPABASE, SESSIONS_LOCKED } from './config.js';

const app = document.getElementById('app');

/** Which curriculum week accordion stays open after a re-render (admin edits). */
let curricOpenWeek = null;
/** Admin curriculum page: view mode vs edit mode (Edit / Save / Delete). */
let curricEditing = false;
/** Admin Tests page: quiz id currently open in the edit form (null = create mode). */
let editingQuizId = null;
/** Admin Grading: filter by curriculum week (`all` or number). Persists in session. */
const GRADE_WEEK_KEY = 'umof_grade_week';
function getGradeWeekFilter() {
  try {
    const raw = sessionStorage.getItem(GRADE_WEEK_KEY);
    if (raw === 'all' || raw == null || raw === '') return 'all';
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 'all';
  } catch {
    return 'all';
  }
}
function setGradeWeekFilter(v) {
  try {
    sessionStorage.setItem(GRADE_WEEK_KEY, v === 'all' || v == null ? 'all' : String(v));
  } catch {
    /* */
  }
}

/** Ensure Dr. Glenda S. Williams is always shown with , CFWF. */
function displayNameWithCfwf(name) {
  if (!name) return name;
  const n = String(name).trim();
  if (/CFWF/i.test(n)) {
    // Normalize to ", CFWF" if credential is present without a clean comma form
    return n.replace(/\s*,?\s*CFWF\s*$/i, ', CFWF');
  }
  if (/Dr\.?\s*Glenda\s+S\.?\s*Williams/i.test(n)) {
    return `${n.replace(/,+\s*$/, '')}, CFWF`;
  }
  return n;
}

/* ---- small helpers -------------------------------------------------------- */
const esc = (v) =>
  String(v == null ? '' : v).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );

/**
 * Admin warning dialog for risky / irreversible actions.
 * Explains what will happen before the admin continues.
 *
 * @param {object} opts
 * @param {string} opts.title - Short action name (first line)
 * @param {string[]} [opts.will] - Bullet list: what this will do
 * @param {string[]} [opts.note] - Extra notes (archive, who is affected, etc.)
 * @param {'soft'|'hard'|'irreversible'} [opts.severity]
 * @param {boolean} [opts.requireType] - Second step: type DELETE
 * @returns {boolean}
 */
function adminConfirmDanger({
  title,
  will = [],
  note = [],
  severity = 'hard',
  requireType = false,
} = {}) {
  const lines = [String(title || 'Confirm action'), ''];
  if (will.length) {
    lines.push('What this will do:');
    will.forEach((w) => lines.push(`• ${w}`));
    lines.push('');
  }
  if (note.length) {
    note.forEach((n) => lines.push(n));
    lines.push('');
  }
  if (severity === 'irreversible') {
    lines.push('⚠ IRREVERSIBLE for students in the live portal (they lose this data immediately).');
  } else if (severity === 'hard') {
    lines.push('⚠ Students will feel this change immediately.');
  } else {
    lines.push('You can reverse this later from the admin tools.');
  }
  lines.push('', 'Do you want to continue?');
  if (!window.confirm(lines.join('\n'))) return false;
  if (requireType) {
    const typed = window.prompt(
      'Final confirmation.\n\nType DELETE (all caps) to proceed.\nAnything else cancels.'
    );
    if (typed == null || typed.trim().toUpperCase() !== 'DELETE') {
      toast('Cancelled — nothing was changed');
      return false;
    }
  }
  return true;
}

/** Calendar date YYYY-MM-DD (exports, CRM date fields). */
const todayISO = () => {
  const d = new Date();
  const yr = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const dy = String(d.getDate()).padStart(2, '0');
  return `${yr}-${mo}-${dy}`;
};

/** Full ISO timestamp for submissions / grades (ordering + “just now”). */
const nowISO = () => new Date().toISOString();

/* ---- quiz draft autosave (local only; not a server submit) --------------- */
const draftKey = (userId, quizId) => `umof_draft_${userId}_${quizId}`;
function loadQuizDraft(userId, quizId) {
  try {
    const raw = localStorage.getItem(draftKey(userId, quizId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function saveQuizDraft(userId, quizId, payload) {
  try {
    localStorage.setItem(draftKey(userId, quizId), JSON.stringify({ ...payload, savedAt: Date.now() }));
  } catch { /* quota */ }
}
function clearQuizDraft(userId, quizId) {
  try {
    localStorage.removeItem(draftKey(userId, quizId));
  } catch { /* ignore */ }
}

const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const fmtDateTime = (v) => {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
};

const initials = (name) =>
  name.split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();

const AVATAR_COLORS = ['#6e1423', '#9c5b1e', '#3f6e54', '#3b5b8c', '#7a3b6e', '#8c6d1f'];
const avatarColor = (id) => {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[h];
};

const avatar = (user, size = 38) =>
  `<span class="avatar" style="--sz:${size}px;background:${avatarColor(user.id)}">${esc(initials(user.name))}</span>`;

const STATUS_OPTIONS = ['new', 'contacted', 'qualified', 'enrolled', 'lost'];

function toast(msg, ms = 2800) {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), ms);
}

/** Persistent non-blocking banner for connection / save failures. */
function showConnBanner(msg) {
  let b = document.getElementById('connBanner');
  if (!b) {
    b = document.createElement('div');
    b.id = 'connBanner';
    b.className = 'conn-banner';
    b.setAttribute('role', 'status');
    document.body.appendChild(b);
  }
  b.innerHTML = `<span>${esc(msg)}</span><button type="button" class="conn-banner-x" data-action="dismiss-banner" aria-label="Dismiss">×</button>`;
  b.classList.add('show');
}
function hideConnBanner() {
  document.getElementById('connBanner')?.classList.remove('show');
}

/** Site-wide “report glitches” bar for portal (main site has its own in index.html). */
const FEEDBACK_DISMISS_KEY = 'umof_feedback_bar_dismissed';
function isFeedbackBarDismissed() {
  try {
    return localStorage.getItem(FEEDBACK_DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}
function siteFeedbackBarHtml() {
  if (isFeedbackBarDismissed()) return '';
  return `<div class="site-feedback-bar" id="siteFeedbackBar" role="region" aria-label="Report issues">
    <div class="site-feedback-inner">
      <p class="site-feedback-text">
        <span class="site-feedback-ico" aria-hidden="true">!</span>
        Notice any glitches or bugs?
        <a href="mailto:admin@umof.org?subject=UMOF%20portal%20feedback%20%2F%20bug%20report">Email admin@umof.org</a>
        and we&rsquo;ll fix it.
      </p>
      <button type="button" class="site-feedback-dismiss" data-action="dismiss-feedback" aria-label="Dismiss feedback notice">Dismiss</button>
    </div>
  </div>`;
}

/* ---- app state ------------------------------------------------------------ */
let route = { name: null, params: {} };
let crm = { view: 'leads', q: '', status: 'all', adding: false, editingId: null, notesOpen: new Set() };
// Discussion composer draft + reply target, kept across live re-renders.
// `replyToId` is the root post being replied to; `focusAfterRender` re-focuses after post.
let disc = {
  draft: '',
  replyToId: null,
  focusAfterRender: false,
  /** Which week accordion is open on Discussion */
  openWeek: null,
  /** Week number the composer is posting to */
  postWeek: null,
};

// logged-out auth screens
let authScreen = 'login'; // 'login' | 'signup' | 'forgot'
let authError = '';
let authInfo = '';
let authFieldErrors = {}; // { email?, password?, name?, confirm? }
let authForm = { email: '', name: '' }; // durable across re-renders; never store password
let authFocus = null; // field name to focus after render ('password' | 'email' | …)
let recoveryMode = false; // user arrived via a password-reset link
let portalLoadError = null; // hydrate failed after successful auth

function go(name, params = {}) {
  route = { name, params };
  closeSideNav();
  render();
  document.querySelector('.portal-main')?.scrollTo(0, 0);
}

function openSideNav() {
  document.querySelector('.portal-shell')?.classList.add('side-open');
  document.body.classList.add('side-nav-open');
}
function closeSideNav() {
  document.querySelector('.portal-shell')?.classList.remove('side-open');
  document.body.classList.remove('side-nav-open');
}
function toggleSideNav() {
  const shell = document.querySelector('.portal-shell');
  if (shell?.classList.contains('side-open')) closeSideNav();
  else openSideNav();
}

function goAuth(screen) {
  authScreen = screen;
  authError = '';
  authInfo = '';
  authFieldErrors = {};
  // Keep email (and name) when switching login ↔ forgot ↔ signup
  render();
}

/** Re-render in place when realtime pushes a change (only while logged in). */
function liveRerender() {
  if (currentUser()) render();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateEmail(value) {
  const em = normalizeEmail(value);
  if (!em) return 'Enter your email address.';
  if (!EMAIL_RE.test(em)) return 'Enter a valid email address.';
  return '';
}

function validatePassword(value, { min = 0, label = 'Password' } = {}) {
  const pw = String(value || '');
  if (!pw) return `Enter your ${label.toLowerCase()}.`;
  if (min > 0 && pw.length < min) return `${label} must be at least ${min} characters.`;
  return '';
}

function fieldErr(name) {
  const msg = authFieldErrors[name];
  if (!msg) return '';
  return `<p class="field-error" id="err-${esc(name)}" role="alert">${esc(msg)}</p>`;
}

function inputAria(name) {
  const bad = !!authFieldErrors[name];
  return `${bad ? ` aria-invalid="true" aria-describedby="err-${esc(name)}"` : ''}`;
}

function setFormBusy(form, busy, label) {
  if (!form) return () => {};
  form.classList.toggle('is-busy', !!busy);
  const btn = form.querySelector('button[type="submit"]');
  const prev = btn?.textContent;
  form.querySelectorAll('input, textarea, button').forEach((el) => {
    if (el.dataset.action === 'toggle-pw') return; // allow show/hide while typing before submit
    if (busy) el.disabled = true;
    else if (el.type !== 'submit') el.disabled = false;
  });
  if (btn) {
    if (busy) {
      btn.disabled = true;
      if (label) btn.textContent = label;
    } else {
      btn.disabled = false;
      if (prev && label) btn.textContent = prev;
    }
  }
  const stored = btn ? { text: prev } : null;
  return () => {
    form.classList.remove('is-busy');
    form.querySelectorAll('input, textarea, button').forEach((el) => {
      el.disabled = false;
    });
    if (btn && stored?.text) btn.textContent = stored.text;
  };
}

/** Disable a form's submit button and show a working label. Returns restore fn. */
function setBusy(form, label) {
  return setFormBusy(form, true, label);
}

function loadingShell(msg = 'Loading your portal…') {
  return `<div class="portal-loading"><span class="spinner" aria-hidden="true"></span>${esc(msg)}</div>`;
}

function loadErrorShell(msg) {
  return `
  <div class="portal-loading portal-load-error">
    <div class="auth-card" style="max-width:420px;text-align:center">
      <h1 style="font-size:1.35rem;margin-bottom:10px">Couldn’t load your portal</h1>
      <p class="auth-error" role="alert">${esc(msg)}</p>
      <div style="display:flex;flex-direction:column;gap:10px;margin-top:18px">
        <button type="button" class="btn btn-primary btn-full" data-action="retry-enter">Try again</button>
        <button type="button" class="btn btn-outline btn-full" data-action="logout">Sign out</button>
      </div>
    </div>
  </div>`;
}

/**
 * Shared post-authentication entry: load data, start realtime, show dashboard.
 * Never leaves a half-loaded shell on hydrate failure.
 */
async function enterApp(user) {
  if (!user) return;
  portalLoadError = null;
  app.innerHTML = loadingShell(
    user.role === 'admin' ? 'Loading instructor workspace…' : 'Loading your portal…'
  );
  try {
    await store.hydrate(user);
    store.startRealtime(user, liveRerender);
    store.startDiscussionRealtime(user, liveRerender);
    route = { name: user.role === 'admin' ? 'admin-home' : 'student-home', params: {} };
    portalLoadError = null;
    render();
    document.querySelector('.portal-main')?.scrollTo(0, 0);
  } catch (err) {
    console.error('[portal] enterApp failed:', err);
    portalLoadError = mapAuthError(err?.message || err, 'login') ||
      'We signed you in, but couldn’t load your data. Check your connection and try again.';
    app.innerHTML = loadErrorShell(portalLoadError);
  }
}

/* ===========================================================================
   LOGIN
   ======================================================================== */
function authShell(inner) {
  return `
  <div class="auth-wrap">
    <div class="auth-card">
      <a class="auth-brand" href="/">
        <img src="/assets/umof-logo.png" alt="UMOF" width="46" height="46" />
        <span><strong>UMOF</strong><small>Learning Portal</small></span>
      </a>
      ${inner}
      <a class="auth-back" href="/">← Back to the main website</a>
    </div>
  </div>`;
}

function authMsgs() {
  return `${authError ? `<p class="auth-error" role="alert">${esc(authError)}</p>` : ''}${
    authInfo ? `<p class="auth-ok" role="status">${esc(authInfo)}</p>` : ''
  }`;
}

function pwField(name, { autocomplete, placeholder, label }) {
  return `<label class="field"><span>${esc(label)}</span>
    <div class="pw-wrap">
      <input type="password" name="${esc(name)}" autocomplete="${esc(autocomplete)}"
        placeholder="${esc(placeholder)}"${inputAria(name)} />
      <button type="button" class="pw-toggle" data-action="toggle-pw" aria-label="Show password">Show</button>
    </div>
    ${fieldErr(name)}
  </label>`;
}

function viewLogin() {
  const em = esc(authForm.email || '');
  return authShell(`
    <h1>Sign in</h1>
    <p class="auth-sub">One portal for everyone at UMOF.</p>
    <ul class="auth-audience" aria-label="Who this portal is for">
      <li><strong>Students</strong> — classes, tests, discussion</li>
      <li><strong>Instructors</strong> — grading, students, CRM</li>
    </ul>
    <form id="loginForm" class="auth-form" novalidate>
      <label class="field"><span>Email</span>
        <input type="email" name="email" autocomplete="username" inputmode="email"
          placeholder="you@example.com" value="${em}" data-action="auth-field"${inputAria('email')} />
        ${fieldErr('email')}
      </label>
      ${pwField('password', { autocomplete: 'current-password', placeholder: 'Your password', label: 'Password' })}
      ${authMsgs()}
      <button type="submit" class="btn btn-primary btn-full">Sign in</button>
    </form>
    ${
      USE_SUPABASE
        ? `<div class="auth-links">
            <button type="button" class="link-btn" data-action="auth-screen" data-screen="forgot">Forgot password?</button>
          </div>
          <div class="auth-newcta">
            <span class="auth-newcta-label">New student?</span>
            <button type="button" class="btn btn-outline btn-full" data-action="auth-screen" data-screen="signup">Create your student login</button>
            <small>Use the exact enrollment email UMOF has on file.</small>
          </div>
          <p class="auth-staff-note">Instructors: sign in with the account UMOF issued — there is no public staff signup.</p>`
        : `<div class="auth-demo">
        <p>Demo logins — try either role:</p>
        <div class="auth-demo-btns">
          <button type="button" class="btn btn-outline btn-sm" data-action="demo" data-role="student">Student demo</button>
          <button type="button" class="btn btn-outline btn-sm" data-action="demo" data-role="admin">Admin / Instructor demo</button>
        </div>
        <small>
          Student: <code>jordan@umof.org</code> · password <code>demo1234</code><br />
          Admin: <code>admin@umof.org</code> · password <code>admin1234</code>
        </small>
      </div>`
    }
  `);
}

function viewSignup() {
  const em = esc(authForm.email || '');
  const nm = esc(authForm.name || '');
  return authShell(`
    <h1>Create your student login</h1>
    <p class="auth-sub">Enrolled students only. Your email must match the address UMOF approved for enrollment — that’s how we recognize you.</p>
    <form id="signupForm" class="auth-form" novalidate>
      <label class="field"><span>Full name</span>
        <input type="text" name="name" autocomplete="name" placeholder="Jane Doe" value="${nm}"
          data-action="auth-field"${inputAria('name')} />
        ${fieldErr('name')}
      </label>
      <label class="field"><span>Email <small class="field-hint">(enrollment email)</small></span>
        <input type="email" name="email" autocomplete="email" inputmode="email" placeholder="you@example.com"
          value="${em}" data-action="auth-field"${inputAria('email')} />
        ${fieldErr('email')}
      </label>
      ${pwField('password', { autocomplete: 'new-password', placeholder: 'At least 8 characters', label: 'Password' })}
      ${pwField('confirm', { autocomplete: 'new-password', placeholder: 'Re-enter password', label: 'Confirm password' })}
      <p class="auth-hint">Password must be at least 8 characters.</p>
      ${authMsgs()}
      <button type="submit" class="btn btn-primary btn-full">Create account</button>
    </form>
    <div class="auth-links">
      <span>Already have an account? <button type="button" class="link-btn strong" data-action="auth-screen" data-screen="login">Sign in</button></span>
    </div>
  `);
}

function viewForgot() {
  const em = esc(authForm.email || '');
  return authShell(`
    <h1>Reset your password</h1>
    <p class="auth-sub">Enter your email and we’ll send a link to set a new password. For security, we won’t say whether the email is registered.</p>
    <form id="forgotForm" class="auth-form" novalidate>
      <label class="field"><span>Email</span>
        <input type="email" name="email" autocomplete="email" inputmode="email" placeholder="you@example.com"
          value="${em}" data-action="auth-field"${inputAria('email')} />
        ${fieldErr('email')}
      </label>
      ${authMsgs()}
      <button type="submit" class="btn btn-primary btn-full">Send reset link</button>
    </form>
    <div class="auth-links">
      <button type="button" class="link-btn" data-action="auth-screen" data-screen="login">← Back to sign in</button>
    </div>
  `);
}

function viewReset() {
  return authShell(`
    <h1>Set a new password</h1>
    <p class="auth-sub">Choose a new password for your account. You’ll use this to sign in next time.</p>
    <form id="resetForm" class="auth-form" novalidate>
      ${pwField('password', { autocomplete: 'new-password', placeholder: 'At least 8 characters', label: 'New password' })}
      ${pwField('confirm', { autocomplete: 'new-password', placeholder: 'Re-enter password', label: 'Confirm password' })}
      <p class="auth-hint">Password must be at least 8 characters.</p>
      ${authMsgs()}
      <button type="submit" class="btn btn-primary btn-full">Update password</button>
    </form>
  `);
}

function renderAuthScreen() {
  const screens = { login: viewLogin, signup: viewSignup, forgot: viewForgot };
  return (screens[authScreen] || viewLogin)();
}

/* ===========================================================================
   ACCOUNT (logged in) — change name & password
   ======================================================================== */
function accountView(user) {
  const roleLabel = user.role === 'admin' ? 'Instructor' : 'Student';
  return `
  <div class="page-head"><div>
    <h1>Account</h1>
    <p class="muted">Manage your name and password.
      <span class="pill ${user.role === 'admin' ? 'pill-enrolled' : 'pill-todo'}" style="margin-left:8px">${esc(roleLabel)}</span>
    </p>
  </div></div>
  <div class="two-col">
    <section class="panel">
      <div class="panel-head"><h2>Profile</h2></div>
      <form id="nameForm" class="acct-form">
        <label class="field"><span>Display name</span>
          <input type="text" name="name" value="${esc(displayNameWithCfwf(user.name))}" required autocomplete="name" />
        </label>
        <label class="field"><span>Email</span>
          <input type="email" value="${esc(user.email)}" disabled />
        </label>
        <label class="field"><span>Workspace</span>
          <input type="text" value="${esc(roleLabel)}" disabled />
        </label>
        <button type="submit" class="btn btn-primary">Save name</button>
      </form>
    </section>
    <section class="panel">
      <div class="panel-head"><h2>Change password</h2></div>
      ${
        USE_SUPABASE
          ? `<form id="pwForm" class="acct-form">
              <label class="field"><span>New password</span>
                <div class="pw-wrap">
                  <input type="password" name="password" autocomplete="new-password" placeholder="At least 8 characters" minlength="8" required />
                  <button type="button" class="pw-toggle" data-action="toggle-pw" aria-label="Show password">Show</button>
                </div>
              </label>
              <label class="field"><span>Confirm new password</span>
                <div class="pw-wrap">
                  <input type="password" name="confirm" autocomplete="new-password" placeholder="Re-enter password" minlength="8" required />
                  <button type="button" class="pw-toggle" data-action="toggle-pw" aria-label="Show password">Show</button>
                </div>
              </label>
              <p class="auth-hint">Password must be at least 8 characters.</p>
              <button type="submit" class="btn btn-primary">Update password</button>
            </form>`
          : `<p class="muted">Password management is available once the portal is connected to Supabase.</p>`
      }
    </section>
  </div>`;
}

/* ===========================================================================
   HOW-TO HELP (dismissible callouts + header tips)
   ======================================================================== */
const helpOpen = new Set(); // which help panels are expanded this session

function isHelpDismissed(key) {
  if (!key) return false;
  try {
    return localStorage.getItem(`umof_help_${key}`) === '1';
  } catch {
    return false;
  }
}
function dismissHelp(key) {
  if (!key) return;
  try {
    localStorage.setItem(`umof_help_${key}`, '1');
  } catch {
    /* ignore */
  }
}

/** Dismissible onboarding / how-to callout. */
function helpCallout({ id, title, steps = [], dismissKey }) {
  const key = dismissKey || id;
  if (isHelpDismissed(key)) return '';
  const list = steps.map((s) => `<li>${s}</li>`).join('');
  return `<aside class="help-callout" data-help-callout="${esc(key)}" role="note">
    <span class="help-callout-ico" aria-hidden="true">?</span>
    <div class="help-callout-body">
      <strong>${esc(title)}</strong>
      <ol>${list}</ol>
      <div class="help-callout-actions">
        <button type="button" class="btn btn-ghost btn-sm" data-action="dismiss-help" data-key="${esc(key)}">Got it</button>
      </div>
    </div>
  </aside>`;
}

/** Compact How-to button for page headers. */
function helpBtn(id) {
  const open = helpOpen.has(id);
  return `<button type="button" class="help-btn" data-action="toggle-help" data-help-id="${esc(id)}"
      aria-expanded="${open ? 'true' : 'false'}">
      <span class="help-btn-ico" aria-hidden="true">?</span> How to
    </button>`;
}

/** Collapsible how-to panel (pair with helpBtn). */
function helpPanel(id, title, steps = []) {
  const open = helpOpen.has(id);
  const list = steps.map((s) => `<li>${s}</li>`).join('');
  return `<div class="help-panel${open ? ' open' : ''}" id="help-panel-${esc(id)}" ${open ? '' : 'hidden'}>
      <strong>${esc(title)}</strong>
      <ol>${list}</ol>
    </div>`;
}

function pageHeadHelp(title, muted, { helpId, helpTitle, helpSteps, actions = '' } = {}) {
  return `
  <div class="page-head page-head-with-help">
    <div><h1>${title}</h1>${muted ? `<p class="muted">${muted}</p>` : ''}</div>
    <div class="head-actions">${helpId ? helpBtn(helpId) : ''}${actions}</div>
  </div>
  ${helpId ? helpPanel(helpId, helpTitle || `How to use ${title}`, helpSteps || []) : ''}`;
}

/* ===========================================================================
   SHELL (after login)
   ======================================================================== */
const NAV_MORE_KEY = 'umof_admin_more_open';
function isNavGroupOpen(id) {
  // Auto-open if a child route is active
  try {
    return sessionStorage.getItem(`${NAV_MORE_KEY}_${id}`) === '1';
  } catch {
    return false;
  }
}
function setNavGroupOpen(id, open) {
  try {
    sessionStorage.setItem(`${NAV_MORE_KEY}_${id}`, open ? '1' : '0');
  } catch {
    /* ignore */
  }
}

function renderNavItem(n) {
  if (n.type === 'group') {
    const childActive = (n.children || []).some(
      (c) => route.name === c.route || c.active || (c.routes && c.routes.includes(route.name))
    );
    const open = childActive || isNavGroupOpen(n.id || n.label);
    const kids = (n.children || [])
      .map((c) => {
        const active =
          route.name === c.route ||
          c.active ||
          (c.routes && c.routes.includes(route.name));
        return `<button class="nav-item ${active ? 'active' : ''}"
          data-action="go" data-route="${c.route}">
          <span class="ni-ico">${c.icon || '·'}</span>${esc(c.label)}
          ${c.badge ? `<span class="ni-badge">${c.badge}</span>` : ''}
        </button>`;
      })
      .join('');
    return `<div class="nav-group${open ? ' open' : ''}" data-nav-group="${esc(n.id || n.label)}">
      <button type="button" class="nav-item nav-group-toggle${childActive ? ' active' : ''}"
        data-action="toggle-nav-group" data-group="${esc(n.id || n.label)}"
        aria-expanded="${open ? 'true' : 'false'}">
        <span class="ni-ico">${n.icon || '⋯'}</span>${esc(n.label)}
        <span class="nav-chev" aria-hidden="true">▾</span>
      </button>
      <div class="nav-group-children">${kids}</div>
    </div>`;
  }
  if (n.disabled) {
    return `<button type="button" class="nav-item nav-item-disabled" disabled
      title="${esc(n.disabledTitle || 'Coming soon')}" aria-disabled="true">
      <span class="ni-ico">${n.icon}</span>${esc(n.label)}
      <span class="ni-lock" aria-hidden="true">🔒</span>
    </button>`;
  }
  const active =
    route.name === n.route ||
    n.active ||
    (n.routes && n.routes.includes(route.name));
  return `<button class="nav-item ${active ? 'active' : ''}"
    data-action="go" data-route="${n.route}">
    <span class="ni-ico">${n.icon}</span>${esc(n.label)}
    ${n.badge ? `<span class="ni-badge">${n.badge}</span>` : ''}
  </button>`;
}

function shell(user, navItems, content) {
  const items = navItems.map(renderNavItem).join('');

  return `
  ${siteFeedbackBarHtml()}
  <div class="portal-shell">
    <div class="side-scrim" data-action="close-side" aria-hidden="true"></div>
    <aside class="portal-side" id="portalSide" aria-label="Main navigation">
      <div class="side-head">
        <a class="side-brand" href="/">
          <img src="/assets/umof-logo.png" alt="UMOF" width="36" height="36" />
          <span><strong>UMOF</strong><small>Learning Portal</small></span>
        </a>
        <button type="button" class="side-close" data-action="close-side" aria-label="Close menu">×</button>
      </div>
      <nav class="side-nav">${items}</nav>
      <div class="side-foot">
        <a class="side-link" href="/">← Main website</a>
        ${user.role === 'admin' && !USE_SUPABASE ? `<button class="side-link" data-action="reset">↺ Reset demo data</button>` : ''}
      </div>
    </aside>
    <div class="portal-body">
      <header class="portal-top">
        <button class="side-toggle" data-action="toggle-side" aria-label="Open menu" aria-controls="portalSide">☰</button>
        <div class="top-spacer"></div>
        <div class="top-user">
          <div class="tu-text"><strong>${esc(displayNameWithCfwf(user.name))}</strong><small>${user.role === 'admin' ? esc(user.title || 'Instructor') : esc(user.cohort || 'Student')}</small></div>
          ${avatar(user, 40)}
          <button class="btn btn-ghost btn-sm top-logout" data-action="logout">Log out</button>
        </div>
      </header>
      <main class="portal-main">${content}</main>
    </div>
  </div>`;
}

const statCard = (label, value, sub = '') => `
  <div class="stat">
    <div class="stat-val">${value}</div>
    <div class="stat-label">${esc(label)}</div>
    ${sub ? `<div class="stat-sub">${sub}</div>` : ''}
  </div>`;

/* ===========================================================================
   CURRICULUM (students: read-only · admins: fully editable)
   ======================================================================== */
function linesText(arr) {
  return (arr || []).join('\n');
}

/** Publish / unpublish control for one curriculum week (admin only). */
function weekPublishControls(w, { compact = false } = {}) {
  const published = !w.pending;
  const wk = w.week;
  const status = store.getWeekReleaseStatus(wk);
  const sessLive = status.sessions.filter((s) => s.published).length;
  const quizLive = status.quizzes.filter((q) => q.published).length;
  const label = published ? 'Unpublish from students' : 'Publish to students';
  const hint = published
    ? 'Students can see this week’s full curriculum.'
    : 'Students only see “coming soon” until you publish.';
  const releaseSummary = `<span class="curric-release-meta muted">
      Sessions ${sessLive}/${status.sessions.length || 0} · Tests ${quizLive}/${status.quizzes.length || 0}
    </span>`;
  return `<div class="curric-publish-bar${compact ? ' curric-publish-bar-compact' : ''}">
    ${compact ? '' : `<span class="curric-publish-hint muted">${hint}</span>`}
    ${compact ? '' : releaseSummary}
    <div class="curric-publish-btns">
      <button type="button"
        class="btn btn-sm ${published ? 'btn-outline' : 'btn-primary'}"
        data-action="toggle-curric-week-publish"
        data-week="${wk}"
        aria-pressed="${published ? 'true' : 'false'}">
        ${published ? '● Unpublish syllabus' : 'Publish syllabus'}
      </button>
      <button type="button"
        class="btn btn-sm ${status.allPublished ? 'btn-outline' : 'btn-primary'}"
        data-action="publish-week"
        data-week="${wk}"
        data-publish="${status.allPublished ? '0' : '1'}"
        title="Syllabus + sessions + tests for this week">
        ${status.allPublished ? `Unpublish entire week` : `Publish entire week`}
      </button>
    </div>
    ${compact ? '' : `<span class="sr-only">${label}</span>`}
  </div>`;
}

function weekBlock(w, open, { admin = false } = {}) {
  const published = !w.pending;
  const head = `<summary>
      <span class="wk-num">Week ${w.week}</span>
      <span class="wk-title">${esc(w.title || 'Coming soon')}</span>
      ${admin ? `<span class="pill ${published ? 'pill-done' : 'pill-todo'}">${published ? 'Published' : 'Coming soon'}</span>` : ''}
      <span class="wk-chev" aria-hidden="true">▾</span>
    </summary>`;

  if (w.pending && !admin) {
    return `<details class="wk wk-pending"${open ? ' open' : ''} data-week="${w.week}">
      ${head}
      <div class="wk-body"><p class="muted">The detailed curriculum for this week will be published here.</p></div>
    </details>`;
  }

  const section = (label, inner) =>
    inner ? `<div class="wk-sec"><h3>${esc(label)}</h3>${inner}</div>` : '';
  const list = (items, ordered) => {
    if (!items?.length) return '';
    return `<${ordered ? 'ol' : 'ul'} class="wk-list${ordered ? ' wk-steps' : ''}">${items
      .map((it) => `<li>${esc(it)}</li>`)
      .join('')}</${ordered ? 'ol' : 'ul'}>`;
  };

  // Admins always reach here (pending student case returned above). Show
  // content when present so instructors can review before publishing.
  const emptyPending =
    w.pending &&
    !w.objectives?.length &&
    !w.assignment &&
    !w.discussion &&
    !w.quiz?.length;
  // Graded work lives under My Tests; syllabus only links when a published test exists.
  const weekTests = admin
    ? store.getQuizzesForWeek(w.week)
    : store.getVisibleQuizzesForWeek(w.week);
  const testCta = (() => {
    if (admin) {
      const live = weekTests.filter((q) => q.published).length;
      const total = weekTests.length;
      if (!total) return '';
      return `<div class="wk-sec"><h3>Weekly test (My Tests)</h3>
        <p class="wk-callout wk-assign">
          ${total} test${total === 1 ? '' : 's'} linked · ${live} live for students.
          <button type="button" class="btn btn-ghost btn-sm" data-action="go" data-route="admin-tests">Manage Tests →</button>
        </p>
      </div>`;
    }
    const open = weekTests[0];
    if (!open) return '';
    return `<div class="wk-sec"><h3>Weekly test</h3>
      <p class="wk-callout wk-assign">
        Complete <strong>${esc(open.title)}</strong> under My Tests
        ${open.due ? ` · due ${fmtDate(open.due)}` : ''}.
        <button type="button" class="btn btn-primary btn-sm" data-action="go" data-route="quiz" data-id="${open.id}">Open test →</button>
      </p>
    </div>`;
  })();
  const bodyInner = emptyPending
    ? `<p class="muted">No content yet — use <strong>Edit</strong> to add details, then publish to students.</p>`
    : `${section('Learning Objectives', list(w.objectives, false))}
      ${section('Assignment', w.assignment ? `<p class="wk-callout wk-assign">${esc(w.assignment)}</p>` : '')}
      ${section(
        'Discussion Post',
        w.discussion
          ? `<p class="wk-callout wk-discuss">${esc(w.discussion).replace(/\n/g, '<br />')}</p>`
          : ''
      )}
      ${section(
        'Action plan',
        list(w.quiz, true) ||
          `<p class="muted">${
            admin
              ? 'No action plan items yet — add them in Edit (this is a checklist for the week, not the graded test).'
              : 'Action plan items for this week will appear when your instructor publishes them.'
          }</p>`
      )}
      ${testCta}
      ${w.pending ? `<p class="muted curric-pending-note">This week is not visible to students yet.</p>` : ''}`;

  return `<details class="wk${w.pending ? ' wk-pending' : ''}${admin ? ' wk-admin' : ''}"${open ? ' open' : ''} data-week="${w.week}">
    ${head}
    <div class="wk-body">
      ${bodyInner}
      ${admin ? weekPublishControls(w) : ''}
    </div>
  </details>`;
}

/** Admin editor for one week — list fields are one item per line. */
function weekEditor(w, open) {
  const wk = w.week;
  const published = !w.pending;
  return `<details class="wk wk-edit${w.pending ? ' wk-pending' : ''}"${open ? ' open' : ''} data-week="${wk}">
    <summary>
      <span class="wk-num">Week ${wk}</span>
      <span class="wk-title">${esc(w.title || 'Untitled week')}</span>
      <span class="pill ${published ? 'pill-done' : 'pill-todo'}">${published ? 'Published' : 'Coming soon'}</span>
      <span class="wk-chev" aria-hidden="true">▾</span>
    </summary>
    <div class="wk-body curric-edit-body">
      ${weekPublishControls(w)}
      <div class="curric-edit-grid">
        <label class="field"><span>Week #</span>
          <input type="number" min="1" max="52" value="${wk}"
            data-action="curric-week-num" data-week="${wk}" /></label>
        <label class="field curric-edit-grow"><span>Week title</span>
          <input type="text" value="${esc(w.title || '')}" placeholder="e.g. Business Structure &amp; Legal Foundation"
            data-action="curric-week-title" data-week="${wk}" /></label>
      </div>
      <label class="field"><span>Learning objectives <em class="muted">(one per line)</em></span>
        <textarea rows="4" placeholder="Understand the entrepreneurial journey.&#10;Identify characteristics of successful entrepreneurs."
          data-action="curric-week-objectives" data-week="${wk}">${esc(linesText(w.objectives))}</textarea>
      </label>

      <label class="field"><span>Assignment</span>
        <textarea rows="2" placeholder="Create a one-page Business Vision Plan."
          data-action="curric-week-assignment" data-week="${wk}">${esc(w.assignment || '')}</textarea>
      </label>
      <label class="field"><span>Discussion prompt</span>
        <textarea rows="2" placeholder="What motivated you to become an entrepreneur?"
          data-action="curric-week-discussion" data-week="${wk}">${esc(w.discussion || '')}</textarea>
      </label>
      <label class="field"><span>Action plan <em class="muted">(one checklist item per line · not graded My Tests)</em></span>
        <textarea rows="6" placeholder="Complete the self-assessment worksheet.&#10;Draft your business vision statement."
          data-action="curric-week-quiz" data-week="${wk}">${esc(linesText(w.quiz))}</textarea>
      </label>
      <div class="curric-edit-actions">
        <button type="button" class="btn btn-sm ${published ? 'btn-outline' : 'btn-primary'}"
          data-action="toggle-curric-week-publish" data-week="${wk}">
          ${published ? 'Unpublish from students' : 'Publish to students'}
        </button>
        <button type="button" class="btn btn-primary btn-sm" data-action="save-curric-week" data-week="${wk}">
          Save
        </button>
        <button type="button" class="btn btn-outline btn-sm btn-danger-outline" data-action="delete-curric-week" data-week="${wk}">
          Delete
        </button>
      </div>
    </div>
  </details>`;
}

function curriculumView(user) {
  const c = store.getCurriculum();
  const isAdmin = user?.role === 'admin';
  const weeks = [...(c.weeks || [])].sort((a, b) => Number(a.week) - Number(b.week));
  const openWeek =
    curricOpenWeek != null
      ? curricOpenWeek
      : weeks[0]?.week ?? null;

  const syllabusOverview = `
  <section class="panel curric-overview">
    <div class="curric-meta">
      <div><span class="cm-label">Course Length</span><strong>${esc(c.length)}</strong></div>
      <div><span class="cm-label">Format</span><strong>${esc(c.format)}</strong></div>
      <div class="cm-wide"><span class="cm-label">Learning Style</span><strong>${esc(c.learningStyle)}</strong></div>
    </div>
    <div class="panel-head"><h2>Course Description</h2></div>
    <p class="curric-desc">${esc(c.description)}</p>
  </section>`;

  const publishedCount = weeks.filter((w) => !w.pending).length;

  if (!isAdmin) {
    return `
  ${pageHeadHelp(esc(c.title), esc(c.tagline || 'Course syllabus'), {
    helpId: 'student-curriculum',
    helpTitle: 'How to use Curriculum',
    helpSteps: [
      'Click a week to expand objectives, assignment, discussion, and action plan.',
      'Weeks marked “coming soon” are not published yet — check back later.',
      'Open <strong>My Tests</strong> to answer and submit graded tests when they are live.',
    ],
  })}
  ${syllabusOverview}
  <div class="panel-head curric-weeks-head"><h2>Weekly Curriculum</h2>
    <span class="muted">Click a week to expand</span></div>
  <div class="curric-weeks">
    ${weeks.map((w) => weekBlock(w, Number(w.week) === Number(openWeek))).join('')}
  </div>
  <p class="curric-note muted">New weeks are released each week through the ${esc(String(parseInt(c.length, 10) || ''))}-week program.</p>`;
  }

  /* ---- Admin: view mode (with Edit + per-week Publish) or edit mode ---- */
  if (!curricEditing) {
    return `
  ${pageHeadHelp(esc(c.title), `${esc(c.tagline || '')} · ${publishedCount} of ${weeks.length} week${weeks.length === 1 ? '' : 's'} published`, {
    helpId: 'admin-curriculum',
    helpTitle: 'How to publish curriculum',
    helpSteps: [
      'Expand a week to review what students will see.',
      'Use <strong>Publish to students</strong> (or <strong>Publish entire week</strong>) when the week is ready.',
      'Click <strong>Edit</strong> to change titles, objectives, assignments, discussion, and action plan.',
      'Create graded tests under <strong>Tests</strong> so students can answer under My Tests.',
      'Unpublished weeks show as “coming soon” for students.',
    ],
    actions: `<button type="button" class="btn btn-primary" data-action="curric-edit">Edit</button>`,
  })}
  ${syllabusOverview}
  <div class="panel-head curric-weeks-head"><h2>Weekly Curriculum</h2>
    <span class="muted">Expand a week · use <strong>Publish to students</strong> when it’s ready</span></div>
  <div class="curric-weeks">
    ${weeks.map((w) => weekBlock(w, Number(w.week) === Number(openWeek), { admin: true })).join('')}
  </div>
  <p class="curric-note muted">Unpublished weeks show as “coming soon” for students. Publishing reveals the full week content immediately.</p>`;
  }

  return `
  ${pageHeadHelp('Edit Curriculum', 'Update content, then publish each week when ready.', {
    helpId: 'admin-curriculum-edit',
    helpTitle: 'Editing tips',
    helpSteps: [
      'Change the course overview fields, then click <strong>Save</strong>.',
      'Edit each week’s title, objectives, assignment, discussion, and action plan.',
      'Use <strong>Publish to students</strong> on a week when content is ready.',
      'Create graded tests under <strong>Tests</strong> (not here).',
      'Add or delete weeks only when restructuring the full program.',
    ],
    actions: `
      <button type="button" class="btn btn-outline" data-action="curric-cancel">Cancel</button>
      <button type="button" class="btn btn-primary" data-action="curric-save">Save</button>
      <button type="button" class="btn btn-outline" data-action="add-curric-week">+ Add week</button>`,
  })}

  <section class="panel curric-overview curric-edit-overview">
    <div class="panel-head"><h2>Course overview</h2>
      <span class="muted">Title, length, format &amp; description</span></div>
    <div class="curric-edit-grid">
      <label class="field curric-edit-grow"><span>Course title</span>
        <input type="text" value="${esc(c.title || '')}" data-action="curric-meta-title" /></label>
      <label class="field curric-edit-grow"><span>Tagline</span>
        <input type="text" value="${esc(c.tagline || '')}" data-action="curric-meta-tagline" /></label>
      <label class="field"><span>Course length</span>
        <input type="text" value="${esc(c.length || '')}" placeholder="12 Weeks" data-action="curric-meta-length" /></label>
      <label class="field"><span>Format</span>
        <input type="text" value="${esc(c.format || '')}" placeholder="Online Instructor-Led" data-action="curric-meta-format" /></label>
      <label class="field curric-edit-full"><span>Learning style</span>
        <textarea rows="2" data-action="curric-meta-style">${esc(c.learningStyle || '')}</textarea></label>
      <label class="field curric-edit-full"><span>Course description</span>
        <textarea rows="4" data-action="curric-meta-desc">${esc(c.description || '')}</textarea></label>
    </div>
    <div class="curric-edit-actions curric-overview-actions">
      <button type="button" class="btn btn-primary btn-sm" data-action="curric-save">Save</button>
    </div>
  </section>

  <div class="panel-head curric-weeks-head"><h2>Weekly curriculum</h2>
    <span class="muted">${weeks.length} week${weeks.length === 1 ? '' : 's'} · Publish, Save, or Delete each week</span></div>
  <div class="curric-weeks">
    ${
      weeks.length
        ? weeks.map((w) => weekEditor(w, Number(w.week) === Number(openWeek))).join('')
        : `<div class="empty"><div class="empty-ico">❖</div><h3>No weeks yet</h3>
            <p class="muted">Add your first week to build the syllabus.</p>
            <button type="button" class="btn btn-primary" data-action="add-curric-week">+ Add week</button></div>`
    }
  </div>`;
}

/* ===========================================================================
   CLASS MATERIALS (shared render helpers)
   ======================================================================== */
function materialMeta(kind) {
  return {
    pdf: { icon: '📄', label: 'PDF' },
    image: { icon: '🖼️', label: 'Image' },
    video: { icon: '🎬', label: 'Video' },
    link: { icon: '🔗', label: 'Link' },
  }[kind] || { icon: '📎', label: 'File' };
}

/** A student-facing material card with an inline viewer + open/download. */
function materialCard(m) {
  const src = store.materialSrc(m);
  const meta = materialMeta(m.kind);
  let viewer = '';
  if (src) {
    if (m.kind === 'image') viewer = `<img class="mat-img" src="${esc(src)}" alt="${esc(m.title)}" loading="lazy" />`;
    else if (m.kind === 'video') viewer = `<video class="mat-video" src="${esc(src)}" controls playsinline preload="metadata"></video>`;
    else if (m.kind === 'pdf') viewer = `<iframe class="mat-pdf" src="${esc(src)}" title="${esc(m.title)}" loading="lazy"></iframe>`;
  }
  const open = src
    ? `<a class="btn btn-light btn-sm" href="${esc(src)}" target="_blank" rel="noopener">${m.kind === 'link' ? 'Open link ↗' : 'Open ↗'}</a>`
    : '';
  const download = src && m.kind !== 'link'
    ? `<a class="btn btn-ghost btn-sm" href="${esc(src)}" download>⬇ Download</a>`
    : '';
  return `<div class="mat-card">
    <div class="mat-head">
      <span class="mat-ico" aria-hidden="true">${meta.icon}</span>
      <span class="mat-title"><strong>${esc(m.title)}</strong><small>${meta.label}</small></span>
      <span class="mat-actions">${open}${download}</span>
    </div>
    ${viewer ? `<div class="mat-viewer">${viewer}</div>` : ''}
  </div>`;
}

/** Admin panel: add link resources, upload files, and manage materials per session. */
function adminMaterialsPanel() {
  const sessions = store.getSessions();
  const materials = store.getAllMaterials();
  return `
  <section class="panel">
    <div class="panel-head"><h2>Class materials</h2>
      <span class="muted">${materials.length} item${materials.length === 1 ? '' : 's'} · what students view &amp; download</span></div>

    <form id="addMaterialForm" class="mat-add-form">
      <select name="sessionId" required>
        ${sessions.map((s) => `<option value="${s.id}">W${s.week} · ${esc(s.title)}</option>`).join('')}
      </select>
      <input name="title" placeholder="Title (e.g. Week 1 Worksheet)" required />
      <input name="url" type="url" placeholder="https://link-to-resource" required />
      <button type="submit" class="btn btn-primary btn-sm">＋ Add link</button>
    </form>

    <div class="mat-groups">
      ${sessions
        .map((s) => {
          const mats = materials.filter((m) => m.sessionId === s.id);
          return `<div class="mat-group">
          <div class="mat-group-head">
            <strong>W${s.week} · ${esc(s.title)}</strong>
            ${
              USE_SUPABASE
                ? `<label class="upload-btn sm">＋ Upload file
                     <input type="file" accept="application/pdf,image/*,video/*" data-action="material-file" data-session="${s.id}" hidden />
                   </label>`
                : ''
            }
          </div>
          ${
            mats.length
              ? `<div class="mat-admin-list">${mats
                  .map((m) => {
                    const meta = materialMeta(m.kind);
                    const src = store.materialSrc(m);
                    return `<div class="mat-admin-row">
                    <span class="mat-ico" aria-hidden="true">${meta.icon}</span>
                    <span class="mat-title"><strong>${esc(m.title)}</strong><small>${meta.label}</small></span>
                    <span class="mat-actions">
                      ${src ? `<a class="btn btn-ghost btn-sm" href="${esc(src)}" target="_blank" rel="noopener">Open ↗</a>` : ''}
                      <button class="row-del" data-action="delete-material" data-id="${esc(m.id)}" title="Delete material" aria-label="Delete ${esc(m.title)}">🗑</button>
                    </span>
                  </div>`;
                  })
                  .join('')}</div>`
              : `<p class="muted mat-empty">No materials yet.</p>`
          }
        </div>`;
        })
        .join('')}
    </div>

    <p class="hint">${
      USE_SUPABASE
        ? 'Add links to any resource, or upload PDFs, images, and videos — files are stored privately and streamed to logged-in students via secure, expiring links. This is your reusable, resell-ready content.'
        : 'Add link resources here (saved locally in demo mode). Connect Supabase to upload and privately host PDF, image, and video files.'
    }</p>
  </section>`;
}

/* ===========================================================================
   CLASS DISCUSSION (shared — students & admins)
   ======================================================================== */
/** Friendly, compact timestamp for a chat message. */
function fmtWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const diffSec = (now - d) / 1000;
  if (diffSec < 45) return 'just now';
  if (diffSec < 3600) return `${Math.max(1, Math.floor(diffSec / 60))}m ago`;
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** One message in the class feed (root or reply). */
function discussionMessage(p, user, { isReply = false, week = null } = {}) {
  const mine = p.authorId === user.id;
  const isInstructor = p.authorRole === 'admin';
  const canDelete = mine || user.role === 'admin';
  const author = { id: p.authorId || 'anon', name: p.authorName || 'Student' };
  // Reply always targets the thread root (one-level threads).
  const replyTargetId = isReply ? (p.parentId || p.id) : p.id;
  const wk = week != null ? week : p.week;
  return `<div class="disc-msg${mine ? ' is-mine' : ''}${isInstructor ? ' is-instructor' : ''}${isReply ? ' is-reply' : ''}" data-post-id="${esc(p.id)}">
    ${avatar(author, isReply ? 32 : 40)}
    <div class="disc-bubble">
      <div class="disc-meta">
        <strong>${esc(p.authorName || 'Student')}${mine ? ' (you)' : ''}</strong>
        ${isInstructor ? `<span class="disc-tag">Instructor</span>` : ''}
        <span class="disc-time">${esc(fmtWhen(p.createdAt))}</span>
        <span class="disc-actions">
          <button type="button" class="disc-reply-btn" data-action="reply-post" data-id="${esc(replyTargetId)}" data-week="${wk != null ? esc(String(wk)) : ''}" data-name="${esc(p.authorName || 'Student')}" title="Reply" aria-label="Reply to ${esc(p.authorName || 'Student')}">Reply</button>
          ${canDelete ? `<button type="button" class="disc-del" data-action="delete-post" data-id="${esc(p.id)}" title="Delete message" aria-label="Delete message">🗑</button>` : ''}
        </span>
      </div>
      <p class="disc-body">${esc(p.body).replace(/\n/g, '<br />')}</p>
    </div>
  </div>`;
}

/** Discussion live for students when admin published the prompt (not pending syllabus). */
function isDiscussionLive(w) {
  if (!w || !String(w.discussion || '').trim()) return false;
  if (w.pending) return false;
  return w.discussionPublished !== false;
}

/** Build thread HTML for a set of posts (roots + replies). */
function discussionFeedHtml(posts, user, weekNum) {
  const roots = posts.filter((p) => !p.parentId);
  const byParent = new Map();
  posts.forEach((p) => {
    if (!p.parentId) return;
    if (!byParent.has(p.parentId)) byParent.set(p.parentId, []);
    byParent.get(p.parentId).push(p);
  });
  if (!posts.length) {
    return `<div class="disc-empty disc-empty-sm">
        <div class="empty-ico">💬</div>
        <h3>No posts yet</h3>
        <p class="muted">Be the first to respond to this week’s prompt.</p>
      </div>`;
  }
  let feed = roots
    .map((root) => {
      const replies = (byParent.get(root.id) || []).sort(
        (a, b) => new Date(a.createdAt) - new Date(b.createdAt)
      );
      const replyBlock = replies.length
        ? `<div class="disc-replies" role="group" aria-label="Replies">${replies
            .map((r) => discussionMessage(r, user, { isReply: true, week: weekNum }))
            .join('')}</div>`
        : '';
      return `<div class="disc-thread">${discussionMessage(root, user, { week: weekNum })}${replyBlock}</div>`;
    })
    .join('');
  const rootIds = new Set(roots.map((r) => r.id));
  const orphans = posts.filter((p) => p.parentId && !rootIds.has(p.parentId));
  if (orphans.length) {
    feed += orphans
      .map((p) => `<div class="disc-thread">${discussionMessage(p, user, { week: weekNum })}</div>`)
      .join('');
  }
  return feed;
}

function discussionView(user) {
  const posts = store.getDiscussion();
  const weeks = [...(store.getCurriculum().weeks || [])].sort(
    (a, b) => Number(a.week) - Number(b.week)
  );
  const isAdmin = user?.role === 'admin';

  // Default open week: disc.openWeek, else first live week, else week 2, else first
  const liveWeeks = weeks.filter((w) => isDiscussionLive(w));
  const defaultOpen =
    disc.openWeek != null
      ? disc.openWeek
      : liveWeeks[0]?.week ??
        weeks.find((w) => Number(w.week) === 2)?.week ??
        weeks[0]?.week ??
        null;

  const postsForWeek = (weekNum) => {
    const n = Number(weekNum);
    return posts.filter((p) => {
      if (p.week != null && Number.isFinite(Number(p.week))) return Number(p.week) === n;
      // Legacy untagged posts: only show under first live week so nothing is lost
      if (p.week == null || p.week === '') {
        const firstLive = liveWeeks[0]?.week;
        return firstLive != null && Number(firstLive) === n;
      }
      return false;
    });
  };

  const replyTarget = disc.replyToId
    ? posts.find((p) => p.id === disc.replyToId) || { authorName: 'classmate', id: disc.replyToId }
    : null;

  const weekBlocks = weeks
    .map((w) => {
      const wk = Number(w.week);
      const live = isDiscussionLive(w);
      // Students only see published discussions
      if (!isAdmin && !live) return '';
      const open = Number(defaultOpen) === wk;
      const weekPosts = postsForWeek(wk);
      const promptText = String(w.discussion || '').trim();
      const pill = live
        ? `<span class="pill pill-done">● Live</span>`
        : `<span class="pill pill-todo">Offline</span>`;

      const adminEditor = isAdmin
        ? `<div class="disc-week-admin">
            <label class="field"><span>Discussion prompt <em class="muted">(students see this when Live)</em></span>
              <textarea class="disc-prompt-edit" rows="6" data-action="disc-week-prompt" data-week="${wk}"
                placeholder="Write the discussion question for Week ${wk}…">${esc(promptText)}</textarea>
            </label>
            <div class="disc-week-admin-actions">
              <button type="button" class="btn btn-primary btn-sm" data-action="save-disc-week" data-week="${wk}">Save prompt</button>
              <button type="button" class="btn btn-sm ${live ? 'btn-outline' : 'btn-primary'}"
                data-action="toggle-disc-publish" data-week="${wk}">
                ${live ? 'Unpublish from students' : 'Publish to students'}
              </button>
            </div>
          </div>`
        : promptText
          ? `<div class="disc-prompt disc-prompt-week">
              <span class="disc-prompt-label">Discussion prompt</span>
              <p class="disc-prompt-body">${esc(promptText).replace(/\n/g, '<br />')}</p>
            </div>`
          : `<p class="muted">No prompt yet for this week.</p>`;

      const canPost = isAdmin || live;
      const activeComposer = canPost && Number(disc.postWeek ?? defaultOpen) === wk;
      const replyBar =
        replyTarget && activeComposer
          ? `<div class="disc-reply-bar">
              <span>Replying to <strong>${esc(replyTarget.authorName || 'classmate')}</strong></span>
              <button type="button" class="link-btn" data-action="cancel-reply">Cancel</button>
            </div>`
          : '';

      const inputId = `discInput-${wk}`;
      const composer = canPost
        ? `${replyBar}
          <form class="disc-composer discForm" data-week="${wk}" data-form="disc">
            <input type="hidden" name="week" value="${wk}" />
            ${avatar(user, 38)}
            <textarea id="${inputId}" name="body" rows="2" maxlength="2000"
              placeholder="${
                replyTarget && activeComposer
                  ? `Reply to ${esc(replyTarget.authorName || 'classmate')}…`
                  : 'Write your response to this week’s prompt… (Enter to post)'
              }"
              data-action="disc-input" data-week="${wk}"
              aria-label="Discussion post for week ${wk}"></textarea>
            <button type="submit" class="btn btn-primary btn-sm">${
              replyTarget && activeComposer ? 'Reply' : 'Post'
            }</button>
          </form>`
        : `<p class="muted disc-offline-note">This discussion is offline. Your instructor will publish it when ready.</p>`;

      return `<details class="disc-week${live ? '' : ' disc-week-offline'}" data-week="${wk}"${open ? ' open' : ''}>
        <summary class="disc-week-sum">
          <span class="wk-num-badge">Week ${wk}</span>
          <span class="disc-week-title">${esc(w.title || `Week ${wk}`)}</span>
          ${pill}
          <span class="muted disc-week-count">${weekPosts.length} post${weekPosts.length === 1 ? '' : 's'}</span>
          <span class="wk-chev" aria-hidden="true">▾</span>
        </summary>
        <div class="disc-week-body">
          ${adminEditor}
          <div class="disc-feed disc-feed-week" data-week="${wk}" aria-live="polite">
            ${discussionFeedHtml(weekPosts, user, wk)}
          </div>
          ${composer}
        </div>
      </details>`;
    })
    .filter(Boolean)
    .join('');

  const emptyStudent =
    !isAdmin && !liveWeeks.length
      ? `<section class="panel"><div class="empty">
          <div class="empty-ico">💬</div>
          <h3>No discussions open yet</h3>
          <p class="muted">Your instructor publishes each week’s discussion when the class is ready.</p>
        </div></section>`
      : '';

  return `
  ${pageHeadHelp(
    'Class Discussion',
    isAdmin
      ? 'Edit prompts by week · publish when ready · moderate student posts'
      : 'Answer each week’s discussion prompt and reply to classmates.',
    {
      helpId: isAdmin ? 'admin-discussion' : 'student-discussion',
      helpTitle: isAdmin ? 'How to run discussion' : 'How to use Discussion',
      helpSteps: isAdmin
        ? [
            'Expand a week and edit the discussion prompt (Part 1 / Part 2, etc.).',
            'Click <strong>Save prompt</strong>, then <strong>Publish to students</strong> when ready.',
            'Students only see Live weeks. Reply or delete posts as needed.',
          ]
        : [
            'Open a week to read the discussion prompt.',
            'Write your response, then use <strong>Reply</strong> on classmates’ messages.',
            'Keep the tone respectful and supportive.',
          ],
    }
  )}

  ${emptyStudent || `<div class="disc-weeks" id="discFeed">${weekBlocks || '<p class="muted">No curriculum weeks yet. Add weeks under Curriculum first.</p>'}</div>`}
  <p class="muted disc-foot">Organized by week${USE_SUPABASE ? ' · updates live' : ''}. Please keep it respectful and supportive. 💛</p>`;
}

/* ===========================================================================
   STUDENT VIEWS
   ======================================================================== */
/** Class Sessions are locked for students (admins keep full access). */
const sessionsLocked = (user) => SESSIONS_LOCKED && !!user && user.role !== 'admin';
const SESSIONS_LOCK_NOTE = `
  <section class="panel"><div class="empty">
    <div class="empty-ico">🔒</div>
    <h3>Class sessions are coming soon</h3>
    <p class="muted">Your recorded sessions will unlock here shortly. In the meantime, head to <strong>My Tests</strong> to complete this week’s work.</p>
  </div></section>`;

function studentNav(user) {
  return [
    { route: 'student-home', label: 'Dashboard', icon: '▥' },
    { route: 'curriculum', label: 'Curriculum', icon: '❖' },
    {
      route: 'student-sessions',
      label: 'Class Sessions',
      icon: '▶',
      disabled: SESSIONS_LOCKED,
      disabledTitle: 'Class sessions are locked for now — use Curriculum and My Tests',
    },
    { route: 'student-tests', label: 'My Tests', icon: '✓' },
    { route: 'discussion', label: 'Discussion', icon: '💬' },
    { route: 'account', label: 'Account', icon: '⚙' },
  ];
}

function studentHome(user) {
  const s = store.getStudentStats(user.id);
  const prog = store.getProgress(user.id);
  const sessions = store.getVisibleSessions();
  const next = sessions.find((x) => !prog.completed.includes(x.id));
  const avg = s.avgScore == null ? '—' : `${s.avgScore}%`;

  return `
  ${pageHeadHelp(
    `Welcome back, ${esc(user.name.split(' ')[0])}`,
    `The Entrepreneur’s Journey — Funding Masterclass · ${esc(user.cohort || '')}`,
    {
      helpId: 'student-home',
      helpTitle: 'How to use your portal',
      helpSteps: [
        'Open <strong>Curriculum</strong> for this week’s objectives, assignment, and discussion prompt.',
        'Open <strong>My Tests</strong> to complete work your instructor has published.',
        'Use <strong>Discussion</strong> to post answers and reply to classmates.',
        'Questions or document uploads? Email <a href="mailto:admin@umof.org">admin@umof.org</a>.',
      ],
    }
  )}

  ${helpCallout({
    id: 'student-quickstart',
    dismissKey: 'student-quickstart',
    title: 'Student quick start',
    steps: [
      'Start with <strong>Curriculum</strong> — expand the current week to see what to study.',
      'Then open <strong>My Tests</strong> for any live quizzes or written work.',
      'Class Sessions may stay locked until your instructor releases recordings.',
    ],
  })}

  <section class="panel student-contact-note" role="note">
    <p>For curriculum or grading questions, or to submit business documents, please email
      <a href="mailto:admin@umof.org">admin@umof.org</a>.</p>
  </section>

  <div class="stat-grid">
    ${
      sessionsLocked(user)
        ? `${statCard('Average test score', avg)}
    ${statCard('Results pending', s.pendingGrading)}
    ${statCard('Tests taken', s.quizzesTaken)}
    ${statCard('Next step', 'Curriculum', `<button class="link-arrow" data-action="go" data-route="curriculum">Open syllabus →</button>`)}`
        : `${statCard('Sessions completed', `${s.completed}/${s.totalSessions}`)}
    ${statCard('Average test score', avg)}
    ${statCard('Results pending', s.pendingGrading)}
    ${statCard('Tests taken', s.quizzesTaken)}`
    }
  </div>

  ${
    sessionsLocked(user)
      ? SESSIONS_LOCK_NOTE
      : sessions.length === 0
        ? `<section class="panel"><div class="empty">
            <div class="empty-ico">▶</div>
            <h3>No sessions published yet</h3>
            <p class="muted">Your instructor will release class sessions here week by week.</p>
          </div></section>`
      : `${
          next
            ? `<section class="panel">
          <div class="panel-head"><h2>Continue learning</h2></div>
          <div class="continue" data-action="go" data-route="session" data-id="${next.id}">
            <img src="${esc(next.thumb)}" alt="" />
            <div>
              <span class="eyebrow">Week ${next.week} · ${next.durationMin} min</span>
              <h3>${esc(next.title)}</h3>
              <p class="muted">${esc(next.summary)}</p>
              <span class="link-arrow">Watch session →</span>
            </div>
          </div>
        </section>`
            : `<section class="panel"><div class="panel-head"><h2>🎉 You’ve completed every published session</h2></div>
         <p class="muted">New sessions are released weekly through the 12-week program.</p></section>`
        }

  ${
    sessionsLocked(user)
      ? ''
      : `<section class="panel">
    <div class="panel-head"><h2>Published class sessions</h2>
      <button class="btn btn-ghost btn-sm" data-action="go" data-route="student-sessions">View all →</button></div>
    <div class="session-list">
      ${sessions
        .map((x) => {
          const done = prog.completed.includes(x.id);
          return `<button class="session-row" data-action="go" data-route="session" data-id="${x.id}">
            <span class="sr-week">W${x.week}</span>
            <span class="sr-main"><strong>${esc(x.title)}</strong><small>${fmtDate(x.date)} · ${x.durationMin} min</small></span>
            <span class="pill ${done ? 'pill-done' : 'pill-todo'}">${done ? 'Completed' : 'Not started'}</span>
          </button>`;
        })
        .join('')}
    </div>
  </section>`
  }`
  }`;
}

function studentSessions(user) {
  if (sessionsLocked(user)) {
    return `<div class="page-head"><h1>Class Sessions</h1></div>${SESSIONS_LOCK_NOTE}`;
  }
  const prog = store.getProgress(user.id);
  const sessions = store.getVisibleSessions();
  return `
  <div class="page-head"><h1>Class Sessions</h1>
    <p class="muted">Watch recordings and review the notes for each published week.</p></div>
  ${
    sessions.length
      ? `<div class="card-grid">
    ${sessions
      .map((x) => {
        const done = prog.completed.includes(x.id);
        return `<button class="vcard" data-action="go" data-route="session" data-id="${x.id}">
          <div class="vcard-thumb"><img src="${esc(x.thumb)}" alt="" />
            <span class="vcard-play">▶</span>
            ${done ? `<span class="vcard-done">✓ Completed</span>` : ''}
          </div>
          <div class="vcard-body">
            <span class="eyebrow">Week ${x.week} · ${x.durationMin} min</span>
            <h3>${esc(x.title)}</h3>
            <p class="muted">${esc(x.summary)}</p>
          </div>
        </button>`;
      })
      .join('')}
  </div>`
      : `<section class="panel"><div class="empty">
          <div class="empty-ico">▶</div>
          <h3>No sessions published yet</h3>
          <p class="muted">Your instructor will release class sessions here when each week goes live.</p>
        </div></section>`
  }`;
}

function sessionDetail(user) {
  if (sessionsLocked(user)) {
    return `<button class="back-link" data-action="go" data-route="student-home">← Back</button>
    <div class="page-head"><h1>Class Sessions</h1></div>${SESSIONS_LOCK_NOTE}`;
  }
  const sx = store.getSessionById(route.params.id);
  if (!sx) return `<p>Session not found.</p>`;
  // Students cannot open unpublished sessions (admins can for preview).
  if (user.role !== 'admin' && sx.published === false) {
    return `<button class="back-link" data-action="go" data-route="student-sessions">← All sessions</button>
    <div class="page-head"><h1>${esc(sx.title)}</h1></div>
    <section class="panel"><p class="muted">This session isn’t published yet. Your instructor will release it when the class is ready.</p></section>`;
  }
  const prog = store.getProgress(user.id);
  const done = prog.completed.includes(sx.id);
  const quizzes = store.getVisibleQuizzesForSession(sx.id);
  const materials = store.getMaterialsForSession(sx.id);

  return `
  <button class="back-link" data-action="go" data-route="student-sessions">← All sessions</button>
  <div class="page-head"><div>
    <span class="eyebrow">Week ${sx.week} · ${fmtDate(sx.date)} · ${sx.durationMin} min</span>
    <h1>${esc(sx.title)}</h1>
  </div></div>

  ${
    sx.meetUrl
      ? `<section class="panel live-card">
          <div class="live-card-main">
            <span class="live-badge" aria-hidden="true">●</span>
            <div>
              <h2>Live class on Google Meet</h2>
              <p class="muted">${sx.liveAt ? `Scheduled for ${esc(fmtDateTime(sx.liveAt))}` : 'Opens in a new tab'} · joins in a separate tab</p>
            </div>
          </div>
          <a class="btn btn-primary" href="${esc(sx.meetUrl)}" target="_blank" rel="noopener">Join Live Class ↗</a>
        </section>`
      : ''
  }

  <div class="video-frame">
    ${
      sx.isFile
        ? sx.playUrl
          ? `<video class="video-el" src="${esc(sx.playUrl)}" controls playsinline preload="metadata"></video>`
          : `<div class="video-missing">Video is being prepared — reload in a moment.</div>`
        : `<iframe src="${esc(sx.videoUrl)}" title="${esc(sx.title)}" allow="accelerated-encoder; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe>`
    }
  </div>

  <div class="detail-actions">
    <button class="btn ${done ? 'btn-outline' : 'btn-primary'}" data-action="toggle-complete" data-id="${sx.id}">
      ${done ? '✓ Completed — mark as not done' : 'Mark this session complete'}
    </button>
    ${quizzes
      .map((q) => {
        const sub = prog.submissions?.[q.id];
        const label = sub
          ? sub.status === 'graded'
            ? `View result${q.type === 'auto' ? ` (${sub.score}%)` : ''}`
            : 'View submission'
          : `Take the ${q.type === 'auto' ? 'quiz' : isWritten(q) ? 'test' : 'assignment'}`;
        return `<button class="btn btn-light" data-action="go" data-route="quiz" data-id="${q.id}">${esc(label)}</button>`;
      })
      .join('')}
  </div>

  <section class="panel">
    <div class="panel-head"><h2>Session notes</h2></div>
    <p class="muted">${esc(sx.summary)}</p>
    <ul class="notes-list">
      ${sx.notes.map((n) => `<li>${esc(n)}</li>`).join('')}
    </ul>
  </section>

  <section class="panel">
    <div class="panel-head"><h2>Class materials</h2></div>
    ${
      materials.length
        ? `<div class="mat-list">${materials.map((m) => materialCard(m)).join('')}</div>`
        : `<p class="muted">No materials have been posted for this session yet.</p>`
    }
  </section>`;
}

/**
 * Multi-question bank (free-response and/or A–D MC).
 * Includes type "auto" (auto-scored MC) so Week 2 MC tests open the same
 * robust form path instead of the legacy quizForm (which crashed when options
 * were missing or after MC repairs).
 */
const isMultiQuestionTest = (q) => {
  if (!q) return false;
  const qs = Array.isArray(q.questions) ? q.questions : [];
  return qs.length > 0 && (q.type === 'manual' || q.type === 'auto');
};

/** Pure free-response (no A/B/C/D options on any item). */
const isWritten = (q) => {
  if (!q || q.type !== 'manual') return false;
  const qs = Array.isArray(q.questions) ? q.questions : [];
  if (!qs.length) return false;
  return qs.every((qq) => !Array.isArray(qq.options) || qq.options.length < 2);
};

const hasMcOptions = (qq) => Array.isArray(qq?.options) && qq.options.length >= 2;

/** Format student answer for review (letters for MC). */
function displayAnswer(qq, raw) {
  return esc(store.formatQuestionAnswer(qq, raw));
}

function quizView(user) {
  const q = store.getQuizById(route.params.id);
  if (!q) return `<p>Test not found.</p>`;
  // Students can't open a test until an admin has set it live.
  if (!q.published && user.role !== 'admin') {
    return `<div class="page-head"><h1>${esc(q.title)}</h1></div>
    <section class="panel"><p class="muted">This test isn’t open yet. Your instructor will make it available when the class is ready.</p></section>`;
  }
  const multiQ = isMultiQuestionTest(q);
  const written = isWritten(q);
  // Only this student's own *valid* submission (stale/empty rows → blank form)
  const sub = store.getStudentSubmission(user.id, q.id);
  const sx = store.getSessionById(q.sessionId);
  const mcCount = (q.questions || []).filter(hasMcOptions).length;
  const kind =
    q.type === 'auto' || (multiQ && mcCount === (q.questions || []).length && mcCount > 0)
      ? mcCount
        ? 'Multiple choice'
        : 'Quiz'
      : multiQ
        ? mcCount
          ? 'Mixed test'
          : 'Test'
        : 'Assignment';
  const back =
    user.role === 'admin'
      ? `<button class="back-link" data-action="go" data-route="admin-tests">← Tests</button>`
      : sx
        ? `<button class="back-link" data-action="go" data-route="session" data-id="${q.sessionId}">← ${esc(sx.title)}</button>
           <button class="back-link" data-action="go" data-route="student-tests" style="margin-left:8px">My Tests</button>`
        : `<button class="back-link" data-action="go" data-route="student-tests">← My Tests</button>`;
  const head = `
    ${back}
    <div class="page-head"><div><span class="eyebrow">${kind}${q.due ? ` · Due ${fmtDate(q.due)}` : ''}</span><h1>${esc(q.title)}</h1></div></div>`;

  /* ---- multi-question test (manual free-response/MC + auto-scored MC) ---- */
  if (multiQ) {
    const questions = q.questions || [];
    if (!questions.length) {
      return `${head}
      <section class="panel"><p class="muted">This test has no questions yet. Check back after your instructor finishes it.</p></section>`;
    }
    const qaBlock = (answers, title = 'Your answers') => `
      <section class="panel"><div class="panel-head"><h2>${esc(title)}</h2>
        <span class="muted">${questions.length} question${questions.length === 1 ? '' : 's'}</span></div>
        ${questions
          .map((qq, i) => {
            const raw = answers && answers[qq.id];
            if (hasMcOptions(qq)) {
              const chosen =
                typeof raw === 'number'
                  ? raw
                  : Number.isFinite(Number(raw))
                    ? Number(raw)
                    : store.letterToIndex(raw, qq.options.length);
              return `<div class="review-q">
              <p class="rq-prompt">${i + 1}. ${esc(qq.prompt)}</p>
              ${qq.options
                .map((opt, oi) => {
                  const letter = store.indexToLetter(oi);
                  const isChosen = oi === chosen;
                  return `<div class="opt ${isChosen ? 'opt-correct' : ''}">${letter}. ${esc(opt)}${
                    isChosen ? ' ← your answer' : ''
                  }</div>`;
                })
                .join('')}
            </div>`;
            }
            return `<div class="review-q">
              <p class="rq-prompt">${i + 1}. ${esc(qq.prompt)}</p>
              <p class="answer-box">${displayAnswer(qq, raw)}</p>
            </div>`;
          })
          .join('')}
      </section>`;

    // Graded: score + the same answers the instructor sees in Grading
    if (sub && sub.status === 'graded') {
      return `${head}
      <section class="panel result-panel">
        <div class="big-score ${sub.score >= 70 ? 'pass' : 'fail'}">${sub.score}<small>/${q.maxScore || 100}</small></div>
        <p>Graded ${fmtDate(sub.gradedAt)}</p>
        ${sub.feedback ? `<div class="feedback"><strong>Instructor feedback</strong><p>${esc(sub.feedback)}</p></div>` : ''}
      </section>
      ${qaBlock(sub.answers, 'Your submitted answers')}`;
    }

    // Submitted, awaiting grade: show the student's own answers (same data as admin Grading)
    if (sub && sub.status === 'submitted') {
      return `${head}
      <section class="panel">
        <div class="pending-banner">⏳ Submitted ${fmtDateTime(sub.submittedAt) || fmtDate(sub.submittedAt)} — your instructor has your answers for grading.</div>
        <p class="muted" style="margin:0.75rem 0 0">These are the answers on file. Contact your instructor if you need a reset to edit them.</p>
      </section>
      ${qaBlock(sub.answers, 'Your submitted answers')}`;
    }

    // Not started: form with radios for MC, textareas for free-response
    const formHint = mcCount
      ? written
        ? 'Answer each question below, then submit for grading.'
        : 'Select A, B, C, or D for multiple-choice items. Write short answers where asked. Submit when finished.'
      : 'Answer each question below, then submit for grading. Your answers will appear here after you submit.';
    return `${head}
    <form id="writtenForm" data-quiz="${esc(q.id)}" class="panel quiz-form" autocomplete="off">
      <p class="muted">${formHint}</p>
      ${questions
        .map((qq, i) => {
          const fieldId = esc(qq.id);
          if (hasMcOptions(qq)) {
            return `<fieldset class="quiz-q quiz-q-mc">
        <legend class="quiz-q-prompt">${i + 1}. ${esc(qq.prompt)}</legend>
        <div class="mc-options" role="radiogroup" aria-label="Question ${i + 1}">
          ${qq.options
            .map((opt, oi) => {
              const letter = store.indexToLetter(oi);
              const rid = `${fieldId}-${oi}`;
              return `<label class="opt-choice mc-choice" for="${rid}">
              <input type="radio" id="${rid}" name="${fieldId}" value="${oi}" required />
              <span><strong class="mc-letter">${letter}.</strong> ${esc(opt)}</span>
            </label>`;
            })
            .join('')}
        </div>
      </fieldset>`;
          }
          return `<fieldset class="quiz-q">
        <legend class="quiz-q-prompt">${i + 1}. ${esc(qq.prompt)}</legend>
        <label class="quiz-answer-label" for="ans-${fieldId}">Your answer</label>
        <textarea id="ans-${fieldId}" name="${fieldId}" class="quiz-answer" rows="5"
          placeholder="Type your answer here…" required autocomplete="off" spellcheck="true"
          ></textarea>
      </fieldset>`;
        })
        .join('')}
      <button type="submit" class="btn btn-primary">Submit for review</button>
    </form>`;
  }

  /* ---- legacy auto quiz fallback (no questions array / edge cases) ---- */
  if (q.type === 'auto' && sub) {
    const qs = Array.isArray(q.questions) ? q.questions : [];
    return `${head}
    <section class="panel result-panel">
      <div class="big-score ${sub.score >= 70 ? 'pass' : 'fail'}">${sub.score}%</div>
      <p>You answered <strong>${sub.correct ?? '—'} of ${sub.total ?? qs.length}</strong> correctly · submitted ${fmtDate(sub.submittedAt)}.</p>
    </section>
    <section class="panel">
      <div class="panel-head"><h2>Review</h2></div>
      ${qs
        .map((qq, i) => {
          const chosen = sub.answers ? sub.answers[qq.id] : undefined;
          const opts = Array.isArray(qq.options) ? qq.options : [];
          return `<div class="review-q">
            <p class="rq-prompt">${i + 1}. ${esc(qq.prompt)}</p>
            ${
              opts.length
                ? opts
                    .map((opt, oi) => {
                      const isCorrect = oi === qq.correctIndex;
                      const isChosen = oi === chosen || Number(chosen) === oi;
                      const cls = isCorrect ? 'opt-correct' : isChosen ? 'opt-wrong' : '';
                      const tag = isCorrect ? ' ✓' : isChosen ? ' ✗ your answer' : '';
                      return `<div class="opt ${cls}">${store.indexToLetter(oi)}. ${esc(opt)}${tag}</div>`;
                    })
                    .join('')
                : `<p class="answer-box">${esc(store.formatQuestionAnswer(qq, chosen))}</p>`
            }
          </div>`;
        })
        .join('')}
    </section>`;
  }

  /* ---- legacy auto quiz form fallback ---- */
  if (q.type === 'auto') {
    const qs = Array.isArray(q.questions) ? q.questions : [];
    if (!qs.length) {
      return `${head}<section class="panel"><p class="muted">This quiz has no questions yet.</p></section>`;
    }
    return `${head}
    <form id="quizForm" data-quiz="${esc(q.id)}" class="panel quiz-form">
      ${qs
        .map((qq, i) => {
          const opts = Array.isArray(qq.options) ? qq.options : [];
          const fieldId = esc(qq.id);
          if (!opts.length) {
            return `<fieldset class="quiz-q">
        <legend>${i + 1}. ${esc(qq.prompt)}</legend>
        <p class="muted">No choices configured for this item.</p>
      </fieldset>`;
          }
          return `<fieldset class="quiz-q quiz-q-mc">
        <legend class="quiz-q-prompt">${i + 1}. ${esc(qq.prompt)}</legend>
        <div class="mc-options" role="radiogroup" aria-label="Question ${i + 1}">
          ${opts
            .map((opt, oi) => {
              const letter = store.indexToLetter(oi);
              const rid = `${fieldId}-${oi}`;
              return `<label class="opt-choice mc-choice" for="${rid}">
              <input type="radio" id="${rid}" name="${fieldId}" value="${oi}" required />
              <span><strong class="mc-letter">${letter}.</strong> ${esc(opt)}</span>
            </label>`;
            })
            .join('')}
        </div>
      </fieldset>`;
        })
        .join('')}
      <button type="submit" class="btn btn-primary">Submit quiz</button>
    </form>`;
  }

  /* ---- manual assignment ---- */
  if (sub && sub.status === 'graded') {
    return `${head}
    <section class="panel result-panel">
      <div class="big-score ${sub.score >= 70 ? 'pass' : 'fail'}">${sub.score}<small>/100</small></div>
      <p>Graded ${fmtDate(sub.gradedAt)}</p>
      ${sub.feedback ? `<div class="feedback"><strong>Instructor feedback</strong><p>${esc(sub.feedback)}</p></div>` : ''}
    </section>
    <section class="panel"><div class="panel-head"><h2>Your submission</h2></div><p class="answer-box">${esc(sub.answer)}</p></section>`;
  }
  if (sub && sub.status === 'submitted') {
    return `${head}
    <section class="panel">
      <div class="pending-banner">⏳ Submitted ${fmtDateTime(sub.submittedAt) || fmtDate(sub.submittedAt)} — saved for your instructor.</div>
      <div class="panel-head"><h2>Your submission</h2></div><p class="answer-box">${esc(sub.answer)}</p>
    </section>`;
  }
  const draftM = loadQuizDraft(user.id, q.id);
  return `${head}
  <form id="manualForm" data-quiz="${q.id}" class="panel" data-draft="1">
    <p class="muted">${esc(q.prompt)}</p>
    ${draftM ? `<p class="draft-hint" id="draftHint">Draft saved on this device · not submitted yet</p>` : `<p class="draft-hint muted" id="draftHint" hidden></p>`}
    <label class="field"><span>Your response</span>
      <textarea name="answer" rows="9" placeholder="Write your response here…" required data-action="quiz-draft">${esc(draftM?.answer || '')}</textarea>
    </label>
    <button type="submit" class="btn btn-primary">Submit for review</button>
  </form>`;
}

function studentTests(user) {
  const quizzes = store.getVisibleQuizzes();
  if (!quizzes.length) {
    return `
    ${pageHeadHelp('My Tests', 'Published tests you complete and turn in for grading.', {
      helpId: 'student-tests',
      helpTitle: 'How My Tests works',
      helpSteps: [
        'Only tests your instructor has published appear here.',
        'Open a test, write your answers, then submit.',
        'After you submit, open the test again to see your answers; scores show once graded.',
      ],
    })}
    <section class="panel"><div class="empty"><div class="empty-ico">📝</div><h3>No tests open yet</h3>
      <p class="muted">Your instructor publishes each test when the class is ready. Check back soon.</p></div></section>`;
  }
  const rows = quizzes.map((q) => {
    const sub = store.getStudentSubmission(user.id, q.id);
    const written = isWritten(q);
    const status =
      sub?.status === 'graded'
        ? '<span class="pill pill-done">Graded</span>'
        : sub?.status === 'submitted'
          ? '<span class="pill pill-pending">Submitted — awaiting grade</span>'
          : '<span class="pill pill-todo">Open — not started</span>';
    const score =
      sub?.status === 'graded' && sub.score != null
        ? q.type === 'auto'
          ? `${sub.score}%`
          : `${sub.score}/${q.maxScore || 100}`
        : '—';
    const type = q.type === 'auto' ? 'Quiz' : written ? 'Test' : 'Assignment';
    const cta =
      sub?.status === 'graded'
        ? 'View results'
        : sub?.status === 'submitted'
          ? 'View your answers'
          : written
            ? 'Answer questions'
            : 'Start';
    return { q, sub, status, score, type, cta };
  });

  return `
  ${pageHeadHelp('My Tests', 'Published tests you complete and turn in for grading.', {
    helpId: 'student-tests',
    helpTitle: 'How My Tests works',
    helpSteps: [
      'Only tests marked Live by your instructor appear here.',
      'Open a test, answer the questions, and submit for grading.',
      'After you submit, open the test again to <strong>see your answers</strong> (the same ones your instructor grades).',
      'When graded, your score and feedback show here too.',
    ],
  })}
  <section class="panel mobile-cards-only">
    <div class="mobile-card-list">
      ${rows
        .map(
          ({ q, status, score, type, cta }) => `<article class="mobile-card">
        <div class="mc-top"><strong>${esc(q.title)}</strong>${status}</div>
        <div class="mc-meta"><span>${esc(type)}</span><span>Due ${fmtDate(q.due)}</span><span>Score ${score}</span></div>
        <button class="btn btn-primary btn-sm" data-action="go" data-route="quiz" data-id="${q.id}">${cta} →</button>
      </article>`
        )
        .join('')}
    </div>
  </section>
  <section class="panel no-pad desktop-table-only">
    <div class="table-scroll">
    <table class="data-table">
      <thead><tr><th>Test</th><th>Type</th><th>Due</th><th>Status</th><th>Score</th><th></th></tr></thead>
      <tbody>
        ${rows
          .map(
            ({ q, status, score, type, cta }) => `<tr>
              <td><strong>${esc(q.title)}</strong></td>
              <td>${esc(type)}</td>
              <td>${fmtDate(q.due)}</td>
              <td>${status}</td>
              <td>${score}</td>
              <td><button class="btn btn-ghost btn-sm" data-action="go" data-route="quiz" data-id="${q.id}">${cta} →</button></td>
            </tr>`
          )
          .join('')}
      </tbody>
    </table>
    </div>
  </section>`;
}

/* ===========================================================================
   ADMIN VIEWS
   ======================================================================== */
function adminNav() {
  const pending = store.getGradingQueue().length;
  return [
    { route: 'admin-home', label: 'Dashboard', icon: '▥' },
    { route: 'curriculum', label: 'Curriculum', icon: '❖' },
    { route: 'admin-content', label: 'Sessions', icon: '▶' },
    {
      route: 'admin-tests',
      label: 'Tests',
      icon: '✓',
      routes: ['admin-tests'],
    },
    {
      route: 'admin-grading',
      label: 'Grading',
      icon: '✎',
      badge: pending || '',
      routes: ['admin-grading', 'grade'],
    },
    { route: 'discussion', label: 'Discussion', icon: '💬' },
    {
      type: 'group',
      id: 'more-tools',
      label: 'More tools',
      icon: '⋯',
      children: [
        {
          route: 'admin-students',
          label: 'Students',
          icon: '👥',
          routes: ['admin-students', 'admin-student'],
        },
        { route: 'admin-crm', label: 'CRM', icon: '☎' },
        { route: 'admin-access', label: 'Access', icon: '🔑' },
      ],
    },
    { route: 'account', label: 'Account', icon: '⚙' },
  ];
}

function adminHome() {
  const students = store.getStudents();
  const queue = store.getGradingQueue();
  const leads = store.getLeads();
  const activeLeads = leads.filter((l) => l.status !== 'lost' && l.status !== 'enrolled').length;
  const scoredAvgs = students
    .map((s) => store.getStudentStats(s.id).avgScore)
    .filter((n) => n != null);
  const avgScoreLabel = scoredAvgs.length
    ? `${Math.round(scoredAvgs.reduce((a, b) => a + b, 0) / scoredAvgs.length)}%`
    : '—';

  return `
  ${pageHeadHelp('Instructor Dashboard', 'Weekly teaching overview · Summer 2026 cohort', {
    helpId: 'admin-home',
    helpTitle: 'How to run the class each week',
    helpSteps: [
      'Update <strong>Curriculum</strong> for the week, then publish it to students.',
      'In <strong>Sessions</strong>, set each recording’s week number and use <strong>Publish Week</strong>.',
      'Create or edit the weekly test under <strong>Tests</strong>, then publish it for student <strong>My Tests</strong>.',
      'Grade submissions under <strong>Grading</strong> when students turn work in.',
      'Use <strong>More tools</strong> for Students roster, CRM leads, and Access (approved emails).',
    ],
    actions: `<button class="btn btn-outline btn-sm" data-action="refresh-progress" title="Reload student submissions from the server">↻ Refresh</button>`,
  })}

  ${helpCallout({
    id: 'admin-quickstart',
    dismissKey: 'admin-quickstart',
    title: 'Quick start for instructors',
    steps: [
      'Primary work lives in the left menu: <strong>Curriculum</strong>, <strong>Sessions</strong>, <strong>Tests</strong>, and <strong>Grading</strong>.',
      'Students only see what you publish (syllabus weeks, sessions, and live tests).',
      'Approve emails under <strong>More tools → Access</strong> before a new student can sign up.',
      'Need help mid-task? Click the <strong>How to</strong> button on any page.',
    ],
  })}

  <div class="quick-checklist" aria-label="This week checklist">
    <button type="button" class="quick-check-card" data-action="go" data-route="curriculum">
      <strong>1. Curriculum</strong>
      <span>Publish this week’s syllabus</span>
    </button>
    <button type="button" class="quick-check-card" data-action="go" data-route="admin-content">
      <strong>2. Sessions</strong>
      <span>Release recordings</span>
    </button>
    <button type="button" class="quick-check-card" data-action="go" data-route="admin-tests">
      <strong>3. Tests</strong>
      <span>Create &amp; publish My Tests</span>
    </button>
    <button type="button" class="quick-check-card" data-action="go" data-route="admin-grading">
      <strong>4. Grading</strong>
      <span>${queue.length ? `${queue.length} waiting` : 'All caught up'}</span>
    </button>
  </div>

  <div class="stat-grid">
    ${statCard('Enrolled students', students.length)}
    ${statCard('Awaiting grading', queue.length, queue.length ? `<button class="link-arrow" data-action="go" data-route="admin-grading">Grade now →</button>` : 'All caught up')}
    ${statCard('Active leads', activeLeads, `<button class="link-arrow" data-action="go" data-route="admin-crm">Open CRM →</button>`)}
    ${statCard('Avg. score', avgScoreLabel)}
  </div>

  <div class="two-col">
    <section class="panel">
      <div class="panel-head"><h2>Grading queue</h2>
        <div class="head-actions">
          <button class="btn btn-ghost btn-sm" data-action="refresh-progress">↻ Refresh</button>
          ${queue.length ? `<button class="btn btn-ghost btn-sm" data-action="go" data-route="admin-grading">View all →</button>` : ''}
        </div>
      </div>
      ${
        queue.length
          ? `<div class="mini-list">${queue
              .slice(0, 5)
              .map(
                (g) => `<button class="mini-row" data-action="go" data-route="grade" data-student="${g.student.id}" data-quiz="${g.quizId}">
            ${avatar(g.student, 32)}
            <span class="mr-main"><strong>${esc(g.student.name || g.student.email || 'Student')}</strong><small>${esc(g.quiz?.title || g.quizId)}</small></span>
            <span class="pill pill-pending">Submitted ${fmtDate(g.submission.submittedAt)}</span>
          </button>`
              )
              .join('')}</div>`
          : `<p class="muted">No submissions waiting. If a student just turned work in, click <strong>Refresh</strong>.</p>`
      }
    </section>

    <section class="panel">
      <div class="panel-head"><h2>Recent leads</h2><button class="btn btn-ghost btn-sm" data-action="go" data-route="admin-crm">Open CRM →</button></div>
      <div class="mini-list">
        ${leads
          .slice(0, 5)
          .map(
            (l) => `<div class="mini-row">
            <span class="mr-main"><strong>${esc(l.name)}</strong><small>${esc(l.source)} · ${fmtDate(l.createdAt)}</small></span>
            <span class="pill pill-${l.status}">${esc(l.status)}</span>
          </div>`
          )
          .join('')}
      </div>
    </section>
  </div>`;
}

function adminStudents() {
  const students = store.getStudents();
  return `
  ${pageHeadHelp('Students', `${students.length} enrolled · open a student for detail and grading`, {
    helpId: 'admin-students',
    helpTitle: 'How to use Students',
    helpSteps: [
      'Click a row to open that student’s progress, sessions, and test history.',
      'Use <strong>Refresh</strong> if a new submission is not showing yet.',
      'Export the roster with CSV / Word / PDF when you need a report.',
    ],
    actions: `
      <button class="btn btn-outline btn-sm" data-action="refresh-progress" title="Reload student submissions from the server">↻ Refresh</button>
      <button class="btn btn-outline btn-sm" data-action="export-students-csv">⬇ CSV</button>
      <button class="btn btn-outline btn-sm" data-action="export-students-word">⬇ Word</button>
      <button class="btn btn-outline btn-sm" data-action="export-students-pdf">⬇ PDF</button>`,
  })}
  <section class="panel no-pad">
    <div class="table-scroll">
    <table class="data-table">
      <thead><tr><th>Student</th><th>Plan</th><th>Sessions</th><th>Avg score</th><th>Pending</th><th></th></tr></thead>
      <tbody>
        ${students
          .map((s) => {
            const st = store.getStudentStats(s.id);
            return `<tr class="clickable" data-action="go" data-route="admin-student" data-id="${s.id}">
              <td><div class="cell-user">${avatar(s, 34)}<span><strong>${esc(s.name)}</strong><small>${esc(s.email)}</small></span></div></td>
              <td>${esc(s.plan)}</td>
              <td>${st.completed}/${st.totalSessions}</td>
              <td>${st.avgScore == null ? '—' : st.avgScore + '%'}</td>
              <td>${st.pendingGrading ? `<span class="pill pill-pending">${st.pendingGrading}</span>` : '—'}</td>
              <td class="chev">›</td>
            </tr>`;
          })
          .join('')}
      </tbody>
    </table>
    </div>
  </section>`;
}

function adminStudentDetail() {
  const s = store.getUserById(route.params.id);
  if (!s) return `<p>Student not found.</p>`;
  const st = store.getStudentStats(s.id);
  const prog = store.getProgress(s.id);
  const sessions = store.getSessions();
  const quizzes = store.getQuizzes();

  return `
  <button class="back-link" data-action="go" data-route="admin-students">← All students</button>
  <div class="page-head">
    <div class="cell-user big">${avatar(s, 56)}<div><h1>${esc(s.name)}</h1>
      <p class="muted">${esc(s.email)} · ${esc(s.phone)} · ${esc(s.plan)} · enrolled ${fmtDate(s.enrolled)}</p></div></div>
  </div>

  <div class="stat-grid">
    ${statCard('Sessions', `${st.completed}/${st.totalSessions}`)}
    ${statCard('Avg score', st.avgScore == null ? '—' : `${st.avgScore}%`)}
    ${statCard('Tests taken', st.quizzesTaken)}
    ${statCard('Pending grades', st.pendingGrading || 0)}
  </div>

  <div class="two-col">
    <section class="panel">
      <div class="panel-head"><h2>Session completion</h2></div>
      <div class="check-list">
        ${sessions
          .map((x) => {
            const done = prog.completed.includes(x.id);
            return `<button class="check-row check-row-btn" data-action="admin-toggle-complete" data-student="${s.id}" data-id="${x.id}" title="${done ? 'Click to mark incomplete' : 'Click to mark complete'}">
              <span class="${done ? 'check on' : 'check'}">${done ? '✓' : ''}</span>
              <span>W${x.week} · ${esc(x.title)}</span>
            </button>`;
          })
          .join('')}
      </div>
    </section>

    <section class="panel">
      <div class="panel-head"><h2>Tests &amp; assignments</h2>
        <button class="btn btn-ghost btn-sm" data-action="refresh-progress">↻ Refresh</button>
      </div>
      <table class="data-table compact">
        <thead><tr><th>Test</th><th>Status</th><th>Score</th><th></th></tr></thead>
        <tbody>
          ${(() => {
            const catalogIds = new Set(quizzes.map((q) => q.id));
            const rows = quizzes.map((q) => {
              const sub = store.getStudentSubmission(s.id, q.id);
              if (!sub) {
                return `<tr><td>${esc(q.title)}</td><td><span class="pill pill-todo">Not started</span></td><td>—</td>
                  <td></td></tr>`;
              }
              const status =
                sub.status === 'graded'
                  ? `<span class="pill pill-done">Graded</span>`
                  : `<span class="pill pill-pending">Needs grading</span>`;
              const score = sub.status === 'graded' ? `${sub.score}${q.type === 'manual' ? '/100' : '%'}` : '—';
              let action = '';
              if (sub.status === 'graded') {
                action = `<button class="btn btn-outline btn-sm" data-action="go" data-route="grade" data-student="${s.id}" data-quiz="${q.id}">Edit</button>`;
              } else if (sub.status === 'submitted') {
                action = `<button class="btn btn-primary btn-sm" data-action="go" data-route="grade" data-student="${s.id}" data-quiz="${q.id}">Grade →</button>`;
              }
              action += ` <button class="btn btn-ghost btn-sm" data-action="clear-submission" data-student="${s.id}" data-quiz="${q.id}" title="Clear so student gets a blank form">Reset</button>`;
              return `<tr><td><strong>${esc(q.title)}</strong></td><td>${status}</td><td>${score}</td><td>${action}</td></tr>`;
            });
            // Submissions whose quiz id is no longer in the catalog still need to show.
            for (const [quizId, sub] of Object.entries(prog.submissions || {})) {
              if (catalogIds.has(quizId)) continue;
              const status =
                sub.status === 'graded'
                  ? `<span class="pill pill-done">Graded</span>`
                  : `<span class="pill pill-pending">Needs grading</span>`;
              const score = sub.status === 'graded' ? `${sub.score}/100` : '—';
              const action =
                sub.status === 'graded'
                  ? `<button class="btn btn-outline btn-sm" data-action="go" data-route="grade" data-student="${s.id}" data-quiz="${quizId}">Edit</button>`
                  : sub.status === 'submitted'
                    ? `<button class="btn btn-primary btn-sm" data-action="go" data-route="grade" data-student="${s.id}" data-quiz="${quizId}">Grade →</button>`
                    : '';
              rows.push(
                `<tr><td><strong>${esc(quizId)}</strong> <span class="muted">(legacy)</span></td><td>${status}</td><td>${score}</td><td>${action}</td></tr>`
              );
            }
            return rows.join('');
          })()}
        </tbody>
      </table>
    </section>
  </div>`;
}

function adminGrading() {
  const queueAll = store.getGradingQueue();
  const gradedAll = store.getGradedSubmissions();
  const weekFilter = getGradeWeekFilter();

  const weekSet = new Set();
  for (const g of [...queueAll, ...gradedAll]) {
    const w = quizWeekNum(g.quiz);
    if (w) weekSet.add(w);
  }
  // Always offer Week 1–2 (live tests) even if empty
  weekSet.add(1);
  weekSet.add(2);
  const weeks = [...weekSet].sort((a, b) => a - b);

  const matchWeek = (g) => {
    if (weekFilter === 'all') return true;
    return quizWeekNum(g.quiz) === Number(weekFilter);
  };
  const queue = queueAll.filter(matchWeek);
  const graded = gradedAll.filter(matchWeek);

  const qCount = (g) => {
    const n = g.quiz?.questions?.length;
    return n ? `${n} Q` : '';
  };

  const filterBar = `<div class="grade-week-bar" role="tablist" aria-label="Filter by week">
    <button type="button" class="grade-week-chip${weekFilter === 'all' ? ' is-active' : ''}"
      data-action="set-grade-week" data-week="all" role="tab" aria-selected="${weekFilter === 'all'}">All weeks</button>
    ${weeks
      .map(
        (w) => {
          const qn = queueAll.filter((g) => quizWeekNum(g.quiz) === w).length;
          const gn = gradedAll.filter((g) => quizWeekNum(g.quiz) === w).length;
          const active = weekFilter === w;
          return `<button type="button" class="grade-week-chip${active ? ' is-active' : ''}"
            data-action="set-grade-week" data-week="${w}" role="tab" aria-selected="${active}">
            Week ${w}${qn || gn ? ` <span class="grade-week-count">${qn} open · ${gn} graded</span>` : ''}
          </button>`;
        }
      )
      .join('')}
  </div>`;

  const weekLabel = weekFilter === 'all' ? 'All weeks' : `Week ${weekFilter}`;

  // Discussion grades: one score line per student per week (not full test rubric)
  const discWeeks = weekFilter === 'all' ? weeks : [Number(weekFilter)];
  const students = store.getStudents();
  const discussionPanels = discWeeks
    .map((w) => {
      const rows = students
        .map((s) => {
          const posts = store.countDiscussionPostsForStudent(s.id, w);
          const grade = store.getDiscussionGrade(s.id, w);
          const scoreVal = grade?.score != null ? grade.score : '';
          return `<tr>
            <td><div class="cell-user">${avatar(s, 28)}<strong>${esc(s.name || s.email || 'Student')}</strong></div></td>
            <td class="muted">${posts}</td>
            <td>
              <form class="disc-grade-form" data-student="${esc(s.id)}" data-week="${w}">
                <div class="disc-grade-line">
                  <input type="number" name="score" class="disc-grade-score" min="0" max="100" step="1"
                    value="${scoreVal}" placeholder="—" aria-label="Discussion score for ${esc(s.name || 'student')}" />
                  <span class="muted disc-grade-max">/100</span>
                  <button type="submit" class="btn btn-primary btn-sm">Save</button>
                  ${
                    grade?.score != null
                      ? `<span class="pill pill-done" title="Saved ${fmtDate(grade.gradedAt)}">Saved ${grade.score}</span>`
                      : `<span class="muted disc-grade-empty">—</span>`
                  }
                </div>
              </form>
            </td>
          </tr>`;
        })
        .join('');
      return `<section class="panel disc-grade-panel">
        <div class="panel-head">
          <h2>Week ${w} · Discussion grades</h2>
          <span class="muted">One score per student (0–100) · posts from Discussion board</span>
        </div>
        <p class="muted disc-grade-lead">Enter a single participation score for each student. Count is top-level posts for this week (not replies).</p>
        ${
          students.length
            ? `<div class="table-scroll"><table class="data-table compact disc-grade-table">
            <thead><tr><th>Student</th><th>Posts</th><th>Score</th></tr></thead>
            <tbody>${rows}</tbody>
          </table></div>`
            : `<p class="muted">No students on the roster yet.</p>`
        }
      </section>`;
    })
    .join('');

  return `
  ${pageHeadHelp(
    'Grading',
    `${weekLabel}: ${queue.length} awaiting · ${graded.length} graded`,
    {
      helpId: 'admin-grading',
      helpTitle: 'How to grade',
      helpSteps: [
        'Filter by <strong>week</strong> so Week 1 and Week 2 tests stay separate.',
        'Use <strong>Discussion grades</strong> for a single participation score per student.',
        'Open a <strong>Grade →</strong> item in the queue for full tests.',
        'Enter a score (and optional feedback), then save to release to the student.',
        'Use <strong>Edit</strong> on graded items to update a score later.',
        'Click <strong>Refresh submissions</strong> if something just came in.',
      ],
      actions: `<button class="btn btn-outline btn-sm" data-action="refresh-progress" title="Reload student submissions from the server">↻ Refresh submissions</button>`,
    }
  )}
  <section class="panel compact-panel">
    <p class="muted" style="margin:0 0 0.75rem">
      Grade with the <strong>Grading Breakdown</strong> table (<strong>Criteria</strong> and <strong>Points</strong>).
      Filter by week to match each weekly test (Week 1 = 12 questions · Week 2 = 6 questions).
      Discussion posts use the <strong>single-line score</strong> tables below.
    </p>
    ${filterBar}
  </section>
  ${discussionPanels}
  <section class="panel">
    <div class="panel-head"><h2>${weekFilter === 'all' ? 'Awaiting review' : `Week ${weekFilter} — Awaiting review`}</h2></div>
    ${
      queue.length
        ? `<div class="mini-list">${queue
            .map(
              (g) => {
                const w = quizWeekNum(g.quiz);
                const qc = qCount(g);
                return `<button class="mini-row" data-action="go" data-route="grade" data-student="${g.student.id}" data-quiz="${g.quizId}">
          ${avatar(g.student, 36)}
          <span class="mr-main"><strong>${esc(g.student.name || g.student.email || 'Student')}</strong><small>${w ? `Week ${w} · ` : ''}${esc(g.quiz?.title || g.quizId)}${qc ? ` · ${qc}` : ''} · submitted ${fmtDate(g.submission.submittedAt)}</small></span>
          <span class="btn btn-primary btn-sm">Grade →</span>
        </button>`;
              }
            )
            .join('')}</div>`
        : `<div class="empty"><div class="empty-ico">✓</div><h3>${weekFilter === 'all' ? 'All caught up' : `No Week ${weekFilter} work waiting`}</h3><p class="muted">${
            weekFilter === 'all'
              ? 'There are no submissions waiting to be graded. Ask the student to re-submit if they still see “Submitted” on their side, then hit Refresh.'
              : `No submissions for Week ${weekFilter} right now. Switch to another week or hit Refresh.`
          }</p></div>`
    }
  </section>
  <section class="panel">
    <div class="panel-head"><h2>${weekFilter === 'all' ? 'Graded scores' : `Week ${weekFilter} — Graded scores`}</h2>
      <span class="muted">Edit score, feedback, or Grading Breakdown anytime</span></div>
    ${
      graded.length
        ? `<div class="table-scroll"><table class="data-table compact">
        <thead><tr><th>Student</th><th>Week</th><th>Test</th><th>Qs</th><th>Score</th><th>Graded</th><th>Edit</th></tr></thead>
        <tbody>
          ${graded
            .map((g) => {
              const unit = (g.quiz?.type || 'manual') === 'manual' ? '/100' : '%';
              const w = quizWeekNum(g.quiz);
              const qc = g.quiz?.questions?.length || '—';
              return `<tr>
              <td><div class="cell-user">${avatar(g.student, 28)}<strong>${esc(g.student.name || g.student.email || 'Student')}</strong></div></td>
              <td class="muted">${w != null ? w : '—'}</td>
              <td>${esc(g.quiz?.title || g.quizId)}</td>
              <td class="muted">${qc}</td>
              <td><strong>${g.submission.score}${unit}</strong></td>
              <td class="muted">${fmtDate(g.submission.gradedAt || g.submission.submittedAt)}</td>
              <td><button class="btn btn-outline btn-sm" data-action="go" data-route="grade" data-student="${g.student.id}" data-quiz="${g.quizId}">Edit</button></td>
            </tr>`;
            })
            .join('')}
        </tbody>
      </table></div>`
        : `<p class="muted">${
            weekFilter === 'all'
              ? 'No graded submissions yet. Scores appear here after you grade a test — use Edit anytime to update them.'
              : `No graded scores for Week ${weekFilter} yet.`
          }</p>`
    }
  </section>`;
}

function gradeView() {
  const { student: studentId, quiz: quizId } = route.params;
  const student = store.getUserById(studentId) || {
    id: studentId,
    name: 'Student (profile missing)',
    email: '',
  };
  const catalogQuiz = store.getQuizById(quizId);
  const sub = store.getProgress(studentId).submissions?.[quizId];
  if (!sub) {
    return `<p>Submission not found. <button class="btn btn-outline btn-sm" data-action="refresh-progress">↻ Refresh submissions</button></p>`;
  }
  // Prefer catalog quiz; fall back so legacy / unlinked quiz ids still open.
  const quiz = catalogQuiz || {
    id: quizId,
    title: `Assignment (${quizId})`,
    type: sub.type || 'manual',
    maxScore: 100,
    prompt: '',
    questions: Object.keys(sub.answers || {}).map((id) => ({
      id,
      prompt: id,
    })),
  };

  const isEdit = sub.status === 'graded';
  const max = quiz.maxScore || 100;
  const unit = quiz.type === 'manual' ? `/${max}` : '%';
  const written = isWritten(quiz) || !!(sub.answers && typeof sub.answers === 'object' && !Array.isArray(sub.answers));
  const useRubric = quiz.type === 'manual' || written;
  const savedQs = sub.questionScores || {};
  const rubricScores = store.isRubricScores(savedQs) ? savedQs : {};

  let submissionPanel = '';
  const structuredQs =
    Array.isArray(quiz.questions) && quiz.questions.length
      ? quiz.questions
      : Object.keys(sub.answers || {}).map((id) => ({ id, prompt: id }));
  if (written || (quiz.type === 'manual' && structuredQs.length)) {
    const qList = structuredQs;
    submissionPanel = `<section class="panel"><div class="panel-head"><h2>Student answers</h2>
        <span class="muted">${qList.length} question${qList.length === 1 ? '' : 's'} · score with Grading Breakdown below</span></div>
        ${qList
          .map((qq, i) => {
            const raw = sub.answers && sub.answers[qq.id];
            if (Array.isArray(qq.options) && qq.options.length >= 2) {
              const chosen =
                typeof raw === 'number'
                  ? raw
                  : Number.isFinite(Number(raw))
                    ? Number(raw)
                    : store.letterToIndex(raw, qq.options.length);
              return `<div class="review-q">
            <p class="rq-prompt">${i + 1}. ${esc(qq.prompt)}</p>
            ${qq.options
              .map((opt, oi) => {
                const letter = store.indexToLetter(oi);
                const isChosen = oi === chosen;
                const isKey = qq.correctIndex != null && oi === Number(qq.correctIndex);
                const cls = isKey ? 'opt-correct' : isChosen ? 'opt-wrong' : '';
                const tag = isChosen ? ' ← their answer' : isKey ? ' ✓ key' : '';
                return `<div class="opt ${cls}">${letter}. ${esc(opt)}${tag}</div>`;
              })
              .join('')}
          </div>`;
            }
            return `<div class="review-q">
            <p class="rq-prompt">${i + 1}. ${esc(qq.prompt)}</p>
            <p class="answer-box">${esc(store.formatQuestionAnswer(qq, raw))}</p>
          </div>`;
          })
          .join('')}
      </section>`;
  } else if (quiz.type === 'auto' && quiz.questions?.length) {
    submissionPanel = `<section class="panel"><div class="panel-head"><h2>Quiz review</h2>
        <span class="muted">${sub.correct != null ? `${sub.correct} of ${sub.total} correct (auto)` : 'Auto-scored'}</span></div>
        ${
          sub.correct != null && sub.total
            ? `<div class="derive-box auto">
                <strong>Auto score</strong>
                <p>${sub.correct} of ${sub.total} correct → ${sub.score ?? Math.round((sub.correct / sub.total) * 100)}%. You can override the final score below if needed.</p>
              </div>`
            : ''
        }
        ${quiz.questions
          .map((qq, i) => {
            const chosen = sub.answers ? sub.answers[qq.id] : undefined;
            return `<div class="review-q">
            <p class="rq-prompt">${i + 1}. ${esc(qq.prompt)}</p>
            ${(qq.options || [])
              .map((opt, oi) => {
                const isCorrect = oi === qq.correctIndex;
                const isChosen = oi === chosen;
                const cls = isCorrect ? 'opt-correct' : isChosen ? 'opt-wrong' : '';
                const tag = isCorrect ? ' ✓' : isChosen ? ' ✗ their answer' : '';
                return `<div class="opt ${cls}">${esc(opt)}${tag}</div>`;
              })
              .join('')}
          </div>`;
          })
          .join('')}
      </section>`;
  } else {
    submissionPanel = `<section class="panel"><div class="panel-head"><h2>Prompt</h2></div><p class="muted">${esc(quiz.prompt || '')}</p></section>
  <section class="panel"><div class="panel-head"><h2>Student submission</h2></div><p class="answer-box">${esc(sub.answer || '—')}</p></section>`;
  }

  // Aligned Grading Breakdown table (5 criteria × 20 pts).
  const breakdownRows = store.GRADING_BREAKDOWN.map((c) => {
    const pts = rubricScores[c.id];
    return `<tr>
      <td class="gb-criteria">${esc(c.label)}</td>
      <td class="gb-points">
        <span class="gb-score-wrap">
          <input type="number" class="gb-score-input" name="gb_${c.id}" data-cid="${esc(c.id)}"
            min="0" max="${c.max}" step="1" value="${pts != null ? pts : ''}"
            aria-label="${esc(c.label)} points out of ${c.max}" />
          <span class="gb-max">/${c.max}</span>
        </span>
      </td>
    </tr>`;
  }).join('');

  const breakdownPanel = useRubric
    ? `<div class="grading-breakdown" id="gradingBreakdown">
        <div class="gb-head">
          <h3>Grading Breakdown</h3>
          <p class="muted gb-lead">Enter <strong>Criteria</strong> points below. Totals fill the final score.</p>
        </div>
        <table class="gb-table" role="table" aria-label="Grading Breakdown Criteria and Points">
          <thead>
            <tr><th class="gb-criteria">Criteria</th><th class="gb-points">Points</th></tr>
          </thead>
          <tbody>${breakdownRows}</tbody>
          <tfoot>
            <tr>
              <td class="gb-criteria"><strong>Total</strong></td>
              <td class="gb-points"><strong id="qScoreSum">—</strong><span class="gb-max">/${max}</span></td>
            </tr>
          </tfoot>
        </table>
        <p class="hint gb-hint">Filling the breakdown auto-fills the final score. Total must equal the sum of the five criteria (max ${max}).</p>
      </div>`
    : '';

  const weekN = quizWeekNum(quiz);
  const qn = (quiz.questions || []).length;
  const meta = isEdit
    ? `graded ${fmtDate(sub.gradedAt)} · score ${sub.score}${unit}${sub.gradedBy ? ` · by ${esc(sub.gradedBy)}` : ''}`
    : `submitted ${fmtDate(sub.submittedAt)}`;
  const weekMeta = [
    weekN != null ? `Week ${weekN}` : null,
    qn ? `${qn} question${qn === 1 ? '' : 's'}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return `
  <div class="back-row">
    <button class="back-link" data-action="go" data-route="admin-student" data-id="${studentId}">← ${esc(student.name)}</button>
    <button class="back-link" data-action="go" data-route="admin-grading">← Grading</button>
  </div>
  <div class="page-head"><div class="cell-user big">${avatar(student, 48)}<div>
    <h1>${esc(quiz.title)}</h1><p class="muted">${esc(student.name)}${weekMeta ? ` · ${weekMeta}` : ''} · ${meta}</p></div></div></div>

  ${submissionPanel}

  <form id="gradeForm" data-student="${studentId}" data-quiz="${quizId}" data-written="${written ? '1' : '0'}" data-rubric="${useRubric ? '1' : '0'}" class="panel">
    <div class="panel-head"><h2>${isEdit ? 'Edit' : 'Assign grade'}</h2>
      ${isEdit ? `<span class="pill pill-done">Currently ${sub.score}${unit}</span>` : ''}</div>

    ${breakdownPanel}

    <div class="grade-row">
      <label class="field grade-score"><span>Final score (0–${max}${quiz.type === 'auto' ? ', percent' : ''})</span>
        <input type="number" name="score" id="gradeScoreInput" min="0" max="${max}" step="1" value="${sub.score ?? ''}" required />
      </label>
      ${
        useRubric
          ? `<div class="grade-sum-hint muted">Sum of breakdown: <strong id="qScoreSumHint">—</strong>
              <button type="button" class="link-arrow" data-action="apply-q-sum">Use as final score →</button></div>`
          : ''
      }
    </div>

    <label class="field"><span>Internal grading note <small class="field-hint">(optional · instructors only)</small></span>
      <textarea name="gradeNote" rows="2"
        placeholder="Optional notes for instructors only…">${esc(extractInstructorNote(sub.gradeDerivation))}</textarea>
    </label>

    <label class="field"><span>Feedback to student <small class="field-hint">(student-facing; optional)</small></span>
      <textarea name="feedback" rows="4" placeholder="What was strong, what to improve…">${esc(sub.feedback || '')}</textarea>
    </label>

    <div class="grade-form-actions">
      <button type="submit" class="btn btn-primary">${isEdit ? 'Save' : 'Save &amp; release to student'}</button>
    </div>
  </form>`;
}

/** Status chip for week-release rows. */
function releaseChip(on, onLabel = 'Live', offLabel = 'Offline') {
  return on
    ? `<span class="pill pill-done">● ${onLabel}</span>`
    : `<span class="pill pill-todo">${offLabel}</span>`;
}

/**
 * One-week release panel: curriculum + sessions + tests with
 * Publish entire week / Unpublish and individual toggles.
 */
function weekReleaseCard(status) {
  const w = status.week;
  // Primary signal: are this week's sessions live for students?
  const sessionsLive = status.sessionsLive || (
    status.sessions.length > 0 && status.sessions.every((s) => s.published)
  );
  const allOn = status.allPublished || sessionsLive;
  const noSessions = status.sessions.length === 0;
  const curricRow = status.curriculum.exists
    ? `<div class="week-release-row">
        <span class="wrr-kind">Curriculum</span>
        <span class="wrr-title">${esc(status.curriculum.title || `Week ${w} syllabus`)}</span>
        ${releaseChip(status.curriculum.published, 'Published', 'Coming soon')}
        <button type="button" class="btn btn-sm ${status.curriculum.published ? 'btn-outline' : 'btn-primary'}"
          data-action="toggle-curric-week-publish" data-week="${w}">
          ${status.curriculum.published ? 'Unpublish' : 'Publish'}
        </button>
      </div>`
    : `<div class="week-release-row wrr-muted">
        <span class="wrr-kind">Curriculum</span>
        <span class="wrr-title muted">No syllabus week ${w} yet — add it under Curriculum</span>
        <button type="button" class="btn btn-ghost btn-sm" data-action="go" data-route="curriculum">Open Curriculum →</button>
      </div>`;

  const sessionRows = status.sessions.length
    ? status.sessions
        .map(
          (s) => `<div class="week-release-row">
        <span class="wrr-kind">Session</span>
        <span class="wrr-title">${esc(s.title)}</span>
        ${releaseChip(s.published, 'Published', 'Hidden')}
        <button type="button" class="btn btn-sm ${s.published ? 'btn-outline' : 'btn-primary'}"
          data-action="toggle-session-publish" data-id="${s.id}">
          ${s.published ? 'Unpublish' : 'Publish'}
        </button>
      </div>`
        )
        .join('')
    : `<div class="week-release-row wrr-muted">
        <span class="wrr-kind">Session</span>
        <span class="wrr-title muted">No recordings for Week ${w} — set a session’s <strong>Wk</strong> number to ${w} below, then publish.</span>
      </div>`;

  const quizRows = status.quizzes.length
    ? status.quizzes
        .map(
          (q) => `<div class="week-release-row">
        <span class="wrr-kind">Test</span>
        <span class="wrr-title">${esc(q.title)}${q.due ? ` <span class="muted">· due ${fmtDate(q.due)}</span>` : ''}</span>
        ${releaseChip(q.published, 'Live', 'Offline')}
        <button type="button" class="btn btn-sm ${q.published ? 'btn-outline' : 'btn-primary'}"
          data-action="toggle-quiz-live" data-id="${q.id}">
          ${q.published ? 'Take offline' : 'Go live'}
        </button>
      </div>`
        )
        .join('')
    : `<div class="week-release-row wrr-muted">
        <span class="wrr-kind">Test</span>
        <span class="wrr-title muted">No tests linked to this week</span>
      </div>`;

  const openDefault = w === 1 || w === 2 || noSessions === false && !sessionsLive;

  return `
  <details class="week-release-card${sessionsLive ? ' week-release-live' : ''}" ${openDefault ? 'open' : ''}>
    <summary class="week-release-sum">
      <span class="wk-num-badge">Week ${w}</span>
      <span class="week-release-title">${esc(status.title || `Week ${w}`)}</span>
      ${sessionsLive
        ? `<span class="pill pill-done">${status.sessions.length} session${status.sessions.length === 1 ? '' : 's'} live</span>`
        : noSessions
          ? `<span class="pill pill-todo">No sessions</span>`
          : `<span class="pill pill-todo">Sessions hidden</span>`}
      <span class="wk-chev" aria-hidden="true">▾</span>
    </summary>
    <div class="week-release-body">
      <div class="week-release-actions">
        <p class="muted week-release-hint">
          <strong>Publish Week ${w}</strong> sets every session (and linked tests) for this week live for students.
          ${noSessions ? ` First assign sessions to week ${w} using the <strong>Wk</strong> field below.` : ''}
        </p>
        <button type="button" class="btn ${sessionsLive ? 'btn-outline' : 'btn-primary'}"
          data-action="publish-week" data-week="${w}" data-publish="${sessionsLive ? '0' : '1'}"
          ${noSessions ? 'disabled title="Assign sessions to this week first"' : ''}>
          ${sessionsLive ? `Unpublish Week ${w} sessions` : `Publish Week ${w} sessions`}
        </button>
      </div>
      <div class="week-release-list">
        ${curricRow}
        ${sessionRows}
        ${quizRows}
      </div>
    </div>
  </details>`;
}

function adminContent() {
  const sessions = store.getSessions();
  const curricWeeks = (store.getCurriculum().weeks || []).map((w) => Number(w.week));
  const sessionWeeks = sessions.map((s) => Number(s.week));
  const weeks = [...new Set([...curricWeeks, ...sessionWeeks].filter((n) => Number.isFinite(n) && n > 0))]
    .sort((a, b) => a - b);

  const publishedSessions = sessions.filter((s) => s.published !== false).length;
  const releaseCards = weeks.map((w) => weekReleaseCard(store.getWeekReleaseStatus(w))).join('');
  const curricBackendOk = store.isCurriculumBackendOk();
  const curricMissingBanner = curricBackendOk
    ? ''
    : `<section class="panel" style="border-color:#c45c5c;background:#fdf2f2">
        <div class="panel-head"><h2>Syllabus database not connected</h2></div>
        <p class="muted" style="margin:0">The <code>curriculum</code> table is missing in Supabase, so syllabus publish cannot save.
        Session publish still works. Run <code>supabase/curriculum.sql</code> in the Supabase SQL Editor (one time), then reload.</p>
      </section>`;

  const meetBlocks = weeks
    .map((w) => {
      const wSessions = sessions.filter((s) => Number(s.week) === Number(w));
      const rep = wSessions[0] || { meetUrl: '', liveAt: '' };
      return `
    <div class="week-meet-block">
      <div class="week-meet-label">
        <span class="wk-num-badge">Week ${w}</span>
      </div>
      <div class="week-meet-inputs">
        <input class="meet-input" data-action="week-meet" data-week="${w}"
          value="${esc(rep.meetUrl || '')}" placeholder="https://meet.google.com/xxx-yyyy-zzz" />
        <input type="datetime-local" class="meet-time" data-action="week-liveat" data-week="${w}"
          value="${esc(rep.liveAt || '')}" title="Scheduled class time (optional)" />
        ${rep.meetUrl ? `<a class="btn btn-light btn-sm" href="${esc(rep.meetUrl)}" target="_blank" rel="noopener">Test &#8599;</a>` : ''}
      </div>
    </div>`;
    })
    .join('');

  const sessionCards = sessions
    .map((x) => {
      const qz = store.getQuizzesForSession(x.id);
      const published = x.published !== false;
      const source = x.isFile
        ? `<span class="pill pill-done">Uploaded</span>`
        : `<span class="pill pill-todo">Embed URL</span>`;
      const uploader = USE_SUPABASE
        ? `<label class="upload-btn sm">${x.isFile ? 'Replace video' : 'Upload video'}
           <input type="file" accept="video/*" data-action="upload-video" data-session="${x.id}" hidden />
         </label>`
        : '';

      return `
    <div class="session-card${published ? '' : ' session-card-offline'}">
      <div class="session-card-header">
        <div class="session-card-wk">
          <span class="sc-label">Wk</span>
          <input type="number" class="session-edit-input sc-week-input" data-action="session-week"
            data-id="${x.id}" value="${x.week}" min="1" />
        </div>
        <input type="text" class="session-edit-input sc-title-input" data-action="session-title"
          data-id="${x.id}" value="${esc(x.title)}" placeholder="Session Title" />
        ${releaseChip(published, 'Published', 'Hidden')}
        <button type="button" class="btn btn-sm ${published ? 'btn-outline' : 'btn-primary'}"
          data-action="toggle-session-publish" data-id="${x.id}">
          ${published ? 'Unpublish' : 'Publish to students'}
        </button>
        <button class="row-del" data-action="delete-session" data-id="${x.id}"
          title="Delete session" aria-label="Delete ${esc(x.title)}">&#128465;</button>
      </div>
      <div class="session-card-body">
        <div class="sc-col sc-col-wide">
          <label class="sc-label">Summary</label>
          <textarea class="session-edit-textarea" data-action="session-summary" data-id="${x.id}"
            placeholder="Brief session summary" rows="2">${esc(x.summary || '')}</textarea>
          <label class="sc-label" style="margin-top:10px">Key points <span class="muted">(one per line)</span></label>
          <textarea class="session-edit-textarea" data-action="session-notes" data-id="${x.id}"
            placeholder="Bullet points, one per line" rows="3">${esc((x.notes || []).join('\n'))}</textarea>
        </div>
        <div class="sc-col">
          <label class="sc-label">Date</label>
          <input type="date" class="session-edit-input" data-action="session-date"
            data-id="${x.id}" value="${x.date || ''}" />
          <label class="sc-label" style="margin-top:10px">Duration <span class="muted">(min)</span></label>
          <input type="number" class="session-edit-input" data-action="session-duration"
            data-id="${x.id}" value="${x.durationMin || 0}" min="0" />
          <label class="sc-label" style="margin-top:10px">Video</label>
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:6px">${source} ${uploader}</div>
          <input type="text" class="session-edit-input" data-action="session-video"
            data-id="${x.id}" value="${esc(x.videoUrl || '')}" placeholder="YouTube / Vimeo embed URL" />
          ${
            qz.length
              ? `<label class="sc-label" style="margin-top:10px">Tests</label>
          <div class="quiz-live-list">
            ${qz
              .map(
                (q) => `<div class="quiz-live-row">
              <span class="qlr-title">${esc(q.title)}${q.due ? ` <span class="muted">· due ${fmtDate(q.due)}</span>` : ''}</span>
              ${q.published
                ? `<span class="pill pill-done">● Live</span>`
                : `<span class="pill pill-todo">Offline</span>`}
              <button class="btn btn-sm ${q.published ? 'btn-outline' : 'btn-primary'}"
                data-action="toggle-quiz-live" data-id="${q.id}">${q.published ? 'Take offline' : 'Go live'}</button>
            </div>`
              )
              .join('')}
          </div>`
              : ''
          }
        </div>
      </div>
    </div>`;
    })
    .join('');

  return `
  ${pageHeadHelp(
    'Class Sessions',
    `Release weeks to students · ${publishedSessions} of ${sessions.length} published`,
    {
      helpId: 'admin-sessions',
      helpTitle: 'How to release a week',
      helpSteps: [
        'Set each recording’s <strong>Wk</strong> number to the correct week.',
        'Use <strong>Release to students</strong> → <strong>Publish Week N sessions</strong>.',
        'Create and publish the weekly test under <strong>Tests</strong> (student My Tests).',
        'Optional: add a Google Meet link under Live Class (collapsed below).',
      ],
      actions: `
        <button class="btn btn-outline" data-action="go" data-route="admin-tests">Tests →</button>
        <button class="btn btn-primary" data-action="add-session">+ Add Session</button>`,
    }
  )}

  ${curricMissingBanner}

  <section class="panel">
    <div class="panel-head">
      <h2>Release to students</h2>
      <span class="muted" style="font-size:0.84rem">Set Wk on sessions first, then publish the week</span>
    </div>
    <div class="week-release-list-wrap">
      ${releaseCards || '<p class="muted">Add a curriculum week or session to start releasing content.</p>'}
    </div>
  </section>

  <section class="panel">
    <div class="panel-head">
      <h2>Sessions</h2>
      <span class="muted" style="font-size:0.84rem">Edit fields · publish individually</span>
    </div>
    <div class="session-cards">
      ${sessionCards || '<p class="muted">No sessions yet. Add one to get started.</p>'}
    </div>
    <p class="hint">${
      USE_SUPABASE
        ? 'Upload a recording (MP4) or use a YouTube/Vimeo embed URL. New sessions start hidden until you publish.'
        : 'Connect Supabase to upload videos. Demo mode uses sample embeds. New sessions start hidden until published.'
    }</p>
  </section>

  <section class="panel">
    <div class="panel-head">
      <h2>Weekly tests</h2>
      <button type="button" class="btn btn-primary btn-sm" data-action="go" data-route="admin-tests">Open Tests →</button>
    </div>
    <p class="hint" style="margin-top:0">
      Enter free-response questions for student <strong>My Tests</strong>, publish when ready, then grade under <strong>Grading</strong>.
    </p>
  </section>

  <details class="panel panel-collapsible">
    <summary>
      <div class="panel-head">
        <h2>Live Class — Google Meet</h2>
        <span class="muted" style="font-size:0.84rem">Optional · one link per week</span>
      </div>
      <span class="muted" aria-hidden="true">▾</span>
    </summary>
    <div class="panel-collapse-body">
      <div class="week-meet-list">
        ${meetBlocks || '<p class="muted">No weeks yet.</p>'}
      </div>
      <p class="hint">Create the Meet link in Google Calendar for proper host controls. Students see Join Live Class on published sessions for that week.</p>
    </div>
  </details>

  ${adminMaterialsPanel()}`;
}

/** Infer week number for a quiz (session week, else "Week N" in title). */
function quizWeekNum(q) {
  if (!q) return null;
  const sx = q.sessionId ? store.getSessionById(q.sessionId) : null;
  if (sx && Number(sx.week) > 0) return Number(sx.week);
  // Prefer shared matcher (title / session) when available
  if (typeof store.quizMatchesWeek === 'function') {
    for (let w = 1; w <= 12; w++) {
      if (store.quizMatchesWeek(q, w)) return w;
    }
  }
  const m = String(q.title || '').match(/\bweek\s*(\d+)\b/i);
  return m ? Number(m[1]) : null;
}

/** Admin: create / edit free-response weekly tests for student My Tests. */
function adminWeeklyTestsPanel() {
  const quizzes = [...store.getQuizzes()]
    .filter((q) => !store.isDiscussionGradeQuizId?.(q.id) && q.kind !== 'discussion')
    .sort((a, b) => {
    const wa = quizWeekNum(a) || 99;
    const wb = quizWeekNum(b) || 99;
    return wa - wb || String(a.title).localeCompare(String(b.title));
  });
  const sessions = store.getSessions();
  const weekOpts = [...new Set(sessions.map((s) => Number(s.week)).filter(Boolean))];
  for (let w = 1; w <= 12; w++) if (!weekOpts.includes(w)) weekOpts.push(w);
  weekOpts.sort((a, b) => a - b);

  const editing = editingQuizId ? store.getQuizById(editingQuizId) : null;
  const editWeek = editing ? quizWeekNum(editing) || 1 : 2;
  const editQuestions = editing?.questions
    ? store.serializeQuestions(editing.questions)
    : '';
  const defaultWeek = editing ? editWeek : 2;

  const rows = quizzes.length
    ? quizzes
        .map((q) => {
          const wk = quizWeekNum(q);
          const weekLabel = wk ? `W${wk}` : '—';
          const qCount = Array.isArray(q.questions) ? q.questions.length : 0;
          const mcN = (q.questions || []).filter(
            (qq) => Array.isArray(qq.options) && qq.options.length >= 2
          ).length;
          const isEdit = editingQuizId === q.id;
          return `<div class="quiz-live-row week-test-row${isEdit ? ' week-test-editing' : ''}">
            <span class="qlr-title">
              <strong>${esc(q.title)}</strong>
              <span class="muted"> · ${weekLabel}${q.due ? ` · due ${fmtDate(q.due)}` : ''} · ${qCount} question${qCount === 1 ? '' : 's'}${
                mcN ? ` · ${mcN} multiple choice` : ''
              }</span>
            </span>
            ${q.published ? `<span class="pill pill-done">● Live</span>` : `<span class="pill pill-todo">Offline</span>`}
            <button type="button" class="btn btn-sm btn-outline"
              data-action="edit-quiz" data-id="${q.id}">${isEdit ? 'Editing…' : 'Edit'}</button>
            <button type="button" class="btn btn-sm ${q.published ? 'btn-outline' : 'btn-primary'}"
              data-action="toggle-quiz-live" data-id="${q.id}">
              ${q.published ? 'Take offline' : 'Publish to students'}
            </button>
            <button type="button" class="btn btn-sm btn-outline"
              data-action="clear-quiz-subs" data-id="${q.id}"
              title="Remove all student answers so everyone gets a blank form again">Reset answers</button>
            <button type="button" class="btn btn-sm btn-outline btn-danger-outline"
              data-action="delete-quiz" data-id="${q.id}" title="Delete test">Delete</button>
          </div>`;
        })
        .join('')
    : `<p class="muted">No tests yet. Create one below (or import a week’s curriculum quiz lines), then publish for students under <strong>My Tests</strong>.</p>`;

  return `
  <section class="panel">
    <div class="panel-head">
      <h2>${editing ? 'Edit test' : 'Create weekly test'}</h2>
      <span class="muted" style="font-size:0.84rem">Students answer under My Tests · you grade under Grading</span>
    </div>
    <p class="hint" style="margin-top:0">
      <strong>Free-response:</strong> one question per line.<br />
      <strong>Multiple choice:</strong> write the question, then options on the next lines as
      <code>A. …</code> <code>B. …</code> <code>C. …</code> <code>D. …</code>
      (also accepts <code>a)</code> / <code>1.</code>). Optional answer key:
      <code>Correct: B</code>. Blank line between questions.<br />
      Students only see tests marked <strong>● Live</strong>. Use <strong>Reset answers</strong> to wipe live submissions.
    </p>

    <form id="createTestForm" class="create-test-form" data-edit-id="${editing ? esc(editing.id) : ''}">
      <div class="create-test-grid">
        <label class="field"><span>Week</span>
          <select name="week" required>
            ${weekOpts
              .map(
                (w) =>
                  `<option value="${w}" ${Number(w) === Number(defaultWeek) ? 'selected' : ''}>Week ${w}</option>`
              )
              .join('')}
          </select>
        </label>
        <label class="field create-test-grow"><span>Test title</span>
          <input type="text" name="title" required
            value="${esc(editing?.title || '')}"
            placeholder="Week 2 Test — Business Structure &amp; Legal Foundation" />
        </label>
        <label class="field"><span>Due date <em class="muted">(optional)</em></span>
          <input type="date" name="due" value="${esc(editing?.due || '')}" />
        </label>
        <label class="field create-test-full"><span>Questions <em class="muted">(free-response and/or A–D multiple choice)</em></span>
          <textarea name="questions" rows="12" required
            placeholder="What is a growth mindset?&#10;A. Believing skills improve with practice&#10;B. Talent never changes&#10;C. Avoiding feedback&#10;D. Ignoring goals&#10;Correct: A&#10;&#10;Why is goal setting important in business?">${esc(
              editQuestions
            )}</textarea>
        </label>
      </div>
      <div class="create-test-actions">
        <label class="check-inline">
          <input type="checkbox" name="publishNow" ${
            editing ? (editing.published ? 'checked' : '') : 'checked'
          } />
          <span>${editing ? 'Published (live on My Tests)' : 'Publish to students (show under My Tests)'}</span>
        </label>
        ${
          editing
            ? `<button type="button" class="btn btn-outline" data-action="cancel-edit-quiz">Cancel</button>
               <button type="submit" class="btn btn-primary">Save changes</button>`
            : `<button type="submit" class="btn btn-primary">Create weekly test</button>`
        }
      </div>
    </form>

    <div class="panel-head" style="margin-top:18px"><h3 style="margin:0;font-size:1rem">All tests</h3></div>
    <div class="quiz-live-list week-test-list">${rows}</div>
  </section>`;
}

/** Admin page: Tests for student My Tests. */
function adminTests() {
  return `
  ${pageHeadHelp(
    'Tests',
    'Create free-response tests students complete under My Tests.',
    {
      helpId: 'admin-tests',
      helpTitle: 'How Tests work',
      helpSteps: [
        'Add questions (one per line) and link the test to a week.',
        'Use <strong>Publish to students</strong> when ready — only live tests appear under My Tests.',
        'Grade submissions under <strong>Grading</strong>.',
      ],
    }
  )}
  ${adminWeeklyTestsPanel()}`;
}

/* ---- Access: approved-student allowlist ----------------------------------- */
function adminAccess() {
  const list = store.getAllowedStudents();
  const registered = new Set(store.getStudents().map((s) => (s.email || '').toLowerCase()));
  return `
  ${pageHeadHelp(
    'Access — Approved Students',
    'Only people on this list can create a student account.',
    {
      helpId: 'admin-access',
      helpTitle: 'How Access works',
      helpSteps: [
        'Add the exact email from the student’s enrollment form.',
        'They can then create a login with that same email on the portal.',
        'Remove an email to block new signups (existing accounts stay until deleted in Supabase).',
      ],
    }
  )}

  <section class="panel">
    <div class="panel-head"><h2>Add an approved email</h2></div>
    <form id="approvedForm">
      <div class="approve-row">
        <input type="email" name="email" placeholder="student@example.com" autocomplete="off" required />
        <input type="text" name="note" placeholder="Note (optional, e.g. Summer 2026)" />
        <button type="submit" class="btn btn-primary">Add</button>
      </div>
    </form>
    ${
      USE_SUPABASE
        ? `<p class="hint">Tip: paste an email from your Jotform enrollments. They can then sign up with that exact address.</p>`
        : `<p class="hint">Demo mode — changes here are local only. Connected to Supabase, this list gates real signups.</p>`
    }
  </section>

  <section class="panel no-pad">
    <div class="table-scroll">
      <table class="data-table">
        <thead><tr><th>Email</th><th>Note</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${
            list.length
              ? list
                  .map((a) => {
                    const reg = registered.has(String(a.email).toLowerCase());
                    return `<tr>
              <td><strong>${esc(a.email)}</strong></td>
              <td class="muted">${esc(a.note || '—')}</td>
              <td>${reg ? `<span class="pill pill-done">Registered</span>` : `<span class="pill pill-todo">Not yet</span>`}</td>
              <td><button class="btn btn-ghost btn-sm" data-action="remove-allowed" data-email="${esc(a.email)}">Remove</button></td>
            </tr>`;
                  })
                  .join('')
              : `<tr><td colspan="4" class="empty-cell">No approved emails yet — add one above.</td></tr>`
          }
        </tbody>
      </table>
    </div>
  </section>`;
}

/* ---- CRM ------------------------------------------------------------------ */
function crmRows() {
  // Returns { columns, rows, exportRows } for the current CRM view + filters.
  const q = crm.q.trim().toLowerCase();
  const matches = (txt) => !q || String(txt).toLowerCase().includes(q);

  const grantText = (p) => (p.grantAwarded ? `$${p.grantAmount || 0}` : '—');

  if (crm.view === 'leads') {
    let leads = store.getLeads();
    if (crm.status !== 'all') leads = leads.filter((l) => l.status === crm.status);
    leads = leads.filter((l) => matches(l.name) || matches(l.email) || matches(l.interest) || matches(l.source));
    return {
      kind: 'leads',
      columns: ['Name', 'Email', 'Phone', 'Source', 'Interest', 'Status', 'Grant ($300 fee)', 'Created', 'Notes'],
      data: leads,
      exportRows: leads.map((l) => [l.name, l.email, l.phone, l.source, l.interest, l.status, grantText(l), fmtDate(l.createdAt), l.notes]),
    };
  }
  // students view
  let students = store.getStudents();
  students = students.filter((s) => matches(s.name) || matches(s.email) || matches(s.plan));
  const withStats = students.map((s) => ({ s, st: store.getStudentStats(s.id) }));
  return {
    kind: 'students',
    columns: ['Name', 'Email', 'Phone', 'Cohort', 'Plan', 'Enrolled', 'Grant ($300 fee)', 'Sessions', 'Avg score', 'Pending'],
    data: withStats,
    exportRows: withStats.map(({ s, st }) => [
      s.name, s.email, s.phone, s.cohort, s.plan, fmtDate(s.enrolled), grantText(s),
      `${st.completed}/${st.totalSessions}`, st.avgScore == null ? '—' : `${st.avgScore}%`, st.pendingGrading,
    ]),
  };
}

/** Columns + rows for the Students roster export (CSV/PDF/Word). */
function studentExportData() {
  const cols = ['Name', 'Email', 'Phone', 'Cohort', 'Plan', 'Enrolled', 'Grant ($300 fee)', 'Sessions', 'Avg score', 'Pending'];
  const rows = store.getStudents().map((s) => {
    const st = store.getStudentStats(s.id);
    return [s.name, s.email, s.phone, s.cohort, s.plan, fmtDate(s.enrolled),
      s.grantAwarded ? `$${s.grantAmount || 0}` : '—',
      `${st.completed}/${st.totalSessions}`, st.avgScore == null ? '—' : `${st.avgScore}%`, st.pendingGrading];
  });
  return { cols, rows };
}

/** Grant ($300 fee) cell — checkbox + editable amount, for leads & students. */
function grantCell(kind, person) {
  const awarded = !!person.grantAwarded;
  const amt = person.grantAmount || 300;
  return `<td><div class="grant-cell">
    <input type="checkbox" class="grant-chk" data-action="${kind}-grant" data-id="${person.id}" ${awarded ? 'checked' : ''} title="Grant covers the $300 fee" />
    <input type="number" class="grant-amt" data-action="${kind}-grant-amt" data-id="${person.id}" value="${amt}" min="0" step="50" ${awarded ? '' : 'disabled'} />
  </div></td>`;
}

function adminCRM() {
  const r = crmRows();
  const count = r.data.length;
  const isLeads = r.kind === 'leads';
  const totalLeads = store.getLeads().length;
  // the lead currently open in the edit form (if any); null if it was deleted
  const editingLead = isLeads && crm.editingId ? store.getLeads().find((l) => l.id === crm.editingId) || null : null;
  // emails already on the approved-student allowlist (can create a portal account)
  const approvedEmails = new Set(store.getAllowedStudents().map((a) => (a.email || '').toLowerCase()));

  // an extra (blank) header for the per-row action buttons on the leads table
  const headCols = isLeads ? [...r.columns, ''] : r.columns;
  const colCount = headCols.length;

  const tableBody = isLeads
    ? r.data
        .map((l) => {
          const open = crm.notesOpen.has(l.id);
          const hasNote = !!(l.notes && l.notes.trim());
          return `<tr>
        <td><strong>${esc(l.name)}</strong></td>
        <td><a href="mailto:${esc(l.email)}">${esc(l.email)}</a></td>
        <td>${esc(l.phone)}</td>
        <td>${esc(l.source)}</td>
        <td>${esc(l.interest)}</td>
        <td><select class="status-select pill-${l.status}" data-action="lead-status" data-id="${l.id}">
          ${STATUS_OPTIONS.map((o) => `<option value="${o}" ${o === l.status ? 'selected' : ''}>${o}</option>`).join('')}
        </select></td>
        ${grantCell('lead', l)}
        <td>${fmtDate(l.createdAt)}</td>
        <td class="notes-cell">
          <button class="notes-toggle ${hasNote ? 'has-note' : ''}" data-action="toggle-notes" data-id="${l.id}" aria-expanded="${open}" title="${open ? 'Hide note' : hasNote ? 'View / edit note' : 'Add a note'}">
            <span class="notes-ico">${hasNote ? '🗒' : '＋'}</span><span class="notes-lbl">${open ? 'Hide' : hasNote ? 'Note' : 'Add'}</span>
          </button>
        </td>
        <td class="crm-actions">
          <button class="row-edit" data-action="edit-lead" data-id="${l.id}" title="Edit record" aria-label="Edit ${esc(l.name)}">✎ Edit</button>
          ${
            l.email
              ? approvedEmails.has(l.email.toLowerCase())
                ? `<span class="pill pill-done" title="This email can create a student login at the portal">Can log in</span>`
                : `<button class="row-approve" data-action="enable-login" data-id="${l.id}" title="Let this person create their own student login at the portal">✓ Enable login</button>`
              : ''
          }
          <button class="row-del" data-action="delete-lead" data-id="${l.id}" title="Delete record" aria-label="Delete ${esc(l.name)}">🗑</button>
        </td>
      </tr>${
        open
          ? `<tr class="notes-row">
        <td colspan="${colCount}">
          <div class="notes-panel">
            <label class="notes-panel-label" for="note-${l.id}">Notes — ${esc(l.name)}</label>
            <textarea id="note-${l.id}" class="notes-area" data-action="lead-notes" data-id="${l.id}" rows="3" placeholder="Add a note — payment plan, follow-up date, business type, context…">${esc(l.notes)}</textarea>
          </div>
        </td>
      </tr>`
          : ''
      }`;
        })
        .join('')
    : r.data
        .map(
          ({ s, st }) => `<tr>
        <td><div class="cell-user">${avatar(s, 32)}<strong>${esc(s.name)}</strong></div></td>
        <td><a href="mailto:${esc(s.email)}">${esc(s.email)}</a></td>
        <td>${esc(s.phone)}</td>
        <td>${esc(s.cohort)}</td>
        <td>${esc(s.plan)}</td>
        <td>${fmtDate(s.enrolled)}</td>
        ${grantCell('student', s)}
        <td>${st.completed}/${st.totalSessions}</td>
        <td>${st.avgScore == null ? '—' : st.avgScore + '%'}</td>
        <td>${st.pendingGrading || '—'}</td>
      </tr>`
        )
        .join('');

  // grant summary for the current view
  const people = isLeads ? r.data : r.data.map((d) => d.s);
  const granted = people.filter((p) => p.grantAwarded);
  const grantTotal = granted.reduce((sum, p) => sum + (Number(p.grantAmount) || 0), 0);

  return `
  ${pageHeadHelp('Live CRM', 'Students & leads in one place · changes save instantly', {
    helpId: 'admin-crm',
    helpTitle: 'How to use the CRM',
    helpSteps: [
      'Switch between <strong>Leads</strong> and <strong>Students</strong> with the tabs below.',
      'Add a lead, then set status to <strong>enrolled</strong> (or Enable login) so they can create a portal account.',
      'Use search and status filters to find people quickly.',
      'Export CSV / Word / PDF when you need reports.',
    ],
    actions: `
      ${isLeads ? `<button class="btn btn-primary btn-sm" data-action="toggle-add-lead">＋ Add record</button>` : ''}
      <button class="btn btn-outline btn-sm" data-action="export-csv">⬇ CSV</button>
      <button class="btn btn-outline btn-sm" data-action="export-word">⬇ Word</button>
      <button class="btn btn-outline btn-sm" data-action="export-pdf">⬇ PDF</button>
      ${isLeads && totalLeads ? `<button class="btn btn-ghost btn-sm btn-danger" data-action="clear-leads">Clear all</button>` : ''}`,
  })}

  ${editingLead ? recordForm(editingLead) : isLeads && crm.adding ? recordForm() : ''}

  <div class="crm-controls">
    <div class="seg">
      <button class="seg-btn ${crm.view === 'leads' ? 'on' : ''}" data-action="crm-view" data-view="leads">Leads</button>
      <button class="seg-btn ${crm.view === 'students' ? 'on' : ''}" data-action="crm-view" data-view="students">Students</button>
    </div>
    <input id="crmSearch" class="crm-search" placeholder="Search name, email…" value="${esc(crm.q)}" data-action="crm-search" />
    ${
      isLeads
        ? `<select class="crm-status" data-action="crm-status">
            <option value="all" ${crm.status === 'all' ? 'selected' : ''}>All statuses</option>
            ${STATUS_OPTIONS.map((o) => `<option value="${o}" ${crm.status === o ? 'selected' : ''}>${o}</option>`).join('')}
          </select>`
        : ''
    }
    <span class="crm-count">${count} record${count === 1 ? '' : 's'}${
      granted.length ? ` · ${granted.length} grant${granted.length === 1 ? '' : 's'} ($${grantTotal})` : ''
    }</span>
  </div>

  ${
    isLeads
      ? `<p class="crm-hint muted">Set a record's status to <strong>enrolled</strong> — or click <strong>✓ Enable login</strong> — and that person can create their own student login at the portal.</p>`
      : `<p class="crm-hint muted">Students appear here automatically once they create a portal account. To let someone in, mark their CRM record <strong>enrolled</strong> (or approve their email under <button class="link-arrow" data-action="go" data-route="admin-access">Access →</button>).</p>`
  }

  <section class="panel no-pad">
    <div class="table-scroll">
      <table class="data-table crm-table">
        <thead><tr>${headCols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
        <tbody>${tableBody || `<tr><td colspan="${colCount}" class="empty-cell">${isLeads ? 'No records yet — click “＋ Add record” to add one.' : 'No matching records.'}</td></tr>`}</tbody>
      </table>
    </div>
  </section>`;
}

/**
 * The manual add/edit form — every CRM field is available here.
 * Pass a `lead` to prefill for editing; omit it for a blank "add record" form.
 */
function recordForm(lead) {
  const editing = !!lead;
  const v = lead || {};
  return `
  <section class="panel crm-add">
    <div class="panel-head">
      <h2>${editing ? 'Edit record' : 'Add a student or lead'}</h2>
      <p class="muted">${
        editing
          ? 'Update any field and save. Set the status to <em>enrolled</em> and they can create their own student login at the portal.'
          : 'Enter everything you know — only a name is required. Set the status to <em>enrolled</em> and they can create their own student login at the portal.'
      }</p>
    </div>
    <form id="${editing ? 'editLeadForm' : 'addLeadForm'}" class="lead-form" autocomplete="off"${editing ? ` data-id="${esc(v.id)}"` : ''}>
      <div class="lead-form-grid">
        <label class="field"><span>Name *</span><input name="name" required placeholder="Full name" value="${esc(v.name || '')}" /></label>
        <label class="field"><span>Email</span><input name="email" type="email" placeholder="name@example.com" value="${esc(v.email || '')}" /></label>
        <label class="field"><span>Phone</span><input name="phone" placeholder="(404) 555-0100" value="${esc(v.phone || '')}" /></label>
        <label class="field"><span>Source</span><input name="source" list="leadSources" placeholder="Website, Referral, Event…" value="${esc(v.source || '')}" /></label>
        <label class="field"><span>Interest</span><input name="interest" list="leadInterests" placeholder="Funding Masterclass…" value="${esc(v.interest || '')}" /></label>
        <label class="field"><span>Status</span>
          <select name="status">${STATUS_OPTIONS.map((o) => `<option value="${o}" ${o === (v.status || 'new') ? 'selected' : ''}>${o}</option>`).join('')}</select>
        </label>
        <label class="field"><span>Date added</span><input name="createdAt" type="date" value="${esc(v.createdAt || todayISO())}" /></label>
        <label class="field"><span>Grant ($300 fee)</span>
          <span class="grant-cell">
            <input type="checkbox" class="grant-chk" name="grantAwarded" ${v.grantAwarded ? 'checked' : ''} />
            <input type="number" class="grant-amt" name="grantAmount" value="${esc(String(v.grantAmount || 300))}" min="0" step="50" />
          </span>
        </label>
      </div>
      <label class="field lead-form-notes"><span>Notes</span><textarea name="notes" rows="2" placeholder="Anything useful — payment plan, business type, follow-up date…">${esc(v.notes || '')}</textarea></label>
      <div class="lead-form-actions">
        <button type="button" class="btn btn-ghost" data-action="${editing ? 'cancel-edit-lead' : 'toggle-add-lead'}">Cancel</button>
        <button type="submit" class="btn btn-primary">${editing ? 'Save changes' : 'Add record'}</button>
      </div>
    </form>
    <datalist id="leadSources"><option>Website form</option><option>Referral</option><option>Instagram</option><option>Event — Boss Court TV</option><option>Newsletter</option><option>Jotform enrollment</option><option>Phone call</option><option>Walk-in</option></datalist>
    <datalist id="leadInterests"><option>Funding Masterclass</option><option>Business Growth Plan</option><option>Scholarship</option><option>Working Capital</option><option>Equipment Financing</option></datalist>
  </section>`;
}

/* ===========================================================================
   RENDER
   ======================================================================== */
function render() {
  // Was the student mid-message when this re-render fired? (a live post arriving
  // shouldn't steal focus from the composer). Checked before we replace the DOM.
  const discWasFocused = !!document.activeElement?.matches?.('textarea[data-action="disc-input"]');
  const discFocusWeek =
    document.activeElement?.dataset?.week ||
    (disc.postWeek != null ? String(disc.postWeek) : null);

  // Hydrate failed after a valid session — dedicated recovery UI.
  if (portalLoadError && currentUser()) {
    app.innerHTML = siteFeedbackBarHtml() + loadErrorShell(portalLoadError);
    return;
  }

  // Arrived via a password-reset link — force the "set new password" screen.
  if (recoveryMode) {
    app.innerHTML = siteFeedbackBarHtml() + viewReset();
    focusAuthField();
    return;
  }

  const user = currentUser();
  if (!user) {
    app.innerHTML = siteFeedbackBarHtml() + renderAuthScreen();
    focusAuthField();
    return;
  }

  if (user.role === 'student') {
    const allowed = ['student-home', 'curriculum', 'student-sessions', 'student-tests', 'session', 'quiz', 'discussion', 'account'];
    if (!allowed.includes(route.name)) route = { name: 'student-home', params: {} };
    // Class Sessions greyed out — bounce deep links to dashboard lock note
    if (SESSIONS_LOCKED && (route.name === 'student-sessions' || route.name === 'session')) {
      route = { name: 'student-home', params: {} };
    }
    const views = {
      'student-home': studentHome,
      curriculum: () => curriculumView(user),
      'student-sessions': studentSessions,
      'student-tests': studentTests,
      session: sessionDetail,
      quiz: quizView,
      discussion: discussionView,
      account: accountView,
    };
    const content = (views[route.name] || studentHome)(user);
    app.innerHTML = shell(user, studentNav(user), content);
  } else {
    const allowed = ['admin-home', 'admin-students', 'admin-student', 'admin-grading', 'grade', 'admin-crm', 'admin-content', 'admin-tests', 'curriculum', 'discussion', 'admin-access', 'account'];
    if (!allowed.includes(route.name)) route = { name: 'admin-home', params: {} };
    const views = {
      'admin-home': adminHome,
      'admin-students': adminStudents,
      'admin-student': adminStudentDetail,
      'admin-grading': adminGrading,
      grade: gradeView,
      'admin-crm': adminCRM,
      'admin-content': adminContent,
      'admin-tests': adminTests,
      curriculum: () => curriculumView(user),
      discussion: () => discussionView(user),
      'admin-access': adminAccess,
      account: () => accountView(user),
    };
    const content = (views[route.name] || adminHome)();
    app.innerHTML = shell(user, adminNav(), content);
  }

  // restore CRM search focus after a re-render triggered by typing
  if (render._refocusSearch) {
    const el = document.getElementById('crmSearch');
    if (el) {
      el.focus();
      const v = el.value;
      el.value = '';
      el.value = v; // caret to end
    }
    render._refocusSearch = false;
  }

  // Grade form: show live sum of Grading Breakdown points after paint.
  const gradeForm = document.getElementById('gradeForm');
  if (gradeForm) {
    updateBreakdownSumDisplay(gradeForm, sumBreakdownPoints(gradeForm));
  }

  // Discussion: pin week feeds, restore draft, keep focus after live re-render.
  document.querySelectorAll('.disc-feed-week').forEach((el) => {
    el.scrollTop = el.scrollHeight;
  });
  const weekKey = discFocusWeek || (disc.openWeek != null ? String(disc.openWeek) : null);
  const composerEl =
    (weekKey && document.getElementById(`discInput-${weekKey}`)) ||
    document.querySelector('textarea[data-action="disc-input"]');
  if (composerEl) {
    if (disc.draft && composerEl.value !== disc.draft) composerEl.value = disc.draft;
    composerEl.style.height = 'auto';
    composerEl.style.height = `${Math.min(composerEl.scrollHeight, 140)}px`;
    if (discWasFocused || disc.focusAfterRender) {
      composerEl.focus();
      const v = composerEl.value;
      composerEl.value = '';
      composerEl.value = v; // caret to end
    }
    disc.focusAfterRender = false;
  }
}

/** Focus a named auth field after paint (failed login → password, etc.). */
function focusAuthField() {
  if (!authFocus) return;
  const name = authFocus;
  authFocus = null;
  requestAnimationFrame(() => {
    const el = app.querySelector(`[name="${name}"]`);
    if (el && typeof el.focus === 'function') {
      el.focus();
      if (el.select && el.type !== 'password') {
        try { el.select(); } catch { /* ignore */ }
      }
    }
  });
}

/* ===========================================================================
   EVENT WIRING (delegated)
   ======================================================================== */
function actionFrom(e) {
  const node = e.target.closest('[data-action]');
  return node ? { action: node.dataset.action, node } : null;
}

/* Remember which curriculum / discussion week accordion is open. */
app.addEventListener('toggle', (e) => {
  const details = e.target;
  if (!(details instanceof HTMLDetailsElement)) return;
  if (details.classList.contains('wk') && details.open) {
    const wk = details.dataset.week;
    curricOpenWeek = wk != null ? Number(wk) : null;
  }
  if (details.classList.contains('disc-week') && details.open) {
    const wk = details.dataset.week;
    disc.openWeek = wk != null ? Number(wk) : null;
    disc.postWeek = disc.openWeek;
  }
}, true);

app.addEventListener('click', async (e) => {
  const hit = actionFrom(e);
  if (!hit) return;
  const { action, node } = hit;
  const d = node.dataset;

  switch (action) {
    case 'demo': {
      const role = d.role;
      const email = role === 'admin' ? 'admin@umof.org' : 'jordan@umof.org';
      const pw = role === 'admin' ? 'admin1234' : 'demo1234';
      const res = await login(email, pw);
      if (res.ok) await enterApp(res.user);
      break;
    }
    case 'auth-screen':
      goAuth(d.screen);
      break;
    case 'logout':
      store.stopRealtime();
      store.stopDiscussionRealtime();
      await logout();
      route = { name: null, params: {} };
      authScreen = 'login';
      authError = '';
      authInfo = '';
      authFieldErrors = {};
      portalLoadError = null;
      recoveryMode = false;
      render();
      break;
    case 'retry-enter': {
      const u = currentUser();
      if (u) await enterApp(u);
      else {
        portalLoadError = null;
        render();
      }
      break;
    }
    case 'go':
      go(d.route, { id: d.id, student: d.student, quiz: d.quiz });
      break;
    case 'refresh-progress': {
      toast('Refreshing submissions…');
      const res = await store.refreshProgress();
      if (res.ok) {
        toast(
          res.pending
            ? `Updated · ${res.pending} awaiting review`
            : `Updated · ${res.count ?? 0} submission${res.count === 1 ? '' : 's'} loaded`
        );
      } else {
        toast(res.error || 'Could not refresh submissions');
      }
      render();
      break;
    }
    case 'set-grade-week': {
      const w = d.week === 'all' ? 'all' : Number(d.week);
      setGradeWeekFilter(w === 'all' || !Number.isFinite(w) ? 'all' : w);
      render();
      break;
    }
    case 'remove-allowed': {
      if (
        !adminConfirmDanger({
          title: `Remove approved email?`,
          will: [
            `Remove “${d.email || 'this email'}” from the signup allowlist.`,
            'That person can no longer create a new student account.',
            'Existing accounts (if they already signed up) are NOT deleted.',
          ],
          note: ['This does not erase their test answers or discussion posts.'],
          severity: 'hard',
        })
      ) {
        break;
      }
      store.removeAllowedStudent(d.email);
      toast('Removed from approved list');
      render();
      break;
    }
    case 'curric-edit':
      curricEditing = true;
      render();
      break;
    case 'curric-save':
      curricEditing = false;
      toast('Curriculum saved ✓');
      render();
      break;
    case 'curric-cancel':
      curricEditing = false;
      toast('Exited edit mode');
      render();
      break;
    case 'save-curric-week': {
      const wk = Number(d.week);
      toast(`Week ${wk} saved ✓`);
      break;
    }
    case 'toggle-curric-week-publish': {
      const wk = Number(d.week);
      const week = (store.getCurriculum().weeks || []).find((x) => Number(x.week) === wk);
      if (!week) break;
      const willPublish = !!week.pending; // pending true → publish (pending false)
      if (willPublish) {
        if (
          !adminConfirmDanger({
            title: `Publish Week ${wk} syllabus to students?`,
            will: [
              'Students will see full Week syllabus content (objectives, assignment, etc.).',
              'This goes live immediately for anyone logged in as a student.',
            ],
            severity: 'soft',
          })
        ) {
          break;
        }
      } else if (
        !adminConfirmDanger({
          title: `Unpublish Week ${wk} syllabus?`,
          will: [
            'Students will only see “coming soon” for this week’s curriculum.',
            'They keep any test answers and discussion posts already saved.',
          ],
          note: ['You can publish again anytime.'],
          severity: 'hard',
        })
      ) {
        break;
      }
      curricOpenWeek = wk;
      store.updateCurriculumWeek(wk, { pending: !willPublish });
      toast(
        willPublish
          ? `Week ${wk} published to students ✓`
          : `Week ${wk} unpublished — students see “coming soon”`
      );
      render();
      break;
    }
    case 'add-curric-week': {
      curricEditing = true;
      const n = store.addCurriculumWeek();
      curricOpenWeek = n;
      toast(`Week ${n} added`);
      render();
      break;
    }
    case 'delete-curric-week': {
      const wk = Number(d.week);
      if (
        !adminConfirmDanger({
          title: `Delete Week ${wk} from the curriculum?`,
          will: [
            `Remove Week ${wk} from the syllabus outline permanently in the portal.`,
            'Students will no longer see that week’s curriculum content.',
            'Linked tests, sessions, and past student answers are NOT auto-deleted (manage those separately).',
          ],
          note: ['Prefer Unpublish if you only want to hide the week from students.'],
          severity: 'irreversible',
          requireType: true,
        })
      ) {
        break;
      }
      store.deleteCurriculumWeek(wk);
      if (Number(curricOpenWeek) === wk) curricOpenWeek = null;
      toast(`Week ${wk} deleted`);
      render();
      break;
    }
    case 'delete-material': {
      const mat = store.getAllMaterials().find((m) => m.id === d.id);
      if (
        !adminConfirmDanger({
          title: `Delete class material?`,
          will: [
            `Delete “${mat?.title || 'this material'}” from the materials library.`,
            'Students will no longer see or open this resource.',
          ],
          note: ['This cannot be undone from the portal (re-upload if needed).'],
          severity: 'irreversible',
        })
      ) {
        break;
      }
      store.deleteMaterial(d.id);
      toast('Material deleted');
      render();
      break;
    }
    case 'delete-post': {
      const user = currentUser();
      const post = store.getDiscussion().find((p) => p.id === d.id);
      if (!post) break;
      const mine = post.authorId === user.id;
      const who = mine ? 'your message' : `${post.authorName || 'this student'}’s message`;
      if (
        !adminConfirmDanger({
          title: `Delete discussion ${mine ? 'post' : 'post (moderation)'}?`,
          will: [
            `Remove ${who} from the live discussion board.`,
            'Classmates will no longer see that text.',
          ],
          note: [
            'If the failsafe archive is installed on Supabase, a backup copy may still exist for admins.',
            'Students cannot restore the post themselves.',
          ],
          severity: 'irreversible',
        })
      ) {
        break;
      }
      store.deleteDiscussionPost(d.id);
      if (disc.replyToId === d.id) disc.replyToId = null;
      toast('Message deleted');
      render();
      break;
    }
    case 'reply-post': {
      disc.replyToId = d.id || null;
      if (d.week) {
        disc.postWeek = Number(d.week);
        disc.openWeek = Number(d.week);
      }
      disc.focusAfterRender = true;
      render();
      break;
    }
    case 'cancel-reply': {
      disc.replyToId = null;
      disc.focusAfterRender = true;
      render();
      break;
    }
    case 'save-disc-week': {
      const week = Number(d.week);
      if (!week) break;
      const ta = document.querySelector(`textarea[data-action="disc-week-prompt"][data-week="${week}"]`);
      const text = ta ? ta.value : '';
      store.updateCurriculumWeek(week, { discussion: text });
      disc.openWeek = week;
      toast(`Week ${week} discussion prompt saved ✓`);
      render();
      break;
    }
    case 'toggle-disc-publish': {
      const week = Number(d.week);
      if (!week) break;
      const w = (store.getCurriculum().weeks || []).find((x) => Number(x.week) === week);
      if (!w) break;
      // Persist any unsaved prompt text before publishing
      const ta = document.querySelector(`textarea[data-action="disc-week-prompt"][data-week="${week}"]`);
      if (ta) store.updateCurriculumWeek(week, { discussion: ta.value });
      const nextLive = !isDiscussionLive(w);
      if (nextLive) {
        if (
          !adminConfirmDanger({
            title: `Publish Week ${week} discussion to students?`,
            will: [
              'Students can open Discussion for this week and post answers.',
              'They will see the discussion prompt you saved.',
            ],
            severity: 'soft',
          })
        ) {
          break;
        }
      } else if (
        !adminConfirmDanger({
          title: `Take Week ${week} discussion offline?`,
          will: [
            'Students can no longer post to this week’s discussion.',
            'Existing posts stay in the database (and archive, if installed).',
            'Students will see the week as offline until you publish again.',
          ],
          severity: 'hard',
        })
      ) {
        break;
      }
      // Publishing discussion also needs the syllabus week visible to students
      const updates = { discussionPublished: nextLive };
      if (nextLive && w.pending) updates.pending = false;
      if (nextLive && !String(w.discussion || ta?.value || '').trim()) {
        toast('Add a discussion prompt before publishing');
        break;
      }
      store.updateCurriculumWeek(week, updates);
      disc.openWeek = week;
      toast(
        nextLive
          ? `Week ${week} discussion is live for students ✓`
          : `Week ${week} discussion taken offline`
      );
      render();
      break;
    }
    case 'dismiss-banner':
      hideConnBanner();
      break;
    case 'dismiss-feedback': {
      try {
        localStorage.setItem(FEEDBACK_DISMISS_KEY, '1');
      } catch {
        /* ignore */
      }
      document.getElementById('siteFeedbackBar')?.remove();
      break;
    }
    case 'toggle-nav-group': {
      const id = d.group || 'more-tools';
      const el = node.closest('.nav-group');
      if (!el) break;
      const open = !el.classList.contains('open');
      el.classList.toggle('open', open);
      node.setAttribute('aria-expanded', open ? 'true' : 'false');
      setNavGroupOpen(id, open);
      break;
    }
    case 'toggle-help': {
      const id = d.helpId;
      if (!id) break;
      if (helpOpen.has(id)) helpOpen.delete(id);
      else helpOpen.add(id);
      render();
      break;
    }
    case 'dismiss-help': {
      dismissHelp(d.key);
      render();
      break;
    }
    case 'toggle-pw': {
      const wrap = node.closest('.pw-wrap');
      const input = wrap?.querySelector('input');
      if (!input) break;
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      node.textContent = show ? 'Hide' : 'Show';
      node.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      break;
    }
    case 'toggle-complete': {
      const user = currentUser();
      const prog = store.getProgress(user.id);
      const isDone = prog.completed.includes(d.id);
      store.setSessionComplete(user.id, d.id, !isDone);
      toast(isDone ? 'Marked as not done' : 'Session marked complete ✓');
      render();
      break;
    }
    case 'admin-toggle-complete': {
      const studentId = d.student;
      const sessionId = d.id;
      const prog = store.getProgress(studentId);
      const isDone = prog.completed.includes(sessionId);
      store.setSessionComplete(studentId, sessionId, !isDone);
      toast(isDone ? 'Marked as incomplete' : 'Session marked complete for student ✓');
      render();
      break;
    }
    case 'add-session':
      store.addSession();
      toast('Session added ✓');
      render();
      break;
    case 'toggle-quiz-live': {
      const q = store.getQuizById(d.id);
      if (!q) break;
      const goingLive = !q.published;
      if (goingLive) {
        if (
          !adminConfirmDanger({
            title: `Publish test “${q.title}”?`,
            will: [
              'Students will see this test under My Tests immediately.',
              'They can open it, answer questions, and submit for grading.',
            ],
            severity: 'soft',
          })
        ) {
          break;
        }
      } else if (
        !adminConfirmDanger({
          title: `Take test “${q.title}” offline?`,
          will: [
            'Students will no longer see this test under My Tests.',
            'Existing submissions stay for grading (not deleted).',
            'You can publish it again later.',
          ],
          severity: 'hard',
        })
      ) {
        break;
      }
      const res = await store.setQuizPublished(q.id, goingLive);
      if (!res?.ok) {
        toast(res?.error || 'Could not update publish state — try again');
        break;
      }
      toast(
        goingLive
          ? 'Test is now live — students see it under My Tests ✓'
          : 'Test taken offline — hidden from students'
      );
      render();
      break;
    }
    case 'clear-quiz-draft': {
      const user = currentUser();
      if (!user || !d.quiz) break;
      clearQuizDraft(user.id, d.quiz);
      toast('Draft cleared — answer boxes are blank');
      render();
      break;
    }
    case 'clear-quiz-subs': {
      const q = store.getQuizById(d.id);
      if (!q) break;
      if (
        !adminConfirmDanger({
          title: `Clear ALL student answers for “${q.title}”?`,
          will: [
            'Delete every student’s live submission for this test.',
            'Scores and graded feedback for this test disappear from Grading / My Tests.',
            'Every student gets a blank form and must answer again.',
          ],
          note: [
            'If Supabase failsafe archive is installed, prior answers may still be restorable for admins.',
            'Students cannot recover their own answers after this.',
          ],
          severity: 'irreversible',
          requireType: true,
        })
      ) {
        break;
      }
      const res = await store.clearAllSubmissionsForQuiz(q.id);
      if (!res.ok) {
        toast(res.error || 'Could not clear submissions');
        break;
      }
      toast(
        res.count
          ? `Cleared ${res.count} submission${res.count === 1 ? '' : 's'} — students see blank forms ✓`
          : 'No student submissions found for this test (already blank)'
      );
      render();
      break;
    }
    case 'clear-submission': {
      const studentId = d.student;
      const quizId = d.quiz;
      if (!studentId || !quizId) break;
      const stu = store.getUserById(studentId);
      const q = store.getQuizById(quizId);
      if (
        !adminConfirmDanger({
          title: `Reset test for one student?`,
          will: [
            `Remove live answers for “${q?.title || quizId}”.`,
            `Student: ${stu?.name || 'Unknown'} (${stu?.email || studentId}).`,
            'Their My Tests form goes blank so they can submit again.',
            'Any grade/score for this test is cleared from the live portal.',
          ],
          note: [
            'If failsafe archive is installed, admins may still restore from submission_archive.',
            'This student will not see their old answers until restored or re-submitted.',
          ],
          severity: 'irreversible',
        })
      ) {
        break;
      }
      const res = await store.clearSubmission(studentId, quizId);
      if (!res.ok) {
        toast(res.error || 'Could not reset submission');
        break;
      }
      clearQuizDraft(studentId, quizId);
      toast('Submission cleared — student gets a blank form ✓');
      render();
      break;
    }
    case 'delete-quiz': {
      const q = store.getQuizById(d.id);
      if (!q) break;
      if (
        !adminConfirmDanger({
          title: `Delete test “${q.title}”?`,
          will: [
            'Remove this test from the catalog and from student My Tests.',
            'Live submissions tied to this test may be deleted (database cascade) or become unusable.',
            'Discussion grades and other tests are not affected.',
          ],
          note: [
            'Prefer “Take offline” if you only want to hide the test.',
            'Archive snapshots may still hold past answers if failsafe SQL was run.',
          ],
          severity: 'irreversible',
          requireType: true,
        })
      ) {
        break;
      }
      const res = await store.deleteQuiz(q.id);
      if (res.ok && editingQuizId === q.id) editingQuizId = null;
      toast(res.ok ? 'Test deleted' : res.error || 'Could not delete test');
      render();
      break;
    }
    case 'edit-quiz': {
      editingQuizId = d.id || null;
      go('admin-tests');
      break;
    }
    case 'cancel-edit-quiz': {
      editingQuizId = null;
      render();
      break;
    }

    case 'toggle-session-publish': {
      const s = store.getSessionById(d.id);
      if (!s) break;
      const next = s.published === false;
      if (next) {
        if (
          !adminConfirmDanger({
            title: `Publish session “${s.title}”?`,
            will: ['Students can open this class session / recording when Sessions is available.'],
            severity: 'soft',
          })
        ) {
          break;
        }
      } else if (
        !adminConfirmDanger({
          title: `Unpublish session “${s.title}”?`,
          will: [
            'Students lose access to this session immediately.',
            'Completion history is kept; content is just hidden.',
          ],
          severity: 'hard',
        })
      ) {
        break;
      }
      const res = await store.setSessionPublished(s.id, next);
      if (!res?.ok) {
        toast(res?.error || 'Could not update session publish state');
      } else {
        toast(next ? `“${s.title}” published to students ✓` : `“${s.title}” unpublished`);
      }
      render();
      break;
    }
    case 'publish-week': {
      const wk = Number(d.week);
      const publish = d.publish !== '0' && d.publish !== 'false';
      if (publish) {
        if (
          !adminConfirmDanger({
            title: `Publish entire Week ${wk}?`,
            will: [
              'Syllabus for the week becomes visible to students (if not already).',
              'All sessions for this week are published.',
              'Linked tests for this week are set live under My Tests.',
            ],
            note: ['Students see the change immediately.'],
            severity: 'hard',
          })
        ) {
          break;
        }
      } else if (
        !adminConfirmDanger({
          title: `Unpublish entire Week ${wk}?`,
          will: [
            'Hide syllabus, sessions, and tests for this week from students.',
            'Does NOT delete student answers or discussion posts already saved.',
          ],
          note: ['You can publish the week again later.'],
          severity: 'hard',
        })
      ) {
        break;
      }
      const res = await store.setWeekPublished(wk, publish);
      if (!res?.ok) {
        toast(res?.error || `Could not update Week ${wk}`);
      } else if (publish) {
        toast(
          `Week ${wk} live · ${res.sessions} session${res.sessions === 1 ? '' : 's'}${res.quizzes ? ` · ${res.quizzes} test${res.quizzes === 1 ? '' : 's'}` : ''}${res.curriculum ? ' · syllabus' : ''} ✓`
        );
      } else {
        toast(`Week ${wk} unpublished for students`);
      }
      render();
      break;
    }
    case 'delete-session': {
      const s = store.getSessionById(d.id);
      if (
        !adminConfirmDanger({
          title: `Delete session “${s?.title || 'this session'}”?`,
          will: [
            'Remove this class session from the catalog.',
            'Students lose access to its recording/materials link.',
            'Materials attached only to this session may be orphaned or removed.',
          ],
          note: ['This cannot be undone from the portal.'],
          severity: 'irreversible',
          requireType: true,
        })
      ) {
        break;
      }
      store.deleteSession(d.id);
      toast('Session deleted');
      render();
      break;
    }
    case 'reset':
      if (
        !adminConfirmDanger({
          title: 'Reset ALL demo data?',
          will: [
            'Wipe local demo progress, grades, CRM samples, and discussion seed data in this browser.',
            'Reload the built-in sample students and Week tests.',
            'Does NOT change your live Supabase production database.',
          ],
          note: ['Only available in local demo mode (no Supabase keys).'],
          severity: 'irreversible',
          requireType: true,
        })
      ) {
        break;
      }
      store.resetDemo();
      toast('Demo data reset');
      render();
      break;
    case 'toggle-side':
      toggleSideNav();
      break;
    case 'close-side':
      closeSideNav();
      break;
    case 'crm-view':
      crm.view = d.view;
      crm.q = '';
      crm.status = 'all';
      crm.adding = false;
      crm.editingId = null;
      crm.notesOpen.clear();
      render();
      break;
    case 'toggle-notes': {
      const opening = !crm.notesOpen.has(d.id);
      opening ? crm.notesOpen.add(d.id) : crm.notesOpen.delete(d.id);
      render();
      if (opening) document.getElementById(`note-${d.id}`)?.focus();
      break;
    }
    case 'toggle-add-lead':
      crm.adding = !crm.adding;
      crm.editingId = null;
      render();
      break;
    case 'edit-lead':
      crm.editingId = d.id;
      crm.adding = false;
      render();
      document.querySelector('.crm-add')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      document.querySelector('#editLeadForm [name="name"]')?.focus();
      break;
    case 'cancel-edit-lead':
      crm.editingId = null;
      render();
      break;
    case 'delete-lead': {
      const lead = store.getLeads().find((l) => l.id === d.id);
      if (
        !adminConfirmDanger({
          title: `Delete CRM record “${lead?.name || 'this person'}”?`,
          will: [
            'Permanently remove this lead/prospect from the CRM.',
            'Does not delete a student portal account if they already enrolled.',
          ],
          severity: 'irreversible',
        })
      ) {
        break;
      }
      store.deleteLead(d.id);
      toast('Record deleted');
      render();
      break;
    }
    case 'enable-login': {
      const lead = store.getLeads().find((l) => l.id === d.id);
      if (!lead?.email) {
        toast('Add an email to this record first');
        break;
      }
      // Marking the record "enrolled" auto-adds the email to the allowlist.
      store.updateLeadStatus(lead.id, 'enrolled');
      toast('Login enabled ✓ — they can now create an account at /portal.html');
      render();
      break;
    }
    case 'clear-leads':
      if (
        !adminConfirmDanger({
          title: 'Clear ALL CRM leads?',
          will: [
            'Permanently delete every lead/prospect record in the CRM.',
            'Enrolled student portal accounts are NOT deleted.',
            'This cannot be undone from the portal.',
          ],
          severity: 'irreversible',
          requireType: true,
        })
      ) {
        break;
      }
      store.clearLeads();
      toast('CRM cleared');
      render();
      break;
    case 'export-csv': {
      const r = crmRows();
      downloadCSV(r.columns, r.exportRows, `umof-${r.kind}-${todayISO()}.csv`);
      toast('CSV downloaded');
      break;
    }
    case 'export-pdf': {
      const r = crmRows();
      exportPDF({
        title: r.kind === 'leads' ? 'CRM — Leads & Prospects' : 'CRM — Enrolled Students',
        subtitle: `Generated ${fmtDate(todayISO())} · ${r.exportRows.length} records`,
        columns: r.columns,
        rows: r.exportRows,
      });
      break;
    }
    case 'export-word': {
      const r = crmRows();
      exportWord({
        title: r.kind === 'leads' ? 'CRM — Leads & Prospects' : 'CRM — Enrolled Students',
        subtitle: `Generated ${fmtDate(todayISO())} · ${r.exportRows.length} records`,
        columns: r.columns,
        rows: r.exportRows,
        filename: `umof-${r.kind}-${todayISO()}.doc`,
      });
      toast('Word document downloaded');
      break;
    }
    case 'export-students-csv': {
      const { cols, rows } = studentExportData();
      downloadCSV(cols, rows, `umof-students-${todayISO()}.csv`);
      toast('CSV downloaded');
      break;
    }
    case 'export-students-pdf': {
      const { cols, rows } = studentExportData();
      exportPDF({ title: 'Students — Progress Report', subtitle: `Generated ${fmtDate(todayISO())} · ${rows.length} students`, columns: cols, rows });
      break;
    }
    case 'export-students-word': {
      const { cols, rows } = studentExportData();
      exportWord({ title: 'Students — Progress Report', subtitle: `Generated ${fmtDate(todayISO())} · ${rows.length} students`, columns: cols, rows, filename: `umof-students-${todayISO()}.doc` });
      toast('Word document downloaded');
      break;
    }
    case 'apply-q-sum': {
      const form = document.getElementById('gradeForm');
      if (!form) break;
      const sum = sumBreakdownPoints(form);
      if (sum == null) {
        toast('Enter at least one breakdown score first');
        break;
      }
      const scoreInput = form.querySelector('#gradeScoreInput') || form.score;
      if (scoreInput) scoreInput.value = Math.round(sum);
      updateBreakdownSumDisplay(form, sum);
      toast(`Final score set to ${Math.round(sum)}`);
      break;
    }
  }
});

/** Pull optional instructor-only note out of a stored gradeDerivation string. */
function extractInstructorNote(derivation) {
  if (!derivation) return '';
  const text = String(derivation);
  const marker = '\n\nInstructor note: ';
  const i = text.indexOf(marker);
  if (i >= 0) return text.slice(i + marker.length);
  if (text.startsWith('Grading Breakdown')) return '';
  return text;
}

/** Sum Grading Breakdown criterion inputs on the grade form (null if none filled). */
function sumBreakdownPoints(form) {
  const inputs = form.querySelectorAll('.gb-score-input');
  if (!inputs.length) return null;
  let sum = 0;
  let any = false;
  inputs.forEach((inp) => {
    const v = Number(inp.value);
    if (inp.value !== '' && Number.isFinite(v)) {
      sum += v;
      any = true;
    }
  });
  return any ? sum : null;
}

function updateBreakdownSumDisplay(form, sum) {
  const text = sum == null ? '—' : String(Math.round(sum));
  const sumEl = form.querySelector('#qScoreSum') || document.getElementById('qScoreSum');
  if (sumEl) sumEl.textContent = text;
  const hintEl = form.querySelector('#qScoreSumHint') || document.getElementById('qScoreSumHint');
  if (hintEl) hintEl.textContent = text;
}

/** Collect rubric criterion points from the grade form. */
function collectRubricScores(form) {
  const inputs = form.querySelectorAll('.gb-score-input');
  if (!inputs.length) return null;
  const scores = {};
  let any = false;
  inputs.forEach((inp) => {
    const cid = inp.dataset.cid;
    if (!cid) return;
    if (inp.value === '') return;
    const v = Number(inp.value);
    if (!Number.isFinite(v)) return;
    scores[cid] = v;
    any = true;
  });
  return any ? scores : null;
}

app.addEventListener('submit', async (e) => {
  const form = e.target;
  e.preventDefault();

  if (form.id === 'loginForm') {
    authForm.email = normalizeEmail(form.email.value);
    authFieldErrors = {};
    authError = '';
    authInfo = '';
    const emailErr = validateEmail(form.email.value);
    const pwErr = validatePassword(form.password.value, { label: 'Password' });
    if (emailErr) authFieldErrors.email = emailErr;
    if (pwErr) authFieldErrors.password = pwErr;
    if (emailErr || pwErr) {
      authFocus = emailErr ? 'email' : 'password';
      render();
      return;
    }
    const unbusy = setBusy(form, 'Signing in…');
    const res = await login(form.email.value, form.password.value);
    if (res.ok) {
      authFieldErrors = {};
      authError = '';
      await enterApp(res.user);
    } else {
      authError = res.error || 'Email or password is incorrect.';
      authInfo = '';
      authFieldErrors = {};
      authFocus = 'password';
      unbusy();
      render();
    }
    return;
  }

  if (form.id === 'signupForm') {
    authForm.email = normalizeEmail(form.email.value);
    authForm.name = String(form.name.value || '').trim();
    authFieldErrors = {};
    authError = '';
    authInfo = '';
    const nameErr = !authForm.name ? 'Enter your full name.' : '';
    const emailErr = validateEmail(form.email.value);
    const pwErr = validatePassword(form.password.value, { min: 8, label: 'Password' });
    const confirmErr =
      form.password.value !== form.confirm?.value
        ? 'Passwords don’t match.'
        : validatePassword(form.confirm?.value, { min: 8, label: 'Confirm password' });
    if (nameErr) authFieldErrors.name = nameErr;
    if (emailErr) authFieldErrors.email = emailErr;
    if (pwErr) authFieldErrors.password = pwErr;
    if (confirmErr) authFieldErrors.confirm = confirmErr;
    if (nameErr || emailErr || pwErr || confirmErr) {
      authFocus = nameErr ? 'name' : emailErr ? 'email' : pwErr ? 'password' : 'confirm';
      render();
      return;
    }
    const unbusy = setBusy(form, 'Creating…');
    const res = await signUp(form.name.value, form.email.value, form.password.value);
    if (!res.ok) {
      unbusy();
      authError = res.error;
      authInfo = '';
      authFocus = 'email';
      render();
      return;
    }
    if (res.needsConfirmation) {
      authScreen = 'login';
      authError = '';
      authInfo = 'Account created. Check your email to confirm it, then sign in.';
      authFieldErrors = {};
      authFocus = 'password';
      render();
    } else {
      authError = '';
      authInfo = '';
      authFieldErrors = {};
      await enterApp(res.user);
    }
    return;
  }

  if (form.id === 'forgotForm') {
    authForm.email = normalizeEmail(form.email.value);
    authFieldErrors = {};
    authError = '';
    authInfo = '';
    const emailErr = validateEmail(form.email.value);
    if (emailErr) {
      authFieldErrors.email = emailErr;
      authFocus = 'email';
      render();
      return;
    }
    const unbusy = setBusy(form, 'Sending…');
    const res = await requestPasswordReset(form.email.value);
    unbusy();
    authScreen = 'login';
    authFieldErrors = {};
    if (res.ok) {
      authError = '';
      authInfo = 'If that email has an account, a reset link is on its way. Check your inbox and spam folder.';
    } else {
      authError = res.error;
      authInfo = '';
    }
    authFocus = 'email';
    render();
    return;
  }

  if (form.id === 'resetForm') {
    authFieldErrors = {};
    authError = '';
    authInfo = '';
    const pwErr = validatePassword(form.password.value, { min: 8, label: 'New password' });
    const confirmErr =
      form.password.value !== form.confirm?.value
        ? 'Passwords don’t match.'
        : validatePassword(form.confirm?.value, { min: 8, label: 'Confirm password' });
    if (pwErr) authFieldErrors.password = pwErr;
    if (confirmErr) authFieldErrors.confirm = confirmErr;
    if (pwErr || confirmErr) {
      authFocus = pwErr ? 'password' : 'confirm';
      render();
      return;
    }
    const unbusy = setBusy(form, 'Updating…');
    const res = await updatePassword(form.password.value);
    if (!res.ok) {
      unbusy();
      authError = res.error;
      authFocus = 'password';
      render();
      return;
    }
    recoveryMode = false;
    authError = '';
    authInfo = '';
    authFieldErrors = {};
    const user = await initAuth();
    if (user) await enterApp(user);
    else {
      authScreen = 'login';
      authInfo = 'Password updated — please sign in with your new password.';
      authFocus = 'password';
      render();
    }
    return;
  }

  if (form.id === 'approvedForm') {
    const res = store.addAllowedStudent(form.email.value, form.note.value);
    toast(res.ok ? 'Email approved ✓' : res.error);
    if (res.ok) render();
    return;
  }

  if (form.id === 'createTestForm') {
    const week = Number(form.week.value);
    const title = form.title.value.trim();
    const questions = form.questions.value;
    const due = form.due.value || null;
    const publishNow = !!form.publishNow?.checked;
    const editId = form.dataset.editId || editingQuizId || '';
    if (editId) {
      const unbusy = setBusy(form, 'Saving…');
      const res = await store.updateWeeklyTest(editId, {
        week,
        title,
        questions,
        due,
        published: publishNow,
      });
      unbusy();
      if (!res.ok) {
        toast(res.error || 'Could not save test');
        return;
      }
      editingQuizId = null;
      toast(publishNow ? 'Test saved and live on My Tests ✓' : 'Test saved (offline) ✓');
      render();
      return;
    }
    // Prefer update when a primary test already exists for this week
    const existing = store.findPrimaryWeekTest(week);
    if (existing) {
      const replace = adminConfirmDanger({
        title: `Week ${week} already has “${existing.title}”`,
        will: [
          'Overwrite that test’s title, questions, due date, and publish state with what you just entered.',
          'Student answers already submitted stay keyed by question id (new questions may show blank until re-answered).',
        ],
        note: ['Cancel (or choose No) to create a separate test instead of replacing.'],
        severity: 'hard',
      });
      if (replace) {
        const unbusy = setBusy(form, 'Saving…');
        const res = await store.updateWeeklyTest(existing.id, {
          week,
          title: title || existing.title,
          questions,
          due,
          published: publishNow,
        });
        unbusy();
        if (!res.ok) {
          toast(res.error || 'Could not update test');
          return;
        }
        toast(publishNow ? 'Test updated and published ✓' : 'Test updated (offline) ✓');
        form.reset();
        if (form.week) form.week.value = String(week);
        render();
        return;
      }
    }
    const unbusy = setBusy(form, 'Creating…');
    const res = await store.createWeeklyTest({
      week,
      title,
      questions,
      due,
      published: publishNow,
    });
    unbusy();
    if (!res.ok) {
      toast(res.error || 'Could not create test');
      return;
    }
    toast(
      publishNow
        ? `Test created and published to students ✓`
        : `Test created (offline) — use Publish when ready ✓`
    );
    form.reset();
    if (form.week) form.week.value = String(week);
    render();
    return;
  }

  if (form.id === 'addMaterialForm') {
    const title = form.title.value.trim();
    const url = form.url.value.trim();
    if (!title || !url) {
      toast('Add a title and a link');
      return;
    }
    store.addMaterialLink(form.sessionId.value, { kind: 'link', title, url });
    toast('Link added ✓');
    form.reset();
    render();
    return;
  }

  if (form.id === 'addLeadForm') {
    const name = form.name.value.trim();
    if (!name) {
      toast('Enter a name');
      return;
    }
    store.addLead({
      name,
      email: form.email.value.trim(),
      phone: form.phone.value.trim(),
      source: form.source.value.trim(),
      interest: form.interest.value.trim(),
      status: form.status.value,
      createdAt: form.createdAt.value || todayISO(),
      notes: form.notes.value.trim(),
      grantAwarded: form.grantAwarded.checked,
      grantAmount: Number(form.grantAmount.value) || 0,
    });
    crm.adding = false;
    toast('Record added ✓');
    render();
    return;
  }

  if (form.id === 'editLeadForm') {
    const name = form.name.value.trim();
    if (!name) {
      toast('Enter a name');
      return;
    }
    store.updateLead(form.dataset.id, {
      name,
      email: form.email.value.trim(),
      phone: form.phone.value.trim(),
      source: form.source.value.trim(),
      interest: form.interest.value.trim(),
      status: form.status.value,
      createdAt: form.createdAt.value || todayISO(),
      notes: form.notes.value.trim(),
      grantAwarded: form.grantAwarded.checked,
      grantAmount: Number(form.grantAmount.value) || 0,
    });
    crm.editingId = null;
    toast('Record updated ✓');
    render();
    return;
  }

  if (form.id === 'nameForm') {
    const res = await updateDisplayName(displayNameWithCfwf(form.name.value));
    toast(res.ok ? 'Name updated ✓' : res.error || 'Could not update name');
    if (res.ok) render();
    return;
  }

  if (form.id === 'pwForm') {
    const pwErr = validatePassword(form.password.value, { min: 8, label: 'New password' });
    if (pwErr) {
      toast(pwErr);
      return;
    }
    if (form.password.value !== form.confirm.value) {
      toast('Passwords don’t match');
      return;
    }
    const unbusy = setBusy(form, 'Updating…');
    const res = await updatePassword(form.password.value);
    unbusy();
    toast(res.ok ? 'Password updated ✓' : res.error || 'Could not update password');
    if (res.ok) form.reset();
    return;
  }

  if (form.id === 'quizForm') {
    const user = currentUser();
    const quiz = store.getQuizById(form.dataset.quiz);
    const answers = {};
    quiz.questions.forEach((q) => {
      const sel = form.querySelector(`input[name="${q.id}"]:checked`);
      answers[q.id] = sel ? Number(sel.value) : -1;
    });
    const unbusy = setBusy(form, 'Saving…');
    const res = await store.submitAutoQuiz(user.id, quiz.id, answers, nowISO());
    if (res.ok) {
      clearQuizDraft(user.id, quiz.id);
      toast(`Scored ${res.score}% (${res.correct}/${res.total}) · saved to your record ✓`);
      hideConnBanner();
      render();
    } else {
      unbusy();
      toast(`Could not save quiz: ${res.error || 'try again'}`, 4000);
      showConnBanner('Your quiz score could not be saved. Check your connection and try again.');
    }
    return;
  }

  if (form.classList?.contains('disc-grade-form')) {
    const studentId = form.dataset.student;
    const week = Number(form.dataset.week);
    const score = form.score?.value;
    const admin = currentUser();
    const unbusy = setBusy(form, 'Saving…');
    const res = await store.gradeDiscussion(
      studentId,
      week,
      score,
      '',
      displayNameWithCfwf(admin?.name || '') || 'Instructor'
    );
    if (res.ok) {
      toast(`Week ${week} discussion grade saved ✓`);
      hideConnBanner();
      render();
    } else {
      unbusy();
      toast(res.error || 'Could not save discussion grade');
    }
    return;
  }

  if (form.id === 'manualForm') {
    const user = currentUser();
    const quizId = form.dataset.quiz;
    const unbusy = setBusy(form, 'Submitting…');
    const res = await store.submitManual(user.id, quizId, form.answer.value.trim(), nowISO());
    if (res.ok) {
      clearQuizDraft(user.id, quizId);
      toast('Submitted · saved for your instructor ✓');
      hideConnBanner();
      render();
    } else {
      unbusy();
      toast(`Could not save submission: ${res.error || 'try again'}`, 4000);
      showConnBanner('Your test was not saved. Your draft is still on this device — try submit again.');
    }
    return;
  }

  if (form.id === 'writtenForm') {
    const user = currentUser();
    const quiz = store.getQuizById(form.dataset.quiz);
    if (!quiz) {
      toast('Test not found — go back to My Tests and open it again');
      return;
    }
    if (user.role !== 'student' && user.role !== 'admin') {
      toast('Only students can submit tests');
      return;
    }
    const answers = {};
    const questions = quiz.questions || [];
    // Prefer FormData so field names with hyphens (qw2-1) always resolve
    const fd = new FormData(form);
    questions.forEach((qq) => {
      const raw = fd.get(qq.id);
      const isMc = Array.isArray(qq.options) && qq.options.length >= 2;
      if (isMc) {
        // Store chosen index (0=A, 1=B, …) for grading / review
        if (raw == null || raw === '') answers[qq.id] = '';
        else {
          const n = Number(raw);
          answers[qq.id] = Number.isFinite(n) ? n : String(raw).trim();
        }
      } else {
        answers[qq.id] = String(raw != null ? raw : '').trim();
      }
    });
    // Fallback: scan fields if FormData missed anything
    form.querySelectorAll('textarea.quiz-answer, textarea[name], input[type="radio"]:checked').forEach((el) => {
      const name = el.getAttribute('name');
      if (!name || answers[name] !== undefined && answers[name] !== '') return;
      if (el.type === 'radio') answers[name] = Number(el.value);
      else answers[name] = (el.value || '').trim();
    });
    const missing = questions.filter((qq) => {
      const v = answers[qq.id];
      if (v == null || v === '') return true;
      if (typeof v === 'string' && !String(v).trim()) return true;
      return false;
    });
    if (missing.length) {
      toast(`Please answer all questions (${missing.length} still blank)`);
      return;
    }
    // Fully keyed multiple-choice → auto-score path
    const allMcKeyed =
      questions.length > 0 &&
      questions.every(
        (qq) =>
          Array.isArray(qq.options) &&
          qq.options.length >= 2 &&
          qq.correctIndex != null &&
          Number.isFinite(Number(qq.correctIndex))
      );
    const unbusy = setBusy(form, 'Submitting…');
    let res;
    if (allMcKeyed || quiz.type === 'auto') {
      // Coerce all to numbers for auto scorer
      const autoAns = {};
      questions.forEach((qq) => {
        autoAns[qq.id] = Number(answers[qq.id]);
      });
      // submitAutoQuiz requires type auto — temporarily ok if we set type on create
      if (quiz.type !== 'auto') {
        // Score locally then submit as graded manual with score
        let correct = 0;
        questions.forEach((qq) => {
          if (Number(autoAns[qq.id]) === Number(qq.correctIndex)) correct += 1;
        });
        const total = questions.length;
        const score = Math.round((correct / total) * 100);
        res = await store.submitWritten(user.id, quiz.id, autoAns, nowISO());
        if (res.ok) {
          await store.gradeSubmission(
            user.id,
            quiz.id,
            {
              score,
              feedback: `Auto-scored multiple choice: ${correct} of ${total} correct.`,
              scoringMethod: 'auto',
              gradeDerivation: `Auto-scored: ${correct} of ${total} questions correct → ${score}%.`,
              gradedBy: 'System',
            },
            nowISO()
          );
          res = { ok: true, score, correct, total };
        }
      } else {
        res = await store.submitAutoQuiz(user.id, quiz.id, autoAns, nowISO());
      }
    } else {
      res = await store.submitWritten(user.id, quiz.id, answers, nowISO());
    }
    if (res.ok) {
      clearQuizDraft(user.id, quiz.id);
      toast(
        res.score != null
          ? `Submitted · score ${res.score}% ✓`
          : 'Submitted · your instructor can grade it under Grading ✓'
      );
      hideConnBanner();
      render();
    } else {
      unbusy();
      toast(`Could not save submission: ${res.error || 'try again'}`, 4000);
      showConnBanner('Your test was not saved. Your draft is still on this device — try submit again.');
    }
    return;
  }

  if (form.classList?.contains('discForm') || form.dataset?.form === 'disc' || form.id === 'discForm') {
    const user = currentUser();
    const body = form.body?.value?.trim() || '';
    if (!body) return;
    const parentId = disc.replyToId || null;
    const week = Number(form.dataset.week || form.week?.value || disc.postWeek) || null;
    store.addDiscussionPost(user, body, parentId, week);
    disc.draft = '';
    disc.replyToId = null;
    disc.postWeek = week;
    disc.openWeek = week;
    disc.focusAfterRender = true;
    render();
    return;
  }

  if (form.id === 'gradeForm') {
    const studentId = form.dataset.student;
    const quizId = form.dataset.quiz;
    const quiz = store.getQuizById(quizId);
    const max = quiz?.maxScore || 100;
    let score = Number(form.score.value);
    if (!Number.isFinite(score)) {
      toast('Enter a valid score');
      return;
    }
    score = Math.round(score);
    if (score < 0 || score > max) {
      toast(`Score must be between 0 and ${max}`);
      return;
    }

    const internalNote = (form.gradeNote?.value || form.gradeDerivation?.value || '').trim();

    // Grading Breakdown (5 criteria × 20) for written / manual assignments.
    let questionScores = null;
    let scoringMethod = 'instructor';
    let gradeDerivation = internalNote;

    if (form.dataset.rubric === '1') {
      questionScores = collectRubricScores(form);
      if (!questionScores) {
        toast('Enter the Grading Breakdown points for each criterion');
        return;
      }
      // Validate each criterion is within 0–max.
      for (const c of store.GRADING_BREAKDOWN) {
        if (questionScores[c.id] == null) {
          toast(`Enter points for “${c.label}”`);
          return;
        }
        const v = Number(questionScores[c.id]);
        if (!Number.isFinite(v) || v < 0 || v > c.max) {
          toast(`“${c.label}” must be between 0 and ${c.max}`);
          return;
        }
        questionScores[c.id] = Math.round(v);
      }
      const sum = store.GRADING_BREAKDOWN.reduce((acc, c) => acc + Number(questionScores[c.id] || 0), 0);
      // Prefer the rubric total as the final score when they differ.
      if (score !== sum) {
        score = Math.round(sum);
        const scoreInput = form.querySelector('#gradeScoreInput') || form.score;
        if (scoreInput) scoreInput.value = score;
      }
      scoringMethod = 'rubric';
      gradeDerivation = store.formatGradingBreakdown(questionScores, score, max);
      if (internalNote && !internalNote.startsWith('Grading Breakdown')) {
        gradeDerivation = `${gradeDerivation}\n\nInstructor note: ${internalNote}`;
      }
    } else if (quiz?.type === 'auto') {
      scoringMethod = 'auto';
      if (!gradeDerivation) {
        const sub0 = store.getProgress(studentId).submissions?.[quizId];
        if (sub0?.correct != null && sub0?.total) {
          gradeDerivation = `Auto-scored: ${sub0.correct} of ${sub0.total} questions correct → ${score}%. Formula: (correct ÷ total) × 100, rounded.`;
        } else {
          gradeDerivation = `Auto-scored multiple-choice: final score ${score}%.`;
        }
      }
    }

    const admin = currentUser();
    const wasGraded = store.getProgress(studentId).submissions?.[quizId]?.status === 'graded';
    const unbusy = setBusy(form, 'Saving grade…');
    const res = await store.gradeSubmission(
      studentId,
      quizId,
      {
        score,
        feedback: form.feedback.value.trim(),
        gradeDerivation,
        questionScores,
        scoringMethod,
        gradedBy: displayNameWithCfwf(admin?.name || admin?.email || 'Instructor'),
      },
      nowISO()
    );
    if (res.ok) {
      toast(wasGraded ? 'Grade & breakdown updated ✓' : 'Grade saved with breakdown ✓');
      hideConnBanner();
      go('admin-student', { id: studentId });
    } else {
      unbusy();
      toast(`Could not save grade: ${res.error || 'try again'}`, 4000);
      showConnBanner('Grade was not saved to the server. Try again.');
    }
    return;
  }
});

app.addEventListener('input', (e) => {
  // Live sum of Grading Breakdown points on the grade form (no full re-render).
  if (e.target?.classList?.contains('gb-score-input')) {
    const form = e.target.closest('#gradeForm');
    if (form) {
      const sum = sumBreakdownPoints(form);
      updateBreakdownSumDisplay(form, sum);
      // Keep final score in sync as criteria are filled.
      if (sum != null) {
        const scoreInput = form.querySelector('#gradeScoreInput') || form.score;
        if (scoreInput) scoreInput.value = Math.round(sum);
      }
    }
  }

  const hit = actionFrom(e);
  if (!hit) return;
  if (hit.action === 'crm-search') {
    crm.q = e.target.value;
    render._refocusSearch = true;
    render();
  } else if (hit.action === 'auth-field') {
    const name = e.target.name;
    if (name === 'email') authForm.email = e.target.value;
    if (name === 'name') authForm.name = e.target.value;
    // Clear field-level error as they type
    if (authFieldErrors[name]) {
      delete authFieldErrors[name];
      const errEl = document.getElementById(`err-${name}`);
      if (errEl) errEl.remove();
      e.target.removeAttribute('aria-invalid');
    }
  } else if (hit.action === 'disc-input') {
    // Capture the draft (so a live re-render can't lose it) and auto-grow the box.
    disc.draft = e.target.value;
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px`;
  } else if (hit.action === 'quiz-draft') {
    const form = e.target.closest('form');
    const user = currentUser();
    if (!form || !user || !form.dataset.quiz) return;
    const quizId = form.dataset.quiz;
    if (form.id === 'manualForm') {
      saveQuizDraft(user.id, quizId, { answer: form.answer?.value || '' });
    } else if (form.id === 'writtenForm') {
      const answers = {};
      [...form.querySelectorAll('textarea[name]')].forEach((ta) => {
        answers[ta.name] = ta.value;
      });
      saveQuizDraft(user.id, quizId, { answers });
    }
    const hint = form.querySelector('#draftHint');
    if (hint) {
      hint.hidden = false;
      hint.textContent = 'Draft saved on this device · not submitted yet';
      hint.classList.remove('muted');
    }
  }
});

/* Enter posts the message; Shift+Enter inserts a newline (chat convention). */
app.addEventListener('keydown', (e) => {
  if (
    e.target.matches?.('textarea[data-action="disc-input"]') &&
    e.key === 'Enter' &&
    !e.shiftKey
  ) {
    e.preventDefault();
    e.target.closest('form')?.requestSubmit();
  }
  if (e.key === 'Escape') {
    if (document.querySelector('.portal-shell.side-open')) closeSideNav();
    if (disc.replyToId) {
      disc.replyToId = null;
      disc.focusAfterRender = true;
      render();
    }
  }
});

app.addEventListener('change', async (e) => {
  const hit = actionFrom(e);
  if (!hit) return;
  const { action, node } = hit;
  if (action === 'lead-status') {
    store.updateLeadStatus(node.dataset.id, node.value);
    toast(node.value === 'enrolled' ? 'Marked enrolled — they can now create a login' : 'Status updated');
    render();
  } else if (action === 'lead-notes') {
    store.updateLeadNotes(node.dataset.id, node.value);
    toast('Note saved');
  } else if (action === 'crm-status') {
    crm.status = node.value;
    render();
  } else if (action === 'lead-grant' || action === 'student-grant') {
    const amt = Number(node.closest('tr')?.querySelector('.grant-amt')?.value) || 300;
    const fn = action === 'lead-grant' ? store.setLeadGrant : store.setStudentGrant;
    fn(node.dataset.id, node.checked, amt);
    toast(node.checked ? 'Grant marked ✓' : 'Grant removed');
    render();
  } else if (action === 'lead-grant-amt' || action === 'student-grant-amt') {
    const fn = action === 'lead-grant-amt' ? store.setLeadGrant : store.setStudentGrant;
    fn(node.dataset.id, true, Number(node.value) || 0);
    toast('Grant amount updated');
    render();
  } else if (action === 'upload-video') {
    const file = node.files && node.files[0];
    if (!file) return;
    toast('Uploading video… this can take a moment.');
    const res = await store.uploadSessionVideo(node.dataset.session, file);
    toast(res.ok ? 'Video uploaded ✓' : `Upload failed: ${res.error}`);
    render();
  } else if (action === 'material-file') {
    const file = node.files && node.files[0];
    if (!file) return;
    const t = file.type || '';
    const kind = t.startsWith('image/') ? 'image' : t.startsWith('video/') ? 'video' : 'pdf';
    toast('Uploading material… this can take a moment.');
    const res = await store.uploadMaterial(node.dataset.session, file, kind, file.name.replace(/\.[^.]+$/, ''));
    toast(res.ok ? 'Material uploaded ✓' : `Upload failed: ${res.error}`);
    render();
  } else if (action === 'session-week') {
    store.updateSession(node.dataset.id, { week: node.value });
    toast('Session week updated ✓');
    render();
  } else if (action === 'session-title') {
    store.updateSession(node.dataset.id, { title: node.value });
    toast('Session title updated ✓');
    render();
  } else if (action === 'session-summary') {
    store.updateSession(node.dataset.id, { summary: node.value });
    toast('Session summary updated ✓');
    render();
  } else if (action === 'session-notes') {
    store.updateSession(node.dataset.id, { notes: node.value });
    toast('Session notes updated ✓');
    render();
  } else if (action === 'session-date') {
    store.updateSession(node.dataset.id, { date: node.value });
    toast('Session date updated ✓');
    render();
  } else if (action === 'session-duration') {
    store.updateSession(node.dataset.id, { durationMin: node.value });
    toast('Session duration updated ✓');
    render();
  } else if (action === 'session-video') {
    store.updateSession(node.dataset.id, { videoUrl: node.value });
    toast('Session video URL updated ✓');
    render();
  } else if (action === 'session-meet') {
    store.updateSession(node.dataset.id, { meetUrl: node.value });
    toast(node.value.trim() ? 'Meet link saved ✓' : 'Meet link cleared');
    render();
  } else if (action === 'session-liveat') {
    store.updateSession(node.dataset.id, { liveAt: node.value });
    toast('Class time saved ✓');
    render();
  } else if (action === 'week-meet') {
    const wNum = Number(node.dataset.week);
    store.getSessions().filter((s) => s.week === wNum).forEach((s) => {
      store.updateSession(s.id, { meetUrl: node.value });
    });
    toast(node.value.trim() ? `Week ${wNum} Meet link saved ✓` : `Week ${wNum} Meet link cleared`);
    render();
  } else if (action === 'week-liveat') {
    const wNum = Number(node.dataset.week);
    store.getSessions().filter((s) => s.week === wNum).forEach((s) => {
      store.updateSession(s.id, { liveAt: node.value });
    });
    toast(`Week ${wNum} class time saved ✓`);
    render();
  } else if (action === 'curric-meta-title') {
    store.updateCurriculumMeta({ title: node.value });
    toast('Course title saved ✓');
    render();
  } else if (action === 'curric-meta-tagline') {
    store.updateCurriculumMeta({ tagline: node.value });
    toast('Tagline saved ✓');
    render();
  } else if (action === 'curric-meta-length') {
    store.updateCurriculumMeta({ length: node.value });
    toast('Course length saved ✓');
    render();
  } else if (action === 'curric-meta-format') {
    store.updateCurriculumMeta({ format: node.value });
    toast('Format saved ✓');
    render();
  } else if (action === 'curric-meta-style') {
    store.updateCurriculumMeta({ learningStyle: node.value });
    toast('Learning style saved ✓');
    render();
  } else if (action === 'curric-meta-desc') {
    store.updateCurriculumMeta({ description: node.value });
    toast('Description saved ✓');
    render();
  } else if (action === 'curric-week-num') {
    const oldWeek = Number(node.dataset.week);
    const newWeek = Number(node.value);
    curricOpenWeek = newWeek;
    store.updateCurriculumWeek(oldWeek, { week: newWeek });
    toast(`Renumbered to Week ${newWeek} ✓`);
    render();
  } else if (action === 'curric-week-title') {
    curricOpenWeek = Number(node.dataset.week);
    store.updateCurriculumWeek(node.dataset.week, { title: node.value });
    toast('Week title saved ✓');
    render();
  } else if (action === 'curric-week-pending') {
    curricOpenWeek = Number(node.dataset.week);
    store.updateCurriculumWeek(node.dataset.week, { pending: node.checked });
    toast(node.checked ? 'Marked coming soon (hidden details)' : 'Week published to students ✓');
    render();
  } else if (action === 'curric-week-objectives') {
    curricOpenWeek = Number(node.dataset.week);
    store.updateCurriculumWeek(node.dataset.week, { objectives: node.value });
    toast('Objectives saved ✓');
    render();
  } else if (action === 'curric-week-steps') {
    curricOpenWeek = Number(node.dataset.week);
    store.updateCurriculumWeek(node.dataset.week, { steps: node.value });
    toast('Steps saved ✓');
    render();
  } else if (action === 'curric-week-assignment') {
    curricOpenWeek = Number(node.dataset.week);
    store.updateCurriculumWeek(node.dataset.week, { assignment: node.value });
    toast('Assignment saved ✓');
    render();
  } else if (action === 'curric-week-discussion') {
    curricOpenWeek = Number(node.dataset.week);
    store.updateCurriculumWeek(node.dataset.week, { discussion: node.value });
    toast('Discussion prompt saved ✓');
    render();
  } else if (action === 'curric-week-quiz') {
    curricOpenWeek = Number(node.dataset.week);
    store.updateCurriculumWeek(node.dataset.week, { quiz: node.value });
    toast('Action plan saved ✓');
    render();
  }
});

/* surface failed background writes (Supabase mode) */
store.onError(() => {
  toast('Couldn’t reach the server — your last change may not have saved.', 4000);
  showConnBanner('Couldn’t reach the server — some changes may not have saved. Check your connection.');
});

/* Auth lifecycle — recovery link, multi-tab sign-out, role refresh */
onAuthEvent(async (event, session) => {
  if (event === 'PASSWORD_RECOVERY') {
    recoveryMode = true;
    authError = '';
    authInfo = '';
    authFieldErrors = {};
    portalLoadError = null;
    render();
    return;
  }
  if (event === 'SIGNED_OUT') {
    // Another tab signed out, or session revoked
    store.stopRealtime();
    store.stopDiscussionRealtime();
    clearCachedUser();
    recoveryMode = false;
    portalLoadError = null;
    route = { name: null, params: {} };
    authScreen = 'login';
    if (!document.hidden) {
      authInfo = 'You have been signed out.';
    }
    render();
    return;
  }
  if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
    // Keep role/name in sync without bouncing the whole app
    if (session?.user && currentUser()) {
      try {
        await refreshSessionUser();
      } catch {
        /* ignore soft refresh failures */
      }
    }
  }
});

/* boot: restore any existing session, load the data it can see, then render */
(async () => {
  app.innerHTML = loadingShell();
  try {
    const user = await initAuth();
    if (user && !recoveryMode) {
      try {
        await store.hydrate(user);
        store.startRealtime(user, liveRerender);
        store.startDiscussionRealtime(user, liveRerender);
      } catch (err) {
        console.error('[portal] startup hydrate error:', err);
        portalLoadError =
          mapAuthError(err?.message || err, 'login') ||
          'Couldn’t load your data. Check your connection and try again.';
      }
    }
  } catch (err) {
    console.error('[portal] startup error:', err);
  }
  render();
})();
