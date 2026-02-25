// src/pages/api/template-config/[doc_type]/index.ts

import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";
import { getNextAgencyCounter } from "@/lib/agencyCounters";
import { jwtVerify, type JWTPayload } from "jose";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { ensurePlanFeatureAccess } from "@/lib/planAccess.server";

/* ============================================================================
 * Tipos internos de Auth
 * ========================================================================== */
type TokenPayload = JWTPayload & {
  id_user?: number;
  userId?: number;
  uid?: number;
  role?: string;
  id_agency?: number;
  agencyId?: number;
  aid?: number;
  email?: string;
};

type DecodedUser = {
  id_user?: number;
  id_agency?: number;
  role?: string;
  email?: string;
};

type UpsertBody = {
  config?: Prisma.InputJsonObject;
  mode?: "replace" | "merge";
};

/* ============================================================================
 * Auth helpers
 * ========================================================================== */
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error("JWT_SECRET no configurado");

function getTokenFromRequest(req: NextApiRequest): string | null {
  if (req.cookies?.token) return req.cookies.token;

  const auth = req.headers.authorization || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7);

  const c = req.cookies || {};
  for (const k of [
    "session",
    "auth_token",
    "access_token",
    "next-auth.session-token",
  ]) {
    if (c[k]) return c[k]!;
  }
  return null;
}

function scrubFonts(value: Prisma.InputJsonObject): Prisma.InputJsonObject {
  const out = toMutable(value);

  // Quitar styles.fonts completos
  if (isInputJsonObject(out.styles)) {
    const s = toMutable(out.styles as Prisma.InputJsonObject);
    if (isInputJsonObject(s.fonts)) {
      delete s.fonts;
    }
    out.styles = s as Prisma.InputJsonObject;
  }

  // Quitar payment.mupuStyle.font/bold
  if (isInputJsonObject(out.payment)) {
    const p = toMutable(out.payment as Prisma.InputJsonObject);
    if (isInputJsonObject(p.mupuStyle)) {
      const ms = toMutable(p.mupuStyle as Prisma.InputJsonObject);
      delete ms.font;
      delete ms.bold;
      p.mupuStyle = ms as Prisma.InputJsonObject;
    }
    out.payment = p as Prisma.InputJsonObject;
  }

  // Quitar content.blocks[*].mupuStyle.font/bold
  if (isInputJsonObject(out.content)) {
    const c = toMutable(out.content as Prisma.InputJsonObject);
    if (isInputJsonArray(c.blocks)) {
      c.blocks = (c.blocks as Prisma.InputJsonArray).map((b) => {
        if (isInputJsonObject(b) && isInputJsonObject(b.mupuStyle)) {
          const blk = toMutable(b);
          const ms = toMutable(b.mupuStyle as Prisma.InputJsonObject);
          delete ms.font;
          delete ms.bold;
          blk.mupuStyle = ms as Prisma.InputJsonObject;
          return blk as unknown as Prisma.InputJsonObject;
        }
        return b;
      }) as Prisma.InputJsonArray;
    }
    out.content = c as Prisma.InputJsonObject;
  }

  return out as unknown as Prisma.InputJsonObject;
}

async function getUserFromAuth(
  req: NextApiRequest,
): Promise<DecodedUser | null> {
  try {
    const token = getTokenFromRequest(req);
    if (!token) return null;

    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(JWT_SECRET),
    );
    const p = payload as TokenPayload;

    const id_user = Number(p.id_user ?? p.userId ?? p.uid) || undefined;
    const id_agency = Number(p.id_agency ?? p.agencyId ?? p.aid) || undefined;
    const role = (p.role || "") as string | undefined;
    const email = p.email;

    // completar por email si falta id_user
    if (!id_user && email) {
      const u = await prisma.user.findUnique({
        where: { email },
        select: { id_user: true, id_agency: true, role: true, email: true },
      });
      if (u)
        return {
          id_user: u.id_user,
          id_agency: u.id_agency,
          role: u.role,
          email: u.email,
        };
    }

    // completar agency si falta
    if (id_user && !id_agency) {
      const u = await prisma.user.findUnique({
        where: { id_user },
        select: { id_agency: true, role: true, email: true },
      });
      if (u)
        return {
          id_user,
          id_agency: u.id_agency,
          role: role ?? u.role,
          email: email ?? u.email ?? undefined,
        };
    }

    return { id_user, id_agency, role, email };
  } catch {
    return null;
  }
}

/* ============================================================================
 * Guards/helpers para Prisma.InputJson*
 * ========================================================================== */
function isInputJsonObject(v: unknown): v is Prisma.InputJsonObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function asInputJsonObject(v: unknown): Prisma.InputJsonObject {
  return isInputJsonObject(v) ? v : ({} as Prisma.InputJsonObject);
}
function isInputJsonArray(v: unknown): v is Prisma.InputJsonArray {
  return Array.isArray(v);
}

type InputJV = Prisma.InputJsonValue | null | undefined;
type MutableInputJsonObject = { [k: string]: InputJV };
function toMutable(obj: Prisma.InputJsonObject): MutableInputJsonObject {
  return { ...(obj as unknown as MutableInputJsonObject) };
}

// Deep merge: objetos → merge profundo; arrays/primitivos → reemplazo
function deepMergeInput(
  base: Prisma.InputJsonObject,
  patch: Prisma.InputJsonObject,
): Prisma.InputJsonObject {
  const out = toMutable(base);
  for (const key of Object.keys(patch)) {
    const pv = patch[key] as InputJV;
    const bv = base[key] as InputJV;

    if (isInputJsonObject(bv) && isInputJsonObject(pv)) {
      out[key] = deepMergeInput(bv, pv) as InputJV;
      continue;
    }
    if (isInputJsonArray(pv)) {
      out[key] = pv;
      continue;
    }
    out[key] = pv; // primitivo / null / undefined
  }
  return out as unknown as Prisma.InputJsonObject;
}

/* ============================================================================
 * Zod schemas (alineados al front actual)
 * ========================================================================== */

// ---- styles ----
const zColors = z
  .object({
    background: z.string().optional(),
    text: z.string().optional(),
    accent: z.string().optional(),
  })
  .partial();

const zFonts = z
  .object({
    heading: z.string().optional(),
    body: z.string().optional(),
  })
  .partial();

const zUi = z
  .object({
    radius: z.enum(["sm", "md", "lg", "xl", "2xl"]).optional(),
    contentWidth: z.enum(["narrow", "normal", "wide"]).optional(),
    density: z.enum(["compact", "comfortable", "relaxed"]).optional(),
    dividers: z.boolean().optional(),
  })
  .partial();

const zStyles = z
  .object({
    presetId: z.string().optional(), // compat
    colors: zColors.optional(),
    fonts: zFonts.optional(),
    ui: zUi.optional(),
    note: z.string().optional(),
  })
  .partial();

// ---- coverImage ----

const zCoverSavedItem = z.object({
  name: z.string(),
  url: z.string(),
});

const zCoverImage = z
  .object({
    mode: z.enum(["logo", "url", "none"]).optional(),
    url: z.string().optional(), // URL seleccionada actual (si usás una)
    saved: z.array(zCoverSavedItem).optional(), // Biblioteca de imágenes guardadas
    urls: z.array(z.string()).optional(), // (opcional) lista plana de URLs
  })
  .partial();

// ---- payment ----
const zPayment = z
  .object({
    selectedIndex: z.number().int().min(0).nullable().optional(),
    mupuStyle: z
      .object({
        color: z.string().optional(),
      })
      .partial()
      .optional(),
  })
  .partial();

// ---- content.blocks ----
const zMupuStyle = z
  .object({
    color: z.string().optional(),
    target: z.enum(["all", "keys", "values"]).optional(), // solo keyValue
  })
  .partial();

const zTextStyle = z
  .object({
    size: z.enum(["xs", "sm", "base", "lg", "xl", "2xl"]).optional(),
    weight: z
      .enum(["light", "normal", "medium", "semibold", "bold"])
      .optional(),
  })
  .partial();

const zBlockBase = z.object({
  id: z.string(),
  type: z.enum([
    "heading",
    "subtitle",
    "paragraph",
    "list",
    "keyValue",
    "twoColumns",
    "threeColumns",
  ]),
  mode: z.enum(["fixed", "form"]),
  label: z.string().optional(),
  fieldKey: z.string().optional(),
  mupuStyle: zMupuStyle.optional(),
  textStyle: zTextStyle.optional(),
});

const zBlockHeading = zBlockBase.extend({
  type: z.literal("heading"),
  text: z.string().optional(),
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
});
const zBlockSubtitle = zBlockBase.extend({
  type: z.literal("subtitle"),
  text: z.string().optional(),
});
const zBlockParagraph = zBlockBase.extend({
  type: z.literal("paragraph"),
  text: z.string().optional(),
});
const zBlockList = zBlockBase.extend({
  type: z.literal("list"),
  items: z.array(z.string()).optional(),
});
const zBlockKeyValue = zBlockBase.extend({
  type: z.literal("keyValue"),
  pairs: z.array(z.object({ key: z.string(), value: z.string() })).optional(),
});
const zBlockTwoColumns = zBlockBase.extend({
  type: z.literal("twoColumns"),
  left: z.string().optional(),
  right: z.string().optional(),
});
const zBlockThreeColumns = zBlockBase.extend({
  type: z.literal("threeColumns"),
  left: z.string().optional(),
  center: z.string().optional(),
  right: z.string().optional(),
});

const zContent = z
  .object({
    blocks: z
      .array(
        z.discriminatedUnion("type", [
          zBlockHeading,
          zBlockSubtitle,
          zBlockParagraph,
          zBlockList,
          zBlockKeyValue,
          zBlockTwoColumns,
          zBlockThreeColumns,
        ]),
      )
      .optional(),
  })
  .partial();

// ---- raíz de config (común a tipos de doc) ----
const zCommon = z
  .object({
    layout: z.enum(["layoutA", "layoutB", "layoutC"]).optional(),
    styles: zStyles.optional(),
    coverImage: zCoverImage.optional(),
    contactItems: z
      .array(
        z.enum([
          "phones",
          "email",
          "website",
          "address",
          "instagram",
          "facebook",
          "twitter",
          "tiktok",
        ]),
      )
      .optional(),
    paymentOptions: z.array(z.string()).optional(),
    payment: zPayment.optional(),
    content: zContent.optional(),
    // campos legacy compats (no usados por el front actual, pero no rompen)
    labels: z.record(z.string()).optional(),
    termsAndConditions: z.string().optional(),
    metodosDePago: z.record(z.string()).optional(),
  })
  .partial();

const zConfirmationCfg = zCommon;
const zQuoteCfg = zCommon;
const zVoucherCfg = zCommon;

function validateByDocType(docType: string, value: unknown) {
  const schema =
    docType === "confirmation"
      ? zConfirmationCfg
      : docType === "voucher"
        ? zVoucherCfg
        : zQuoteCfg;
  return schema.parse(value ?? {});
}

/* ============================================================================
 * Defaults usados en ?resolved=1 (alineados al front)
 * ========================================================================== */
const CFG_DEFAULTS: Record<string, Prisma.InputJsonObject> = {
  confirmation: {
    layout: "layoutA",
    styles: {
      colors: { background: "#ffffff", text: "#111111", accent: "#6B7280" },
      fonts: { heading: "Poppins", body: "Poppins" },
      ui: {
        radius: "xl",
        contentWidth: "normal",
        density: "comfortable",
        dividers: true,
      },
      note: "",
    },
    coverImage: { mode: "logo", url: "", saved: [] },
    contactItems: [
      "website",
      "address",
      "phones",
      "email",
      "instagram",
      "facebook",
      "twitter",
      "tiktok",
    ],
    paymentOptions: [],
    payment: { selectedIndex: null },
    content: { blocks: [] },
  },
  quote: {
    layout: "layoutA",
    styles: {
      colors: { background: "#ffffff", text: "#111111", accent: "#6B7280" },
      fonts: { heading: "Poppins", body: "Poppins" },
      ui: {
        radius: "xl",
        contentWidth: "normal",
        density: "comfortable",
        dividers: true,
      },
      note: "",
    },
    coverImage: { mode: "logo", url: "", saved: [] },
    contactItems: [
      "website",
      "address",
      "phones",
      "email",
      "instagram",
      "facebook",
      "twitter",
      "tiktok",
    ],
    paymentOptions: [],
    payment: { selectedIndex: null },
    content: { blocks: [] },
  },
  quote_budget: {
    layout: "layoutA",
    styles: {
      colors: { background: "#ffffff", text: "#111111", accent: "#6B7280" },
      fonts: { heading: "Poppins", body: "Poppins" },
      ui: {
        radius: "xl",
        contentWidth: "normal",
        density: "comfortable",
        dividers: true,
      },
      note: "",
    },
    coverImage: { mode: "logo", url: "", saved: [] },
    contactItems: [
      "website",
      "address",
      "phones",
      "email",
      "instagram",
      "facebook",
      "twitter",
      "tiktok",
    ],
    paymentOptions: [],
    payment: { selectedIndex: null },
    content: { blocks: [] },
  },
  voucher: {
    layout: "layoutA",
    styles: {
      colors: { background: "#ffffff", text: "#111111", accent: "#6B7280" },
      fonts: { heading: "Poppins", body: "Poppins" },
      ui: {
        radius: "xl",
        contentWidth: "normal",
        density: "comfortable",
        dividers: true,
      },
      note: "",
    },
    coverImage: { mode: "logo", url: "", saved: [] },
    contactItems: [
      "website",
      "address",
      "phones",
      "email",
      "instagram",
      "facebook",
      "twitter",
      "tiktok",
    ],
    paymentOptions: [],
    payment: { selectedIndex: null },
    content: { blocks: [] },
  },
};

/* ============================================================================
 * Handlers
 * ========================================================================== */

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  try {
    const auth = await getUserFromAuth(req);
    if (!auth?.id_user || !auth?.id_agency) {
      return res.status(401).json({ error: "No autenticado" });
    }
    const planAccess = await ensurePlanFeatureAccess(
      auth.id_agency,
      "templates",
    );
    if (!planAccess.allowed) {
      return res.status(403).json({ error: "Plan insuficiente" });
    }

    const doc_type = Array.isArray(req.query.doc_type)
      ? req.query.doc_type[0]
      : req.query.doc_type;
    const docType = (doc_type || "").trim();
    if (!docType) return res.status(400).json({ error: "doc_type requerido" });

    const row = await prisma.templateConfig.findUnique({
      where: {
        id_agency_doc_type: { id_agency: auth.id_agency, doc_type: docType },
      },
    });

    const resolvedFlag = String(req.query.resolved || "") === "1";
    const defaults = CFG_DEFAULTS[docType] ?? {};
    const stored = row?.config ?? {};

    let payloadConfig: Prisma.InputJsonObject = asInputJsonObject(stored);
    if (resolvedFlag) {
      payloadConfig = deepMergeInput(
        asInputJsonObject(defaults),
        asInputJsonObject(stored),
      );
      // Validar el resultado final
      validateByDocType(docType, payloadConfig);
    }

    return res.status(200).json({
      exists: !!row,
      id_template: row?.id_template ?? null,
      id_agency: auth.id_agency,
      doc_type: docType,
      config: payloadConfig,
      created_at: row?.created_at ?? null,
      updated_at: row?.updated_at ?? null,
    });
  } catch (error) {
    console.error("[template-config][GET]", error);
    // Si el error es de Zod, avisamos con 400
    if (error instanceof z.ZodError) {
      return res
        .status(400)
        .json({ error: "Config inválida", issues: error.issues });
    }
    return res.status(500).json({ error: "Error obteniendo la configuración" });
  }
}

function canEdit(role?: string) {
  const r = (role || "").toLowerCase();
  return ["gerente", "administrativo", "desarrollador"].includes(r);
}

async function handleUpsert(req: NextApiRequest, res: NextApiResponse) {
  try {
    const auth = await getUserFromAuth(req);
    const roleFromCookie = (req.cookies?.role || "").toLowerCase();
    const role = (auth?.role || roleFromCookie || "").toLowerCase();

    if (!auth?.id_user || !auth?.id_agency) {
      return res.status(401).json({ error: "No autenticado" });
    }
    const planAccess = await ensurePlanFeatureAccess(
      auth.id_agency,
      "templates",
    );
    if (!planAccess.allowed) {
      return res.status(403).json({ error: "Plan insuficiente" });
    }
    if (!canEdit(role)) {
      return res
        .status(403)
        .json({ error: "No autorizado para editar templates" });
    }
    const agencyId = auth.id_agency;

    const doc_type = Array.isArray(req.query.doc_type)
      ? req.query.doc_type[0]
      : req.query.doc_type;
    const docType = (doc_type || "").trim();
    if (!docType) return res.status(400).json({ error: "doc_type requerido" });

    const body = (req.body ?? {}) as UpsertBody;
    const mode = body.mode === "merge" ? "merge" : "replace";

    // Validar con Zod y normalizar a InputJsonObject
    const validated = validateByDocType(docType, body.config ?? {});
    const incoming = asInputJsonObject(validated);
    const sanitized = scrubFonts(incoming);

    // obtener actual
    const current = await prisma.templateConfig.findUnique({
      where: {
        id_agency_doc_type: { id_agency: agencyId, doc_type: docType },
      },
      select: { config: true },
    });

    let nextConfig: Prisma.InputJsonObject;
    if (mode === "merge" && current?.config) {
      nextConfig = deepMergeInput(asInputJsonObject(current.config), sanitized);
    } else {
      nextConfig = incoming;
    }

    const saved = await prisma.$transaction(async (tx) => {
      if (current) {
        return tx.templateConfig.update({
          where: {
            id_agency_doc_type: { id_agency: agencyId, doc_type: docType },
          },
          data: { config: nextConfig },
        });
      }
      const agencyTemplateId = await getNextAgencyCounter(
        tx,
        agencyId,
        "template_config",
      );
      return tx.templateConfig.create({
        data: {
          id_agency: agencyId,
          agency_template_config_id: agencyTemplateId,
          doc_type: docType,
          config: nextConfig,
        },
      });
    });

    return res.status(200).json({
      ok: true,
      id_template: saved.id_template,
      id_agency: saved.id_agency,
      doc_type: saved.doc_type,
      config: saved.config,
      created_at: saved.created_at,
      updated_at: saved.updated_at,
    });
  } catch (error) {
    console.error("[template-config][UPSERT]", error);
    if (error instanceof z.ZodError) {
      return res
        .status(400)
        .json({ error: "Config inválida", issues: error.issues });
    }
    return res.status(500).json({ error: "Error guardando la configuración" });
  }
}

async function handleDelete(req: NextApiRequest, res: NextApiResponse) {
  try {
    const auth = await getUserFromAuth(req);
    const roleFromCookie = (req.cookies?.role || "").toLowerCase();
    const role = (auth?.role || roleFromCookie || "").toLowerCase();

    if (!auth?.id_user || !auth?.id_agency) {
      return res.status(401).json({ error: "No autenticado" });
    }
    const planAccess = await ensurePlanFeatureAccess(
      auth.id_agency,
      "templates",
    );
    if (!planAccess.allowed) {
      return res.status(403).json({ error: "Plan insuficiente" });
    }
    if (!canEdit(role)) {
      return res
        .status(403)
        .json({ error: "No autorizado para borrar templates" });
    }

    const doc_type = Array.isArray(req.query.doc_type)
      ? req.query.doc_type[0]
      : req.query.doc_type;
    const docType = (doc_type || "").trim();
    if (!docType) return res.status(400).json({ error: "doc_type requerido" });

    await prisma.templateConfig.delete({
      where: {
        id_agency_doc_type: { id_agency: auth.id_agency, doc_type: docType },
      },
    });

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("[template-config][DELETE]", error);
    return res.status(500).json({ error: "Error eliminando la configuración" });
  }
}

/* ============================================================================
 * Router
 * ========================================================================== */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "GET") return handleGet(req, res);
  if (req.method === "PUT" || req.method === "POST")
    return handleUpsert(req, res);
  if (req.method === "DELETE") return handleDelete(req, res);
  res.setHeader("Allow", ["GET", "PUT", "POST", "DELETE"]);
  return res.status(405).end(`Method ${req.method} Not Allowed`);
}
