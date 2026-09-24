// src/services/afip/afipConfig.ts
import AfipLib from "@afipsdk/afip.js";
import type { NextApiRequest } from "next";
import prisma from "@/lib/prisma";
import crypto from "crypto";
import { jwtVerify, type JWTPayload } from "jose";
import { decryptSecret } from "@/lib/arcaSecrets";
import { getAfipSdkAccessToken } from "@/services/afip/accessToken";

/** ------------------------------------------------------------------------
 *  Tipos mínimos para usar el SDK sin "any"
 *  --------------------------------------------------------------------- */
type AfipCtorOptions = {
  CUIT: number;
  cert: string;
  key: string;
  production?: boolean;
  access_token?: string;
};

type ServerStatus = { AppServer: string; DbServer: string; AuthServer: string };
type SalesPoint = { Nro: number };

export interface AfipClient {
  ElectronicBilling: {
    executeRequest(
      method: string,
      params: Record<string, unknown>,
    ): Promise<{ ResultGet?: { MonCotiz?: string } }>;

    getServerStatus(): Promise<ServerStatus>;

    getSalesPoints(): Promise<SalesPoint[]>;

    getLastVoucher(ptoVta: number, cbteTipo: number): Promise<number>;

    getVoucherInfo(
      nro: number,
      ptoVta: number,
      cbteTipo: number,
    ): Promise<{ CbteFch: string } | null>;

    createVoucher(
      voucherData: Record<string, unknown>,
    ): Promise<Record<string, unknown> & { CAE?: string }>;
  };
  RegisterScopeThirteen: {
    getServerStatus(): Promise<ServerStatus>;
    getTaxpayerDetails(identifier: number | string): Promise<unknown>;
    getTaxIDByDocument(
      documentNumber: number | string,
    ): Promise<number | string | Array<number | string> | null>;
  };
  RegisterInscriptionProof: {
    getServerStatus(): Promise<ServerStatus>;
    getTaxpayerDetails(identifier: number | string): Promise<unknown>;
    getTaxpayersDetails(
      identifiers: Array<number | string>,
    ): Promise<unknown[]>;
  };
}

type AfipCtor = new (opts: AfipCtorOptions) => AfipClient;
// eslint-disable-next-line @typescript-eslint/consistent-type-assertions
const Afip = AfipLib as unknown as AfipCtor;

/** ------------------------------------------------------------------------
 *  Cifrado — AES-256-GCM "iv:ct:tag" (hex) para cert/key en DB
 *  --------------------------------------------------------------------- */
const ENC_ALGO = "aes-256-gcm";

function getEncKey(): Buffer {
  const raw = process.env.AFIP_SECRET_KEY;
  if (!raw) throw new Error("AFIP_SECRET_KEY no configurado");
  // base64 exacto de 32 bytes
  if (/^[A-Za-z0-9+/=]+$/.test(raw) && raw.length % 4 === 0) {
    const b = Buffer.from(raw, "base64");
    if (b.length === 32) return b;
  }
  // hex de 32 bytes
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  // deriva 32B desde frase
  return crypto.createHash("sha256").update(raw).digest();
}

function decryptToUTF8(enc: string): string {
  const [ivHex, ctHex, tagHex] = enc.split(":");
  if (!ivHex || !ctHex || !tagHex)
    throw new Error("AFIP: formato cifrado inválido");
  const iv = Buffer.from(ivHex, "hex");
  const ct = Buffer.from(ctHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const decipher = crypto.createDecipheriv(ENC_ALGO, getEncKey(), iv);
  decipher.setAuthTag(tag);
  const out = Buffer.concat([decipher.update(ct), decipher.final()]);
  return out.toString("utf8"); // suele ser base64 del PEM
}

function pemFromEncrypted(maybe: string | null | undefined): string | null {
  if (!maybe) return null;
  const base64OrText = decryptToUTF8(maybe);
  try {
    return Buffer.from(base64OrText, "base64").toString("utf8");
  } catch {
    return base64OrText;
  }
}

function pemFromEnvBase64(
  name: "AFIP_CERT_BASE64" | "AFIP_KEY_BASE64",
): string | null {
  const v = process.env[name];
  return v ? Buffer.from(v, "base64").toString("utf8") : null;
}

function parseCUIT(input: string | number | null | undefined): number {
  const digits = String(input ?? "").replace(/\D/g, "");
  return digits ? parseInt(digits, 10) : 0;
}

/** ------------------------------------------------------------------------
 *  Construcción y cache
 *  --------------------------------------------------------------------- */
function buildAfip(opts: {
  CUIT: number;
  cert: string;
  key: string;
  production?: boolean;
}): AfipClient {
  return new Afip({
    CUIT: opts.CUIT,
    cert: opts.cert,
    key: opts.key,
    production: opts.production ?? process.env.AFIP_ENV === "production",
    access_token: getAfipSdkAccessToken(opts.CUIT),
  });
}

const cacheByAgency = new Map<number, AfipClient>();

export function invalidateAfipCache(agencyId: number): void {
  cacheByAgency.delete(agencyId);
}

/** ------------------------------------------------------------------------
 *  Materiales por agencia (DB -> desencriptar)
 *  --------------------------------------------------------------------- */
type AfipMaterials = {
  CUIT: number;
  cert: string;
  key: string;
  production?: boolean;
};

async function loadArcaMaterials(
  agencyId: number,
): Promise<AfipMaterials | null> {
  const cfg = await prisma.agencyArcaConfig.findUnique({
    where: { agencyId },
    select: {
      taxIdRepresentado: true,
      certEncrypted: true,
      keyEncrypted: true,
    },
  });
  if (!cfg?.certEncrypted || !cfg?.keyEncrypted) return null;

  const CUIT = parseCUIT(cfg.taxIdRepresentado);
  if (!CUIT) throw new Error("CUIT inválido o faltante en ARCA");

  const cert = decryptSecret(cfg.certEncrypted);
  const key = decryptSecret(cfg.keyEncrypted);

  return { CUIT, cert, key, production: true };
}

async function loadAgencyMaterials(agencyId: number): Promise<AfipMaterials> {
  const arca = await loadArcaMaterials(agencyId);
  if (arca) return arca;

  const a = await prisma.agency.findUnique({
    where: { id_agency: agencyId },
    select: { tax_id: true, afip_cert_base64: true, afip_key_base64: true },
  });
  if (!a) throw new Error("Agencia no encontrada");

  const CUIT = parseCUIT(a.tax_id);
  if (!CUIT) throw new Error("CUIT inválido o faltante para la agencia");

  const cert =
    pemFromEncrypted(a.afip_cert_base64) ??
    pemFromEnvBase64("AFIP_CERT_BASE64");
  const key =
    pemFromEncrypted(a.afip_key_base64) ?? pemFromEnvBase64("AFIP_KEY_BASE64");
  if (!cert || !key) throw new Error("Faltan cert/key de AFIP para la agencia");

  return { CUIT, cert, key };
}

/** ------------------------------------------------------------------------
 *  Resolver userId desde header o JWT (Authorization/Cookie)
 *  --------------------------------------------------------------------- */
type MyJWTPayload = JWTPayload & { userId?: number; id_user?: number };

async function resolveUserIdFromRequest(
  req: NextApiRequest,
): Promise<number | null> {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET no configurado");

  // Header inyectado por middleware: solo se acepta si coincide con el JWT.
  const h = req.headers["x-user-id"];
  const uidFromHeader =
    typeof h === "string"
      ? parseInt(h, 10)
      : Array.isArray(h)
        ? parseInt(h[0] ?? "", 10)
        : NaN;
  const headerUid =
    Number.isFinite(uidFromHeader) && uidFromHeader > 0 ? uidFromHeader : null;

  // Reunimos candidatos de token y validamos hasta encontrar uno que funcione
  const candidates: string[] = [];

  // 1) Authorization: Bearer <token> (prioridad)
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) candidates.push(auth.slice(7));

  // 2) TODAS las ocurrencias de token= en el header Cookie (puede haber host-only y con Domain)
  const rawCookie = req.headers.cookie ?? "";
  const re = /(?:^|;\\s*)token=([^;]+)/g;
  for (let m; (m = re.exec(rawCookie)); ) {
    try {
      candidates.push(decodeURIComponent(m[1]));
    } catch {
      candidates.push(m[1]);
    }
  }

  // 3) Fallback al parser de Next (por si no estaba en el header por alguna razón)
  if (req.cookies?.token && !candidates.includes(req.cookies.token)) {
    candidates.push(req.cookies.token);
  }

  if (candidates.length === 0) return null;

  let tokenUid: number | null = null;
  for (const t of candidates) {
    try {
      const { payload } = await jwtVerify(t, new TextEncoder().encode(secret));
      const p = payload as MyJWTPayload;
      const uid = Number(p.userId ?? p.id_user ?? 0) || 0;
      if (uid > 0) {
        tokenUid = uid;
        break;
      }
    } catch {
      // probar siguiente candidato
    }
  }

  if (!tokenUid) return null;
  if (headerUid && headerUid !== tokenUid) return null;
  return tokenUid;
}

/** ------------------------------------------------------------------------
 *  API pública: AFIP por agencyId o por request
 *  --------------------------------------------------------------------- */
export async function getAfipForAgency(agencyId: number): Promise<AfipClient> {
  const connection = await prisma.agencyArcaConfig.findUnique({
    where: { agencyId },
    select: { status: true },
  });
  if (connection?.status === "disconnected") {
    throw new Error("ARCA está desconectada. Reconectá antes de facturar.");
  }
  const hit = cacheByAgency.get(agencyId);
  if (hit) return hit;
  const mats = await loadAgencyMaterials(agencyId);
  const inst = buildAfip(mats);
  cacheByAgency.set(agencyId, inst);
  return inst;
}

export async function getAfipFromRequest(
  req: NextApiRequest,
): Promise<AfipClient> {
  const uid = await resolveUserIdFromRequest(req);
  if (!uid) {
    throw new Error(
      "No se pudo resolver el usuario desde el request (x-user-id o token).",
    );
  }

  const u = await prisma.user.findUnique({
    where: { id_user: uid },
    select: { id_agency: true },
  });

  const agencyId = u?.id_agency ?? 0;
  if (!agencyId) {
    throw new Error("El usuario no tiene agencia asociada.");
  }

  return getAfipForAgency(agencyId);
}

export async function getAgencyIdFromRequest(
  req: NextApiRequest,
): Promise<number> {
  const uid = await resolveUserIdFromRequest(req);
  if (!uid) {
    throw new Error(
      "No se pudo resolver el usuario desde el request (x-user-id o token).",
    );
  }

  const u = await prisma.user.findUnique({
    where: { id_user: uid },
    select: { id_agency: true },
  });

  const agencyId = u?.id_agency ?? 0;
  if (!agencyId) {
    throw new Error("El usuario no tiene agencia asociada.");
  }

  return agencyId;
}

/** ------------------------------------------------------------------------
 *  CUIT real de la agencia (para QR, auditoría, etc.)
 *  --------------------------------------------------------------------- */
async function resolveArcaCUIT(agencyId: number): Promise<number | null> {
  const cfg = await prisma.agencyArcaConfig.findUnique({
    where: { agencyId },
    select: {
      taxIdRepresentado: true,
      certEncrypted: true,
      keyEncrypted: true,
    },
  });
  if (!cfg?.certEncrypted || !cfg?.keyEncrypted) return null;
  const cuit = parseCUIT(cfg.taxIdRepresentado);
  return cuit || null;
}

export async function getAgencyCUITFromRequest(
  req: NextApiRequest,
): Promise<number> {
  const uid = await resolveUserIdFromRequest(req);
  if (!uid) {
    throw new Error(
      "No se pudo resolver el usuario desde el request (x-user-id o token).",
    );
  }

  const u = await prisma.user.findUnique({
    where: { id_user: uid },
    select: { id_agency: true },
  });

  const agencyId = u?.id_agency ?? 0;
  if (!agencyId) {
    throw new Error("El usuario no tiene agencia asociada.");
  }

  const arcaCuit = await resolveArcaCUIT(agencyId);
  if (arcaCuit) return arcaCuit;

  const agency = await prisma.agency.findUnique({
    where: { id_agency: agencyId },
    select: { tax_id: true },
  });

  const cuit = parseCUIT(agency?.tax_id);
  if (!cuit) {
    throw new Error("CUIT inválido o faltante para la agencia");
  }

  return cuit;
}

/** También por agencyId, útil cuando partís de una factura ya emitida */
export async function getAgencyCUITForAgency(
  agencyId: number,
): Promise<number> {
  const arcaCuit = await resolveArcaCUIT(agencyId);
  if (arcaCuit) return arcaCuit;

  const a = await prisma.agency.findUnique({
    where: { id_agency: agencyId },
    select: { tax_id: true },
  });
  if (!a) throw new Error("Agencia no encontrada");
  const cuit = parseCUIT(a.tax_id);
  if (!cuit) throw new Error("CUIT inválido o faltante para la agencia");
  return cuit;
}

/** ------------------------------------------------------------------------
 *  Export default: stub que obliga a usar getAfipFromRequest/getAfipForAgency
 *  --------------------------------------------------------------------- */
function makeThrowingAfip(reason: string): AfipClient {
  return {
    ElectronicBilling: {
      async executeRequest(): Promise<{ ResultGet?: { MonCotiz?: string } }> {
        throw new Error(reason);
      },
      async getServerStatus(): Promise<ServerStatus> {
        throw new Error(reason);
      },
      async getSalesPoints(): Promise<SalesPoint[]> {
        throw new Error(reason);
      },
      async getLastVoucher(): Promise<number> {
        throw new Error(reason);
      },
      async getVoucherInfo(): Promise<{ CbteFch: string } | null> {
        throw new Error(reason);
      },
      async createVoucher(): Promise<
        Record<string, unknown> & { CAE?: string }
      > {
        throw new Error(reason);
      },
    },
    RegisterScopeThirteen: {
      async getServerStatus(): Promise<ServerStatus> {
        throw new Error(reason);
      },
      async getTaxpayerDetails(): Promise<unknown> {
        throw new Error(reason);
      },
      async getTaxIDByDocument(): Promise<null> {
        throw new Error(reason);
      },
    },
    RegisterInscriptionProof: {
      async getServerStatus(): Promise<ServerStatus> {
        throw new Error(reason);
      },
      async getTaxpayerDetails(): Promise<unknown> {
        throw new Error(reason);
      },
      async getTaxpayersDetails(): Promise<unknown[]> {
        throw new Error(reason);
      },
    },
  };
}

const defaultExportInstance = makeThrowingAfip(
  "AFIP no inicializado por defecto. Usá getAfipFromRequest(req) o getAfipForAgency(agencyId).",
);

export default defaultExportInstance;
