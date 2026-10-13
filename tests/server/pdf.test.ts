import { PDFParse } from "pdf-parse";
import { describe, expect, it } from "vitest";
import { createQuotationFromEstimate, getQuotationPdf, sendQuotation, updateDraftQuotation } from "@/server/quotations";
import { setupReadyEstimate } from "./helpers";

async function textOf(bytes: Uint8Array): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(bytes) });
  const r = await parser.getText();
  await parser.destroy();
  return r.text;
}

describe("the real stored PDF", () => {
  it("contains the required content and, with VAT off, no tax wording", async () => {
    const s = await setupReadyEstimate();
    const id = await createQuotationFromEstimate(s.ownerId, s.estimateId);
    await updateDraftQuotation(s.ownerId, id, {
      title: "Phase 1",
      scope: "Build the dispatch web app.",
      deliverables: "Web app and admin dashboard",
      exclusions: "Third party licences",
      timeline: "Eight weeks from deposit",
      revisionPolicy: "Two rounds of revisions are included.",
      terms: "Payment within 14 days of invoice.",
      milestones: [{ label: "Deposit", percent: "50" }, { label: "Final", percent: "50" }],
    });
    const { number } = await sendQuotation(s.ownerId, id, { now: new Date("2026-10-13T10:00:00Z") });

    const pdf = await getQuotationPdf(s.ownerId, id);
    expect(pdf!.bytes.subarray(0, 5).toString()).toBe("%PDF-");
    const text = await textOf(pdf!.bytes);

    for (const must of [
      "Quotation",
      number,
      "Katlego Barayi",
      "Acme (Pty) Ltd",
      "Dispatch app",
      "Build the dispatch web app.",
      "Web app and admin dashboard",
      "Third party licences",
      "Development",
      "40 h x R600.00",
      "Urgent delivery surcharge",
      "Contingency",
      "Hosting",
      "R37 069.00",
      "Payment schedule",
      "Deposit",
      "R18 534.50",
      "Eight weeks from deposit",
      "Two rounds of revisions are included.",
      "Payment within 14 days of invoice.",
      "Acceptance",
      "2026-10-13",
      "2026-11-12",
      "Recurring costs",
      "Maintenance",
      "Page 1 of",
    ]) {
      expect(text, `PDF should contain "${must}"`).toContain(must);
    }

    // PRD: VAT mode off means no tax wording, no VAT number and no VAT figure anywhere.
    expect(text).not.toMatch(/vat/i);
    expect(text).not.toMatch(/tax/i);
    // Internal data never reaches the client.
    for (const secret of ["markup", "effective", "1 200.00", "R1 200"]) {
      expect(text.toLowerCase()).not.toContain(secret.toLowerCase());
    }
  }, 60_000);
});
