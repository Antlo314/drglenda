/* =============================================================================
   UMOF Learning Portal â€” Store (dual-mode)
   -----------------------------------------------------------------------------
   Reads are synchronous against an in-memory `state` cache, so every view in
   app.js stays unchanged. The cache is filled two ways:

     â€¢ LOCAL DEMO mode  (no Supabase keys) â€” seeded from data.js, persisted to
       localStorage. Identical to the original prototype.
     â€¢ SUPABASE mode    (keys in .env)     â€” hydrate(user) loads the rows this
       user is allowed to see (enforced by RLS), mapped into the same shape.

   Mutations update the cache immediately (snappy UI) and, in Supabase mode,
   write through to the database in the background.
   ========================================================================== */

import { USE_SUPABASE } from './config.js';
import { supabase } from './supabase.js';
import { SEED } from './data.js';
import { CURRICULUM as DEFAULT_CURRICULUM } from './curriculum.js';
import {
  stripLeadingItemNumber,
  parseStandaloneOptionPrompt,
  coalesceSplitMcQuestions,
  normalizeQuestions,
  letterToIndex,
  indexToLetter,
  parseOptionsBlob,
  parseQuestionBank,
  serializeQuestions,
  formatQuestionAnswer,
} from './questionBank.js';

export {
  stripLeadingItemNumber,
  parseStandaloneOptionPrompt,
  coalesceSplitMcQuestions,
  normalizeQuestions,
  letterToIndex,
  indexToLetter,
  parseOptionsBlob,
  parseQuestionBank,
  serializeQuestions,
  formatQuestionAnswer,
};

const KEY = 'umof_portal_v1';
const listeners = new Set();
let errorHandler = null;

let state = USE_SUPABASE ? emptyState() : loadLocal();

function defaultCurriculum() {
  return structuredClone(SEED.curriculum || DEFAULT_CURRICULUM);
}

function emptyState() {
  return {
    users: [], sessions: [], quizzes: [], progress: {}, leads: [],
    allowedStudents: [], materials: [], discussion: [], curriculum: null,
  };
}
function loadLocal() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      let dirty = false;
      // Migration: consolidate all sessions into Week 1 / 2026-07-06
      if (parsed.sessions && parsed.sessions.some((s) => s.week !== 1 || s.date !== '2026-07-06')) {
        parsed.sessions = parsed.sessions.map((s) => ({ ...s, week: 1, date: '2026-07-06' }));
        dirty = true;
      }
      // Migration: curriculum was previously a static module â€” fold into state
      if (!parsed.curriculum || !Array.isArray(parsed.curriculum.weeks)) {
        parsed.curriculum = defaultCurriculum();
        dirty = true;
      }
      // Migration: sessions need a published flag (default true for existing demo rows)
      if (parsed.sessions?.some((s) => s.published === undefined)) {
        parsed.sessions = parsed.sessions.map((s) =>
          s.published === undefined ? { ...s, published: true } : s
        );
        dirty = true;
      }
      // Migration: publish Week 2 syllabus content when still an empty placeholder
      if (parsed.curriculum?.weeks?.length) {
        const w2 = parsed.curriculum.weeks.find((w) => Number(w.week) === 2);
        const def2 = defaultCurriculum().weeks.find((w) => Number(w.week) === 2);
        if (w2 && def2 && (w2.pending || !w2.objectives?.length) && def2.objectives?.length) {
          Object.assign(w2, structuredClone(def2));
          dirty = true;
        }
        // Week 2 two-part discussion prompt (admin-editable)
        if (w2 && def2?.discussion && (!w2.discussion || !/Part\s*1\./i.test(w2.discussion))) {
          w2.discussion = def2.discussion;
          w2.discussionPublished = true;
          dirty = true;
        }
        if (w2 && w2.discussionPublished === undefined) {
          w2.discussionPublished = true;
          dirty = true;
        }
      }
      // Migration: ensure Week 2 curriculum quiz exists as a My Tests entry
      if (Array.isArray(parsed.quizzes) && !parsed.quizzes.some((q) => q.id === 'qw2')) {
        const w2 = (parsed.curriculum?.weeks || SEED.curriculum?.weeks || []).find(
          (w) => Number(w.week) === 2
        );
        const prompts = w2?.quiz?.length
          ? w2.quiz
          : (SEED.quizzes || []).find((q) => q.id === 'qw2')?.questions?.map((qq) => qq.prompt);
        if (prompts?.length) {
          parsed.quizzes.push({
            id: 'qw2',
            sessionId: null,
            type: 'manual',
            published: true,
            due: '2026-07-20',
            title: 'Week 2 Test â€” Business Structure & Legal Foundation',
            maxScore: 100,
            questions: prompts.map((prompt, i) =>
              typeof prompt === 'string'
                ? { id: `qw2-${i + 1}`, prompt }
                : prompt
            ),
          });
          dirty = true;
        }
      }
      // Migration: merge A/B/C/D lines that were saved as separate free-response questions
      if (Array.isArray(parsed.quizzes)) {
        for (const q of parsed.quizzes) {
          if (!q?.id || !Array.isArray(q.questions) || q.questions.length < 3) continue;
          const before = q.questions.length;
          const fixed = coalesceSplitMcQuestions(
            q.questions.map((qq, i) =>
              typeof qq === 'string'
                ? { id: `${q.id}-${i + 1}`, prompt: qq }
                : { id: qq.id || `${q.id}-${i + 1}`, prompt: qq.prompt || '', options: qq.options }
            ),
            q.id
          );
          const optionRows = q.questions.filter((qq) =>
            parseStandaloneOptionPrompt(typeof qq === 'string' ? qq : qq?.prompt)
          ).length;
          if (fixed.length < before && optionRows >= 2) {
            q.questions = fixed;
            const allMc =
              fixed.length > 0 &&
              fixed.every((qq) => Array.isArray(qq.options) && qq.options.length >= 2);
            const allKeyed =
              allMc && fixed.every((qq) => qq.correctIndex != null && Number.isFinite(Number(qq.correctIndex)));
            if (allKeyed) q.type = 'auto';
            dirty = true;
          }
        }
      }
      // Migration: restore Week 1 (12 Q) + Week 2 (6 Q) catalog when stale/short
      if (Array.isArray(parsed.quizzes)) {
        for (const seedQ of SEED.quizzes || []) {
          if (!seedQ?.id || !Array.isArray(seedQ.questions) || !seedQ.questions.length) continue;
          if (seedQ.id !== 'qw1' && seedQ.id !== 'qw2' && seedQ.id !== 'qwhy1') continue;
          const idx = parsed.quizzes.findIndex((q) => q.id === seedQ.id);
          const seedQs = seedQ.questions.map((qq, i) =>
            typeof qq === 'string'
              ? { id: `${seedQ.id}-${i + 1}`, prompt: qq }
              : { id: qq.id || `${seedQ.id}-${i + 1}`, prompt: qq.prompt || '' }
          );
          if (idx < 0) {
            parsed.quizzes.push({
              ...structuredClone(seedQ),
              questions: seedQs,
            });
            dirty = true;
            continue;
          }
          const cur = parsed.quizzes[idx];
          const curLen = Array.isArray(cur.questions) ? cur.questions.length : 0;
          const needsRepair =
            curLen !== seedQs.length ||
            seedQs.some((sq, i) => {
              const cq = cur.questions?.[i];
              const cPrompt = typeof cq === 'string' ? cq : cq?.prompt;
              return String(cPrompt || '').trim() !== String(sq.prompt || '').trim();
            });
          if (needsRepair) {
            parsed.quizzes[idx] = {
              ...cur,
              title: seedQ.title || cur.title,
              type: seedQ.type || cur.type || 'manual',
              published: cur.published !== false,
              due: cur.due || seedQ.due,
              maxScore: cur.maxScore || seedQ.maxScore || 100,
              sessionId: cur.sessionId ?? seedQ.sessionId ?? null,
              questions: seedQs,
            };
            dirty = true;
          }
        }
        // Curriculum `quiz` field is Action plan only — never copy it onto My Tests
      }
      // Migration: Action plan must not hold graded test questions (Week 1/2)
      if (parsed.curriculum?.weeks?.length) {
        const defWeeks = defaultCurriculum().weeks || [];
        for (const w of parsed.curriculum.weeks) {
          const wNum = Number(w.week);
          const def = defWeeks.find((x) => Number(x.week) === wNum);
          if (!def) continue;
          // Replace Week 1 action plan if it still looks like the old 12-question test bank
          if (wNum === 1 && Array.isArray(w.quiz)) {
            const looksLikeTest =
              w.quiz.some((line) => /growth mindset/i.test(String(line))) ||
              w.quiz.some((line) => /SMART goal/i.test(String(line))) ||
              w.quiz.length >= 10;
            if (looksLikeTest && Array.isArray(def.quiz)) {
              w.quiz = [...def.quiz];
              dirty = true;
            }
          }
          // Replace Week 2 action plan if it still holds MC / liability test lines
          if (wNum === 2 && Array.isArray(w.quiz)) {
            const looksLikeMcTest =
              w.quiz.some((line) => /least liability|LLC stand for|preferred by investors/i.test(String(line))) ||
              w.quiz.some((line) => /\bA\.\s*LLC\b|\bCorrect:\s*[A-D]\b/i.test(String(line)));
            if (looksLikeMcTest && Array.isArray(def.quiz)) {
              w.quiz = [...def.quiz];
              dirty = true;
            }
          }
          // Ensure every week has an action plan array (section always available)
          if (!Array.isArray(w.quiz)) {
            w.quiz = Array.isArray(def.quiz) ? [...def.quiz] : [];
            dirty = true;
          }
        }
      }
      if (dirty) {
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
function isSchemaMissingError(e) {
  const msg = typeof e === 'string' ? e : e?.message || String(e || '');
  return /could not find the table|schema cache|does not exist|relation .* does not exist|404/i.test(
    msg
  );
}

function reportError(e, { quiet = false } = {}) {
  if (quiet || isSchemaMissingError(e)) {
    console.warn('[portal] backend write skipped/failed (non-fatal):', e?.message || e);
    return;
  }
  console.error('[portal] backend write failed:', e);
  errorHandler?.(e);
}
/** Fire-and-forget a Supabase write; surface errors via the error handler.
 *  Takes a THUNK so `supabase.from(...)` is only evaluated when connected â€”
 *  in demo mode `supabase` is null and must never be touched. */
function push(queryFn, { quiet = false } = {}) {
  if (!USE_SUPABASE || !supabase) return Promise.resolve({ ok: true });
  return Promise.resolve(queryFn())
    .then((res) => {
      if (res && res.error) {
        reportError(res.error, { quiet: quiet || isSchemaMissingError(res.error) });
        return { ok: false, error: res.error };
      }
      return { ok: true, data: res?.data };
    })
    .catch((e) => {
      reportError(e, { quiet: quiet || isSchemaMissingError(e) });
      return { ok: false, error: e };
    });
}

/** Await a Supabase write and return { ok, error? } without double-toasting when the caller handles it. */
async function writeThrough(queryFn, { quiet = false } = {}) {
  if (!USE_SUPABASE || !supabase) return { ok: true };
  try {
    const res = await queryFn();
    if (res && res.error) {
      const msg = res.error.message || String(res.error);
      reportError(res.error, { quiet: quiet || isSchemaMissingError(res.error) });
      return { ok: false, error: msg };
    }
    return { ok: true, data: res?.data };
  } catch (e) {
    reportError(e, { quiet: quiet || isSchemaMissingError(e) });
    return { ok: false, error: e?.message || String(e) };
  }
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
   HYDRATE â€” fill the cache from Supabase for the signed-in user
   ======================================================================== */
const d10 = (v) => (v ? String(v).slice(0, 10) : v); // timestamptz/date â†’ YYYY-MM-DD

const STORAGE_PREFIX = 'storage:'; // a sessions.video_url pointing at our bucket
const mapSession = (r) => {
  const isFile = typeof r.video_url === 'string' && r.video_url.startsWith(STORAGE_PREFIX);
  return {
    id: r.id, week: r.week, title: r.title, date: d10(r.date),
    durationMin: r.duration_min, thumb: r.thumb, videoUrl: r.video_url,
    summary: r.summary, notes: r.notes || [],
    meetUrl: r.meet_url || '', liveAt: r.live_at || '',
    // Missing column (pre-migration) â†’ treat as published so nothing vanishes
    published: r.published !== false && r.published !== null,
    isFile,
    storagePath: isFile ? r.video_url.slice(STORAGE_PREFIX.length) : null,
    playUrl: '', // filled with a signed URL during hydrate
  };
};
const mapQuiz = (r) => {
  const id = r.id;
  return {
    id,
    sessionId: r.session_id,
    type: r.type,
    title: r.title,
    maxScore: r.max_score,
    prompt: r.prompt,
    questions: normalizeQuestions(id, r.questions || []),
    published: !!r.published,
    due: d10(r.due_date),
  };
};
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
  title: r.title, cohort: r.cohort, enrolled: r.enrolled, plan: r.plan,
  grantAwarded: !!r.grant_awarded, grantAmount: Number(r.grant_amount) || 0,
});
// A class-discussion post. `author_name`/`author_role` are denormalized on the
// row (set server-side) so every classmate can see who wrote it â€” students can't
// read each other's `profiles` rows under RLS.
// `parent_id` is null for top-level posts; set for replies (threaded board).
const mapPost = (r) => ({
  id: r.id, authorId: r.author_id, authorName: r.author_name || 'Student',
  authorRole: r.author_role || 'student', body: r.body || '', createdAt: r.created_at,
  parentId: r.parent_id || null,
  week: r.week != null && r.week !== '' ? Number(r.week) : null,
});
const mapSubmission = (r) => ({
  type: r.type, status: r.status, score: r.score, total: r.total,
  correct: r.correct, answer: r.answer, answers: r.answers,
  feedback: r.feedback,
  gradeDerivation: r.grade_derivation || '',
  questionScores: r.question_scores || null,
  scoringMethod: r.scoring_method || null,
  gradedBy: r.graded_by || '',
  submittedAt: r.submitted_at, gradedAt: r.graded_at,
});
/** Ensure every week has an Action Plan array (`quiz` / `actionPlan`). */
function ensureWeekActionPlans(weeks) {
  if (!Array.isArray(weeks)) return [];
  return weeks.map((w) => {
    const week = { ...w };
    const plan = Array.isArray(week.actionPlan)
      ? week.actionPlan
      : Array.isArray(week.quiz)
        ? week.quiz
        : [];
    week.quiz = plan.map((s) => String(s ?? '').trim()).filter(Boolean);
    week.actionPlan = week.quiz;
    week.objectives = Array.isArray(week.objectives) ? week.objectives : [];
    week.steps = Array.isArray(week.steps) ? week.steps : [];
    week.assignment = week.assignment ?? '';
    week.discussion = week.discussion ?? '';
    return week;
  });
}

const mapCurriculum = (r) => ({
  title: r.title || '',
  tagline: r.tagline || '',
  length: r.length || '',
  format: r.format || '',
  learningStyle: r.learning_style || '',
  description: r.description || '',
  weeks: ensureWeekActionPlans(Array.isArray(r.weeks) ? r.weeks : []),
});
const toLines = (v) => {
  if (Array.isArray(v)) return v.map((s) => String(s).trim()).filter(Boolean);
  return String(v ?? '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
};
/** False when `public.curriculum` is missing / unreachable (admin should run curriculum.sql). */
let curriculumBackendOk = !USE_SUPABASE;
export function isCurriculumBackendOk() {
  return curriculumBackendOk;
}

function curriculumPayload(c) {
  return {
    id: 'main',
    title: c.title || '',
    tagline: c.tagline || '',
    length: c.length || '',
    format: c.format || '',
    learning_style: c.learningStyle || '',
    description: c.description || '',
    weeks: c.weeks || [],
    updated_at: new Date().toISOString(),
  };
}

function persistCurriculum(c) {
  // When the curriculum table is missing, keep edits in the client cache only â€”
  // do not spam connection errors on every field change.
  if (USE_SUPABASE && !curriculumBackendOk) return;
  push(() => supabase.from('curriculum').upsert(curriculumPayload(c), { onConflict: 'id' }), {
    quiet: true,
  });
}

/** Await curriculum write; marks backend unavailable when the table is missing. */
async function persistCurriculumAsync(c) {
  if (!USE_SUPABASE || !supabase) return { ok: true };
  if (!curriculumBackendOk) {
    return {
      ok: false,
      error: 'Syllabus table missing â€” run supabase/curriculum.sql in Supabase SQL Editor',
    };
  }
  const res = await writeThrough(
    () => supabase.from('curriculum').upsert(curriculumPayload(c), { onConflict: 'id' }),
    { quiet: true }
  );
  if (!res.ok) {
    const msg = String(res.error || '');
    if (isSchemaMissingError(msg) || /curriculum/i.test(msg)) {
      curriculumBackendOk = false;
    }
  } else {
    curriculumBackendOk = true;
  }
  return res;
}

export async function hydrate(user) {
  if (!USE_SUPABASE) return; // local mode is already loaded
  if (!user) {
    set(emptyState());
    return;
  }
  const next = emptyState();
  const isAdmin = user.role === 'admin';

  // course content â€” visible to everyone authenticated
  const [{ data: sessions }, { data: quizzes }, curricRes] = await Promise.all([
    supabase.from('sessions').select('*'),
    supabase.from('quizzes').select('*'),
    // Isolated so a missing curriculum migration never blocks the rest of hydrate
    supabase.from('curriculum').select('*').eq('id', 'main').maybeSingle()
      .then((r) => r)
      .catch(() => ({ data: null, error: true })),
  ]);
  next.sessions = (sessions || []).map(mapSession);
  next.quizzes = (quizzes || []).map(mapQuiz);
  // Repair Week 2 (and similar) if options were saved as separate free-response rows
  next.quizzes = next.quizzes.map((q) => {
    if (!q?.id || !Array.isArray(q.questions)) return q;
    const fixed = normalizeQuestions(q.id, q.questions);
    if (fixed.length && fixed.length !== q.questions.length) {
      const allMc =
        fixed.every((qq) => Array.isArray(qq.options) && qq.options.length >= 2);
      const allKeyed =
        allMc && fixed.every((qq) => qq.correctIndex != null && Number.isFinite(Number(qq.correctIndex)));
      return {
        ...q,
        questions: fixed,
        type: allKeyed ? 'auto' : q.type || 'manual',
      };
    }
    // Ensure auto quizzes with options still have a usable questions array
    if (q.type === 'auto' && fixed.length) {
      return { ...q, questions: fixed };
    }
    return q;
  });
  // Prefer seed Week 2 bank if live catalog has no usable MC options
  const seedQw2 = (SEED.quizzes || []).find((x) => x.id === 'qw2');
  const liveQw2 = next.quizzes.find((x) => x.id === 'qw2');
  if (seedQw2?.questions?.length && liveQw2) {
    const liveHasMc = (liveQw2.questions || []).some(
      (qq) => Array.isArray(qq.options) && qq.options.length >= 2
    );
    if (!liveHasMc) {
      liveQw2.questions = structuredClone(seedQw2.questions);
      liveQw2.type = seedQw2.type || liveQw2.type;
      liveQw2.published = liveQw2.published !== false;
    }
  }
  // Single-row syllabus; fall back to the built-in default if empty / table missing
  if (curricRes?.data && !curricRes.error) {
    curriculumBackendOk = true;
    next.curriculum = mapCurriculum(curricRes.data);
    // If remote week 2 is still an empty placeholder, fold in the shipped Week 2 content
    const def = defaultCurriculum();
    const remoteW2 = next.curriculum.weeks?.find((w) => Number(w.week) === 2);
    const defW2 = def.weeks?.find((w) => Number(w.week) === 2);
    if (
      remoteW2 &&
      defW2 &&
      (!remoteW2.objectives?.length || remoteW2.pending) &&
      defW2.objectives?.length &&
      defW2.pending === false
    ) {
      Object.assign(remoteW2, structuredClone(defW2));
    }
    // Ensure Week 2 has the two-part discussion prompt when missing/outdated
    if (remoteW2 && defW2?.discussion && (!remoteW2.discussion || !/Part\s*1\./i.test(remoteW2.discussion))) {
      remoteW2.discussion = defW2.discussion;
      if (remoteW2.discussionPublished === undefined) remoteW2.discussionPublished = true;
    }
  } else {
    const errMsg =
      (typeof curricRes?.error === 'object' && curricRes.error?.message) ||
      curricRes?.error ||
      '';
    if (errMsg || curricRes?.error) curriculumBackendOk = false;
    // Empty result (no row yet) means the table exists
    if (curricRes && !curricRes.error && !curricRes.data) curriculumBackendOk = true;
    next.curriculum = defaultCurriculum();
  }

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

  // class materials (resell-ready content library) â€” visible to all authenticated
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

  // class discussion board â€” visible to every authenticated user (student + admin)
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
  const [compRes, subRes] = await Promise.all([
    supabase.from('session_completions').select('*'),
    supabase.from('submissions').select('*'),
  ]);
  if (compRes.error) reportError(compRes.error);
  if (subRes.error) reportError(subRes.error);
  const completions = compRes.data;
  const submissions = subRes.data;
  const ensure = (pid) => (next.progress[pid] ??= { completed: [], submissions: {} });
  (completions || []).forEach((c) => ensure(c.profile_id).completed.push(c.session_id));
  (submissions || []).forEach((s) => (ensure(s.profile_id).submissions[s.quiz_id] = mapSubmission(s)));

  // CRM leads + approved-student allowlist â€” admin only
  if (isAdmin) {
    const { data: leads } = await supabase.from('leads').select('*');
    next.leads = (leads || []).map((l) => ({
      ...l, createdAt: l.created_at,
      grantAwarded: !!l.grant_awarded, grantAmount: Number(l.grant_amount) || 0,
    }));
    const { data: allowed } = await supabase
      .from('allowed_students')
      .select('*')
      .order('added_at', { ascending: false });
    next.allowedStudents = (allowed || []).map((a) => ({ email: a.email, note: a.note || '', addedAt: a.added_at }));
  }

  set(next);
}

/* ===========================================================================
   READS (synchronous, against the cache)
   ======================================================================== */
export const getUsers = () => state.users;
/**
 * Students for roster / CRM / grading.
 * Includes role === 'student', plus anyone who has progress/submissions even if
 * they were accidentally promoted to admin (so test scores stay visible).
 * Pure instructors (admin, no student work) stay off the student list.
 */
export const getStudents = () =>
  state.users.filter((u) => {
    if (u.role === 'student') return true;
    const prog = state.progress[u.id];
    if (!prog) return false;
    const hasWork =
      (prog.completed && prog.completed.length > 0) ||
      (prog.submissions && Object.keys(prog.submissions).length > 0);
    return hasWork;
  });
export const getUserById = (id) => state.users.find((u) => u.id === id) || null;
export const getSessions = () => [...state.sessions].sort((a, b) => a.week - b.week || String(a.title).localeCompare(String(b.title)));
export const getSessionById = (id) => state.sessions.find((s) => s.id === id) || null;
/** Student-facing: only sessions an admin has published. */
export const getVisibleSessions = () =>
  getSessions().filter((s) => s.published !== false);
export const getSessionsForWeek = (weekNum) =>
  getSessions().filter((s) => Number(s.week) === Number(weekNum));

/** Course syllabus (meta + weekly outline). Always returns a full object. */
export function getCurriculum() {
  if (!state.curriculum || !Array.isArray(state.curriculum.weeks)) {
    return defaultCurriculum();
  }
  // Normalize so Action Plan exists on every week for view + edit
  const weeks = ensureWeekActionPlans(state.curriculum.weeks);
  if (weeks !== state.curriculum.weeks) {
    return { ...state.curriculum, weeks };
  }
  // ensureWeekActionPlans always returns a new array — use it
  return { ...state.curriculum, weeks };
}
export const getQuizzes = () => state.quizzes;
export const getQuizById = (id) => {
  const q = state.quizzes.find((x) => x.id === id) || null;
  if (!q) return null;
  // Always return normalized questions so student forms have stable field ids
  const questions = normalizeQuestions(q.id, q.questions);
  if (questions !== q.questions && questions.length !== (q.questions || []).length) {
    return { ...q, questions };
  }
  return { ...q, questions };
};
export const getQuizzesForSession = (sid) => state.quizzes.filter((q) => q.sessionId === sid);

/** Match a quiz to a curriculum week via linked session week or "Week N" in title. */
export function quizMatchesWeek(q, weekNum, sessions = state.sessions) {
  const wNum = Number(weekNum);
  if (!q || !Number.isFinite(wNum)) return false;
  const sx = (sessions || []).find((s) => s.id === q.sessionId);
  if (sx && Number(sx.week) === wNum) return true;
  return new RegExp(`\\bweek\\s*${wNum}\\b`, 'i').test(q.title || '');
}

export const getQuizzesForWeek = (weekNum) =>
  state.quizzes.filter((q) => quizMatchesWeek(q, weekNum));

/**
 * Prefer the main weekly free-response test for a week (not "Why" reflections).
 * Used when pushing curriculum quiz lines into My Tests.
 */
export function findPrimaryWeekTest(weekNum) {
  const list = getQuizzesForWeek(weekNum).filter(
    (q) =>
      q.type === 'manual' &&
      !isDiscussionGradeQuizId(q.id) &&
      Array.isArray(q.questions) &&
      q.questions.length > 0
  );
  if (!list.length) return null;
  const notWhy = list.filter((q) => !/\bwhy\b/i.test(q.title || ''));
  const pool = notWhy.length ? notWhy : list;
  return (
    pool.find((q) => /\btest\b/i.test(q.title || '')) ||
    pool.find((q) => /\bquiz\b/i.test(q.title || '')) ||
    pool[0]
  );
}

// Student-facing: only tests an admin has set "live" are visible. Sorted so the
// soonest-due deliverable comes first (undated ones last).
const byDue = (a, b) =>
  String(a.due || '9999-12-31').localeCompare(String(b.due || '9999-12-31')) ||
  String(a.title).localeCompare(String(b.title));

/** Discussion participation grades (admin Grading only â€” not My Tests). */
export function isDiscussionGradeQuizId(id) {
  return /^qdisc-w\d+$/i.test(String(id || ''));
}
export function discussionQuizId(weekNum) {
  return `qdisc-w${Number(weekNum)}`;
}
export function discussionWeekFromQuizId(id) {
  const m = String(id || '').match(/^qdisc-w(\d+)$/i);
  return m ? Number(m[1]) : null;
}
export function makeDiscussionGradeQuiz(weekNum) {
  const w = Math.max(1, Number(weekNum) || 1);
  return {
    id: discussionQuizId(w),
    sessionId: null,
    type: 'manual',
    published: false, // never listed under student My Tests
    due: null,
    title: `Week ${w} Discussion`,
    maxScore: 100,
    kind: 'discussion',
    questions: [
      {
        id: `${discussionQuizId(w)}-1`,
        prompt: `Discussion participation / post quality for Week ${w}`,
      },
    ],
  };
}
/** Ensure the catalog has a Week N discussion grade slot (for submissions FK + UI). */
export function ensureDiscussionGradeQuiz(weekNum) {
  const w = Math.max(1, Number(weekNum) || 1);
  const id = discussionQuizId(w);
  if (state.quizzes.some((q) => q.id === id)) return getQuizById(id);
  const q = makeDiscussionGradeQuiz(w);
  const next = structuredClone(state);
  next.quizzes = [...(next.quizzes || []), q];
  set(next);
  // Best-effort remote insert (ignore if already exists)
  push(() =>
    supabase.from('quizzes').upsert(
      {
        id: q.id,
        session_id: null,
        type: 'manual',
        title: q.title,
        max_score: 100,
        prompt: null,
        questions: q.questions,
        published: false,
        due_date: null,
      },
      { onConflict: 'id' }
    )
  );
  return q;
}

export const getVisibleQuizzes = () =>
  state.quizzes.filter((q) => q.published && !isDiscussionGradeQuizId(q.id)).sort(byDue);
export const getVisibleQuizzesForSession = (sid) =>
  state.quizzes
    .filter((q) => q.published && q.sessionId === sid && !isDiscussionGradeQuizId(q.id))
    .sort(byDue);
export const getVisibleQuizzesForWeek = (weekNum) =>
  getQuizzesForWeek(weekNum)
    .filter((q) => q.published && !isDiscussionGradeQuizId(q.id))
    .sort(byDue);
export const getLeads = () =>
  [...state.leads].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

/** The class discussion feed, oldest â†’ newest (the view pins to the latest). */
export const getDiscussion = () =>
  [...(state.discussion || [])].sort((a, b) =>
    String(a.createdAt).localeCompare(String(b.createdAt))
  );

export function getProgress(studentId) {
  return state.progress[studentId] || { completed: [], submissions: {} };
}

/**
 * Whether a submission still counts for this quizâ€™s current questions.
 * Stale rows (wrong question ids / empty answers after a test rewrite) are ignored
 * so students get a blank form instead of â€œSubmittedâ€ with old/wrong answers.
 */
export function submissionAppliesToQuiz(sub, quiz) {
  if (!sub || !quiz) return false;
  if (sub.status !== 'submitted' && sub.status !== 'graded') return false;

  const qs = normalizeQuestions(quiz.id, quiz.questions || []);
  const isMc =
    quiz.type === 'auto' ||
    qs.some((qq) => Array.isArray(qq.options) && qq.options.length > 0);

  if (isMc || quiz.type === 'auto') {
    // Auto: need answers object keyed by current question ids (or any graded score)
    if (sub.status === 'graded' && sub.score != null) return true;
    const answers = sub.answers && typeof sub.answers === 'object' ? sub.answers : {};
    return qs.some((qq) => answers[qq.id] !== undefined && answers[qq.id] !== null);
  }

  // Free-response written test
  const answers = sub.answers && typeof sub.answers === 'object' && !Array.isArray(sub.answers)
    ? sub.answers
    : {};
  const hasWritten = qs.some((qq) => {
    const v = answers[qq.id];
    return v != null && String(v).trim() !== '';
  });
  if (hasWritten) return true;
  // Single-prompt manual assignment
  if (sub.answer != null && String(sub.answer).trim() !== '') return true;
  return false;
}

/** Student-facing submission for a quiz, or null if not started / stale. */
export function getStudentSubmission(studentId, quizId) {
  const quiz = getQuizById(quizId);
  const sub = getProgress(studentId).submissions?.[quizId];
  if (!quiz || !sub) return null;
  return submissionAppliesToQuiz(sub, quiz) ? sub : null;
}

/**
 * Admin: list archive snapshots for a student (+ optional quiz).
 * Requires submission-archive-failsafe.sql on Supabase.
 */
export async function listSubmissionArchive(profileId, quizId = null, limit = 40) {
  if (!USE_SUPABASE || !supabase) return { ok: true, rows: [] };
  let q = supabase
    .from('submission_archive')
    .select(
      'archive_id, archived_at, event, profile_id, quiz_id, status, score, answers, answer, feedback, graded_by, submitted_at, graded_at'
    )
    .order('archived_at', { ascending: false })
    .limit(limit);
  if (profileId) q = q.eq('profile_id', profileId);
  if (quizId) q = q.eq('quiz_id', quizId);
  const { data, error } = await q;
  if (error) return { ok: false, error: error.message, rows: [] };
  return { ok: true, rows: data || [] };
}

/**
 * Admin: restore a submission from archive_id (SQL failsafe).
 * Live row is upserted; archive history is kept.
 */
export async function restoreSubmissionFromArchive(archiveId) {
  if (!USE_SUPABASE || !supabase) {
    return { ok: false, error: 'Archive restore only works against Supabase.' };
  }
  const { data, error } = await supabase.rpc('restore_submission_from_archive', {
    p_archive_id: Number(archiveId),
  });
  if (error) return { ok: false, error: error.message };
  // Refresh local cache so Grading / My Tests see restored answers
  await refreshProgress();
  return { ok: true, data };
}

/**
 * Admin: delete a studentâ€™s submission so they get a blank form again.
 * Live row is removed; SQL failsafe keeps a copy in submission_archive (if installed).
 * Also clears any matching local demo progress.
 */
export async function clearSubmission(studentId, quizId) {
  if (!studentId || !quizId) return { ok: false, error: 'Missing student or test' };
  const previous = state.progress[studentId]?.submissions?.[quizId]
    ? structuredClone(state.progress[studentId].submissions[quizId])
    : undefined;
  const next = structuredClone(state);
  next.progress[studentId] ??= { completed: [], submissions: {} };
  const had = previous !== undefined;
  delete next.progress[studentId].submissions[quizId];
  set(next);

  const saved = await writeThrough(() =>
    supabase
      .from('submissions')
      .delete()
      .eq('profile_id', studentId)
      .eq('quiz_id', quizId)
  );
  if (!saved.ok && USE_SUPABASE) {
    restoreSubmission(studentId, quizId, previous);
    return {
      ok: false,
      error:
        saved.error ||
        'Could not delete submission. Run supabase/admin-delete-submissions.sql in Supabase, then try again.',
    };
  }
  return { ok: true, cleared: had };
}

/** Admin: clear every studentâ€™s work for one test (all get blank forms again). */
export async function clearAllSubmissionsForQuiz(quizId) {
  if (!quizId) return { ok: false, error: 'Missing test id', count: 0 };
  const snapshot = {};
  for (const pid of Object.keys(state.progress || {})) {
    if (state.progress[pid]?.submissions?.[quizId]) {
      snapshot[pid] = structuredClone(state.progress[pid].submissions[quizId]);
    }
  }
  const next = structuredClone(state);
  let count = Object.keys(snapshot).length;
  for (const pid of Object.keys(snapshot)) {
    delete next.progress[pid].submissions[quizId];
  }
  set(next);

  const saved = await writeThrough(() =>
    supabase.from('submissions').delete().eq('quiz_id', quizId)
  );
  if (!saved.ok && USE_SUPABASE) {
    const roll = structuredClone(state);
    for (const [pid, sub] of Object.entries(snapshot)) {
      roll.progress[pid] ??= { completed: [], submissions: {} };
      roll.progress[pid].submissions[quizId] = sub;
    }
    set(roll);
    return {
      ok: false,
      error:
        saved.error ||
        'Could not clear submissions. Run supabase/admin-delete-submissions.sql in Supabase SQL Editor.',
      count: 0,
    };
  }
  return { ok: true, count };
}

export function getStudentStats(studentId) {
  // Progress is measured against sessions students can actually access
  const sessions = getVisibleSessions();
  const prog = getProgress(studentId);
  const sessionIds = new Set(sessions.map((s) => s.id));
  const completed = (prog.completed || []).filter((id) => sessionIds.has(id)).length;
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

/** Resolve a student for grading lists even if their profile role is odd. */
function resolveStudent(studentId) {
  const known = getUserById(studentId);
  if (known) return known;
  return {
    id: studentId,
    role: 'student',
    name: 'Student (profile missing)',
    email: '',
    phone: '',
    cohort: '',
    plan: '',
  };
}

/** Resolve a quiz row for grading lists even if the quiz was removed from catalog. */
function resolveQuiz(quizId, sub) {
  const q = getQuizById(quizId);
  if (q) return q;
  return {
    id: quizId,
    title: `Assignment (${quizId})`,
    type: sub?.type || 'manual',
    maxScore: 100,
    prompt: '',
    questions: [],
    published: false,
    due: null,
    sessionId: null,
  };
}

/**
 * Profile ids that have progress, plus every enrolled student.
 * Ensures submissions are visible even when a profile role was mis-set.
 */
function studentsForGrading() {
  const byId = new Map();
  for (const s of getStudents()) byId.set(s.id, s);
  for (const pid of Object.keys(state.progress || {})) {
    if (!byId.has(pid)) byId.set(pid, resolveStudent(pid));
  }
  return [...byId.values()];
}

/** True when a submission still needs instructor review. */
function needsGrading(sub) {
  if (!sub || sub.status !== 'submitted') return false;
  // Auto quizzes are stored as graded; if one is stuck as submitted, still surface it.
  if (sub.type === 'auto' && typeof sub.score === 'number') return false;
  return true;
}

export function getGradingQueue() {
  const out = [];
  for (const student of studentsForGrading()) {
    const prog = getProgress(student.id);
    for (const [quizId, sub] of Object.entries(prog.submissions || {})) {
      if (isDiscussionGradeQuizId(quizId)) continue; // graded on the Discussion panel
      if (!needsGrading(sub)) continue;
      out.push({
        student,
        quiz: resolveQuiz(quizId, sub),
        submission: sub,
        quizId,
      });
    }
  }
  return out.sort((a, b) =>
    String(a.submission.submittedAt || '').localeCompare(String(b.submission.submittedAt || ''))
  );
}

/** Graded submissions (any type) so admins can re-open and edit scores. */
export function getGradedSubmissions() {
  const out = [];
  for (const student of studentsForGrading()) {
    const prog = getProgress(student.id);
    for (const [quizId, sub] of Object.entries(prog.submissions || {})) {
      if (isDiscussionGradeQuizId(quizId)) continue;
      if (sub.status === 'graded' && typeof sub.score === 'number') {
        out.push({
          student,
          quiz: resolveQuiz(quizId, sub),
          submission: sub,
          quizId,
        });
      }
    }
  }
  return out.sort((a, b) =>
    String(b.submission.gradedAt || b.submission.submittedAt || '').localeCompare(
      String(a.submission.gradedAt || a.submission.submittedAt || '')
    )
  );
}

/**
 * Re-fetch profiles + completions + submissions from Supabase into the cache.
 * Call when the admin hits Refresh, or when realtime reports a change.
 * Safe no-op in local demo mode.
 */
export async function refreshProgress() {
  if (!USE_SUPABASE || !supabase) return { ok: true, count: 0 };
  const next = structuredClone(state);

  const [profRes, compRes, subRes] = await Promise.all([
    supabase.from('profiles').select('*'),
    supabase.from('session_completions').select('*'),
    supabase.from('submissions').select('*'),
  ]);
  if (profRes.error) {
    reportError(profRes.error);
    return { ok: false, error: profRes.error.message };
  }
  if (compRes.error) {
    reportError(compRes.error);
    return { ok: false, error: compRes.error.message };
  }
  if (subRes.error) {
    reportError(subRes.error);
    return { ok: false, error: subRes.error.message };
  }

  next.users = (profRes.data || []).map(mapProfile);
  next.progress = {};
  const ensure = (pid) => (next.progress[pid] ??= { completed: [], submissions: {} });
  (compRes.data || []).forEach((c) => ensure(c.profile_id).completed.push(c.session_id));
  (subRes.data || []).forEach((s) => {
    ensure(s.profile_id).submissions[s.quiz_id] = mapSubmission(s);
  });
  // Keep the signed-in user visible if profiles query omitted them for any reason
  set(next);
  return {
    ok: true,
    count: (subRes.data || []).length,
    pending: getGradingQueue().length,
  };
}

/* ===========================================================================
   WRITES â€” update cache immediately, then persist (Supabase mode)
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

/** Restore a previous submission snapshot (or remove the key) after a failed write. */
function restoreSubmission(studentId, quizId, previous) {
  const next = structuredClone(state);
  next.progress[studentId] ??= { completed: [], submissions: {} };
  if (previous === undefined) {
    delete next.progress[studentId].submissions[quizId];
  } else {
    next.progress[studentId].submissions[quizId] = previous;
  }
  set(next);
}

/** Block re-submit when work is already graded (server RLS should also enforce this). */
function guardNotGraded(studentId, quizId) {
  const existing = state.progress[studentId]?.submissions?.[quizId];
  if (existing?.status === 'graded') {
    return { ok: false, error: 'This test is already graded and cannot be resubmitted.' };
  }
  return null;
}

export async function submitAutoQuiz(studentId, quizId, answers, submittedAt) {
  const quiz = getQuizById(quizId);
  if (!quiz || quiz.type !== 'auto') return { ok: false, error: 'Quiz not found.', score: 0, correct: 0, total: 0 };
  const blocked = guardNotGraded(studentId, quizId);
  if (blocked) return { ...blocked, score: 0, correct: 0, total: quiz.questions?.length || 0 };
  const at = submittedAt || new Date().toISOString();
  let correct = 0;
  quiz.questions.forEach((q) => {
    if (answers[q.id] === q.correctIndex) correct += 1;
  });
  const total = quiz.questions.length;
  const score = Math.round((correct / total) * 100);
  const previous = state.progress[studentId]?.submissions?.[quizId]
    ? structuredClone(state.progress[studentId].submissions[quizId])
    : undefined;
  const next = structuredClone(state);
  next.progress[studentId] ??= { completed: [], submissions: {} };
  const gradeDerivation = `Auto-scored: ${correct} of ${total} questions correct â†’ ${score}%. Formula: (correct Ã· total) Ã— 100, rounded.`;
  next.progress[studentId].submissions[quizId] = {
    type: 'auto', score, total, correct, status: 'graded', submittedAt: at, answers,
    scoringMethod: 'auto', gradeDerivation, gradedAt: at,
  };
  set(next);
  const saved = await writeThrough(() =>
    supabase.from('submissions').upsert(
      {
        profile_id: studentId, quiz_id: quizId, type: 'auto', status: 'graded',
        score, total, correct, answers, submitted_at: at, graded_at: at,
        scoring_method: 'auto', grade_derivation: gradeDerivation,
      },
      { onConflict: 'profile_id,quiz_id' }
    )
  );
  if (!saved.ok) {
    restoreSubmission(studentId, quizId, previous);
    return { ok: false, error: saved.error, score, correct, total };
  }
  return { ok: true, score, correct, total, submittedAt: at };
}

export async function submitManual(studentId, quizId, answer, submittedAt) {
  const blocked = guardNotGraded(studentId, quizId);
  if (blocked) return blocked;
  const at = submittedAt || new Date().toISOString();
  const previous = state.progress[studentId]?.submissions?.[quizId]
    ? structuredClone(state.progress[studentId].submissions[quizId])
    : undefined;
  const next = structuredClone(state);
  next.progress[studentId] ??= { completed: [], submissions: {} };
  next.progress[studentId].submissions[quizId] = {
    type: 'manual', status: 'submitted', submittedAt: at, answer,
  };
  set(next);
  const saved = await writeThrough(() =>
    supabase.from('submissions').upsert(
      { profile_id: studentId, quiz_id: quizId, type: 'manual', status: 'submitted', answer, submitted_at: at },
      { onConflict: 'profile_id,quiz_id' }
    )
  );
  if (!saved.ok) {
    restoreSubmission(studentId, quizId, previous);
    return { ok: false, error: saved.error };
  }
  return { ok: true, submittedAt: at };
}

/** Written test: student submits a free-response answer for each question.
 *  Answers are keyed by question id; the test then enters the grading queue.
 *  Students may resubmit (overwrite) until the instructor grades. */
export async function submitWritten(studentId, quizId, answers, submittedAt) {
  const blocked = guardNotGraded(studentId, quizId);
  if (blocked) return blocked;
  // Drop any empty keys so we never store junk as "old answers"
  const cleaned = {};
  Object.entries(answers || {}).forEach(([k, v]) => {
    const t = String(v ?? '').trim();
    if (t) cleaned[k] = t;
  });
  if (!Object.keys(cleaned).length) {
    return { ok: false, error: 'Please fill in your answers before submitting.' };
  }
  answers = cleaned;
  const at = submittedAt || new Date().toISOString();
  const previous = state.progress[studentId]?.submissions?.[quizId]
    ? structuredClone(state.progress[studentId].submissions[quizId])
    : undefined;
  const next = structuredClone(state);
  next.progress[studentId] ??= { completed: [], submissions: {} };
  next.progress[studentId].submissions[quizId] = {
    type: 'manual', status: 'submitted', submittedAt: at, answers,
  };
  set(next);
  const saved = await writeThrough(() =>
    supabase.from('submissions').upsert(
      { profile_id: studentId, quiz_id: quizId, type: 'manual', status: 'submitted', answers, submitted_at: at },
      { onConflict: 'profile_id,quiz_id' }
    )
  );
  if (!saved.ok) {
    restoreSubmission(studentId, quizId, previous);
    return { ok: false, error: saved.error };
  }
  return { ok: true, submittedAt: at };
}

/** Admin toggles a test live/offline (the "Go live" / "Publish to students" button). */
export async function setQuizPublished(quizId, published) {
  const next = structuredClone(state);
  const q = next.quizzes.find((x) => x.id === quizId);
  if (!q) return { ok: false, error: 'Test not found' };
  const prev = !!q.published;
  q.published = !!published;
  set(next);
  const saved = await writeThrough(() =>
    supabase.from('quizzes').update({ published: !!published }).eq('id', quizId)
  );
  if (!saved.ok) {
    if (USE_SUPABASE) {
      const roll = structuredClone(state);
      const rq = roll.quizzes.find((x) => x.id === quizId);
      if (rq) rq.published = prev;
      set(roll);
    }
    return { ok: false, error: saved.error || 'Could not update publish state' };
  }
  return { ok: true };
}

/**
 * Create a free-response weekly test (manual quiz) and optionally publish it.
 * @param {{ week?: number, title?: string, questions?: string|string[], due?: string, published?: boolean, sessionId?: string, id?: string }} opts
 */
export async function createWeeklyTest(opts = {}) {
  const weekNum = Math.max(1, Number(opts.week) || 1);
  // Accept free-response lines and/or A/B/C/D multiple-choice blocks
  const parsed =
    typeof opts.questions === 'string' || Array.isArray(opts.questions)
      ? parseQuestionBank(
          Array.isArray(opts.questions) ? opts.questions.join('\n') : opts.questions
        )
      : [];
  if (!parsed.length) {
    return {
      ok: false,
      error:
        'Add at least one question. For multiple choice, put A/B/C/D options on the lines under the question.',
    };
  }

  // Link to a session in that week when possible (for student session detail + week hub).
  // Never fall back to another week's session â€” title matching still associates the week.
  const weekSessions = getSessionsForWeek(weekNum);
  let sessionId = opts.sessionId;
  if (sessionId === undefined) {
    sessionId =
      weekSessions[0]?.id ||
      getSessions().find((s) => Number(s.week) === weekNum)?.id ||
      null;
  }

  const id = String(opts.id || `qw${weekNum}-${Date.now().toString(36)}`);
  const title =
    String(opts.title || '').trim() ||
    `Week ${weekNum} Test`;
  const questions = parsed.map((pq, i) => ({
    id: `${id}-${i + 1}`,
    prompt: pq.prompt,
    ...(pq.options?.length ? { options: pq.options } : {}),
    ...(pq.correctIndex != null ? { correctIndex: pq.correctIndex } : {}),
  }));
  const allMcScored =
    questions.length > 0 &&
    questions.every(
      (qq) => Array.isArray(qq.options) && qq.options.length >= 2 && qq.correctIndex != null
    );
  const published = !!opts.published;
  const due = opts.due ? String(opts.due).slice(0, 10) : null;

  const quiz = {
    id,
    sessionId,
    type: allMcScored ? 'auto' : 'manual',
    title,
    maxScore: 100,
    prompt: null,
    questions,
    published,
    due,
  };

  const next = structuredClone(state);
  next.quizzes = [...(next.quizzes || []), quiz];
  set(next);

  const saved = await writeThrough(() =>
    supabase.from('quizzes').insert({
      id: quiz.id,
      session_id: quiz.sessionId,
      type: quiz.type,
      title: quiz.title,
      max_score: 100,
      prompt: null,
      questions: quiz.questions,
      published: quiz.published,
      due_date: quiz.due,
    })
  );
  if (!saved.ok) {
    // keep local copy in demo; in Supabase mode roll back so UI matches server
    if (USE_SUPABASE) {
      const roll = structuredClone(state);
      roll.quizzes = (roll.quizzes || []).filter((q) => q.id !== id);
      set(roll);
    }
    return { ok: false, error: saved.error || 'Could not create test' };
  }
  return { ok: true, quiz };
}

/**
 * Update an existing free-response weekly test.
 * Question ids are preserved by index when possible so prior submissions keep mapping.
 * @param {string} quizId
 * @param {{ week?: number, title?: string, questions?: string|string[], due?: string|null, published?: boolean, sessionId?: string }} opts
 */
export async function updateWeeklyTest(quizId, opts = {}) {
  const next = structuredClone(state);
  const q = (next.quizzes || []).find((x) => x.id === quizId);
  if (!q) return { ok: false, error: 'Test not found' };

  const prevSnapshot = structuredClone(q);

  if (opts.title !== undefined) {
    const t = String(opts.title || '').trim();
    if (t) q.title = t;
  }
  if (opts.due !== undefined) {
    q.due = opts.due ? String(opts.due).slice(0, 10) : null;
  }
  if (opts.published !== undefined) {
    q.published = !!opts.published;
  }

  if (opts.week !== undefined || opts.sessionId !== undefined) {
    const weekNum = Math.max(1, Number(opts.week) || 1);
    const weekSessions = getSessionsForWeek(weekNum);
    if (opts.sessionId !== undefined) {
      q.sessionId = opts.sessionId;
    } else {
      q.sessionId =
        weekSessions[0]?.id ||
        getSessions().find((s) => Number(s.week) === weekNum)?.id ||
        q.sessionId ||
        null;
    }
  }

  if (opts.questions !== undefined) {
    const parsed = parseQuestionBank(
      Array.isArray(opts.questions) ? opts.questions.join('\n') : opts.questions
    );
    if (!parsed.length) {
      return {
        ok: false,
        error:
          'Add at least one question. For multiple choice, put A/B/C/D options under each question.',
      };
    }
    const prevQs = Array.isArray(q.questions) ? q.questions : [];
    q.questions = parsed.map((pq, i) => ({
      id: prevQs[i]?.id || `${q.id}-${i + 1}`,
      prompt: pq.prompt,
      ...(pq.options?.length ? { options: pq.options } : {}),
      ...(pq.correctIndex != null ? { correctIndex: pq.correctIndex } : {}),
    }));
    const allMcScored =
      q.questions.length > 0 &&
      q.questions.every(
        (qq) => Array.isArray(qq.options) && qq.options.length >= 2 && qq.correctIndex != null
      );
    q.type = allMcScored ? 'auto' : 'manual';
  }

  set(next);

  const saved = await writeThrough(() =>
    supabase
      .from('quizzes')
      .update({
        session_id: q.sessionId,
        type: q.type || 'manual',
        title: q.title,
        questions: q.questions,
        published: !!q.published,
        due_date: q.due,
      })
      .eq('id', quizId)
  );
  if (!saved.ok) {
    if (USE_SUPABASE) {
      const roll = structuredClone(state);
      const rq = (roll.quizzes || []).find((x) => x.id === quizId);
      if (rq) Object.assign(rq, prevSnapshot);
      set(roll);
    }
    return { ok: false, error: saved.error || 'Could not update test' };
  }
  return { ok: true, quiz: q };
}

/**
 * Create or update the week's My Tests entry from curriculum.week.quiz lines.
 * @param {number|string} weekNum
 * @param {{ published?: boolean, title?: string, due?: string }} opts
 */
export async function pushCurriculumQuizToTest(weekNum, opts = {}) {
  const wNum = Math.max(1, Number(weekNum) || 1);
  const c = getCurriculum();
  const week = (c.weeks || []).find((w) => Number(w.week) === wNum);
  if (!week) return { ok: false, error: `No curriculum week ${wNum}` };

  const lines = toLines(week.quiz);
  if (!lines.length) {
    return {
      ok: false,
      error: 'Add quiz questions on this week first (one per line), then push to My Tests.',
    };
  }

  const title =
    String(opts.title || '').trim() ||
    `Week ${wNum} Test â€” ${week.title || ''}`.replace(/\s+â€”\s*$/, '').trim() ||
    `Week ${wNum} Test`;

  const existing = findPrimaryWeekTest(wNum);
  if (existing) {
    const res = await updateWeeklyTest(existing.id, {
      week: wNum,
      title: opts.title !== undefined ? title : existing.title,
      questions: lines,
      due: opts.due !== undefined ? opts.due : existing.due,
      published: opts.published !== undefined ? opts.published : existing.published,
    });
    return res.ok
      ? { ok: true, quiz: res.quiz, created: false, updated: true }
      : res;
  }

  let res = await createWeeklyTest({
    week: wNum,
    title,
    questions: lines,
    due: opts.due || null,
    published: !!opts.published,
    id: `qw${wNum}`,
  });
  // If fixed id collides (e.g. re-seed leftover), create with a generated id
  if (!res.ok && /duplicate|unique|already exists/i.test(String(res.error || ''))) {
    res = await createWeeklyTest({
      week: wNum,
      title,
      questions: lines,
      due: opts.due || null,
      published: !!opts.published,
    });
  }
  return res.ok
    ? { ok: true, quiz: res.quiz, created: true, updated: false }
    : res;
}

/** Delete a test/quiz (admin). */
export async function deleteQuiz(quizId) {
  const next = structuredClone(state);
  const before = next.quizzes.length;
  next.quizzes = (next.quizzes || []).filter((q) => q.id !== quizId);
  if (next.quizzes.length === before) return { ok: false, error: 'Test not found' };
  set(next);
  const saved = await writeThrough(() =>
    supabase.from('quizzes').delete().eq('id', quizId)
  );
  if (!saved.ok && USE_SUPABASE) {
    // reload is safer; leave deleted locally and surface error
    return { ok: false, error: saved.error || 'Could not delete test on server' };
  }
  return { ok: true };
}

/** Admin toggles a class session live/offline for students. */
export async function setSessionPublished(sessionId, published) {
  const next = structuredClone(state);
  const s = next.sessions.find((x) => x.id === sessionId);
  if (!s) return { ok: false, error: 'Session not found' };
  const prev = s.published;
  s.published = !!published;
  set(next);
  const saved = await writeThrough(() =>
    supabase.from('sessions').update({ published: !!published }).eq('id', sessionId)
  );
  if (!saved.ok) {
    // roll back cache so the UI matches the database
    const roll = structuredClone(state);
    const rs = roll.sessions.find((x) => x.id === sessionId);
    if (rs) rs.published = prev;
    set(roll);
    return { ok: false, error: saved.error || 'Could not save publish state' };
  }
  return { ok: true };
}

/**
 * Release (or unrelease) everything for a curriculum week that students need:
 * syllabus week, all sessions that week, and all linked tests.
 * @param {number|string} weekNum
 * @param {boolean} publish  true = go live, false = take offline
 * @returns {Promise<{ week, curriculum, sessions, quizzes, ok, error? }>}
 */
export async function setWeekPublished(weekNum, publish) {
  const wNum = Number(weekNum);
  const next = structuredClone(state);
  const c = (next.curriculum ??= defaultCurriculum());
  const week = c.weeks.find((x) => Number(x.week) === wNum);
  let curriculumTouched = false;
  if (week) {
    week.pending = !publish;
    if (publish) {
      week.objectives ??= [];
      week.steps ??= [];
      week.quiz ??= [];
      week.assignment ??= '';
      week.discussion ??= '';
    }
    curriculumTouched = true;
  }

  const sessionIds = [];
  for (const s of next.sessions) {
    if (Number(s.week) === wNum) {
      s.published = !!publish;
      sessionIds.push(s.id);
    }
  }

  const quizIds = [];
  for (const q of next.quizzes) {
    const sx = next.sessions.find((s) => s.id === q.sessionId);
    // Match by linked session week, or by "Week N" in title as fallback
    const bySession = sx && Number(sx.week) === wNum;
    const byTitle = new RegExp(`\\bweek\\s*${wNum}\\b`, 'i').test(q.title || '');
    if (bySession || byTitle) {
      q.published = !!publish;
      quizIds.push(q.id);
    }
  }

  set(next);

  const errors = [];
  let curriculumSaved = !curriculumTouched;

  if (curriculumTouched) {
    const cres = await persistCurriculumAsync(c);
    curriculumSaved = cres.ok;
    if (!cres.ok) {
      errors.push(
        curriculumBackendOk === false
          ? 'Syllabus table missing â€” run supabase/curriculum.sql in Supabase SQL Editor'
          : `Syllabus: ${cres.error || 'save failed'}`
      );
    }
  }

  let sessionsSaved = 0;
  for (const id of sessionIds) {
    const r = await writeThrough(() =>
      supabase.from('sessions').update({ published: !!publish }).eq('id', id)
    );
    if (r.ok) sessionsSaved += 1;
    else errors.push(`Session ${id}: ${r.error || 'save failed'}`);
  }

  let quizzesSaved = 0;
  for (const id of quizIds) {
    const r = await writeThrough(() =>
      supabase.from('quizzes').update({ published: !!publish }).eq('id', id)
    );
    if (r.ok) quizzesSaved += 1;
    else errors.push(`Test ${id}: ${r.error || 'save failed'}`);
  }

  // Nothing to publish for this week
  if (sessionIds.length === 0 && quizIds.length === 0 && !curriculumTouched) {
    return {
      ok: false,
      week: wNum,
      curriculum: false,
      sessions: 0,
      quizzes: 0,
      error: `No sessions, tests, or syllabus found for Week ${wNum}. Set a sessionâ€™s week number to ${wNum}, then publish.`,
    };
  }

  if (sessionIds.length === 0 && publish) {
    errors.push(
      `No sessions assigned to Week ${wNum}. Edit a sessionâ€™s â€œWkâ€ field to ${wNum}, then publish again.`
    );
  }

  return {
    ok: errors.length === 0,
    week: wNum,
    curriculum: curriculumSaved && curriculumTouched,
    sessions: sessionsSaved,
    quizzes: quizzesSaved,
    error: errors.length ? errors.join(' Â· ') : null,
  };
}

/** Snapshot of publish state for one week (admin release hub). */
export function getWeekReleaseStatus(weekNum) {
  const wNum = Number(weekNum);
  const c = getCurriculum();
  const week = (c.weeks || []).find((x) => Number(x.week) === wNum) || null;
  const sessions = getSessionsForWeek(wNum);
  const quizzes = state.quizzes.filter((q) => {
    const sx = getSessionById(q.sessionId);
    if (sx && Number(sx.week) === wNum) return true;
    return new RegExp(`\\bweek\\s*${wNum}\\b`, 'i').test(q.title || '');
  });
  const sessionsLive =
    sessions.length > 0 && sessions.every((s) => s.published !== false);
  const quizzesLive = quizzes.length === 0 || quizzes.every((q) => q.published);
  // Syllabus only blocks "all live" when the curriculum backend is available
  const syllabusLive = !week || !week.pending || !curriculumBackendOk;
  return {
    week: wNum,
    title: week?.title || (sessions[0]?.title ? `Week ${wNum}` : `Week ${wNum}`),
    curriculum: week
      ? {
          exists: true,
          published: !week.pending,
          pending: !!week.pending,
          title: week.title,
          backendOk: curriculumBackendOk,
        }
      : { exists: false, published: false, pending: true, title: '', backendOk: curriculumBackendOk },
    sessions: sessions.map((s) => ({
      id: s.id,
      title: s.title,
      published: s.published !== false,
    })),
    quizzes: quizzes.map((q) => ({
      id: q.id,
      title: q.title,
      published: !!q.published,
      due: q.due,
    })),
    // "All live" = every *session* for the week is published (what students watch).
    // Syllabus/tests are shown separately; missing syllabus table should not block session release.
    allPublished: sessionsLive && quizzesLive && (sessions.length > 0 ? true : syllabusLive && quizzes.length > 0),
    sessionsLive,
    anyPublished:
      (week && !week.pending) ||
      sessions.some((s) => s.published !== false) ||
      quizzes.some((q) => q.published),
  };
}

/**
 * Assign or update a grade (first-time grading and re-edits).
 *
 * @param {string} studentId
 * @param {string} quizId
 * @param {object|number} payload  score number (legacy) OR {
 *   score, feedback, gradeDerivation, questionScores, scoringMethod, gradedBy
 * }
 * @param {string} [feedbackOrToday]  legacy 4-arg form: feedback string
 * @param {string} [todayISO]         legacy 5-arg form: date
 */
export async function gradeSubmission(studentId, quizId, payload, feedbackOrToday, todayISO) {
  // Support both legacy gradeSubmission(id, q, score, feedback, date)
  // and modern gradeSubmission(id, q, { score, feedback, â€¦ }, date).
  let score;
  let feedback = '';
  let gradeDerivation = '';
  let questionScores = null;
  let scoringMethod = null;
  let gradedBy = '';
  let date = todayISO;

  if (payload != null && typeof payload === 'object' && !Array.isArray(payload)) {
    score = payload.score;
    feedback = payload.feedback || '';
    gradeDerivation = payload.gradeDerivation || '';
    questionScores = payload.questionScores || null;
    scoringMethod = payload.scoringMethod || null;
    gradedBy = payload.gradedBy || '';
    date = feedbackOrToday || todayISO;
  } else {
    score = payload;
    feedback = feedbackOrToday || '';
    date = todayISO;
  }
  date = date || new Date().toISOString();

  const quiz = getQuizById(quizId);
  if (!scoringMethod) {
    scoringMethod =
      quiz?.type === 'auto' && !gradeDerivation
        ? 'auto'
        : isRubricScores(questionScores)
          ? 'rubric'
          : questionScores
            ? 'per_question'
            : 'instructor';
  }
  if (scoringMethod === 'rubric' && isRubricScores(questionScores) && !gradeDerivation) {
    gradeDerivation = formatGradingBreakdown(questionScores, score, quiz?.maxScore || 100);
  }
  // Auto quizzes without an instructor override get a transparent formula.
  if (scoringMethod === 'auto' && quiz?.type === 'auto' && !gradeDerivation) {
    const sub0 = state.progress[studentId]?.submissions?.[quizId];
    if (sub0?.correct != null && sub0?.total) {
      gradeDerivation = `Auto-scored: ${sub0.correct} of ${sub0.total} questions correct â†’ ${score}%. Formula: (correct Ã· total) Ã— 100, rounded.`;
    } else {
      gradeDerivation = `Auto-scored multiple-choice: final score ${score}%.`;
    }
  }

  const previous = state.progress[studentId]?.submissions?.[quizId]
    ? structuredClone(state.progress[studentId].submissions[quizId])
    : undefined;
  const next = structuredClone(state);
  next.progress[studentId] ??= { completed: [], submissions: {} };
  const sub = next.progress[studentId].submissions[quizId] || {
    type: quiz?.type || 'manual',
    submittedAt: date,
  };
  sub.status = 'graded';
  sub.score = score;
  sub.feedback = feedback;
  sub.gradeDerivation = gradeDerivation;
  sub.questionScores = questionScores;
  sub.scoringMethod = scoringMethod;
  sub.gradedBy = gradedBy;
  sub.gradedAt = date;
  next.progress[studentId].submissions[quizId] = sub;
  set(next);
  const gradePatch = {
    status: 'graded',
    score,
    feedback,
    grade_derivation: gradeDerivation,
    question_scores: questionScores,
    scoring_method: scoringMethod,
    graded_by: gradedBy,
    graded_at: date,
  };
  // Prefer UPDATE (admin RLS). If no row matches, INSERT via upsert so the
  // grade is not lost when the student submission was missing client-side.
  const saved = await writeThrough(async () => {
    const upd = await supabase
      .from('submissions')
      .update(gradePatch)
      .match({ profile_id: studentId, quiz_id: quizId })
      .select('id');
    if (upd.error) return upd;
    if (upd.data && upd.data.length > 0) return upd;
    return supabase.from('submissions').upsert(
      {
        profile_id: studentId,
        quiz_id: quizId,
        type: sub.type || quiz?.type || 'manual',
        ...gradePatch,
        submitted_at: sub.submittedAt || date,
        answers: sub.answers ?? null,
        answer: sub.answer ?? null,
        total: sub.total ?? null,
        correct: sub.correct ?? null,
      },
      { onConflict: 'profile_id,quiz_id' }
    );
  });
  if (!saved.ok) {
    restoreSubmission(studentId, quizId, previous);
    return { ok: false, error: saved.error };
  }
  return { ok: true, gradedAt: date };
}

/**
 * Count top-level discussion posts (not replies) by a student for a curriculum week.
 */
export function countDiscussionPostsForStudent(studentId, weekNum) {
  const w = Number(weekNum);
  if (!studentId || !Number.isFinite(w)) return 0;
  return getDiscussion().filter((p) => {
    if (p.authorId !== studentId) return false;
    if (p.parentId) return false; // grade participation on main posts
    if (p.week == null || p.week === '') return false;
    return Number(p.week) === w;
  }).length;
}

/**
 * One-line discussion grade for a student + week (0â€“100).
 * Stored as a graded submission on quiz id `qdisc-w{N}` (hidden from My Tests).
 */
export async function gradeDiscussion(studentId, weekNum, score, feedback = '', gradedBy = '') {
  const w = Math.max(1, Number(weekNum) || 1);
  const n = Math.round(Number(score));
  if (!studentId) return { ok: false, error: 'Missing student' };
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    return { ok: false, error: 'Score must be 0â€“100' };
  }
  ensureDiscussionGradeQuiz(w);
  const quizId = discussionQuizId(w);
  const postCount = countDiscussionPostsForStudent(studentId, w);
  const date = new Date().toISOString();
  const previous = state.progress[studentId]?.submissions?.[quizId]
    ? structuredClone(state.progress[studentId].submissions[quizId])
    : undefined;

  // Seed a minimal submission then grade it
  const next = structuredClone(state);
  next.progress[studentId] ??= { completed: [], submissions: {} };
  next.progress[studentId].submissions[quizId] = {
    type: 'manual',
    status: 'submitted',
    submittedAt: previous?.submittedAt || date,
    answers: {
      [`${quizId}-1`]: previous?.answers?.[`${quizId}-1`] ||
        `Discussion Week ${w}: ${postCount} top-level post${postCount === 1 ? '' : 's'}`,
    },
  };
  set(next);

  const res = await gradeSubmission(studentId, quizId, {
    score: n,
    feedback: feedback || '',
    gradeDerivation: `Discussion Week ${w} Â· single-line participation grade (${postCount} post${postCount === 1 ? '' : 's'}).`,
    scoringMethod: 'instructor',
    gradedBy: gradedBy || '',
  }, date);

  if (!res.ok && previous === undefined) {
    // Clean empty slot if grade failed and we invented the row
    const roll = structuredClone(state);
    if (roll.progress[studentId]?.submissions?.[quizId]) {
      delete roll.progress[studentId].submissions[quizId];
      set(roll);
    }
  }
  return res;
}

/** Read discussion grade for student + week, or null. */
export function getDiscussionGrade(studentId, weekNum) {
  const quizId = discussionQuizId(weekNum);
  const sub = getProgress(studentId).submissions?.[quizId];
  if (!sub || sub.status !== 'graded' || typeof sub.score !== 'number') return null;
  return sub;
}

/**
 * Fixed grading rubric for instructor-graded work (5 Ã— 20 = 100).
 * Stored in submissions.question_scores keyed by criterion id.
 */
export const GRADING_BREAKDOWN = [
  { id: 'completed', label: 'Completed all questions', max: 20 },
  { id: 'understanding', label: 'Understanding of concepts', max: 20 },
  { id: 'reflection', label: 'Depth of reflection', max: 20 },
  { id: 'organization', label: 'Organization, clarity, and timeliness', max: 20 },
  { id: 'grammar', label: 'Grammar, punctuation, and sentence structure', max: 20 },
];

/** True when scores use the fixed Grading Breakdown rubric keys. */
export function isRubricScores(scores) {
  if (!scores || typeof scores !== 'object' || Array.isArray(scores)) return false;
  return GRADING_BREAKDOWN.some((c) => Object.prototype.hasOwnProperty.call(scores, c.id));
}

/** Multi-line text for a rubric grade (criteria + points). */
export function formatGradingBreakdown(scores, totalScore, maxScore = 100) {
  const lines = ['Grading Breakdown', '', 'Criteria    Points'];
  for (const c of GRADING_BREAKDOWN) {
    const pts = scores && scores[c.id] != null && scores[c.id] !== '' ? scores[c.id] : 'â€”';
    lines.push(`${c.label}    ${pts}/${c.max}`);
  }
  if (totalScore != null) {
    lines.push('');
    lines.push(`Total    ${totalScore}/${maxScore}`);
  }
  return lines.join('\n');
}

export function updateLeadStatus(leadId, status) {
  const next = structuredClone(state);
  const lead = next.leads.find((l) => l.id === leadId);
  if (lead) lead.status = status;
  set(next);
  push(() => supabase.from('leads').update({ status }).eq('id', leadId));
  // A CRM record marked "enrolled" may create a student login â†’ add their email
  // to the approved-student allowlist that gates portal signup.
  if (status === 'enrolled' && lead?.email) {
    addAllowedStudent(lead.email, `${lead.name || 'CRM'} Â· enrolled`);
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

  // A record added as "enrolled" may create a student login â†’ allowlist it.
  if (local.status === 'enrolled' && local.email) {
    addAllowedStudent(local.email, `${local.name || 'CRM'} Â· enrolled`);
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
    addAllowedStudent(lead.email, `${lead.name || 'CRM'} Â· enrolled`);
  }
}

export function deleteLead(id) {
  const next = structuredClone(state);
  next.leads = next.leads.filter((l) => l.id !== id);
  set(next);
  push(() => supabase.from('leads').delete().eq('id', id));
}

/** Clear the entire CRM â€” removes every lead the admin can see. */
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
   REALTIME â€” live CRM + grading queue (admin only, Supabase mode)
   ======================================================================== */
let realtimeChannel = null;

/** Subscribe to leads + submissions + profiles so grading updates live. */
export function startRealtime(user, onChange) {
  if (!USE_SUPABASE || !user || user.role !== 'admin' || realtimeChannel) return;
  realtimeChannel = supabase
    .channel('admin-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, async () => {
      const { data } = await supabase.from('leads').select('*');
      const next = structuredClone(state);
      next.leads = (data || []).map((l) => ({
        ...l, createdAt: l.created_at,
        grantAwarded: !!l.grant_awarded, grantAmount: Number(l.grant_amount) || 0,
      }));
      set(next);
      onChange?.();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'submissions' }, async () => {
      await refreshProgress();
      onChange?.();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, async () => {
      await refreshProgress();
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
   VIDEO UPLOAD â€” admin uploads a recording into Supabase Storage
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
   LIVE CLASS â€” per-session Google Meet link + scheduled time
   ======================================================================== */
export function setSessionMeet(sessionId, { meetUrl, liveAt }) {
  updateSession(sessionId, { meetUrl, liveAt });
}

/* ===========================================================================
   CURRICULUM â€” admin-editable course syllabus
   ======================================================================== */
export function updateCurriculumMeta(updates) {
  const next = structuredClone(state);
  const c = (next.curriculum ??= defaultCurriculum());
  if (updates.title !== undefined) c.title = String(updates.title).trim();
  if (updates.tagline !== undefined) c.tagline = String(updates.tagline).trim();
  if (updates.length !== undefined) c.length = String(updates.length).trim();
  if (updates.format !== undefined) c.format = String(updates.format).trim();
  if (updates.learningStyle !== undefined) c.learningStyle = String(updates.learningStyle).trim();
  if (updates.description !== undefined) c.description = String(updates.description).trim();
  set(next);
  persistCurriculum(c);
}

export function updateCurriculumWeek(weekNum, updates) {
  const next = structuredClone(state);
  const c = (next.curriculum ??= defaultCurriculum());
  const w = c.weeks.find((x) => Number(x.week) === Number(weekNum));
  if (!w) return;

  if (updates.week !== undefined) {
    const n = Number(updates.week);
    if (Number.isFinite(n) && n >= 1) w.week = Math.round(n);
  }
  if (updates.title !== undefined) w.title = String(updates.title).trim();
  if (updates.pending !== undefined) w.pending = !!updates.pending;
  if (updates.objectives !== undefined) w.objectives = toLines(updates.objectives);
  if (updates.steps !== undefined) w.steps = toLines(updates.steps);
  if (updates.assignment !== undefined) w.assignment = String(updates.assignment).trim();
  if (updates.discussion !== undefined) w.discussion = String(updates.discussion).trim();
  if (updates.discussionPublished !== undefined) w.discussionPublished = !!updates.discussionPublished;
  // Action Plan checklist (stored as `quiz` for backwards compatibility)
  if (updates.quiz !== undefined || updates.actionPlan !== undefined) {
    const raw = updates.actionPlan !== undefined ? updates.actionPlan : updates.quiz;
    w.quiz = toLines(raw);
    w.actionPlan = w.quiz;
  }

  // Publishing a week: if they uncheck "coming soon", ensure content arrays exist
  if (updates.pending === false) {
    w.objectives ??= [];
    w.steps ??= [];
    w.quiz ??= [];
    w.actionPlan ??= w.quiz;
    w.assignment ??= '';
    w.discussion ??= '';
  }

  c.weeks.sort((a, b) => Number(a.week) - Number(b.week));
  set(next);
  persistCurriculum(c);
}

/** Add a new week at the end of the syllabus. Returns the new week number. */
export function addCurriculumWeek() {
  const next = structuredClone(state);
  const c = (next.curriculum ??= defaultCurriculum());
  const maxWeek = c.weeks.reduce((m, w) => Math.max(m, Number(w.week) || 0), 0);
  const week = maxWeek + 1;
  c.weeks.push({
    week,
    pending: true,
    title: `Week ${week} title`,
    objectives: [],
    steps: [],
    assignment: '',
    discussion: '',
    quiz: [],
  });
  set(next);
  persistCurriculum(c);
  return week;
}

export function deleteCurriculumWeek(weekNum) {
  const next = structuredClone(state);
  const c = next.curriculum;
  if (!c) return;
  c.weeks = c.weeks.filter((w) => Number(w.week) !== Number(weekNum));
  set(next);
  persistCurriculum(c);
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
  if (updates.published !== undefined) s.published = !!updates.published;
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
        published: s.published !== false,
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
    published: false, // hidden from students until Publish
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
        published: false,
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
   CLASS MATERIALS â€” per-session content library (the resell-ready assets)
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
   CLASS DISCUSSION â€” a shared student-to-student board (realtime in Supabase)
   ======================================================================== */
/** Post a message (or reply) to the class board. Optimistic: shows immediately,
 *  then reconciles the temp id + timestamp with the row the database returns.
 *  @param {object} user
 *  @param {string} body
 *  @param {string|null} parentId
 *  @param {number|null} week  curriculum week number for this prompt thread
 */
export function addDiscussionPost(user, body, parentId = null, week = null) {
  const text = String(body || '').trim();
  if (!text || !user) return { ok: false, error: 'Write a message first.' };
  // Only allow reply-to real posts (not nested under another reply more than 1 level).
  let resolvedParent = parentId || null;
  let weekNum = week != null && week !== '' ? Number(week) : null;
  if (resolvedParent) {
    const parent = (state.discussion || []).find((p) => p.id === resolvedParent);
    if (!parent) resolvedParent = null;
    // Collapse deep threads: reply-to-reply attaches to the root parent.
    else if (parent.parentId) resolvedParent = parent.parentId;
    // Inherit week from parent thread when replying
    if (parent && parent.week != null && !Number.isFinite(weekNum)) {
      weekNum = Number(parent.week);
    }
  }
  if (!Number.isFinite(weekNum) || weekNum < 1) weekNum = null;
  const tempId = `d-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const local = {
    id: tempId,
    authorId: user.id,
    authorName: user.name || 'Student',
    authorRole: user.role || 'student',
    body: text,
    createdAt: new Date().toISOString(),
    parentId: resolvedParent,
    week: weekNum,
  };
  const next = structuredClone(state);
  (next.discussion ??= []).push(local);
  set(next);

  if (!USE_SUPABASE || !supabase) return { ok: true, id: tempId };
  // The DB trigger (see discussion.sql) authoritatively stamps author identity;
  // we still send it for the optimistic row and reconcile from what comes back.
  const insertRow = {
    author_id: user.id,
    author_name: local.authorName,
    author_role: local.authorRole,
    body: text,
  };
  if (resolvedParent && !String(resolvedParent).startsWith('d-')) {
    insertRow.parent_id = resolvedParent;
  }
  if (weekNum != null) insertRow.week = weekNum;
  Promise.resolve(
    supabase
      .from('discussion_posts')
      .insert(insertRow)
      .select()
      .single()
  )
    .then(({ data, error }) => {
      if (error) {
        // Roll back optimistic post so the UI never lies about a failed send.
        // If `week` column missing, retry without it so posts still work.
        const msg = String(error.message || error || '');
        if (weekNum != null && /week|column|schema cache/i.test(msg)) {
          const retry = { ...insertRow };
          delete retry.week;
          Promise.resolve(
            supabase.from('discussion_posts').insert(retry).select().single()
          ).then(({ data: d2, error: e2 }) => {
            if (e2 || !d2) {
              const cur = structuredClone(state);
              cur.discussion = (cur.discussion || []).filter((p) => p.id !== tempId);
              set(cur);
              reportError(e2 || error);
              return;
            }
            const cur = structuredClone(state);
            const row = (cur.discussion || []).find((p) => p.id === tempId);
            if (row) {
              row.id = d2.id;
              row.createdAt = d2.created_at || row.createdAt;
              row.authorName = d2.author_name || row.authorName;
              row.authorRole = d2.author_role || row.authorRole;
              row.parentId = d2.parent_id || row.parentId || null;
              row.week = weekNum;
            }
            set(cur);
          });
          return;
        }
        const cur = structuredClone(state);
        cur.discussion = (cur.discussion || []).filter((p) => p.id !== tempId);
        set(cur);
        reportError(error);
        return;
      }
      if (!data) return;
      const cur = structuredClone(state);
      const row = (cur.discussion || []).find((p) => p.id === tempId);
      if (row) {
        row.id = data.id;
        row.createdAt = data.created_at || row.createdAt;
        row.authorName = data.author_name || row.authorName;
        row.authorRole = data.author_role || row.authorRole;
        row.parentId = data.parent_id || row.parentId || null;
        if (data.week != null) row.week = Number(data.week);
      }
      set(cur);
    })
    .catch((e) => {
      const cur = structuredClone(state);
      cur.discussion = (cur.discussion || []).filter((p) => p.id !== tempId);
      set(cur);
      reportError(e);
    });
  return { ok: true, id: tempId };
}

/** Remove a post (and any local replies). RLS: student own / admin any. */
export function deleteDiscussionPost(id) {
  const next = structuredClone(state);
  // Drop the post and any replies that reference it (DB cascades; local mirrors).
  next.discussion = (next.discussion || []).filter(
    (p) => p.id !== id && p.parentId !== id
  );
  set(next);
  push(() => supabase.from('discussion_posts').delete().eq('id', id));
}

/* Realtime for the discussion board â€” runs for EVERY signed-in user (unlike the
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
      const fromServer = (data || []).map(mapPost);
      // Keep optimistic temp posts (ids starting with d-) until insert resolves.
      const pending = (state.discussion || []).filter(
        (p) => typeof p.id === 'string' && p.id.startsWith('d-')
      );
      const next = structuredClone(state);
      next.discussion = [...fromServer, ...pending];
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
