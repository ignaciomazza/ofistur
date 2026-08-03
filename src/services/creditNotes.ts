// src/services/creditNotes.ts
import type { NextApiRequest } from "next";
import prisma from "@/lib/prisma";
import { getNextAgencyCounter } from "@/lib/agencyCounters";
import { Prisma, type CreditNote, type CreditNoteItem } from "@prisma/client";
import { createCreditNoteVoucher } from "@/services/afip/creditNoteService";
import {
  computeManualTotals,
  type ManualTotalsInput,
} from "@/services/afip/manualTotals";
import { logArca } from "@/services/arca/logger";

export type CreditNoteWithItems = CreditNote & {
  items: CreditNoteItem[];
  public_id?: string | null;
};

interface CreditNoteRequest {
  invoiceId: number;
  tipoNota: 3 | 8; // 3 = Nota de Crédito A, 8 = Nota de Crédito B
  exchangeRate?: number;
  invoiceDate?: string; // YYYY-MM-DD
  manualTotals?: ManualTotalsInput;
}

interface CreateCreditNoteResult {
  success: boolean;
  message?: string;
  creditNote?: CreditNote;
  items?: CreditNoteItem[];
}

interface InvoicePayload extends Prisma.JsonObject {
  // payload extra que guardamos en la factura original
  serviceDates?: Array<{ id_service: number; from: string; to: string }>;
  voucherData?: Prisma.JsonObject;
  description21?: string[];
  description10_5?: string[];
  descriptionNonComputable?: string[];
  manualTotals?: ManualTotalsInput;
}

/** Lista todas las NC de una factura */
export async function listCreditNotes(
  invoiceId: number,
): Promise<CreditNoteWithItems[]> {
  return prisma.creditNote.findMany({
    where: { invoiceId },
    include: { items: true },
  });
}

/**
 * Crea una NC contra una factura existente:
 * - Toma los datos AFIP (PtoVta, CbteTipo, CbteDesde) para armar CbtesAsoc
 * - Reconstruye el desglose de IVA desde voucherData.Iva de la factura
 * - Respeta moneda/cotización (manual u obtenida en creditNoteService)
 * - Vuelve a enviar fechas de servicio si las guardaste en la factura original
 */
export async function createCreditNote(
  req: NextApiRequest,
  data: CreditNoteRequest,
): Promise<CreateCreditNoteResult> {
  const { invoiceId, tipoNota, exchangeRate, invoiceDate, manualTotals } = data;

  // 1) Obtener factura original (con items y pax)
  const orig = await prisma.invoice.findUnique({
    where: { id_invoice: invoiceId },
    include: {
      client: true,
      InvoiceItem: true,
    },
  });

  if (!orig || orig.payloadAfip == null) {
    return {
      success: false,
      message: "Factura original no encontrada o sin datos AFIP.",
    };
  }

  // 2) Extraer datos guardados en el payload
  const payload = orig.payloadAfip as InvoicePayload;
  const storedManualTotals = payload.manualTotals;

  // En facturas nuevas, guardamos voucherData adentro; en otras puede estar plano.
  const voucherData = (payload.voucherData || payload) as Prisma.JsonObject;

  // Fechas de servicio (si las guardaste al emitir la factura)
  const serviceDates =
    (payload.serviceDates as Array<{
      id_service: number;
      from: string;
      to: string;
    }>) || [];

  // Descripciones (opcionales; sólo para guardar en ítems locales)
  const desc21 = (payload.description21 as string[]) || [];
  const desc10 = (payload.description10_5 as string[]) || [];
  const desc0 = (payload.descriptionNonComputable as string[]) || [];

  // 3) Comprobante asociado (la factura original)
  const originalPtoVta = voucherData.PtoVta as number;
  const originalCbteTipo = voucherData.CbteTipo as number;
  const originalNumero = voucherData.CbteDesde as number; // (desde = hasta en nuestras emisiones)
  const cbtesAsoc = [
    { Tipo: originalCbteTipo, PtoVta: originalPtoVta, Nro: originalNumero },
  ];

  // 4) Documento receptor (tipo/numero) tomado de la factura original
  const receptorDocTipo = Number(voucherData.DocTipo || 0) || 0; // 80 CUIT / 96 DNI
  const receptorDocNumber = String(
    (voucherData.DocNro as number | string) ?? "",
  );

  // 5) Reconstruir el desglose de IVA desde la factura original
  //    voucherData.Iva es un array de { Id, BaseImp, Importe }
  let ivaLines =
    (voucherData.Iva as
      | Array<{ Id: number; BaseImp: number; Importe: number }>
      | undefined) || [];

  if (manualTotals) {
    const manual = computeManualTotals(manualTotals);
    if (!manual.ok) {
      return { success: false, message: manual.error };
    }
    ivaLines = manual.result.ivaEntries;
  } else if (storedManualTotals) {
    const manual = computeManualTotals(storedManualTotals);
    if (manual.ok) {
      ivaLines = manual.result.ivaEntries;
    }
  }

  type AfipServiceDetail = {
    sale_price: number;
    taxableBase21: number;
    commission21: number;
    tax_21: number;
    vatOnCommission21: number;
    taxableBase10_5: number;
    commission10_5: number;
    tax_105: number;
    vatOnCommission10_5: number;
    taxableCardInterest: number;
    vatOnCardInterest: number;
    nonComputable: number;
    exempt: number;
  };

  // Mapear cada alícuota a un "serviceDetail" compatible con createCreditNoteVoucher.
  // No necesitamos separar intereses vs base: el servicio hace merge por Id.
  const serviceDetails: AfipServiceDetail[] = ivaLines.map((iva) => {
    const base = Number(iva.BaseImp || 0);
    const imp = Number(iva.Importe || 0);

    const is21 = iva.Id === 5;
    const is10 = iva.Id === 4;
    const isEx = iva.Id === 3;
    const zeroVatLegacy = !isEx && base > 0 && Math.abs(imp) <= 0.01;

    return {
      sale_price: +(base + imp).toFixed(2),

      taxableBase21: is21 && !zeroVatLegacy ? base : 0,
      commission21: 0,
      tax_21: is21 && !zeroVatLegacy ? imp : 0,
      vatOnCommission21: 0,

      taxableBase10_5: is10 && !zeroVatLegacy ? base : 0,
      commission10_5: 0,
      tax_105: is10 && !zeroVatLegacy ? imp : 0,
      vatOnCommission10_5: 0,

      taxableCardInterest: 0,
      vatOnCardInterest: 0,

      nonComputable: 0,
      exempt: isEx || zeroVatLegacy ? base : 0,
    };
  });

  const voucherNoGravado = Number(voucherData.ImpTotConc || 0);
  const voucherExento = Number(voucherData.ImpOpEx || 0);

  if (voucherNoGravado > 0) {
    serviceDetails.push({
      sale_price: Number(voucherNoGravado.toFixed(2)),
      taxableBase21: 0,
      commission21: 0,
      tax_21: 0,
      vatOnCommission21: 0,
      taxableBase10_5: 0,
      commission10_5: 0,
      tax_105: 0,
      vatOnCommission10_5: 0,
      taxableCardInterest: 0,
      vatOnCardInterest: 0,
      nonComputable: Number(voucherNoGravado.toFixed(2)),
      exempt: 0,
    });
  }

  if (voucherExento > 0) {
    serviceDetails.push({
      sale_price: Number(voucherExento.toFixed(2)),
      taxableBase21: 0,
      commission21: 0,
      tax_21: 0,
      vatOnCommission21: 0,
      taxableBase10_5: 0,
      commission10_5: 0,
      tax_105: 0,
      vatOnCommission10_5: 0,
      taxableCardInterest: 0,
      vatOnCardInterest: 0,
      nonComputable: 0,
      exempt: Number(voucherExento.toFixed(2)),
    });
  }

  // 6) Moneda de la factura original (en nuestras facturas guardamos MonId/afipCurrency: "PES"/"DOL")
  //    Si no existiera en voucherData, tomamos orig.currency (que ya guardamos como afipCurrency).
  const afipCurrency =
    (voucherData.MonId as string) || (orig.currency as string) || "PES";

  // 7) Emitir NC en AFIP (usa el AFIP del usuario del request y el CUIT real para el QR)
  logArca("info", "Credit note issuance requested", {
    agencyId: orig.id_agency,
    invoiceId,
    creditNoteType: tipoNota,
    associatedSalesPoint: originalPtoVta,
    associatedVoucherType: originalCbteTipo,
    associatedVoucherNumber: originalNumero,
  });
  const resp = await createCreditNoteVoucher(
    req,
    tipoNota,
    receptorDocNumber,
    receptorDocTipo,
    serviceDetails,
    afipCurrency,
    exchangeRate,
    invoiceDate,
    cbtesAsoc,
    serviceDates,
  );

  if (!resp.success || !resp.details) {
    logArca("warn", "Credit note authorization failed", {
      agencyId: orig.id_agency,
      invoiceId,
      creditNoteType: tipoNota,
      message: resp.message,
    });
    return {
      success: false,
      message: resp.message ?? "Error al emitir nota de crédito en AFIP.",
    };
  }

  const det = resp.details as Prisma.JsonObject;
  const qrBase64 = resp.qrBase64;
  const ptoVta = Number(det.PtoVta ?? 0);
  const cbteTipo = Number(det.CbteTipo ?? tipoNota);
  const creditNumber = String(det.CbteDesde ?? "");

  logArca("info", "Credit note authorized", {
    agencyId: orig.id_agency,
    invoiceId,
    salesPoint: ptoVta,
    voucherType: cbteTipo,
    voucherNumber: creditNumber,
    cae: det.CAE,
  });

  // 8) Preparar descripciones para los ítems locales (no afectan AFIP)
  //    Usamos el mismo orden que en ivaLines para asignar textos referenciales.
  const itemDescriptions: string[] = ivaLines.map((iva) => {
    if (iva.Id === 5) return desc21[0] || "IVA 21%";
    if (iva.Id === 4) return desc10[0] || "IVA 10.5%";
    return desc0[0] || "Exento";
  });
  if (voucherNoGravado > 0) {
    itemDescriptions.push(desc0[0] || "No gravado");
  }
  if (voucherExento > 0) {
    itemDescriptions.push(desc0[0] || "Exento");
  }

  // 9) Guardar NC + ítems en DB (transacción)
  const savePromise = prisma.$transaction(async (tx) => {
    const agencyCreditNoteId = await getNextAgencyCounter(
      tx,
      orig.id_agency,
      "credit_note",
    );
    const note = await tx.creditNote.create({
      data: {
        agency_credit_note_id: agencyCreditNoteId,
        id_agency: orig.id_agency,
        credit_number: creditNumber,
        pto_vta: ptoVta,
        cbte_tipo: cbteTipo,
        issue_date: new Date(),
        total_amount: Number(det.ImpTotal || 0),
        currency: afipCurrency,
        status: "Autorizada",
        type: tipoNota === 3 ? "Nota A" : "Nota B",
        recipient:
          orig.client.company_name ??
          `${orig.client.first_name} ${orig.client.last_name}`,
        payloadAfip: {
          ...det,
          qrBase64,
          CbtesAsoc: cbtesAsoc,
          serviceDates,
        } as Prisma.JsonObject,
        invoiceId,
      },
    });

    // Creamos un ítem por cada alícuota que reconstruimos (coincidente con serviceDetails)
    const items = await Promise.all(
      serviceDetails.map((svc, idx) =>
        tx.creditNoteItem.create({
          data: {
            creditNoteId: note.id_credit_note,
            serviceId: null, // NC usualmente no referencia un service puntual
            description: itemDescriptions[idx] || "Ajuste",
            sale_price: svc.sale_price,
            taxableBase21: svc.taxableBase21,
            commission21: svc.commission21,
            tax_21: svc.tax_21,
            vatOnCommission21: svc.vatOnCommission21,
            taxableBase10_5: svc.taxableBase10_5,
            commission10_5: svc.commission10_5,
            tax_105: svc.tax_105,
            vatOnCommission10_5: svc.vatOnCommission10_5,
            taxableCardInterest: svc.taxableCardInterest,
            vatOnCardInterest: svc.vatOnCardInterest,
          },
        }),
      ),
    );

    return { note, items };
  });

  const { note, items } = await savePromise.catch((error: unknown) => {
    logArca("error", "Credit note local persistence failed", {
      agencyId: orig.id_agency,
      invoiceId,
      salesPoint: ptoVta,
      voucherType: cbteTipo,
      voucherNumber: creditNumber,
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  });

  logArca("info", "Credit note persisted", {
    agencyId: orig.id_agency,
    invoiceId,
    creditNoteId: note.id_credit_note,
    salesPoint: ptoVta,
    voucherType: cbteTipo,
    voucherNumber: creditNumber,
  });

  return {
    success: true,
    creditNote: note,
    items,
  };
}
