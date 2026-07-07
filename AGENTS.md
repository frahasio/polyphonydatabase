# AGENTS.md - working notes for the Polyphony Database

Orientation and running status for anyone (human or AI) picking this project
up. Read this first; it records what has been done, what was deliberately
left, and the operational details that are easy to forget.

## Stack & deploy at a glance

- Node.js (ESM) + Express 4, PostgreSQL (`pg`), sessions via
  `express-session` + `connect-pg-simple`. Vanilla-JS front end in `public/`.
- Deployed on Heroku app **`polyphony-database-node`** (domains
  `polyphonydatabase.com` / `www`). Main dev branch: **`node-rewrite`**.
- Deploy = push to GitHub `origin` AND to the Heroku remote's `main`:
  `git push origin node-rewrite` then `git push heroku HEAD:main`. Heroku's
  **release phase** runs `scripts/migrate.js`, so a failed migration aborts
  the deploy. (`deploy.ps1` exists but does a blanket `git add .` + generic
  commit; prefer deliberate commits.)
- **Migrations:** numbered `migrations/*.sql`, applied by `src/db.js` and
  tracked in the `app_migrations` table (NOT `schema_migrations`, which is a
  Rails-era fossil). `000_baseline_schema.sql` was dumped from production;
  existing DBs are auto-baselined. `SCHEMA_REFERENCE.md` documents the real
  schema.

## Status (July 2026)

A full audit was done and **every Critical/High finding is remediated** and
deployed. Also shipped since:

- Security: session-only auth (JWT removed), fail-fast secrets, secure+
  sameSite cookies, Origin-check CSRF, SSRF-safe booklet fetch, XSS escaping
  across all admin pages via `public/js/dom-utils.js`, hashed reset tokens +
  session revocation, dependency updates (0 `npm audit` vulns).
- Data safety: cleanup no longer deletes titles linked via `functions_titles`
  or groups with editions/recordings; `saveSourceWithInclusions` now deletes
  removed inclusions inside the save transaction.
- Migration runner + Heroku release phase.
- Review queue (`/modules/suggestions`) fed by two matchers:
  `scripts/suggest-title-functions.js` (Cantus Index title->function) and
  `scripts/suggest-recordings.js` (YouTube + Spotify). Accepting writes real
  `functions_titles` / `recordings` rows. Recording accept lets the reviewer
  correct the performer name (autocomplete against existing performers).
- Commissions module: public enquiry (`/commissions`) -> admin price offer
  -> Stripe Checkout -> webhook marks paid -> "mark ready" delivery email.
  Gated by the `commissions` permission; commissions can be claimed/released
  so only one user edits at a time.
- Booklet: page numbering (position + independent margins), composer-aware
  edition search, ABC/HR in the Add menu, friendly permission page.
- Booklet template library: booklet_templates table + /api/booklet/templates
  + in-app library modal (browse/search/load/publish; admins manage official
  ones). Seeded with 126 Mass-propers templates generated from the vendored
  jgabc data by scripts/generate-booklet-templates.js (re-run overwrites
  generated official templates — deliberate refresh only). Planned next:
  Divinum Officium import for texts/translations and a fetch-translation
  button backed by the vendored Douay-Rheims/Vulgate files.
- Backend CRUD dedup: composers/editors/performers/publishers/scribes now use
  `src/routes/entityRouter.js` (`createEntityRouter`).

## Deferred / recommended NOT to big-bang (do incrementally)

- **Public search rebuild** (`src/routes/search.js`): the main group query is
  a correlated-subquery wall (~10+ subqueries per row). A query-builder +
  two-phase hydration would be faster, but it is the public-facing core and
  there is no automated test suite - rebuild incrementally while touching it,
  not speculatively. Production indexes DO exist (trigram, GIN) - see
  `000_baseline_schema.sql`.
- **Booklet decomposition** (`public/modules/liturgy-booklet/booklet-app.js`,
  ~5,500 lines): worth splitting into modules (state/store, migrate,
  renderers, paginator, pdf export, ui) and adding undo, BUT it is a complex
  renderer with no tests - decompose incrementally, keep the v8 project
  schema. Also: `localStorage` autosave can fail silently on quota with big
  base64 images; one Chrome per PDF request has no queue (dyno exhaustion
  risk under concurrent exports).
- **Front-end entity pages** (`public/modules/{composers,editors,...}`): still
  ~15 copy-pasted index/edit/new pages. Lower value / higher risk than the
  backend factory was; dedupe only if you are already in there.

## Feature backlog (from the audit's Phase 3)

Saved / shareable search URLs; citation export (RISM/BibTeX); people/title
dedup-merge tool (complements the performer-spelling issue); server-stored
booklet projects + "Community booklets" sharing (button exists, disabled);
recent-changes/undo from `audit_log`; public read-only API; PDF export job
queue.

## Operational notes

- **Heroku config vars** in use: `SESSION_SECRET`, `JWT_SECRET` (legacy,
  unused - safe to remove), `DATABASE_URL`, `EMAIL_*`, `ADMIN_EMAIL`
  (notifications go here; set to frahasio@gmail.com to avoid Gmail
  self-forward loss), `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY` /
  `STRIPE_WEBHOOK_SECRET`, `YOUTUBE_API_KEY`, `SPOTIFY_CLIENT_ID` /
  `SPOTIFY_CLIENT_SECRET`.
- **Scheduler jobs** (Heroku Scheduler add-on): run
  `node scripts/suggest-title-functions.js <n>` (no hard API quota; big
  batches fine) and `node scripts/suggest-recordings.js <n>` (YouTube caps at
  ~100 searches/day and resets daily, so daily-moderate beats big-infrequent;
  Spotify has no hard cap and the script stops YouTube cleanly once quota is
  hit).
- **Matcher tuning:** the Cantus feast->function map in
  `scripts/suggest-title-functions.js` covers ~100 common feasts - extend for
  rarer saints. Recording match threshold is `MIN_SCORE = 0.5` in
  `scripts/suggest-recordings.js` - adjust after watching the queue.
- **Stripe go-live:** currently TEST keys. To go live: activate the Stripe
  account, register a LIVE webhook at
  `https://polyphonydatabase.com/api/commissions/webhook` for
  `checkout.session.completed`, then swap all three `STRIPE_*` config vars to
  their live values (`sk_live_`/`pk_live_`/`whsec_` live). No code change.
- **Gmail:** `EMAIL_PASSWORD` must be a Gmail **App Password** (needs 2FA);
  the account password is rejected by SMTP.
- **Dead tables** (documented in `SCHEMA_REFERENCE.md`, safe to drop once
  confirmed): `users_backup`, `temp_inclusions`, `suggestion_flags`, the
  unused `search_vector` columns, Rails `schema_migrations` /
  `ar_internal_metadata`.
- **Data conventions:** composer id **23 = Anonymous** (excluded from
  displays/filters). `compositions.tone` is `text[]`; `even_odd` is int
  (0 even / 1 odd / 2 both).
