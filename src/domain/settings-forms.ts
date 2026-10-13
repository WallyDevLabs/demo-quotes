import { centsToAmountString, parseAmountToCents, type Currency } from "./money";
import { LABOUR_CATEGORIES, type LabourCategory } from "./pricing/schema";
import type { FieldIssue } from "./pricing/engine";
import type { BusinessSettingsInput, CurrencySettingsInput } from "./schemas";

/** Form models for settings: strings in major units, converted with the same rules on both sides. */

export interface BusinessForm {
  legalName: string;
  tradingName: string;
  registrationNumber: string;
  address: string;
  email: string;
  phone: string;
  defaultCurrency: Currency;
  hoursPerDay: string;
  urgencyPct: string;
  contingencyPct: string;
  quotationValidityDays: string;
  paymentTermsDays: string;
  upcomingWindowDays: string;
  defaultMilestones: { label: string; percent: string }[];
  revisionPolicy: string;
  termsAndConditions: string;
  quotationPattern: string;
  invoicePattern: string;
  vatRegistered: boolean;
  /** Major units in ZAR (the registration threshold is a rand figure). Blank when unset. */
  vatThreshold: string;
  vatWarnSharePct: string;
}

export interface CurrencyForm {
  currency: Currency;
  minimumHourlyRate: string;
  /** Blank means "not configured" for that category. */
  rates: Record<LabourCategory, string>;
  banking: {
    bankName: string;
    accountName: string;
    accountNumber: string;
    branchCode: string;
    swiftCode: string;
    accountType: string;
    instructions: string;
  };
}

const int = (s: string, path: string, issues: FieldIssue[]): number => {
  const t = s.trim();
  if (!/^\d+$/.test(t)) {
    issues.push({ path, message: "Enter a whole number" });
    return 0;
  }
  return Number(t);
};

const money = (s: string, path: string, issues: FieldIssue[]): number => {
  try {
    return parseAmountToCents(s);
  } catch (e) {
    issues.push({ path, message: e instanceof Error ? e.message : "Enter an amount" });
    return 0;
  }
};

export function businessFormToInput(f: BusinessForm): { input: BusinessSettingsInput; issues: FieldIssue[] } {
  const issues: FieldIssue[] = [];
  const input: BusinessSettingsInput = {
    legalName: f.legalName,
    tradingName: f.tradingName,
    registrationNumber: f.registrationNumber,
    address: f.address,
    email: f.email,
    phone: f.phone,
    defaultCurrency: f.defaultCurrency,
    hoursPerDay: f.hoursPerDay,
    urgencyPct: f.urgencyPct,
    contingencyPct: f.contingencyPct,
    quotationValidityDays: int(f.quotationValidityDays, "quotationValidityDays", issues),
    paymentTermsDays: int(f.paymentTermsDays, "paymentTermsDays", issues),
    upcomingWindowDays: int(f.upcomingWindowDays, "upcomingWindowDays", issues),
    defaultMilestones: f.defaultMilestones,
    revisionPolicy: f.revisionPolicy,
    termsAndConditions: f.termsAndConditions,
    quotationPattern: f.quotationPattern,
    invoicePattern: f.invoicePattern,
    vatRegistered: f.vatRegistered,
    vatThresholdCents: f.vatThreshold.trim() === "" ? null : money(f.vatThreshold, "vatThreshold", issues),
    vatWarnSharePct: f.vatWarnSharePct,
  };
  return { input, issues };
}

export function currencyFormToInput(f: CurrencyForm): { input: CurrencySettingsInput; issues: FieldIssue[] } {
  const issues: FieldIssue[] = [];
  const rates: Partial<Record<LabourCategory, number>> = {};
  for (const c of LABOUR_CATEGORIES) {
    if (f.rates[c].trim() !== "") rates[c] = money(f.rates[c], `rates.${c}`, issues);
  }
  return {
    input: {
      currency: f.currency,
      minimumHourlyRateCents: f.minimumHourlyRate.trim() === "" ? 0 : money(f.minimumHourlyRate, "minimumHourlyRate", issues),
      rates,
      bankingDetails: f.banking,
    },
    issues,
  };
}

export const ratesToForm = (rates: Partial<Record<LabourCategory, number>>) =>
  Object.fromEntries(
    LABOUR_CATEGORIES.map((c) => [c, rates[c] === undefined ? "" : centsToAmountString(rates[c]!)]),
  ) as Record<LabourCategory, string>;

export const emptyCurrencyForm = (currency: Currency): CurrencyForm => ({
  currency,
  minimumHourlyRate: "",
  rates: { development: "", design: "", testing: "", consulting: "", project_management: "" },
  banking: { bankName: "", accountName: "", accountNumber: "", branchCode: "", swiftCode: "", accountType: "", instructions: "" },
});
