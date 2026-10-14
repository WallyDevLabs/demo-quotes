# Deploying

This is a runbook, not a record: **nothing has been deployed yet.** It needs two decisions from you first (the hosting provider and the database region), and it contains steps that only you can do (accounts, secrets, DNS). Items I could not verify from your machine are marked **untested**.

## Decide first
1. **Provider and region.** Recommended: Vercel for the app and a managed Postgres in an **EU region** (Frankfurt or Ireland), or Cape Town if your database provider offers it. Supabase and Neon both qualify. POPIA allows hosting abroad under conditions (section 72); confirm with the Information Regulator, add a short privacy notice for clients, and check whether you must register as your own information officer. Not legal advice.
2. Write the provider and region into the README ("Hosting and POPIA") before real client data goes in.

## Steps
1. **Create the database on Supabase** (New project). Pick the region closest to you; Supabase offers Cape Town (`af-south-1`) and Frankfurt/Ireland. Set a strong database password. Supabase hosts only the database here; the app itself runs on Vercel.
   - **Connection string:** Vercel runs on IPv4 and Supabase's direct host (`db.<ref>.supabase.co`) is IPv6 only, so use the **Session pooler** string (Connect, "Session pooler", host `...pooler.supabase.com`, port **5432**). Session mode keeps the transactions that lock the number counters behaving exactly as in the tests. Append `?connection_limit=3`: one connection would make queries that should run side by side (the dashboard runs three) wait in a queue, and three per serverless instance is well inside the pooler's limit for one user. The Transaction pooler (port 6543, needs `?pgbouncer=true`) is **untested** here; do not use it for migrations.
   - **Row level security:** the migration `lock_down_data_api` switches RLS on for every table with no policies and revokes the Data API roles, so the anon key can read nothing. This app never uses Supabase's API or client libraries. After any future migration that adds a table, check Supabase's Table Editor / Security Advisor: it must show RLS enabled on every table (re-run the loop in that migration if not). Never put the Supabase anon or service keys in this app.
   - Disable the Data API (Project Settings, Data API) as a second layer if you do not need it.
2. **Create the Vercel project** from the repository. `vercel.json` already sets the build to `npm run build:vercel`, which runs `prisma generate`, then `prisma migrate deploy`, then `next build`. A failed migration fails the build before any traffic reaches it.
3. **Set the environment variables** in Vercel (Production), none of them committed anywhere:
   - `DATABASE_URL`: the connection string from step 1.
   - `AUTH_SECRET`: `openssl rand -base64 32`, different from your local one. Changing it later signs everyone out and breaks stored authenticator secrets.
   - `SETUP_TOKEN`: a long random string. Without it, setup is switched off in production.
4. **Turn off Vercel Authentication for production** (Project Settings, Deployment Protection, set it to "Only Preview Deployments" or switch it off for Production). While it is on, Vercel answers every request, including `/manifest.webmanifest`, `/sw.js` and the icons, with a redirect to its own sign-in. A phone then cannot read the manifest and will not offer "Install app" or "Add to Home Screen". The app has its own sign-in, so this protection is not needed. Check afterwards: `curl -I https://<your-domain>/manifest.webmanifest` must return `200`, not `302`.
5. **Match the function region to the database region** (Project Settings, Functions), so every request is not crossing continents. **Untested.**
6. **Deploy**, then open the site over HTTPS. You should land on the setup page. Create your account with the setup token, turn on two-factor, and **save the recovery codes**.
7. **Remove `SETUP_TOKEN`** from Vercel once your account exists (setup is one-time anyway).
8. **Switch on backups**: Supabase's paid plans include daily backups (the free plan does not), so on the free plan rely on `npm run backup` run regularly. Then test one restore (below).
9. **Smoke test on the live site**: sign out and back in (PIN on this device; password and code on a second browser), add your business details and rates, make a throwaway estimate, send a quotation to yourself, download the PDF, then delete nothing you want to keep (sent documents cannot be deleted by design).

## Backups: the test that must happen before launch
The local restore test proved the backup and restore *procedure* and the integrity checks. The same must be proven on the hosted database:
1. Enable the provider's daily backups and note the retention.
2. Take a manual dump: with `pg_dump` installed, `DATABASE_URL=<hosted url> npm run backup` writes it to `./backups`.
3. Restore it into a scratch database on the provider (or locally) and run the checks: `npm run backup:verify` compares a dump against the database named in `DATABASE_URL`, so for a hosted check point a scratch copy at it and compare, or restore and inspect a recent invoice, the dashboard and one stored PDF.
4. Write the date and result in the README (Backups).
Financial records must be kept for the period tax law requires: **verify that period with SARS or an accountant** and set the backup retention to match.

## Merge protection (GitHub)
CI already runs the type check, schema validation, 300+ unit and integration tests, a production build and the end-to-end test on every push. "Merging is blocked when they fail" is a repository setting. Once the repository is on GitHub with the CI workflow, require the `test` check on `main`:

```bash
gh api -X PUT repos/<owner>/<repo>/branches/main/protection \
  -f "required_status_checks[strict]=true" \
  -f "required_status_checks[contexts][]=test" \
  -F "enforce_admins=true" \
  -F "required_pull_request_reviews=null" \
  -F "restrictions=null"
```
(or Settings, Branches, Add rule, "Require status checks to pass".) **Untested here:** there is no GitHub remote yet.

## After launch
- Watch the audit log (Audit log in the app) for unexpected sign-ins.
- Rotate `AUTH_SECRET` only deliberately (everyone signs out and you re-enrol two-factor).
- Run `npm run backup` periodically and keep the file somewhere encrypted that you control.
- Keep Node, Next.js and Prisma patched.
