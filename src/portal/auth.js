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

/** The signed-in user (or null). Synchronous — reads the in-memory cache. */
export function currentUser() {
  return cachedUser;
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
  const { data } = await supabase.from('profiles').select('*').eq('id', authUser.id).single();
  if (!data) {
    // profile row not created yet — fall back to a minimal student record
    return { id: authUser.id, role: 'student', name: authUser.email, email: authUser.email };
  }
  return {
    id: data.id, role: data.role, name: data.name || authUser.email,
    email: data.email || authUser.email, phone: data.phone, title: data.title,
    cohort: data.cohort, enrolled: data.enrolled, plan: data.plan,
  };
}

/* ---- Public API ----------------------------------------------------------- */

/** Restore an existing session on page load. Returns the user or null. */
export async function initAuth() {
  if (!USE_SUPABASE) {
    cachedUser = loadLocalSession();
    return cachedUser;
  }
  const { data: { session } } = await supabase.auth.getSession();
  cachedUser = session ? await fetchProfile(session.user) : null;
  return cachedUser;
}

/** Attempt login. Returns { ok, user } or { ok:false, error }. */
export async function login(email, password) {
  if (!USE_SUPABASE) {
    const user = getUsers().find(
      (u) => u.email.toLowerCase() === String(email).trim().toLowerCase()
    );
    if (!user || user.password !== password) {
      return { ok: false, error: 'Incorrect email or password.' };
    }
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({ id: user.id }));
    } catch {
      /* ignore */
    }
    cachedUser = user;
    return { ok: true, user };
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email: String(email).trim(),
    password,
  });
  if (error || !data?.user) {
    return { ok: false, error: error?.message || 'Incorrect email or password.' };
  }
  cachedUser = await fetchProfile(data.user);
  return { ok: true, user: cachedUser };
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
 * Create a new account. The DB trigger (see supabase/auth-bootstrap.sql) makes
 * the very first account an admin; everyone after is a student.
 * Returns { ok, user } when signed in immediately, { ok, needsConfirmation:true }
 * when email confirmation is required, or { ok:false, error }.
 */
export async function signUp(name, email, password) {
  if (!USE_SUPABASE) return { ok: false, error: 'Sign-up requires the live backend.' };
  const { data, error } = await supabase.auth.signUp({
    email: String(email).trim(),
    password,
    options: { data: { name: name.trim() }, emailRedirectTo: `${location.origin}/portal.html` },
  });
  if (error) return { ok: false, error: error.message };
  if (data.session) {
    cachedUser = await fetchProfile(data.user);
    return { ok: true, user: cachedUser };
  }
  return { ok: true, needsConfirmation: true };
}

/** Send a password-reset email. The link returns the user to the portal. */
export async function requestPasswordReset(email) {
  if (!USE_SUPABASE) return { ok: false, error: 'Password reset requires the live backend.' };
  const { error } = await supabase.auth.resetPasswordForEmail(String(email).trim(), {
    redirectTo: `${location.origin}/portal.html`,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Set a new password for the currently-authenticated user. */
export async function updatePassword(newPassword) {
  if (!USE_SUPABASE) return { ok: false, error: 'Not available in demo mode.' };
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Update the signed-in user's display name (profile + auth metadata). */
export async function updateDisplayName(name) {
  if (!USE_SUPABASE || !cachedUser) return { ok: false, error: 'Not available.' };
  const { error } = await supabase.from('profiles').update({ name: name.trim() }).eq('id', cachedUser.id);
  if (error) return { ok: false, error: error.message };
  await supabase.auth.updateUser({ data: { name: name.trim() } });
  cachedUser = { ...cachedUser, name: name.trim() };
  return { ok: true, user: cachedUser };
}

/** Subscribe to Supabase auth events (used to catch the password-recovery link). */
export function onAuthEvent(handler) {
  if (!USE_SUPABASE) return;
  supabase.auth.onAuthStateChange((event, session) => handler(event, session));
}
