# Architecture (aligned to PRD v2)

Source of truth: [requirements-v2.pdf](requirements-v2.pdf). This file records how the code realises it. Where the two disagree, the PRD wins and this file is wrong.

## Stack
Next.js App Router + strict TypeScript, PostgreSQL + Prisma (committed migrations), Zod shared by forms and server actions, integer cents + decimal.js, Auth.js with one owner and a required second factor, React PDF on the server with stored PDFs, Tailwind (+ shadcn/ui from milestone 2), Vitest + fast-check, Playwright for the core flow, Vercel for the app.

## Layers
```
src/domain/    pure functions, import nothing from the other layers          (milestone 1: done)
  money.ts       integer cents, half-up rounding, decimal helpers
  dates.ts       calendar dates, Africa/Johannesburg "today" (clock passed in)
  pricing/       Zod schema (EST9) + calculateEstimate for both methods
  milestones.ts  percentages total 100, largest remainder split
  status.ts      derived invoice status and quotation expiry
  transitions.ts allowed state moves, cancellation rules
  numbering.ts   QUO{YYYY}{SEQ:4} patterns, counters only rise
src/server/    services + repositories; the ONLY layer that touches Prisma/transactions
src/app/       pages, components, server actions (validate with Zod, call a service)
```
Components never contain formulas.

## Pricing (implemented in `src/domain/pricing`)
- **Method A (time):** labour = Σ round(hours × rate). Urgency = urgency% × labour, only if the urgent flag is on. Contingency = contingency% × labour (before urgency). Once-off expenses = round(cost × (1 + markup%)). Subtotal = sum. Discount (percent or fixed) off the subtotal, never above it. Total = subtotal − discount. **No complexity, no margin, no tax line.**
- **Method B (fixed):** deliverable price × complexity multiplier (seeded 1.00) per deliverable, rounded once; then the same steps with the adjusted deliverable total as the base. Estimated hours are internal.
- **Internal check (both):** effective hourly rate = (total − billed once-off expenses) ÷ estimated hours, with a warning below the configured minimum.
- Recurring expense lines are listed separately and never enter the total.
- Rounding: half up, once per line and once per percentage step; totals are sums of rounded parts.
- Worked example (a test fixture): R29 000 labour + R5 800 urgency + R2 900 contingency + R1 320 hosting = R39 020; 5% discount R1 951 → **R37 069.00**; effective rate R714.98.

## Document integrity (milestones 3 to 5)
Snapshots at send/issue; gap-free numbers from a locked counter row in the issuing transaction; immutability in the service layer **and** a database trigger on financial columns; invoicing ceiling checked transactionally; append-only payments with reversal rows; PDFs generated once, stored, hashed and served unchanged; VAT mode `NONE` snapshot with render tests that forbid "Tax Invoice" or any VAT figure. The schema (`prisma/schema.prisma`) already carries the columns these need; triggers and locking land with their milestones, tested against a real Postgres.

## PWA
The app is installable (manifest, icons, service worker). When offline it shows a friendly offline page; **the service worker caches no pages or data**, so nothing personal is left on a device after signing out (version 1 of the worker cached pages and was replaced for this reason). **Offline data entry is not planned for the MVP:** gap-free numbering at issue, immutability triggers and stored server-side PDFs all require the server, and PRD v2 does not list offline use. Offline drafts could be reconsidered after launch.

## Milestones (PRD v2)
1. Foundation and pricing engine, CI, schema, migrations, status and milestone functions: **done**.
2. Settings and estimates (first-run setup, clients and projects, estimate screens, live summary, explain controls): **done**. Interface totals are produced by the same domain engine the server runs on save; integration tests save and reload the PRD worked example (R37,069.00) through a real Postgres.
3. Quotations (snapshot, states, numbering at send, schedule, stored PDF): **done**. Gate met: 20 concurrent sends give 20 unique consecutive numbers, a failed send consumes none, and a sent quotation cannot be edited in the service or the database.
4. Invoices and payments: **done**. Gate met: over-invoicing and overpayment are rejected (including simultaneous attempts), a milestone is invoiced once, and immutability is enforced in the database (invoices, lines, payments, stored PDFs).
5. Dashboard and hardening (VAT threshold monitor, 2FA login, audit log, backups): **done**. Gate met: a seeded dataset reproduces every dashboard definition (domain test, plus a test built from real records through the services), and a backup has been restored into a scratch database and verified (`npm run backup:verify`).
6. Launch on real work.

## Decisions made
- **Sole proprietor:** your own name is the legal name; trading name and registration number are optional.
- **ZAR and USD, no conversion:** one currency per document from estimate to payment; per-currency rates, minimum rate and banking details; the dashboard (milestone 5) reports each currency separately and never sums them. USD invoices carry an optional owner-entered "ZAR value at issue" used only by the VAT threshold monitor. Verify with SARS or an accountant how foreign-currency income counts toward the threshold.
- **Contingency and urgency stay separate lines** on quotations.
- **Hosting:** Vercel plus a managed Postgres in an EU region (or Cape Town if offered). POPIA section 72 conditions on cross-border transfer apply: confirm with the Information Regulator, add a client privacy notice, and decide whether you must register as your own information officer. Not legal advice.
- **Numbering:** editable patterns with `{YYYY} {YY} {SEQ:n} {PRJ} {CLIENT}` over one gap-free sequence.

- **Stored documents live in Postgres (bytea), not object storage.** They are private, backed up with the records, and a trigger makes stored PDFs immutable. This avoids a second storage service on Vercel (whose file system is ephemeral). It can move to object storage later behind `src/server/files.ts`.
- **Accepting a quotation moves its project to Active** (and sending moves a Lead to Quoted); both write audit entries.

- **A cancelled invoice frees its milestone** (partial unique index), and cancelling needs no *active* payments: a payment that was reversed no longer blocks it. Both rows stay visible.
- **A milestone invoice is one line** for the milestone amount (which already includes any quotation discount), so milestone invoices add up to the accepted total exactly. Custom invoices carry their own lines and a stated reason and count against the same ceiling.

## Milestone 5 decisions
- **Authentication is built directly rather than with Auth.js.** The PRD names Auth.js, whose v5 is still a beta and whose credentials provider has no clean multi-step second factor. The pieces here are small, standard and fully tested: scrypt password hashes, RFC 6238 TOTP (checked against the RFC vectors) with replay protection, signed `jose` session cookies (verified at the edge, then re-checked against the database on every action and route), database-backed rate limiting, single-use hashed recovery codes. Swapping to Auth.js later would touch `src/server/auth` and the middleware only.
- **Setup claims existing data.** The placeholder owner that held data before sign-in existed is claimed by the first account created, so nothing is lost. In production setup needs `SETUP_TOKEN`.
- **Trusted devices and the PIN.** A browser that passed password + code once gets a random device secret in an httpOnly cookie (only its SHA-256 is stored, 90 day sliding expiry). That browser signs in with a scrypt-hashed 4 digit PIN; the PIN is worthless without the cookie, each attempt is reserved atomically before it is checked, and the fifth wrong PIN deletes the device. Sessions started on a trusted device last 30 days, others 12 hours. Password change and sign out everywhere delete all devices. Code: `src/server/auth/pin.ts`, tests in `tests/server/pin.test.ts`.
- **Two-factor is required**: a correct password without it earns only a restricted session that can reach nothing but the authenticator page. The restricted session is replaced only after the owner has seen their recovery codes.
- **Edge middleware never redirects a signed-in visitor away from `/login` or `/setup`.** It cannot see the database, so a revoked session would loop; those pages decide for themselves.
- **Dashboard figures are pure functions** (`src/domain/dashboard.ts`); the page, the tests and the on-screen definitions all use them.
- **Backups:** the database host's automated backups are the main safety net; `npm run backup` is a second copy and `npm run backup:verify` is the restore test. A restore on the chosen host must still be tested before launch (milestone 6).
- **Tests use a separate database** (`TEST_DATABASE_URL`, name ending `_test`) because the auth tests create and delete real owners.
- **Production security headers** include a strict Content Security Policy, HSTS and a permissions policy.

## Still open
Weekly hours available (for milestone dates), and the hosting provider and region to record in the README.

## Deviations from the PRD
- The interface uses small hand-written Tailwind components instead of shadcn/ui. The behaviour (accessible controls, themes) is the same, and shadcn can replace them later without touching domain or services.
- Local development uses `embedded-postgres` (`npm run db:local`) so Docker is optional. It is a dev-only dependency.
