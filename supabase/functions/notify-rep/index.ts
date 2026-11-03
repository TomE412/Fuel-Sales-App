// notify-rep — sends a phone notification to the rep who logged a sale.
//
// Called by the TV dashboard and the admin Overview board after the office
// books a truck, sends a load on its way, or marks it delivered. Also called
// by the rep app itself with stage "test", so a rep can prove notifications
// reach their own phone before it matters.
//
// WHY THIS EXISTS AT ALL: the private key that signs a push message cannot
// live in the apps. They are static pages on GitHub Pages and anything in
// them is public. So the signing happens here, where the key is a secret.
//
// WHAT IT IS NOT: this is not where the rep's in-app bell comes from. The
// bell is worked out in the rep app from three timestamps and needs nothing
// from here. This is only the buzz on a shut phone. If this function is
// broken, or never deployed at all, every app keeps working and the rep
// still sees everything the next time they open it. That is on purpose.

import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

// Supabase renamed its keys: the old anon / service_role pair became
// publishable / secret on newer projects. Which pair a project gets depends on
// when it was made, so both names are accepted and a missing one is reported
// by name rather than crashing with "undefined".
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY     = Deno.env.get("SUPABASE_ANON_KEY")
                  ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
                  ?? Deno.env.get("SUPABASE_SECRET_KEY") ?? "";
const VAPID_PUBLIC  = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:marketing@skelsee.co.zw";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

type Stage = "assigned" | "en_route" | "delivered" | "test";

const STAGES: Record<Stage, { title: string; verb: string }> = {
  assigned:  { title: "Truck assigned", verb: "has a truck on it" },
  en_route:  { title: "On its way",     verb: "has left" },
  delivered: { title: "Delivered",      verb: "has been delivered" },
  test:      { title: "Notifications are on", verb: "" },
};

const litres = (n: number | null) =>
  n == null ? "" : n.toLocaleString("en-GB") + " L";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  // Everything this needs, checked by name up front. A function that falls
  // over on an undefined key three steps later is a support call; a function
  // that names the missing setting is a thirty second fix.
  const missing = [
    !SUPABASE_URL  && "SUPABASE_URL",
    !ANON_KEY      && "SUPABASE_ANON_KEY (or SUPABASE_PUBLISHABLE_KEY)",
    !SERVICE_KEY   && "SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY)",
    !VAPID_PUBLIC  && "VAPID_PUBLIC_KEY",
    !VAPID_PRIVATE && "VAPID_PRIVATE_KEY",
  ].filter(Boolean);
  if (missing.length) {
    return json({ error: "Missing from Edge Functions -> Secrets: " + missing.join(", "),
                  hint: "The SUPABASE_* ones are normally provided automatically. " +
                        "If one of those is named here, add it by hand from " +
                        "Project Settings -> API." }, 500);
  }

  // ---- who is asking -------------------------------------------------
  // The caller's own token, checked with the ANON key so row-level security
  // still applies to them. A missing or junk token gets nothing.
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "not signed in" }, 401);

  const asCaller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: who, error: whoErr } = await asCaller.auth.getUser();
  if (whoErr || !who?.user) return json({ error: "not signed in" }, 401);
  const callerId = who.user.id;

  let body: { sale_id?: number | string; stage?: Stage };
  try { body = await req.json(); } catch { return json({ error: "bad request body" }, 400); }

  const stage = body.stage as Stage;
  if (!stage || !(stage in STAGES)) {
    return json({ error: "stage must be one of " + Object.keys(STAGES).join(", ") }, 400);
  }

  // The service-role client bypasses row-level security, which is the only
  // way to read a DIFFERENT person's subscription while the office is the
  // one asking. Everything below it is therefore gated by hand.
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  // ---- who is being told, and what -------------------------------------
  let targetUser: string;
  let title: string;
  let bodyText: string;
  let tag: string;

  if (stage === "test") {
    // A rep testing their own phone. No role needed - it can only ever
    // reach the person who asked for it.
    targetUser = callerId;
    title = STAGES.test.title;
    bodyText = "This is a test. Your phone will buzz like this when the " +
               "office books a truck for one of your loads, sends it on its " +
               "way, or marks it delivered.";
    tag = "skelsee-test";
  } else {
    // Only the office may tell somebody else about a load.
    const { data: prof } = await asCaller.from("profiles")
      .select("role").eq("id", callerId).single();
    if (!prof || !["ops", "accounts", "admin"].includes(prof.role)) {
      return json({ error: "only ops, accounts or admin can notify a rep" }, 403);
    }
    if (body.sale_id == null) return json({ error: "sale_id is required" }, 400);

    const { data: sale, error: saleErr } = await admin.from("sales")
      .select("id, rep_id, customer, litres")
      .eq("id", Number(body.sale_id)).single();
    if (saleErr || !sale) return json({ error: "no such sale" }, 404);
    if (!sale.rep_id) {
      // Back-entered history has no rep on it. Nothing to tell anyone, and
      // that is not a failure.
      return json({ sent: 0, skipped: "this sale has no rep on it" });
    }
    targetUser = sale.rep_id;

    // Nobody gets buzzed for something they just did themselves. Tom sells
    // as well as administering, so he marks his own loads delivered from the
    // Sales screen - and a phone that buzzes a second after you tapped the
    // button teaches people to ignore it.
    if (targetUser === callerId) {
      return json({ sent: 0, skipped: "that is your own load - no point telling you" });
    }

    // The truck and driver, when there is one, because "your load has left"
    // is far less useful than "your load has left on AEZ 9005, ring Chitsa".
    let rig = "";
    if (stage === "assigned" || stage === "en_route") {
      const { data: a } = await admin.from("delivery_assignment")
        .select("vehicle_id, driver_id").eq("sale_id", sale.id).maybeSingle();
      if (a) {
        const [{ data: v }, { data: d }] = await Promise.all([
          a.vehicle_id ? admin.from("vehicles").select("fleet_no, reg_no").eq("id", a.vehicle_id).maybeSingle()
                       : Promise.resolve({ data: null }),
          a.driver_id  ? admin.from("drivers").select("full_name, phone").eq("id", a.driver_id).maybeSingle()
                       : Promise.resolve({ data: null }),
        ]);
        const bits = [
          v ? [v.reg_no, v.fleet_no ? "(" + v.fleet_no + ")" : ""].filter(Boolean).join(" ") : "",
          d ? [d.full_name, d.phone].filter(Boolean).join(" ") : "",
        ].filter(Boolean);
        if (bits.length) rig = "  —  " + bits.join(" · ");
      }
    }

    title = STAGES[stage].title;
    bodyText = [sale.customer, litres(sale.litres)].filter(Boolean).join("  ·  ") + rig;
    // One tag per sale, so three updates on the same load replace each other
    // on the lock screen instead of stacking up three deep.
    tag = "skelsee-sale-" + sale.id;
  }

  // ---- send ------------------------------------------------------------
  const { data: subs, error: subErr } = await admin.from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", targetUser)
    .is("expired_at", null);
  if (subErr) return json({ error: "could not read subscriptions: " + subErr.message }, 500);
  if (!subs?.length) return json({ sent: 0, skipped: "that person has no phone signed up" });

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

  const payload = JSON.stringify({
    title, body: bodyText, tag,
    stage,
    sale_id: body.sale_id ?? null,
    url: "/Fuel-Sales-App/",
  });

  const results = await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload,
        { TTL: 60 * 60 * 12 },   // a day-old delivery update is not worth waking anyone for
      );
      await admin.from("push_subscriptions")
        .update({ last_sent_at: new Date().toISOString(), last_error: null })
        .eq("id", s.id);
      return { id: s.id, ok: true };
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      const msg = (e as Error).message ?? String(e);
      // 404 / 410 mean the app was deleted or the browser rotated the
      // subscription. Stamped rather than deleted, so "I get nothing any
      // more" has something to look at.
      const dead = status === 404 || status === 410;
      await admin.from("push_subscriptions").update({
        last_error: (status ? status + ": " : "") + msg.slice(0, 300),
        ...(dead ? { expired_at: new Date().toISOString() } : {}),
      }).eq("id", s.id);
      return { id: s.id, ok: false, status, error: msg.slice(0, 300), expired: dead };
    }
  }));

  const sent = results.filter(r => r.ok).length;
  return json({
    sent,
    failed: results.length - sent,
    // Returned so the rep app's test button can say WHY nothing arrived
    // instead of just failing quietly.
    details: results.filter(r => !r.ok),
  });
});
