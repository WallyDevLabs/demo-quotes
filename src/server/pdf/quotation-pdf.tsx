import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import type { QuotationDocument } from "@/domain/quotation";

/**
 * Presentation only: every string comes from the pure document model, so the PDF, the on-screen
 * view and the render tests cannot disagree. No settings are read here.
 */

const C = { ink: "#0F172A", muted: "#64748B", line: "#E2E8F0", primary: "#4F46E5", soft: "#F1F5F9" };
export const s = StyleSheet.create({
  page: { padding: 40, paddingBottom: 56, fontFamily: "Helvetica", fontSize: 9.5, color: C.ink, },
  row: { flexDirection: "row" },
  head: { flexDirection: "row", justifyContent: "space-between", marginBottom: 22 },
  logo: { width: 70, height: 70, objectFit: "contain", marginBottom: 6 },
  bizName: { fontSize: 13, fontWeight: 700 },
  muted: { color: C.muted },
  title: { fontSize: 22, fontWeight: 700, color: C.primary, textAlign: "right", lineHeight: 1.1, marginBottom: 6 },
  meta: { textAlign: "right", marginTop: 4 },
  draft: { color: "#B45309", textAlign: "right", fontWeight: 700, marginTop: 4 },
  label: { fontSize: 7.5, fontWeight: 700, color: C.muted, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 3 },
  body: { lineHeight: 1.4 },
  block: { marginBottom: 14 },
  h2: { fontSize: 11, fontWeight: 700, marginBottom: 4 },
  tableHead: { flexDirection: "row", backgroundColor: C.soft, padding: 5, fontWeight: 700, fontSize: 8, color: C.muted },
  tr: { flexDirection: "row", paddingVertical: 5, paddingHorizontal: 5, borderBottomWidth: 0.5, borderBottomColor: C.line },
  cDesc: { flex: 4 },
  cDetail: { flex: 2.5, color: C.muted },
  cAmt: { flex: 2, textAlign: "right" },
  totals: { alignSelf: "flex-end", width: 230, marginTop: 8 },
  tot: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  grand: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 5, borderTopWidth: 1, borderTopColor: C.ink, marginTop: 3, fontSize: 12, fontWeight: 700 },
  sign: { flexDirection: "row", gap: 24, marginTop: 18 },
  signBox: { flex: 1, borderTopWidth: 0.8, borderTopColor: C.ink, paddingTop: 3, fontSize: 8, color: C.muted },
  footer: { position: "absolute", bottom: 24, left: 40, right: 40, fontSize: 8, color: C.muted, textAlign: "center" },
});

export function Section({ title, body }: { title: string; body: string }) {
  if (!body.trim()) return null;
  return (
    <View style={s.block} wrap>
      <Text style={s.h2} minPresenceAhead={40}>{title}</Text>
      <Text style={s.body}>{body}</Text>
    </View>
  );
}

export function Table({ rows, heads }: { rows: { a: string; b: string; c: string }[]; heads: [string, string, string] }) {
  return (
    <View style={s.block}>
      <View style={s.tableHead}>
        <Text style={s.cDesc}>{heads[0]}</Text>
        <Text style={s.cDetail}>{heads[1]}</Text>
        <Text style={s.cAmt}>{heads[2]}</Text>
      </View>
      {rows.map((r, i) => (
        <View key={i} style={s.tr} wrap={false}>
          <Text style={s.cDesc}>{r.a}</Text>
          <Text style={s.cDetail}>{r.b}</Text>
          <Text style={s.cAmt}>{r.c}</Text>
        </View>
      ))}
    </View>
  );
}

export function QuotationPdf({ doc, logo }: { doc: QuotationDocument; logo: { data: Buffer; format: "png" | "jpg" } | null }) {
  return (
    <Document title={`${doc.title} ${doc.number}`} author={doc.business.name} creator="CodeQuote" producer="CodeQuote">
      <Page size="A4" style={s.page}>
        <Text
          fixed
          style={s.footer}
          render={({ pageNumber, totalPages }) => `${doc.business.name}  -  ${doc.number}  -  Page ${pageNumber} of ${totalPages}`}
        />
        <View style={s.head}>
          <View style={{ maxWidth: 270 }}>
            {logo && <Image src={logo} style={s.logo} />}
            <Text style={s.bizName}>{doc.business.name}</Text>
            {doc.business.lines.map((l, i) => (
              <Text key={i} style={s.muted}>{l}</Text>
            ))}
          </View>
          <View>
            <Text style={s.title}>{doc.title}</Text>
            <Text style={s.meta}>{doc.number}</Text>
            {doc.isDraft && <Text style={s.draft}>DRAFT, not yet sent</Text>}
            <Text style={[s.meta, s.muted]}>Issued: {doc.issueDate}</Text>
            <Text style={[s.meta, s.muted]}>Valid until: {doc.expiryDate}</Text>
          </View>
        </View>

        <View style={[s.row, s.block]}>
          <View style={{ flex: 1 }}>
            <Text style={s.label}>Prepared for</Text>
            <Text style={{ fontWeight: 700 }}>{doc.client.name}</Text>
            {doc.client.lines.map((l, i) => (
              <Text key={i} style={s.muted}>{l}</Text>
            ))}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.label}>Project</Text>
            <Text style={{ fontWeight: 700 }}>{doc.projectName}</Text>
            {doc.heading ? <Text style={s.muted}>{doc.heading}</Text> : null}
          </View>
        </View>

        <Section title="Scope of work" body={doc.text.scope} />
        <Section title="Deliverables" body={doc.text.deliverables} />
        <Section title="Exclusions" body={doc.text.exclusions} />

        <Table heads={["Item", "Detail", "Amount"]} rows={doc.lines.map((l) => ({ a: l.description, b: l.detail, c: l.amount }))} />
        <View style={s.totals} wrap={false}>
          <View style={s.tot}><Text>Subtotal</Text><Text>{doc.totals.subtotal}</Text></View>
          {doc.totals.discount && <View style={s.tot}><Text>Discount</Text><Text>-{doc.totals.discount}</Text></View>}
          <View style={s.grand}><Text>Total</Text><Text>{doc.totals.total}</Text></View>
        </View>

        {doc.recurring.length > 0 && (
          <View style={{ marginTop: 16 }}>
            <Text style={s.h2}>Recurring costs (not included in the total above)</Text>
            <Table heads={["Item", "Billed", "Amount"]} rows={doc.recurring.map((l) => ({ a: l.description, b: l.detail, c: l.amount }))} />
          </View>
        )}

        <View style={{ marginTop: 16 }} wrap={false}>
          <Text style={s.h2}>Payment schedule</Text>
          <Table heads={["Milestone", "Share", "Amount"]} rows={doc.schedule.map((m) => ({ a: m.label, b: m.percent, c: m.amount }))} />
        </View>

        <Section title="Estimated timeline" body={doc.text.timeline} />
        <Section title="Revision policy" body={doc.text.revisionPolicy} />
        <Section title="Terms and conditions" body={doc.text.terms} />

        <View wrap={false} style={{ marginTop: 10 }}>
          <Text style={s.h2}>Acceptance</Text>
          <Text>{doc.acceptance}</Text>
          <View style={s.sign}>
            <Text style={s.signBox}>Name</Text>
            <Text style={s.signBox}>Signature</Text>
            <Text style={s.signBox}>Date</Text>
          </View>
        </View>

      </Page>
    </Document>
  );
}

export type PdfLogo = { data: Buffer; format: "png" | "jpg" } | null;

export async function renderQuotationPdf(doc: QuotationDocument, logo: PdfLogo): Promise<Uint8Array> {
  return renderToBuffer(<QuotationPdf doc={doc} logo={logo} />);
}
