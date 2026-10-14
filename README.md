# CodeQuote: Pricing and Invoicing Tool

A pricing, quoting and invoicing tool for one freelance developer invoicing in South African rand and US dollars. Requirements: [docs/requirements-v2.pdf](docs/requirements-v2.pdf). Design: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and `docs/design/`.

| | |
|---|---|
| **Live app** | https://code-quotes-src.vercel.app/ |
| **Source** | https://github.com/WallyDevLab/code-quotes (branch `main`) |
| **Hosting** | Vercel (app) and Supabase Postgres, West EU (Ireland) |
| **Stack** | Next.js 15 (App Router), TypeScript, Prisma, PostgreSQL, Tailwind, Zod, decimal.js, React PDF, Vitest, Playwright |

It is installable on a phone or desktop (PWA) and works on any screen width: a burger menu on phones, a sidebar on larger screens.

## Limits you should know
- **ZAR and USD only, with no conversion.** Each document is in one currency from estimate to payment. Rates, minimum rate and banking details are set per currency. Figures are never added across currencies.
- **VAT is off by default and invisible.** The schema carries VAT fields for phase two. Documents are titled "Invoice" and show no VAT line or number. A threshold monitor warns before registration could become compulsory.
- **Not accounting software:** no ledger, no tax returns. It reports what was invoiced and what was received.
- **One owner.** No roles, teams or client logins.

## Status
Milestones 1 to 6 of 6 are built:
1. Pure domain layer (pricing, money, status, transitions, milestones, numbering).
2. Settings, clients, projects and estimates (both pricing methods) with the live summary panel, explain controls, internal and client views, and light and dark themes.
3. Quotations: created from a ready estimate, sent with a gap-free number and a stored PDF, then frozen (service and database).
4. Invoices and payments: several invoices per accepted quotation up to its accepted value, append-only payments with reversal, derived paid/partially paid/overdue, stored PDFs.
5. Dashboard and hardening: the dashboard figures, VAT threshold monitor, sign-in with a required second factor, audit log view, and backups with a tested restore.

6. Launch preparation: the end-to-end test (a real browser through the whole flow), client balances and project agreed price, "Show working" pages for hand checking, a deployment runbook, and a requirement-by-requirement acceptance matrix.
7. After launch: PIN sign-in on trusted devices, a mobile layout with a burger menu, and the live deployment.

**Deployed** at https://code-quotes-src.vercel.app/ (Vercel, with the database on Supabase). **What is left is yours to do, and is listed honestly in [docs/MVP-ACCEPTANCE.md](docs/MVP-ACCEPTANCE.md):** test a restore on the hosted database, require CI on `main`, take one real enquiry through to a payment, hand check your first three real quotations ([docs/HAND-CHECK.md](docs/HAND-CHECK.md)), and confirm the tax and privacy items with SARS or an accountant.

## Signing in
You create the one owner account the first time you open the app (`/setup`), then turn on two-factor authentication with an authenticator app. After that every page, action, PDF and file needs a signed-in session.

- **Passwords** are hashed with scrypt. At least 12 characters.
- **Two-factor is required.** Standard time-based codes (RFC 6238). The authenticator secret is encrypted in the database. A code can be used once. Eight single-use recovery codes are shown once at setup; you can generate new ones from the Account page.
- **Trusted devices and a PIN.** The authenticator code is asked for only on a new device. After you sign in with password and code and tick "Trust this device", that browser signs in with your 4 digit PIN alone and stays signed in for 30 days. The PIN works only together with the device's cookie, and five wrong PINs remove the device. Changing the password or "Sign out everywhere" untrusts every other device; you can remove devices on the Account page. Untick "Trust this device" on a shared computer.
- **Sessions** are signed, `httpOnly`, `SameSite=Lax` and (in production) `Secure` with the `__Host-` prefix. They last 12 hours, or 30 days on a trusted device. "Sign out everywhere" and changing your password end every other session at once.
- **Login is rate limited** per account and per address, in the database, so it holds on serverless hosting. The error never says whether the email, password or code was wrong.
- **Setup is one-time.** If you already have data from before sign-in existed, creating the account claims it, so nothing is lost. In production, setup needs a `SETUP_TOKEN` you set on the server, so nobody else can claim a freshly deployed app first.
- The service worker never caches pages or data, so nothing personal stays on a device after you sign out. The app needs a connection; offline you see a short "You are offline" page.

## Installing on a phone (PWA)
Open https://code-quotes-src.vercel.app/ in Chrome (Android) or Safari (iPhone), then choose "Install app" or "Add to Home Screen". This only works while **Vercel Authentication (Deployment Protection) is off for Production**: while it is on, Vercel redirects the manifest, service worker and icons to its own sign-in and phones will not offer installation. Check with `curl -I https://code-quotes-src.vercel.app/manifest.webmanifest`, which must return `200`.

## Documents
- A quotation gets its number, issue and expiry dates, business and client snapshot, and PDF **in one database transaction** when it is sent. If anything fails, nothing is consumed.
- After sending, the quotation, its lines, its milestones and its PDF cannot change: the service refuses, and so does Postgres.
- Every PDF download serves the file stored at send time, byte for byte (the `ETag` is its SHA-256). Changing settings, rates, the client or the template never alters an old document.
- **Invoices work the same way.** Issuing allocates the number, sets the due date, snapshots your business, client and banking details, stores the PDF and freezes the record. An issued invoice cannot be edited or deleted; it can be cancelled with a reason while it has no active payments.
- **Payments are append only.** A mistaken payment is reversed with a reason: a new row is added, both stay visible, and the balance is restored. The database itself refuses overpayment, payments on drafts or cancelled invoices, and any change to a payment.
- **The invoicing ceiling** (non-cancelled invoices of a quotation never exceed its accepted total) is enforced in the service and by a database trigger that locks the quotation. A milestone is invoiced once; cancelling its invoice frees it.
- An invoice's stored PDF shows the balance at the moment of issue. The on-screen invoice shows the live amount paid and balance.
- PDFs and the logo are stored in Postgres, so they are private and covered by the same backups as your records.

## Dashboard
Each figure has one definition, shown beside it, and each currency is reported on its own.

| Figure | Definition |
|---|---|
| Quoted | Sum of totals of quotations that are sent and not expired |
| Confirmed | Sum of totals of accepted quotations |
| Invoiced | Sum of totals of issued invoices, excluding cancelled ones (billed, not paid) |
| Received | Sum of payments, excluding reversed ones |
| Outstanding | Invoiced minus received, on issued invoices |
| Overdue | Outstanding amount on invoices whose due date has passed (due today is not overdue) |
| Upcoming | Issued invoices with a balance due inside the window (default 14 days, set in Settings) |
| VAT threshold monitor | Invoiced total for the trailing twelve months against the threshold you enter, warning at a configurable share (default 80%) |

The VAT threshold is entered by you and must be verified with SARS. USD invoices count at the rand value you enter when issuing them. It is an early warning only: the legal test also looks forward over the next twelve months.

## Setup
Requires Node 22 and a PostgreSQL database.

```bash
npm install
cp .env.example .env    # then set AUTH_SECRET (openssl rand -base64 32)
npm run db:local        # leave running: a local Postgres on port 54329, no Docker needed
npm run db:deploy       # in another terminal: apply migrations
npm run dev
```
Open http://localhost:3000 and create your account. Prefer Docker? `docker compose up -d` also listens on 54329, so `.env` needs no change (do not run it together with `npm run db:local`). Any hosted Postgres works too: put its connection string in `.env`. Deploying the live app is covered in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) and summarised below.

### Deployed setup (Vercel and Supabase)
- **Deploys:** pushing to `main` on GitHub builds on Vercel with `npm run build:vercel` (`prisma generate`, `prisma migrate deploy`, `next build`). A failed migration fails the build before any traffic reaches it.
- **Database:** Supabase Postgres, connected through the **Session pooler** (port 5432) with `?connection_limit=3` (not 1: that would queue parallel queries). A password with symbols must be URL-encoded in `DATABASE_URL`; an alphanumeric one avoids the problem.
- **Row level security:** the migration `lock_down_data_api` switches it on for every table with no policies and revokes the Supabase Data API roles, so the anon key reads nothing. The app talks to Postgres directly and never uses Supabase's API or keys. After adding a table in a future migration, confirm in Supabase's Security Advisor that it also has row level security.
- **Vercel project settings:** framework Next.js, Root Directory empty (the app is at the repository root), function region matching the database, and Deployment Protection off for Production (see Installing on a phone).
- **First run:** open `/setup` with the `SETUP_TOKEN`, turn on two-factor, save the recovery codes, choose a PIN, then delete `SETUP_TOKEN` from Vercel.

### Environment variables
Listed in `.env.example`, without values.

| Variable | Needed | Purpose |
|---|---|---|
| `DATABASE_URL` | always | PostgreSQL connection string (on Vercel: the Supabase Session pooler string) |
| `AUTH_SECRET` | always | Signs sessions and encrypts the authenticator secret. 32+ random characters, different per deployment. Changing it signs everyone out and means re-enrolling two-factor |
| `SETUP_TOKEN` | production | Required on the first-run page so only you can create the account. Remove it afterwards |
| `TEST_DATABASE_URL` | tests | A separate database whose name ends in `_test` (`npm run test:db` creates it) |
| `E2E_DATABASE_URL` | end-to-end test | A separate database whose name ends in `_e2e` (`npm run e2e:db` creates it). It is wiped before every run |
| `NEXT_DIST_DIR` | optional | Build output folder. `npm run e2e` sets it to `.next-e2e` so it never overwrites a running `next dev`. Leave unset otherwise |

## Scripts
- `npm run dev`: development server (the service worker only registers in production builds)
- `npm run build` / `npm start`
- `npm test`: domain tests plus integration tests, against `TEST_DATABASE_URL` when set. The auth tests create and delete real owners and refuse to run unless the database name ends in `_test` (or `CI` is set)
- `npm run test:db`: create the test database and apply migrations to it
- `npm run typecheck`
- `npm run e2e`: the end-to-end test. Builds the production app (into `.next-e2e`), starts it on its own `_e2e` database (wiped each run) and drives Chrome through setup, two-factor, PIN, settings, client, project, estimate, quotation (sent and accepted), deposit invoice, payment, dashboard, PDFs, a 360px phone pass over every page (no page may be wider than the screen; burger menu and theme button), PIN sign-in, a new device, and the five-wrong-PINs lockout. Needs Chrome installed and `E2E_DATABASE_URL` in `.env`
- `npm run db:local`: local Postgres without Docker
- `npm run db:migrate`: create a migration after editing `prisma/schema.prisma`
- `npm run db:deploy`: apply committed migrations
- `npm run backup`: dump the database to `./backups` (keeps the newest 14)
- `npm run backup:verify`: restore the latest backup into a scratch database and prove it matches (see Backups)

## Numbering
Patterns are editable in Settings, for example `QUO{YYYY}{SEQ:4}` or `INV-{PRJ}-{SEQ:3}`. `{PRJ}` and `{CLIENT}` use the short codes you set on a project or client. There is always one gap-free sequence, however the pattern reads. A counter can be raised but never lowered.

## Hosting and POPIA
Client details are personal information under POPIA and you are the responsible party. The hosting provider and database region are recorded here; the cross-border rules for storing personal information outside South Africa still need confirming.

- Hosting provider: Vercel (the app) and Supabase (the Postgres database, including stored PDFs and logos)
- Database region: West EU (Ireland), `eu-west-1`, recorded 14 October 2026
- Vercel function region: _confirm it matches the database (Dublin `dub1` or Frankfurt `fra1`)_
- Still to confirm: the cross-border rules for storing personal information outside South Africa (POPIA section 72) and whether you must register as your own information officer.

Logs never contain client names, emails or amounts, and the audit log holds field names, ids and statuses only.

## Backups
Two layers, because records that are the business need both:

1. **Your database host's automated daily backups.** Supabase includes daily backups on its paid plans only, so on the free plan layer 2 is your only copy. Test one restore on the hosted database (**not yet done**; last recorded restore test: none on the hosted database). This is the main safety net.
2. **`npm run backup`**, a second copy you hold yourself. It writes a compressed dump to `./backups` with a SHA-256 checksum. The dump contains personal information: keep it somewhere encrypted that you control, never in a shared folder or an email.

**`npm run backup:verify` is the restore test.** An untested backup does not count, so it restores the dump into a scratch database and checks that every table matches the live database row for row (by fingerprint), every stored PDF still matches its recorded SHA-256, the immutability triggers came back and still refuse edits, and the migration history is intact. It exits with an error if anything differs. Run it while the app is idle. It was run for this milestone against the local database: 20 tables and over 11,000 rows, identical.

To restore for real: create an empty database, then `pg_restore --no-owner -d <new database url> <backup file>`, point `DATABASE_URL` at it, and check the dashboard and a recent invoice.
