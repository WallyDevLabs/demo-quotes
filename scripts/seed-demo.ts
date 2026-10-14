// Fills the demo workspace with realistic sample data, through the same services the app uses
// (so numbers, snapshots, PDFs and audit entries are all real). Dates are relative to today.
//
//   npm run seed:demo             seed (does nothing if the demo workspace already has clients)
//   npm run seed:demo -- --reset  wipe ALL business data in this database first, then seed
//
// --reset truncates every business table. Only point it at a database used purely for the demo.
import { randomUUID } from "node:crypto";
import type { EstimateDraft } from "@/domain/pricing/draft";
import { emptyCurrencyForm } from "@/domain/settings-forms";
import { createClient, createProject } from "@/server/clients";
import { db } from "@/server/db";
import { demoOwnerId } from "@/server/demo";
import { saveEstimate, setEstimateReady } from "@/server/estimates";
import { createMilestoneInvoice, getQuotationInvoicing, issueInvoice, recordPayment } from "@/server/invoices";
import { acceptQuotation, createQuotationFromEstimate, rejectQuotation, sendQuotation, updateDraftQuotation } from "@/server/quotations";
import { getSettings, saveBusinessSettings, saveCurrencySettings } from "@/server/settings";

const KEEP = new Set(["_prisma_migrations", "User", "TrustedDevice", "AuthAttempt"]);

async function reset() {
  const rows = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`;
  const names = rows.map((r) => r.tablename).filter((n) => !KEEP.has(n));
  await db.$executeRawUnsafe(`TRUNCATE ${names.map((n) => `"${n}"`).join(", ")} RESTART IDENTITY CASCADE`);
  console.log(`Cleared ${names.length} tables.`);
}

/** `days` ago (negative = in the future), at 10:00 UTC. */
const ago = (days: number) => {
  const d = new Date();
  d.setUTCHours(10, 0, 0, 0);
  return new Date(d.getTime() - days * 86_400_000);
};
const iso = (d: Date) => d.toISOString().slice(0, 10);

type Category = "development" | "design" | "testing" | "consulting" | "project_management";
const labour = (task: string, category: Category, hours: string, rate: string) => ({ id: randomUUID(), task, category, hours, rate });
const expense = (description: string, cost: string, markupPct = "0", recurring = false) => ({
  id: randomUUID(),
  description,
  cost,
  markupPct,
  recurring,
  period: "monthly" as const,
});

const draft = (p: Partial<EstimateDraft> & Pick<EstimateDraft, "currency">): EstimateDraft => ({
  method: "time",
  complexity: null,
  urgent: false,
  urgencyPct: "0",
  contingencyPct: "10",
  discount: { type: "none", value: "0" },
  labour: [],
  deliverables: [],
  expenses: [],
  ...p,
});

const scope = (what: string) => `${what}\n\nIncludes discovery, design, development, testing and hand-over. Work is delivered in stages with a review after each.`;
const major = (cents: bigint) => (Number(cents) / 100).toFixed(2);

async function main() {
  if (process.argv.includes("--reset")) await reset();
  const ownerId = await demoOwnerId();
  if ((await db.client.count({ where: { ownerId } })) > 0) {
    console.log("The demo workspace already has data. Run with --reset to start over.");
    return;
  }

  // ---- Business settings and rates ------------------------------------------------------------
  const base = (await getSettings(ownerId)).business;
  await saveBusinessSettings(ownerId, {
    ...base,
    legalName: "Katlego Barayi Software",
    tradingName: "CodeQuote Demo Studio",
    address: "12 Jan Shoba Street\nBrooklyn, Pretoria, 0181",
    email: "hello@example.com",
    phone: "+27 12 345 6789",
    quotationValidityDays: "30",
    paymentTermsDays: "14",
    contingencyPct: "10",
    defaultMilestones: [
      { label: "Deposit", percent: "40" },
      { label: "Mid-project", percent: "30" },
      { label: "On delivery", percent: "30" },
    ],
    revisionPolicy: "Two rounds of revisions per milestone are included. Further changes are quoted separately.",
    termsAndConditions:
      "Payment is due within 14 days of the invoice date. Work starts once the deposit is received. Ownership of the deliverables passes to the client on final payment.",
  });
  const zar = emptyCurrencyForm("ZAR");
  zar.minimumHourlyRate = "450";
  Object.assign(zar.rates, { development: "650", design: "550", testing: "450", consulting: "850", project_management: "600" });
  Object.assign(zar.banking, {
    bankName: "First National Bank",
    accountName: "Katlego Barayi Software",
    accountNumber: "62000000000",
    branchCode: "250655",
    accountType: "Cheque",
    instructions: "Use the invoice number as your payment reference.",
  });
  await saveCurrencySettings(ownerId, zar);
  const usd = emptyCurrencyForm("USD");
  usd.minimumHourlyRate = "35";
  Object.assign(usd.rates, { development: "45", design: "40", testing: "30", consulting: "60", project_management: "40" });
  Object.assign(usd.banking, {
    bankName: "Wise",
    accountName: "Katlego Barayi Software",
    accountNumber: "8310000000",
    swiftCode: "TRWIUS35",
    accountType: "Business",
    instructions: "International transfers: quote the invoice number.",
  });
  await saveCurrencySettings(ownerId, usd);

  // ---- Clients and projects -------------------------------------------------------------------
  const acme = await createClient(ownerId, { name: "Thabo Mokoena", companyName: "Acme Logistics (Pty) Ltd", code: "ACME", email: "thabo@acme.example", phone: "+27 11 555 0101", address: "88 Rivonia Rd, Sandton", vatNumber: "4123456789", notes: "Prefers WhatsApp for quick questions." });
  const lumen = await createClient(ownerId, { name: "Dr Naledi Dlamini", companyName: "Lumen Health", code: "LUMN", email: "naledi@lumen.example", phone: "+27 21 555 0142", address: "5 Kloof St, Cape Town" });
  const north = await createClient(ownerId, { name: "Sam Whitaker", companyName: "Northwind Labs Inc.", code: "NRTH", email: "sam@northwind.example", address: "200 Market St, Austin, TX", notes: "Pays in USD." });
  const karoo = await createClient(ownerId, { name: "Annelize Botha", companyName: "Karoo Coffee Roasters", code: "KARO", email: "annelize@karoo.example", phone: "+27 44 555 0177" });

  const dispatch = await createProject(ownerId, { clientId: acme, name: "Dispatch app", code: "DISP", status: "ACTIVE", description: "Web app for dispatching drivers and tracking deliveries.", deadline: iso(ago(-40)) });
  const portal = await createProject(ownerId, { clientId: lumen, name: "Patient portal", code: "PORT", status: "ACTIVE", description: "Secure portal for bookings and test results.", deadline: iso(ago(-60)) });
  const dash = await createProject(ownerId, { clientId: north, name: "Analytics dashboard", code: "ANLY", status: "QUOTED", description: "Sales analytics dashboard with CSV export." });
  const store = await createProject(ownerId, { clientId: karoo, name: "Online store", code: "SHOP", status: "LEAD", description: "Online store with subscriptions." });
  const brand = await createProject(ownerId, { clientId: karoo, name: "Brand refresh site", code: "BRND", status: "CANCELLED", description: "Marketing site redesign." });
  await createProject(ownerId, { clientId: acme, name: "Driver mobile app", code: "DRVR", status: "LEAD", description: "Companion app for drivers (early idea)." });

  const estimate = async (projectId: string, title: string, d: EstimateDraft, ready: boolean) => {
    const saved = await saveEstimate(ownerId, null, { meta: { projectId, title, currency: d.currency, complexity: d.complexity }, draft: d });
    if (ready) await setEstimateReady(ownerId, saved.id, true);
    return saved.id;
  };
  const quote = async (estimateId: string, title: string, what: string, milestones?: { label: string; percent: string }[]) => {
    const id = await createQuotationFromEstimate(ownerId, estimateId);
    await updateDraftQuotation(ownerId, id, {
      title,
      scope: scope(what),
      deliverables: "Source code in your repository, deployed to production, plus a short admin guide.",
      exclusions: "Third-party licences, content writing and ongoing hosting costs.",
      timeline: "Roughly 8 to 10 weeks from the deposit.",
      ...(milestones ? { milestones } : {}),
    });
    return id;
  };

  // ---- 1. Acme: accepted, deposit paid, second invoice part-paid, third not yet invoiced ------
  const acmeEst = await estimate(
    dispatch,
    "Dispatch app, phase 1",
    draft({
      currency: "ZAR",
      urgent: true,
      urgencyPct: "15",
      discount: { type: "percent", value: "5" },
      labour: [
        labour("Backend and API", "development", "90", "650.00"),
        labour("Dispatch board UI", "development", "60", "650.00"),
        labour("UX and screens", "design", "30", "550.00"),
        labour("Testing", "testing", "24", "450.00"),
        labour("Project management", "project_management", "16", "600.00"),
      ],
      expenses: [expense("Cloud hosting set-up", "2500.00", "10"), expense("Maintenance and monitoring", "1500.00", "0", true)],
    }),
    true,
  );
  const acmeQ = await quote(acmeEst, "Dispatch app, phase 1", "A web app for dispatchers to assign drivers, track deliveries live and export daily reports.");
  await sendQuotation(ownerId, acmeQ, { now: ago(60) });
  await acceptQuotation(ownerId, acmeQ, { acceptedBy: "Thabo Mokoena" }, ago(55));
  const acmeInv = (await getQuotationInvoicing(ownerId, acmeQ))!;
  const acme1 = await createMilestoneInvoice(ownerId, acmeQ, acmeInv.milestones[0]!.id);
  await issueInvoice(ownerId, acme1, {}, { now: ago(54) });
  const acme1Total = (await db.invoice.findUniqueOrThrow({ where: { id: acme1 } })).totalCents;
  await recordPayment(ownerId, acme1, { amount: major(acme1Total), receivedOn: iso(ago(47)), method: "EFT", label: "DEPOSIT", reference: "ACME deposit" }, ago(47));
  const acme2 = await createMilestoneInvoice(ownerId, acmeQ, acmeInv.milestones[1]!.id);
  await issueInvoice(ownerId, acme2, {}, { now: ago(12) });
  const acme2Total = (await db.invoice.findUniqueOrThrow({ where: { id: acme2 } })).totalCents;
  await recordPayment(ownerId, acme2, { amount: major(acme2Total / 2n), receivedOn: iso(ago(5)), method: "EFT", label: "MILESTONE", reference: "Part payment" }, ago(5));

  // ---- 2. Lumen: accepted, deposit invoiced and now overdue -------------------------------------
  const lumenEst = await estimate(
    portal,
    "Patient portal",
    draft({
      currency: "ZAR",
      contingencyPct: "15",
      labour: [
        labour("Booking and accounts", "development", "110", "650.00"),
        labour("Results viewer", "development", "50", "650.00"),
        labour("Security review", "consulting", "12", "850.00"),
        labour("Accessible UI design", "design", "36", "550.00"),
        labour("Testing", "testing", "30", "450.00"),
      ],
      expenses: [expense("Managed database", "1800.00", "10", true), expense("Security audit (third party)", "6000.00", "15")],
    }),
    true,
  );
  const lumenQ = await quote(lumenEst, "Patient portal", "A secure portal where patients book appointments and view results.", [
    { label: "Deposit", percent: "50" },
    { label: "On delivery", percent: "50" },
  ]);
  await sendQuotation(ownerId, lumenQ, { now: ago(40) });
  await acceptQuotation(ownerId, lumenQ, { acceptedBy: "Dr Naledi Dlamini" }, ago(36));
  const lumenInv = (await getQuotationInvoicing(ownerId, lumenQ))!;
  const lumen1 = await createMilestoneInvoice(ownerId, lumenQ, lumenInv.milestones[0]!.id);
  await issueInvoice(ownerId, lumen1, {}, { now: ago(30) });

  // ---- 3. Northwind (USD): sent, waiting for an answer -----------------------------------------
  const northEst = await estimate(
    dash,
    "Analytics dashboard",
    draft({
      currency: "USD",
      labour: [
        labour("Data pipeline", "development", "50", "45.00"),
        labour("Dashboard UI", "development", "40", "45.00"),
        labour("Visual design", "design", "16", "40.00"),
        labour("Testing", "testing", "14", "30.00"),
      ],
      expenses: [expense("Charting licence", "300.00", "0")],
    }),
    true,
  );
  const northQ = await quote(northEst, "Analytics dashboard", "A dashboard of sales and funnel metrics with scheduled CSV exports.");
  await sendQuotation(ownerId, northQ, { now: ago(4) });

  // ---- 4. Karoo: one rejected quote, one that expired, one draft ---------------------------------
  const brandEst = await estimate(
    brand,
    "Brand refresh site",
    draft({ currency: "ZAR", labour: [labour("Page design", "design", "24", "550.00"), labour("Build", "development", "30", "650.00")] }),
    true,
  );
  const brandQ = await quote(brandEst, "Brand refresh site", "A five-page marketing site with the new brand.");
  await sendQuotation(ownerId, brandQ, { now: ago(25) });
  await rejectQuotation(ownerId, brandQ, { reason: "Decided to postpone the rebrand until next year." }, ago(20));

  const shopEst = await estimate(
    store,
    "Online store",
    draft({
      currency: "ZAR",
      method: "fixed",
      complexity: "intermediate",
      deliverables: [
        { id: randomUUID(), name: "Storefront and product catalogue", price: "28000.00", estimatedHours: "45" },
        { id: randomUUID(), name: "Checkout and subscriptions", price: "22000.00", estimatedHours: "35" },
      ],
      expenses: [expense("Payment gateway set-up", "900.00", "0")],
    }),
    true,
  );
  const shopQ1 = await quote(shopEst, "Online store (first offer)", "A store with subscription coffee boxes.");
  await sendQuotation(ownerId, shopQ1, { now: ago(70) });
  await quote(shopEst, "Online store", "A store with subscription coffee boxes and local delivery rules.");

  // ---- Loose estimates -------------------------------------------------------------------------
  await estimate(dispatch, "Dispatch app, phase 2 (ideas)", draft({ currency: "ZAR", labour: [labour("Route optimisation", "development", "40", "650.00"), labour("Reporting", "development", "24", "650.00")] }), false);
  await estimate(store, "Store: loyalty points add-on", draft({ currency: "ZAR", labour: [labour("Loyalty module", "development", "20", "650.00")] }), false);

  console.log("Demo data ready.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
