import { normalizeCurrencyCode } from "@/lib/groups/financeShared";

export type GroupInvoiceServiceAmount = {
  serviceId: number;
  currency: string | null;
  amount: number;
};

export type GroupInvoiceServiceTotalsResult =
  | {
      ok: true;
      currency: string;
      total: number;
    }
  | {
      ok: false;
      code:
        | "GROUP_FINANCE_INVOICE_SERVICE_NOT_FOUND"
        | "GROUP_FINANCE_INVOICE_CURRENCY_MIX_NOT_ALLOWED";
      message: string;
    };

export function calculateGroupInvoiceServiceTotals(args: {
  requestedServiceIds: number[];
  services: GroupInvoiceServiceAmount[];
}): GroupInvoiceServiceTotalsResult {
  const requested = Array.from(
    new Set(
      args.requestedServiceIds
        .map((value) => Math.trunc(Number(value)))
        .filter((value) => Number.isFinite(value) && value > 0),
    ),
  );
  const byId = new Map(args.services.map((service) => [service.serviceId, service]));
  const missing = requested.filter((serviceId) => !byId.has(serviceId));
  if (missing.length > 0) {
    return {
      ok: false,
      code: "GROUP_FINANCE_INVOICE_SERVICE_NOT_FOUND",
      message:
        "Algún servicio seleccionado ya no está disponible para este pasajero.",
    };
  }

  const currencies = new Set(
    requested.map((serviceId) =>
      normalizeCurrencyCode(byId.get(serviceId)?.currency || "ARS"),
    ),
  );
  if (currencies.size > 1) {
    return {
      ok: false,
      code: "GROUP_FINANCE_INVOICE_CURRENCY_MIX_NOT_ALLOWED",
      message:
        "Emití una factura por moneda: no se pueden sumar servicios de monedas distintas.",
    };
  }

  const total = requested.reduce((sum, serviceId) => {
    const amount = Number(byId.get(serviceId)?.amount ?? 0);
    return sum + (Number.isFinite(amount) ? amount : 0);
  }, 0);
  return {
    ok: true,
    currency: Array.from(currencies)[0] || "ARS",
    total: Number(total.toFixed(2)),
  };
}
