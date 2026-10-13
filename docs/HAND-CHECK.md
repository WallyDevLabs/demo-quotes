# Hand check: your first three real quotations

The PRD's rule: **the first three real quotations are checked by hand against the tool before it is trusted for more.** A formula that quietly underprices you is the biggest risk in a pricing tool, and a test fixture can only prove the cases someone thought of. Three real jobs, worked on paper, prove it on yours.

Do this for each of the first three real quotations, before you send it.

## Method

1. Create the estimate in the app as normal.
2. Open **Show working** on the estimate page. It lists every input, then every step in order with its formula and the figures used.
3. Without looking at the tool's answer, work the price out yourself on paper or in a spreadsheet, using only the inputs. The formulas are:

| Step | Method A: time based | Method B: fixed price |
|---|---|---|
| 1 Base | each line: hours × rate, rounded to the cent; then add them | each deliverable: price × the complexity multiplier, rounded to the cent; then add them |
| 2 Urgency | urgency % × base, **only if urgent is on** | same |
| 3 Contingency | contingency % × base (**before** urgency; not charged on urgency) | same |
| 4 Expenses | each once-off line: cost × (1 + markup %), rounded; then add them | same |
| 5 Subtotal | base + urgency + contingency + expenses | same |
| 6 Discount | percent of the subtotal (rounded) or a fixed amount, never more than the subtotal | same |
| 7 Total | subtotal − discount | same |

   Rules that catch people out: round half up to the cent at each line and each percentage step, once; contingency and urgency are charged on the base only, never on expenses and never on each other; time based pricing has **no** complexity multiplier and no margin; recurring lines are left out of the total; there is no tax line (you are not VAT registered).
4. Compare your figure with the tool's at every step, not only the total. Note any difference, even one cent.
5. After the quotation is created, open **Show working** on the quotation. Every check there must read Pass: the printed lines add up to the subtotal, subtotal − discount is the total, and the payment schedule adds up to the total to the cent.
6. Look at the effective hourly rate on the estimate (internal view): is it above your minimum? Does it feel right for the job?
7. Only then send it.

## Record

| # | Date | Client and project | Total by hand | Total in the tool | Every step matched? | Quotation checks all Pass? | Checked by | Notes |
|---|---|---|---|---|---|---|---|---|
| 1 | | | | | | | | |
| 2 | | | | | | | | |
| 3 | | | | | | | | |

## If anything differs

Do not send the quotation. Write down the inputs and both answers, then:
- Check your own working first (a missed rounding step is the usual cause).
- If the tool is wrong, that is a bug in the money logic. Report it with the numbers, and do not trust the tool for further quotes until it is fixed and a test for that case exists.

## Worked example to practise on

This is the test fixture, with illustrative numbers (not suggested prices). Time based. There is no tax line, because you are not VAT registered.

| Line | Calculation | Amount |
|---|---|---|
| Development | 40 h × R600.00 | R24 000.00 |
| Design | 10 h × R500.00 | R5 000.00 |
| Labour (base) | | R29 000.00 |
| Urgency | 20% × R29 000.00 | R5 800.00 |
| Contingency | 10% × R29 000.00 | R2 900.00 |
| Hosting | R1 200.00 cost × 1.10 | R1 320.00 |
| Subtotal | | R39 020.00 |
| Discount | 5% × R39 020.00 | R1 951.00 |
| **Total** | | **R37 069.00** |

Effective hourly rate: (R37 069.00 − R1 320.00) ÷ 50 h = R714.98 per hour.

## Sign-off

The MVP is trusted for ordinary use once all three rows above are complete with no unexplained difference.
