const RECEIPT_PDF_ITEMS_PREFIX = "__OFISTUR_RECEIPT_PDF_ITEMS_V1__";

export type ReceiptPdfManualItem = {
  description: string;
  date_label?: string | null;
};

type ReceiptPdfItemsPayload = {
  version: 1;
  payment_detail?: string;
  items?: ReceiptPdfManualItem[];
  free_text?: string;
};

export type DecodedReceiptPdfItemsPayload = {
  paymentDetail: string;
  items: ReceiptPdfManualItem[];
  freeText: string;
  encoded: boolean;
};

function normalizeItem(raw: unknown): ReceiptPdfManualItem | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const description = String(obj.description || "").trim();
  if (!description) return null;
  const dateLabel = String(obj.date_label || "").trim();
  return {
    description,
    ...(dateLabel ? { date_label: dateLabel } : {}),
  };
}

export function normalizeReceiptPdfManualItems(
  items: unknown,
): ReceiptPdfManualItem[] {
  if (!Array.isArray(items)) return [];
  return items.map((item) => normalizeItem(item)).filter(Boolean) as ReceiptPdfManualItem[];
}

export function decodeReceiptPdfItemsPayload(
  raw: string | null | undefined,
): DecodedReceiptPdfItemsPayload {
  const value = String(raw || "").trim();
  if (!value) {
    return { paymentDetail: "", items: [], freeText: "", encoded: false };
  }

  if (!value.startsWith(RECEIPT_PDF_ITEMS_PREFIX)) {
    return { paymentDetail: value, items: [], freeText: "", encoded: false };
  }

  const encoded = value.slice(RECEIPT_PDF_ITEMS_PREFIX.length).trim();
  if (!encoded) {
    return { paymentDetail: "", items: [], freeText: "", encoded: true };
  }

  try {
    const parsed = JSON.parse(encoded) as ReceiptPdfItemsPayload;
    const paymentDetail = String(parsed?.payment_detail || "").trim();
    const freeText = String(parsed?.free_text || "").trim();
    return {
      paymentDetail,
      items: normalizeReceiptPdfManualItems(parsed?.items),
      freeText,
      encoded: true,
    };
  } catch {
    return { paymentDetail: value, items: [], freeText: "", encoded: false };
  }
}

export function encodeReceiptPdfItemsPayload(args: {
  paymentDetail: string;
  items: unknown;
  freeText?: string;
  enabled: boolean;
}): string {
  const paymentDetail = String(args.paymentDetail || "").trim();
  const items = normalizeReceiptPdfManualItems(args.items);
  const freeText = String(args.freeText || "").trim();
  if (!args.enabled || (items.length === 0 && !freeText)) return paymentDetail;

  const payload: ReceiptPdfItemsPayload = {
    version: 1,
    ...(paymentDetail ? { payment_detail: paymentDetail } : {}),
    items,
    ...(freeText ? { free_text: freeText } : {}),
  };
  return `${RECEIPT_PDF_ITEMS_PREFIX}${JSON.stringify(payload)}`;
}
