# Family Dinner Planner — Setup

A single-file PWA (`index.html`) backed by Firebase (Auth + Firestore).
As of the multi-family update, **any invited family can use the hosted app**
at https://techrabbi.org/family-dinners/ — no self-hosting needed.

## How multi-family works

- Each family creates **one shared account** (email + password) on the
  sign-in screen ("New here? Create your family →"). Sign-up requires an
  **invite code** and captures the family's **food profile** (which proteins,
  dairy stance, kosher-style, healthy focus).
- All of a family's data lives under `families/{uid}` in Firestore.
  `firestore.rules` guarantees a family can only read/write its own data;
  the admin account (the original family) can additionally *read* everything,
  which powers the in-app usage dashboard (Settings → 📊 Family usage).
- New families are seeded with the starter library **filtered to their food
  profile**, and the AI generate/recipe features pass the profile to the
  worker so suggestions respect it automatically.
- The invite code lives in Firestore at `admin/invite` (field `code`). It is
  enforced server-side by the rules and is never readable by browsers.
  Rotate it in the console anytime; existing families are unaffected.
- The original family's pre-multi-family data (root `meals`, `history`,
  `app/*`) migrates automatically into `families/{uid}` on that account's
  next sign-in, with meal IDs preserved. The root data remains as a
  read-only backup.

## Go-live checklist (in this order)

1. **Anthropic spend cap.** In the [Anthropic Console](https://console.anthropic.com)
   → Settings → Limits, set the monthly spend limit for the API key used by
   the recipe worker (e.g. $5/month). AI features fail gracefully in the app
   when the cap is hit — everything else keeps working.
2. **Create the invite code.** Firebase Console → Firestore Database → Start
   collection: collection ID `admin`, document ID `invite`, one string field
   `code` with your chosen code (case-sensitive — pick something easy to
   type on a phone, e.g. `shabbat-dinner`).
3. **Redeploy the Cloudflare Worker** with the updated `recipe-ai-worker.js`
   (adds food-profile awareness and locks CORS to techrabbi.org). In the
   Cloudflare dashboard: Workers → recipe-ai → Edit code → paste → Deploy.
4. **Merge & deploy the app** (merge the PR; GitHub Pages redeploys
   automatically in a minute or two).
5. **Publish the security rules** — Firestore Database → Rules → paste the
   contents of `firestore.rules` → Publish. Do this promptly after step 4:
   the old rules must stay up until the new app is live (they'd break the
   old app), but until the new rules are published, sign-ups aren't
   invite-gated and data isn't isolated.
6. **Sign in once** with the original account to trigger the data migration,
   and verify your meals/plan/history look right.

## Rolling back (if it all goes to shit)

- **Soft pullback — keep the new app, stop new families:** delete the
  `admin/invite` doc (no one can complete sign-up), or disable specific
  accounts in Firebase Console → Authentication → Users. Existing data and
  your family's app are untouched. This is the recommended lever.
- **Full rollback — return to the single-family app:** in GitHub, open the
  merged PR and click **Revert** (Pages redeploys the old app), then in
  Firestore → Rules use the version history to restore the previous rules.
  Caveat: the old app reads the root collections, which froze at migration
  time — anything your family changed *after* migrating lives only under
  `families/{uid}` and would need copying back. So: revert soon after
  launch is lossless; revert much later means reconciling data (ask Claude
  to script it).

## Costs (who pays what)

- **Firebase:** free tier covers dozens of families (50k reads / 20k writes
  per day). Email/password auth is free.
- **Hosting + Cloudflare Worker:** free.
- **Anthropic API (your key):** Haiku 4.5 via the worker; "Generate ideas"
  ≈ 1–2¢ per call, other helpers well under 1¢. An active family ≈
  $0.30–0.50/month. The spend cap in step 1 is the hard backstop.

## Self-hosting (optional)

Fork the repo, create your own Firebase project (Auth + Firestore), paste
your config into `firebaseConfig` at the top of `index.html`, publish
`firestore.rules` (change the admin email in it), create your `admin/invite`
doc, and serve the folder from any static host. The AI helpers need your own
Cloudflare Worker — deploy `recipe-ai-worker.js` with an `ANTHROPIC_API_KEY`
secret and set `RECIPE_AI_WORKER_URL` (and its `ALLOW_ORIGIN`).
