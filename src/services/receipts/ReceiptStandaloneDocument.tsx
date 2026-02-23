// src/services/receipts/ReceiptStandaloneDocument.tsx
import React from "react";
import path from "path";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Image,
  Font,
} from "@react-pdf/renderer";
import { softWrapLongWords } from "@/lib/pdfText";
import { formatDateOnlyInBuenosAires } from "@/lib/buenosAiresDate";
import type { ReceiptPdfPaymentLine } from "./ReceiptDocument";

export type ReceiptStandalonePdfData = {
  receiptNumber: string;
  issueDate: Date;
  concept: string;
  amount: number;
  amountString: string;
  amountCurrency: string;
  paymentDescription?: string;
  paymentFeeAmount?: number;
  payments?: ReceiptPdfPaymentLine[];
  base_amount?: number | null;
  base_currency?: string | null;
  counter_amount?: number | null;
  counter_currency?: string | null;
  agency: {
    name: string;
    legalName: string;
    taxId: string;
    address: string;
    logoBase64?: string;
    logoMime?: string;
  };
  recipients: Array<{
    firstName: string;
    lastName: string;
    dni?: string | null;
    address?: string | null;
    locality?: string | null;
    companyName?: string | null;
  }>;
};

Font.register({
  family: "Poppins",
  fonts: [
    {
      src: path.join(process.cwd(), "public", "poppins", "Poppins-Regular.ttf"),
      fontWeight: "normal",
    },
    {
      src: path.join(process.cwd(), "public", "poppins", "Poppins-Bold.ttf"),
      fontWeight: "bold",
    },
  ],
});

const fmtNumber = (n: number) =>
  new Intl.NumberFormat("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);

const fmtCurrency = (value: number, curr: string) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: curr,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);

const safeFmtCurrency = (value: number, curr: string) => {
  if (/^[A-Z]{3}$/.test(curr)) {
    try {
      return fmtCurrency(value, curr);
    } catch {
      // fallback below
    }
  }
  return `${fmtNumber(value)} ${curr}`;
};

const fmtDate = (
  value: string | number | Date | null | undefined,
): string => {
  const formatted = formatDateOnlyInBuenosAires(value);
  return formatted === "-" ? "—" : formatted;
};

const CREDIT_METHOD_LABEL = "Crédito/corriente operador";
const VIRTUAL_CREDIT_METHOD_ID = 999000000;

const paymentLabel = (p: ReceiptPdfPaymentLine) => {
  const isVirtualCredit =
    typeof p.payment_method_id === "number" &&
    p.payment_method_id >= VIRTUAL_CREDIT_METHOD_ID;

  const pm =
    (p.paymentMethodName && p.paymentMethodName.trim()) ||
    (isVirtualCredit
      ? CREDIT_METHOD_LABEL
      : p.payment_method_id
        ? `Metodo N° ${p.payment_method_id}`
        : "Metodo");

  return pm;
};

const styles = StyleSheet.create({
  page: {
    fontFamily: "Poppins",
    fontSize: 10,
    padding: 56,
    color: "#1f2937",
    lineHeight: 1.45,
  },
  header: {
    marginBottom: 24,
    padding: 16,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 8,
    backgroundColor: "#f8fafc",
  },
  headerRow: { width: "100%", overflow: "hidden" },
  headerRightRow: { width: "100%", marginTop: 6 },
  headerLeft: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    width: "100%",
    minWidth: 0,
  },
  headerLeftText: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
    maxWidth: 320,
  },
  agencyName: { fontSize: 12, fontWeight: "bold", color: "#0f172a" },
  agencyMeta: { fontSize: 9, color: "#64748b" },
  logo: { height: 28, width: 120, objectFit: "contain", marginBottom: 4 },
  title: { fontSize: 14, fontWeight: "bold", textTransform: "uppercase" },
  subtitle: { fontSize: 9, marginBottom: 6, color: "#64748b" },
  sectionTitle: {
    fontSize: 11,
    fontWeight: "bold",
    marginBottom: 10,
    textTransform: "uppercase",
    color: "#0f172a",
  },
  section: {
    marginBottom: 18,
    padding: 10,
    borderRadius: 6,
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  label: { fontSize: 9, fontWeight: "bold", color: "#475569", marginBottom: 2 },
  amountBox: {
    marginTop: 10,
    marginBottom: 18,
    padding: 12,
    borderWidth: 1,
    borderColor: "#cbd5f5",
    borderRadius: 6,
    backgroundColor: "#eef2ff",
  },
  amountValue: { fontSize: 16, fontWeight: "bold", color: "#0f172a" },
  amountMeta: { fontSize: 8.5, color: "#64748b", marginTop: 3 },
  list: { marginTop: 4 },
  listItem: { fontSize: 9, marginBottom: 2, color: "#1f2937" },
  payLine: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 8,
    marginBottom: 5,
  },
  payLeft: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
    fontSize: 9.5,
    color: "#1f2937",
    paddingRight: 6,
  },
  payRight: {
    width: 118,
    flexShrink: 0,
    textAlign: "right",
    fontSize: 9.5,
    color: "#1f2937",
  },
  payMeta: { fontSize: 8.5, color: "#64748b" },
  divider: {
    height: 1,
    backgroundColor: "#e5e5e5",
    marginVertical: 16,
  },
});

export default function ReceiptStandaloneDocument(
  props: ReceiptStandalonePdfData,
) {
  const {
    receiptNumber,
    issueDate,
    concept,
    amount,
    amountString,
    amountCurrency,
    paymentDescription,
    paymentFeeAmount,
    payments = [],
    base_amount,
    base_currency,
    counter_amount,
    counter_currency,
    agency,
    recipients,
  } = props;

  const agencyNameSafe = softWrapLongWords(agency.name, { breakChar: " " });
  const agencyLegalSafe = softWrapLongWords(agency.legalName, {
    breakChar: " ",
  });

  const displayCurrency = amountCurrency || "ARS";
  const fee =
    typeof paymentFeeAmount === "number" && Number.isFinite(paymentFeeAmount)
      ? paymentFeeAmount
      : 0;
  const linesFeeTotal = payments.reduce(
    (acc, p) =>
      acc +
      (typeof p.fee_amount === "number" && Number.isFinite(p.fee_amount)
        ? p.fee_amount
        : 0),
    0,
  );
  const showLegacyGlobalFee = fee > 0 && linesFeeTotal <= 0.0001;
  const clientTotal = amount + fee;
  const displayAmount = safeFmtCurrency(clientTotal, displayCurrency);
  const amountStringLabel =
    fee > 0 ? "Importe en letras (acreditado)" : "Importe en letras";

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <View style={styles.headerLeft}>
              {agency.logoBase64 && agency.logoMime && (
                // eslint-disable-next-line jsx-a11y/alt-text
                <Image
                  style={styles.logo}
                  src={`data:${agency.logoMime};base64,${agency.logoBase64}`}
                />
              )}
              <View style={styles.headerLeftText}>
                <Text style={styles.agencyName}>{agencyNameSafe || "-"}</Text>
                <Text style={styles.agencyMeta}>{agencyLegalSafe || "-"}</Text>
                <Text style={styles.agencyMeta}>CUIT {agency.taxId || "-"}</Text>
                <Text style={styles.agencyMeta}>{agency.address || "-"}</Text>
              </View>
            </View>
          </View>
          <View style={styles.headerRightRow}>
            <Text style={styles.title}>Comprobante de Pago</Text>
            <Text style={styles.subtitle}>Recibo Nro {receiptNumber}</Text>
            <Text style={styles.subtitle}>Fecha: {fmtDate(issueDate)}</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Datos</Text>
        <View style={styles.section}>
          <Text style={styles.label}>Recibimos de</Text>
          <View style={styles.list}>
            {recipients.length > 0 ? (
              recipients.map((recipient, idx) => (
                <Text key={`${recipient.firstName}-${recipient.lastName}-${idx}`} style={styles.listItem}>
                  {softWrapLongWords(
                    [recipient.companyName, `${recipient.firstName} ${recipient.lastName}`.trim()]
                      .filter(Boolean)
                      .join(" - "),
                    { breakChar: " " },
                  )}
                </Text>
              ))
            ) : (
              <Text style={styles.listItem}>Pax no especificado</Text>
            )}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Concepto</Text>
          <Text>{softWrapLongWords(concept || "-", { breakChar: " " })}</Text>
        </View>

        <Text style={styles.sectionTitle}>Resumen de pago</Text>
        <View style={styles.amountBox}>
          <Text style={styles.label}>Total pagado</Text>
          <Text style={styles.amountValue}>{displayAmount}</Text>
          {fee > 0 ? (
            <>
              <Text style={styles.amountMeta}>
                Acreditado: {safeFmtCurrency(amount, displayCurrency)}
              </Text>
              <Text style={styles.amountMeta}>
                Costo financiero: {safeFmtCurrency(fee, displayCurrency)}
              </Text>
            </>
          ) : null}
          <Text style={{ fontSize: 9, marginTop: 6 }}>
            {amountStringLabel}:{" "}
            {softWrapLongWords(amountString, { breakChar: " " })}
          </Text>
        </View>

        {paymentDescription && (
          <View style={styles.section}>
            <Text style={styles.label}>Detalle de pago</Text>
            <Text>
              {softWrapLongWords(paymentDescription, { breakChar: " " })}
            </Text>
          </View>
        )}

        {payments.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.label}>Pagos</Text>
            <View style={styles.list}>
              {payments.map((p, idx) => (
                <View key={`${p.payment_method_id}-${idx}`}>
                  <View style={styles.payLine}>
                    <Text style={styles.payLeft}>
                      {softWrapLongWords(paymentLabel(p), {
                        maxWordLen: 18,
                        chunkLen: 10,
                        breakChar: " ",
                      })}
                    </Text>
                    <Text style={styles.payRight}>
                      {safeFmtCurrency(
                        p.amount,
                        (p.payment_currency || displayCurrency || "ARS").toUpperCase(),
                      )}
                    </Text>
                  </View>
                  {typeof p.fee_amount === "number" && p.fee_amount > 0 ? (
                    <Text style={styles.payMeta}>
                      Costo financiero:{" "}
                      {safeFmtCurrency(
                        p.fee_amount,
                        (p.payment_currency || displayCurrency || "ARS").toUpperCase(),
                      )}
                    </Text>
                  ) : null}
                </View>
              ))}
            </View>
            {showLegacyGlobalFee ? (
              <Text style={styles.payMeta}>
                Costo financiero: {safeFmtCurrency(fee, displayCurrency)}
              </Text>
            ) : null}
          </View>
        )}

        {(base_amount || counter_amount) && (
          <View style={styles.section}>
            <Text style={styles.label}>Conversion</Text>
            <Text>
              {base_amount != null && base_currency
                ? `${safeFmtCurrency(base_amount, base_currency)}`
                : "-"}
              {"  "}
              {counter_amount != null && counter_currency
                ? `-> ${safeFmtCurrency(counter_amount, counter_currency)}`
                : ""}
            </Text>
          </View>
        )}

        <View style={styles.divider} />

        <Text style={{ fontSize: 9, color: "#666" }}>
          Documento generado por el sistema de recibos de la agencia.
        </Text>
      </Page>
    </Document>
  );
}
