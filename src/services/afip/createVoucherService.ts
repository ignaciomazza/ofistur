// src/services/afip/createVoucherService.ts
import type { NextApiRequest } from "next";
import {
  getAfipFromRequest,
  getAgencyCUITFromRequest,
  getAgencyIdFromRequest,
  type AfipClient,
} from "@/services/afip/afipConfig";
import { resolveSalesPoint } from "@/services/afip/salesPoints";
import qrcode from "qrcode";
import { Prisma } from "@prisma/client";
import {
  computeManualTotals,
  type ManualTotalsInput,
} from "@/services/afip/manualTotals";
import prisma from "@/lib/prisma";
import { toDateKeyInBuenosAires } from "@/lib/buenosAiresDate";

/** ---------------- Tipos ---------------- */
interface VoucherResponse {
  success: boolean;
  message: string;
  details?: Prisma.JsonObject;
  qrBase64?: string;
}

export interface VoucherLifecycleHooks {
  onPrepared?: (voucherData: Prisma.JsonObject) => Promise<void>;
  onAuthorized?: (details: Prisma.JsonObject) => Promise<void>;
}

export type VoucherRecoveryResponse =
  | {
      status: "AUTHORIZED";
      details: Prisma.JsonObject;
      qrBase64: string;
    }
  | { status: "NOT_FOUND" }
  | { status: "CONFLICT"; message: string }
  | { status: "ERROR"; message: string };

interface IVAEntry {
  Id: number;
  BaseImp: number;
  Importe: number;
}

type ServerStatus = { AppServer: string; DbServer: string; AuthServer: string };
type LastInfo = { CbteFch?: string | number } | null;

const round2 = (value: number): number => Number(value.toFixed(2));

function jsonNumber(value: Prisma.JsonValue | undefined): number {
  return Number(value ?? Number.NaN);
}

function jsonString(value: Prisma.JsonValue | undefined): string {
  return String(value ?? "").trim();
}

function sameMoney(
  left: Prisma.JsonValue | undefined,
  right: unknown,
): boolean {
  const a = Number(left);
  const b = Number(right);
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 0.01;
}

function sameNumberWhenReturned(
  prepared: Prisma.JsonObject,
  existing: Record<string, unknown>,
  key: string,
  tolerance = 0,
): boolean {
  if (existing[key] === undefined || existing[key] === null) return true;
  const left = Number(prepared[key]);
  const right = Number(existing[key]);
  return (
    Number.isFinite(left) &&
    Number.isFinite(right) &&
    Math.abs(left - right) <= tolerance
  );
}

function voucherMatchesPrepared(
  prepared: Prisma.JsonObject,
  existing: Record<string, unknown>,
): boolean {
  return (
    jsonNumber(prepared.DocTipo) === Number(existing.DocTipo) &&
    jsonNumber(prepared.DocNro) === Number(existing.DocNro) &&
    jsonNumber(prepared.CbteFch) === Number(existing.CbteFch) &&
    jsonString(prepared.MonId).toUpperCase() ===
      String(existing.MonId ?? "")
        .trim()
        .toUpperCase() &&
    sameMoney(prepared.ImpTotal, existing.ImpTotal) &&
    sameNumberWhenReturned(prepared, existing, "Concepto") &&
    sameNumberWhenReturned(prepared, existing, "FchServDesde") &&
    sameNumberWhenReturned(prepared, existing, "FchServHasta") &&
    sameNumberWhenReturned(prepared, existing, "FchVtoPago") &&
    sameNumberWhenReturned(prepared, existing, "ImpTotConc", 0.01) &&
    sameNumberWhenReturned(prepared, existing, "ImpOpEx", 0.01) &&
    sameNumberWhenReturned(prepared, existing, "ImpNeto", 0.01) &&
    sameNumberWhenReturned(prepared, existing, "ImpIVA", 0.01) &&
    sameNumberWhenReturned(prepared, existing, "MonCotiz", 0.000001) &&
    sameNumberWhenReturned(
      prepared,
      existing,
      "CondicionIVAReceptorId",
    )
  );
}

async function generateVoucherQrBase64(
  agencyCUIT: number,
  details: Prisma.JsonObject,
  qrDate?: string,
): Promise<string> {
  const authorizationCode =
    details.CAE ?? details.CodAutorizacion ?? details.CodAut;
  const qrPayload = {
    ver: 1,
    fecha: qrDate ?? String(details.CbteFch ?? ""),
    cuit: agencyCUIT,
    ptoVta: Number(details.PtoVta),
    tipoCmp: Number(details.CbteTipo),
    nroCmp: Number(details.CbteDesde),
    importe: Number(details.ImpTotal),
    moneda: String(details.MonId),
    ctz: Number(details.MonCotiz),
    tipoDocRec: Number(details.DocTipo),
    nroDocRec: Number(details.DocNro),
    tipoCodAut: "E",
    codAut: Number(authorizationCode),
  };

  if (!qrPayload.fecha || !Number.isFinite(qrPayload.codAut)) {
    throw new Error("No se pudo reconstruir el QR del comprobante autorizado.");
  }

  return qrcode.toDataURL(
    `https://www.afip.gob.ar/fe/qr/?p=${Buffer.from(
      JSON.stringify(qrPayload),
    ).toString("base64")}`,
  );
}

export async function recoverPreparedVoucherService(
  req: NextApiRequest,
  prepared: Prisma.JsonObject,
): Promise<VoucherRecoveryResponse> {
  try {
    const ptoVta = jsonNumber(prepared.PtoVta);
    const cbteTipo = jsonNumber(prepared.CbteTipo);
    const voucherNumber = jsonNumber(prepared.CbteDesde);
    if (
      !Number.isInteger(ptoVta) ||
      ptoVta <= 0 ||
      !Number.isInteger(cbteTipo) ||
      cbteTipo <= 0 ||
      !Number.isInteger(voucherNumber) ||
      voucherNumber <= 0
    ) {
      return {
        status: "ERROR",
        message: "El intento guardado no tiene una numeración ARCA válida.",
      };
    }

    const afipClient = await getAfipFromRequest(req);
    let existing: Record<string, unknown> | null = null;
    try {
      existing = (await afipClient.ElectronicBilling.getVoucherInfo(
        voucherNumber,
        ptoVta,
        cbteTipo,
      )) as Record<string, unknown> | null;
    } catch {
      existing = null;
    }

    if (!existing) {
      const lastVoucher = Number(
        await afipClient.ElectronicBilling.getLastVoucher(ptoVta, cbteTipo),
      );
      if (Number.isFinite(lastVoucher) && lastVoucher < voucherNumber) {
        return { status: "NOT_FOUND" };
      }
      return {
        status: "ERROR",
        message:
          "ARCA no permitió confirmar si el comprobante pendiente fue autorizado.",
      };
    }

    if (!voucherMatchesPrepared(prepared, existing)) {
      return {
        status: "CONFLICT",
        message:
          "El número reservado en ARCA pertenece a otro comprobante. El intento requiere revisión antes de continuar.",
      };
    }

    const details: Prisma.JsonObject = {
      ...prepared,
      ...(existing as Prisma.JsonObject),
      PtoVta: ptoVta,
      CbteTipo: cbteTipo,
      CbteDesde: voucherNumber,
      CbteHasta: voucherNumber,
      CAE: String(
        existing.CAE ?? existing.CodAutorizacion ?? existing.CodAut ?? "",
      ),
      CAEFchVto: String(
        existing.CAEFchVto ?? existing.FchVto ?? existing.FchVtoCAE ?? "",
      ),
    };
    if (!details.CAE) {
      return {
        status: "ERROR",
        message: "ARCA devolvió el comprobante sin código de autorización.",
      };
    }

    const agencyCUIT = await getAgencyCUITFromRequest(req);
    const qrBase64 = await generateVoucherQrBase64(agencyCUIT, details);
    return { status: "AUTHORIZED", details, qrBase64 };
  } catch (error) {
    return {
      status: "ERROR",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function splitZeroVatEntries(entries: IVAEntry[]): {
  taxableEntries: IVAEntry[];
  zeroVatBase: number;
} {
  let zeroVatBase = 0;
  const taxableEntries: IVAEntry[] = [];

  entries.forEach((entry) => {
    const base = round2(Number(entry.BaseImp || 0));
    const importe = round2(Number(entry.Importe || 0));
    if (base <= 0 && importe <= 0) return;

    if (Math.abs(importe) <= 0.01) {
      zeroVatBase = round2(zeroVatBase + Math.max(base, 0));
      return;
    }

    taxableEntries.push({
      Id: entry.Id,
      BaseImp: base,
      Importe: importe,
    });
  });

  return { taxableEntries, zeroVatBase };
}

function getAfipErrorDetails(err: unknown): Record<string, unknown> {
  if (!err || typeof err !== "object") return { message: String(err ?? "") };
  const anyErr = err as {
    message?: unknown;
    response?: { status?: unknown; statusText?: unknown; data?: unknown };
    status?: unknown;
    statusText?: unknown;
    data?: unknown;
  };
  return {
    message: anyErr.message ?? String(err),
    status: anyErr.response?.status ?? anyErr.status,
    statusText: anyErr.response?.statusText ?? anyErr.statusText,
    responseData: anyErr.response?.data ?? anyErr.data,
  };
}

// /** -------------- Helpers de contexto (AFIP + CUIT) -------------- */
// function parseCUIT(raw?: string | null): number {
//   const digits = (raw ?? "").replace(/\D/g, "");
//   return digits ? parseInt(digits, 10) : 0;
// }

// async function resolveAgencyCUITFromRequest(
//   req: NextApiRequest,
// ): Promise<number> {
//   const userIdHeader = req.headers["x-user-id"];
//   const uid =
//     typeof userIdHeader === "string"
//       ? parseInt(userIdHeader, 10)
//       : Array.isArray(userIdHeader)
//         ? parseInt(userIdHeader[0] ?? "", 10)
//         : NaN;

//   if (!Number.isNaN(uid) && uid > 0) {
//     // Buscamos la agencia del usuario y su CUIT (tax_id)
//     const user = await prisma.user.findUnique({
//       where: { id_user: uid },
//       select: { id_agency: true },
//     });

//     if (user?.id_agency) {
//       const agency = await prisma.agency.findUnique({
//         where: { id_agency: user.id_agency },
//         select: { tax_id: true },
//       });
//       const cuit = parseCUIT(agency?.tax_id);
//       if (cuit) return cuit;
//     }
//   }

//   // Sin fallback a .env: si no hay CUIT, cortamos acá.
//   throw new Error("No se pudo resolver el CUIT de la agencia del usuario.");
// }

/** -------------- Cotización con AFIP (últimos 5 días hábiles) -------------- */
function isWeekend(date: Date): boolean {
  const d = date.getDay();
  return d === 0 || d === 6;
}

async function getValidExchangeRate(
  client: AfipClient,
  currency: string,
  startDate: Date,
): Promise<number> {
  const date = new Date(startDate);
  for (let i = 0; i < 5; i++) {
    if (isWeekend(date)) {
      date.setDate(date.getDate() - 1);
      continue;
    }
    const formatted = (toDateKeyInBuenosAires(date) ?? "").replace(/-/g, "");
    try {
      const resp = await client.ElectronicBilling.executeRequest(
        "FEParamGetCotizacion",
        { MonId: currency, FchCotiz: formatted },
      );
      const rateStr = resp?.ResultGet?.MonCotiz;
      const rate = rateStr ? parseFloat(rateStr) : NaN;
      if (!Number.isNaN(rate) && rate > 0) return rate;
    } catch {
      // intento siguiente día
    }
    date.setDate(date.getDate() - 1);
  }

  if (process.env.AFIP_ENV === "testing") {
    console.warn("[createVoucherService] Testing mode: defaulting rate to 1");
    return 1;
  }
  throw new Error("No se pudo obtener cotización");
}

/** -------------- Servicio principal -------------- */
export async function createVoucherService(
  req: NextApiRequest, // necesitamos el request para detectar la agencia del usuario
  tipoFactura: number,
  receptorDocNumber: string,
  receptorDocTipo: number,
  serviceDetails: Array<{
    sale_price: number;
    taxableBase21: number;
    commission21: number;
    tax_21: number;
    vatOnCommission21: number;
    taxableBase10_5?: number | null;
    commission10_5?: number | null;
    tax_105?: number | null;
    vatOnCommission10_5?: number | null;
    taxableCardInterest?: number | null;
    vatOnCardInterest?: number | null;
    nonComputable?: number | null;
    exempt?: number | null;
    return_date: Date;
    departure_date: Date;
  }>,
  currency: string,
  exchangeRateManual?: number,
  invoiceDate?: string,
  manualTotals?: ManualTotalsInput,
  lifecycle?: VoucherLifecycleHooks,
): Promise<VoucherResponse> {
  try {
    // 1) Resolver AFIP según la agencia del usuario + CUIT real de esa agencia
    const afipClient = await getAfipFromRequest(req);
    const agencyCUIT = await getAgencyCUITFromRequest(req);

    let adjustedTotal = 0;
    let totalIVA = 0;
    let neto = 0;
    let mergedIvaEntries: IVAEntry[] = [];
    let impTotConc = 0;
    let impOpEx = 0;

    if (manualTotals) {
      const manual = computeManualTotals(manualTotals);
      if (!manual.ok) {
        return { success: false, message: manual.error };
      }
      adjustedTotal = manual.result.impTotal;
      impOpEx = parseFloat(
        manual.result.ivaEntries
          .filter((entry) => entry.Id === 3)
          .reduce((sum, entry) => sum + Number(entry.BaseImp || 0), 0)
          .toFixed(2),
      );
      mergedIvaEntries = manual.result.ivaEntries
        .filter((entry) => entry.Id !== 3)
        .map((entry) => ({
          Id: entry.Id,
          BaseImp: parseFloat(Number(entry.BaseImp || 0).toFixed(2)),
          Importe: parseFloat(Number(entry.Importe || 0).toFixed(2)),
        }));
      totalIVA = parseFloat(
        mergedIvaEntries
          .reduce((sum, entry) => sum + entry.Importe, 0)
          .toFixed(2),
      );
      neto = parseFloat(
        mergedIvaEntries
          .reduce((sum, entry) => sum + entry.BaseImp, 0)
          .toFixed(2),
      );
    } else {
      // 2) Totales
      const saleTotal = serviceDetails.reduce(
        (sum, s) => sum + s.sale_price,
        0,
      );
      const interestBase = serviceDetails.reduce(
        (sum, s) => sum + (s.taxableCardInterest ?? 0),
        0,
      );
      const interestVat = serviceDetails.reduce(
        (sum, s) => sum + (s.vatOnCardInterest ?? 0),
        0,
      );
      adjustedTotal = parseFloat(
        (saleTotal + interestBase + interestVat).toFixed(2),
      );

      // 3) IVA
      const base21 = serviceDetails.reduce(
        (sum, s) => sum + s.taxableBase21 + s.commission21,
        0,
      );
      const imp21 = serviceDetails.reduce(
        (sum, s) => sum + s.tax_21 + s.vatOnCommission21,
        0,
      );
      const base10_5 = serviceDetails.reduce(
        (sum, s) => sum + (s.taxableBase10_5 ?? 0) + (s.commission10_5 ?? 0),
        0,
      );
      const imp10_5 = serviceDetails.reduce(
        (sum, s) => sum + (s.tax_105 ?? 0) + (s.vatOnCommission10_5 ?? 0),
        0,
      );
      const explicitNoGravado = round2(
        serviceDetails.reduce(
          (sum, s) => sum + Number(s.nonComputable ?? 0),
          0,
        ),
      );
      const explicitExento = round2(
        serviceDetails.reduce((sum, s) => sum + Number(s.exempt ?? 0), 0),
      );

      const ivaEntries: IVAEntry[] = [];
      if (base21 || imp21)
        ivaEntries.push({
          Id: 5,
          BaseImp: +base21.toFixed(2),
          Importe: +imp21.toFixed(2),
        });
      if (base10_5 || imp10_5)
        ivaEntries.push({
          Id: 4,
          BaseImp: +base10_5.toFixed(2),
          Importe: +imp10_5.toFixed(2),
        });
      if (interestBase || interestVat)
        ivaEntries.push({
          Id: 5,
          BaseImp: +interestBase.toFixed(2),
          Importe: +interestVat.toFixed(2),
        });

      mergedIvaEntries = Object.values(
        ivaEntries.reduce(
          (acc, cur) => {
            if (!acc[cur.Id]) acc[cur.Id] = { ...cur };
            else {
              acc[cur.Id].BaseImp += cur.BaseImp;
              acc[cur.Id].Importe += cur.Importe;
            }
            return acc;
          },
          {} as Record<number, IVAEntry>,
        ),
      ).map((e) => ({
        Id: e.Id,
        BaseImp: parseFloat(e.BaseImp.toFixed(2)),
        Importe: parseFloat(e.Importe.toFixed(2)),
      }));

      const { taxableEntries, zeroVatBase } =
        splitZeroVatEntries(mergedIvaEntries);
      mergedIvaEntries = taxableEntries;

      totalIVA = parseFloat(
        mergedIvaEntries.reduce((sum, e) => sum + e.Importe, 0).toFixed(2),
      );
      const netoCalculado = parseFloat((adjustedTotal - totalIVA).toFixed(2));
      const netoGravado = parseFloat(
        mergedIvaEntries.reduce((sum, e) => sum + e.BaseImp, 0).toFixed(2),
      );
      const conceptosNoGravados = parseFloat(
        (
          netoCalculado -
          netoGravado -
          explicitNoGravado -
          explicitExento -
          zeroVatBase
        ).toFixed(2),
      );

      if (conceptosNoGravados < -0.01) {
        return {
          success: false,
          message:
            "No se pudo emitir: el neto gravado supera el neto total calculado. Revisá el desglose fiscal.",
        };
      }

      neto = netoGravado;
      impTotConc = explicitNoGravado;
      impOpEx = round2(
        explicitExento +
          zeroVatBase +
          (conceptosNoGravados > 0 ? conceptosNoGravados : 0),
      );
    }

    // 4) Estado AFIP / pto. de venta / numeración
    const status =
      (await afipClient.ElectronicBilling.getServerStatus()) as ServerStatus;
    if (
      status.AppServer !== "OK" ||
      status.DbServer !== "OK" ||
      status.AuthServer !== "OK"
    ) {
      throw new Error("AFIP no disponible");
    }

    const agencyId = await getAgencyIdFromRequest(req);
    const pref = await prisma.agencyArcaConfig.findUnique({
      where: { agencyId },
      select: { selectedSalesPoint: true },
    });
    const ptoVta = await resolveSalesPoint(
      afipClient,
      pref?.selectedSalesPoint ?? null,
    );

    const lastVoucherRaw = await afipClient.ElectronicBilling.getLastVoucher(
      ptoVta,
      tipoFactura,
    );
    const lastVoucherNumber = Number(lastVoucherRaw);
    if (!Number.isFinite(lastVoucherNumber) || lastVoucherNumber < 0) {
      throw new Error("No se pudo obtener el ultimo comprobante.");
    }
    const next = lastVoucherNumber + 1;
    if (next > 99999999) {
      throw new Error(
        "El numero de comprobante supera el maximo permitido. Crea un nuevo punto de venta.",
      );
    }

    const lastInfo =
      lastVoucherNumber > 0
        ? ((await afipClient.ElectronicBilling.getVoucherInfo(
            lastVoucherNumber,
            ptoVta,
            tipoFactura,
          )) as LastInfo)
        : null;
    const lastDate = lastInfo ? parseInt(String(lastInfo.CbteFch), 10) : null;

    // 5) Fechas
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const todayStrFallback = `${yyyy}${mm}${dd}`;

    const cbteFch = invoiceDate
      ? parseInt(invoiceDate.replace(/-/g, ""), 10)
      : lastDate && Number(todayStrFallback) < lastDate
        ? lastDate
        : Number(todayStrFallback);

    const condId = tipoFactura === 6 ? 5 : 1;

    const cotiz =
      currency === "PES"
        ? 1
        : (exchangeRateManual ??
          (await getValidExchangeRate(
            afipClient,
            currency,
            new Date(Date.now() - 86400000),
          )));

    const fmt = (d: Date) =>
      parseInt((toDateKeyInBuenosAires(d) ?? "").replace(/-/g, ""), 10);
    const allFrom = serviceDetails.map((s) => fmt(s.departure_date));
    const allTo = serviceDetails.map((s) => fmt(s.return_date));
    const FchServDesde = Math.min(...allFrom);
    const FchServHasta = Math.max(...allTo);
    const FchVtoPago = cbteFch;

    // 6) Envío a AFIP
    const voucherData: Prisma.JsonObject = {
      CantReg: 1,
      PtoVta: ptoVta,
      CbteTipo: tipoFactura,
      Concepto: 2,
      DocTipo: receptorDocTipo,
      DocNro: Number(receptorDocNumber),
      CbteDesde: next,
      CbteHasta: next,
      CbteFch: cbteFch,
      FchServDesde,
      FchServHasta,
      FchVtoPago,
      ImpTotal: adjustedTotal,
      ImpTotConc: impTotConc,
      ImpOpEx: impOpEx,
      ImpNeto: neto,
      ImpIVA: totalIVA,
      MonId: currency,
      MonCotiz: cotiz,
      ...(totalIVA > 0 && mergedIvaEntries.length > 0
        ? { Iva: mergedIvaEntries as unknown as Prisma.JsonArray }
        : {}),
      CondicionIVAReceptorId: condId,
    };

    await lifecycle?.onPrepared?.(voucherData);

    const created =
      await afipClient.ElectronicBilling.createVoucher(voucherData);
    if (!created.CAE) {
      return { success: false, message: "CAE no devuelto" };
    }

    const details = { ...voucherData, ...created } as Prisma.JsonObject;
    await lifecycle?.onAuthorized?.(details);

    // 7) QR con CUIT de la agencia del usuario (resuelto desde DB)
    const qrFecha = invoiceDate
      ? invoiceDate.replace(/-/g, "")
      : todayStrFallback;
    const qrBase64 = await generateVoucherQrBase64(
      agencyCUIT,
      details,
      qrFecha,
    );

    return {
      success: true,
      message: "Factura creada exitosamente.",
      details,
      qrBase64,
    };
  } catch (err) {
    console.error("[createVoucherService] Error", getAfipErrorDetails(err));
    return { success: false, message: (err as Error).message };
  }
}
