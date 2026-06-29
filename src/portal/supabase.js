/* =============================================================================
   Supabase client (null in local-demo mode).
   ========================================================================== */
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, USE_SUPABASE } from './config.js';

export const supabase = USE_SUPABASE
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  : null;
