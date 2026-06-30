/* =============================================================================
   UMOF Learning Portal — App shell, router & views
   ========================================================================== */

import './portal.css';
import * as store from './store.js';
import {
  login, logout, currentUser, initAuth,
  signUp, requestPasswordReset, updatePassword, updateDisplayName, onAuthEvent,
} from './auth.js';
import { downloadCSV, exportPDF, exportWord } from './export.js';
import { USE_SUPABASE } from './config.js';

const app = document.getElementById('app');

/* ---- small helpers -------------------------------------------------------- */
const esc = (v) =>
  String(v == null ? '' : v).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );

const todayISO = () => new Date().toISOString().slice(0, 10);

const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
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

function toast(msg) {
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
  toast._t = setTimeout(() => t.classList.remove('show'), 2200);
}

/* ---- app state ------------------------------------------------------------ */
let route = { name: null, params: {} };
let crm = { view: 'leads', q: '', status: 'all', adding: false };

// logged-out auth screens
let authScreen = 'login'; // 'login' | 'signup' | 'forgot'
let authError = '';
let authInfo = '';
let recoveryMode = false; // user arrived via a password-reset link

function go(name, params = {}) {
  route = { name, params };
  render();
  document.querySelector('.portal-main')?.scrollTo(0, 0);
}

function goAuth(screen) {
  authScreen = screen;
  authError = '';
  authInfo = '';
  render();
}

/** Re-render in place when realtime pushes a change (only while logged in). */
function liveRerender() {
  if (currentUser()) render();
}

/** Shared post-authentication entry: load data, start realtime, show dashboard. */
async function enterApp(user) {
  await store.hydrate(user);
  store.startRealtime(user, liveRerender);
  go(user.role === 'admin' ? 'admin-home' : 'student-home');
}

/** Disable a form's submit button and show a working label. */
function setBusy(form, label) {
  const btn = form.querySelector('button[type="submit"]');
  if (btn) {
    btn.disabled = true;
    btn.textContent = label;
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
  return `${authError ? `<p class="auth-error">${esc(authError)}</p>` : ''}${
    authInfo ? `<p class="auth-ok">${esc(authInfo)}</p>` : ''
  }`;
}

function viewLogin() {
  return authShell(`
    <h1>Sign in</h1>
    <p class="auth-sub">Students access class sessions, notes &amp; tests. Instructors manage progress, grading &amp; the CRM.</p>
    <form id="loginForm" class="auth-form" novalidate>
      <label class="field"><span>Email</span>
        <input type="email" name="email" autocomplete="username" placeholder="you@example.com" required />
      </label>
      <label class="field"><span>Password</span>
        <input type="password" name="password" autocomplete="current-password" placeholder="••••••••" required />
      </label>
      ${authMsgs()}
      <button type="submit" class="btn btn-primary btn-full">Sign in</button>
    </form>
    ${
      USE_SUPABASE
        ? `<div class="auth-links">
            <button class="link-btn" data-action="auth-screen" data-screen="forgot">Forgot password?</button>
            <span>New here? <button class="link-btn strong" data-action="auth-screen" data-screen="signup">Create an account</button></span>
          </div>`
        : `<div class="auth-demo">
        <p>Demo logins — click to try instantly:</p>
        <div class="auth-demo-btns">
          <button class="btn btn-outline btn-sm" data-action="demo" data-role="student">Student demo</button>
          <button class="btn btn-outline btn-sm" data-action="demo" data-role="admin">Admin / Instructor demo</button>
        </div>
        <small>student: jordan@umof.org · admin: admin@umof.org — password for both: shown on click</small>
      </div>`
    }
  `);
}

function viewSignup() {
  return authShell(`
    <h1>Create your account</h1>
    <p class="auth-sub">Sign up to access your class sessions, notes, and tests.</p>
    <form id="signupForm" class="auth-form" novalidate>
      <label class="field"><span>Full name</span>
        <input type="text" name="name" autocomplete="name" placeholder="Jane Doe" required />
      </label>
      <label class="field"><span>Email</span>
        <input type="email" name="email" autocomplete="email" placeholder="you@example.com" required />
      </label>
      <label class="field"><span>Password</span>
        <input type="password" name="password" autocomplete="new-password" placeholder="At least 8 characters" minlength="8" required />
      </label>
      ${authMsgs()}
      <button type="submit" class="btn btn-primary btn-full">Create account</button>
    </form>
    <div class="auth-links">
      <span>Already have an account? <button class="link-btn strong" data-action="auth-screen" data-screen="login">Sign in</button></span>
    </div>
  `);
}

function viewForgot() {
  return authShell(`
    <h1>Reset your password</h1>
    <p class="auth-sub">Enter your email and we’ll send you a link to set a new password.</p>
    <form id="forgotForm" class="auth-form" novalidate>
      <label class="field"><span>Email</span>
        <input type="email" name="email" autocomplete="email" placeholder="you@example.com" required />
      </label>
      ${authMsgs()}
      <button type="submit" class="btn btn-primary btn-full">Send reset link</button>
    </form>
    <div class="auth-links">
      <button class="link-btn" data-action="auth-screen" data-screen="login">← Back to sign in</button>
    </div>
  `);
}

function viewReset() {
  return authShell(`
    <h1>Set a new password</h1>
    <p class="auth-sub">Choose a new password for your account.</p>
    <form id="resetForm" class="auth-form" novalidate>
      <label class="field"><span>New password</span>
        <input type="password" name="password" autocomplete="new-password" placeholder="At least 8 characters" minlength="8" required />
      </label>
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
  return `
  <div class="page-head"><div><h1>Account</h1><p class="muted">Manage your name and password.</p></div></div>
  <div class="two-col">
    <section class="panel">
      <div class="panel-head"><h2>Profile</h2></div>
      <form id="nameForm" class="acct-form">
        <label class="field"><span>Display name</span>
          <input type="text" name="name" value="${esc(user.name)}" required />
        </label>
        <label class="field"><span>Email</span>
          <input type="email" value="${esc(user.email)}" disabled />
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
                <input type="password" name="password" autocomplete="new-password" placeholder="At least 8 characters" minlength="8" required />
              </label>
              <label class="field"><span>Confirm new password</span>
                <input type="password" name="confirm" autocomplete="new-password" placeholder="Re-enter password" minlength="8" required />
              </label>
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
    <aside class="portal-side">
      <a class="side-brand" href="/">
        <img src="/assets/umof-logo.png" alt="UMOF" width="36" height="36" />
        <span><strong>UMOF</strong><small>Learning Portal</small></span>
      </a>
      <nav class="side-nav">${items}</nav>
      <div class="side-foot">
        <a class="side-link" href="/">← Main website</a>
        ${user.role === 'admin' && !USE_SUPABASE ? `<button class="side-link" data-action="reset">↺ Reset demo data</button>` : ''}
      </div>
    </aside>
    <div class="portal-body">
      <header class="portal-top">
        <button class="side-toggle" data-action="toggle-side" aria-label="Menu">☰</button>
        <div class="top-spacer"></div>
        <div class="top-user">
          <div class="tu-text"><strong>${esc(user.name)}</strong><small>${user.role === 'admin' ? esc(user.title || 'Instructor') : esc(user.cohort || 'Student')}</small></div>
          ${avatar(user, 40)}
          <button class="btn btn-ghost btn-sm" data-action="logout">Log out</button>
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
   STUDENT VIEWS
   ======================================================================== */
function studentNav(user) {
  return [
    { route: 'student-home', label: 'Dashboard', icon: '▥' },
    { route: 'student-sessions', label: 'Class Sessions', icon: '▶' },
    { route: 'student-tests', label: 'My Tests', icon: '✓' },
    { route: 'account', label: 'Account', icon: '⚙' },
  ];
}

function studentHome(user) {
  const s = store.getStudentStats(user.id);
  const prog = store.getProgress(user.id);
  const sessions = store.getSessions();
  const next = sessions.find((x) => !prog.completed.includes(x.id));
  const avg = s.avgScore == null ? '—' : `${s.avgScore}%`;

  return `
  <div class="page-head">
    <div><h1>Welcome back, ${esc(user.name.split(' ')[0])}</h1>
    <p class="muted">The Entrepreneur’s Journey — Funding Masterclass · ${esc(user.cohort)}</p></div>
  </div>

  <div class="stat-grid">
    ${statCard('Course progress', `${s.completionPct}%`, bar(s.completionPct))}
    ${statCard('Sessions completed', `${s.completed}/${s.totalSessions}`)}
    ${statCard('Average test score', avg)}
    ${statCard('Results pending', s.pendingGrading)}
  </div>

  ${
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
    <div class="panel-head"><h2>All class sessions</h2>
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
  </section>`;
}

function studentSessions(user) {
  const prog = store.getProgress(user.id);
  const sessions = store.getSessions();
  return `
  <div class="page-head"><h1>Class Sessions</h1><p class="muted">Watch recordings and review the notes for each week.</p></div>
  <div class="card-grid">
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
  </div>`;
}

function sessionDetail(user) {
  const sx = store.getSessionById(route.params.id);
  if (!sx) return `<p>Session not found.</p>`;
  const prog = store.getProgress(user.id);
  const done = prog.completed.includes(sx.id);
  const quizzes = store.getQuizzesForSession(sx.id);

  return `
  <button class="back-link" data-action="go" data-route="student-sessions">← All sessions</button>
  <div class="page-head"><div>
    <span class="eyebrow">Week ${sx.week} · ${fmtDate(sx.date)} · ${sx.durationMin} min</span>
    <h1>${esc(sx.title)}</h1>
  </div></div>

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
            ? `View result (${sub.score}%)`
            : 'View submission'
          : `Take the ${q.type === 'auto' ? 'quiz' : 'assignment'}`;
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
  </section>`;
}

function quizView(user) {
  const q = store.getQuizById(route.params.id);
  if (!q) return `<p>Test not found.</p>`;
  const sub = store.getProgress(user.id).submissions?.[q.id];
  const sx = store.getSessionById(q.sessionId);
  const head = `
    <button class="back-link" data-action="go" data-route="session" data-id="${q.sessionId}">← ${esc(sx ? sx.title : 'Back')}</button>
    <div class="page-head"><div><span class="eyebrow">${q.type === 'auto' ? 'Quiz' : 'Assignment'}</span><h1>${esc(q.title)}</h1></div></div>`;

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
      <div class="pending-banner">⏳ Submitted ${fmtDate(sub.submittedAt)} — awaiting instructor review.</div>
      <div class="panel-head"><h2>Your submission</h2></div><p class="answer-box">${esc(sub.answer)}</p>
    </section>`;
  }
  return `${head}
  <form id="manualForm" data-quiz="${q.id}" class="panel">
    <p class="muted">${esc(q.prompt)}</p>
    <label class="field"><span>Your response</span>
      <textarea name="answer" rows="9" placeholder="Write your response here…" required></textarea>
    </label>
    <button type="submit" class="btn btn-primary">Submit for review</button>
  </form>`;
}

function studentTests(user) {
  const prog = store.getProgress(user.id);
  const quizzes = store.getQuizzes();
  return `
  <div class="page-head"><h1>My Tests</h1><p class="muted">Your quizzes and assignments across the program.</p></div>
  <section class="panel">
    <table class="data-table">
      <thead><tr><th>Test</th><th>Type</th><th>Status</th><th>Score</th><th></th></tr></thead>
      <tbody>
        ${quizzes
          .map((q) => {
            const sub = prog.submissions?.[q.id];
            const status = !sub
              ? `<span class="pill pill-todo">Not started</span>`
              : sub.status === 'graded'
              ? `<span class="pill pill-done">Graded</span>`
              : `<span class="pill pill-pending">Pending review</span>`;
            const score = sub && sub.status === 'graded' ? `${sub.score}${q.type === 'manual' ? '/100' : '%'}` : '—';
            const cta = !sub ? 'Start' : 'View';
            return `<tr>
              <td><strong>${esc(q.title)}</strong></td>
              <td>${q.type === 'auto' ? 'Quiz' : 'Assignment'}</td>
              <td>${status}</td>
              <td>${score}</td>
              <td><button class="btn btn-ghost btn-sm" data-action="go" data-route="quiz" data-id="${q.id}">${cta} →</button></td>
            </tr>`;
          })
          .join('')}
      </tbody>
    </table>
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
    { route: 'admin-access', label: 'Access', icon: '🔑' },
    { route: 'account', label: 'Account', icon: '⚙' },
  ];
}

function adminHome() {
  const students = store.getStudents();
  const queue = store.getGradingQueue();
  const leads = store.getLeads();
  const activeLeads = leads.filter((l) => l.status !== 'lost' && l.status !== 'enrolled').length;
  const avgCompletion = Math.round(
    students.reduce((sum, s) => sum + store.getStudentStats(s.id).completionPct, 0) / students.length
  );

  return `
  <div class="page-head"><div><h1>Instructor Dashboard</h1><p class="muted">Summer 2026 cohort · Funding Masterclass</p></div></div>

  <div class="stat-grid">
    ${statCard('Enrolled students', students.length)}
    ${statCard('Avg. completion', `${avgCompletion}%`, bar(avgCompletion))}
    ${statCard('Awaiting grading', queue.length, queue.length ? `<button class="link-arrow" data-action="go" data-route="admin-grading">Grade now →</button>` : 'All caught up')}
    ${statCard('Active leads', activeLeads, `<button class="link-arrow" data-action="go" data-route="admin-crm">Open CRM →</button>`)}
  </div>

  <div class="two-col">
    <section class="panel">
      <div class="panel-head"><h2>Grading queue</h2>${queue.length ? `<button class="btn btn-ghost btn-sm" data-action="go" data-route="admin-grading">View all →</button>` : ''}</div>
      ${
        queue.length
          ? `<div class="mini-list">${queue
              .slice(0, 5)
              .map(
                (g) => `<button class="mini-row" data-action="go" data-route="grade" data-student="${g.student.id}" data-quiz="${g.quizId}">
            ${avatar(g.student, 32)}
            <span class="mr-main"><strong>${esc(g.student.name)}</strong><small>${esc(g.quiz.title)}</small></span>
            <span class="pill pill-pending">Submitted ${fmtDate(g.submission.submittedAt)}</span>
          </button>`
              )
              .join('')}</div>`
          : `<p class="muted">No submissions waiting. 🎉</p>`
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
  <div class="page-head"><div><h1>Students</h1><p class="muted">${students.length} enrolled · click a student for detail</p></div>
    <div class="head-actions">
      <button class="btn btn-outline btn-sm" data-action="export-students-csv">⬇ CSV</button>
      <button class="btn btn-outline btn-sm" data-action="export-students-word">⬇ Word</button>
      <button class="btn btn-outline btn-sm" data-action="export-students-pdf">⬇ PDF</button>
    </div>
  </div>
  <section class="panel">
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
            return `<div class="check-row"><span class="${done ? 'check on' : 'check'}">${done ? '✓' : ''}</span>
              <span>W${x.week} · ${esc(x.title)}</span></div>`;
          })
          .join('')}
      </div>
    </section>

    <section class="panel">
      <div class="panel-head"><h2>Tests &amp; assignments</h2></div>
      <table class="data-table compact">
        <thead><tr><th>Test</th><th>Status</th><th>Score</th><th></th></tr></thead>
        <tbody>
          ${quizzes
            .map((q) => {
              const sub = prog.submissions?.[q.id];
              if (!sub) return `<tr><td>${esc(q.title)}</td><td><span class="pill pill-todo">Not started</span></td><td>—</td><td></td></tr>`;
              const status =
                sub.status === 'graded'
                  ? `<span class="pill pill-done">Graded</span>`
                  : `<span class="pill pill-pending">Needs grading</span>`;
              const score = sub.status === 'graded' ? `${sub.score}${q.type === 'manual' ? '/100' : '%'}` : '—';
              const action =
                sub.type === 'manual' && sub.status === 'submitted'
                  ? `<button class="btn btn-primary btn-sm" data-action="go" data-route="grade" data-student="${s.id}" data-quiz="${q.id}">Grade →</button>`
                  : '';
              return `<tr><td><strong>${esc(q.title)}</strong></td><td>${status}</td><td>${score}</td><td>${action}</td></tr>`;
            })
            .join('')}
        </tbody>
      </table>
    </section>
  </div>`;
}

function adminGrading() {
  const queue = store.getGradingQueue();
  return `
  <div class="page-head"><div><h1>Grading</h1><p class="muted">${queue.length} submission${queue.length === 1 ? '' : 's'} awaiting your review</p></div></div>
  <section class="panel">
    ${
      queue.length
        ? `<div class="mini-list">${queue
            .map(
              (g) => `<button class="mini-row" data-action="go" data-route="grade" data-student="${g.student.id}" data-quiz="${g.quizId}">
          ${avatar(g.student, 36)}
          <span class="mr-main"><strong>${esc(g.student.name)}</strong><small>${esc(g.quiz.title)} · submitted ${fmtDate(g.submission.submittedAt)}</small></span>
          <span class="btn btn-primary btn-sm">Grade →</span>
        </button>`
            )
            .join('')}</div>`
        : `<div class="empty"><div class="empty-ico">✓</div><h3>All caught up</h3><p class="muted">There are no submissions waiting to be graded.</p></div>`
    }
  </section>`;
}

function gradeView() {
  const { student: studentId, quiz: quizId } = route.params;
  const student = store.getUserById(studentId);
  const quiz = store.getQuizById(quizId);
  const sub = store.getProgress(studentId).submissions?.[quizId];
  if (!student || !quiz || !sub) return `<p>Submission not found.</p>`;

  return `
  <button class="back-link" data-action="go" data-route="admin-grading">← Grading queue</button>
  <div class="page-head"><div class="cell-user big">${avatar(student, 48)}<div>
    <h1>${esc(quiz.title)}</h1><p class="muted">${esc(student.name)} · submitted ${fmtDate(sub.submittedAt)}</p></div></div></div>

  <section class="panel"><div class="panel-head"><h2>Prompt</h2></div><p class="muted">${esc(quiz.prompt)}</p></section>
  <section class="panel"><div class="panel-head"><h2>Student submission</h2></div><p class="answer-box">${esc(sub.answer)}</p></section>

  <form id="gradeForm" data-student="${studentId}" data-quiz="${quizId}" class="panel">
    <div class="panel-head"><h2>Assign grade</h2></div>
    <div class="grade-row">
      <label class="field grade-score"><span>Score (0–${quiz.maxScore || 100})</span>
        <input type="number" name="score" min="0" max="${quiz.maxScore || 100}" value="${sub.score ?? ''}" required />
      </label>
    </div>
    <label class="field"><span>Feedback to student</span>
      <textarea name="feedback" rows="5" placeholder="What was strong, what to improve…">${esc(sub.feedback || '')}</textarea>
    </label>
    <button type="submit" class="btn btn-primary">Save grade &amp; release to student</button>
  </form>`;
}

function adminContent() {
  const sessions = store.getSessions();
  return `
  <div class="page-head"><div><h1>Class Sessions</h1><p class="muted">Recordings, notes &amp; linked tests · ${sessions.length} published</p></div></div>
  <section class="panel">
    <table class="data-table">
      <thead><tr><th>Wk</th><th>Title</th><th>Date</th><th>Video</th><th>Tests</th></tr></thead>
      <tbody>
        ${sessions
          .map((x) => {
            const qz = store.getQuizzesForSession(x.id);
            const source = x.isFile
              ? `<span class="pill pill-done">Uploaded</span>`
              : `<span class="pill pill-todo">Embed</span>`;
            const uploader = USE_SUPABASE
              ? `<label class="upload-btn">${x.isFile ? 'Replace' : 'Upload'}
                   <input type="file" accept="video/*" data-action="upload-video" data-session="${x.id}" hidden />
                 </label>`
              : '';
            return `<tr><td>${x.week}</td><td><strong>${esc(x.title)}</strong><br><small class="muted">${esc(x.summary)}</small></td>
              <td>${fmtDate(x.date)} · ${x.durationMin} min</td>
              <td><div class="video-cell">${source}${uploader}</div></td>
              <td>${qz.length ? qz.map((q) => `<span class="tag">${esc(q.title)}</span>`).join('') : '—'}</td></tr>`;
          })
          .join('')}
      </tbody>
    </table>
    <p class="hint">${
      USE_SUPABASE
        ? 'Upload a recording (MP4) to host it privately in Supabase Storage — students stream it via a secure, expiring link. Or keep using YouTube/Vimeo embeds.'
        : 'Connect Supabase (see SUPABASE_SETUP.md) to upload and host videos here. In demo mode, sessions use embedded sample videos.'
    }</p>
  </section>`;
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

  const tableBody = isLeads
    ? r.data
        .map(
          (l) => `<tr>
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
        <td><input class="notes-input" value="${esc(l.notes)}" data-action="lead-notes" data-id="${l.id}" placeholder="Add a note…" /></td>
        <td><button class="row-del" data-action="delete-lead" data-id="${l.id}" title="Delete record" aria-label="Delete ${esc(l.name)}">🗑</button></td>
      </tr>`
        )
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

  // an extra (blank) header for the per-row delete button on the leads table
  const headCols = isLeads ? [...r.columns, ''] : r.columns;
  const colCount = headCols.length;

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

  ${isLeads && crm.adding ? addRecordForm() : ''}

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
      ? ''
      : `<p class="crm-hint muted">Students appear here automatically once they create a portal account. To let someone in, approve their email under <button class="link-arrow" data-action="go" data-route="admin-access">Access →</button> To simply track a person, add them as a record under <strong>Leads</strong>.</p>`
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

/** The manual "add a student / lead" form — every CRM field is available here. */
function addRecordForm() {
  return `
  <section class="panel crm-add">
    <div class="panel-head">
      <h2>Add a student or lead</h2>
      <p class="muted">Enter everything you know — only a name is required. New records are saved under <strong>Leads</strong>; set the status to <em>enrolled</em> for current students.</p>
    </div>
    <form id="addLeadForm" class="lead-form" autocomplete="off">
      <div class="lead-form-grid">
        <label class="field"><span>Name *</span><input name="name" required placeholder="Full name" /></label>
        <label class="field"><span>Email</span><input name="email" type="email" placeholder="name@example.com" /></label>
        <label class="field"><span>Phone</span><input name="phone" placeholder="(404) 555-0100" /></label>
        <label class="field"><span>Source</span><input name="source" list="leadSources" placeholder="Website, Referral, Event…" /></label>
        <label class="field"><span>Interest</span><input name="interest" list="leadInterests" placeholder="Funding Masterclass…" /></label>
        <label class="field"><span>Status</span>
          <select name="status">${STATUS_OPTIONS.map((o) => `<option value="${o}" ${o === 'new' ? 'selected' : ''}>${o}</option>`).join('')}</select>
        </label>
        <label class="field"><span>Date added</span><input name="createdAt" type="date" value="${todayISO()}" /></label>
        <label class="field"><span>Grant ($300 fee)</span>
          <span class="grant-cell">
            <input type="checkbox" class="grant-chk" name="grantAwarded" />
            <input type="number" class="grant-amt" name="grantAmount" value="300" min="0" step="50" />
          </span>
        </label>
      </div>
      <label class="field lead-form-notes"><span>Notes</span><textarea name="notes" rows="2" placeholder="Anything useful — payment plan, business type, follow-up date…"></textarea></label>
      <div class="lead-form-actions">
        <button type="button" class="btn btn-ghost" data-action="toggle-add-lead">Cancel</button>
        <button type="submit" class="btn btn-primary">Add record</button>
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
  // Arrived via a password-reset link — force the "set new password" screen.
  if (recoveryMode) {
    app.innerHTML = viewReset();
    return;
  }

  const user = currentUser();
  if (!user) {
    app.innerHTML = renderAuthScreen();
    return;
  }

  if (user.role === 'student') {
    const allowed = ['student-home', 'student-sessions', 'student-tests', 'session', 'quiz', 'account'];
    if (!allowed.includes(route.name)) route = { name: 'student-home', params: {} };
    const views = {
      'student-home': studentHome,
      'student-sessions': studentSessions,
      'student-tests': studentTests,
      session: sessionDetail,
      quiz: quizView,
      account: accountView,
    };
    const content = (views[route.name] || studentHome)(user);
    app.innerHTML = shell(user, studentNav(user), content);
  } else {
    const allowed = ['admin-home', 'admin-students', 'admin-student', 'admin-grading', 'grade', 'admin-crm', 'admin-content', 'admin-access', 'account'];
    if (!allowed.includes(route.name)) route = { name: 'admin-home', params: {} };
    const views = {
      'admin-home': adminHome,
      'admin-students': adminStudents,
      'admin-student': adminStudentDetail,
      'admin-grading': adminGrading,
      grade: gradeView,
      'admin-crm': adminCRM,
      'admin-content': adminContent,
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
}

/* ===========================================================================
   EVENT WIRING (delegated)
   ======================================================================== */
function actionFrom(e) {
  const node = e.target.closest('[data-action]');
  return node ? { action: node.dataset.action, node } : null;
}

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
      await logout();
      route = { name: null, params: {} };
      authScreen = 'login';
      authError = '';
      authInfo = '';
      render();
      break;
    case 'go':
      go(d.route, { id: d.id, student: d.student, quiz: d.quiz });
      break;
    case 'remove-allowed':
      store.removeAllowedStudent(d.email);
      toast('Removed from approved list');
      render();
      break;
    case 'toggle-complete': {
      const user = currentUser();
      const prog = store.getProgress(user.id);
      const isDone = prog.completed.includes(d.id);
      store.setSessionComplete(user.id, d.id, !isDone);
      toast(isDone ? 'Marked as not done' : 'Session marked complete ✓');
      render();
      break;
    }
    case 'reset':
      store.resetDemo();
      toast('Demo data reset');
      render();
      break;
    case 'toggle-side':
      document.querySelector('.portal-shell')?.classList.toggle('side-open');
      break;
    case 'crm-view':
      crm.view = d.view;
      crm.q = '';
      crm.status = 'all';
      crm.adding = false;
      render();
      break;
    case 'toggle-add-lead':
      crm.adding = !crm.adding;
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
  }
});

app.addEventListener('submit', async (e) => {
  const form = e.target;
  e.preventDefault();

  if (form.id === 'loginForm') {
    setBusy(form, 'Signing in…');
    const res = await login(form.email.value, form.password.value);
    if (res.ok) await enterApp(res.user);
    else {
      authError = res.error;
      authInfo = '';
      render();
    }
    return;
  }

  if (form.id === 'signupForm') {
    setBusy(form, 'Creating…');
    const res = await signUp(form.name.value, form.email.value, form.password.value);
    if (!res.ok) {
      authError = res.error;
      authInfo = '';
      render();
      return;
    }
    if (res.needsConfirmation) {
      authScreen = 'login';
      authError = '';
      authInfo = 'Account created! Check your email to confirm it, then sign in.';
      render();
    } else {
      authError = '';
      authInfo = '';
      await enterApp(res.user);
    }
    return;
  }

  if (form.id === 'forgotForm') {
    setBusy(form, 'Sending…');
    const res = await requestPasswordReset(form.email.value);
    authScreen = 'login';
    if (res.ok) {
      authError = '';
      authInfo = 'If that email has an account, a reset link is on its way.';
    } else {
      authError = res.error;
      authInfo = '';
    }
    render();
    return;
  }

  if (form.id === 'resetForm') {
    setBusy(form, 'Updating…');
    const res = await updatePassword(form.password.value);
    if (!res.ok) {
      authError = res.error;
      render();
      return;
    }
    recoveryMode = false;
    authError = '';
    authInfo = '';
    const user = await initAuth();
    if (user) await enterApp(user);
    else {
      authScreen = 'login';
      authInfo = 'Password updated — please sign in.';
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

  if (form.id === 'nameForm') {
    const res = await updateDisplayName(form.name.value);
    toast(res.ok ? 'Name updated ✓' : res.error || 'Could not update name');
    if (res.ok) render();
    return;
  }

  if (form.id === 'pwForm') {
    if (form.password.value !== form.confirm.value) {
      toast('Passwords don’t match');
      return;
    }
    const res = await updatePassword(form.password.value);
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
    const res = store.submitAutoQuiz(user.id, quiz.id, answers, todayISO());
    toast(`Scored ${res.score}% (${res.correct}/${res.total})`);
    render();
    return;
  }

  if (form.id === 'manualForm') {
    const user = currentUser();
    store.submitManual(user.id, form.dataset.quiz, form.answer.value.trim(), todayISO());
    toast('Submitted for review ✓');
    render();
    return;
  }

  if (form.id === 'gradeForm') {
    const score = Number(form.score.value);
    store.gradeSubmission(form.dataset.student, form.dataset.quiz, score, form.feedback.value.trim(), todayISO());
    toast('Grade saved & released ✓');
    go('admin-grading');
    return;
  }
});

app.addEventListener('input', (e) => {
  const hit = actionFrom(e);
  if (!hit) return;
  if (hit.action === 'crm-search') {
    crm.q = e.target.value;
    render._refocusSearch = true;
    render();
  }
});

app.addEventListener('change', async (e) => {
  const hit = actionFrom(e);
  if (!hit) return;
  const { action, node } = hit;
  if (action === 'lead-status') {
    store.updateLeadStatus(node.dataset.id, node.value);
    toast('Status updated');
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
  }
});

/* surface failed background writes (Supabase mode) */
store.onError(() => toast('Couldn’t reach the server — your last change may not have saved.'));

/* catch the password-reset link — Supabase fires PASSWORD_RECOVERY after load */
onAuthEvent((event) => {
  if (event === 'PASSWORD_RECOVERY') {
    recoveryMode = true;
    authError = '';
    authInfo = '';
    render();
  }
});

/* boot: restore any existing session, load the data it can see, then render */
(async () => {
  app.innerHTML = `<div class="portal-loading"><span class="spinner" aria-hidden="true"></span>Loading your portal…</div>`;
  try {
    const user = await initAuth();
    if (user && !recoveryMode) {
      await store.hydrate(user);
      store.startRealtime(user, liveRerender);
    }
  } catch (err) {
    console.error('[portal] startup error:', err);
  }
  render();
})();
