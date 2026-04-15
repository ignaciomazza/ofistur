const DEFAULT_TOLERANCE = 0.01;

const round2 = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;

const toNumber = (value: unknown): number => {
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : NaN;
  }
  return NaN;
};

const normalizeCurrency = (value: unknown): string => {
  const code = String(value ?? "")
    .trim()
    .toUpperCase();
  if (!code) return "ARS";
  if (["US$", "U$S", "U$D", "DOL"].includes(code)) return "USD";
  if (["$", "AR$"].includes(code)) return "ARS";
  return code;
};

const toPositiveInt = (value: unknown): number | null => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.trunc(parsed);
};

export type OperatorPaymentServiceInput = {
  service_id: number;
  service_label?: string | null;
  service_currency: string;
  service_cost?: number | null;
};

export type OperatorPaymentAllocationInput = {
  service_id: number;
  service_currency?: string | null;
  amount_service?: number | null;
};

export type OperatorPaymentHistoryInput = {
  payment_id: number;
  payment_display_id?: string | number | null;
  amount?: number | string | null;
  currency?: string | null;
  paid_at?: string | Date | null;
  created_at?: string | Date | null;
  base_amount?: number | string | null;
  base_currency?: string | null;
  counter_amount?: number | string | null;
  counter_currency?: string | null;
  service_ids?: number[] | null;
  allocations?: OperatorPaymentAllocationInput[] | null;
};

type InternalServiceMeta = {
  service_id: number;
  service_label: string;
  service_currency: string;
  service_cost: number | null;
};

type InternalContribution = {
  amountsByService: Map<number, number>;
  candidateServiceIds: number[];
  estimated: boolean;
  unavailableReason: "no_services" | "mixed_currency" | "missing_conversion" | null;
};

type InternalPayment = {
  payment_id: number;
  payment_display_id: string;
  amount: number;
  currency: string;
  paid_at: Date | null;
  created_at: Date | null;
  base_amount: number | null;
  base_currency: string | null;
  counter_amount: number | null;
  counter_currency: string | null;
  service_ids: number[];
  allocations: Array<{
    service_id: number;
    service_currency: string;
    amount_service: number;
  }>;
  anchor: Date | null;
  anchorTs: number;
};

export type OperatorPaymentServiceBreakdownRow = {
  service_id: number;
  service_label: string;
  service_currency: string;
  service_cost: number | null;
  balance_before: number | null;
  applied_in_payment: number | null;
  balance_after: number | null;
  estimated: boolean;
  unavailable: boolean;
  unavailable_reason: "no_services" | "mixed_currency" | "missing_conversion" | null;
};

export type OperatorPaymentBreakdownItem = {
  payment_id: number;
  payment_display_id: string;
  anchor: Date | null;
  service_rows: OperatorPaymentServiceBreakdownRow[];
  used_fallback: boolean;
  has_unavailable_details: boolean;
};

export type OperatorPaymentBreakdownResult = {
  payments: OperatorPaymentBreakdownItem[];
  byPaymentId: Map<number, OperatorPaymentBreakdownItem>;
};

const normalizeDate = (value: unknown): Date | null => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
};

const resolveAmountForCurrency = (
  payment: InternalPayment,
  serviceCurrency: string,
  tolerance: number,
): number | null => {
  if (
    payment.base_currency &&
    payment.base_currency === serviceCurrency &&
    payment.base_amount != null &&
    payment.base_amount > tolerance
  ) {
    return payment.base_amount;
  }

  if (
    payment.counter_currency &&
    payment.counter_currency === serviceCurrency &&
    payment.counter_amount != null &&
    payment.counter_amount > tolerance
  ) {
    return payment.counter_amount;
  }

  if (payment.currency === serviceCurrency && payment.amount > tolerance) {
    return payment.amount;
  }

  return null;
};

const allocateByWeight = (
  serviceIds: number[],
  totalAmount: number,
  getWeight: (serviceId: number) => number,
): Map<number, number> => {
  const out = new Map<number, number>();
  if (serviceIds.length === 0) return out;

  const safeTotal = round2(totalAmount);
  if (safeTotal <= 0) {
    serviceIds.forEach((serviceId) => out.set(serviceId, 0));
    return out;
  }

  const weights = serviceIds.map((serviceId) => Math.max(0, getWeight(serviceId)));
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);

  if (weightSum <= 0) {
    const equal = round2(safeTotal / serviceIds.length);
    let remaining = safeTotal;
    serviceIds.forEach((serviceId, index) => {
      const isLast = index === serviceIds.length - 1;
      const value = isLast ? remaining : equal;
      const rounded = round2(value);
      out.set(serviceId, rounded);
      if (!isLast) remaining = round2(remaining - rounded);
    });
    return out;
  }

  let remaining = safeTotal;
  serviceIds.forEach((serviceId, index) => {
    const isLast = index === serviceIds.length - 1;
    const ratio = weights[index] / weightSum;
    const value = isLast ? remaining : round2(safeTotal * ratio);
    const rounded = round2(value);
    out.set(serviceId, rounded);
    if (!isLast) remaining = round2(remaining - rounded);
  });

  return out;
};

const buildContribution = (args: {
  payment: InternalPayment;
  servicesById: Map<number, InternalServiceMeta>;
  tolerance: number;
}): InternalContribution => {
  const { payment, servicesById, tolerance } = args;

  const allocationRows = payment.allocations.filter((row) => servicesById.has(row.service_id));
  if (allocationRows.length > 0) {
    const amountsByService = new Map<number, number>();
    allocationRows.forEach((row) => {
      const current = amountsByService.get(row.service_id) || 0;
      amountsByService.set(row.service_id, round2(current + Math.max(0, row.amount_service)));
    });
    return {
      amountsByService,
      candidateServiceIds: allocationRows.map((row) => row.service_id),
      estimated: false,
      unavailableReason: null,
    };
  }

  const candidateServiceIds = Array.from(
    new Set(
      (payment.service_ids || []).filter((serviceId) => servicesById.has(serviceId)),
    ),
  );

  if (candidateServiceIds.length === 0) {
    return {
      amountsByService: new Map<number, number>(),
      candidateServiceIds: [],
      estimated: true,
      unavailableReason: "no_services",
    };
  }

  const currencySet = new Set(
    candidateServiceIds.map(
      (serviceId) => servicesById.get(serviceId)?.service_currency || "ARS",
    ),
  );

  if (currencySet.size !== 1) {
    return {
      amountsByService: new Map<number, number>(),
      candidateServiceIds,
      estimated: true,
      unavailableReason: "mixed_currency",
    };
  }

  const [targetCurrency] = Array.from(currencySet.values());
  const resolvedAmount = resolveAmountForCurrency(payment, targetCurrency, tolerance);

  if (resolvedAmount == null) {
    return {
      amountsByService: new Map<number, number>(),
      candidateServiceIds,
      estimated: true,
      unavailableReason: "missing_conversion",
    };
  }

  const amountsByService = allocateByWeight(
    candidateServiceIds,
    resolvedAmount,
    (serviceId) => {
      const meta = servicesById.get(serviceId);
      const cost = meta?.service_cost ?? null;
      return cost != null && Number.isFinite(cost) && cost > 0 ? cost : 0;
    },
  );

  return {
    amountsByService,
    candidateServiceIds,
    estimated: true,
    unavailableReason: null,
  };
};

export const computeOperatorPaymentBreakdown = (args: {
  services: OperatorPaymentServiceInput[];
  payments: OperatorPaymentHistoryInput[];
  tolerance?: number;
}): OperatorPaymentBreakdownResult => {
  const tolerance =
    Number.isFinite(args.tolerance) && Number(args.tolerance) >= 0
      ? Number(args.tolerance)
      : DEFAULT_TOLERANCE;

  const servicesById = new Map<number, InternalServiceMeta>();
  for (const service of args.services || []) {
    const serviceId = toPositiveInt(service.service_id);
    if (!serviceId) continue;
    const costRaw = toNumber(service.service_cost);
    const serviceCost =
      Number.isFinite(costRaw) && costRaw >= 0 ? round2(costRaw) : null;
    servicesById.set(serviceId, {
      service_id: serviceId,
      service_label:
        String(service.service_label || "").trim() || `Servicio ${serviceId}`,
      service_currency: normalizeCurrency(service.service_currency),
      service_cost: serviceCost,
    });
  }

  const normalizedPayments: InternalPayment[] = (args.payments || [])
    .map((payment) => {
      const paymentId = toPositiveInt(payment.payment_id);
      if (!paymentId) return null;

      const amountRaw = toNumber(payment.amount);
      const amount = Number.isFinite(amountRaw) && amountRaw > 0 ? round2(amountRaw) : 0;
      const baseAmountRaw = toNumber(payment.base_amount);
      const counterAmountRaw = toNumber(payment.counter_amount);
      const baseAmount =
        Number.isFinite(baseAmountRaw) && baseAmountRaw > 0
          ? round2(baseAmountRaw)
          : null;
      const counterAmount =
        Number.isFinite(counterAmountRaw) && counterAmountRaw > 0
          ? round2(counterAmountRaw)
          : null;
      const paidAt = normalizeDate(payment.paid_at);
      const createdAt = normalizeDate(payment.created_at);
      const anchor = paidAt ?? createdAt;
      const anchorTs = anchor ? anchor.getTime() : Number.MAX_SAFE_INTEGER;

      const allocationRows = Array.isArray(payment.allocations)
        ? payment.allocations
            .map((allocation) => {
              const serviceId = toPositiveInt(allocation.service_id);
              if (!serviceId) return null;
              const amountServiceRaw = toNumber(allocation.amount_service);
              const amountService =
                Number.isFinite(amountServiceRaw) && amountServiceRaw >= 0
                  ? round2(amountServiceRaw)
                  : 0;
              const meta = servicesById.get(serviceId);
              return {
                service_id: serviceId,
                service_currency: normalizeCurrency(
                  allocation.service_currency || meta?.service_currency || "ARS",
                ),
                amount_service: amountService,
              };
            })
            .filter(
              (
                row,
              ): row is {
                service_id: number;
                service_currency: string;
                amount_service: number;
              } => row !== null,
            )
        : [];

      const serviceIds = Array.isArray(payment.service_ids)
        ? Array.from(
            new Set(
              payment.service_ids
                .map((id) => toPositiveInt(id))
                .filter((id): id is number => id != null),
            ),
          )
        : [];

      return {
        payment_id: paymentId,
        payment_display_id:
          String(payment.payment_display_id ?? "").trim() || String(paymentId),
        amount,
        currency: normalizeCurrency(payment.currency),
        paid_at: paidAt,
        created_at: createdAt,
        base_amount: baseAmount,
        base_currency: baseAmount != null ? normalizeCurrency(payment.base_currency) : null,
        counter_amount: counterAmount,
        counter_currency:
          counterAmount != null ? normalizeCurrency(payment.counter_currency) : null,
        service_ids: serviceIds,
        allocations: allocationRows,
        anchor,
        anchorTs,
      };
    })
    .filter((payment): payment is InternalPayment => payment !== null)
    .sort((a, b) => {
      if (a.anchorTs !== b.anchorTs) return a.anchorTs - b.anchorTs;
      return a.payment_id - b.payment_id;
    });

  const cumulativePaidByService = new Map<number, number>();
  const breakdownItems: OperatorPaymentBreakdownItem[] = [];

  normalizedPayments.forEach((payment) => {
    const contribution = buildContribution({
      payment,
      servicesById,
      tolerance,
    });
    const rowServiceIds = Array.from(
      new Set(
        contribution.candidateServiceIds.filter((serviceId) => servicesById.has(serviceId)),
      ),
    );

    const serviceRows: OperatorPaymentServiceBreakdownRow[] = rowServiceIds
      .map((serviceId) => {
        const meta = servicesById.get(serviceId);
        if (!meta) return null;

        const paidBefore = cumulativePaidByService.get(serviceId) || 0;
        const applied =
          contribution.unavailableReason == null
            ? contribution.amountsByService.get(serviceId) || 0
            : null;
        const paidAfter =
          applied == null ? null : round2(paidBefore + Math.max(0, applied));
        const balanceBefore =
          meta.service_cost == null ? null : round2(meta.service_cost - paidBefore);
        const balanceAfter =
          meta.service_cost == null || paidAfter == null
            ? null
            : round2(meta.service_cost - paidAfter);

        return {
          service_id: serviceId,
          service_label: meta.service_label,
          service_currency: meta.service_currency,
          service_cost: meta.service_cost,
          balance_before: balanceBefore,
          applied_in_payment: applied == null ? null : round2(Math.max(0, applied)),
          balance_after: balanceAfter,
          estimated: contribution.estimated,
          unavailable: contribution.unavailableReason != null,
          unavailable_reason: contribution.unavailableReason,
        };
      })
      .filter((row): row is OperatorPaymentServiceBreakdownRow => row !== null)
      .sort((a, b) => a.service_id - b.service_id);

    if (contribution.unavailableReason == null) {
      contribution.amountsByService.forEach((value, serviceId) => {
        if (!servicesById.has(serviceId)) return;
        const current = cumulativePaidByService.get(serviceId) || 0;
        cumulativePaidByService.set(serviceId, round2(current + Math.max(0, value)));
      });
    }

    breakdownItems.push({
      payment_id: payment.payment_id,
      payment_display_id: payment.payment_display_id,
      anchor: payment.anchor,
      service_rows: serviceRows,
      used_fallback: payment.allocations.length === 0,
      has_unavailable_details: serviceRows.some((row) => row.unavailable),
    });
  });

  return {
    payments: breakdownItems,
    byPaymentId: new Map(breakdownItems.map((item) => [item.payment_id, item] as const)),
  };
};
