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

/* ---- app state ------------------------------------------------------------ */
let route = { name: null, params: {} };
let crm = { view: 'leads', q: '', status: 'all', adding: false, editingId: null, notesOpen: new Set() };
// Discussion composer draft + reply target, kept across live re-renders.
// `replyToId` is the root post being replied to; `focusAfterRender` re-focuses after post.
let disc = { draft: '', replyToId: null, focusAfterRender: false };

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
   SHELL (after login)
   ======================================================================== */
function shell(user, navItems, content) {
  const items = navItems
    .map(
      (n) => `<button class="nav-item ${route.name === n.route || n.active ? 'active' : ''}"
        data-action="go" data-route="${n.route}">
        <span class="ni-ico">${n.icon}</span>${esc(n.label)}
        ${n.badge ? `<span class="ni-badge">${n.badge}</span>` : ''}
      </button>`
    )
    .join('');

  return `
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

/* progress bar component */
const bar = (pct) =>
  `<div class="bar"><span style="width:${pct}%"></span></div>`;

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
  const bodyInner = emptyPending
    ? `<p class="muted">No content yet — use <strong>Edit</strong> to add details, then publish to students.</p>`
    : `${section('Learning Objectives', list(w.objectives, false))}
      ${section('Assignment', w.assignment ? `<p class="wk-callout wk-assign">${esc(w.assignment)}</p>` : '')}
      ${section('Discussion Post', w.discussion ? `<p class="wk-callout wk-discuss">“${esc(w.discussion)}”</p>` : '')}
      ${section('Weekly Quiz', list(w.quiz, true))}
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
      <label class="field"><span>Weekly quiz questions <em class="muted">(one per line)</em></span>
        <textarea rows="6" placeholder="What is a growth mindset?&#10;Why is goal setting important in business?"
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
  <div class="page-head"><div>
    <span class="eyebrow">Course Syllabus</span>
    <h1>${esc(c.title)}</h1>
    <p class="muted">${esc(c.tagline)}</p>
  </div></div>
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
  <div class="page-head">
    <div>
      <span class="eyebrow">Course Syllabus · Admin</span>
      <h1>${esc(c.title)}</h1>
      <p class="muted">${esc(c.tagline)} · ${publishedCount} of ${weeks.length} week${weeks.length === 1 ? '' : 's'} published to students</p>
    </div>
    <button type="button" class="btn btn-primary" data-action="curric-edit">Edit</button>
  </div>
  ${syllabusOverview}
  <div class="panel-head curric-weeks-head"><h2>Weekly Curriculum</h2>
    <span class="muted">Expand a week · use <strong>Publish to students</strong> when it’s ready</span></div>
  <div class="curric-weeks">
    ${weeks.map((w) => weekBlock(w, Number(w.week) === Number(openWeek), { admin: true })).join('')}
  </div>
  <p class="curric-note muted">Unpublished weeks show as “coming soon” for students. Publishing reveals the full week content immediately.</p>`;
  }

  return `
  <div class="page-head">
    <div>
      <span class="eyebrow">Course Syllabus · Admin</span>
      <h1>Edit Curriculum</h1>
      <p class="muted">Update content, then use <strong>Publish to students</strong> on each week when it’s ready.</p>
    </div>
    <div class="curric-head-actions">
      <button type="button" class="btn btn-outline" data-action="curric-cancel">Cancel</button>
      <button type="button" class="btn btn-primary" data-action="curric-save">Save</button>
      <button type="button" class="btn btn-outline" data-action="add-curric-week">+ Add week</button>
    </div>
  </div>

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
function discussionMessage(p, user, { isReply = false } = {}) {
  const mine = p.authorId === user.id;
  const isInstructor = p.authorRole === 'admin';
  const canDelete = mine || user.role === 'admin';
  const author = { id: p.authorId || 'anon', name: p.authorName || 'Student' };
  // Reply always targets the thread root (one-level threads).
  const replyTargetId = isReply ? (p.parentId || p.id) : p.id;
  return `<div class="disc-msg${mine ? ' is-mine' : ''}${isInstructor ? ' is-instructor' : ''}${isReply ? ' is-reply' : ''}" data-post-id="${esc(p.id)}">
    ${avatar(author, isReply ? 32 : 40)}
    <div class="disc-bubble">
      <div class="disc-meta">
        <strong>${esc(p.authorName || 'Student')}${mine ? ' (you)' : ''}</strong>
        ${isInstructor ? `<span class="disc-tag">Instructor</span>` : ''}
        <span class="disc-time">${esc(fmtWhen(p.createdAt))}</span>
        <span class="disc-actions">
          <button type="button" class="disc-reply-btn" data-action="reply-post" data-id="${esc(replyTargetId)}" data-name="${esc(p.authorName || 'Student')}" title="Reply" aria-label="Reply to ${esc(p.authorName || 'Student')}">Reply</button>
          ${canDelete ? `<button type="button" class="disc-del" data-action="delete-post" data-id="${esc(p.id)}" title="Delete message" aria-label="Delete message">🗑</button>` : ''}
        </span>
      </div>
      <p class="disc-body">${esc(p.body).replace(/\n/g, '<br />')}</p>
    </div>
  </div>`;
}

function discussionView(user) {
  const posts = store.getDiscussion();
  const weeks = store.getCurriculum().weeks || [];
  // Prefer the first published week that has a discussion prompt
  const promptWeek = weeks.find((w) => !w.pending && w.discussion) || weeks.find((w) => w.discussion);
  const prompt = promptWeek?.discussion || '';

  const roots = posts.filter((p) => !p.parentId);
  const byParent = new Map();
  posts.forEach((p) => {
    if (!p.parentId) return;
    if (!byParent.has(p.parentId)) byParent.set(p.parentId, []);
    byParent.get(p.parentId).push(p);
  });

  let feed;
  if (!posts.length) {
    feed = `<div class="disc-empty">
        <div class="empty-ico">💬</div>
        <h3>Start the conversation</h3>
        <p class="muted">Be the first to post — share your Discussion Post answer or ask the class a question.</p>
      </div>`;
  } else {
    feed = roots
      .map((root) => {
        const replies = (byParent.get(root.id) || []).sort(
          (a, b) => new Date(a.createdAt) - new Date(b.createdAt)
        );
        const replyBlock = replies.length
          ? `<div class="disc-replies" role="group" aria-label="Replies">${replies
              .map((r) => discussionMessage(r, user, { isReply: true }))
              .join('')}</div>`
          : '';
        return `<div class="disc-thread">${discussionMessage(root, user)}${replyBlock}</div>`;
      })
      .join('');
    // Orphan replies (parent deleted/missing) — show as top-level so nothing vanishes.
    const rootIds = new Set(roots.map((r) => r.id));
    const orphans = posts.filter((p) => p.parentId && !rootIds.has(p.parentId));
    if (orphans.length) {
      feed += orphans.map((p) => `<div class="disc-thread">${discussionMessage(p, user)}</div>`).join('');
    }
  }

  const replyTarget = disc.replyToId
    ? posts.find((p) => p.id === disc.replyToId) || { authorName: 'classmate', id: disc.replyToId }
    : null;
  const replyBar = replyTarget
    ? `<div class="disc-reply-bar">
        <span>Replying to <strong>${esc(replyTarget.authorName || 'classmate')}</strong></span>
        <button type="button" class="link-btn" data-action="cancel-reply">Cancel</button>
      </div>`
    : '';

  return `
  <div class="page-head"><div>
    <span class="eyebrow">Class Community</span>
    <h1>Class Discussion</h1>
    <p class="muted">Post your discussion answers, ask questions, and reply to classmates.</p>
  </div></div>

  ${prompt ? `<div class="disc-prompt">
    <span class="disc-prompt-label">This week’s discussion prompt</span>
    <p>“${esc(prompt)}”</p>
  </div>` : ''}

  <section class="panel disc-panel no-pad">
    <div class="disc-feed" id="discFeed" aria-live="polite">${feed}</div>
    ${replyBar}
    <form id="discForm" class="disc-composer">
      ${avatar(user, 38)}
      <textarea id="discInput" name="body" rows="1" maxlength="2000"
        placeholder="${replyTarget ? `Reply to ${esc(replyTarget.authorName || 'classmate')}…` : 'Write a message to the class…  (Enter to post, Shift+Enter for a new line)'}"
        data-action="disc-input" aria-label="${replyTarget ? 'Reply message' : 'Class message'}"></textarea>
      <button type="submit" class="btn btn-primary btn-sm">${replyTarget ? 'Reply' : 'Post'}</button>
    </form>
  </section>
  <p class="muted disc-foot">Visible to everyone in your cohort${USE_SUPABASE ? ' · updates live' : ''}. Please keep it respectful and supportive. 💛</p>`;
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
    { route: 'student-sessions', label: SESSIONS_LOCKED ? 'Class Sessions 🔒' : 'Class Sessions', icon: '▶' },
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
  <div class="page-head">
    <div><h1>Welcome back, ${esc(user.name.split(' ')[0])}</h1>
    <p class="muted">The Entrepreneur’s Journey — Funding Masterclass · ${esc(user.cohort)}</p></div>
  </div>

  <section class="panel student-contact-note" role="note">
    <p>For curriculum or grading questions, or to submit business documents, please email
      <a href="mailto:admin@umof.org">admin@umof.org</a>.</p>
  </section>

  <div class="stat-grid">
    ${statCard('Course progress', `${s.completionPct}%`, bar(s.completionPct))}
    ${statCard('Sessions completed', `${s.completed}/${s.totalSessions}`)}
    ${statCard('Average test score', avg)}
    ${statCard('Results pending', s.pendingGrading)}
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

  <section class="panel">
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

/** A written test = a manual quiz made of free-response questions (no options). */
const isWritten = (q) =>
  !!q && q.type === 'manual' && Array.isArray(q.questions) && q.questions.length > 0;

function quizView(user) {
  const q = store.getQuizById(route.params.id);
  if (!q) return `<p>Test not found.</p>`;
  // Students can't open a test until an admin has set it live.
  if (!q.published && user.role !== 'admin') {
    return `<div class="page-head"><h1>${esc(q.title)}</h1></div>
    <section class="panel"><p class="muted">This test isn’t open yet. Your instructor will make it available when the class is ready.</p></section>`;
  }
  const written = isWritten(q);
  const sub = store.getProgress(user.id).submissions?.[q.id];
  const sx = store.getSessionById(q.sessionId);
  const kind = q.type === 'auto' ? 'Quiz' : written ? 'Test' : 'Assignment';
  const head = `
    <button class="back-link" data-action="go" data-route="session" data-id="${q.sessionId}">← ${esc(sx ? sx.title : 'Back')}</button>
    <div class="page-head"><div><span class="eyebrow">${kind}${q.due ? ` · Due ${fmtDate(q.due)}` : ''}</span><h1>${esc(q.title)}</h1></div></div>`;

  /* ---- written test (free-response, instructor-graded) ---- */
  if (written) {
    const qaBlock = (answers) => `
      <section class="panel"><div class="panel-head"><h2>Your answers</h2></div>
        ${q.questions
          .map(
            (qq, i) => `<div class="review-q">
              <p class="rq-prompt">${i + 1}. ${esc(qq.prompt)}</p>
              <p class="answer-box">${esc((answers && answers[qq.id]) || '—')}</p>
            </div>`
          )
          .join('')}
      </section>`;
    if (sub && sub.status === 'graded') {
      return `${head}
      <section class="panel result-panel">
        <div class="big-score ${sub.score >= 70 ? 'pass' : 'fail'}">${sub.score}<small>/${q.maxScore || 100}</small></div>
        <p>Graded ${fmtDate(sub.gradedAt)}</p>
        ${sub.feedback ? `<div class="feedback"><strong>Instructor feedback</strong><p>${esc(sub.feedback)}</p></div>` : ''}
      </section>
      ${qaBlock(sub.answers)}`;
    }
    if (sub && sub.status === 'submitted') {
      return `${head}
      <section class="panel"><div class="pending-banner">⏳ Submitted ${fmtDateTime(sub.submittedAt) || fmtDate(sub.submittedAt)} — saved for your instructor.</div></section>
      ${qaBlock(sub.answers)}`;
    }
    const draftW = loadQuizDraft(user.id, q.id);
    const draftAnswers = draftW?.answers || {};
    return `${head}
    <form id="writtenForm" data-quiz="${q.id}" class="panel quiz-form" data-draft="1">
      <p class="muted">Answer each question in your own words. Your instructor will review and grade your responses.</p>
      ${draftW ? `<p class="draft-hint" id="draftHint">Draft saved on this device · not submitted yet</p>` : `<p class="draft-hint muted" id="draftHint" hidden></p>`}
      ${q.questions
        .map(
          (qq, i) => `<fieldset class="quiz-q">
        <legend>${i + 1}. ${esc(qq.prompt)}</legend>
        <textarea name="${qq.id}" rows="4" placeholder="Write your answer…" required data-action="quiz-draft">${esc(draftAnswers[qq.id] || '')}</textarea>
      </fieldset>`
        )
        .join('')}
      <button type="submit" class="btn btn-primary">Submit for review</button>
    </form>`;
  }

  /* ---- already-graded auto quiz: show results ---- */
  if (q.type === 'auto' && sub) {
    return `${head}
    <section class="panel result-panel">
      <div class="big-score ${sub.score >= 70 ? 'pass' : 'fail'}">${sub.score}%</div>
      <p>You answered <strong>${sub.correct} of ${sub.total}</strong> correctly · submitted ${fmtDate(sub.submittedAt)}.</p>
    </section>
    <section class="panel">
      <div class="panel-head"><h2>Review</h2></div>
      ${q.questions
        .map((qq, i) => {
          const chosen = sub.answers ? sub.answers[qq.id] : undefined;
          return `<div class="review-q">
            <p class="rq-prompt">${i + 1}. ${esc(qq.prompt)}</p>
            ${qq.options
              .map((opt, oi) => {
                const isCorrect = oi === qq.correctIndex;
                const isChosen = oi === chosen;
                const cls = isCorrect ? 'opt-correct' : isChosen ? 'opt-wrong' : '';
                const tag = isCorrect ? ' ✓' : isChosen ? ' ✗ your answer' : '';
                return `<div class="opt ${cls}">${esc(opt)}${tag}</div>`;
              })
              .join('')}
          </div>`;
        })
        .join('')}
    </section>`;
  }

  /* ---- auto quiz, not taken: render the form ---- */
  if (q.type === 'auto') {
    return `${head}
    <form id="quizForm" data-quiz="${q.id}" class="panel quiz-form">
      ${q.questions
        .map(
          (qq, i) => `<fieldset class="quiz-q">
        <legend>${i + 1}. ${esc(qq.prompt)}</legend>
        ${qq.options
          .map(
            (opt, oi) => `<label class="opt-choice">
              <input type="radio" name="${qq.id}" value="${oi}" required />
              <span>${esc(opt)}</span></label>`
          )
          .join('')}
      </fieldset>`
        )
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
  const prog = store.getProgress(user.id);
  const quizzes = store.getVisibleQuizzes();
  if (!quizzes.length) {
    return `
    <div class="page-head"><h1>My Tests</h1><p class="muted">Your quizzes and assignments across the program.</p></div>
    <section class="panel"><div class="empty"><div class="empty-ico">📝</div><h3>No tests open yet</h3>
      <p class="muted">Your instructor opens each test when the class is ready. Check back soon.</p></div></section>`;
  }
  const rows = quizzes.map((q) => {
    const sub = prog.submissions?.[q.id];
    const status = !sub
      ? '<span class="pill pill-todo">Open</span>'
      : sub.status === 'graded'
        ? '<span class="pill pill-done">Graded</span>'
        : '<span class="pill pill-pending">Submitted</span>';
    const score =
      sub?.status === 'graded' && sub.score != null
        ? q.type === 'auto'
          ? `${sub.score}%`
          : `${sub.score}/${q.maxScore || 100}`
        : '—';
    const type = q.type === 'auto' ? 'Quiz' : isWritten(q) ? 'Test' : 'Assignment';
    const cta = !sub ? 'Start' : sub.status === 'graded' ? 'View' : 'View';
    return { q, sub, status, score, type, cta };
  });

  return `
  <div class="page-head"><h1>My Tests</h1><p class="muted">Your quizzes and assignments across the program.</p></div>
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
    { route: 'admin-students', label: 'Students', icon: '👥' },
    { route: 'admin-grading', label: 'Grading', icon: '✎', badge: pending || '' },
    { route: 'admin-crm', label: 'CRM', icon: '☎' },
    { route: 'admin-content', label: 'Sessions', icon: '▶' },
    { route: 'curriculum', label: 'Curriculum', icon: '❖' },
    { route: 'discussion', label: 'Discussion', icon: '💬' },
    { route: 'admin-access', label: 'Access', icon: '🔑' },
    { route: 'account', label: 'Account', icon: '⚙' },
  ];
}

function adminHome() {
  const students = store.getStudents();
  const queue = store.getGradingQueue();
  const leads = store.getLeads();
  const activeLeads = leads.filter((l) => l.status !== 'lost' && l.status !== 'enrolled').length;
  const avgCompletion = students.length
    ? Math.round(
        students.reduce((sum, s) => sum + store.getStudentStats(s.id).completionPct, 0) / students.length
      )
    : 0;

  return `
  <div class="page-head"><div><h1>Instructor Dashboard</h1><p class="muted">Summer 2026 cohort · Funding Masterclass · full admin control</p></div>
    <div class="head-actions">
      <button class="btn btn-outline btn-sm" data-action="refresh-progress" title="Reload student submissions from the server">↻ Refresh</button>
    </div>
  </div>

  <div class="stat-grid">
    ${statCard('Enrolled students', students.length)}
    ${statCard('Avg. completion', `${avgCompletion}%`, bar(avgCompletion))}
    ${statCard('Awaiting grading', queue.length, queue.length ? `<button class="link-arrow" data-action="go" data-route="admin-grading">Grade now →</button>` : 'All caught up')}
    ${statCard('Active leads', activeLeads, `<button class="link-arrow" data-action="go" data-route="admin-crm">Open CRM →</button>`)}
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
  <div class="page-head"><div><h1>Students</h1><p class="muted">${students.length} enrolled · open a student for detail and grading</p></div>
    <div class="head-actions">
      <button class="btn btn-outline btn-sm" data-action="refresh-progress" title="Reload student submissions from the server">↻ Refresh</button>
      <button class="btn btn-outline btn-sm" data-action="export-students-csv">⬇ CSV</button>
      <button class="btn btn-outline btn-sm" data-action="export-students-word">⬇ Word</button>
      <button class="btn btn-outline btn-sm" data-action="export-students-pdf">⬇ PDF</button>
    </div>
  </div>
  <section class="panel no-pad">
    <div class="table-scroll">
    <table class="data-table">
      <thead><tr><th>Student</th><th>Plan</th><th>Progress</th><th>Avg score</th><th>Pending</th><th></th></tr></thead>
      <tbody>
        ${students
          .map((s) => {
            const st = store.getStudentStats(s.id);
            return `<tr class="clickable" data-action="go" data-route="admin-student" data-id="${s.id}">
              <td><div class="cell-user">${avatar(s, 34)}<span><strong>${esc(s.name)}</strong><small>${esc(s.email)}</small></span></div></td>
              <td>${esc(s.plan)}</td>
              <td><div class="cell-prog">${bar(st.completionPct)}<span>${st.completionPct}%</span></div></td>
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
    ${statCard('Completion', `${st.completionPct}%`, bar(st.completionPct))}
    ${statCard('Sessions', `${st.completed}/${st.totalSessions}`)}
    ${statCard('Avg score', st.avgScore == null ? '—' : `${st.avgScore}%`)}
    ${statCard('Tests taken', st.quizzesTaken)}
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
              const sub = prog.submissions?.[q.id];
              if (!sub) return `<tr><td>${esc(q.title)}</td><td><span class="pill pill-todo">Not started</span></td><td>—</td><td></td></tr>`;
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
  const queue = store.getGradingQueue();
  const graded = store.getGradedSubmissions();
  return `
  <div class="page-head"><div><h1>Grading</h1><p class="muted">${queue.length} submission${queue.length === 1 ? '' : 's'} awaiting your review · ${graded.length} graded (use <strong>Edit</strong> to update)</p></div>
    <div class="head-actions">
      <button class="btn btn-outline btn-sm" data-action="refresh-progress" title="Reload student submissions from the server">↻ Refresh submissions</button>
    </div>
  </div>
  <section class="panel compact-panel">
    <p class="muted" style="margin:0">
      Grade with the <strong>Grading Breakdown</strong> table (<strong>Criteria</strong> and <strong>Points</strong>).
      Use <strong>Edit</strong> on any graded row to update the score or feedback anytime.
      New student work appears live; if something is missing, click <strong>Refresh submissions</strong>.
    </p>
  </section>
  <section class="panel">
    <div class="panel-head"><h2>Awaiting review</h2></div>
    ${
      queue.length
        ? `<div class="mini-list">${queue
            .map(
              (g) => `<button class="mini-row" data-action="go" data-route="grade" data-student="${g.student.id}" data-quiz="${g.quizId}">
          ${avatar(g.student, 36)}
          <span class="mr-main"><strong>${esc(g.student.name || g.student.email || 'Student')}</strong><small>${esc(g.quiz?.title || g.quizId)} · submitted ${fmtDate(g.submission.submittedAt)}</small></span>
          <span class="btn btn-primary btn-sm">Grade →</span>
        </button>`
            )
            .join('')}</div>`
        : `<div class="empty"><div class="empty-ico">✓</div><h3>All caught up</h3><p class="muted">There are no submissions waiting to be graded. Ask the student to re-submit if they still see “Submitted” on their side, then hit Refresh.</p></div>`
    }
  </section>
  <section class="panel">
    <div class="panel-head"><h2>Graded scores</h2>
      <span class="muted">Edit score, feedback, or Grading Breakdown anytime</span></div>
    ${
      graded.length
        ? `<div class="table-scroll"><table class="data-table compact">
        <thead><tr><th>Student</th><th>Test</th><th>Score</th><th>Graded</th><th>Edit</th></tr></thead>
        <tbody>
          ${graded
            .map((g) => {
              const unit = (g.quiz?.type || 'manual') === 'manual' ? '/100' : '%';
              return `<tr>
              <td><div class="cell-user">${avatar(g.student, 28)}<strong>${esc(g.student.name || g.student.email || 'Student')}</strong></div></td>
              <td>${esc(g.quiz?.title || g.quizId)}</td>
              <td><strong>${g.submission.score}${unit}</strong></td>
              <td class="muted">${fmtDate(g.submission.gradedAt || g.submission.submittedAt)}</td>
              <td><button class="btn btn-outline btn-sm" data-action="go" data-route="grade" data-student="${g.student.id}" data-quiz="${g.quizId}">Edit</button></td>
            </tr>`;
            })
            .join('')}
        </tbody>
      </table></div>`
        : `<p class="muted">No graded submissions yet. Scores appear here after you grade a test — use Edit anytime to update them.</p>`
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
  if (written) {
    const qList =
      quiz.questions?.length
        ? quiz.questions
        : Object.keys(sub.answers || {}).map((id) => ({ id, prompt: id }));
    submissionPanel = `<section class="panel"><div class="panel-head"><h2>Student answers</h2>
        <span class="muted">${qList.length} question${qList.length === 1 ? '' : 's'} · score with Grading Breakdown below</span></div>
        ${qList
          .map((qq, i) => `<div class="review-q">
            <p class="rq-prompt">${i + 1}. ${esc(qq.prompt)}</p>
            <p class="answer-box">${esc((sub.answers && sub.answers[qq.id]) || '—')}</p>
          </div>`)
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

  const meta = isEdit
    ? `graded ${fmtDate(sub.gradedAt)} · score ${sub.score}${unit}${sub.gradedBy ? ` · by ${esc(sub.gradedBy)}` : ''}`
    : `submitted ${fmtDate(sub.submittedAt)}`;

  return `
  <div class="back-row">
    <button class="back-link" data-action="go" data-route="admin-student" data-id="${studentId}">← ${esc(student.name)}</button>
    <button class="back-link" data-action="go" data-route="admin-grading">← Grading</button>
  </div>
  <div class="page-head"><div class="cell-user big">${avatar(student, 48)}<div>
    <h1>${esc(quiz.title)}</h1><p class="muted">${esc(student.name)} · ${meta}</p></div></div></div>

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
  <div class="page-head">
    <div>
      <h1>Class Sessions</h1>
      <p class="muted">Release weeks to students · ${publishedSessions} of ${sessions.length} session${sessions.length === 1 ? '' : 's'} published</p>
    </div>
    <div class="head-actions">
      <button class="btn btn-primary" data-action="add-session">+ Add Session</button>
    </div>
  </div>

  ${curricMissingBanner}

  <section class="panel">
    <div class="panel-head">
      <h2>Release to students</h2>
      <span class="muted" style="font-size:0.84rem">Sessions + tests per week (set Wk on each session first)</span>
    </div>
    <p class="hint" style="margin-top:0">For Week 2: set session <strong>Wk = 2</strong> below, then click <strong>Publish Week 2 sessions</strong>. Students only see published sessions.</p>
    <div class="week-release-list-wrap">
      ${releaseCards || '<p class="muted">Add a curriculum week or session to start releasing content.</p>'}
    </div>
  </section>

  <section class="panel">
    <div class="panel-head">
      <h2>Live Class &mdash; Google Meet</h2>
      <span class="muted" style="font-size:0.84rem">One link per week &middot; shared across all sessions in that week</span>
    </div>
    <div class="week-meet-list">
      ${meetBlocks || '<p class="muted">No weeks yet.</p>'}
    </div>
    <p class="hint">Create the Meet link in Google Calendar for proper host controls. Students see a "Join Live Class" button on every published session card for that week.</p>
  </section>

  <section class="panel">
    <div class="panel-head">
      <h2>Sessions</h2>
      <span class="muted" style="font-size:0.84rem">Edit fields · publish individually · changes save automatically</span>
    </div>
    <div class="session-cards">
      ${sessionCards || '<p class="muted">No sessions yet. Add one to get started.</p>'}
    </div>
    <p class="hint">${
      USE_SUPABASE
        ? 'Upload a recording (MP4) to host it privately in Supabase Storage. Or keep using YouTube/Vimeo embed URLs. New sessions start hidden until you publish.'
        : 'Connect Supabase to upload and host videos. In demo mode, sessions use embedded sample videos. New sessions start hidden until you publish.'
    }</p>
  </section>

  ${adminMaterialsPanel()}`;
}

/* ---- Access: approved-student allowlist ----------------------------------- */
function adminAccess() {
  const list = store.getAllowedStudents();
  const registered = new Set(store.getStudents().map((s) => (s.email || '').toLowerCase()));
  return `
  <div class="page-head"><div><h1>Access — Approved Students</h1>
    <p class="muted">Only people on this list can create a student account. Add the email each student used on the enrollment form.</p></div></div>

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
    columns: ['Name', 'Email', 'Phone', 'Cohort', 'Plan', 'Enrolled', 'Grant ($300 fee)', 'Completion', 'Avg score', 'Pending'],
    data: withStats,
    exportRows: withStats.map(({ s, st }) => [
      s.name, s.email, s.phone, s.cohort, s.plan, fmtDate(s.enrolled), grantText(s),
      `${st.completionPct}%`, st.avgScore == null ? '—' : `${st.avgScore}%`, st.pendingGrading,
    ]),
  };
}

/** Columns + rows for the Students roster export (CSV/PDF/Word). */
function studentExportData() {
  const cols = ['Name', 'Email', 'Phone', 'Cohort', 'Plan', 'Enrolled', 'Grant ($300 fee)', 'Completion', 'Avg score', 'Pending'];
  const rows = store.getStudents().map((s) => {
    const st = store.getStudentStats(s.id);
    return [s.name, s.email, s.phone, s.cohort, s.plan, fmtDate(s.enrolled),
      s.grantAwarded ? `$${s.grantAmount || 0}` : '—',
      `${st.completionPct}%`, st.avgScore == null ? '—' : `${st.avgScore}%`, st.pendingGrading];
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
        <td><div class="cell-prog">${bar(st.completionPct)}<span>${st.completionPct}%</span></div></td>
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
  <div class="page-head"><div><h1>Live CRM</h1><p class="muted">Students &amp; leads in one place · changes save instantly</p></div>
    <div class="head-actions">
      ${isLeads ? `<button class="btn btn-primary btn-sm" data-action="toggle-add-lead">＋ Add record</button>` : ''}
      <button class="btn btn-outline btn-sm" data-action="export-csv">⬇ CSV</button>
      <button class="btn btn-outline btn-sm" data-action="export-word">⬇ Word</button>
      <button class="btn btn-outline btn-sm" data-action="export-pdf">⬇ PDF</button>
      ${isLeads && totalLeads ? `<button class="btn btn-ghost btn-sm btn-danger" data-action="clear-leads">Clear all</button>` : ''}
    </div>
  </div>

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
  const discWasFocused = document.activeElement?.id === 'discInput';

  // Hydrate failed after a valid session — dedicated recovery UI.
  if (portalLoadError && currentUser()) {
    app.innerHTML = loadErrorShell(portalLoadError);
    return;
  }

  // Arrived via a password-reset link — force the "set new password" screen.
  if (recoveryMode) {
    app.innerHTML = viewReset();
    focusAuthField();
    return;
  }

  const user = currentUser();
  if (!user) {
    app.innerHTML = renderAuthScreen();
    focusAuthField();
    return;
  }

  if (user.role === 'student') {
    const allowed = ['student-home', 'curriculum', 'student-sessions', 'student-tests', 'session', 'quiz', 'discussion', 'account'];
    if (!allowed.includes(route.name)) route = { name: 'student-home', params: {} };
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
    const allowed = ['admin-home', 'admin-students', 'admin-student', 'admin-grading', 'grade', 'admin-crm', 'admin-content', 'curriculum', 'discussion', 'admin-access', 'account'];
    if (!allowed.includes(route.name)) route = { name: 'admin-home', params: {} };
    const views = {
      'admin-home': adminHome,
      'admin-students': adminStudents,
      'admin-student': adminStudentDetail,
      'admin-grading': adminGrading,
      grade: gradeView,
      'admin-crm': adminCRM,
      'admin-content': adminContent,
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

  // Discussion: pin the feed to the newest message, restore the in-progress
  // draft, and keep focus if the student was typing or just posted.
  const feedEl = document.getElementById('discFeed');
  if (feedEl) feedEl.scrollTop = feedEl.scrollHeight;
  const composerEl = document.getElementById('discInput');
  if (composerEl) {
    if (composerEl.value !== disc.draft) composerEl.value = disc.draft;
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

/* Remember which curriculum week accordion is open (survives re-renders). */
app.addEventListener('toggle', (e) => {
  const details = e.target;
  if (!(details instanceof HTMLDetailsElement)) return;
  if (!details.classList.contains('wk')) return;
  if (details.open) {
    const wk = details.dataset.week;
    curricOpenWeek = wk != null ? Number(wk) : null;
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
    case 'remove-allowed':
      store.removeAllowedStudent(d.email);
      toast('Removed from approved list');
      render();
      break;
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
      if (confirm(`Delete Week ${wk} from the curriculum? Students will no longer see it.`)) {
        store.deleteCurriculumWeek(wk);
        if (Number(curricOpenWeek) === wk) curricOpenWeek = null;
        toast(`Week ${wk} deleted`);
        render();
      }
      break;
    }
    case 'delete-material': {
      const mat = store.getAllMaterials().find((m) => m.id === d.id);
      if (confirm(`Delete “${mat?.title || 'this material'}”? This can't be undone.`)) {
        store.deleteMaterial(d.id);
        toast('Material deleted');
        render();
      }
      break;
    }
    case 'delete-post': {
      const user = currentUser();
      const post = store.getDiscussion().find((p) => p.id === d.id);
      if (!post) break;
      const mine = post.authorId === user.id;
      if (confirm(mine ? 'Delete your message?' : `Delete ${post.authorName || 'this'}’s message?`)) {
        store.deleteDiscussionPost(d.id);
        if (disc.replyToId === d.id) disc.replyToId = null;
        toast('Message deleted');
        render();
      }
      break;
    }
    case 'reply-post': {
      disc.replyToId = d.id || null;
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
    case 'dismiss-banner':
      hideConnBanner();
      break;
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
      store.setQuizPublished(q.id, !q.published);
      toast(q.published ? 'Test taken offline' : 'Test is now live for students ✓');
      render();
      break;
    }
    case 'toggle-session-publish': {
      const s = store.getSessionById(d.id);
      if (!s) break;
      const next = s.published === false;
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
      if (confirm(`Delete session “${s?.title || 'this session'}”? This cannot be undone.`)) {
        store.deleteSession(d.id);
        toast('Session deleted');
        render();
      }
      break;
    }
    case 'reset':
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
      if (confirm(`Delete ${lead?.name || 'this record'}? This can't be undone.`)) {
        store.deleteLead(d.id);
        toast('Record deleted');
        render();
      }
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
      if (confirm('Clear ALL leads from the CRM?\n\nThis permanently deletes every lead record and cannot be undone. (Enrolled students are not affected.)')) {
        store.clearLeads();
        toast('CRM cleared');
        render();
      }
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
    const answers = {};
    quiz.questions.forEach((q) => {
      answers[q.id] = (form.elements[q.id]?.value || '').trim();
    });
    const unbusy = setBusy(form, 'Submitting…');
    const res = await store.submitWritten(user.id, quiz.id, answers, nowISO());
    if (res.ok) {
      clearQuizDraft(user.id, quiz.id);
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

  if (form.id === 'discForm') {
    const user = currentUser();
    const body = form.body.value.trim();
    if (!body) return;
    const parentId = disc.replyToId || null;
    store.addDiscussionPost(user, body, parentId);
    disc.draft = '';
    disc.replyToId = null;
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
  if (e.target.id === 'discInput' && e.key === 'Enter' && !e.shiftKey) {
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
    toast('Quiz questions saved ✓');
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
