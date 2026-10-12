# Email and password reset

CAT 100 sends two emails: the password-reset link, and a notice after a password changes. Both go
through one provider chosen by environment variables on the server. Credentials never reach the
browser.

## Providers

| `EMAIL_PROVIDER` | Use | Delivers to inboxes |
|---|---|---|
| `log` (default outside tests) | Development. Writes the whole message, link included, to the server log. **Refuses to send when `NODE_ENV=production`**, so links never land in production logs. | no |
| `smtp` | Production. Any SMTP service. | yes |
| `memory` | Automated tests only. The server will not start with it in production. | no |

## Production setup (SMTP)

| Variable | Required | Notes |
|---|---|---|
| `EMAIL_PROVIDER` | yes | `smtp` |
| `SMTP_HOST` | yes | The server will not start with `smtp` and no host. |
| `SMTP_PORT` | no | Default `587` |
| `SMTP_SECURE` | no | `true` for TLS from the first byte (usually port 465); default `false` uses STARTTLS on 587 |
| `SMTP_REQUIRE_TLS` | no | Default `true`: refuse to send over an unencrypted connection |
| `SMTP_USER`, `SMTP_PASSWORD` | usually | From your provider. Keep them in the host's secret settings, never in the repository. |
| `EMAIL_FROM` | yes | For example `CAT 100 <no-reply@your-domain.example>`. Use a domain you have verified with the provider (SPF and DKIM), or mail lands in spam. |
| `APP_URL` | yes, unless on Render | Public address used to build the reset link |
| `PASSWORD_RESET_TTL_MIN` | no | Link lifetime in minutes, default 60 |
| `PASSWORD_RESET_MAX_PER_HOUR` | no | Reset emails per account per hour, default 3 |

Common SMTP endpoints (check your provider's current documentation for the exact host and
credentials): Amazon SES `email-smtp.<region>.amazonaws.com`, Postmark `smtp.postmarkapp.com`,
SendGrid `smtp.sendgrid.net` (user `apikey`), Mailgun `smtp.mailgun.org`, Brevo
`smtp-relay.brevo.com`, all on port 587 with STARTTLS.

On Render, add these under the service's **Environment** settings and redeploy. Then open
Admin → **Email**: it should say the provider is configured. Click **Send a test email to me** and
check the inbox. The page shows the provider's exact error if it refuses the message.

## Delivery status

Every send is recorded in `email_deliveries` with its purpose, provider, outcome (sent, failed,
or held back by the per-account limit), the provider's message id and a cleaned error message. The
message body and link are never stored. Admin → Email shows the last 24 hours and the most recent
success and failure. Until a provider is configured, production reset requests are recorded as
failed with "No email provider is configured", and the admin overview shows a warning.

## How reset links are protected

- The token is 32 random bytes. Only its SHA-256 is stored; the raw token exists only in the email.
- A link works once, expires after `PASSWORD_RESET_TTL_MIN`, and is revoked when a newer link is
  requested, when the password changes, or when the email could not be delivered. A successful
  reset signs the account out everywhere and sends a notice.
- The forgot-password response is identical, and returned before any lookup or sending happens,
  whether or not the account exists and whether or not delivery succeeds.
- Limits: 5 reset requests per 15 minutes per IP address, and `PASSWORD_RESET_MAX_PER_HOUR` emails
  per account.
- Request logs redact `token`, `reset_token` and `code` query parameters; provider errors are
  stripped of links before they are logged or stored.

`server/test/email.test.ts` covers delivery through a local SMTP test server (including
authentication), refused recipients, a slow server, expired, reused, revoked and invalid tokens,
both rate limits, the production refusal of the log provider, log redaction, startup checks and the
admin status page.
