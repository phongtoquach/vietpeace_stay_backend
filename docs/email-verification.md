# Customer Web email verification

## Environment configuration

Add these values to the local `.env` (never commit SMTP credentials):

```dotenv
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASSWORD=
MAIL_FROM=
CUSTOMER_WEB_VERIFY_URL=http://localhost:5178/verify-email
```

Use actual provider settings, not the example host. Port 587 requires STARTTLS; for implicit TLS on port 465 set SMTP_SECURE=true. SMTP_USER and SMTP_PASSWORD must be supplied together if authentication is required. Production Customer Web URL must use HTTPS. Nodemailer is declared in package.json; run npm install in a fresh checkout. Restart backend after changing environment variables.

The sender checks SMTP acceptance, not final inbox delivery. Missing configuration, token persistence failure, or SMTP failure never returns `emailSent: true`. Account creation is preserved with status 0. No token/password/SMTP error details are returned or logged by the new code.

## Registration

Existing endpoint: POST /api/web/auth/register. Existing fields, duplicate lookup, bcrypt cost 12, user INSERT and CUSTOMER/status 0 are preserved.
After INSERT, generate 32 random bytes, encode as hex, store SHA-256 hex in dbo.email_verification_tokens.token_hash (CHAR(150)). Parameterized SQL explicitly sets created_at and expires_at in UTC with a 24-hour lifetime.

HTTP 201 means account creation succeeded. Response additionally includes:

```json
{"verification":{"required":true,"emailSent":true}}
```

On mail/token failure it remains 201 with emailSent=false and a message explaining that the account exists but has not been activated. The frontend must display the returned message/delivery state rather than claim that mail was sent. Re-registering the same email returns 409; an automatic resend/recovery endpoint is outside this change and is not implemented. Pending users after a delivery failure need a future recovery flow; no existing user is modified by these development checks.

## Verification

POST /api/web/auth/verify-email

```json
{"token":"raw 64-character lowercase hexadecimal token from email"}
```

- 200: success=true, account activated; frontend may navigate to login.
- 400: invalid, missing, expired, used, revoked token, changed email, or ineligible account.
- 500: safe generic system error.

Email opens CUSTOMER_WEB_VERIFY_URL with `#token=...` to keep secrets out of normal request URLs/referrers. The Customer Web page must read the fragment and POST the token. This backend-only task does not create/change that frontend page. A confirmation button avoids automatic consumption by email scanners.

The transaction locks the pending CUSTOMER user with UPDLOCK/HOLDLOCK, checks/consumes the matching valid token, then updates status to 1. Both writes commit together; activation failure rolls back token consumption. ADMIN users and status 1/2 users cannot be activated. No schema migration is needed. Existing login service already rejects status 0 and 2 and accepts status 1 with valid credentials and CUSTOMER role; login/Admin behavior was not changed.

## Verification performed

Run `node --test test/user_web_service.test.js test/email_verification.test.js`.
Tests use mocked SQL Server and SMTP, with real crypto and bcrypt. No account was created, no real email was sent. Mock tests do not establish real SQL Server concurrency or delivery behavior. Database metadata reads are separate from tests.
Git conflicts and existing team edits are preserved. No commit/push/merge was performed.
