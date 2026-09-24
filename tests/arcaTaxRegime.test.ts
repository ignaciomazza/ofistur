import { describe, expect, it } from "vitest";
import { classifyTaxRegime } from "@/services/arca/taxRegime";

describe("ARCA issuer regime", () => {
  it("recognizes active VAT enrollment as responsible inscripto", () => {
    expect(classifyTaxRegime({
      datosRegimenGeneral: { impuesto: [
        { idImpuesto: 11, estadoImpuesto: "AC" },
        { idImpuesto: 30, estadoImpuesto: "AC" },
      ] },
    })).toBe("ri");
  });

  it("recognizes active monotributo and ignores canceled VAT", () => {
    expect(classifyTaxRegime({
      datosMonotributo: { impuesto: { idImpuesto: 20, estadoImpuesto: "AC" } },
      datosRegimenGeneral: { impuesto: { idImpuesto: 30, estadoImpuesto: "BA" } },
    })).toBe("mono");
  });

  it("requires confirmation when ARCA returns contradictory or incomplete data", () => {
    expect(classifyTaxRegime({ datosMonotributo: {}, datosRegimenGeneral: {} })).toBeNull();
    expect(classifyTaxRegime({
      datosMonotributo: { impuesto: { idImpuesto: 20, estadoImpuesto: "AC" } },
      datosRegimenGeneral: { impuesto: { idImpuesto: 30, estadoImpuesto: "AC" } },
    })).toBeNull();
  });
});
