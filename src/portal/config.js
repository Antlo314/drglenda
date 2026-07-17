/* =============================================================================
   Portal config — decides which backend the portal runs against.
   -----------------------------------------------------------------------------
   • No Supabase keys set  → the portal runs in LOCAL DEMO mode (browser-only,
     sample data in localStorage). Great for previewing; nothing is shared/secure.
   • Keys set in .env      → the portal runs against your real Supabase project:
     real accounts, shared database, per-role security.

   Vite only exposes env vars that start with VITE_. The anon key is SAFE to ship
   to the browser — Row-Level Security (see supabase/schema.sql) is what actually
   protects the data, not the key.
   ========================================================================== */
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

/** True when both keys are present → use the real backend. */
export const USE_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

/**
 * When true, Class Sessions is greyed out for students (admins still manage
 * recordings under Sessions). Curriculum + My Tests stay available.
 */
export const SESSIONS_LOCKED = true;
