# Setting up phone notifications

Written for: Tom, doing this once, in order.

This folder holds `index.ts` — a small program that runs **on Supabase**, not
in any of the apps. Its only job is to send the actual buzz to a rep's phone.

**Nothing below is needed for the bell inside the rep app.** That already
works from the data itself. If you never do any of this, reps still see every
update the next time they open the app. This is only for the buzz on a phone
that is shut.

---

## Before you start: what you need to know

The private key that signs a notification **cannot live in the apps**. All
five apps are static pages on GitHub Pages, and anything in them is public to
the world. That is the whole reason this function exists: it is the one place
Skelsee has that can keep a secret.

There are two halves to the key:

| | Where it goes | Secret? |
|---|---|---|
| **Public key** | already written into `index.html` and `sw.js` | No — it is meant to be seen |
| **Private key** | only into Supabase, in step 3 below | **Yes — treat it like a password** |

---

## Step 1 — Run the SQL, in this order

In Supabase: **SQL Editor** → paste → **Run**. Each file has a Part 1 that
only looks, then a Part 2 that changes things. Run Part 1, read what it says,
then run Part 2.

1. `supabase/migrations/phase_d6_en_route.sql` — adds the two columns the
   "En route" button writes to.
2. `supabase/migrations/phase_d7_push_subscriptions.sql` — adds the table that
   remembers which phones have agreed to be notified.

**Run these before you push the app files.** The apps send columns that have
to already exist, or every save fails.

---

## Step 2 — Push the app files

Drag them into GitHub Desktop as usual. After this, the bell works and the
"En route" button works. Phone notifications do not yet — the rep app will
say so honestly rather than pretending.

---

## Step 3 — Create the function

1. In Supabase, open **Edge Functions** in the left-hand menu.
2. Click **Deploy a new function**, then **Via Editor**.
3. Name it exactly: `notify-rep`
   The apps call it by that name. A different name means nothing happens.
4. Delete whatever example code is in the editor.
5. Open `supabase/functions/notify-rep/index.ts` from this folder, copy the
   whole file, and paste it in.
6. Click **Deploy**.

---

## Step 4 — Give it the keys

Still in **Edge Functions**, open **Secrets** and add these two.

| Name | Value |
|---|---|
| `VAPID_PUBLIC_KEY` | `BJlwIpB2xU2G9UOwlYJXVM29SMPbE7itnadsEiyA66Y1e_NR0_FWIFM4gZxPwdtr_HO1wo1UP44-NXZ8V-jw75A` |
| `VAPID_PRIVATE_KEY` | the private key Claude gave you — **not** in this file on purpose |

The private key is deliberately not written down anywhere in this repository.
If it were, pushing to GitHub would publish it.

Optionally also add `VAPID_SUBJECT` as `mailto:marketing@skelsee.co.zw`. If you
leave it out, the function uses that address anyway.

You do **not** need to add `SUPABASE_URL`, `SUPABASE_ANON_KEY` or
`SUPABASE_SERVICE_ROLE_KEY` — Supabase puts those in by itself.

---

## Step 5 — Prove it works, on your own phone

1. Open the rep app on your phone.
   **On an iPhone this must be the Home Screen copy**, not Safari. If it is
   not, the app will tell you so and show you how to add it.
2. Go to **More** → **Phone notifications** → **Turn on notifications**.
3. Say yes when the phone asks.
4. Tap **Send me a test**.

A notification should arrive within a few seconds.

If it does not, the app tells you *why* rather than just failing:

| What it says | What it means |
|---|---|
| "the function was not found" | Step 3 did not finish, or the name is not exactly `notify-rep` |
| "VAPID keys are not set" | Step 4 is missing or a key has a typo |
| "that person has no phone signed up" | Step 2 on this phone did not save — try turning it on again |
| nothing at all arrives, no error | the phone has notifications muted at the operating-system level |
| some other error mentioning `web-push` or an import | see below |

**The one thing that could not be tested from here.** The function borrows a
library called `web-push` to do the signing and encrypting. That part can only
be proved by deploying it — there is no way to run a Supabase function on this
PC. If step 5 fails with an error about `web-push` or about an import, tell
Claude the exact wording: the fix is a one-line change to how the library is
loaded, and everything else in this setup stays as it is.

---

## Step 6 — Get the reps on it

Each rep does step 5 themselves, on their own phone. Nobody can turn it on for
somebody else — the phone will only ask its own owner.

One row is stored per phone, so a rep with a phone and a tablet gets told on
both.

---

## What happens afterwards

Three things send a notification, all from the office end:

| The office does this | The rep's phone says |
|---|---|
| Assigns a truck | **Truck assigned** — customer, litres, reg, driver, driver's number |
| Taps **En route** | **On its way** — same details |
| Taps **Mark delivered** | **Delivered** — customer and litres |

Nobody is ever notified about their own action, so marking your own sale
delivered on the Sales screen sends nothing to you.

Three updates on one load replace each other on the lock screen rather than
stacking up three deep.

## If it stops working for somebody

A subscription dies when a rep deletes the app or the browser rotates it. The
sender notices and stamps the row rather than deleting it, so there is
something to look at:

```sql
select p.device_label, p.created_at, p.last_sent_at, p.expired_at, p.last_error,
       pr.full_name
from push_subscriptions p
join profiles pr on pr.id = p.user_id
order by pr.full_name, p.created_at;
```

`expired_at` filled in means that phone has to turn notifications on again.
