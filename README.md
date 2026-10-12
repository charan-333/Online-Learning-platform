# CAT 100

A full-stack preparation platform for the CAT exam (QA, VARC, DILR): daily personalised lessons,
an explainable mastery engine, spaced revision, an error log, a PYQ-first question bank with
provenance, timed mock tests with analysis, strategy drills, a grounded tutor, analytics, a study
planner and an admin content console.

## Content status (read this first)

- **No authentic CAT previous-year questions are bundled.** The platform is built PYQ-first (year,
  slot and source filters, PYQ practice modes, full-paper mocks, source verification), but PYQs
  must be imported by an admin from papers they can cite. Nothing is labelled a CAT PYQ unless an
  admin imported it with year, slot and a source reference *and* verified the source.
- The seed ships **65 original practice questions** (46 QA, 2 RC passages with 4 questions each,
  3 VA items, 2 DILR sets with 4 questions each), every one labelled “Original practice”. QA and DI
  answers are independently recomputed in `server/test/content-answers.test.ts`.
- The seeded CAT exam pattern (section order, timing, marking) is marked **unverified**. An admin
  should check it against the official notification for the exam year (Admin → Exam pattern).
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

## Tests

```bash
npm test -w server        # 124 unit + API integration tests; resets cat100_test each run
npm test -w web           # markdown/KaTeX unit tests
npm run e2e               # builds web, then Playwright; resets cat100_e2e and starts its own server on :4100
```

Playwright uses `CHROMIUM_PATH` if set, else `/opt/pw-browsers/chromium` if present, else its own
browser (`npx playwright install chromium`).

## Importing questions (including PYQs)

Admin → Import accepts a JSON file or pasted JSON: `{ "items": [...] }` where each item is a
`question`, `passage` or `dilr_set`. Always run **Validate (dry run)** first. The validator checks
schema, duplicate IDs and duplicate question text (in the file and the database), missing answers or
solutions, MCQ options and answer keys, TITA answer format, year/slot rules, provenance for PYQs,
image references and passage/set links. The full schema is `server/src/modules/admin/importSchema.ts`;
an annotated example is shown on the import page.

Rules enforced by both the importer and database constraints:

- Only `origin: "authentic_pyq"` may carry `examYear`/`examSlot`; PYQs require both a year and at
  least one source with a reference (paper, slot, question number).
- Imported PYQs start with an unverified source and cannot be published until an admin marks the
  source verified (Admin → Questions → question → Verification).
- Every edit creates a version snapshot and an audit-log entry; changing the stem, options, answer
  or solution resets solution verification.

## How the learning engine works

Formulas and thresholds for mastery, recommendations, spaced revision, the error log, the planner,
mock classification and strategy drills are documented in [docs/MASTERY.md](docs/MASTERY.md) and
shown in the app at /help/mastery. The REST API is listed in [docs/API.md](docs/API.md).

## Security notes

- Passwords: scrypt (N=2^15, r=8, p=1, 16-byte salt). Sessions: 32-byte random token, only its
  SHA-256 is stored; 14-day expiry; reset tokens are single-use, hashed, valid for one hour, and a
  reset signs out every session.
- Every state-changing request from a signed-in browser must carry the `x-csrf-token` header that
  matches the session (credential endpoints are exempt so a signed-in browser can switch accounts).
- All learner data queries are scoped by the session's user id on the server (tests cover
  cross-user access to attempts, notes, errors, lessons, plans, mocks, tutor sessions and revision).
- Rate limits on auth endpoints and the API; helmet headers; CORS restricted to `CORS_ORIGIN`.
- Uploads: admin only, PNG/JPEG/WebP by magic bytes, ≤ 2 MB, random file names.
- Secrets (database URL, `ANTHROPIC_API_KEY`) are read from the server environment only and never
  sent to the browser.
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

- No authentic PYQs or real CAT papers are included (see above); PYQ modes and year-wise papers are
  empty until an admin imports verified questions.
- The sample bank is small (65 questions), so lessons for many topics have no practice questions and
  say so; worked examples are drawn from existing questions, and topic concept notes are outlines.
- Email uses a log transport: password-reset links are written to the server log. Plug a provider
  into `server/src/lib/mailer.ts` for production.
- AI-generated practice questions are not implemented; the `ai_generated` origin exists in the schema
  and is labelled in the UI, but nothing generates them yet.
- The AI tutor (when enabled) can be wrong; replies show their grounding sources and provider.
- Calculation-gym results are only stored as study time, not per item.
- The web bundle is a single ~760 KB chunk (KaTeX and markdown included); no code splitting yet.
