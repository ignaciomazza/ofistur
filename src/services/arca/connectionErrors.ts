type ProviderError = {
  message?: unknown;
  data?: unknown;
};

export function arcaErrorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const value = error as ProviderError;
    const data = value.data && typeof value.data === "object" ? value.data as ProviderError : null;
    const nested = data?.data && typeof data.data === "object" ? data.data as ProviderError : null;
    for (const candidate of [nested?.message, data?.message, value.message]) {
      if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    }
  }
  return "Error inesperado al conectar con ARCA";
}

export function isProviderCuitLimit(message: string): boolean {
  return /(?:alcanzaste|excediste|superaste).{0,50}l[ií]mite.{0,30}cuit|l[ií]mite.{0,30}cuit/i.test(message);
}

export function isMissingServiceAuthorization(message: string): boolean {
  return /not.?authorized|no (?:se encuentra |est[aá] )?autorizad[oa]|sin autorizaci[oó]n|servicio.{0,50}no (?:est[aá] )?habilitad[oa]|coe\.notAuthorized/i.test(message);
}

export function isInvalidCertificate(message: string): boolean {
  return /certificad[oa].{0,55}(?:revocad[oa]|vencid[oa]|inv[aá]lid[oa])|(?:revoked|expired|invalid).{0,40}certificat/i.test(message);
}
