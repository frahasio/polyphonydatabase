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
- Review queue (`/modules/suggestions`) fed by nine matchers:
 `scripts/suggest-title-functions.js` (Cantus Index title->function),
 `scripts/suggest-title-functions-do.js` (Divinum Officium title->function:
 indexes the vendored data/divinumofficium corpus — every Mass proper +
 Office hour, Latin — and matches title incipits as word-for-word prefixes
 of liturgical text units; knows the exact POSITION (Introit of Advent I,
 Vespers antiphon of St Andrew...). Emits ONE multi-function card per
 title (payload.multi, dedupe `tfm:{title_id}`; re-runs refresh pending
 cards in place): specific propers (< DO_GENERIC_DAYS=8 days) preticked
 at <=2 days, PLUS season-level entries (Advent/Christmas/Lent/Easter/
 Pentecost-octave via day-file prefixes, see seasonOfDay) for texts that
 recur on >=3 days concentrated (>=50%) in one season — previously junked
 as generic. Accept links all TICKED functions (function_selections). AUTO-ACCEPT:
 multipart titles whose EVERY part matches the same day's propers link
 automatically (existing functions only, never new ones; recorded as
 accepted suggestions dedupe `tfa:{title_id}:{fn_id}`, auto_accepted
 flag in payload; fully-resolved pending cards are deleted).
 Day counts use CALENDAR days: missa+horas trees, rubric variants
 (…t.txt/…o.txt) and multiple-Mass files (…m1-m3) fold into one day.
 FUNCTION CLUSTERS (level 'cluster', "main use" badge): appearances
 concentrated on one function (feast + octave, >=2 days, >=34% share,
 DO_CLUSTER_MIN_SHARE) identify a text's main purpose and lead the card
 preticked; when a cluster exists (or the title already has functions),
 scattered 1-day specifics are listed but NOT preticked. New-feast
 proposals are never preticked when alternatives exist. Mass-ordinary/
 daily-Office texts (Gloria, Sanctus, Magnificat... — kept OUTSIDE DO's
 per-day files, so day counting can't see their ubiquity) are blocked
 via isOrdinaryText in matching.js. Reviewer rejections (old
 single-function cards included) are never re-proposed. Dictionary edits
 reach pending cards on the NEXT matcher run (cards refresh in place). Mass Gospels/Epistles are evidence (sentence-
 indexed, pericope formulas stripped); TEMPORA Matins lessons are
 frequency-only (in-course scripture, coincidental); Sancti/Commune
 lessons are evidence. Latin->English feast names via the editable
 dictionary scripts/lib/feast-names.js (extend SAINT_NAMES as new saints
 hit the queue; translations matching an existing function link it
 directly). Day-label mapping is OVERRIDDEN by the feast_translations
 table (migration 020): one row per distinct DO day label, curated via
 /modules/functions "Feast dictionary" tab (source='manual' rows win and
 are never overwritten; clearing the English reverts to auto). Seed/
 refresh with scripts/seed-feast-translations.js (re-run after vendoring
 new DO data or improving auto-translation; --dry-run to preview). The
 functions admin page is now a table (inline rename, add/delete,
 titles/compositions counts, public-visibility badge) + the dictionary
 tab. Public /api/search/functions already lists only functions with
 linked titles. All local, no API; shared feast map + normalization in
 scripts/lib/matching.js),
 `scripts/suggest-recordings.js` (YouTube + Spotify),
 `scripts/suggest-title-merges.js` (duplicate titles — WORD ORDER IS
 SIGNIFICANT: only identical-after-normalization or word-for-word-prefix
 pairs are suggested, since word-order variants are legitimately different
 pieces; run manually with [maxPairs] [--dry-run]),
 `scripts/suggest-title-languages.js` (stopword/suffix heuristic for
 untagged titles, no API; supports --dry-run),
 `scripts/suggest-composer-bios.js` (v2: identity + life dates from the
 RISM person authority — native records only, federated external/diamm
 ids 500 on JSON fetch — with birth/death PLACES from the Wikidata item
 RISM itself cross-references, date-checked; records `composers.rism_id`
 + `wikidata_id` on accept; checkpoint `composers.wikidata_checked_at`,
 name kept from v1; rejects born-after-1750 namesakes; skips no-op
 suggestions; supports --dry-run. Grove has no API — RISM is the
 authoritative alternative), `scripts/suggest-group-titles.js` (groups whose
 display_title matches none of their compositions' titles; reviewer picks
 from the group's actual titles, or — when the group has a single distinct
 composition title — can flip the direction and retitle the composition(s)
 to the display title, `apply_to_compositions`, feast links carried over)
 and `scripts/suggest-anon-matches.js` (anon resolver, Aug 2026: pairs of
 compositions in DIFFERENT groups with the same title_id, an identical
 sorted_clef_combination_all — optional clefs included, since the same
 piece has the same optional voices — in some source each, no conflicting
 type/tone/even-odd/voices, at least one side anon — the card shows both
 sides with per-source clefs + source-image links so the reviewer compares
 the actual music. Ambiguity filter: a composition matching > 5 candidates
 is dropped (generic Magnificats etc.), a mutually UNIQUE pair scores
 highest ('matches N candidates' badge otherwise), max 20 pairs per title.
 HARD FILTERS: (1) SHARED SOURCE — the two candidates appearing in the
 same source means they are different pieces (one work copied twice in a
 source, once unattributed, unnoticed at cataloguing is vanishingly
 unlikely); (2) CHRONOLOGY — a pair is impossible when the anon sits in a
 source whose latest date predates every named-side composer's birth.
 Neither is ever proposed, and now-impossible pending cards are DELETED
 on the next run — as are pending cards whose pair is no longer a raw
 candidate at all (rule changes, recataloguing). PROVENANCE (soft weight, never excludes — plenty of Palestrina in
 Spanish sources): the named composer already having attributed works in
 the anon's source (+0.1, green badge) or another source from the same
 town (+0.05, blue badge) boosts the score; country isn't recorded on
 sources, so town/source co-occurrence is the proxy. Re-runs refresh
 still-pending cards in place (ON CONFLICT DO UPDATE ... WHERE pending).
 Accept = same piece: moves the chosen composition into the kept group
 (reviewer radio, default the named side); an emptied group's
 editions/recordings follow the move, pending suggestions are repointed,
 and the empty group is deleted. Reject = permanent 'not the same' — the
 dedupe key `am:{compA}:{compB}` is never re-proposed. Local SQL only,
 cheap manual run, supports --dry-run; run it only AFTER deploying the
 anon_match queue support) and `scripts/suggest-composition-types.js`
 (type suggester, Aug 2026: proposes a composition type per TITLE with
 untyped settings — one card per title, dedupe `ctype:{title_id}:{type_id}`,
 pending cards refreshed in place, cards for since-fully-typed titles
 deleted. Rules: CONSENSUS (typed settings of the same title all agree —
 self-bootstraps, no dictionary; titles whose typed settings disagree are
 skipped), KEYWORDS (missa/mass/messe/misa -> Mass, requiem first ->
 Requiem/Burial service, passio -> Passion, lamentatio -> Lamentation,
 litaniae -> Litany, alleluia -> Alleluia, magnificat / nunc dimittis ->
 Alternatim psalm/canticle), TONE (>=1 untyped setting of the title
 carries a psalm tone -> Alternatim psalm/canticle). The DECISION is per
 SETTING — settings of one title do NOT all share a type: the card lists
 each untyped setting with a tick-box (composer, group, attrs, and its
 sources' code + TITLE, which usually betrays the genre). Preticking: ANY
 Alternatim proposal (whatever rule made it) preticks only settings with
 a recorded tone — toneless ones may be motet-style; other proposals
 pretick all. The title's ALREADY-TYPED settings are shown live in a
 collapsible block so consensus evidence is verifiable (a warning shows
 if they changed since the card was made). Accept types the TICKED,
 still-untyped settings only (composition_ids in the body; manual types
 never overwritten; empty-and-none-left clears the card); reviewer can
 pick a different type on the card.
 composition_types.id is bigint — normalize pg's string ids to numbers.
 Cheap local SQL, manual run). The anon-match tab has a composition-type
 dropdown filter (`comp_type` param: type id matches either side of the
 pair, 'untyped' = neither side typed) so reviewers take the pair queue a
 genre at a time — it gets sharper as type suggestions are accepted, since
 ~82% of compositions were untyped (there is no 'Motet' type; untyped
 effectively means motet). Accept semantics: recordings/functions
 write real rows; title_merge merges (reviewer picks survivor);
 title_language sets `titles.language`; composer_bio APPLIES the Wikidata
 values — cited, so they win over ours where they differ (green = fills
 gap, amber = replaces) — and records `composers.wikidata_id`; group_title
 sets `groups.display_title`. Reviewers can correct performer name, feast
 (unknown name creates the function), language, and group title at accept
 time. The Cantus matcher also proposes feasts we don't have yet
 (`payload.new_function`) and processes titles that already have functions.
 The old dashboard "Data Quality Alerts" section and its API endpoints
 (data-quality-alerts/-records, ignore-alert, groups-for-correction,
 bulk-title-correction) were REMOVED in favour of the queue; the
 `ignored_alerts` table is now dead (safe to drop). Clef/voicing mapping
 gaps are handled in `/modules/clef-voicings`; unused titles / empty groups
 / orphaned compositions remain the cleanup tool's job (dashboard button).
- Commissions module: public enquiry (`/commissions`) -> admin price offer
 -> payment -> "mark ready" delivery email. Two payment paths (July 2026):
 Stripe Checkout (webhook marks paid; still on TEST keys, deliberately
 dormant until a client wants card payment) and bank transfer/BACS — the
 offer email offers it (account details from optional `BANK_TRANSFER_DETAILS`
 config var, multi-line OK; otherwise "reply and we'll send details") and
 the admin marks receipt via the "Mark as paid" button
 (`POST /api/admin/commissions/:id/mark-paid`, offered+priced only;
 `payment_note` column, migration 024, shown on the card — NULL means
 Stripe-webhook payment). Gated by the `commissions` permission;
 commissions can be claimed/released so only one user edits at a time.
- Booklet: page numbering (position + independent margins), composer-aware
  edition search, ABC/HR in the Add menu, friendly permission page. PDF export
  is server-side only (Puppeteer); an on-demand "Proof" modal shows the
  server's actual PDF (cached — proof then download reuses one render) since
  browser vs headless-Chrome text metrics can wrap long lines differently.
  Page splits (Aug 2026): `measureLineCutPoints` measures the REAL rendered
  line boxes of splittable blocks (text-node client rects merged into lines;
  parallel columns share lines, drop caps fuse their spanned lines, img/svg
  are opaque) and cuts at mid-gap between lines — the old arithmetic snap
  (header + n*lineHeight) drifted off-grid with titles/margins/fractional
  line heights and sliced through lines, which asc/desc clip covers only
  partly hid and server drift exposed. Arithmetic `bestLineSnap` retained
  only as fallback when nothing is measurable. Reading-block drop caps now
  have a per-block plain/ornamental selector (plain remains the default);
  ornamental initials use the locally bundled OFL Capo Sfogliato font,
  which supplies distinct forms for the full A-Z alphabet.
  Drop-cap colour, em size, and four margins are independently adjustable
  per reading block and are carried into the server-rendered PDF HTML. Capo
  Sfogliato's `ss02` letter and `ss01` floral layers are overlaid so ornamental
  initials have separately adjustable letter and decoration colours. Layout
  settings also expose independent page-number and in-text liturgical-symbol
  colours; the latter covers V/R/A bars plus crosses and daggers. Both colours
  are carried into server-rendered PDF HTML, and merged edition pages receive
  the selected page-number colour when their numbers are stamped. Exsurge chant
  rendering applies the same symbol colour to GABC special characters such as
  `V/.` and `R/.`; the global colour is part of the chant-cache key so changing
  it refreshes already-rendered SVGs. Reading blocks use bundled Hypher Latin
  and English patterns to insert discretionary soft hyphens at render time
  (enabled by the Layout "Automatic hyphenation" switch); saved HTML/JSON is
  untouched, and measured pagination sees the final hyphenated line boxes.
  The Latin dictionary is selected in JS rather than with `lang="la"`:
  EB Garamond's OpenType Latin localisation turns U into the historical
  V-shaped form when that language tag is present.
  Exsurge chant underlay inherits the booklet body font by default; each
  GABC block can override it from the same curated font list. Selected
  fonts are loaded before Exsurge measures lyrics, since changing typeface
  can alter chant system wrapping. Each generated chant SVG's embedded
  stylesheet is uniquely scoped: Exsurge otherwise emits the same global
  `svg.Exsurge .lyric` selector in every SVG, making the final chant's
  font and size paint every preceding chant despite their correct layout
  measurements.
- Booklet template library: booklet_templates table + /api/booklet/templates
  + in-app library modal (browse/search/load/publish; admins manage official
  ones). Seeded with 126 Mass-propers templates generated from the vendored
  jgabc data by scripts/generate-booklet-templates.js (re-run overwrites
  generated official templates — deliberate refresh only). Planned next:
  Divinum Officium import for texts/translations and a fetch-translation
  button backed by the vendored Douay-Rheims/Vulgate files.
- Granular permissions (Aug 2026, migrations 025+026): user_permissions.
 catalogue is now VIEW-only access to the admin cataloguing pages (and
 defaults to FALSE — new users get nothing until granted on /modules/
 permissions). Writes are gated per entity via user_entity_permissions
 (user_id, entity, level): entities sources (incl. inclusions), composers,
 titles, functions, groups (incl. editions/recordings), people (editors/
 scribes/publishers/performers), suggestions (review queue); level 'write'
 = add+edit, 'full' = also delete. No row = read-only. Enforced by
 requireEntityPermission in src/middleware/auth.js: GET needs catalogue
 view; POST/PUT need write; DELETE and POST ...(/merge) need full. Titles
 live under the functions router, so that mount resolves the entity from
 req.path (/titles/* -> titles). Admins bypass everything. /api/auth/me
 returns entity_permissions so pages COULD hide buttons the user can't use
 (not yet done — a permission-less click currently just gets a 403 alert).
 The permissions page has a 3-state dropdown per entity; granting a level
 auto-enables catalogue view. Existing catalogue users were backfilled to
 'full' on all entities.
- Backend CRUD dedup: composers/editors/performers/publishers/scribes now use
 `src/routes/entityRouter.js` (`createEntityRouter`). Optional cfg:
 `listCount` (usage count in list responses) and `mergeRefs` (POST /merge
 repoints references and deletes the merged rows) — both enabled for
 performers; the performers page has a multi-select merge bar (July 2026).
- Public search "Completeness" filter (`completeness=complete|needs_recon`):
 a group does NOT need reconstruction when at least one of its compositions
 can be assembled complete across catalogued sources — every voice marked
 missing/incomplete in some inclusion's `clefs` also appears intact in
 another inclusion of the SAME composition. Voices matched by `voice_number`
 with array-position (ordinality) fallback, since pre-2025 clef records lack
 the `voice_number` key. Optional and canonic voices and inclusions without
 clef data never count as defects (unknown = assumed complete). Canonic
 (`<c1>` in importer/editor notation, `canonic: true` in `inclusions.clefs`,
 rendered yellow) = a canonic voice not written out in the source, derived
 from another part; clef often inferred. Historically these were tagged
 incomplete `{}` — being manually re-tagged so they stop appearing under
 "needs reconstruction".
- Group management (`/group-management.html`, July 2026 rebuild): two-pane
 workbench — search/filter list left (checkbox select, count chips, deep
 link `?group=<id>`), persistent group panel right with inline
 edition/recording add+remove, display-title rename, and composition
 move/split via `POST /api/admin/groups/move-compositions` (compatibility
 checked server-side; editions/recordings never move implicitly; emptied
 bare source groups are deleted). Merge + bulk edit live in a bottom
 selection bar. The list endpoint now aggregates per-composition attrs
 (voices_list/types_list/tones_list/even_odd_list) grouped by g.id only.
 The old `POST /:groupId/remove-composition` endpoint (with its
 edition-moving heuristics) is no longer used by the UI. Titles page was
 restyled to match (same ids; logic still `functions.js`).

## Deferred / recommended NOT to big-bang (do incrementally)

- **Public search rebuild** (`src/routes/search.js`): two-phase hydration
 SHIPPED Aug 2026 — phase 1 selects just the page of group ids (filters +
 sort + LIMIT, with g.id as a paging tiebreaker; the composer-summary
 lateral is only joined for composer sorts), phase 2 hydrates the ~15 heavy
 JSON subqueries for those 25 ids only (unnest WITH ORDINALITY preserves
 order). Previously the hydration ran for EVERY matching row before LIMIT.
 The count query still runs the full filter set (needed for exact
 pagination). Remaining ideas: merge count into phase 1 via COUNT(*)
 OVER (), query-builder cleanup. No automated test suite — verify the main
 filter/sort combos manually after touching this. Production indexes DO
 exist (trigram, GIN) - see `000_baseline_schema.sql`.
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
  self-forward loss),  `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY` /
 `STRIPE_WEBHOOK_SECRET`, `YOUTUBE_API_KEY`, `SPOTIFY_CLIENT_ID` /
 `SPOTIFY_CLIENT_SECRET`. Optional: `BANK_TRANSFER_DETAILS` (bank account
 details included verbatim in the commission offer email; unset = the email
 invites a reply to request them).
- **Scheduler jobs** (Heroku Scheduler add-on): run
 `node scripts/suggest-title-functions-do.js` (Divinum Officium matcher —
 local corpus, no API, ~6 min full sweep, idempotent; a daily run picks up
 newly catalogued titles. The Cantus job `suggest-title-functions.js` was
 demoted July 2026 to a FALLBACK: it now builds the DO index first and
 skips any title the DO corpus contains, so its API effort goes only to
 the long tail — votive antiphons, non-liturgical texts. Run it manually
 or on a low-frequency schedule), `node scripts/suggest-recordings.js 80 youtube` (YouTube
 caps at ~100 searches/day, resets daily — each search.list costs 100 of
 the 10,000 units; on quota exhaustion the run stops WITHOUT burning the
 checkpoint), `node scripts/suggest-recordings.js 500 spotify` (no hard
 cap; per-platform checkpoints `groups.youtube_checked_at` /
 `spotify_checked_at`, migration 017) and
 `node scripts/suggest-composer-bios.js 50` (Wikidata, polite ~2 req/s, no
 hard quota) and `node scripts/suggest-composition-types.js 500` (daily;
 local SQL only, ~1 min — tops the Types tab back up to 500 and prunes
 cards for titles typed in the meantime). `suggest-title-languages.js`,
 `suggest-title-merges.js`, `suggest-group-titles.js` and
 `suggest-anon-matches.js` are cheap manual runs, not scheduled.
- **Matcher tuning:** the Cantus feast->function map in
 `scripts/suggest-title-functions.js` covers ~100 common feasts; unmapped
 feasts now surface as new-feast suggestions rather than vanishing.
 Recording scoring is composer surname (mandatory) + fraction of title
 words matched; threshold is `RECORDINGS_MIN_SCORE` env (default 0.7).
 The matchers checkpoint (`titles.cantus_checked_at`,
 `groups.youtube_checked_at` / `spotify_checked_at`,
 `composers.wikidata_checked_at`) so runs advance instead of re-searching
 the same block — the July 2026 recording-suggestion stall was exactly
 that: no checkpoint meant the same 80 unmatchable lowest-id groups were
 re-searched daily. To re-check everything after tuning, NULL the relevant
 column.
- **Stripe go-live:** currently TEST keys. To go live: activate the Stripe
  account, register a LIVE webhook at
  `https://polyphonydatabase.com/api/commissions/webhook` for
  `checkout.session.completed`, then swap all three `STRIPE_*` config vars to
  their live values (`sk_live_`/`pk_live_`/`whsec_` live). No code change.
- **Gmail:** `EMAIL_PASSWORD` must be a Gmail **App Password** (needs 2FA);
  the account password is rejected by SMTP.
- **Dead tables** (documented in `SCHEMA_REFERENCE.md`, safe to drop once
 confirmed): `users_backup`, `temp_inclusions`, `suggestion_flags`,
 `ignored_alerts` (dashboard alerts feature removed July 2026), the
 unused `search_vector` columns, Rails `schema_migrations` /
 `ar_internal_metadata`.
- **Data conventions:** composer id **23 = Anonymous** (excluded from
  displays/filters). `compositions.tone` is `text[]`; `even_odd` is int
  (0 even / 1 odd / 2 both).
