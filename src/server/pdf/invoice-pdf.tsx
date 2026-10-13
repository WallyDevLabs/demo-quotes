import { Document, Image, Page, Text, View, renderToBuffer } from "@react-pdf/renderer";
import type { InvoiceDocument } from "@/domain/invoicing";
import { Section, Table, s, type PdfLogo } from "./quotation-pdf";

/**
 * Presentation only: every string comes from the pure invoice document model. The stored PDF is
 * made once, when the invoice is issued, and served unchanged: it shows the balance at issue.
 */
export function InvoicePdf({ doc, logo }: { doc: InvoiceDocument; logo: PdfLogo }) {
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
            {doc.isDraft && <Text style={s.draft}>DRAFT, not yet issued</Text>}
            <Text style={[s.meta, s.muted]}>Invoice date: {doc.invoiceDate}</Text>
            <Text style={[s.meta, s.muted]}>Due date: {doc.dueDate}</Text>
          </View>
        </View>

        <View style={[s.row, s.block]}>
          <View style={{ flex: 1 }}>
            <Text style={s.label}>Billed to</Text>
            <Text style={{ fontWeight: 700 }}>{doc.client.name}</Text>
            {doc.client.lines.map((l, i) => (
              <Text key={i} style={s.muted}>{l}</Text>
            ))}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.label}>Project</Text>
            <Text style={{ fontWeight: 700 }}>{doc.projectName}</Text>
            {doc.reference ? <Text style={s.muted}>{doc.reference}</Text> : null}
          </View>
        </View>

        <Table heads={["Description", "Reference", "Amount"]} rows={doc.lines.map((l) => ({ a: l.description, b: l.detail, c: l.amount }))} />
        <View style={s.totals} wrap={false}>
          {doc.totals.discount && (
            <>
              <View style={s.tot}><Text>Subtotal</Text><Text>{doc.totals.subtotal}</Text></View>
              <View style={s.tot}><Text>Discount</Text><Text>-{doc.totals.discount}</Text></View>
            </>
          )}
          <View style={s.grand}><Text>Total</Text><Text>{doc.totals.total}</Text></View>
          <View style={s.tot}><Text>Amount paid</Text><Text>{doc.totals.paid}</Text></View>
          <View style={[s.tot, { fontWeight: 700 }]}><Text>Balance due</Text><Text>{doc.totals.balance}</Text></View>
        </View>

        <View style={{ marginTop: 22, marginBottom: 12 }} wrap={false}>
          <Text style={s.h2}>Payment details</Text>
          {doc.banking.lines.map((l, i) => (
            <Text key={i}>{l}</Text>
          ))}
          <Text style={{ marginTop: 4, fontWeight: 700 }}>Payment reference: {doc.banking.reference}</Text>
        </View>
        <Section title="Payment instructions" body={doc.banking.instructions} />
      </Page>
    </Document>
  );
}

export async function renderInvoicePdf(doc: InvoiceDocument, logo: PdfLogo): Promise<Uint8Array> {
  return renderToBuffer(<InvoicePdf doc={doc} logo={logo} />);
}
