// =============================================================================
//  Supabase Edge Function: jotform-enroll
//  -----------------------------------------------------------------------------
//  Jotform calls this webhook on every enrollment submission. It:
//    1) approves the submitter's email (allowed_students) so they can sign up
//    2) records them in the CRM as a lead (deduped by email)
//
//  Deploy + Jotform setup instructions: see ./README.md
// =============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // Optional shared-secret check. If you set a JOTFORM_SECRET function secret,
  // append ?secret=THAT_VALUE to the webhook URL you give Jotform.
  const secret = Deno.env.get("JOTFORM_SECRET");
  if (secret) {
    const url = new URL(req.url);
    if (url.searchParams.get("secret") !== secret) {
      return new Response("Unauthorized", { status: 401 });
    }
  }

  // Collect the submission. Jotform posts form-data; `rawRequest` holds the
  // full JSON of answers and is the richest place to find the email/name.
  const fields: Record<string, string> = {};
  try {
    const ct = req.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      Object.assign(fields, await req.json());
    } else {
      const form = await req.formData();
      for (const [k, v] of form.entries()) fields[k] = typeof v === "string" ? v : "";
    }
  } catch (_e) {
    return new Response("Bad request", { status: 400 });
  }

  const haystack = (fields.rawRequest || "") + " " + JSON.stringify(fields);
  const email = (haystack.match(EMAIL_RE)?.[0] || "").toLowerCase();
  if (!email) {
    // Acknowledge so Jotform doesn't retry forever; log for debugging.
    console.warn("jotform-enroll: no email found in submission");
    return new Response(JSON.stringify({ ok: false, reason: "no email found" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  // Best-effort name: a rawRequest field whose key contains "name".
  let name = "";
  try {
    const raw = fields.rawRequest ? JSON.parse(fields.rawRequest) : {};
    for (const [k, v] of Object.entries(raw)) {
      if (!/name/i.test(k)) continue;
      if (typeof v === "string") name = v.trim();
      else if (v && typeof v === "object") {
        const o = v as Record<string, string>;
        name = [o.first, o.last].filter(Boolean).join(" ").trim();
      }
      if (name) break;
    }
  } catch (_e) {
    /* ignore name parse errors */
  }

  // SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // 1) Approve the email so the student can create an account.
  const approve = await supabase
    .from("allowed_students")
    .upsert({ email, note: "Jotform enrollment" }, { onConflict: "email" });

  // 2) Add to the CRM as a lead, if not already present.
  const { data: existing } = await supabase
    .from("leads")
    .select("id")
    .ilike("email", email)
    .limit(1);

  let leadError: string | null = null;
  if (!existing || existing.length === 0) {
    const ins = await supabase.from("leads").insert({
      name: name || email,
      email,
      source: "Jotform enrollment",
      interest: "Funding Masterclass",
      status: "qualified",
    });
    leadError = ins.error?.message ?? null;
  }

  return new Response(
    JSON.stringify({
      ok: !approve.error,
      email,
      approveError: approve.error?.message ?? null,
      leadError,
    }),
    { headers: { "content-type": "application/json" } },
  );
});
