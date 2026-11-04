# manage-users — deploying it

The People page works without this. It lists everyone, shows what each person
can reach, and changes their access, all from the browser. What it **cannot**
do until this is deployed is show email addresses, show when somebody last
signed in, set a password, add a person, or switch a login off. Those four
buttons sit greyed out and the page says why at the top.

The reason is the same one as the notification key: those jobs need the
project's **secret key**, and that key can never go into any of the five apps.
They are static pages on GitHub Pages, and every file in this repository is
public to anybody who looks. So they happen here instead.

---

## Steps

**1. Supabase → Edge Functions → Create a new function.**

**2. Name it exactly `manage-users`.** The apps call it by that name; a typo
   here shows up as "Failed to send a request to the Edge Function".

**3. Delete everything in the editor** and paste in the whole of
   **`PASTE-THIS-INTO-SUPABASE.txt`** from this folder.

   That file is the same code as `index.ts` with every comment taken out —
   nothing but the code, so it is 212 lines instead of 263 and does not read as
   a jumble of prose and code in Supabase's editor. `index.ts` stays the one to
   read and to change; the .txt is generated from it, so after editing
   `index.ts` the .txt has to be regenerated or the two will drift.

   Last time, the starter template was left in place by mistake and the
   function deployed perfectly while doing nothing of the sort. Check the very
   first line in the editor reads:

   ```
   // manage-users — the People page's back end.
   ```

   and that the very last line is `});` on its own. If either is wrong the
   paste did not take — and check the bottom as well as the top, because a
   paste that got cut off halfway looks perfectly fine at the top.

**4. Leave "Verify JWT" ON.**

   It must stay on. The function reads the caller's own token to work out who
   is asking, and then refuses anybody who is not a user administrator. With
   verification off, that token is not checked and the function would take
   somebody's word for who they are — on a function that can reset any
   password in the business.

**5. Deploy.**

**6. There are no secrets to add.** It uses `SUPABASE_URL` and the two keys,
   all of which Supabase provides to every function automatically. If it ever
   reports one as missing, the error names which one.

---

## Checking it worked

Open the admin app → **People**. The line under the heading should read just
`11 people with a login`, with no amber warning after it. Each person's card
should now show their email address and when they last signed in.

If the warning is still there, the function is not answering. The most common
causes, in order: the name is not exactly `manage-users`; the starter template
was never replaced; the deploy failed (check the function's Logs tab).

---

## What it will and will not do

Refuses everything unless the caller holds `profiles.can_manage_users`. Being
an administrator is **not** enough — there are three administrators and one
user administrator, which is how Tom asked for it. Niel and Mack see every
screen in the business and cannot change a single person's access.

- **Passwords are set, never read.** They are stored one-way hashed, so there
  is nothing to read. The function enforces a minimum of 8 characters;
  Supabase's own floor is 6, which is too low for a login that reads the whole
  company's margins.
- **The change log never records the password itself**, only that one was set,
  by whom, for whom and when.
- **Switching somebody off does two things**: sets `active = false`, which the
  apps read, and bans the login in Supabase, which is what actually stops them
  authenticating. Without the second half, switching somebody off would only
  hide the doors rather than lock them.
- **You cannot switch off your own login.** Refused by name, so the one person
  who can undo it cannot lock themselves out.
- **Adding a person creates the login and the profile together.** If the
  profile fails, the login is deleted again rather than left behind — a login
  with no profile can sign in and then see nothing, which looks like a broken
  app rather than a half-finished job.
