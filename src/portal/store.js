/* =============================================================================
   UMOF Learning Portal — Store (dual-mode)
   -----------------------------------------------------------------------------
   Reads are synchronous against an in-memory `state` cache, so every view in
   app.js stays unchanged. The cache is filled two ways:

     • LOCAL DEMO mode  (no Supabase keys) — seeded from data.js, persisted to
       localStorage. Identical to the original prototype.
     • SUPABASE mode    (keys in .env)     — hydrate(user) loads the rows this
       user is allowed to see (enforced by RLS), mapped into the same shape.

   Mutations update the cache immediately (snappy UI) and, in Supabase mode,
   write through to the database in the background.
   ========================================================================== */

import { USE_SUPABASE } from './config.js';
import { supabase } from './supabase.js';
import { SEED } from './data.js';

const KEY = 'umof_portal_v1';
const listeners = new Set();
let errorHandler = null;

let state = USE_SUPABASE ? emptyState() : loadLocal();

function emptyState() {
  return { users: [], sessions: [], quizzes: [], progress: {}, leads: [], allowedStudents: [], materials: [], discussion: [] };
}
function loadLocal() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Migration: consolidate all sessions into Week 1 / 2026-07-06
      if (parsed.sessions && parsed.sessions.some((s) => s.week !== 1 || s.date !== '2026-07-06')) {
        parsed.sessions = parsed.sessions.map((s) => ({ ...s, week: 1, date: '2026-07-06' }));
        try { localStorage.setItem(KEY, JSON.stringify(parsed)); } catch { /* ignore */ }
      }
      return parsed;
    }
  } catch {
    /* fall through to seed */
  }
  const fresh = structuredClone(SEED);
  try {
    localStorage.setItem(KEY, JSON.stringify(fresh));
  } catch {
    /* storage disabled */
  }
  return fresh;
}
function saveLocal() {
  if (USE_SUPABASE) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage full / disabled */
  }
}
function set(next) {
  state = next;
  saveLocal();
  listeners.forEach((fn) => fn(state));
}
function reportError(e) {
  console.error('[portal] backend write failed:', e);
  errorHandler?.(e);
}
/** Fire-and-forget a Supabase write; surface errors via the error handler.
 *  Takes a THUNK so `supabase.from(...)` is only evaluated when connected —
 *  in demo mode `supabase` is null and must never be touched. */
function push(queryFn) {
  if (!USE_SUPABASE || !supabase) return;
  Promise.resolve(queryFn())
    .then((res) => {
      if (res && res.error) reportError(res.error);
    })
    .catch(reportError);
}

/** app.js registers a toast handler here so failed writes are visible. */
export function onError(fn) {
  errorHandler = fn;
}
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/* ---- LOCAL-only: reset the demo dataset ----------------------------------- */
export function resetDemo() {
  if (USE_SUPABASE) return; // never wipes a real database
  localStorage.removeItem(KEY);
  set(structuredClone(SEED));
}

/* ===========================================================================
   HYDRATE — fill the cache from Supabase for the signed-in user
   ======================================================================== */
const d10 = (v) => (v ? String(v).slice(0, 10) : v); // timestamptz/date → YYYY-MM-DD

const STORAGE_PREFIX = 'storage:'; // a sessions.video_url pointing at our bucket
const mapSession = (r) => {
  const isFile = typeof r.video_url === 'string' && r.video_url.startsWith(STORAGE_PREFIX);
  return {
    id: r.id, week: r.week, title: r.title, date: d10(r.date),
    durationMin: r.duration_min, thumb: r.thumb, videoUrl: r.video_url,
    summary: r.summary, notes: r.notes || [],
    meetUrl: r.meet_url || '', liveAt: r.live_at || '',
    isFile,
    storagePath: isFile ? r.video_url.slice(STORAGE_PREFIX.length) : null,
    playUrl: '', // filled with a signed URL during hydrate
  };
};
const mapQuiz = (r) => ({
  id: r.id, sessionId: r.session_id, type: r.type, title: r.title,
  maxScore: r.max_score, prompt: r.prompt, questions: r.questions || [],
  published: !!r.published, due: d10(r.due_date),
});
// A class material's `url` is either a normal URL (link/external) or a
// 'storage:'-prefixed object path in the session-media bucket (a private file).
const mapMaterial = (r) => {
  const isFile = typeof r.url === 'string' && r.url.startsWith(STORAGE_PREFIX);
  return {
    id: r.id, sessionId: r.session_id, kind: r.kind, title: r.title,
    url: isFile ? '' : r.url,
    isFile,
    storagePath: isFile ? r.url.slice(STORAGE_PREFIX.length) : null,
    playUrl: '', // filled with a signed URL during hydrate
  };
};
const mapProfile = (r) => ({
  id: r.id, role: r.role, name: r.name, email: r.email, phone: r.phone,
  title: r.title, cohort: r.cohort, enrolled: d10(r.enrolled), plan: r.plan,
  grantAwarded: !!r.grant_awarded, grantAmount: Number(r.grant_amount) || 0,
});
// A class-discussion post. `author_name`/`author_role` are denormalized on the
// row (set server-side) so every classmate can see who wrote it — students can't
// read each other's `profiles` rows under RLS.
const mapPost = (r) => ({
  id: r.id, authorId: r.author_id, authorName: r.author_name || 'Student',
  authorRole: r.author_role || 'student', body: r.body || '', createdAt: r.created_at,
});
const mapSubmission = (r) => ({
  type: r.type, status: r.status, score: r.score, total: r.total,
  correct: r.correct, answer: r.answer, answers: r.answers,
  feedback: r.feedback, submittedAt: d10(r.submitted_at), gradedAt: d10(r.graded_at),
});

export async function hydrate(user) {
  if (!USE_SUPABASE) return; // local mode is already loaded
  if (!user) {
    set(emptyState());
    return;
  }
  const next = emptyState();
  const isAdmin = user.role === 'admin';

  // course content — visible to everyone authenticated
  const [{ data: sessions }, { data: quizzes }] = await Promise.all([
    supabase.from('sessions').select('*'),
    supabase.from('quizzes').select('*'),
  ]);
  next.sessions = (sessions || []).map(mapSession);
  next.quizzes = (quizzes || []).map(mapQuiz);

  // mint short-lived signed URLs for any sessions whose video lives in Storage
  const fileSessions = next.sessions.filter((s) => s.isFile && s.storagePath);
  if (fileSessions.length) {
    const { data: signed } = await supabase.storage
      .from('session-media')
      .createSignedUrls(fileSessions.map((s) => s.storagePath), 7200); // 2h
    (signed || []).forEach((sg, i) => {
      if (!sg.error) fileSessions[i].playUrl = sg.signedUrl;
    });
  }

  // class materials (resell-ready content library) — visible to all authenticated
  const { data: materials } = await supabase.from('class_materials').select('*');
  next.materials = (materials || []).map(mapMaterial);
  const fileMaterials = next.materials.filter((m) => m.isFile && m.storagePath);
  if (fileMaterials.length) {
    const { data: signedM } = await supabase.storage
      .from('session-media')
      .createSignedUrls(fileMaterials.map((m) => m.storagePath), 7200); // 2h
    (signedM || []).forEach((sg, i) => {
      if (!sg.error) fileMaterials[i].playUrl = sg.signedUrl;
    });
  }

  // class discussion board — visible to every authenticated user (student + admin)
  const { data: posts } = await supabase
    .from('discussion_posts')
    .select('*')
    .order('created_at', { ascending: true });
  next.discussion = (posts || []).map(mapPost);

  // people: admin sees everyone, a student sees just themselves
  const { data: profiles } = isAdmin
    ? await supabase.from('profiles').select('*')
    : await supabase.from('profiles').select('*').eq('id', user.id);
  next.users = (profiles || []).map(mapProfile);
  // make sure the signed-in user is present even before their profile row syncs
  if (!next.users.some((u) => u.id === user.id)) next.users.push(user);

  // progress (RLS already limits a student to their own rows)
  const [{ data: completions }, { data: submissions }] = await Promise.all([
    supabase.from('session_completions').select('*'),
    supabase.from('submissions').select('*'),
  ]);
  const ensure = (pid) => (next.progress[pid] ??= { completed: [], submissions: {} });
  (completions || []).forEach((c) => ensure(c.profile_id).completed.push(c.session_id));
  (submissions || []).forEach((s) => (ensure(s.profile_id).submissions[s.quiz_id] = mapSubmission(s)));

  // CRM leads + approved-student allowlist — admin only
  if (isAdmin) {
    const { data: leads } = await supabase.from('leads').select('*');
    next.leads = (leads || []).map((l) => ({
      ...l, createdAt: d10(l.created_at),
      grantAwarded: !!l.grant_awarded, grantAmount: Number(l.grant_amount) || 0,
    }));
    const { data: allowed } = await supabase
      .from('allowed_students')
      .select('*')
      .order('added_at', { ascending: false });
    next.allowedStudents = (allowed || []).map((a) => ({ email: a.email, note: a.note || '', addedAt: d10(a.added_at) }));
  }

  set(next);
}

/* ===========================================================================
   READS (synchronous, against the cache)
   ======================================================================== */
export const getUsers = () => state.users;
export const getStudents = () => state.users.filter((u) => u.role === 'student');
export const getUserById = (id) => state.users.find((u) => u.id === id) || null;
export const getSessions = () => [...state.sessions].sort((a, b) => a.week - b.week);
export const getSessionById = (id) => state.sessions.find((s) => s.id === id) || null;
export const getQuizzes = () => state.quizzes;
export const getQuizById = (id) => state.quizzes.find((q) => q.id === id) || null;
export const getQuizzesForSession = (sid) => state.quizzes.filter((q) => q.sessionId === sid);
// Student-facing: only tests an admin has set "live" are visible. Sorted so the
// soonest-due deliverable comes first (undated ones last).
const byDue = (a, b) =>
  String(a.due || '9999-12-31').localeCompare(String(b.due || '9999-12-31')) ||
  String(a.title).localeCompare(String(b.title));
export const getVisibleQuizzes = () => state.quizzes.filter((q) => q.published).sort(byDue);
export const getVisibleQuizzesForSession = (sid) =>
  state.quizzes.filter((q) => q.published && q.sessionId === sid).sort(byDue);
export const getLeads = () =>
  [...state.leads].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

/** The class discussion feed, oldest → newest (the view pins to the latest). */
export const getDiscussion = () =>
  [...(state.discussion || [])].sort((a, b) =>
    String(a.createdAt).localeCompare(String(b.createdAt))
  );

export function getProgress(studentId) {
  return state.progress[studentId] || { completed: [], submissions: {} };
}

export function getStudentStats(studentId) {
  const sessions = getSessions();
  const prog = getProgress(studentId);
  const completed = prog.completed.length;
  const totalSessions = sessions.length;
  const subs = Object.values(prog.submissions || {});
  const graded = subs.filter((s) => s.status === 'graded' && typeof s.score === 'number');
  const avgScore = graded.length
    ? Math.round(graded.reduce((sum, s) => sum + s.score, 0) / graded.length)
    : null;
  const pending = subs.filter((s) => s.status === 'submitted').length;
  return {
    completed,
    totalSessions,
    completionPct: totalSessions ? Math.round((completed / totalSessions) * 100) : 0,
    avgScore,
    quizzesTaken: subs.length,
    pendingGrading: pending,
  };
}

export function getGradingQueue() {
  const out = [];
  for (const student of getStudents()) {
    const prog = getProgress(student.id);
    for (const [quizId, sub] of Object.entries(prog.submissions || {})) {
      if (sub.type === 'manual' && sub.status === 'submitted') {
        out.push({ student, quiz: getQuizById(quizId), submission: sub, quizId });
      }
    }
  }
  return out.sort((a, b) =>
    String(a.submission.submittedAt).localeCompare(String(b.submission.submittedAt))
  );
}

/* ===========================================================================
   WRITES — update cache immediately, then persist (Supabase mode)
   ======================================================================== */
export function setSessionComplete(studentId, sessionId, complete) {
  const next = structuredClone(state);
  next.progress[studentId] ??= { completed: [], submissions: {} };
  const s = new Set(next.progress[studentId].completed);
  complete ? s.add(sessionId) : s.delete(sessionId);
  next.progress[studentId].completed = [...s];
  set(next);
  push(() =>
    complete
      ? supabase.from('session_completions').upsert(
          { profile_id: studentId, session_id: sessionId },
          { onConflict: 'profile_id,session_id' }
        )
      : supabase.from('session_completions').delete().match({ profile_id: studentId, session_id: sessionId })
  );
}

export function submitAutoQuiz(studentId, quizId, answers, todayISO) {
  const quiz = getQuizById(quizId);
  if (!quiz || quiz.type !== 'auto') return null;
  let correct = 0;
  quiz.questions.forEach((q) => {
    if (answers[q.id] === q.correctIndex) correct += 1;
  });
  const total = quiz.questions.length;
  const score = Math.round((correct / total) * 100);
  const next = structuredClone(state);
  next.progress[studentId] ??= { completed: [], submissions: {} };
  next.progress[studentId].submissions[quizId] = {
    type: 'auto', score, total, correct, status: 'graded', submittedAt: todayISO, answers,
  };
  set(next);
  push(() =>
    supabase.from('submissions').upsert(
      { profile_id: studentId, quiz_id: quizId, type: 'auto', status: 'graded', score, total, correct, answers, submitted_at: todayISO },
      { onConflict: 'profile_id,quiz_id' }
    )
  );
  return { score, correct, total };
}

export function submitManual(studentId, quizId, answer, todayISO) {
  const next = structuredClone(state);
  next.progress[studentId] ??= { completed: [], submissions: {} };
  next.progress[studentId].submissions[quizId] = {
    type: 'manual', status: 'submitted', submittedAt: todayISO, answer,
  };
  set(next);
  push(() =>
    supabase.from('submissions').upsert(
      { profile_id: studentId, quiz_id: quizId, type: 'manual', status: 'submitted', answer, submitted_at: todayISO },
      { onConflict: 'profile_id,quiz_id' }
    )
  );
}

/** Written test: student submits a free-response answer for each question.
 *  Answers are keyed by question id; the test then enters the grading queue. */
export function submitWritten(studentId, quizId, answers, todayISO) {
  const next = structuredClone(state);
  next.progress[studentId] ??= { completed: [], submissions: {} };
  next.progress[studentId].submissions[quizId] = {
    type: 'manual', status: 'submitted', submittedAt: todayISO, answers,
  };
  set(next);
  push(() =>
    supabase.from('submissions').upsert(
      { profile_id: studentId, quiz_id: quizId, type: 'manual', status: 'submitted', answers, submitted_at: todayISO },
      { onConflict: 'profile_id,quiz_id' }
    )
  );
}

/** Admin toggles a test live/offline (the "Go live" button on Sessions). */
export function setQuizPublished(quizId, published) {
  const next = structuredClone(state);
  const q = next.quizzes.find((x) => x.id === quizId);
  if (!q) return;
  q.published = published;
  set(next);
  push(() => supabase.from('quizzes').update({ published }).eq('id', quizId));
}

export function gradeSubmission(studentId, quizId, score, feedback, todayISO) {
  const next = structuredClone(state);
  const sub = next.progress[studentId]?.submissions?.[quizId];
  if (!sub) return;
  sub.status = 'graded';
  sub.score = score;
  sub.feedback = feedback;
  sub.gradedAt = todayISO;
  set(next);
  push(() =>
    supabase
      .from('submissions')
      .update({ status: 'graded', score, feedback, graded_at: todayISO })
      .match({ profile_id: studentId, quiz_id: quizId })
  );
}

export function updateLeadStatus(leadId, status) {
  const next = structuredClone(state);
  const lead = next.leads.find((l) => l.id === leadId);
  if (lead) lead.status = status;
  set(next);
  push(() => supabase.from('leads').update({ status }).eq('id', leadId));
  // A CRM record marked "enrolled" may create a student login → add their email
  // to the approved-student allowlist that gates portal signup.
  if (status === 'enrolled' && lead?.email) {
    addAllowedStudent(lead.email, `${lead.name || 'CRM'} · enrolled`);
  }
}

export function updateLeadNotes(leadId, notes) {
  const next = structuredClone(state);
  const lead = next.leads.find((l) => l.id === leadId);
  if (lead) lead.notes = notes;
  set(next);
  push(() => supabase.from('leads').update({ notes }).eq('id', leadId));
}

export function addLead(lead) {
  const tempId = `l-${Date.now()}`;
  const local = {
    id: tempId,
    name: lead.name || '',
    email: lead.email || '',
    phone: lead.phone || '',
    source: lead.source || '',
    interest: lead.interest || '',
    status: lead.status || 'new',
    createdAt: lead.createdAt || '',
    notes: lead.notes || '',
    grantAwarded: !!lead.grantAwarded,
    grantAmount: Number(lead.grantAmount) || 0,
  };
  const next = structuredClone(state);
  next.leads.push(local);
  set(next);

  // A record added as "enrolled" may create a student login → allowlist it.
  if (local.status === 'enrolled' && local.email) {
    addAllowedStudent(local.email, `${local.name || 'CRM'} · enrolled`);
  }

  if (!USE_SUPABASE || !supabase) return;
  // Insert and reconcile the temp id with the real database UUID.
  Promise.resolve(
    supabase
      .from('leads')
      .insert({
        name: local.name, email: local.email, phone: local.phone,
        source: local.source, interest: local.interest, status: local.status,
        created_at: local.createdAt || null, notes: local.notes,
        grant_awarded: local.grantAwarded, grant_amount: local.grantAmount,
      })
      .select()
      .single()
  )
    .then(({ data, error }) => {
      if (error) return reportError(error);
      if (!data) return;
      const cur = structuredClone(state);
      const row = cur.leads.find((l) => l.id === tempId);
      if (row) row.id = data.id;
      set(cur);
    })
    .catch(reportError);
}

/** Update every editable field of a lead at once (from the CRM edit form). */
export function updateLead(id, fields) {
  const next = structuredClone(state);
  const lead = next.leads.find((l) => l.id === id);
  if (!lead) return;
  lead.name = fields.name ?? lead.name;
  lead.email = fields.email ?? lead.email;
  lead.phone = fields.phone ?? lead.phone;
  lead.source = fields.source ?? lead.source;
  lead.interest = fields.interest ?? lead.interest;
  lead.status = fields.status ?? lead.status;
  lead.createdAt = fields.createdAt ?? lead.createdAt;
  lead.notes = fields.notes ?? lead.notes;
  lead.grantAwarded = fields.grantAwarded ?? lead.grantAwarded;
  lead.grantAmount = Number(fields.grantAmount ?? lead.grantAmount) || 0;
  set(next);
  push(() =>
    supabase
      .from('leads')
      .update({
        name: lead.name, email: lead.email, phone: lead.phone,
        source: lead.source, interest: lead.interest, status: lead.status,
        created_at: lead.createdAt || null, notes: lead.notes,
        grant_awarded: lead.grantAwarded, grant_amount: lead.grantAmount,
      })
      .eq('id', id)
  );
  // Editing a record to "enrolled" (with an email) lets them create a login.
  if (lead.status === 'enrolled' && lead.email) {
    addAllowedStudent(lead.email, `${lead.name || 'CRM'} · enrolled`);
  }
}

export function deleteLead(id) {
  const next = structuredClone(state);
  next.leads = next.leads.filter((l) => l.id !== id);
  set(next);
  push(() => supabase.from('leads').delete().eq('id', id));
}

/** Clear the entire CRM — removes every lead the admin can see. */
export function clearLeads() {
  const next = structuredClone(state);
  next.leads = [];
  set(next);
  // A filter is required for a delete; "id is not null" matches every row.
  push(() => supabase.from('leads').delete().not('id', 'is', null));
}

/* ---- Grant ($300 fee) tracking -------------------------------------------- */
export function setLeadGrant(leadId, awarded, amount) {
  const next = structuredClone(state);
  const lead = next.leads.find((l) => l.id === leadId);
  if (lead) {
    lead.grantAwarded = awarded;
    lead.grantAmount = amount;
  }
  set(next);
  push(() => supabase.from('leads').update({ grant_awarded: awarded, grant_amount: amount }).eq('id', leadId));
}

export function setStudentGrant(studentId, awarded, amount) {
  const next = structuredClone(state);
  const u = next.users.find((x) => x.id === studentId);
  if (u) {
    u.grantAwarded = awarded;
    u.grantAmount = amount;
  }
  set(next);
  push(() => supabase.from('profiles').update({ grant_awarded: awarded, grant_amount: amount }).eq('id', studentId));
}

/* ---- Approved-student allowlist (who may create an account) --------------- */
export const getAllowedStudents = () => state.allowedStudents || [];

export function addAllowedStudent(email, note) {
  const e = String(email).trim();
  if (!e) return { ok: false, error: 'Enter an email.' };
  if ((state.allowedStudents || []).some((a) => a.email.toLowerCase() === e.toLowerCase())) {
    return { ok: false, error: 'That email is already approved.' };
  }
  const next = structuredClone(state);
  (next.allowedStudents ??= []).unshift({ email: e, note: note || '' });
  set(next);
  push(() => supabase.from('allowed_students').insert({ email: e, note: note || null }));
  return { ok: true };
}

export function removeAllowedStudent(email) {
  const next = structuredClone(state);
  next.allowedStudents = (next.allowedStudents || []).filter(
    (a) => a.email.toLowerCase() !== String(email).toLowerCase()
  );
  set(next);
  push(() => supabase.from('allowed_students').delete().eq('email', email));
}

/* ===========================================================================
   REALTIME — live CRM (admin only, Supabase mode)
   ======================================================================== */
let realtimeChannel = null;

/** Subscribe to leads changes; onChange() is called after the cache updates. */
export function startRealtime(user, onChange) {
  if (!USE_SUPABASE || !user || user.role !== 'admin' || realtimeChannel) return;
  realtimeChannel = supabase
    .channel('crm-leads')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, async () => {
      const { data } = await supabase.from('leads').select('*');
      const next = structuredClone(state);
      next.leads = (data || []).map((l) => ({
        ...l, createdAt: d10(l.created_at),
        grantAwarded: !!l.grant_awarded, grantAmount: Number(l.grant_amount) || 0,
      }));
      set(next);
      onChange?.();
    })
    .subscribe();
}

export function stopRealtime() {
  if (realtimeChannel) {
    supabase.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
}

/* ===========================================================================
   VIDEO UPLOAD — admin uploads a recording into Supabase Storage
   ======================================================================== */
export async function uploadSessionVideo(sessionId, file) {
  if (!USE_SUPABASE) return { ok: false, error: 'Connect Supabase to upload videos.' };
  const safe = file.name.replace(/[^\w.\-]+/g, '_');
  const path = `${sessionId}/${Date.now()}-${safe}`;

  const up = await supabase.storage
    .from('session-media')
    .upload(path, file, { upsert: true, contentType: file.type || 'video/mp4' });
  if (up.error) return { ok: false, error: up.error.message };

  const stored = STORAGE_PREFIX + path;
  const { error: upErr } = await supabase.from('sessions').update({ video_url: stored }).eq('id', sessionId);
  if (upErr) return { ok: false, error: upErr.message };

  const { data: signed } = await supabase.storage.from('session-media').createSignedUrl(path, 7200);
  const next = structuredClone(state);
  const s = next.sessions.find((x) => x.id === sessionId);
  if (s) {
    s.videoUrl = stored;
    s.isFile = true;
    s.storagePath = path;
    s.playUrl = signed?.signedUrl || '';
  }
  set(next);
  return { ok: true };
}

/* ===========================================================================
   LIVE CLASS — per-session Google Meet link + scheduled time
   ======================================================================== */
export function setSessionMeet(sessionId, { meetUrl, liveAt }) {
  updateSession(sessionId, { meetUrl, liveAt });
}

export function updateSession(sessionId, updates) {
  const next = structuredClone(state);
  const s = next.sessions.find((x) => x.id === sessionId);
  if (!s) return;

  if (updates.week !== undefined) s.week = Number(updates.week);
  if (updates.title !== undefined) s.title = updates.title.trim();
  if (updates.date !== undefined) s.date = updates.date || null;
  if (updates.durationMin !== undefined) s.durationMin = Number(updates.durationMin) || 0;
  if (updates.summary !== undefined) s.summary = updates.summary.trim();
  if (updates.videoUrl !== undefined) s.videoUrl = updates.videoUrl.trim();
  if (updates.meetUrl !== undefined) s.meetUrl = updates.meetUrl.trim();
  if (updates.liveAt !== undefined) s.liveAt = updates.liveAt;
  if (updates.notes !== undefined) {
    s.notes = Array.isArray(updates.notes)
      ? updates.notes
      : updates.notes.split('\n').map((n) => n.trim()).filter(Boolean);
  }

  set(next);
  push(() =>
    supabase
      .from('sessions')
      .update({
        week: s.week,
        title: s.title,
        date: s.date || null,
        duration_min: s.durationMin,
        summary: s.summary,
        video_url: s.videoUrl || null,
        meet_url: s.meetUrl || null,
        live_at: s.liveAt || null,
        notes: s.notes,
      })
      .eq('id', sessionId)
  );
}

export function addSession() {
  const next = structuredClone(state);
  const week = next.sessions.length + 1;
  const newId = `s${week}-${Date.now()}`;
  const newSession = {
    id: newId,
    week,
    title: `Week ${week} Session`,
    date: new Date().toISOString().split('T')[0],
    durationMin: 60,
    thumb: '/assets/edu-1.png',
    videoUrl: '',
    meetUrl: '',
    liveAt: '',
    summary: 'New session summary.',
    notes: [],
  };
  next.sessions.push(newSession);
  set(next);

  push(() =>
    supabase
      .from('sessions')
      .insert({
        id: newSession.id,
        week: newSession.week,
        title: newSession.title,
        date: newSession.date,
        duration_min: newSession.durationMin,
        thumb: newSession.thumb,
        video_url: newSession.videoUrl || null,
        meet_url: newSession.meetUrl || null,
        live_at: newSession.liveAt || null,
        summary: newSession.summary,
        notes: newSession.notes,
      })
  );
}

export function deleteSession(sessionId) {
  const next = structuredClone(state);
  next.sessions = next.sessions.filter((s) => s.id !== sessionId);
  set(next);

  push(() =>
    supabase
      .from('sessions')
      .delete()
      .eq('id', sessionId)
  );
}

/* ===========================================================================
   CLASS MATERIALS — per-session content library (the resell-ready assets)
   ======================================================================== */
export const getMaterialsForSession = (sid) =>
  (state.materials || []).filter((m) => m.sessionId === sid);
export const getAllMaterials = () => state.materials || [];

/** The playable/openable source for a material (signed file URL or plain URL). */
export const materialSrc = (m) => (m.isFile ? m.playUrl : m.url);

/** Add a link (or any external-URL) material. Works in demo + Supabase mode. */
export function addMaterialLink(sessionId, { kind, title, url }) {
  const tempId = `m-${Date.now()}`;
  const local = { id: tempId, sessionId, kind: kind || 'link', title: (title || '').trim() || 'Untitled', url: (url || '').trim() };
  const next = structuredClone(state);
  (next.materials ??= []).push(local);
  set(next);

  if (!USE_SUPABASE || !supabase) return { ok: true };
  Promise.resolve(
    supabase
      .from('class_materials')
      .insert({ session_id: sessionId, kind: local.kind, title: local.title, url: local.url })
      .select()
      .single()
  )
    .then(({ data, error }) => {
      if (error) return reportError(error);
      if (!data) return;
      const cur = structuredClone(state);
      const row = cur.materials.find((m) => m.id === tempId);
      if (row) row.id = data.id;
      set(cur);
    })
    .catch(reportError);
  return { ok: true };
}

/** Upload a file material (PDF/image/video) into private Storage (Supabase mode). */
export async function uploadMaterial(sessionId, file, kind, title) {
  if (!USE_SUPABASE) return { ok: false, error: 'Connect Supabase to upload files.' };
  const safe = file.name.replace(/[^\w.\-]+/g, '_');
  const path = `${sessionId}/materials/${Date.now()}-${safe}`;

  const up = await supabase.storage
    .from('session-media')
    .upload(path, file, { upsert: true, contentType: file.type || undefined });
  if (up.error) return { ok: false, error: up.error.message };

  const stored = STORAGE_PREFIX + path;
  const ins = await supabase
    .from('class_materials')
    .insert({ session_id: sessionId, kind, title: (title || '').trim() || file.name, url: stored })
    .select()
    .single();
  if (ins.error) return { ok: false, error: ins.error.message };

  const { data: signed } = await supabase.storage.from('session-media').createSignedUrl(path, 7200);
  const next = structuredClone(state);
  (next.materials ??= []).push({
    id: ins.data.id, sessionId, kind, title: (title || '').trim() || file.name,
    url: '', isFile: true, storagePath: path, playUrl: signed?.signedUrl || '',
  });
  set(next);
  return { ok: true };
}

export function deleteMaterial(id) {
  const m = (state.materials || []).find((x) => x.id === id);
  const next = structuredClone(state);
  next.materials = (next.materials || []).filter((x) => x.id !== id);
  set(next);
  push(() => supabase.from('class_materials').delete().eq('id', id));
  if (m && m.isFile && m.storagePath) {
    push(() => supabase.storage.from('session-media').remove([m.storagePath]));
  }
}

/* ===========================================================================
   CLASS DISCUSSION — a shared student-to-student board (realtime in Supabase)
   ======================================================================== */
/** Post a message to the class board. Optimistic: shows immediately, then
 *  reconciles the temp id + timestamp with the row the database returns. */
export function addDiscussionPost(user, body) {
  const text = String(body || '').trim();
  if (!text || !user) return { ok: false, error: 'Write a message first.' };
  const tempId = `d-${Date.now()}`;
  const local = {
    id: tempId,
    authorId: user.id,
    authorName: user.name || 'Student',
    authorRole: user.role || 'student',
    body: text,
    createdAt: new Date().toISOString(),
  };
  const next = structuredClone(state);
  (next.discussion ??= []).push(local);
  set(next);

  if (!USE_SUPABASE || !supabase) return { ok: true };
  // The DB trigger (see discussion.sql) authoritatively stamps author identity;
  // we still send it for the optimistic row and reconcile from what comes back.
  Promise.resolve(
    supabase
      .from('discussion_posts')
      .insert({ author_id: user.id, author_name: local.authorName, author_role: local.authorRole, body: text })
      .select()
      .single()
  )
    .then(({ data, error }) => {
      if (error) return reportError(error);
      if (!data) return;
      const cur = structuredClone(state);
      const row = (cur.discussion || []).find((p) => p.id === tempId);
      if (row) {
        row.id = data.id;
        row.createdAt = data.created_at || row.createdAt;
        row.authorName = data.author_name || row.authorName;
        row.authorRole = data.author_role || row.authorRole;
      }
      set(cur);
    })
    .catch(reportError);
  return { ok: true };
}

/** Remove a post. RLS lets a student delete only their own; admins delete any. */
export function deleteDiscussionPost(id) {
  const next = structuredClone(state);
  next.discussion = (next.discussion || []).filter((p) => p.id !== id);
  set(next);
  push(() => supabase.from('discussion_posts').delete().eq('id', id));
}

/* Realtime for the discussion board — runs for EVERY signed-in user (unlike the
   admin-only CRM channel) so new posts appear live for the whole class. */
let discussionChannel = null;

export function startDiscussionRealtime(user, onChange) {
  if (!USE_SUPABASE || !user || discussionChannel) return;
  discussionChannel = supabase
    .channel('class-discussion')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'discussion_posts' }, async () => {
      const { data } = await supabase
        .from('discussion_posts')
        .select('*')
        .order('created_at', { ascending: true });
      const next = structuredClone(state);
      next.discussion = (data || []).map(mapPost);
      set(next);
      onChange?.();
    })
    .subscribe();
}

export function stopDiscussionRealtime() {
  if (discussionChannel) {
    supabase.removeChannel(discussionChannel);
    discussionChannel = null;
  }
}
