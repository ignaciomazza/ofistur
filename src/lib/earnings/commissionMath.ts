function toFiniteNumber(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function calculateBookingCommissionBase(args: {
  sale: unknown;
  cost?: unknown;
  taxes?: unknown;
  fee?: unknown;
  adjustments?: unknown;
  grossIncomeTax?: unknown;
}): number {
  return (
    toFiniteNumber(args.sale) -
    toFiniteNumber(args.cost) -
    toFiniteNumber(args.taxes) -
    toFiniteNumber(args.fee) -
    toFiniteNumber(args.adjustments) -
    toFiniteNumber(args.grossIncomeTax)
  );
}

export function calculateServiceCommissionBase(args: {
  commissionWithoutVat: unknown;
  fee?: unknown;
  extraCosts?: unknown;
  extraTaxes?: unknown;
}): number {
  return (
    toFiniteNumber(args.commissionWithoutVat) -
    toFiniteNumber(args.fee) -
    toFiniteNumber(args.extraCosts) -
    toFiniteNumber(args.extraTaxes)
  );
}

export function calculateAgencyShare(args: {
  commissionBase: unknown;
  sellerCommission?: unknown;
  leaderCommission?: unknown;
}): number {
  return (
    toFiniteNumber(args.commissionBase) -
    toFiniteNumber(args.sellerCommission) -
    toFiniteNumber(args.leaderCommission)
  );
}

export function calculateCommissionVatTotal(args: {
  vatOnCommission21?: unknown;
  vatOnCommission10_5?: unknown;
}): number {
  return (
    toFiniteNumber(args.vatOnCommission21) +
    toFiniteNumber(args.vatOnCommission10_5)
  );
}
