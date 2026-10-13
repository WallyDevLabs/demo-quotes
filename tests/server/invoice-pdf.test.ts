import { PDFParse } from "pdf-parse";
import { describe, expect, it } from "vitest";
import { createMilestoneInvoice, getInvoicePdf, issueInvoice } from "@/server/invoices";
import { setupAcceptedQuotation } from "./helpers";

async function textOf(bytes: Uint8Array): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(bytes) });
  const r = await parser.getText();
  await parser.destroy();
  return r.text;
}

describe("the real stored invoice PDF (INV4, INV7)", () => {
  it("has every required element and, with VAT off, no tax wording or VAT figure", async () => {
    const s = await setupAcceptedQuotation();
    const id = await createMilestoneInvoice(s.ownerId, s.quotationId, s.milestoneIds[0]!);
    const { number } = await issueInvoice(s.ownerId, id, {}, { now: new Date("2026-10-13T10:00:00Z") }); // the real renderer
    const pdf = await getInvoicePdf(s.ownerId, id);
    expect(pdf!.bytes.subarray(0, 5).toString()).toBe("%PDF-");
    const text = await textOf(pdf!.bytes);

    for (const must of [
      "Invoice",
      number,
      "Invoice date: 2026-10-13",
      "Due date: 2026-10-27",
      "Katlego Barayi",
      "Acme (Pty) Ltd",
      "Dispatch app",
      "Deposit (50.00%)",
      `Quotation ${number.replace("INV", "QUO")}`,
      "R18 534.50",
      "Amount paid",
      "R0.00",
      "Balance due",
      "Payment details",
      "First National Bank",
      "Account number: 62000000000",
      "Branch code: 250655",
      `Payment reference: ${number}`,
      "Please use the invoice number as your reference.",
      "Page 1 of",
    ]) {
      expect(text, `PDF should contain "${must}"`).toContain(must);
    }

    expect(text).not.toMatch(/vat/i);
    expect(text).not.toMatch(/tax/i);
    expect(text).not.toMatch(/quotation\s*\n?\s*QUO\d+\s*\n?\s*Valid until/i); // it is an invoice, not a quotation
  }, 60_000);
});
