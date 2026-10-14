# Deploying CAT 100

CAT 100 runs as one container that serves both the API and the web app, plus a PostgreSQL
database. On every start the container applies pending migrations, seeds the syllabus and the
sample questions into an empty database, creates the admin account from `SEED_ADMIN_EMAIL` and
`SEED_ADMIN_PASSWORD` if it does not exist yet, and then starts serving. Restarts never re-seed
or touch learner data.

## Option A: Render (Blueprint)

`render.yaml` defines a PostgreSQL database and a Docker web service.

1. Merge the pull request into `main`, or pick the branch in step 3.
2. In Render, choose **New → Blueprint** and connect the GitHub repository.
3. Render reads `render.yaml`. When it asks, enter `SEED_ADMIN_EMAIL` and a long
   `SEED_ADMIN_PASSWORD` for your admin account.
4. Apply. The first deploy builds the image, then creates the tables and seeds content. When
   `/api/health` answers, the service is live at its `onrender.com` address.
5. Sign in with the admin account and open **Content admin**.

Password-reset links use `APP_URL`. On Render it defaults to the service's public address
(`RENDER_EXTERNAL_URL`). Set `APP_URL` yourself if you add a custom domain.

The Blueprint uses the smallest plans. Check Render's current limits for free services and
databases (sleeping, storage and expiry) before inviting real learners.

## Option B: any Docker host

```bash
docker build -t cat100 .
docker run -d -p 4000:4000 \
  -e DATABASE_URL='postgres://USER:PASSWORD@HOST:5432/cat100' \
  -e APP_URL='https://your-domain.example' \
  -e COOKIE_SECURE=true \
  -e SEED_ADMIN_EMAIL='you@example.com' -e SEED_ADMIN_PASSWORD='a long admin password' \
  -v cat100-uploads:/app/server/uploads \
  cat100
```

Put it behind HTTPS (a reverse proxy or your platform's TLS). If your database provider requires
TLS, add `?sslmode=require` to `DATABASE_URL`.

## Environment variables

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL 14+ connection string |
| `APP_URL` | yes, unless on Render | Public URL, used in password-reset links |
| `COOKIE_SECURE` | yes in production | `true` when served over HTTPS |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | first start | Creates the admin account if it is missing |
| `CORS_ORIGIN` | no | Only needed if the web app is served from a different origin |
| `EMAIL_PROVIDER`, `EMAIL_FROM`, `SMTP_*` | for password reset | `smtp` plus your provider's settings; see [EMAIL.md](EMAIL.md) |
| `PASSWORD_RESET_TTL_MIN`, `PASSWORD_RESET_MAX_PER_HOUR` | no | Defaults 60 minutes and 3 emails per account per hour |
| `AI_PROVIDER`, `ANTHROPIC_API_KEY` | no | Leave `AI_PROVIDER=none` for the offline tutor |
| `UPLOAD_DIR` | no | Defaults to `/app/server/uploads` in the image |

## Before inviting real learners

- **Connect an email provider.** Without `EMAIL_PROVIDER=smtp` and its settings, reset emails are
  not sent in production (the link or token is never logged), and Admin → Email shows "not
  configured". Follow [EMAIL.md](EMAIL.md), then send a test email from Admin → Email.
- **Uploaded diagrams** are stored on the container's disk. Attach a persistent disk or volume at
  `/app/server/uploads`, or they are lost when the container is replaced.
- **Backups:** turn on your database provider's automatic backups. The README covers `pg_dump`.
- **Content:** the bank has 65 original practice questions and no verified CAT PYQs
  ([PYQ-SOURCES.md](PYQ-SOURCES.md)), and the seeded CAT 2024 exam pattern is unverified
  ([EXAM-PATTERN.md](EXAM-PATTERN.md)).
- **Upgrading an existing deployment:** migration 003 runs on start. Any question already stored
  as an authentic PYQ is unpublished and sent to the review queue, because approval now also
  checks its answer key. Learner data is not changed.
