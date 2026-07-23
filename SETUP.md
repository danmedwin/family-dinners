# Family Dinner Planner — Setup

A single-file PWA (`index.html`) backed by Firebase (Auth + Firestore).
As of the multi-family update, **any family can use the hosted app** at
https://techrabbi.org/family-dinners/ — no code changes or self-hosting needed.

## How multi-family works

- Each family creates **one shared account** (email + password) right on the
  sign-in screen ("New here? Create your family →"). Everyone in the family
  signs in with the same credentials on their own device.
- All of a family's data lives under `families/{uid}` in Firestore, where
  `uid` is their shared account. The security rules in `firestore.rules`
  guarantee a family can only ever read/write its own subtree.
- New families are seeded with the starter meal library and the member names
  they enter at sign-up (editable later in Settings).
- The original family's pre-multi-family data (root `meals`, `history`,
  `app/config`, `app/state`) is migrated automatically into
  `families/{uid}` the next time that account signs in. Meal IDs are
  preserved, so the current plan, day assignments, and history stay intact.
  The old root data is left in place as a backup (read-only under the new
  rules); it can be deleted from the console once the migration is verified.

## One-time steps in the Firebase console (required before announcing)

1. **Publish the security rules.** Firestore Database → Rules → paste the
   contents of `firestore.rules` → Publish. Do this *before* sharing the app:
   without them, any signed-in account can read every family's data.
2. **Confirm Email/Password sign-in is enabled.** Authentication →
   Sign-in method → Email/Password (already on for the original account).
3. *(Optional)* Authentication → Templates: customize the password-reset
   email (the app has a "Forgot password?" link).

## Things to know

- **Anyone with the URL can create a family.** Firestore/Auth free-tier
  limits are generous, but the AI features (`RECIPE_AI_WORKER_URL`) call a
  Cloudflare Worker that uses *your* Anthropic API key — every family shares
  it. To limit cost: set a spend cap on the Anthropic key, lock the Worker's
  `ALLOW_ORIGIN` to `https://techrabbi.org`, and/or add rate limiting in the
  Worker. Set `RECIPE_AI_WORKER_URL = ""` to turn AI features off entirely.
- To stop new sign-ups later, guard account creation in Firebase
  (Authentication → Settings → User actions → disable "Enable create").
- `INSTACART_STORE_SLUG` is a single global default (currently `publix`);
  tap-through links use it for every family.

## Self-hosting (optional)

Fork the repo, create your own Firebase project (Auth + Firestore), paste
your config into `firebaseConfig` at the top of `index.html`, publish
`firestore.rules`, and serve the folder from any static host (GitHub Pages
works). The AI helpers need your own Cloudflare Worker — deploy
`recipe-ai-worker.js` with an `ANTHROPIC_API_KEY` secret and set
`RECIPE_AI_WORKER_URL`.
