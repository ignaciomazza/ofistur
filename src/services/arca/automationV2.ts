// Afip SDK Automations v1. Credentials and responses are never logged.
import { getAfipSdkAccessToken } from "@/services/afip/accessToken";
export type AutomationResult =
  | { status: "complete"; data: unknown }
  | { status: "pending"; id: string }
  | { status: "error"; error: string; retryable: boolean };

export async function runAutomation(
  automation: string,
  params: Record<string, unknown>,
  id?: string | null,
): Promise<AutomationResult> {
  const cuit = params.cuit;
  if (typeof cuit !== "string" && typeof cuit !== "number") {
    throw new Error("Falta el CUIT representado para Afip SDK.");
  }
  const accessToken = getAfipSdkAccessToken(cuit);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(
      `https://app.afipsdk.com/api/v1/automations${id ? `/${encodeURIComponent(id)}` : ""}`,
      {
        method: id ? "GET" : "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        ...(!id ? { body: JSON.stringify({ automation, params }) } : {}),
        signal: controller.signal,
      },
    );
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const status = String(body.status ?? "");
    const jobId = typeof body.id === "string" ? body.id : id;
    if (response.ok && status === "complete") {
      return { status: "complete", data: body.data };
    }
    if (response.ok && (status === "in_process" || status === "pending") && jobId) {
      return { status: "pending", id: jobId };
    }
    const detail =
      (typeof body.message === "string" && body.message) ||
      (typeof body.error === "string" && body.error) ||
      (typeof (body.data as { message?: unknown } | null)?.message === "string" &&
        (body.data as { message: string }).message) ||
      `Afip SDK devolvió ${response.status}`;
    return {
      status: "error",
      error: String(detail).replace(/\s+/g, " ").slice(0, 320),
      retryable: response.status === 429 || response.status >= 500,
    };
  } finally {
    clearTimeout(timeout);
  }
}
