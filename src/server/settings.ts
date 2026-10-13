import type { Prisma } from "@prisma/client";
import type { FieldIssue } from "@/domain/pricing/engine";
import { assertCounterNotLowered } from "@/domain/numbering";
import { CURRENCIES, centsToAmountString, parseAmountToCents, type Currency } from "@/domain/money";
import { COMPLEXITIES, LABOUR_CATEGORIES, type Complexity, type LabourCategory } from "@/domain/pricing/schema";
import { businessFormToInput, currencyFormToInput, ratesToForm, type BusinessForm, type CurrencyForm } from "@/domain/settings-forms";
import { bankingDetailsSchema, businessSettingsSchema, complexityMultipliersSchema, currencySettingsSchema } from "@/domain/schemas";
import { audit, changedKeys } from "./audit";
import { big, catFromDb, catToDb, cxFromDb, cxToDb, dstr, num } from "./convert";
import { db } from "./db";
import { ServiceError } from "./errors";

export interface SettingsDTO {
  /** Id of the uploaded logo file, served by /files/[id]. */
  logoFileId: string | null;
  business: BusinessForm;
  currencies: Record<Currency, CurrencyForm>;
  multipliers: Record<Complexity, string>;
  counters: { quotation: number; invoice: number };
}

/** Everything the pricing engine needs for one currency, straight from the database. */
export interface PricingSettings {
  multipliers: Record<Complexity, string>;
  minimumHourlyRateCents: number;
  defaultRatesCents: Partial<Record<LabourCategory, number>>;
  /** EST10: an estimate can only be created once at least one rate exists for its currency. */
  ratesConfigured: boolean;
}

async function ensureDefaults(ownerId: string) {
  await db.$transaction(async (tx) => {
    // INSERT ... ON CONFLICT DO NOTHING: safe when several requests create a new owner's defaults at once.
    await tx.businessSettings.createMany({ data: [{ ownerId }], skipDuplicates: true });
    await tx.complexityMultiplier.createMany({
      data: COMPLEXITIES.map((c) => ({ ownerId, level: cxToDb(c), multiplier: "1.00" })),
      skipDuplicates: true,
    });
    await tx.currencySettings.createMany({ data: CURRENCIES.map((currency) => ({ ownerId, currency })), skipDuplicates: true });
    await tx.numberCounter.createMany({
      data: (["QUOTATION", "INVOICE"] as const).map((kind) => ({ ownerId, kind })),
      skipDuplicates: true,
    });
  });
}

export async function getSettings(ownerId: string): Promise<SettingsDTO> {
  await ensureDefaults(ownerId);
  const [b, curr, rates, mult, counters] = await Promise.all([
    db.businessSettings.findUniqueOrThrow({ where: { ownerId } }),
    db.currencySettings.findMany({ where: { ownerId } }),
    db.rateSetting.findMany({ where: { ownerId } }),
    db.complexityMultiplier.findMany({ where: { ownerId } }),
    db.numberCounter.findMany({ where: { ownerId } }),
  ]);

  const business: BusinessForm = {
    legalName: b.legalName,
    tradingName: b.tradingName ?? "",
    registrationNumber: b.registrationNumber ?? "",
    address: b.address,
    email: b.email,
    phone: b.phone,
    defaultCurrency: b.defaultCurrency,
    hoursPerDay: dstr(b.hoursPerDay),
    urgencyPct: dstr(b.urgencyPct),
    contingencyPct: dstr(b.contingencyPct),
    quotationValidityDays: String(b.quotationValidityDays),
    paymentTermsDays: String(b.paymentTermsDays),
    upcomingWindowDays: String(b.upcomingWindowDays),
    defaultMilestones: (b.defaultMilestones as { label: string; percent: string }[]) ?? [],
    revisionPolicy: b.revisionPolicy,
    termsAndConditions: b.termsAndConditions,
    quotationPattern: b.quotationPattern,
    invoicePattern: b.invoicePattern,
    vatRegistered: b.vatRegistered,
    vatThreshold: b.vatThresholdCents === null ? "" : centsToAmountString(num(b.vatThresholdCents)),
    vatWarnSharePct: dstr(b.vatWarnSharePct),
  };

  const currencies = {} as Record<Currency, CurrencyForm>;
  for (const currency of CURRENCIES) {
    const cs = curr.find((c) => c.currency === currency)!;
    const byCat: Partial<Record<LabourCategory, number>> = {};
    for (const r of rates.filter((r) => r.currency === currency)) byCat[catFromDb(r.category)] = num(r.hourlyCents);
    const bd = (cs.bankingDetails ?? {}) as Record<string, string>;
    currencies[currency] = {
      currency,
      minimumHourlyRate: num(cs.minimumHourlyRateCents) ? centsToAmountString(num(cs.minimumHourlyRateCents)) : "",
      rates: ratesToForm(byCat),
      banking: {
        bankName: bd.bankName ?? "",
        accountName: bd.accountName ?? "",
        accountNumber: bd.accountNumber ?? "",
        branchCode: bd.branchCode ?? "",
        swiftCode: bd.swiftCode ?? "",
        accountType: bd.accountType ?? "",
        instructions: bd.instructions ?? "",
      },
    };
  }

  const multipliers = Object.fromEntries(
    COMPLEXITIES.map((c) => [c, dstr(mult.find((m) => cxFromDb(m.level) === c)!.multiplier)]),
  ) as Record<Complexity, string>;

  return {
    logoFileId: b.logoFileId,
    business,
    currencies,
    multipliers,
    counters: {
      quotation: counters.find((c) => c.kind === "QUOTATION")!.next,
      invoice: counters.find((c) => c.kind === "INVOICE")!.next,
    },
  };
}

export async function getPricingSettings(ownerId: string, currency: Currency): Promise<PricingSettings> {
  const s = await getSettings(ownerId);
  const f = s.currencies[currency];
  const defaults: Partial<Record<LabourCategory, number>> = {};
  for (const c of LABOUR_CATEGORIES) if (f.rates[c].trim() !== "") defaults[c] = parseAmountToCents(f.rates[c]);
  return {
    multipliers: s.multipliers,
    minimumHourlyRateCents: f.minimumHourlyRate ? parseAmountToCents(f.minimumHourlyRate) : 0,
    defaultRatesCents: defaults,
    ratesConfigured: Object.keys(defaults).length > 0,
  };
}

function throwIssues(issues: FieldIssue[]): never {
  throw new ServiceError("Some fields need attention.", issues);
}

export async function saveBusinessSettings(ownerId: string, form: BusinessForm) {
  const { input, issues } = businessFormToInput(form);
  if (issues.length) throwIssues(issues);
  const v = businessSettingsSchema.parse(input);
  const before = await getSettings(ownerId);
  await db.$transaction(async (tx) => {
    await tx.businessSettings.update({
      where: { ownerId },
      data: {
        legalName: v.legalName,
        tradingName: v.tradingName ?? null,
        registrationNumber: v.registrationNumber ?? null,
        address: v.address,
        email: v.email ?? "",
        phone: v.phone ?? "",
        defaultCurrency: v.defaultCurrency,
        hoursPerDay: String(v.hoursPerDay),
        urgencyPct: String(v.urgencyPct),
        contingencyPct: String(v.contingencyPct),
        quotationValidityDays: v.quotationValidityDays,
        paymentTermsDays: v.paymentTermsDays,
        upcomingWindowDays: v.upcomingWindowDays,
        defaultMilestones: v.defaultMilestones.map((m) => ({ label: m.label, percent: String(m.percent) })),
        revisionPolicy: v.revisionPolicy,
        termsAndConditions: v.termsAndConditions,
        quotationPattern: v.quotationPattern,
        invoicePattern: v.invoicePattern,
        vatRegistered: v.vatRegistered,
        vatThresholdCents: v.vatThresholdCents === null ? null : big(v.vatThresholdCents),
        vatWarnSharePct: String(v.vatWarnSharePct),
      },
    });
    const changed = changedKeys(
      before.business as unknown as Record<string, unknown>,
      form as unknown as Record<string, unknown>,
    );
    if (changed.length) await audit(tx, ownerId, "settings", ownerId, "business.update", { fields: changed });
  });
}

export async function saveCurrencySettings(ownerId: string, form: CurrencyForm) {
  const { input, issues } = currencyFormToInput(form);
  if (issues.length) throwIssues(issues);
  const v = currencySettingsSchema.parse(input);
  const banking = bankingDetailsSchema.parse(v.bankingDetails);
  const before = await getSettings(ownerId);
  await db.$transaction(async (tx) => {
    await tx.currencySettings.update({
      where: { ownerId_currency: { ownerId, currency: v.currency } },
      data: { minimumHourlyRateCents: big(v.minimumHourlyRateCents), bankingDetails: banking as Prisma.InputJsonValue },
    });
    for (const cat of LABOUR_CATEGORIES) {
      const cents = v.rates[cat];
      if (cents === undefined) {
        await tx.rateSetting.deleteMany({ where: { ownerId, currency: v.currency, category: catToDb(cat) } });
      } else {
        await tx.rateSetting.upsert({
          where: { ownerId_currency_category: { ownerId, currency: v.currency, category: catToDb(cat) } },
          update: { hourlyCents: big(cents) },
          create: { ownerId, currency: v.currency, category: catToDb(cat), hourlyCents: big(cents) },
        });
      }
    }
    const changed = changedKeys(
      before.currencies[v.currency] as unknown as Record<string, unknown>,
      form as unknown as Record<string, unknown>,
    );
    if (changed.length) await audit(tx, ownerId, "settings", ownerId, `currency.${v.currency}.update`, { fields: changed });
  });
}

export async function saveMultipliers(ownerId: string, values: Record<Complexity, string>) {
  const v = complexityMultipliersSchema.parse(values) as Record<Complexity, string | number>;
  const before = await getSettings(ownerId);
  await db.$transaction(async (tx) => {
    for (const c of COMPLEXITIES) {
      await tx.complexityMultiplier.update({
        where: { ownerId_level: { ownerId, level: cxToDb(c) } },
        data: { multiplier: String(v[c]) },
      });
    }
    const changed = changedKeys(before.multipliers, values);
    if (changed.length) await audit(tx, ownerId, "settings", ownerId, "multipliers.update", { levels: changed });
  });
}

/** SET5: raise the next number. The row is locked so concurrent changes cannot lower it. */
export async function setNextNumber(ownerId: string, kind: "QUOTATION" | "INVOICE", next: number) {
  await db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string; next: number }[]>`
      SELECT "id", "next" FROM "NumberCounter" WHERE "ownerId" = ${ownerId} AND "kind"::text = ${kind} FOR UPDATE`;
    const row = rows[0];
    if (!row) throw new ServiceError("Counter not found");
    assertCounterNotLowered(row.next, next);
    if (next === row.next) return;
    await tx.numberCounter.update({ where: { id: row.id }, data: { next } });
    await audit(tx, ownerId, "counter", row.id, `${kind.toLowerCase()}.raise`, { from: row.next, to: next });
  });
}
