"use server";

import { revalidatePath } from "next/cache";
import type { Complexity } from "@/domain/pricing/schema";
import type { ClientInput, EstimateMetaInput, ProjectInput } from "@/domain/schemas";
import type { EstimateDraft } from "@/domain/pricing/draft";
import type { BusinessForm, CurrencyForm } from "@/domain/settings-forms";
import { createClient, createProject, setClientArchived, updateClient, updateProject } from "@/server/clients";
import { runAction, type ActionResult } from "@/server/errors";
import { deleteEstimate, duplicateEstimate, saveEstimate, setEstimateReady } from "@/server/estimates";
import { requireOwnerId } from "@/server/owner";
import type { QuotationDraftInput } from "@/domain/schemas";
import {
  acceptQuotation,
  createQuotationFromEstimate,
  deleteDraftQuotation,
  duplicateQuotation,
  rejectQuotation,
  sendQuotation,
  updateDraftQuotation,
} from "@/server/quotations";
import { removeLogo, uploadLogo } from "@/server/logo";
import type { CustomInvoiceInput, IssueInvoiceInput, PaymentInput } from "@/domain/schemas";
import {
  cancelInvoice,
  createCustomInvoice,
  createMilestoneInvoice,
  deleteDraftInvoice,
  issueInvoice,
  recordPayment,
  reversePayment,
  updateDraftCustomInvoice,
} from "@/server/invoices";
import { saveBusinessSettings, saveCurrencySettings, saveMultipliers, setNextNumber } from "@/server/settings";

/**
 * Every action: checks the session (owner), validates with the shared Zod schemas inside the
 * service, and returns a result the form can show with a retry. Components never hold formulas.
 */

export async function saveBusinessAction(form: BusinessForm): Promise<ActionResult> {
  return runAction(async () => {
    await saveBusinessSettings(await requireOwnerId(), form);
    revalidatePath("/settings");
    revalidatePath("/");
  });
}

export async function saveCurrencyAction(form: CurrencyForm): Promise<ActionResult> {
  return runAction(async () => {
    await saveCurrencySettings(await requireOwnerId(), form);
    revalidatePath("/settings");
    revalidatePath("/estimates", "layout");
    revalidatePath("/");
  });
}

export async function saveMultipliersAction(values: Record<Complexity, string>): Promise<ActionResult> {
  return runAction(async () => {
    await saveMultipliers(await requireOwnerId(), values);
    revalidatePath("/settings");
  });
}

export async function setNextNumberAction(kind: "QUOTATION" | "INVOICE", next: number): Promise<ActionResult> {
  return runAction(async () => {
    await setNextNumber(await requireOwnerId(), kind, next);
    revalidatePath("/settings");
  });
}

export async function createClientAction(input: ClientInput): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const id = await createClient(await requireOwnerId(), input);
    revalidatePath("/clients");
    return { id };
  });
}

export async function updateClientAction(id: string, input: ClientInput): Promise<ActionResult> {
  return runAction(async () => {
    await updateClient(await requireOwnerId(), id, input);
    revalidatePath("/clients", "layout");
  });
}

export async function archiveClientAction(id: string, archived: boolean): Promise<ActionResult> {
  return runAction(async () => {
    await setClientArchived(await requireOwnerId(), id, archived);
    revalidatePath("/clients", "layout");
  });
}

export async function createProjectAction(input: ProjectInput): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const id = await createProject(await requireOwnerId(), input);
    revalidatePath("/projects");
    return { id };
  });
}

export async function updateProjectAction(id: string, input: ProjectInput): Promise<ActionResult> {
  return runAction(async () => {
    await updateProject(await requireOwnerId(), id, input);
    revalidatePath("/projects", "layout");
  });
}

export async function saveEstimateAction(
  id: string | null,
  meta: EstimateMetaInput,
  draft: EstimateDraft,
): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const saved = await saveEstimate(await requireOwnerId(), id, { meta, draft });
    revalidatePath("/estimates", "layout");
    return { id: saved.id };
  });
}

export async function duplicateEstimateAction(id: string): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const copy = await duplicateEstimate(await requireOwnerId(), id);
    revalidatePath("/estimates");
    return { id: copy };
  });
}

export async function setEstimateReadyAction(id: string, ready: boolean): Promise<ActionResult> {
  return runAction(async () => {
    await setEstimateReady(await requireOwnerId(), id, ready);
    revalidatePath("/estimates", "layout");
  });
}

export async function deleteEstimateAction(id: string): Promise<ActionResult> {
  return runAction(async () => {
    await deleteEstimate(await requireOwnerId(), id);
    revalidatePath("/estimates");
  });
}

export async function createQuotationAction(estimateId: string): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const id = await createQuotationFromEstimate(await requireOwnerId(), estimateId);
    revalidatePath("/quotations");
    return { id };
  });
}

export async function updateQuotationDraftAction(id: string, input: QuotationDraftInput): Promise<ActionResult> {
  return runAction(async () => {
    await updateDraftQuotation(await requireOwnerId(), id, input);
    revalidatePath("/quotations", "layout");
  });
}

export async function deleteQuotationDraftAction(id: string): Promise<ActionResult> {
  return runAction(async () => {
    await deleteDraftQuotation(await requireOwnerId(), id);
    revalidatePath("/quotations", "layout");
  });
}

export async function sendQuotationAction(id: string): Promise<ActionResult<{ number: string }>> {
  return runAction(async () => {
    const r = await sendQuotation(await requireOwnerId(), id);
    revalidatePath("/quotations", "layout");
    revalidatePath("/");
    return r;
  });
}

export async function acceptQuotationAction(id: string, acceptedBy: string): Promise<ActionResult> {
  return runAction(async () => {
    await acceptQuotation(await requireOwnerId(), id, { acceptedBy });
    revalidatePath("/quotations", "layout");
    revalidatePath("/projects", "layout");
  });
}

export async function rejectQuotationAction(id: string, reason: string): Promise<ActionResult> {
  return runAction(async () => {
    await rejectQuotation(await requireOwnerId(), id, { reason });
    revalidatePath("/quotations", "layout");
  });
}

export async function duplicateQuotationAction(id: string): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const copy = await duplicateQuotation(await requireOwnerId(), id);
    revalidatePath("/quotations");
    return { id: copy };
  });
}

export async function uploadLogoAction(form: FormData): Promise<ActionResult> {
  return runAction(async () => {
    await uploadLogo(await requireOwnerId(), form.get("logo"));
    revalidatePath("/settings");
  });
}

export async function removeLogoAction(): Promise<ActionResult> {
  return runAction(async () => {
    await removeLogo(await requireOwnerId());
    revalidatePath("/settings");
  });
}

export async function createMilestoneInvoiceAction(quotationId: string, milestoneId: string): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const id = await createMilestoneInvoice(await requireOwnerId(), quotationId, milestoneId);
    revalidatePath("/invoices");
    revalidatePath("/quotations", "layout");
    return { id };
  });
}

export async function createCustomInvoiceAction(quotationId: string, input: CustomInvoiceInput): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const id = await createCustomInvoice(await requireOwnerId(), quotationId, input);
    revalidatePath("/invoices");
    revalidatePath("/quotations", "layout");
    return { id };
  });
}

export async function updateCustomInvoiceDraftAction(id: string, input: CustomInvoiceInput): Promise<ActionResult> {
  return runAction(async () => {
    await updateDraftCustomInvoice(await requireOwnerId(), id, input);
    revalidatePath("/invoices", "layout");
    revalidatePath("/quotations", "layout");
  });
}

export async function deleteInvoiceDraftAction(id: string): Promise<ActionResult> {
  return runAction(async () => {
    await deleteDraftInvoice(await requireOwnerId(), id);
    revalidatePath("/invoices", "layout");
    revalidatePath("/quotations", "layout");
  });
}

export async function issueInvoiceAction(id: string, input: IssueInvoiceInput): Promise<ActionResult<{ number: string }>> {
  return runAction(async () => {
    const r = await issueInvoice(await requireOwnerId(), id, input);
    revalidatePath("/invoices", "layout");
    revalidatePath("/quotations", "layout");
    revalidatePath("/");
    return r;
  });
}

export async function cancelInvoiceAction(id: string, reason: string): Promise<ActionResult> {
  return runAction(async () => {
    await cancelInvoice(await requireOwnerId(), id, { reason });
    revalidatePath("/invoices", "layout");
    revalidatePath("/quotations", "layout");
  });
}

export async function recordPaymentAction(invoiceId: string, input: PaymentInput): Promise<ActionResult> {
  return runAction(async () => {
    await recordPayment(await requireOwnerId(), invoiceId, input);
    revalidatePath("/invoices", "layout");
    revalidatePath("/");
  });
}

export async function reversePaymentAction(paymentId: string, reason: string): Promise<ActionResult> {
  return runAction(async () => {
    await reversePayment(await requireOwnerId(), paymentId, { reason });
    revalidatePath("/invoices", "layout");
    revalidatePath("/");
  });
}
