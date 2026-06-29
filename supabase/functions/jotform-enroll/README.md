# Jotform → auto-approve (Edge Function)

When someone submits your Jotform enrollment form, this function automatically:
1. **approves their email** (`allowed_students`) so they can create an account, and
2. **adds them to the CRM** as a `qualified` lead (source "Jotform enrollment").

No more adding emails by hand on the Access page.

---

## 1. Deploy the function

### Easiest — Supabase Dashboard
1. Supabase → **Edge Functions** → **Deploy a new function** (or "Create function").
2. Name it exactly **`jotform-enroll`**.
3. Paste the contents of [`index.ts`](index.ts) → **Deploy**.
4. Open the function → **Details/Settings** → turn **Verify JWT = OFF**.
   *(Jotform can't send a Supabase token, so the webhook must be public.)*

### Or — Supabase CLI
```bash
supabase functions deploy jotform-enroll --no-verify-jwt
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided to the function
automatically — you don't set those.

## 2. (Recommended) Add a shared secret
So strangers can't POST random emails to the endpoint:
1. Supabase → **Edge Functions → jotform-enroll → Secrets** (or Project Settings →
   Edge Functions secrets) → add **`JOTFORM_SECRET`** = any long random string.
2. You'll append `?secret=THAT_VALUE` to the webhook URL in the next step.

## 3. Point Jotform at it
Your function URL:
```
https://yswfgbijcnlelqigxboq.supabase.co/functions/v1/jotform-enroll
```
(with the secret: add `?secret=YOUR_SECRET` to the end)

In Jotform:
1. Open your enrollment form → **Settings → Integrations → Webhooks**
   (or search integrations for "Webhook").
2. Paste the URL above → **Complete Integration / Add**.
3. Submit a test entry on the form.

## 4. Verify
- Supabase → **Edge Functions → jotform-enroll → Logs** should show the request.
- In the portal → **Access**, the test email should appear as approved.
- In the **CRM → Leads**, the test person should appear (source "Jotform enrollment").

---

### Notes / tuning
- The function finds the email by scanning the submission, so it works regardless
  of your Jotform field names. The name is best-effort (any field named "…name…").
- If the email isn't detected, the function still returns `200` (so Jotform doesn't
  retry) and logs a warning — check the function Logs and the form's field setup.
- It de-dupes leads by email, so resubmissions won't create duplicates.
