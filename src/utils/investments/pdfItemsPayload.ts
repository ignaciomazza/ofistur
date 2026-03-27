const INVESTMENT_PDF_ITEMS_PREFIX = "__OFISTUR_INVESTMENT_PDF_ITEMS_V1__";

export type InvestmentPdfManualItem = {
  description: string;
  date_label?: string | null;
};

type InvestmentPdfItemsPayload = {
  version: 1;
  counterparty_name?: string;
  items?: InvestmentPdfManualItem[];
};

export type DecodedInvestmentPdfItemsPayload = {
  counterpartyName: string;
  items: InvestmentPdfManualItem[];
  encoded: boolean;
};

function normalizeItem(raw: unknown): InvestmentPdfManualItem | null {
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

export function normalizeInvestmentPdfManualItems(
  items: unknown,
): InvestmentPdfManualItem[] {
  if (!Array.isArray(items)) return [];
  return items.map((item) => normalizeItem(item)).filter(Boolean) as InvestmentPdfManualItem[];
}

export function decodeInvestmentPdfItemsPayload(
  raw: string | null | undefined,
): DecodedInvestmentPdfItemsPayload {
  const value = String(raw || "").trim();
  if (!value) {
    return { counterpartyName: "", items: [], encoded: false };
  }

  if (!value.startsWith(INVESTMENT_PDF_ITEMS_PREFIX)) {
    return { counterpartyName: value, items: [], encoded: false };
  }

  const encoded = value.slice(INVESTMENT_PDF_ITEMS_PREFIX.length).trim();
  if (!encoded) {
    return { counterpartyName: "", items: [], encoded: true };
  }

  try {
    const parsed = JSON.parse(encoded) as InvestmentPdfItemsPayload;
    const counterpartyName = String(parsed?.counterparty_name || "").trim();
    return {
      counterpartyName,
      items: normalizeInvestmentPdfManualItems(parsed?.items),
      encoded: true,
    };
  } catch {
    return { counterpartyName: value, items: [], encoded: false };
  }
}

export function isEncodedInvestmentPdfItemsPayload(
  raw: string | null | undefined,
): boolean {
  return String(raw || "").trim().startsWith(INVESTMENT_PDF_ITEMS_PREFIX);
}

export function encodeInvestmentPdfItemsPayload(args: {
  counterpartyName: string;
  items: unknown;
  enabled: boolean;
}): string {
  const counterpartyName = String(args.counterpartyName || "").trim();
  const items = normalizeInvestmentPdfManualItems(args.items);
  if (!args.enabled || items.length === 0) return counterpartyName;

  const payload: InvestmentPdfItemsPayload = {
    version: 1,
    ...(counterpartyName ? { counterparty_name: counterpartyName } : {}),
    items,
  };
  return `${INVESTMENT_PDF_ITEMS_PREFIX}${JSON.stringify(payload)}`;
}
