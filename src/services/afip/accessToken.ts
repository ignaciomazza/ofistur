function normalizedCuit(value: string | number): string {
  return String(value).replace(/\D/g, "");
}

/** Select the provider account by issuer, for both setup and invoicing. */
export function getAfipSdkAccessToken(cuit: string | number): string {
  const bypassCuit = normalizedCuit(process.env.AFIP_SDK_BYPASS_TAX_ID ?? "");
  if (bypassCuit.length === 11 && normalizedCuit(cuit) === bypassCuit) {
    const bypassToken = process.env.AFIP_SDK_BYPASS_ACCESS_TOKEN?.trim();
    if (!bypassToken) throw new Error("Falta el token de Afip SDK para este CUIT.");
    return bypassToken;
  }

  const defaultToken = process.env.AFIP_SDK_ACCESS_TOKEN || process.env.ACCESS_TOKEN;
  if (!defaultToken) throw new Error("Falta token de Afip SDK.");
  return defaultToken;
}
