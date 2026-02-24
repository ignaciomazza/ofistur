type ErrorRecord = Record<string, unknown>;

function firstString(values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export function extractHttpErrorMessage(payload: unknown): string | null {
  if (!payload) return null;
  if (typeof payload === "string") {
    const trimmed = payload.trim();
    return trimmed || null;
  }
  if (typeof payload !== "object") return null;

  const rec = payload as ErrorRecord;
  const details =
    Array.isArray(rec.details) && rec.details.length
      ? rec.details
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter(Boolean)
          .join(" ")
      : null;

  return firstString([
    rec.error,
    rec.message,
    rec.msg,
    rec.detail,
    rec.reason,
    details,
  ]);
}

export function fallbackMessageByStatus(
  status: number,
  fallback: string,
): string {
  if (status === 401) return "Sesión expirada. Volvé a iniciar sesión.";
  if (status === 403) return "No tenés permisos para realizar esta acción.";
  if (status === 404) return "No se encontró el recurso solicitado.";
  if (status >= 500) return "Error interno del servidor.";
  return fallback;
}

export async function responseErrorMessage(
  res: Response,
  fallback: string,
): Promise<string> {
  try {
    const contentType = (res.headers.get("content-type") || "").toLowerCase();
    if (contentType.includes("application/json")) {
      const json = (await res.clone().json().catch(() => null)) as unknown;
      const parsed = extractHttpErrorMessage(json);
      if (parsed) return parsed;
    }

    const text = (await res.clone().text().catch(() => "")).trim();
    if (text) return text;
  } catch {
    // fallback below
  }

  return fallbackMessageByStatus(res.status, fallback);
}
