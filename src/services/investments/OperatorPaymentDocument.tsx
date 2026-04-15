// src/services/investments/OperatorPaymentDocument.tsx
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

export type OperatorPaymentPdfData = {
  paymentNumber: string;
  issueDate: Date;
  paidDate?: Date | null;
  category: string;
  description: string;
  amount: number;
  currency: string;
  paymentMethod?: string | null;
  account?: string | null;
  paymentFeeAmount?: number | null;
  payments?: Array<{
    amount: number;
    payment_method: string;
    account?: string | null;
    payment_currency: string;
    fee_mode?: "FIXED" | "PERCENT" | null;
    fee_value?: number | null;
    fee_amount?: number | null;
  }>;
  base_amount?: number | null;
  base_currency?: string | null;
  counter_amount?: number | null;
  counter_currency?: string | null;
  recipient: {
    id?: number | null;
    label?: string | null;
    name: string;
  };
  bookingNumbers?: string[];
  services?: Array<{
    id: number;
    isManual?: boolean;
    manualIndex?: number;
    description?: string | null;
    dateLabel?: string | null;
    serviceNumber?: number | null;
    bookingNumber?: number | null;
    type?: string | null;
    destination?: string | null;
    cost?: number | null;
    currency?: string | null;
  }>;
  service_breakdown?: Array<{
    service_id: number;
    service_label: string;
    service_currency: string;
    service_cost: number | null;
    balance_before: number | null;
    applied_in_payment: number | null;
    balance_after: number | null;
    estimated: boolean;
    unavailable: boolean;
    unavailable_reason?: "no_services" | "mixed_currency" | "missing_conversion" | null;
  }>;
  agency: {
    name: string;
    legalName: string;
    taxId: string;
    address: string;
    logoBase64?: string;
    logoMime?: string;
  };
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

const styles = StyleSheet.create({
  page: {
    fontFamily: "Poppins",
    fontSize: 10,
    padding: 56,
    color: "#1f2937",
    lineHeight: 1.45,
  },
  header: {
    marginBottom: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 8,
    backgroundColor: "#f8fafc",
  },
  headerRow: { width: "100%", overflow: "hidden" },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
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
  logo: { height: 28, width: 120, objectFit: "contain" },
  title: { fontSize: 14, fontWeight: "bold", textTransform: "uppercase" },
  subtitle: { fontSize: 9, color: "#64748b", marginTop: 2 },
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
  amountBox: {
    marginTop: 10,
    marginBottom: 18,
    padding: 12,
    borderWidth: 1,
    borderColor: "#cbd5f5",
    borderRadius: 6,
    backgroundColor: "#eef2ff",
  },
  amountLabel: { fontSize: 9, fontWeight: "bold", color: "#475569" },
  amountValue: { fontSize: 16, fontWeight: "bold", color: "#0f172a" },
  amountMeta: { fontSize: 8.5, color: "#64748b", marginTop: 3 },
  categoryValue: {
    fontSize: 11,
    fontWeight: "bold",
    color: "#0f172a",
    marginBottom: 6,
  },
  descriptionValue: { fontSize: 9.5, color: "#1f2937" },
  listItem: { fontSize: 9, marginBottom: 2, color: "#1f2937" },
  table: {
    width: "100%",
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 6,
    overflow: "hidden",
    marginBottom: 18,
    marginTop: 4,
  },
  headerCell: {
    flexDirection: "row",
    backgroundColor: "#e2e8f0",
    borderBottomWidth: 1,
    borderColor: "#cbd5e1",
  },
  row: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderColor: "#e2e8f0",
  },
  rowAlt: { backgroundColor: "#f8fafc" },
  cellDesc: { width: "72%", padding: 7, fontSize: 9, color: "#1f2937" },
  cellDate: {
    width: "28%",
    padding: 7,
    fontSize: 9,
    textAlign: "right",
    color: "#475569",
  },
  breakdownTable: {
    width: "100%",
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 6,
    overflow: "hidden",
    marginBottom: 18,
    marginTop: 4,
  },
  breakdownHeaderRow: {
    flexDirection: "row",
    backgroundColor: "#e2e8f0",
    borderBottomWidth: 1,
    borderColor: "#cbd5e1",
  },
  breakdownRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderColor: "#e2e8f0",
  },
  breakdownCellService: {
    width: "30%",
    padding: 6,
    fontSize: 8.2,
    color: "#1f2937",
  },
  breakdownCellAmount: {
    width: "14%",
    padding: 6,
    fontSize: 8.2,
    textAlign: "right",
    color: "#1f2937",
  },
  breakdownCellStatus: {
    width: "14%",
    padding: 6,
    fontSize: 8.2,
    color: "#475569",
  },
});

export default function OperatorPaymentDocument(props: OperatorPaymentPdfData) {
  const {
    paymentNumber,
    issueDate,
    category,
    description,
    amount,
    currency,
    paymentMethod,
    account,
    paymentFeeAmount,
    payments = [],
    base_amount,
    base_currency,
    counter_amount,
    counter_currency,
    recipient,
    services = [],
    service_breakdown = [],
    agency,
  } = props;

  const agencyNameSafe = softWrapLongWords(agency.name, { breakChar: " " });
  const agencyLegalSafe = softWrapLongWords(agency.legalName, {
    breakChar: " ",
  });

  const displayCurrency = currency || "ARS";
  const displayAmount = safeFmtCurrency(amount, displayCurrency);
  const hasBase =
    typeof base_amount === "number" &&
    Number.isFinite(base_amount) &&
    !!base_currency;
  const hasCounter =
    typeof counter_amount === "number" &&
    Number.isFinite(counter_amount) &&
    !!counter_currency;
  const hasPaymentLines = payments.length > 0;
  const hasLegacyPaymentDetails = Boolean(
    (paymentMethod && paymentMethod.trim()) || (account && account.trim()),
  );
  const recipientName = String(recipient.name || "").trim();
  const recipientLabel = String(recipient.label || "").trim();
  const hasRecipient = recipientName.length > 0;
  const effectivePaymentFee =
    typeof paymentFeeAmount === "number" && Number.isFinite(paymentFeeAmount)
      ? paymentFeeAmount
      : hasPaymentLines
        ? payments.reduce((sum, line) => sum + Number(line.fee_amount || 0), 0)
        : null;
  const serviceRows = services.map((svc) => {
    const manualDescription = String(svc.description || "").trim();
    const dateLabel = String(svc.dateLabel || "").trim();
    if (svc.isManual) {
      return {
        key: svc.id,
        description: softWrapLongWords(
          manualDescription || "Sin descripción",
          { breakChar: " " },
        ),
        date: dateLabel || "—",
      };
    }

    const pieces: string[] = [];
    const typeLabel = String(svc.type || "").trim();
    const destinationLabel = String(svc.destination || "").trim();
    if (typeLabel) pieces.push(typeLabel);
    if (destinationLabel) pieces.push(destinationLabel);
    if (pieces.length === 0) {
      pieces.push(`Servicio ${svc.serviceNumber ?? svc.id}`);
    }
    if (svc.bookingNumber != null) {
      pieces.push(`Res. ${svc.bookingNumber}`);
    }
    if (
      typeof svc.cost === "number" &&
      Number.isFinite(svc.cost) &&
      svc.currency
    ) {
      pieces.push(safeFmtCurrency(svc.cost, svc.currency));
    }

    return {
      key: svc.id,
      description: softWrapLongWords(pieces.join(" · "), { breakChar: " " }),
      date: dateLabel || "—",
    };
  });

  const serviceBreakdownRows = service_breakdown.map((row) => {
    const currency = row.service_currency || displayCurrency;
    const unavailableLabel =
      row.unavailable_reason === "mixed_currency"
        ? "sin conversión (multimoneda)"
        : row.unavailable_reason === "missing_conversion"
          ? "sin conversión"
          : "sin detalle";

    return {
      ...row,
      costText:
        row.service_cost == null
          ? "—"
          : safeFmtCurrency(row.service_cost, currency),
      beforeText:
        row.balance_before == null
          ? "—"
          : safeFmtCurrency(row.balance_before, currency),
      appliedText:
        row.applied_in_payment == null
          ? "—"
          : safeFmtCurrency(row.applied_in_payment, currency),
      afterText:
        row.balance_after == null
          ? "—"
          : safeFmtCurrency(row.balance_after, currency),
      statusText: row.unavailable
        ? `Estimado no disponible (${unavailableLabel})`
        : row.estimated
          ? "Estimado"
          : "Exacto",
    };
  });

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
                <Text style={styles.title}>Comprobante de pago</Text>
                <Text style={styles.subtitle}>N° {paymentNumber}</Text>
                <Text style={styles.subtitle}>Fecha: {fmtDate(issueDate)}</Text>
              </View>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Agencia</Text>
          <Text style={styles.listItem}>{agencyNameSafe}</Text>
          <Text style={styles.listItem}>{agencyLegalSafe}</Text>
          <Text style={styles.listItem}>CUIT: {agency.taxId}</Text>
          <Text style={styles.listItem}>
            {softWrapLongWords(agency.address, { breakChar: " " })}
          </Text>
        </View>

        {hasRecipient && (
          <View style={styles.section}>
          <Text style={styles.sectionTitle}>Destinatario</Text>
          <Text style={styles.listItem}>
            {softWrapLongWords(recipientName, { breakChar: " " })}
          </Text>
          {recipientLabel ? (
            <Text style={styles.listItem}>
              Tipo: {softWrapLongWords(recipientLabel, { breakChar: " " })}
            </Text>
          ) : null}
          {recipient.id ? (
            <Text style={styles.listItem}>ID: {recipient.id}</Text>
          ) : null}
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.categoryValue}>
            {softWrapLongWords(category, { breakChar: " " })}
          </Text>
          <Text style={styles.descriptionValue}>
            {softWrapLongWords(description, { breakChar: " " })}
          </Text>
        </View>

        <View style={styles.table}>
          <View style={styles.headerCell}>
            <Text style={styles.cellDesc}>Descripción</Text>
            <Text style={styles.cellDate}>Fecha</Text>
          </View>
          {serviceRows.length > 0 ? (
            serviceRows.map((row, idx) => (
              <View
                key={`${row.key}-${idx}`}
                style={idx % 2 ? [styles.row, styles.rowAlt] : styles.row}
              >
                <Text style={styles.cellDesc}>{row.description}</Text>
                <Text style={styles.cellDate}>{row.date}</Text>
              </View>
            ))
          ) : (
            <View style={styles.row}>
              <Text style={styles.cellDesc}>Sin ítems cargados.</Text>
              <Text style={styles.cellDate}>—</Text>
            </View>
          )}
        </View>

        {serviceBreakdownRows.length > 0 && (
          <View style={styles.breakdownTable}>
            <View style={styles.breakdownHeaderRow}>
              <Text style={styles.breakdownCellService}>Servicio</Text>
              <Text style={styles.breakdownCellAmount}>Costo</Text>
              <Text style={styles.breakdownCellAmount}>Saldo previo</Text>
              <Text style={styles.breakdownCellAmount}>Aplicado</Text>
              <Text style={styles.breakdownCellAmount}>Saldo posterior</Text>
              <Text style={styles.breakdownCellStatus}>Detalle</Text>
            </View>
            {serviceBreakdownRows.map((row, index) => (
              <View
                key={`${row.service_id}-${index}`}
                style={index % 2 ? [styles.breakdownRow, styles.rowAlt] : styles.breakdownRow}
              >
                <Text style={styles.breakdownCellService}>
                  {softWrapLongWords(row.service_label, { breakChar: " " })}
                </Text>
                <Text style={styles.breakdownCellAmount}>{row.costText}</Text>
                <Text style={styles.breakdownCellAmount}>{row.beforeText}</Text>
                <Text style={styles.breakdownCellAmount}>{row.appliedText}</Text>
                <Text style={styles.breakdownCellAmount}>{row.afterText}</Text>
                <Text style={styles.breakdownCellStatus}>
                  {softWrapLongWords(row.statusText, { breakChar: " " })}
                </Text>
              </View>
            ))}
          </View>
        )}

        <View style={styles.amountBox}>
          <Text style={styles.amountLabel}>Monto total</Text>
          <Text style={styles.amountValue}>{displayAmount}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Detalle del pago</Text>
          {hasPaymentLines ? (
            <>
              {payments.map((line, idx) => (
                <Text key={`${line.payment_method}-${idx}`} style={styles.listItem}>
                  {softWrapLongWords(
                    `#${idx + 1} · ${line.payment_method} · ${safeFmtCurrency(
                      Number(line.amount || 0),
                      line.payment_currency || displayCurrency,
                    )}${
                      line.account
                        ? ` · Cuenta: ${line.account}`
                        : " · Sin cuenta"
                    }${
                      Number(line.fee_amount || 0) > 0
                        ? ` · Costo financiero: ${safeFmtCurrency(
                            Number(line.fee_amount || 0),
                            line.payment_currency || displayCurrency,
                          )}`
                        : ""
                    }`,
                    { breakChar: " " },
                  )}
                </Text>
              ))}
            </>
          ) : (
            <>
              {paymentMethod ? (
                <Text style={styles.listItem}>
                  Método: {softWrapLongWords(paymentMethod, { breakChar: " " })}
                </Text>
              ) : null}
              {account ? (
                <Text style={styles.listItem}>
                  Cuenta: {softWrapLongWords(account, { breakChar: " " })}
                </Text>
              ) : null}
              {!hasLegacyPaymentDetails ? (
                <Text style={styles.listItem}>-</Text>
              ) : null}
            </>
          )}
          {effectivePaymentFee != null && Number(effectivePaymentFee) > 0 ? (
            <Text style={styles.listItem}>
              Costo financiero total:{" "}
              {safeFmtCurrency(Number(effectivePaymentFee), displayCurrency)}
            </Text>
          ) : null}
          {hasBase ? (
            <Text style={styles.listItem}>
              Valor base: {safeFmtCurrency(base_amount!, base_currency!)}
            </Text>
          ) : null}
          {hasCounter ? (
            <Text style={styles.listItem}>
              Contravalor: {safeFmtCurrency(counter_amount!, counter_currency!)}
            </Text>
          ) : null}
        </View>
      </Page>
    </Document>
  );
}
