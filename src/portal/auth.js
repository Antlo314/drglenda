/* =============================================================================
   UMOF Learning Portal — Auth (dual-mode)
   -----------------------------------------------------------------------------
   • LOCAL DEMO mode   — matches email/password against the seed users; "session"
     is a flag in localStorage. NOT secure; for previewing only.
   • SUPABASE mode     — real authentication via Supabase Auth. Roles come from
     the `profiles` table and access is enforced server-side by RLS.

   `currentUser()` is synchronous (returns a cached user) so the render loop in
   app.js stays simple; `initAuth()`/`login()` are async and refresh that cache.
   ========================================================================== */

import { USE_SUPABASE } from './config.js';
import { supabase } from './supabase.js';
import { getUsers } from './store.js';

const SESSION_KEY = 'umof_portal_session';
let cachedUser = null;

/** Normalize email for login / allowlist matching (trim + lowercase). */
export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

/**
 * Map Supabase / network errors to short, actionable UMOF copy.
 * Never surface raw API jargon or stack text in the UI.
 */
export function mapAuthError(error, context = 'auth') {
  if (!error) return 'Something went wrong. Please try again.';
  const msg = typeof error === 'string' ? error : error.message || String(error);
  const m = msg.toLowerCase();

  // Allowlist / enrollment gate (signup)
  if (
    /database error saving new user|umof_not_approved|not_approved/i.test(msg) ||
    (context === 'signup' && /not allowed|not authorised|not authorized/i.test(m))
  ) {
    return 'This email isn’t on the approved enrollment list. Use the exact email from your registration form, or contact UMOF for access.';
  }

  if (/invalid login credentials|invalid email or password|wrong password|user not found/i.test(m)) {
    return 'Email or password is incorrect.';
  }
  if (/email not confirmed|confirm your email|not confirmed/i.test(m)) {
    return 'Confirm your email first, then sign in. Check your inbox for the link from UMOF.';
  }
  if (/too many requests|rate limit|over_request_rate|429/i.test(m)) {
    return 'Too many attempts. Wait a moment and try again.';
  }
  if (/network|failed to fetch|fetch failed|timeout|offline|load failed/i.test(m)) {
    return 'Can’t reach the server. Check your connection and try again.';
  }
  if (/user already registered|already been registered|already exists/i.test(m)) {
    return 'An account with this email already exists. Sign in, or reset your password if you forgot it.';
  }
  if (/password.*at least|password.*characters|weak password|password should be/i.test(m)) {
    return 'Password must be at least 8 characters.';
  }
  if (/same password|different from the old/i.test(m)) {
    return 'Choose a password you haven’t used recently.';
  }
  if (/session|jwt|refresh token|not authenticated|auth session missing/i.test(m)) {
    return 'Your session expired. Please sign in again.';
  }
  if (/signup requires|sign-up requires|not available in demo/i.test(m)) {
    return msg; // our own demo-mode strings
  }

  // Truncate unknown messages so we never dump huge payloads
  const clean = msg.replace(/\s+/g, ' ').trim();
  if (clean.length > 160) return 'Something went wrong. Please try again.';
  return clean || 'Something went wrong. Please try again.';
}

/** The signed-in user (or null). Synchronous — reads the in-memory cache. */
export function currentUser() {
  return cachedUser;
}

/** Clear the in-memory user (used on multi-tab SIGNED_OUT). */
export function clearCachedUser() {
  cachedUser = null;
}

/** Replace cached user fields (e.g. after name update from outside). */
export function setCachedUser(user) {
  cachedUser = user;
}

/* ---- LOCAL helpers -------------------------------------------------------- */
function loadLocalSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const { id } = JSON.parse(raw);
    return getUsers().find((u) => u.id === id) || null;
  } catch {
    return null;
  }
}

/* ---- SUPABASE helpers ----------------------------------------------------- */
async function fetchProfile(authUser) {
  if (!authUser) return null;
  const { data, error } = await supabase.from('profiles').select('*').eq('id', authUser.id).single();
  if (error || !data) {
    // profile row not created yet — fall back to a minimal student record
    return {
      id: authUser.id,
      role: 'student',
      name: authUser.user_metadata?.name || authUser.email,
      email: authUser.email,
    };
  }
  return {
    id: data.id,
    role: data.role,
    name: data.name || authUser.email,
    email: data.email || authUser.email,
    phone: data.phone,
    title: data.title,
    cohort: data.cohort,
    enrolled: data.enrolled,
    plan: data.plan,
  };
}

/** Re-fetch profile for the current session user (role/name refresh). */
export async function refreshSessionUser() {
  if (!USE_SUPABASE || !supabase) return cachedUser;
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) {
    cachedUser = null;
    return null;
  }
  cachedUser = await fetchProfile(session.user);
  return cachedUser;
}

/* ---- Public API ----------------------------------------------------------- */

/** Restore an existing session on page load. Returns the user or null. */
export async function initAuth() {
  if (!USE_SUPABASE) {
    cachedUser = loadLocalSession();
    return cachedUser;
  }
  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) {
      console.warn('[auth] getSession:', error.message);
      cachedUser = null;
      return null;
    }
    cachedUser = session ? await fetchProfile(session.user) : null;
    return cachedUser;
  } catch (e) {
    console.warn('[auth] initAuth failed:', e);
    cachedUser = null;
    return null;
  }
}

/** Attempt login. Returns { ok, user } or { ok:false, error }. */
export async function login(email, password) {
  const em = normalizeEmail(email);
  const pw = String(password || '');

  if (!USE_SUPABASE) {
    const user = getUsers().find((u) => normalizeEmail(u.email) === em);
    if (!user || user.password !== pw) {
      return { ok: false, error: 'Email or password is incorrect.' };
    }
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({ id: user.id }));
    } catch {
      /* ignore */
    }
    cachedUser = user;
    return { ok: true, user };
  }

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: em,
      password: pw,
    });
    if (error || !data?.user) {
      return { ok: false, error: mapAuthError(error || 'Invalid login credentials', 'login') };
    }
    cachedUser = await fetchProfile(data.user);
    return { ok: true, user: cachedUser };
  } catch (e) {
    return { ok: false, error: mapAuthError(e, 'login') };
  }
}

export async function logout() {
  if (USE_SUPABASE) {
    try {
      await supabase.auth.signOut();
    } catch {
      /* ignore */
    }
  } else {
    localStorage.removeItem(SESSION_KEY);
  }
  cachedUser = null;
}

/* ---- Self-service account flows (Supabase mode) --------------------------- */

/**
 * Create a new account. The DB trigger (see supabase/auth-bootstrap.sql /
 * access-and-grants.sql) assigns role from allowlists.
 * Returns { ok, user } when signed in immediately, { ok, needsConfirmation:true }
 * when email confirmation is required, or { ok:false, error }.
 */
export async function signUp(name, email, password) {
  if (!USE_SUPABASE) return { ok: false, error: 'Sign-up requires the live backend.' };
  const em = normalizeEmail(email);
  const nm = String(name || '').trim();
  const pw = String(password || '');
  try {
    const { data, error } = await supabase.auth.signUp({
      email: em,
      password: pw,
      options: {
        data: { name: nm },
        emailRedirectTo: `${location.origin}/portal.html`,
      },
    });
    if (error) {
      return { ok: false, error: mapAuthError(error, 'signup') };
    }
    if (data.session) {
      cachedUser = await fetchProfile(data.user);
      return { ok: true, user: cachedUser };
    }
    return { ok: true, needsConfirmation: true };
  } catch (e) {
    return { ok: false, error: mapAuthError(e, 'signup') };
  }
}

/** Send a password-reset email. The link returns the user to the portal. */
export async function requestPasswordReset(email) {
  if (!USE_SUPABASE) return { ok: false, error: 'Password reset requires the live backend.' };
  const em = normalizeEmail(email);
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(em, {
      redirectTo: `${location.origin}/portal.html`,
    });
    if (error) return { ok: false, error: mapAuthError(error, 'reset') };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: mapAuthError(e, 'reset') };
  }
}

/** Set a new password for the currently-authenticated user. */
export async function updatePassword(newPassword) {
  if (!USE_SUPABASE) return { ok: false, error: 'Not available in demo mode.' };
  try {
    const { error } = await supabase.auth.updateUser({ password: String(newPassword || '') });
    if (error) return { ok: false, error: mapAuthError(error, 'password') };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: mapAuthError(e, 'password') };
  }
}

/** Update the signed-in user's display name (profile + auth metadata). */
export async function updateDisplayName(name) {
  if (!USE_SUPABASE || !cachedUser) return { ok: false, error: 'Not available.' };
  const nm = String(name || '').trim();
  if (!nm) return { ok: false, error: 'Enter a display name.' };
  try {
    const { error } = await supabase.from('profiles').update({ name: nm }).eq('id', cachedUser.id);
    if (error) return { ok: false, error: mapAuthError(error, 'profile') };
    await supabase.auth.updateUser({ data: { name: nm } });
    cachedUser = { ...cachedUser, name: nm };
    return { ok: true, user: cachedUser };
  } catch (e) {
    return { ok: false, error: mapAuthError(e, 'profile') };
  }
}

/**
 * Subscribe to Supabase auth events.
 * Handler: (event, session) => void
 */
export function onAuthEvent(handler) {
  if (!USE_SUPABASE || !supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((event, session) => handler(event, session));
  return () => data?.subscription?.unsubscribe?.();
}
