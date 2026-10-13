# MVP acceptance: requirement by requirement

Every requirement ID in [requirements-v2.pdf](requirements-v2.pdf), what implements it, and what proves it. "Test" names the file in `tests/`. Status is **Done** (built and tested), **Done, UI only** (built; behaviour proven through the end-to-end run or by hand rather than a unit test), **Phase two** (deliberately out of the MVP) or **Open** (needs something only you can do).

## Estimates
| ID | Requirement | Status | Where | Test |
|---|---|---|---|---|
| EST1 | Estimate belongs to a project; duplicate makes a new draft | Done | `server/estimates.ts` | services |
| EST2 | Switching method keeps shared lines and names the lines dropped | Done | `domain/pricing/draft.ts`, estimate editor | forms, e2e |
| EST3 | Labour lines: task, category, hours, rate from settings, override flagged | Done | draft model, editor | forms, services |
| EST4 | Add, edit, duplicate, reorder, remove lines | Done, UI only (order independence is property-tested) | estimate editor | pricing (properties) |
| EST5 | Expense lines: cost, markup, billed; once off or recurring; recurring excluded from total | Done | engine | pricing |
| EST6 | Fixed price lines: deliverable, price, internal hours | Done | engine | pricing |
| EST7 | Sticky summary, client facing and internal views | Done, UI only | estimate editor | e2e |
| EST8 | Explain control on every total | Done | engine `explanations`, editor, Show working | pricing, e2e |
| EST9 | Validation: hours and rates above zero, 0 to 100 percentages, discount not above subtotal; same Zod schemas on the server | Done | `domain/pricing/schema.ts` | pricing, forms, services |
| EST10 | No estimate until rates are configured | Done | `server/estimates.ts`, new-estimate redirect | services |

## Clients and projects
| ID | Requirement | Status | Where | Test |
|---|---|---|---|---|
| CLI1 | Client fields incl. optional VAT number (stored, unused) | Done | `domain/schemas.ts`, client form | forms |
| CLI2 | Profile lists projects, quotations, invoices, payments and outstanding balance; archived never deleted | Done (the balance and lists were added in milestone 6) | client page | scoped, services |
| PRJ1 | Project: name, client, description, status, deadline | Done | project form | forms, services |
| PRJ2 | Scope changes are new quotations; agreed price is the sum of accepted ones | Done (added in milestone 6) | project page, scoped dashboard | scoped |
| PRJ3 | Actual costs, profitability | Phase two | | |

## Quotations
| ID | Requirement | Status | Where | Test |
|---|---|---|---|---|
| QUO1 | Created from a ready estimate; whitelisted client-facing fields only; later edits never change it | Done | `domain/quotation.ts` | quotation (domain), quotations |
| QUO2 | States and allowed moves; only drafts editable; duplicate to change | Done | `domain/transitions.ts` | documents, quotations |
| QUO3 | Expiry derived; expired cannot be accepted | Done | `domain/status.ts` | documents, quotations |
| QUO4 | Number assigned at send, gap free | Done | `server/quotations.ts` | quotations (20 concurrent sends, rollback) |
| QUO5 | Contents: business and logo, client, scope, deliverables, exclusions, lines, schedule, timeline, revision policy, terms, acceptance, dates | Done | document model, PDF | quotation, pdf (real PDF text) |
| QUO6 | Milestones total exactly 100; largest remainder | Done | `domain/milestones.ts` | documents, quotation |
| QUO7 | PDF made at send, stored, served unchanged | Done | `server/pdf`, `/quotations/[id]/pdf` | quotations, pdf, e2e |
| QUO8 | Acceptance date and name; rejection reason | Done | `server/quotations.ts` | quotations |

## Invoices and payments
| ID | Requirement | Status | Where | Test |
|---|---|---|---|---|
| INV1 | From an accepted quotation by milestone, or custom with a reason | Done | `server/invoices.ts` | invoices |
| INV2 | Never above the accepted total, including simultaneous creation | Done (service and database trigger) | invoice trigger | invoices, invoicing |
| INV3 | Number at issue, gap free | Done | `server/invoices.ts` | invoices (20 concurrent issues) |
| INV4 | Contents: number, dates, parties, lines, discount, total, paid, balance, banking, payment reference; titled "Invoice", no VAT | Done | invoice document and PDF | invoicing, invoice-pdf |
| INV5 | Stored status draft, issued, cancelled; paid, partially paid, overdue derived | Done | `domain/status.ts` | documents, invoicing |
| INV6 | Issued invoice cannot be edited or deleted; cancel only with no payments, reason required | Done (service and database) | invoice trigger | invoices |
| INV7 | PDF at issue, stored | Done | `server/pdf/invoice-pdf.tsx` | invoice-pdf, e2e |
| PAY1 | Payment fields; label never changes a calculation | Done | `server/invoices.ts` | invoices |
| PAY2 | Partial payments; overpayment rejected; balance shown | Done (service and database) | payment trigger | invoices |
| PAY3 | Append only; reversal with reason keeps both rows | Done | payment trigger | invoices |
| PAY4 | Only against issued invoices | Done | payment trigger | invoices |
| PAY5 | A deposit is the first milestone invoice | Done | | invoices, e2e |

## Dashboard
| Figure | Status | Test |
|---|---|---|
| Quoted, Confirmed, Invoiced, Received, Outstanding, Overdue, Upcoming | Done, each definition shown beside it | dashboard (seeded dataset), server dashboard |
| VAT threshold monitor (trailing twelve months, configurable warning share) | Done | dashboard |
| Monthly revenue trends, estimated vs actual costs | Phase two | |

## Settings
| ID | Status | Where |
|---|---|---|
| SET1 business, logo | Done | settings, logo upload |
| SET2 rates, minimum rate, hours per day | Done | settings (per currency) |
| SET3 defaults incl. milestones, revision policy, terms, banking | Done | settings |
| SET4 complexity multipliers seeded at 1.00 | Done | settings, services |
| SET5 numbering patterns, next number visible, counter never lowered | Done | settings, documents |
| SET6 VAT flag off, threshold, warning share; VAT number and rate hidden | Done | settings |
| SET7 changes never alter documents; audit logged | Done | services, audit-log |
| SET8 nothing hard coded; seeded values labelled as suggestions | Done | settings |

## Document integrity and security
| Rule | Status | Proof |
|---|---|---|
| Snapshots at send and issue | Done | quotations, invoices (change settings, PDF hash unchanged) |
| Gap free numbering, concurrent | Done | quotations, invoices |
| Immutability in service and database | Done | quotations, invoices |
| One derived-status function | Done | documents, invoicing |
| Invoicing ceiling, concurrent | Done | invoices |
| Append only payments | Done | invoices |
| VAT mode none: no tax wording anywhere | Done | quotation, invoicing, pdf, invoice-pdf (real PDF text) |
| Audit log: one entry per transition | Done | audit-log |
| Stored PDFs unchanged | Done | quotations, invoices (hash compared) |
| Owner login with required second factor; secure cookies; rate limiting | Done | auth, auth-crypto, middleware, e2e |
| Every action and route checks the session; queries scoped by owner | Done | middleware, every service test has an other-owner case |
| Secrets in environment variables, none committed | Done | `.env.example`, `.gitignore` |
| Logs never contain names, emails or amounts | Done | runAction logs only an error name; audit-log |
| Stored PDFs private, served through authenticated routes | Done | e2e |
| Daily backups and a tested restore | **Open** for the hosted database; the procedure and integrity checks are proven locally (`npm run backup:verify`) | `docs/DEPLOYMENT.md` |
| POPIA: record host and region, confirm cross-border rules | **Open** (needs your decision) | README |

## Testing and acceptance list
| Item | Status |
|---|---|
| Tests fail when a formula changes | Done (a deliberate formula change was checked to fail the tests) |
| Property tests: reordering, duplicating a line, no negative total | Done |
| End-to-end run: estimate, quotation, acceptance, deposit invoice, payment, received amount on the dashboard | Done (`tests/e2e/core-flow.spec.ts`, `npm run e2e`) |
| All tests pass in CI on every push | Done (workflow); needs a GitHub repository to run |
| Merging blocked when CI fails | **Open**: a repository setting, command in `docs/DEPLOYMENT.md` |
| Domain layer has a test for every formula and state transition | Done |
| A real client enquiry taken through to a recorded payment, numbers matching a hand calculation | **Open**: yours to do on a real job |
| First three real quotations checked by hand | **Open**: yours to do, procedure and record sheet in `docs/HAND-CHECK.md` |
| README: setup, env vars, migrations, backups, VAT off, currency limit | Done |

## What only you can close
1. Choose the provider and region, deploy (`docs/DEPLOYMENT.md`), and test a restore on the hosted database.
2. Put the repository on GitHub and require the CI check on `main`.
3. Take a real enquiry through to a recorded payment.
4. Hand check the first three real quotations (`docs/HAND-CHECK.md`).
5. Confirm with SARS or an accountant: the VAT threshold and period, how foreign-currency income counts, the record retention period, and what an unregistered supplier may print on an invoice.
6. Decide whether you must register an information officer with the Information Regulator.
