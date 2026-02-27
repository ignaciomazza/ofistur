import type React from "react";

export const moneyPrefix = (curr?: string | null) => {
  const code = String(curr || "")
    .trim()
    .toUpperCase();
  if (code === "ARS") return "$";
  if (code === "USD") return "US$";
  return code || "$";
};

export const formatIntegerEs = (digits: string) => {
  const normalized = digits.replace(/^0+(?=\d)/, "") || "0";
  return normalized.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
};

export const formatMoneyInput = (
  raw: string,
  curr?: string | null,
  options?: { preferDotDecimal?: boolean },
) => {
  const rawText = String(raw || "");
  const cleaned = rawText.replace(/[^\d.,]/g, "");
  if (!/\d/.test(cleaned)) return "";

  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  const hasComma = lastComma >= 0;
  const hasDot = lastDot >= 0;
  let preferDotDecimal = Boolean(options?.preferDotDecimal);

  // Solo inferimos "." decimal automáticamente en valores "crudos"
  // (sin prefijo/símbolos) para no romper borrado/edición en inputs formateados.
  if (!hasComma && hasDot && !preferDotDecimal) {
    const looksRawNumeric = !/[A-Za-z$]/.test(rawText) && !/\s/.test(rawText);
    if (looksRawNumeric) {
      const decimals = cleaned.length - lastDot - 1;
      preferDotDecimal = decimals > 0 && decimals <= 2;
    }
  }

  let sepIndex = -1;
  let intDigits = cleaned.replace(/[^\d]/g, "");
  let decDigits = "";
  let hasDecimal = false;

  if (hasComma) {
    sepIndex = lastComma;
  } else if (hasDot && preferDotDecimal) {
    sepIndex = lastDot;
  }

  if (sepIndex >= 0) {
    const before = cleaned.slice(0, sepIndex).replace(/[^\d]/g, "");
    const afterRaw = cleaned.slice(sepIndex + 1).replace(/[^\d]/g, "");
    hasDecimal = true;
    intDigits = before || "0";
    decDigits = afterRaw.slice(0, 2);
  }

  const intPart = formatIntegerEs(intDigits);
  const decPart = hasDecimal ? `,${decDigits}` : "";
  return `${moneyPrefix(curr)} ${intPart}${decPart}`;
};

export const shouldPreferDotDecimal = (ev: React.ChangeEvent<HTMLInputElement>) => {
  const native = ev.nativeEvent as InputEvent | undefined;
  const char = typeof native?.data === "string" ? native.data : "";
  if (char === "." || char === ",") return true;
  return native?.inputType === "insertFromPaste";
};
