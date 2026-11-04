// manage-users — the People page's back end.
//
// WHY THIS EXISTS AT ALL
// Three things the People page needs cannot be done from a browser:
//   - reading staff email addresses and when they last signed in, which live
//     in auth.users and are not exposed to any app
//   - setting somebody's password
//   - creating a brand-new login
// All three need the project's secret key, and that key can never go into any
// of the five apps: they are static pages on GitHub Pages, and every file in
// that repository is public. So it happens here, where the key is a secret.
//
// WHAT IT IS NOT
// This is not where the tick boxes live. Which apps a person may open, their
// role, and the on/off switch are ordinary columns on profiles that the
// browser writes directly, gated by the profiles_guard trigger and the
// profiles_manager_update policy. If this function is broken or never
// deployed, the People page still lists everyone and still changes access —
// it just cannot show emails or set passwords. That is on purpose.
//
// EVERY action is refused unless the caller holds can_manage_users. Being an
// administrator is not enough: there are three administrators and only one
// user administrator, which is how Tom asked for it.

import { createClient } from "jsr:@supabase/supabase-js@2";

// Supabase renamed its keys: the old anon / service_role pair became
// publishable / secret on newer projects. Both names are accepted so this
// works whichever generation the project is on.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY     = Deno.env.get("SUPABASE_ANON_KEY")
                  ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
                  ?? Deno.env.get("SUPABASE_SECRET_KEY") ?? "";

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

// Long enough to be worth having, short enough that Tom can say it down the
// phone. Supabase's own floor is 6, which is too low for a login that reads
// the whole company's margins.
const MIN_PASSWORD = 8;

// A ban far enough out to be permanent in practice. Supabase has no "disable
// for ever", only a duration.
const FOREVER = "876000h";   // 100 years

type Action = "list" | "set_password" | "create_person" | "set_active";

const VALID_ROLES = ["rep", "ops", "accounts", "admin"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  // Checked by name up front. A function that falls over on an undefined key
  // three steps later is a support call; one that names the missing setting
  // is a thirty second fix.
  const missing = [
    !SUPABASE_URL && "SUPABASE_URL",
    !ANON_KEY     && "SUPABASE_ANON_KEY (or SUPABASE_PUBLISHABLE_KEY)",
    !SERVICE_KEY  && "SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY)",
  ].filter(Boolean);
  if (missing.length) {
    return json({ error: "Missing from Edge Functions -> Secrets: " + missing.join(", "),
                  hint: "These are normally provided automatically. If one is named " +
                        "here, add it by hand from Project Settings -> API." }, 500);
  }

  // ---- who is asking -------------------------------------------------
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "not signed in" }, 401);

  const asCaller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: who, error: whoErr } = await asCaller.auth.getUser();
  if (whoErr || !who?.user) return json({ error: "not signed in" }, 401);
  const callerId = who.user.id;

  // The service-role client bypasses row-level security. Everything below it
  // is therefore gated by hand, starting with this.
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  const { data: me } = await admin.from("profiles")
    .select("full_name, can_manage_users").eq("id", callerId).maybeSingle();
  if (!me?.can_manage_users) {
    return json({ error: "Only a user administrator can do this." }, 403);
  }
  const actorName = me.full_name ?? "unknown";

  let body: {
    action?: Action; user_id?: string; password?: string;
    email?: string; full_name?: string; role?: string;
    app_access?: string[] | null; active?: boolean;
  };
  try { body = await req.json(); } catch { return json({ error: "bad request body" }, 400); }

  const log = async (action: string, targetId: string | null,
                     targetName: string | null, detail: string) => {
    // Never the password itself, only the fact that one was set.
    await admin.from("admin_audit").insert({
      actor_id: callerId, actor_name: actorName,
      action, target_id: targetId, target_name: targetName, detail,
    });
  };

  // Every user in the project, however many pages that takes.
  const allAuthUsers = async () => {
    const out: Array<Record<string, unknown>> = [];
    for (let page = 1; ; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (error) throw new Error(error.message);
      const batch = data?.users ?? [];
      out.push(...batch as Array<Record<string, unknown>>);
      if (batch.length < 200) return out;
    }
  };

  try {
    switch (body.action) {
      // -----------------------------------------------------------------
      case "list": {
        const [users, profs] = await Promise.all([
          allAuthUsers(),
          admin.from("profiles")
            .select("id, full_name, role, app_access, active, can_manage_users, created_at")
            .then(r => { if (r.error) throw new Error(r.error.message); return r.data ?? []; }),
        ]);
        const byId = new Map(users.map(u => [u.id as string, u]));
        const people = profs.map(p => {
          const u = byId.get(p.id) as Record<string, unknown> | undefined;
          return {
            ...p,
            email: (u?.email as string) ?? null,
            last_sign_in_at: (u?.last_sign_in_at as string) ?? null,
            // A ban is the real lock: a banned login cannot even authenticate,
            // never mind get past an app's front door.
            banned: !!(u?.banned_until &&
                       new Date(u.banned_until as string).getTime() > Date.now()),
            has_login: !!u,
          };
        });
        // Logins with no profile row at all would otherwise be invisible, and
        // an invisible login is exactly the thing this page exists to stop.
        const orphans = users
          .filter(u => !profs.some(p => p.id === u.id))
          .map(u => ({
            id: u.id, full_name: null, role: null, app_access: null,
            active: true, can_manage_users: false, created_at: u.created_at,
            email: u.email ?? null, last_sign_in_at: u.last_sign_in_at ?? null,
            banned: !!(u.banned_until &&
                       new Date(u.banned_until as string).getTime() > Date.now()),
            has_login: true, no_profile: true,
          }));
        return json({ people: [...people, ...orphans] });
      }

      // -----------------------------------------------------------------
      case "set_password": {
        const id = body.user_id;
        const pw = body.password ?? "";
        if (!id) return json({ error: "user_id is required" }, 400);
        if (pw.length < MIN_PASSWORD) {
          return json({ error: `The password must be at least ${MIN_PASSWORD} characters.` }, 400);
        }
        const { data: target } = await admin.from("profiles")
          .select("full_name").eq("id", id).maybeSingle();

        const { error } = await admin.auth.admin.updateUserById(id, { password: pw });
        if (error) return json({ error: error.message }, 400);

        await log("password_set", id, target?.full_name ?? null,
                  "a new password was set (the password itself is not recorded)");
        return json({ ok: true, name: target?.full_name ?? null });
      }

      // -----------------------------------------------------------------
      case "create_person": {
        const email = (body.email ?? "").trim().toLowerCase();
        const pw = body.password ?? "";
        const name = (body.full_name ?? "").trim();
        const role = body.role ?? "";
        if (!email || !email.includes("@")) return json({ error: "A real email address is required." }, 400);
        if (name.length < 2) return json({ error: "A name is required." }, 400);
        if (!VALID_ROLES.includes(role)) {
          return json({ error: "Role must be one of: " + VALID_ROLES.join(", ") }, 400);
        }
        if (pw.length < MIN_PASSWORD) {
          return json({ error: `The password must be at least ${MIN_PASSWORD} characters.` }, 400);
        }

        const { data: made, error } = await admin.auth.admin.createUser({
          email, password: pw,
          // No confirmation email: staff are told their password by Tom, and
          // an unconfirmed login cannot sign in at all.
          email_confirm: true,
        });
        if (error) return json({ error: error.message }, 400);
        const newId = made?.user?.id;
        if (!newId) return json({ error: "the login was not created" }, 500);

        // The profile row is what every app actually reads. A login without
        // one can sign in and then see nothing, so it is made here in the
        // same breath rather than left to a separate step.
        const { error: pErr } = await admin.from("profiles").insert({
          id: newId, full_name: name, role,
          app_access: body.app_access ?? null, active: true,
        });
        if (pErr) {
          // Don't leave a login with no profile behind. Undo it.
          await admin.auth.admin.deleteUser(newId);
          return json({ error: "could not create the profile, so the login was undone: " + pErr.message }, 500);
        }

        await log("person_added", newId, name, `${email}, role ${role}`);
        return json({ ok: true, id: newId });
      }

      // -----------------------------------------------------------------
      case "set_active": {
        const id = body.user_id;
        const on = body.active === true;
        if (!id) return json({ error: "user_id is required" }, 400);
        if (id === callerId && !on) {
          return json({ error: "You cannot switch off your own login." }, 400);
        }
        const { data: target } = await admin.from("profiles")
          .select("full_name").eq("id", id).maybeSingle();

        // Both halves on purpose. The column is what the apps read; the ban is
        // what actually stops the sign-in. Without the ban, switching someone
        // off would only hide the doors, not lock them.
        const { error: banErr } = await admin.auth.admin.updateUserById(id, {
          ban_duration: on ? "none" : FOREVER,
        });
        if (banErr) return json({ error: banErr.message }, 400);

        const { error: colErr } = await admin.from("profiles")
          .update({ active: on }).eq("id", id);
        if (colErr) return json({ error: colErr.message }, 400);

        await log(on ? "switched_on" : "switched_off", id, target?.full_name ?? null,
                  on ? "can sign in again" : "signed out and blocked from signing in");
        return json({ ok: true });
      }

      default:
        return json({ error: "action must be one of: list, set_password, create_person, set_active" }, 400);
    }
  } catch (e) {
    return json({ error: (e as Error).message ?? String(e) }, 500);
  }
});
