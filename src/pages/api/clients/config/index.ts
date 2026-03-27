// src/pages/api/clients/config/index.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { jwtVerify, type JWTPayload } from "jose";
import prisma, { Prisma } from "@/lib/prisma";
import { getNextAgencyCounter } from "@/lib/agencyCounters";
import { isMissingColumnError } from "@/lib/prismaErrors";
import { z } from "zod";
import {
  normalizeClientProfiles,
  normalizeCustomFields,
  normalizeHiddenFields,
  normalizeRequiredFields,
} from "@/utils/clientConfig";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error("JWT_SECRET no configurado");

const CLIENT_PROFILES_MIGRATION_MESSAGE =
  "La base de datos no tiene la migración de Tipos de Pax. Ejecutá `npx prisma migrate deploy` (o `npx prisma migrate dev` en local).";

type TokenPayload = JWTPayload & {
  id_user?: number;
  userId?: number;
  uid?: number;
  id_agency?: number;
  agencyId?: number;
  aid?: number;
  role?: string;
  email?: string;
};

type AuthContext = {
  id_agency: number;
  role: string;
};

const customFieldSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9_]+$/),
  label: z.string().trim().min(1).max(80),
  type: z.enum([
    "text",
    "date",
    "number",
    "select",
    "multiselect",
    "boolean",
    "textarea",
  ]),
  required: z.boolean().optional(),
  placeholder: z.string().trim().max(120).optional(),
  help: z.string().trim().max(200).optional(),
  options: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
  builtin: z.boolean().optional(),
});

const putSchema = z.object({
  visibility_mode: z.enum(["all", "team", "own"]),
  required_fields: z.array(z.string()).optional(),
  custom_fields: z.array(customFieldSchema).optional(),
  hidden_fields: z.array(z.string()).optional(),
  profiles: z
    .array(
      z.object({
        key: z
          .string()
          .trim()
          .min(1)
          .max(40)
          .regex(/^[a-z0-9_]+$/),
        label: z.string().trim().min(1).max(80),
        required_fields: z.array(z.string()).optional(),
        custom_fields: z.array(customFieldSchema).optional(),
        hidden_fields: z.array(z.string()).optional(),
      }),
    )
    .optional(),
  use_simple_companions: z.boolean().optional(),
});

function getTokenFromRequest(req: NextApiRequest): string | null {
  if (req.cookies?.token) return req.cookies.token;
  const auth = req.headers.authorization || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7);
  for (const k of [
    "session",
    "auth_token",
    "access_token",
    "next-auth.session-token",
  ]) {
    const v = (req.cookies || {})[k];
    if (typeof v === "string" && v) return v;
  }
  return null;
}

async function resolveAuth(req: NextApiRequest): Promise<AuthContext | null> {
  const token = getTokenFromRequest(req);
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(JWT_SECRET),
    );
    const p = payload as TokenPayload;
    const id_agency = Number(p.id_agency ?? p.agencyId ?? p.aid) || 0;
    const role = String(p.role || "").toLowerCase();
    if (id_agency) return { id_agency, role };

    const id_user = Number(p.id_user ?? p.userId ?? p.uid) || 0;
    const email = p.email || "";
    if (id_user || email) {
      const u = await prisma.user.findFirst({
        where: id_user ? { id_user } : { email },
        select: { id_agency: true, role: true },
      });
      if (u?.id_agency) {
        return {
          id_agency: u.id_agency,
          role: (role || u.role || "").toLowerCase(),
        };
      }
    }
  } catch {
    return null;
  }
  return null;
}

function canWrite(role: string) {
  return ["gerente", "administrativo", "desarrollador"].includes(
    (role || "").toLowerCase(),
  );
}

async function hasClientConfigProfilesColumn(idAgency: number): Promise<boolean> {
  try {
    await prisma.clientConfig.findFirst({
      where: { id_agency: idAgency },
      select: { id_config: true, profiles: true },
    });
    return true;
  } catch (error) {
    if (isMissingColumnError(error, "ClientConfig.profiles")) return false;
    throw error;
  }
}

async function applyClientProfilesSchemaPatch(): Promise<void> {
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "profile_key" TEXT NOT NULL DEFAULT 'persona'`,
  );
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "ClientConfig" ADD COLUMN IF NOT EXISTS "profiles" JSONB`,
  );
  await prisma.$executeRawUnsafe(`
    UPDATE "ClientConfig"
    SET "profiles" = jsonb_build_array(
      jsonb_build_object(
        'key', 'persona',
        'label', 'Pax',
        'required_fields', COALESCE(
          "required_fields",
          '["first_name","last_name","phone","birth_date","nationality","gender","document_any"]'::jsonb
        ),
        'hidden_fields', COALESCE("hidden_fields", '[]'::jsonb),
        'custom_fields', COALESCE("custom_fields", '[]'::jsonb)
      )
    )
    WHERE "profiles" IS NULL
  `);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "Client_id_agency_profile_key_idx" ON "Client"("id_agency", "profile_key")`,
  );
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  res.setHeader("Cache-Control", "no-store");
  const reqId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  const auth = await resolveAuth(req);
  if (!auth?.id_agency) return res.status(401).json({ error: "Unauthorized" });

  if (req.method === "GET") {
    try {
      const supportsProfilesColumn = await hasClientConfigProfilesColumn(
        auth.id_agency,
      );
      if (supportsProfilesColumn) {
        const config = await prisma.clientConfig.findFirst({
          where: { id_agency: auth.id_agency },
        });
        return res.status(200).json(config ?? null);
      }

      const legacyConfig = await prisma.clientConfig.findFirst({
        where: { id_agency: auth.id_agency },
        select: {
          id_config: true,
          agency_client_config_id: true,
          id_agency: true,
          visibility_mode: true,
          required_fields: true,
          hidden_fields: true,
          custom_fields: true,
          use_simple_companions: true,
          created_at: true,
          updated_at: true,
        },
      });
      if (!legacyConfig) return res.status(200).json(null);
      return res.status(200).json({
        ...legacyConfig,
        profiles: null,
      });
    } catch (e) {
      console.error("[clients/config][GET]", reqId, e);
      return res.status(500).json({ error: "Error obteniendo configuración" });
    }
  }

  if (req.method === "PUT") {
    if (!canWrite(auth.role)) {
      return res.status(403).json({ error: "Sin permisos" });
    }
    try {
      const body =
        typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      const parsed = putSchema.safeParse(body);
      if (!parsed.success)
        return res.status(400).json({ error: parsed.error.message });

      const {
        visibility_mode,
        required_fields,
        custom_fields,
        hidden_fields,
        profiles,
        use_simple_companions,
      } = parsed.data;
      let supportsProfilesColumn = await hasClientConfigProfilesColumn(
        auth.id_agency,
      );
      if (!supportsProfilesColumn) {
        try {
          await applyClientProfilesSchemaPatch();
          supportsProfilesColumn = await hasClientConfigProfilesColumn(
            auth.id_agency,
          );
        } catch (migrationError) {
          console.error(
            "[clients/config][PUT] auto-schema-patch error",
            reqId,
            migrationError,
          );
        }
      }

      await prisma.$transaction(async (tx) => {
        let existing:
          | {
              id_config: number;
              required_fields: Prisma.JsonValue | null;
              hidden_fields: Prisma.JsonValue | null;
              custom_fields: Prisma.JsonValue | null;
              profiles?: Prisma.JsonValue | null;
            }
          | null = null;
        if (supportsProfilesColumn) {
          existing = await tx.clientConfig.findUnique({
            where: { id_agency: auth.id_agency },
            select: {
              id_config: true,
              required_fields: true,
              hidden_fields: true,
              custom_fields: true,
              profiles: true,
            },
          });
        } else {
          existing = await tx.clientConfig.findUnique({
            where: { id_agency: auth.id_agency },
            select: {
              id_config: true,
              required_fields: true,
              hidden_fields: true,
              custom_fields: true,
            },
          });
        }

        const fallbackRequired =
          required_fields !== undefined
            ? normalizeRequiredFields(required_fields)
            : existing?.required_fields ?? null;
        const fallbackHidden =
          hidden_fields !== undefined
            ? normalizeHiddenFields(hidden_fields)
            : existing?.hidden_fields ?? null;
        const fallbackCustom =
          custom_fields !== undefined
            ? normalizeCustomFields(custom_fields)
            : existing?.custom_fields ?? null;

        const nextProfiles =
          profiles !== undefined
            ? normalizeClientProfiles(profiles, {
                required_fields: fallbackRequired,
                hidden_fields: fallbackHidden,
                custom_fields: fallbackCustom,
              })
            : required_fields !== undefined ||
                hidden_fields !== undefined ||
                custom_fields !== undefined
              ? normalizeClientProfiles(null, {
                  required_fields: fallbackRequired,
                  hidden_fields: fallbackHidden,
                  custom_fields: fallbackCustom,
                })
              : normalizeClientProfiles(
                  supportsProfilesColumn ? existing?.profiles : null,
                  {
                    required_fields: existing?.required_fields ?? null,
                    hidden_fields: existing?.hidden_fields ?? null,
                    custom_fields: existing?.custom_fields ?? null,
                  },
                );

        if (!supportsProfilesColumn && nextProfiles.length > 1) {
          throw new Error(CLIENT_PROFILES_MIGRATION_MESSAGE);
        }

        const primaryProfile = nextProfiles[0];

        const requiredValue =
          primaryProfile.required_fields == null
            ? Prisma.DbNull
            : (primaryProfile.required_fields as unknown as Prisma.InputJsonValue);
        const hiddenValue =
          primaryProfile.hidden_fields == null
            ? Prisma.DbNull
            : (primaryProfile.hidden_fields as unknown as Prisma.InputJsonValue);
        const customValue =
          primaryProfile.custom_fields == null
            ? Prisma.DbNull
            : (primaryProfile.custom_fields as unknown as Prisma.InputJsonValue);
        const profilesValue =
          nextProfiles.length > 0
            ? (nextProfiles as unknown as Prisma.InputJsonValue)
            : Prisma.DbNull;

        const dataBase = {
          visibility_mode,
          required_fields: requiredValue,
          hidden_fields: hiddenValue,
          custom_fields: customValue,
        };

        if (existing) {
          const updateData: Prisma.ClientConfigUpdateInput = supportsProfilesColumn
            ? {
                ...dataBase,
                profiles: profilesValue,
                ...(typeof use_simple_companions === "boolean"
                  ? { use_simple_companions }
                  : {}),
              }
            : {
                ...dataBase,
                ...(typeof use_simple_companions === "boolean"
                  ? { use_simple_companions }
                  : {}),
              };
          await tx.clientConfig.update({
            where: { id_agency: auth.id_agency },
            data: updateData,
          });
          return;
        }
        const agencyConfigId = await getNextAgencyCounter(
          tx,
          auth.id_agency,
          "client_config",
        );
        await tx.clientConfig.create({
          data: {
            id_agency: auth.id_agency,
            agency_client_config_id: agencyConfigId,
            ...dataBase,
            ...(supportsProfilesColumn ? { profiles: profilesValue } : {}),
            use_simple_companions: Boolean(use_simple_companions),
          },
        });
      });

      return res.status(200).json({ ok: true });
    } catch (e) {
      console.error("[clients/config][PUT]", reqId, e);
      if (e instanceof Error && e.message === CLIENT_PROFILES_MIGRATION_MESSAGE) {
        return res.status(409).json({ error: CLIENT_PROFILES_MIGRATION_MESSAGE });
      }
      if (isMissingColumnError(e, "ClientConfig.profiles")) {
        return res.status(409).json({ error: CLIENT_PROFILES_MIGRATION_MESSAGE });
      }
      return res.status(500).json({ error: "Error guardando configuración" });
    }
  }

  res.setHeader("Allow", "GET, PUT");
  return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
}
