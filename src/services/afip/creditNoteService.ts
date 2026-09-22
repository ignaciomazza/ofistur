// src/services/afip/creditNoteService.ts
import type { NextApiRequest } from "next";
import { Prisma } from "@prisma/client";
import qrcode from "qrcode";
import {
  getAfipFromRequest,
  getAgencyCUITFromRequest,
  getAgencyIdFromRequest,
  type AfipClient,
} from "@/services/afip/afipConfig";
import { resolveSalesPoint } from "@/services/afip/salesPoints";
import prisma from "@/lib/prisma";
import { toDateKeyInBuenosAires } from "@/lib/buenosAiresDate";

export interface IVAEntry {
  Id: number; // 5 = 21%, 4 = 10.5%
  BaseImp: number;
  Importe: number;
}

export interface ServiceDetail {
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
}

export interface CreditNoteVoucherResponse {
  success: boolean;
  message: string;
  details?: Prisma.JsonObject;
  qrBase64?: string;
}

/** Tipos de respuesta AFIP que usamos en este módulo */
type ServerStatus = { AppServer: string; DbServer: string; AuthServer: string };
type VoucherInfo = { CbteFch?: string | number } | null;
type CreateVoucherResp = { CAE?: string; CAEFchVto?: string };
type CotizResp = { ResultGet?: { MonCotiz?: string } };

const round2 = (value: number): number => Number(value.toFixed(2));

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

function isWeekend(date: Date): boolean {
  const d = date.getDay();
  return d === 0 || d === 6;
}

/** Busca cotización hacia atrás hasta 5 días hábiles, segura para TS */
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
      const resp = (await client.ElectronicBilling.executeRequest(
        "FEParamGetCotizacion",
        { MonId: currency, FchCotiz: formatted },
      )) as CotizResp;

      const mon = resp?.ResultGet?.MonCotiz;
      const rate = mon != null ? Number(mon) : NaN;

      if (Number.isFinite(rate) && rate > 0) return rate;
    } catch {
      // ignoramos y retrocedemos un día
    }
    date.setDate(date.getDate() - 1);
  }

  if (process.env.AFIP_ENV === "testing") return 1;
  throw new Error("No se pudo obtener cotización");
}

/**
 * Emite Nota de Crédito (A=3 / B=8) en AFIP para la agencia del usuario del request.
 * - Usa el CUIT real de la agencia para el QR (no .env).
 * - Si hay fechas de servicio, Concepto = 2 y se informan FchServDesde/Hasta/Vto.
 * - Acepta cotización manual o la busca automáticamente (últimos 5 días hábiles).
 */
export async function createCreditNoteVoucher(
  req: NextApiRequest,
  tipoNota: 3 | 8, // 3 = NC A, 8 = NC B
  receptorDocNumber: string,
  receptorDocTipo: number, // 80 = CUIT, 96 = DNI
  serviceDetails: ServiceDetail[],
  currency: string, // "PES" | "DOL" | "EUR" | ...
  exchangeRateManual?: number,
  invoiceDate?: string, // YYYY-MM-DD
  cbtesAsoc?: Array<{ Tipo: number; PtoVta: number; Nro: number }>,
  serviceDates?: Array<{ id_service: number; from: string; to: string }>, // YYYY-MM-DD
): Promise<CreditNoteVoucherResponse> {
  try {
    // ===== 1) Contexto AFIP y CUIT de la agencia del usuario =====
    const afipClient = await getAfipFromRequest(req);
    const agencyCUIT = await getAgencyCUITFromRequest(req);

    // ===== 2) Totales y ajustes =====
    const saleTotal = serviceDetails.reduce((sum, s) => sum + s.sale_price, 0);
    const interestBase = serviceDetails.reduce(
      (sum, s) => sum + (s.taxableCardInterest ?? 0),
      0,
    );
    const interestVat = serviceDetails.reduce(
      (sum, s) => sum + (s.vatOnCardInterest ?? 0),
      0,
    );
    const adjustedTotal = parseFloat(
      (saleTotal + interestBase + interestVat).toFixed(2),
    );

    // ===== 3) Líneas IVA =====
    const base21 = serviceDetails.reduce(
      (sum, s) => sum + s.taxableBase21 + s.commission21,
      0,
    );
    const imp21 = serviceDetails.reduce(
      (sum, s) => sum + s.tax_21 + s.vatOnCommission21,
      0,
    );
    const base10 = serviceDetails.reduce(
      (sum, s) => sum + (s.taxableBase10_5 ?? 0) + (s.commission10_5 ?? 0),
      0,
    );
    const imp10 = serviceDetails.reduce(
      (sum, s) => sum + (s.tax_105 ?? 0) + (s.vatOnCommission10_5 ?? 0),
      0,
    );
    const noGravadoExplicito = round2(
      serviceDetails.reduce((sum, s) => sum + Number(s.nonComputable ?? 0), 0),
    );
    const exentoExplicito = round2(
      serviceDetails.reduce((sum, s) => sum + Number(s.exempt ?? 0), 0),
    );

    const ivaEntries: IVAEntry[] = [];
    if (base21 || imp21)
      ivaEntries.push({
        Id: 5,
        BaseImp: +base21.toFixed(2),
        Importe: +imp21.toFixed(2),
      });
    if (base10 || imp10)
      ivaEntries.push({
        Id: 4,
        BaseImp: +base10.toFixed(2),
        Importe: +imp10.toFixed(2),
      });
    // Intereses con IVA 21% (si correspondiera)
    if (interestBase || interestVat)
      ivaEntries.push({
        Id: 5,
        BaseImp: +interestBase.toFixed(2),
        Importe: +interestVat.toFixed(2),
      });
    // Fusionar por Id
    const merged: Record<number, IVAEntry> = {};
    ivaEntries.forEach((e) => {
      if (!merged[e.Id]) merged[e.Id] = { ...e };
      else {
        merged[e.Id].BaseImp += e.BaseImp;
        merged[e.Id].Importe += e.Importe;
      }
    });
    let mergedIva = Object.values(merged).map((e) => ({
      Id: e.Id,
      BaseImp: parseFloat(e.BaseImp.toFixed(2)),
      Importe: parseFloat(e.Importe.toFixed(2)),
    }));

    const { taxableEntries, zeroVatBase } = splitZeroVatEntries(mergedIva);
    mergedIva = taxableEntries;

    const totalIVAraw = mergedIva.reduce((sum, e) => sum + e.Importe, 0);
    const totalIVA = parseFloat(totalIVAraw.toFixed(2));
    const netoGravado = parseFloat(
      mergedIva.reduce((sum, e) => sum + e.BaseImp, 0).toFixed(2),
    );
    const netoCalculado = parseFloat((adjustedTotal - totalIVA).toFixed(2));
    const conceptosNoGravados = parseFloat(
      (
        netoCalculado -
        netoGravado -
        noGravadoExplicito -
        exentoExplicito -
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
    const impTotConc = noGravadoExplicito;
    const impOpEx = round2(
      exentoExplicito + zeroVatBase + (conceptosNoGravados > 0 ? conceptosNoGravados : 0),
    );
    const neto = netoGravado;

    // ===== 4) Estado AFIP =====
    const status =
      (await afipClient.ElectronicBilling.getServerStatus()) as ServerStatus;
    if (
      status.AppServer !== "OK" ||
      status.DbServer !== "OK" ||
      status.AuthServer !== "OK"
    ) {
      throw new Error("AFIP no disponible");
    }

    // ===== 5) Punto de venta y numeración =====
    const agencyId = await getAgencyIdFromRequest(req);
    const pref = await prisma.agencyArcaConfig.findUnique({
      where: { agencyId },
      select: { selectedSalesPoint: true },
    });
    const ptoVta = await resolveSalesPoint(
      afipClient,
      pref?.selectedSalesPoint ?? null,
    );

    const lastRaw = await afipClient.ElectronicBilling.getLastVoucher(
      ptoVta,
      tipoNota,
    );
    const last = Number(lastRaw);
    if (!Number.isFinite(last) || last < 0) {
      throw new Error("No se pudo obtener el ultimo comprobante.");
    }
    const next = last + 1;
    if (next > 99999999) {
      throw new Error(
        "El numero de comprobante supera el maximo permitido. Crea un nuevo punto de venta.",
      );
    }

    const lastInfo =
      last > 0
        ? ((await afipClient.ElectronicBilling.getVoucherInfo(
            last,
            ptoVta,
            tipoNota,
          ).catch(() => null)) as VoucherInfo)
        : null;
    const lastDate = lastInfo ? Number(lastInfo.CbteFch) : null;

    // ===== 6) Fecha de comprobante =====
    const now = new Date();
    const todayStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(
      2,
      "0",
    )}${String(now.getDate()).padStart(2, "0")}`;

    const cbteFch = invoiceDate
      ? Number(invoiceDate.replace(/-/g, ""))
      : lastDate && Number(todayStr) < lastDate
        ? lastDate
        : Number(todayStr);

    // ===== 7) Moneda / Cotización =====
    const condId = tipoNota === 8 ? 5 : 1; // B -> consumidor final (5), A -> responsable inscripto (1)
    const cotiz =
      currency === "PES"
        ? 1
        : (exchangeRateManual ??
          (await getValidExchangeRate(
            afipClient,
            currency,
            new Date(Date.now() - 86400000),
          )));

    // ===== 8) Fechas de servicio (NC de servicios) =====
    const parseYmd = (s: string) => Number(s.replace(/-/g, ""));
    let FchServDesde: number | undefined;
    let FchServHasta: number | undefined;

    if (serviceDates && serviceDates.length) {
      const allFrom = serviceDates.map((sd) => parseYmd(sd.from));
      const allTo = serviceDates.map((sd) => parseYmd(sd.to));
      FchServDesde = Math.min(...allFrom);
      FchServHasta = Math.max(...allTo);
    }

    const FchVtoPago = cbteFch;
    const hasServiceDates = FchServDesde != null && FchServHasta != null;
    const concepto = hasServiceDates ? 2 : 1;

    // ===== 9) Payload de AFIP =====
    const voucherData: Prisma.JsonObject = {
      CantReg: 1,
      PtoVta: ptoVta,
      CbteTipo: tipoNota,
      Concepto: concepto,
      DocTipo: receptorDocTipo,
      DocNro: Number(receptorDocNumber),
      CbteDesde: next,
      CbteHasta: next,
      CbteFch: cbteFch,

      ...(hasServiceDates && {
        FchServDesde,
        FchServHasta,
        FchVtoPago,
      }),

      ...(cbtesAsoc ? { CbtesAsoc: cbtesAsoc } : {}),
      ImpTotal: adjustedTotal,
      ImpTotConc: impTotConc,
      ImpOpEx: impOpEx,
      ImpNeto: neto,
      ImpIVA: totalIVA,
      MonId: currency,
      MonCotiz: cotiz,
      ...(totalIVA > 0 && mergedIva.length > 0
        ? { Iva: mergedIva as unknown as Prisma.JsonArray }
        : {}),
      CondicionIVAReceptorId: condId,
    };

    // ===== 10) Emisión =====
    const created = (await afipClient.ElectronicBilling.createVoucher(
      voucherData,
    )) as CreateVoucherResp;

    if (!created.CAE) {
      return { success: false, message: "CAE no devuelto" };
    }

    // ===== 11) QR con CUIT real de la agencia =====
    const qrFecha = (
      invoiceDate
        ? invoiceDate
        : todayStr.replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3")
    ).replace(/-/g, "");

    const qrPayload: Record<string, unknown> = {
      ver: 1,
      fecha: qrFecha,
      cuit: agencyCUIT,
      ptoVta,
      tipoCmp: tipoNota,
      nroCmp: next,
      importe: adjustedTotal,
      moneda: currency,
      ctz: cotiz,
      tipoDocRec: receptorDocTipo,
      nroDocRec: Number(receptorDocNumber),
      tipoCodAut: "E",
      codAut: Number(created.CAE),
    };

    const qrBase64 = await qrcode.toDataURL(
      `https://www.afip.gob.ar/fe/qr/?p=${Buffer.from(
        JSON.stringify(qrPayload),
      ).toString("base64")}`,
    );

    return {
      success: true,
      message: "Nota de Crédito generada exitosamente.",
      details: { ...voucherData, ...created } as Prisma.JsonObject,
      qrBase64,
    };
  } catch (err) {
    console.error("[createCreditNoteVoucher] Error", err);
    return { success: false, message: (err as Error).message };
  }
}
