# Going live: connect the Learning Portal to Supabase

The portal runs in **local demo mode** until you add Supabase keys. Follow these
steps once and it becomes a real, secure, multi-user system. ~15 minutes.

> While the keys are absent, everything keeps working as a browser-only demo
> (sample data, demo logins). Adding the keys flips it to the real backend.

---

## 1. Create a Supabase project
1. Go to <https://supabase.com> → sign up (free tier is plenty to start).
2. **New project** → name it (e.g. `umof-portal`), set a database password, pick a region close to your students.
3. Wait ~2 minutes for it to provision.

## 2. Create the database
1. In the project: **SQL Editor → New query**.
2. Paste the entire contents of [`supabase/schema.sql`](supabase/schema.sql) → **Run**. (Creates tables, security rules, and the auto-profile trigger.)
3. New query again → paste [`supabase/seed.sql`](supabase/seed.sql) → **Run**. (Loads the 6 sessions, their quizzes, and sample CRM leads.)
4. New query → paste [`supabase/curriculum.sql`](supabase/curriculum.sql) → **Run**. (Admin-editable course syllabus; seeds the default 12-week outline without overwriting later edits.)

## 3. Add your keys to the app
1. In Supabase: **Project Settings → API**. Copy the **Project URL** and the **anon public** key.
2. In the project root, copy `.env.example` to `.env`:
   ```
   cp .env.example .env
   ```
3. Paste your values into `.env`:
   ```
   VITE_SUPABASE_URL=https://YOUR-ref.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJhbGciOi... (the long anon key)
   ```
4. Restart the dev server (`npm run dev`) — Vite only reads `.env` at startup.

> The anon key is safe to expose in the browser. Row-Level Security (in
> `schema.sql`) is what actually protects the data — students can only ever
> read/write their own rows; only admins can see all students, grade, and open
> the CRM.

## 4. Create the accounts
Supabase keeps logins in **Authentication → Users**. A profile row is created
automatically on signup (via a trigger).

1. **Authentication → Users → Add user** (or use the email-invite/signup flow).
   - Add yourself, then each student. Set a temporary password or send an invite.
2. **Make yourself the admin.** In **SQL Editor**, run (use your email):
   ```sql
   update public.profiles set role = 'admin',
          name = 'Dr. Glenda S. Williams, CFWF',
          title = 'Founder & Lead Instructor'
   where email = 'you@umof.org';
   ```
3. Optionally fill in student details (cohort/plan) the same way, e.g.:
   ```sql
   update public.profiles
   set cohort = 'Summer 2026', plan = 'Full Program', enrolled = current_date
   where email = 'student@example.com';
   ```

That's it. Log in at `/portal.html` with a real account — students see only their
own content; you see the full dashboard, grading queue, and live CRM.

---

## Session publish flag (recommended)

If your project was created **before** per-session publish existed, run
[`supabase/sessions-publish.sql`](supabase/sessions-publish.sql) once in the SQL Editor.
That adds `sessions.published` so teachers can release recordings week-by-week from the
portal (Sessions → **Release to students**). Existing sessions stay visible; new ones
start hidden until published.

## Grade fields (optional migration)

If your project was created **before** grade documentation columns existed, run
[`supabase/grade-derivation.sql`](supabase/grade-derivation.sql) once in the SQL Editor.
New installs that run the full [`schema.sql`](supabase/schema.sql) already include these columns.

They store optional grade metadata (`grade_derivation`, `question_scores`, `scoring_method`,
`graded_by`) used by the portal’s **Grading Breakdown** when scoring written work.

## Student work not showing in admin (fix)

If students submit but nothing appears under **Grading**, run
[`supabase/fix-submissions-visibility.sql`](supabase/fix-submissions-visibility.sql)
once in the SQL Editor. That enables admin insert rights and Realtime on
`submissions` / `profiles` so the grading queue updates without a hard reload.

In the portal, use **↻ Refresh submissions** on the Grading page anytime.

---

## Discussion replies + hardened submissions (recommended)

Run these once on existing projects (new installs that use the latest
`schema.sql` / `discussion.sql` already include most of this):

1. [`supabase/discussion-replies.sql`](supabase/discussion-replies.sql) — adds `parent_id` so students can **Reply** on the class discussion board.
2. [`supabase/harden-submissions.sql`](supabase/harden-submissions.sql) — students can no longer overwrite a **graded** row (prevents “test disappeared / grade wiped” edge cases).

Also ensure class discussion base tables exist via
[`supabase/discussion.sql`](supabase/discussion.sql) if you have not already.

---

## Add-ons (built — enable with one more SQL file)

These three features are already in the code. To turn them on, run
[`supabase/addons.sql`](supabase/addons.sql) once (SQL Editor → New query → paste → Run).
That single file adds the lead-capture policy, the realtime publication, and the
private video bucket.

### 1. Website signup → CRM leads
Your homepage signup form (now Name + Email) writes straight into the CRM `leads`
table whenever the app is connected to Supabase. New signups show up as `new`
leads with source "Website signup". (The policy lets anonymous visitors *insert*
only — they can't read or edit anything.)

### 2. Real-time CRM
When you're on the CRM, it now updates **live** — a new website signup or an edit
from another admin appears instantly, no refresh. (Powered by Supabase Realtime on
the `leads` table, which `addons.sql` enables.)

### 3. Upload & host videos privately
Go to **Sessions** in the admin portal → each session has an **Upload / Replace**
button. Pick an MP4 and it's stored privately in the `session-media` bucket;
students stream it through a short-lived signed URL (links can't be shared
publicly). You can still use YouTube/Vimeo embeds for any session — the player
handles both automatically.

> Note on lead spam: anonymous insert is convenient but means a bot could submit
> junk leads. If that becomes a problem, add a captcha or route the form through a
> Supabase Edge Function — ask and I'll wire it up.

## Deploying
`npm run build` outputs `dist/` (both the marketing site and the portal). Host it
anywhere static (Netlify, Vercel, Cloudflare Pages). Set the two `VITE_…` env vars
in the host's dashboard so production uses your Supabase project.
