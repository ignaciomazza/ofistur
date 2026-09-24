// src/pages/api/arca/connect.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { getAuthContext, hasArcaAccess } from "@/lib/arcaAuth";
import { validateArcaSecretsKey } from "@/lib/arcaSecrets";
import { startArcaJob } from "@/lib/arcaStartJob";
import { logArca } from "@/services/arca/logger";

const ConnectSchema = z.object({
  cuitRepresentado: z.string().min(1, "CUIT representado requerido"),
  cuitLogin: z.string().min(1, "CUIT login requerido"),
  password: z.string().min(1, "Clave fiscal requerida"),
  alias: z.string().optional(),
  services: z.array(z.string()).optional(),
});

function normalizeCuit(value: string): string {
  return value.replace(/\D/g, "");
}

function ensureCuit(value: string, label: string): string {
  const digits = normalizeCuit(value);
  if (digits.length !== 11) {
    throw new Error(`${label} inválido (11 dígitos)`);
  }
  return digits;
}

function normalizeServices(input?: string[]): string[] {
  const allowed = new Set(["wsfe", "ws_sr_padron_a13", "ws_sr_constancia_inscripcion"]);
  const cleaned = (Array.isArray(input) ? input : [])
    .map((s) => String(s).trim().toLowerCase())
    .filter((s) => allowed.has(s));
  const set = new Set(cleaned);
  set.add("wsfe");
  set.add("ws_sr_constancia_inscripcion");
  return Array.from(set);
}

function sanitizeAlias(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9]/g, "");
}

function buildAlias(cuit: string): string {
  return `ofistur${cuit}`;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end(`Método ${req.method} no permitido`);
  }

  const auth = await getAuthContext(req);
  if (!auth?.id_agency) {
    return res.status(401).json({ error: "No autenticado" });
  }
  if (!hasArcaAccess(auth.role)) {
    return res.status(403).json({ error: "No autorizado" });
  }

  try {
    try {
      validateArcaSecretsKey();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "ARCA_SECRETS_KEY inválido";
      logArca("warn", "ARCA_SECRETS_KEY invalid", { error: msg });
      return res.status(500).json({
        error:
          "Configurá ARCA_SECRETS_KEY (base64 de 32 bytes). Podés usar AFIP_SECRET_KEY si ya existe.",
      });
    }
    const body = ConnectSchema.parse(req.body ?? {});
    const cuitRepresentado = ensureCuit(
      body.cuitRepresentado,
      "CUIT representado",
    );
    const cuitLogin = ensureCuit(body.cuitLogin, "CUIT login");
    const services = normalizeServices(body.services);
    const baseAlias = (body.alias ?? "").trim();
    const alias =
      sanitizeAlias(baseAlias) || sanitizeAlias(buildAlias(cuitRepresentado));
    if (!alias) {
      return res
        .status(400)
        .json({ error: "Alias inválido. Usá solo letras y números." });
    }
    logArca("info", "API connect", {
      agencyId: auth.id_agency,
      cuitRepresentado,
      cuitLogin,
      alias,
      services,
      hasPassword: Boolean(body.password),
      passwordLength: (body.password ?? "").length,
    });

    const job = await startArcaJob({
      agencyId: auth.id_agency,
      action: "connect",
      cuitRepresentado,
      cuitLogin,
      alias,
      services,
      password: body.password,
    });

    return res.status(200).json({
      job,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Datos inválidos";
    logArca("warn", "API connect error", { error: msg });
    return res.status(400).json({ error: msg });
  }
}
