# CAT 100

A full-stack preparation platform for the CAT exam (QA, VARC, DILR): daily personalised lessons,
an explainable mastery engine, spaced revision, an error log, a PYQ-first question bank with
provenance, timed mock tests with analysis, strategy drills, a grounded tutor, analytics, a study
planner and an admin content console.

## Content status (read this first)

- **No verified CAT previous-year questions are bundled.** No source was found that is both lawful
  to copy and checkable against the official paper and answer key; the research and what would
  unblock it are in [docs/PYQ-SOURCES.md](docs/PYQ-SOURCES.md). The import and review workflow is
  complete: a question is shown as a **Verified CAT PYQ** only after an admin approves it against a
  cited paper and answer key ([docs/PYQ-IMPORT.md](docs/PYQ-IMPORT.md)). Memory-based questions are
  labelled **Unverified historical**; everything else is labelled as practice.
- The seed ships **65 original practice questions** (46 QA, 2 RC passages with 4 questions each,
  3 VA items, 2 DILR sets with 4 questions each), every one labelled “Original practice”. QA and DI
  answers are independently recomputed in `server/test/content-answers.test.ts`.
- The mock simulator uses the **CAT 2024 pattern, version 1, which is unverified**: the official
  CAT 2024 bulletin could not be obtained. Findings, sources and how to verify it are in
  [docs/EXAM-PATTERN.md](docs/EXAM-PATTERN.md).
- Password-reset email needs an SMTP provider in production ([docs/EMAIL.md](docs/EMAIL.md)).
- No percentile or admission outcome is ever predicted.

## Stack

| Layer | Choice |
|---|---|
| API | Node 22, Express 5, TypeScript, zod validation, raw SQL via `pg` |
| Database | PostgreSQL 14+ with SQL migrations (`server/migrations`, up and down) |
| Web | React 19, React Router 7, Vite, KaTeX + marked + DOMPurify, no UI framework |
| Auth | scrypt password hashes, opaque session cookie (httpOnly, SameSite=Lax), double-submit CSRF token |
| Tutor | Offline grounded guide by default; optional Anthropic API (server-side key only) |
| Tests | Vitest (unit + API integration against a real Postgres), Playwright (browser) |

## Run it locally

Prerequisites: Node 22+, PostgreSQL 14+.

```bash
# 1. databases (adjust user/password to taste; must match .env)
createuser -P cat100            # password: cat100
createdb -O cat100 cat100
createdb -O cat100 cat100_test  # used by server tests
createdb -O cat100 cat100_e2e   # used by browser tests

# 2. configuration
cp .env.example server/.env     # edit if your database URL differs

# 3. install, then migrate and seed (the seed script runs migrations first)
npm install
SEED_ADMIN_EMAIL=you@example.com SEED_ADMIN_PASSWORD='a long admin password' npm run db:seed

# 4. develop: API on :4000, web on :5173 (proxies /api)
npm run dev
```

Open http://localhost:5173, create an account, and follow onboarding. Sign in with the seeded
admin account to reach **Content admin**.

### Production build

```bash
npm run build                    # compiles server to server/dist, web to web/dist
cd server && NODE_ENV=production COOKIE_SECURE=true npm start   # serves API and web on :4000
```

Run behind HTTPS. Set `CORS_ORIGIN` and `APP_URL` to the public origin.

### Deploy

A `Dockerfile` and a Render Blueprint (`render.yaml`) are included. See [docs/DEPLOY.md](docs/DEPLOY.md).

## Tests

```bash
npm test -w server        # unit, API, migration and SMTP tests; resets cat100_test each run
npm test -w web           # markdown/KaTeX and provenance-label unit tests
npm run e2e               # builds web, then Playwright; resets cat100_e2e and starts its own server on :4100
```

Playwright uses `CHROMIUM_PATH` if set, else `/opt/pw-browsers/chromium` if present, else its own
browser (`npx playwright install chromium`).

## Importing questions (including PYQs)

Admin → Import accepts JSON, JSON Lines or CSV (template in
[docs/pyq-import-template.csv](docs/pyq-import-template.csv)). Always run **Validate (dry run)**
first. The validator checks schema, links between questions and passages or sets, answers and
options, duplicate IDs, duplicate and near-duplicate text, duplicate paper question numbers,
incomplete PYQ records and whether the answer matches the cited answer key.

Questions labelled `authentic_pyq` never publish on import. They wait in Admin → **PYQ review**
until an admin confirms them against the cited paper and answer key; passages and DILR sets are
approved with all their questions. Edits or re-imports send a PYQ back to review. Every change is
versioned and audited, and the database refuses to publish an unapproved PYQ. The full procedure
is [docs/PYQ-IMPORT.md](docs/PYQ-IMPORT.md).

## How the learning engine works

Formulas and thresholds for mastery, recommendations, spaced revision, the error log, the planner,
mock classification and strategy drills are documented in [docs/MASTERY.md](docs/MASTERY.md) and
shown in the app at /help/mastery. The REST API is listed in [docs/API.md](docs/API.md).

## Security notes

- Passwords: scrypt (N=2^15, r=8, p=1, 16-byte salt). Sessions: 32-byte random token, only its
  SHA-256 is stored; 14-day expiry. Reset tokens are single-use, stored only as hashes, valid for
  one hour, revoked by newer requests, rate limited per IP and per account, and a reset signs out
  every session. The forgot-password reply never reveals whether an account exists. See
  [docs/EMAIL.md](docs/EMAIL.md).
- Every state-changing request from a signed-in browser must carry the `x-csrf-token` header that
  matches the session (credential endpoints are exempt so a signed-in browser can switch accounts).
- All learner data queries are scoped by the session's user id on the server (tests cover
  cross-user access to attempts, notes, errors, lessons, plans, mocks, tutor sessions and revision).
- Rate limits on auth endpoints and the API; helmet headers; CORS restricted to `CORS_ORIGIN`.
- Uploads: admin only, PNG/JPEG/WebP by magic bytes, ≤ 2 MB, random file names.
- Secrets (database URL, `ANTHROPIC_API_KEY`, SMTP credentials) are read from the server
  environment only and never sent to the browser. Request logs redact reset tokens.
- Markdown content is sanitised with DOMPurify before rendering; KaTeX runs with `trust: false`.

## Backups and recovery

All state is in PostgreSQL (plus uploaded images in `UPLOAD_DIR`).

```bash
pg_dump --format=custom --file=cat100-$(date +%F).dump "$DATABASE_URL"   # nightly
tar czf uploads-$(date +%F).tgz server/uploads
pg_restore --clean --if-exists --dbname="$DATABASE_URL" cat100-YYYY-MM-DD.dump   # restore
```

Migrations are forward and backward (`npm run migrate -w server`, `npm run migrate:down -w server`);
take a backup before running either in production. Learners can export all their data as JSON from
Settings, and delete their account (cascades to all learner data).

## Known limitations

- No verified PYQs or real CAT papers are included (see above); PYQ modes and year-wise papers are
  empty until an admin imports and approves questions.
- The CAT 2024 exam pattern is unverified; no official source has been attached that states it.
- The sample bank is small (65 questions), so lessons for many topics have no practice questions and
  say so; worked examples are drawn from existing questions, and topic concept notes are outlines.
- Password-reset email works only once an SMTP provider is configured. Delivery was tested against
  a local SMTP test server, not a real provider.
- AI-generated practice questions are not implemented; the `ai_generated` origin exists in the schema
  and is labelled in the UI, but nothing generates them yet.
- The AI tutor (when enabled) can be wrong; replies show their grounding sources and provider.
- Calculation-gym results are only stored as study time, not per item.
- The web bundle is a single ~760 KB chunk (KaTeX and markdown included); no code splitting yet.
