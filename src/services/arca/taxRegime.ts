type Tax = { idImpuesto?: number | string; estadoImpuesto?: string };
type Taxpayer = {
  datosMonotributo?: { impuesto?: Tax | Tax[] };
  datosRegimenGeneral?: { impuesto?: Tax | Tax[] };
};

function activeTaxes(value: Tax | Tax[] | undefined): Tax[] {
  return (Array.isArray(value) ? value : value ? [value] : []).filter(
    (tax) => String(tax.estadoImpuesto ?? "").toUpperCase() === "AC",
  );
}

export function classifyTaxRegime(value: unknown): "mono" | "ri" | null {
  if (!value || typeof value !== "object") return null;
  const taxpayer = value as Taxpayer;
  const mono = activeTaxes(taxpayer.datosMonotributo?.impuesto).some(
    (tax) => Number(tax.idImpuesto) === 20,
  );
  const ri = activeTaxes(taxpayer.datosRegimenGeneral?.impuesto).some(
    (tax) => Number(tax.idImpuesto) === 30,
  );
  if (mono === ri) return null;
  return mono ? "mono" : "ri";
}
