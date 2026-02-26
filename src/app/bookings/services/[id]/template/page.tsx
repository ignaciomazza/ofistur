"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import ProtectedRoute from "@/components/ProtectedRoute";
import Spinner from "@/components/Spinner";
import { useAuth } from "@/context/AuthContext";
import { authFetch } from "@/utils/authFetch";
import TemplatePdfDownload from "@/components/templates/TemplatePdfDownload";
import TextPresetPicker from "@/components/templates/TextPresetPicker";
import StudioShell, { type StudioTab } from "@/components/studio/StudioShell";
import StudioSystemNavigation from "@/components/studio/StudioSystemNavigation";
import type {
  OrderedBlock,
  BlockFormValue,
  BlockType,
  Density,
} from "@/types/templates";
import BlocksCanvas from "@/components/templates/BlocksCanvas";
import { nanoid } from "nanoid/non-secure";
import { normalizeConfig, getAt } from "@/lib/templateConfig";
import { sanitizeBlockTextStyle } from "@/lib/blockTextStyle";
import type { Booking, Client, Service, Operator } from "@/types";
import type { Agency as TemplateAgency, ContentBlock } from "@/types/templates";
import { formatDateInBuenosAires } from "@/lib/buenosAiresDate";

type ServiceWithOperator = Service & { operator?: Operator | null };
type BookingPayload = Booking & { services?: ServiceWithOperator[] };

/* eslint-disable @next/next/no-img-element */
const PAGE_TITLE = "Confirmación de servicios";
const PANEL_CLASS =
  "rounded-3xl border border-white/10 bg-white/10 p-5 shadow-md shadow-sky-950/10 backdrop-blur";
const STUDIO_ICON_TAB =
  "inline-flex items-center justify-center rounded-xl border border-slate-300/55 bg-white/85 p-2 text-slate-700 shadow-sm transition hover:scale-[0.98] dark:border-slate-200/25 dark:bg-slate-900/60 dark:text-slate-100";
const STUDIO_ICON_TAB_ACTIVE =
  "border-sky-500/55 bg-sky-500/15 text-sky-900 dark:border-sky-300/50 dark:bg-sky-500/30 dark:text-sky-50";

const cx = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(" ");

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(
    (hex || "").trim(),
  );
  if (!m) return null;
  return {
    r: parseInt(m[1], 16),
    g: parseInt(m[2], 16),
    b: parseInt(m[3], 16),
  };
}

function luminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0.5;
  const a = [rgb.r, rgb.g, rgb.b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function useUiTokens(cfg: Record<string, unknown>) {
  const radius = getAt<string>(cfg, ["styles", "ui", "radius"], "2xl");
  const innerRadiusClass =
    radius === "sm"
      ? "rounded"
      : radius === "md"
        ? "rounded-md"
        : radius === "lg"
          ? "rounded-lg"
          : radius === "xl"
            ? "rounded-xl"
            : "rounded-2xl";

  const densityRaw = getAt<string>(
    cfg,
    ["styles", "ui", "density"],
    "comfortable",
  );
  const density: Density =
    densityRaw === "compact" || densityRaw === "relaxed"
      ? densityRaw
      : "comfortable";

  const padX =
    density === "compact" ? "px-4" : density === "relaxed" ? "px-7" : "px-6";
  const padY =
    density === "compact" ? "py-3" : density === "relaxed" ? "py-6" : "py-5";

  const gapBlocks =
    density === "compact"
      ? "space-y-2"
      : density === "relaxed"
        ? "space-y-5"
        : "space-y-3";
  const gapGrid =
    density === "compact" ? "gap-2" : density === "relaxed" ? "gap-4" : "gap-3";
  const listSpace =
    density === "compact"
      ? "space-y-0.5"
      : density === "relaxed"
        ? "space-y-2"
        : "space-y-1";

  const contentWidth = getAt<string>(
    cfg,
    ["styles", "ui", "contentWidth"],
    "normal",
  );
  const contentMaxW =
    contentWidth === "narrow"
      ? "max-w-2xl"
      : contentWidth === "wide"
        ? "max-w-5xl"
        : "max-w-3xl";

  const dividers = getAt<boolean>(cfg, ["styles", "ui", "dividers"], true);

  return {
    innerRadiusClass,
    padX,
    padY,
    gapBlocks,
    gapGrid,
    listSpace,
    contentMaxW,
    density,
    dividers,
  };
}

function formatDate(dateString?: string | null) {
  if (!dateString) return "—";
  return formatDateInBuenosAires(dateString);
}

function formatMoney(
  amount: number | null | undefined,
  currency?: string | null,
) {
  if (amount == null || !Number.isFinite(Number(amount))) return "—";
  const c = (currency || "ARS").toUpperCase();
  try {
    return new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency: c,
      minimumFractionDigits: 2,
    }).format(Number(amount));
  } catch {
    return `${Number(amount).toFixed(2)} ${c}`;
  }
}

function joinPieces(items: Array<string | null | undefined>) {
  return items.filter((item) => item && String(item).trim()).join(" | ");
}

function formatPassenger(p: Client) {
  const name = `${p.last_name || ""}, ${p.first_name || ""}`.trim();
  const birth = p.birth_date ? formatDate(p.birth_date) : "—";
  const extra = joinPieces([
    p.dni_number ? `DNI: ${p.dni_number}` : "",
    p.passport_number ? `Pasaporte: ${p.passport_number}` : "",
  ]);
  return {
    name: name || "Pasajero",
    birth,
    extra: extra || "—",
  };
}

function buildTotalPriceValue(
  booking: BookingPayload | null,
  services: ServiceWithOperator[],
  allServicesCount?: number,
): string {
  if (
    booking?.totalSale != null &&
    typeof allServicesCount === "number" &&
    services.length === allServicesCount
  ) {
    return formatMoney(booking.totalSale, "ARS");
  }

  const sums: Record<string, number> = {};
  services.forEach((service) => {
    const amount = Number(service.sale_price);
    if (!Number.isFinite(amount)) return;
    const cur = (service.currency || "ARS").toUpperCase();
    sums[cur] = (sums[cur] || 0) + amount;
  });

  const entries = Object.entries(sums);
  if (entries.length === 0) return "—";
  if (entries.length === 1) {
    const [cur, total] = entries[0]!;
    return formatMoney(total, cur);
  }
  return entries
    .map(
      ([cur, total]) =>
        `${cur} ${formatMoney(total, cur).replace(cur, "").trim()}`,
    )
    .join(" + ");
}

function contentBlockToOrdered(
  b: ContentBlock,
  forceEditable = false,
): OrderedBlock {
  const base = {
    id: b.id,
    origin: forceEditable ? "form" : b.mode === "form" ? "form" : "fixed",
    type: b.type,
    label: b.label,
    textStyle: sanitizeBlockTextStyle(b.textStyle),
  } as const;

  switch (b.type) {
    case "heading":
      return {
        ...base,
        type: "heading",
        value: { type: "heading", text: b.text ?? "", level: b.level ?? 1 },
      };
    case "subtitle":
      return {
        ...base,
        type: "subtitle",
        value: { type: "subtitle", text: b.text ?? "" },
      };
    case "paragraph":
      return {
        ...base,
        type: "paragraph",
        value: { type: "paragraph", text: b.text ?? "" },
      };
    case "list":
      return {
        ...base,
        type: "list",
        value: { type: "list", items: Array.isArray(b.items) ? b.items : [] },
      };
    case "keyValue":
      return {
        ...base,
        type: "keyValue",
        value: {
          type: "keyValue",
          pairs: Array.isArray(b.pairs) ? b.pairs : [],
        },
      };
    case "twoColumns":
      return {
        ...base,
        type: "twoColumns",
        value: {
          type: "twoColumns",
          left: b.left ?? "",
          right: b.right ?? "",
        },
      };
    case "threeColumns":
      return {
        ...base,
        type: "threeColumns",
        value: {
          type: "threeColumns",
          left: b.left ?? "",
          center: b.center ?? "",
          right: b.right ?? "",
        },
      };
  }
}

function makeNewBlock(type: BlockType): OrderedBlock {
  const id = nanoid();
  switch (type) {
    case "heading":
      return {
        id,
        origin: "extra",
        type,
        value: { type: "heading", text: "Título", level: 1 },
      };
    case "subtitle":
      return {
        id,
        origin: "extra",
        type,
        value: { type: "subtitle", text: "Subtítulo" },
      };
    case "paragraph":
      return {
        id,
        origin: "extra",
        type,
        value: { type: "paragraph", text: "Texto del párrafo" },
      };
    case "list":
      return {
        id,
        origin: "extra",
        type,
        value: { type: "list", items: ["Ítem 1", "Ítem 2"] },
      };
    case "keyValue":
      return {
        id,
        origin: "extra",
        type,
        value: { type: "keyValue", pairs: [{ key: "Clave", value: "Valor" }] },
      };
    case "twoColumns":
      return {
        id,
        origin: "extra",
        type,
        value: { type: "twoColumns", left: "Izquierda", right: "Derecha" },
      };
    case "threeColumns":
      return {
        id,
        origin: "extra",
        type,
        value: {
          type: "threeColumns",
          left: "Izquierda",
          center: "Centro",
          right: "Derecha",
        },
      };
  }
}

function normalizeAgencyForPdf(agency?: Booking["agency"]): TemplateAgency {
  if (!agency) return {};
  const emails = Array.isArray((agency as { emails?: string[] }).emails)
    ? ((agency as { emails?: string[] }).emails as string[])
    : agency.email
      ? [agency.email]
      : [];
  const phones = Array.isArray(agency.phones) ? agency.phones : [];
  const socials =
    (agency as { socials?: TemplateAgency["socials"] }).socials ??
    (agency as { social?: TemplateAgency["social"] }).social ??
    undefined;

  return {
    id: agency.id_agency,
    id_agency: agency.id_agency,
    name: agency.name,
    legal_name: agency.legal_name,
    logo_url: agency.logo_url,
    address: agency.address,
    website: agency.website,
    phone: agency.phone,
    phones,
    emails,
    socials,
    social: socials,
  };
}

type CoverOption = { url: string; name: string };

function buildCoverOptions(cfg: Record<string, unknown>): CoverOption[] {
  const options = new Map<string, CoverOption>();

  const savedRaw = getAt<unknown>(cfg, ["coverImage", "saved"], []);
  if (Array.isArray(savedRaw)) {
    savedRaw
      .filter(isObj)
      .map((o) => ({
        url: String(o.url || ""),
        name: String(o.name || o.url || "Portada"),
      }))
      .filter((o) => o.url.trim().length > 0)
      .forEach((o) => {
        if (!options.has(o.url)) options.set(o.url, o);
      });
  }

  const urlsRaw = getAt<unknown>(cfg, ["coverImage", "urls"], []);
  if (Array.isArray(urlsRaw)) {
    urlsRaw
      .filter((u): u is string => typeof u === "string" && u.trim().length > 0)
      .forEach((url) => {
        if (!options.has(url)) options.set(url, { url, name: url });
      });
  }

  const directUrl = getAt<string>(cfg, ["coverImage", "url"], "");
  if (directUrl && !options.has(directUrl)) {
    options.set(directUrl, { url: directUrl, name: directUrl });
  }

  return Array.from(options.values());
}

function isValidBlockType(type: string): type is BlockType {
  return (
    type === "heading" ||
    type === "subtitle" ||
    type === "paragraph" ||
    type === "list" ||
    type === "keyValue" ||
    type === "twoColumns" ||
    type === "threeColumns"
  );
}

function presetValueFor(
  type: BlockType,
  raw: Record<string, unknown>,
): BlockFormValue {
  const value = isObj(raw.value) ? (raw.value as Record<string, unknown>) : {};
  switch (type) {
    case "heading":
      return {
        type: "heading",
        text: String(value.text ?? raw.text ?? raw.label ?? ""),
        level: (value.level as 1 | 2 | 3) ?? 1,
      };
    case "subtitle":
      return {
        type: "subtitle",
        text: String(value.text ?? raw.text ?? raw.label ?? ""),
      };
    case "paragraph":
      return {
        type: "paragraph",
        text: String(value.text ?? raw.text ?? ""),
      };
    case "list":
      return {
        type: "list",
        items: Array.isArray(value.items)
          ? value.items.map((x) => String(x ?? ""))
          : Array.isArray(raw.items)
            ? raw.items.map((x) => String(x ?? ""))
            : [],
      };
    case "keyValue":
      return {
        type: "keyValue",
        pairs: Array.isArray(value.pairs)
          ? value.pairs.map((p) => ({
              key: String((p as { key?: unknown }).key ?? ""),
              value: String((p as { value?: unknown }).value ?? ""),
            }))
          : Array.isArray(raw.pairs)
            ? raw.pairs.map((p) => ({
                key: String((p as { key?: unknown }).key ?? ""),
                value: String((p as { value?: unknown }).value ?? ""),
              }))
            : [],
      };
    case "twoColumns":
      return {
        type: "twoColumns",
        left: String(value.left ?? raw.left ?? ""),
        right: String(value.right ?? raw.right ?? ""),
      };
    case "threeColumns":
      return {
        type: "threeColumns",
        left: String(value.left ?? raw.left ?? ""),
        center: String(value.center ?? raw.center ?? ""),
        right: String(value.right ?? raw.right ?? ""),
      };
  }
}

function presetBlocksToOrdered(input: unknown): OrderedBlock[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((raw) => {
      if (!isObj(raw)) return null;
      const type = String(raw.type || "");
      if (!isValidBlockType(type)) return null;
      const origin =
        raw.origin === "fixed" || raw.origin === "form" ? raw.origin : "extra";
      const value = presetValueFor(type, raw);
      const nestedValue = isObj(raw.value)
        ? (raw.value as Record<string, unknown>)
        : undefined;
      const textStyle = sanitizeBlockTextStyle(
        raw.textStyle ?? nestedValue?.textStyle,
      );
      return {
        id: nanoid(),
        origin,
        type,
        value,
        textStyle,
      } satisfies OrderedBlock;
    })
    .filter(Boolean) as OrderedBlock[];
}

type StudioPanel = "system" | "design" | "manage";
type DesignMenuSection =
  | "cover"
  | "contact"
  | "payment"
  | "services"
  | "signature";

export default function BookingVoucherPage() {
  const params = useParams();
  const id = params?.id ? String(params.id) : null;
  const { token } = useAuth();

  const [booking, setBooking] = useState<BookingPayload | null>(null);
  const [cfgRaw, setCfgRaw] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [includeSignature, setIncludeSignature] = useState(false);
  const [includePaxSignature, setIncludePaxSignature] = useState(true);
  const [includeAgencySignature, setIncludeAgencySignature] = useState(true);
  const [includeClarification, setIncludeClarification] = useState(true);
  const [includeDni, setIncludeDni] = useState(true);

  const [selectedCoverUrl, setSelectedCoverUrl] = useState("");
  const [selectedPaymentIndex, setSelectedPaymentIndex] = useState<
    number | null
  >(null);
  const [selectedPhone, setSelectedPhone] = useState("");
  const [selectedServiceIds, setSelectedServiceIds] = useState<Set<number>>(
    new Set(),
  );
  const [studioPanel, setStudioPanel] = useState<StudioPanel>("design");
  const [designMenuSection, setDesignMenuSection] =
    useState<DesignMenuSection>("cover");

  const coverTouchedRef = useRef(false);
  const paymentTouchedRef = useRef(false);
  const phoneTouchedRef = useRef(false);
  const servicesInitRef = useRef<string | null>(null);

  useEffect(() => {
    servicesInitRef.current = null;
  }, [id]);

  useEffect(() => {
    if (!token || !id) return;
    const controller = new AbortController();

    (async () => {
      try {
        setLoading(true);
        setError(null);

        const [bookingRes, cfgRes] = await Promise.all([
          authFetch(
            `/api/bookings/${id}`,
            { cache: "no-store", signal: controller.signal },
            token,
          ),
          authFetch(
            "/api/template-config/voucher?resolved=1",
            { cache: "no-store", signal: controller.signal },
            token,
          ),
        ]);

        const bookingJson = (await bookingRes.json()) as BookingPayload;
        const cfgJson = (await cfgRes.json()) as {
          config?: Record<string, unknown>;
        };

        if (!bookingRes.ok) {
          throw new Error(
            (bookingJson as { error?: string })?.error ||
              "Error al obtener la reserva",
          );
        }
        if (!cfgRes.ok) {
          throw new Error(
            (cfgJson as { error?: string })?.error ||
              "Error al obtener el template",
          );
        }

        setBooking(bookingJson);
        setCfgRaw(cfgJson.config ?? {});
      } catch (err) {
        if (controller.signal.aborted) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        const msg = err instanceof Error ? err.message : "Error al cargar";
        setError(msg);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [token, id]);

  const rCfg = useMemo(() => normalizeConfig(cfgRaw, "voucher"), [cfgRaw]);
  const coverOptions = useMemo(() => buildCoverOptions(cfgRaw), [cfgRaw]);
  const defaultCoverUrl =
    rCfg.coverImage?.mode === "url" ? rCfg.coverImage?.url || "" : "";

  useEffect(() => {
    if (coverTouchedRef.current) return;
    setSelectedCoverUrl(defaultCoverUrl);
  }, [defaultCoverUrl]);

  const uiTokens = useUiTokens(rCfg as Record<string, unknown>);
  const accent = rCfg?.styles?.colors?.accent ?? "#6B7280";
  const bg = rCfg?.styles?.colors?.background ?? "#ffffff";
  const text = rCfg?.styles?.colors?.text ?? "#111111";
  const isLightBg = luminance(bg) >= 0.7;
  const dividerColor =
    bg.toLowerCase() === "#ffffff" || bg.toLowerCase() === "#fff"
      ? "rgba(0,0,0,0.08)"
      : "rgba(255,255,255,0.10)";
  const panelBgStrong =
    bg.toLowerCase() === "#ffffff" || bg.toLowerCase() === "#fff"
      ? "rgba(0,0,0,0.04)"
      : "rgba(255,255,255,0.06)";
  const panelBgSoft =
    bg.toLowerCase() === "#ffffff" || bg.toLowerCase() === "#fff"
      ? "rgba(0,0,0,0.06)"
      : "rgba(255,255,255,0.06)";
  const headingFont = "Poppins";
  const headingWeight = 600;

  const services = useMemo<ServiceWithOperator[]>(
    () =>
      Array.isArray(booking?.services)
        ? (booking.services as ServiceWithOperator[])
        : [],
    [booking],
  );

  useEffect(() => {
    if (!id || services.length === 0) return;
    if (servicesInitRef.current === id) return;
    servicesInitRef.current = id;
    setSelectedServiceIds(new Set(services.map((s) => s.id_service)));
  }, [id, services]);

  const selectedServices = useMemo(
    () => services.filter((s) => selectedServiceIds.has(s.id_service)),
    [services, selectedServiceIds],
  );

  const paymentOptions = useMemo(
    () => (Array.isArray(rCfg.paymentOptions) ? rCfg.paymentOptions : []),
    [rCfg.paymentOptions],
  );
  const defaultPaymentIndex =
    typeof rCfg.payment?.selectedIndex === "number"
      ? rCfg.payment.selectedIndex
      : null;

  useEffect(() => {
    if (paymentTouchedRef.current) return;
    if (
      defaultPaymentIndex == null ||
      defaultPaymentIndex >= paymentOptions.length
    ) {
      setSelectedPaymentIndex(null);
      return;
    }
    setSelectedPaymentIndex(defaultPaymentIndex);
  }, [defaultPaymentIndex, paymentOptions.length]);

  const paymentSelected =
    selectedPaymentIndex !== null
      ? paymentOptions[selectedPaymentIndex] || ""
      : "";

  const coreBlocks = useMemo<ContentBlock[]>(() => {
    if (!booking) return [];
    const blocks: ContentBlock[] = [];
    const makeId = (suffix: string) => `v_${suffix}`;

    blocks.push({
      id: makeId("title"),
      type: "heading",
      mode: "fixed",
      text: PAGE_TITLE,
      level: 1,
    });
    // Se omite el subtítulo con número de reserva por pedido
    blocks.push({
      id: makeId("summary_title"),
      type: "subtitle",
      mode: "fixed",
      text: "Detalle de la reserva",
    });
    blocks.push({
      id: makeId("summary_list"),
      type: "list",
      mode: "fixed",
      items: [
        `Titular: ${
          `${booking.titular?.first_name || ""} ${booking.titular?.last_name || ""}`.trim() ||
          "—"
        }`,
        `Salida: ${formatDate(booking.departure_date)}`,
        `Regreso: ${formatDate(booking.return_date)}`,
      ],
    });

    if (booking.details) {
      blocks.push({
        id: makeId("details"),
        type: "paragraph",
        mode: "fixed",
        text: booking.details,
      });
    }

    if (booking.observation) {
      blocks.push({
        id: makeId("obs_title"),
        type: "subtitle",
        mode: "fixed",
        text: "Observaciones",
      });
      blocks.push({
        id: makeId("obs"),
        type: "paragraph",
        mode: "fixed",
        text: booking.observation,
      });
    }

    blocks.push({
      id: makeId("pax_title"),
      type: "heading",
      mode: "fixed",
      text: "Pasajeros",
      level: 2,
    });
    blocks.push({
      id: makeId("pax_count"),
      type: "paragraph",
      mode: "fixed",
      text: `Cantidad de pasajeros: ${
        Number.isFinite(Number(booking.pax_count))
          ? String(booking.pax_count)
          : "—"
      }`,
    });

    const paxItems = Array.isArray(booking.clients)
      ? booking.clients.map(formatPassenger)
      : [];
    if (paxItems.length === 0) {
      blocks.push({
        id: makeId("pax_empty"),
        type: "paragraph",
        mode: "fixed",
        text: "Sin pasajeros cargados.",
      });
    } else {
      paxItems.forEach((pax, idx) => {
        blocks.push({
          id: makeId(`pax_${idx}`),
          type: "threeColumns",
          mode: "fixed",
          left: pax.name,
          center: pax.birth,
          right: pax.extra,
        });
      });
    }

    blocks.push({
      id: makeId("srv_title"),
      type: "heading",
      mode: "fixed",
      text: "Servicios",
      level: 2,
    });

    if (selectedServices.length === 0) {
      blocks.push({
        id: makeId("srv_empty"),
        type: "paragraph",
        mode: "fixed",
        text: "Sin servicios seleccionados.",
      });
    } else {
      const descriptions = selectedServices
        .map((s) => s.description || "")
        .map((s) => s.trim())
        .filter(Boolean);
      if (descriptions.length) {
        blocks.push({
          id: makeId("srv_desc_title"),
          type: "subtitle",
          mode: "fixed",
          text: "Descripción de servicios",
        });
        blocks.push({
          id: makeId("srv_desc_list"),
          type: "list",
          mode: "fixed",
          items: descriptions,
        });
      }
    }

    blocks.push({
      id: makeId("total_price"),
      type: "keyValue",
      mode: "fixed",
      pairs: [
        {
          key: "Precio final",
          value: buildTotalPriceValue(
            booking,
            selectedServices,
            services.length,
          ),
        },
      ],
    });

    return blocks;
  }, [booking, selectedServices, services]);

  const signatureBlocks = useMemo<ContentBlock[]>(() => {
    if (!includeSignature) return [];
    if (!includePaxSignature && !includeAgencySignature) return [];
    const blocks: ContentBlock[] = [];
    const makeId = (suffix: string) => `v_sig_${suffix}`;

    const buildSignatureText = (label: string) => {
      const lines = [`Firma ${label}: ________________________________`];
      if (includeClarification) {
        lines.push("Aclaración: ______________________________");
      }
      if (includeDni) {
        lines.push("DNI: ______________________________");
      }
      return lines.join("\n");
    };

    blocks.push({
      id: makeId("title"),
      type: "heading",
      mode: "fixed",
      text: "Firmas",
      level: 2,
    });

    const left = includePaxSignature ? buildSignatureText("Pax") : "";
    const right = includeAgencySignature ? buildSignatureText("Agencia") : "";

    if (includePaxSignature && includeAgencySignature) {
      blocks.push({
        id: makeId("cols"),
        type: "twoColumns",
        mode: "fixed",
        left,
        right,
      });
    } else {
      blocks.push({
        id: makeId("single"),
        type: "paragraph",
        mode: "fixed",
        text: left || right,
      });
    }

    return blocks;
  }, [
    includeSignature,
    includePaxSignature,
    includeAgencySignature,
    includeClarification,
    includeDni,
  ]);

  const appendedBlocks = useMemo(() => {
    const cfgBlocks = Array.isArray(rCfg.content?.blocks)
      ? (rCfg.content?.blocks as ContentBlock[])
      : [];
    return [...cfgBlocks, ...signatureBlocks];
  }, [rCfg, signatureBlocks]);

  const previewBlocks = useMemo(
    () => coreBlocks.concat(appendedBlocks),
    [coreBlocks, appendedBlocks],
  );

  const [editableBlocks, setEditableBlocks] = useState<OrderedBlock[]>([]);
  const lockedIds = useMemo(() => {
    const ids = editableBlocks
      .filter((b) => b.origin === "fixed")
      .map((b) => b.id);
    return new Set<string>(ids);
  }, [editableBlocks]);
  const canToggleInheritedLock = useCallback(
    (block: OrderedBlock) => block.id.startsWith("v_"),
    [],
  );
  const toggleInheritedLock = useCallback((id: string, next: "fixed" | "form") => {
    setEditableBlocks((prev) =>
      prev.map((block) => {
        if (block.id !== id) return block;
        if (!block.id.startsWith("v_")) return block;
        return { ...block, origin: next === "fixed" ? "fixed" : "form" };
      }),
    );
  }, []);
  const previewKey = useMemo(
    () => previewBlocks.map((b) => b.id).join("|"),
    [previewBlocks],
  );

  useEffect(() => {
    setEditableBlocks((prev) => {
      const byId = new Map(prev.map((b) => [b.id, b]));
      return previewBlocks.map(
        (b) => byId.get(b.id) ?? contentBlockToOrdered(b, false),
      );
    });
  }, [previewKey, previewBlocks]);

  const baseAgencyForPdf = useMemo(
    () => normalizeAgencyForPdf(booking?.agency),
    [booking],
  );

  const phoneOptions = useMemo(() => {
    const options: Array<{ value: string; label: string }> = [];
    const seen = new Set<string>();
    const add = (value: string, label: string) => {
      const trimmed = value.trim();
      if (!trimmed || seen.has(trimmed)) return;
      seen.add(trimmed);
      options.push({ value: trimmed, label });
    };

    if (baseAgencyForPdf.phone) {
      add(baseAgencyForPdf.phone, "Teléfono agencia");
    }
    if (Array.isArray(baseAgencyForPdf.phones)) {
      baseAgencyForPdf.phones.forEach((p, idx) => {
        add(p, `Teléfono ${idx + 1}`);
      });
    }

    return options;
  }, [baseAgencyForPdf]);

  useEffect(() => {
    if (phoneTouchedRef.current) return;
    const fallback = phoneOptions[0]?.value || "";
    setSelectedPhone(fallback);
  }, [phoneOptions]);

  const agencyForPdf = useMemo(() => {
    const phones = Array.isArray(baseAgencyForPdf.phones)
      ? [...baseAgencyForPdf.phones]
      : [];
    const preferred = selectedPhone || baseAgencyForPdf.phone || "";
    if (preferred) {
      const idx = phones.indexOf(preferred);
      if (idx >= 0) phones.splice(idx, 1);
      phones.unshift(preferred);
    }
    return { ...baseAgencyForPdf, phones };
  }, [baseAgencyForPdf, selectedPhone]);

  const contactLine = useMemo(() => {
    const items = Array.isArray(rCfg.contactItems) ? rCfg.contactItems : [];
    const out: Array<{ label: string; value: string }> = [];
    const phones = Array.isArray(agencyForPdf.phones)
      ? agencyForPdf.phones
      : [];
    const emails = Array.isArray(agencyForPdf.emails)
      ? agencyForPdf.emails
      : [];
    const website = agencyForPdf.website || "";
    const address = agencyForPdf.address || "";
    const phone = selectedPhone || phones[0] || agencyForPdf.phone || "";
    const email = emails[0] || "";

    if (items.includes("website") && website)
      out.push({ label: "Web", value: website });
    if (items.includes("address") && address)
      out.push({ label: "Dirección", value: address });
    if (items.includes("phones") && phone)
      out.push({ label: "Tel", value: phone });
    if (items.includes("email") && email)
      out.push({ label: "Mail", value: email });

    return out;
  }, [agencyForPdf, rCfg, selectedPhone]);

  const PaymentPreview: React.FC = () =>
    !paymentSelected ? null : (
      <div
        className={cx("mt-4 text-sm", uiTokens.innerRadiusClass, "p-3")}
        style={{
          border: `1px solid ${dividerColor}`,
          backgroundColor: panelBgSoft,
        }}
      >
        <div className="mb-1 font-medium" style={{ color: accent }}>
          Forma de pago
        </div>
        <div className="opacity-90">{paymentSelected}</div>
      </div>
    );

  const userForPdf = useMemo(
    () =>
      booking?.user
        ? {
            first_name: booking.user.first_name,
            last_name: booking.user.last_name,
            email: booking.user.email,
          }
        : {},
    [booking],
  );

  const saveCurrentAsPreset = async () => {
    try {
      if (!token) throw new Error("No hay token de autenticación.");
      const title = window.prompt("Nombre del preset de contenido:");
      if (!title || !title.trim()) return;

      const blocksToSave = editableBlocks.filter((b) => b.origin !== "fixed");
      if (blocksToSave.length === 0) {
        alert("No hay bloques personalizados para guardar.");
        return;
      }

      const envelope = {
        version: 2,
        kind: "data" as const,
        data: { blocks: blocksToSave },
      };

      const payload = {
        title: title.trim(),
        content: "",
        doc_type: "voucher",
        data: envelope,
      };

      const res = await fetch("/api/text-preset", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const msg =
          (data?.error as string) ||
          (data?.message as string) ||
          "No se pudo guardar el preset.";
        throw new Error(msg);
      }

      alert("Preset guardado.");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Error guardando preset.");
    }
  };

  const bookingId = booking?.agency_booking_id ?? booking?.id_booking ?? "";
  const tabs: StudioTab[] = useMemo(
    () => [
      {
        key: "system",
        srLabel: "Menú",
        label: (
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={1.7}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12H12m-8.25 5.25h16.5" />
          </svg>
        ),
      },
      {
        key: "design",
        srLabel: "Diseño",
        label: (
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={1.7}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.53 16.122a3 3 0 0 0-5.78 1.128 2.25 2.25 0 0 1-2.4 2.245 4.5 4.5 0 0 0 8.4-2.245c0-.399-.078-.78-.22-1.128Zm0 0a15.998 15.998 0 0 0 3.388-1.62m-5.043-.025a15.994 15.994 0 0 1 1.622-3.395m3.42 3.42a15.995 15.995 0 0 0 4.764-4.648l3.876-5.814a1.151 1.151 0 0 0-1.597-1.597L14.146 6.32a15.996 15.996 0 0 0-4.649 4.763m3.42 3.42a6.776 6.776 0 0 0-3.42-3.42" />
          </svg>
        ),
      },
      {
        key: "manage",
        srLabel: "Cotización",
        label: (
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={1.7}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 21H4.5a1.5 1.5 0 0 1-1.5-1.5V5.56a1.5 1.5 0 0 1 .44-1.06l1.06-1.06A1.5 1.5 0 0 1 5.56 3h11.38a1.5 1.5 0 0 1 1.06.44l1.06 1.06a1.5 1.5 0 0 1 .44 1.06V19.5A1.5 1.5 0 0 1 19.5 21Z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 3v5.25h7.5V3M8.25 21v-6h7.5v6" />
          </svg>
        ),
      },
    ],
    [],
  );
  const panelTitle =
    studioPanel === "system"
      ? "Menú"
      : studioPanel === "design"
      ? "Diseño"
      : "Cotización";
  const designMenuItems: Array<{
    key: DesignMenuSection;
    label: string;
    icon: JSX.Element;
  }> = [
    {
      key: "cover",
      label: "Portada",
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={1.6}>
          <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Z" />
        </svg>
      ),
    },
    {
      key: "contact",
      label: "Contacto",
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={1.6}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102A1.125 1.125 0 0 0 5.872 2.25H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z" />
        </svg>
      ),
    },
    {
      key: "payment",
      label: "Cobro",
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={1.6}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Z" />
        </svg>
      ),
    },
    {
      key: "services",
      label: "Servicios",
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={1.6}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 7.5h18M3 12h18M3 16.5h18" />
        </svg>
      ),
    },
    {
      key: "signature",
      label: "Firmas",
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={1.6}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 3.75H7.5a2.25 2.25 0 0 0-2.25 2.25v12A2.25 2.25 0 0 0 7.5 20.25h9A2.25 2.25 0 0 0 18.75 18V6A2.25 2.25 0 0 0 16.5 3.75Z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 15.75h7.5M8.25 11.25h7.5M8.25 6.75h7.5" />
        </svg>
      ),
    },
  ];
  const quickAddItems: Array<{ type: BlockType; label: string }> = [
    { type: "heading", label: "Título" },
    { type: "subtitle", label: "Subtítulo" },
    { type: "paragraph", label: "Párrafo" },
    { type: "list", label: "Lista" },
    { type: "keyValue", label: "Clave/Valor" },
    { type: "twoColumns", label: "Dos columnas" },
    { type: "threeColumns", label: "Tres columnas" },
  ];

  const panelBody = (() => {
    if (studioPanel === "system") {
      return (
        <StudioSystemNavigation
          backHref={`/bookings/services/${id}`}
          backLabel="Volver a la reserva"
          intro="Navegá por el sistema sin perder el contexto de la confirmación."
        />
      );
    }

    if (studioPanel === "design") {
      return (
        <div className="space-y-3">
          <div className={PANEL_CLASS}>
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              Módulos de diseño
            </h3>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
              Elegí un módulo y editá ese grupo de opciones.
            </p>
            <div className="mt-3 grid grid-cols-5 gap-2">
              {designMenuItems.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setDesignMenuSection(item.key)}
                  className={cx(
                    STUDIO_ICON_TAB,
                    designMenuSection === item.key && STUDIO_ICON_TAB_ACTIVE,
                  )}
                  title={item.label}
                >
                  {item.icon}
                  <span className="sr-only">{item.label}</span>
                </button>
              ))}
            </div>
            <div className="mt-2 grid grid-cols-5 gap-2 text-center text-[10px] font-medium text-slate-500 dark:text-slate-300">
              {designMenuItems.map((item) => (
                <span key={item.key}>{item.label}</span>
              ))}
            </div>
          </div>

          {designMenuSection === "cover" ? (
            <div className={PANEL_CLASS}>
              <h3 className="text-sm font-semibold">Portada</h3>
              {coverOptions.length === 0 ? (
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-300">
                  No hay portadas configuradas en el template.
                </p>
              ) : (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      coverTouchedRef.current = true;
                      setSelectedCoverUrl("");
                    }}
                    className={cx(
                      "rounded-xl border px-2 py-2 text-xs",
                      !selectedCoverUrl
                        ? "border-sky-400/60 bg-sky-500/10 text-sky-900 dark:text-sky-200"
                        : "border-white/10 bg-white/10 text-slate-600 dark:text-slate-300",
                    )}
                  >
                    Usar logo
                  </button>
                  {coverOptions.map((opt) => {
                    const active = selectedCoverUrl === opt.url;
                    return (
                      <button
                        key={opt.url}
                        type="button"
                        onClick={() => {
                          coverTouchedRef.current = true;
                          setSelectedCoverUrl(opt.url);
                        }}
                        className={cx(
                          "relative overflow-hidden rounded-xl border",
                          active
                            ? "border-sky-400/60 ring-1 ring-sky-300/60"
                            : "border-white/10",
                        )}
                        title={opt.name}
                      >
                        <img
                          src={opt.url}
                          alt={opt.name}
                          className="h-24 w-full object-cover"
                        />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ) : null}

          {designMenuSection === "contact" ? (
            <div className={PANEL_CLASS}>
              <h3 className="text-sm font-semibold">Teléfono visible</h3>
              {phoneOptions.length === 0 ? (
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-300">
                  La agencia no tiene teléfonos cargados.
                </p>
              ) : (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {phoneOptions.map((opt) => {
                    const active = selectedPhone === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => {
                          phoneTouchedRef.current = true;
                          setSelectedPhone(opt.value);
                        }}
                        className={cx(
                          "w-full rounded-xl border px-3 py-2 text-left text-xs",
                          active
                            ? "border-sky-400/60 bg-sky-500/10 text-sky-900 dark:text-sky-200"
                            : "border-white/10 bg-white/10 text-slate-600 dark:text-slate-300",
                        )}
                      >
                        <div className="font-medium">{opt.value}</div>
                        <div className="opacity-70">{opt.label}</div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ) : null}

          {designMenuSection === "payment" ? (
            <div className={PANEL_CLASS}>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Forma de pago</h3>
                <button
                  type="button"
                  onClick={() => {
                    paymentTouchedRef.current = true;
                    setSelectedPaymentIndex(null);
                  }}
                  className="text-[11px] opacity-70 hover:opacity-100"
                >
                  Limpiar
                </button>
              </div>
              {paymentOptions.length === 0 ? (
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-300">
                  No hay opciones de pago cargadas.
                </p>
              ) : (
                <div className="mt-3 grid grid-cols-1 gap-2">
                  {paymentOptions.map((opt, idx) => {
                    const active = selectedPaymentIndex === idx;
                    return (
                      <button
                        key={`${opt}-${idx}`}
                        type="button"
                        onClick={() => {
                          paymentTouchedRef.current = true;
                          setSelectedPaymentIndex(idx);
                        }}
                        className={cx(
                          "w-full rounded-xl border px-3 py-2 text-left text-xs",
                          active
                            ? "border-sky-400/60 bg-sky-500/10 text-sky-900 dark:text-sky-200"
                            : "border-white/10 bg-white/10 text-slate-600 dark:text-slate-300",
                        )}
                      >
                        {opt.length > 140 ? `${opt.slice(0, 137)}…` : opt}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ) : null}

          {designMenuSection === "services" ? (
            <div className={PANEL_CLASS}>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">Servicios incluidos</h3>
                <div className="flex items-center gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedServiceIds(
                        new Set(services.map((s) => s.id_service)),
                      )
                    }
                    className="rounded-full border border-sky-500/30 bg-sky-500/5 px-3 py-1 text-sky-900 dark:text-sky-200"
                  >
                    Todo
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedServiceIds(new Set())}
                    className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-slate-600 dark:text-slate-300"
                  >
                    Limpiar
                  </button>
                </div>
              </div>
              {services.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-300">
                  No hay servicios cargados.
                </p>
              ) : (
                <div className="space-y-2">
                  {services.map((service) => {
                    const active = selectedServiceIds.has(service.id_service);
                    const label =
                      service.description ||
                      service.type ||
                      `Servicio ${service.id_service}`;
                    return (
                      <label
                        key={service.id_service}
                        className={cx(
                          "flex cursor-pointer items-start gap-3 rounded-xl border p-2 text-xs",
                          active
                            ? "border border-sky-500/30 bg-sky-500/5 text-sky-900 dark:text-sky-200"
                            : "border-white/10 bg-white/10 text-slate-600 dark:text-slate-300",
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={active}
                          onChange={() => {
                            setSelectedServiceIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(service.id_service)) {
                                next.delete(service.id_service);
                              } else {
                                next.add(service.id_service);
                              }
                              return next;
                            });
                          }}
                          className="mt-1 size-4"
                        />
                        <div className="min-w-0">
                          <div className="truncate font-medium">{label}</div>
                          {service.operator?.name && (
                            <div className="mt-1 opacity-70">
                              Operador: {service.operator.name}
                            </div>
                          )}
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          ) : null}

          {designMenuSection === "signature" ? (
            <div className={PANEL_CLASS}>
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">Firmas</h3>
                <label className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={includeSignature}
                    onChange={(e) => setIncludeSignature(e.target.checked)}
                    className="size-4"
                  />
                  Incluir
                </label>
              </div>
              {includeSignature ? (
                <div className="mt-3 grid gap-2">
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={includePaxSignature}
                      onChange={(e) => setIncludePaxSignature(e.target.checked)}
                      className="size-4"
                    />
                    Firma Pax
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={includeAgencySignature}
                      onChange={(e) => setIncludeAgencySignature(e.target.checked)}
                      className="size-4"
                    />
                    Firma Agencia
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={includeClarification}
                      onChange={(e) => setIncludeClarification(e.target.checked)}
                      className="size-4"
                    />
                    Aclaración
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={includeDni}
                      onChange={(e) => setIncludeDni(e.target.checked)}
                      className="size-4"
                    />
                    DNI
                  </label>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      );
    }

    if (studioPanel === "manage") {
      return (
        <div className="space-y-3">
          <div className={PANEL_CLASS}>
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              Presets de contenido
            </h3>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
              Guardá bloques personalizados para reutilizar en futuras confirmaciones.
            </p>
            <button
              type="button"
              onClick={saveCurrentAsPreset}
              className="mt-3 inline-flex items-center rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-900 shadow-sm shadow-emerald-900/10 transition hover:scale-[0.98] dark:text-emerald-200"
            >
              Guardar preset actual
            </button>
            <div className="mt-3">
              <TextPresetPicker
                token={token ?? null}
                docType="voucher"
                onApply={(content) => {
                  if (!content?.trim()) return;
                  setEditableBlocks((prev) => [
                    ...prev,
                    {
                      id: nanoid(),
                      origin: "extra",
                      type: "paragraph",
                      value: { type: "paragraph", text: content },
                    },
                  ]);
                }}
                onApplyData={(maybeBlocks) => {
                  const nextBlocks = presetBlocksToOrdered(maybeBlocks);
                  if (nextBlocks.length === 0) return;
                  setEditableBlocks((prev) => [...prev, ...nextBlocks]);
                }}
              />
            </div>
          </div>
          <div className={PANEL_CLASS}>
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              Resumen de la confirmación
            </h3>
            <div className="mt-2 space-y-1 text-xs text-slate-600 dark:text-slate-300">
              <p>
                <b>Reserva:</b> Nº {bookingId || "—"}
              </p>
              <p>
                <b>Titular:</b>{" "}
                {`${booking?.titular?.first_name || ""} ${booking?.titular?.last_name || ""}`.trim() ||
                  "—"}
              </p>
              <p>
                <b>Servicios:</b> {selectedServices.length}/{services.length}
              </p>
              <p>
                <b>Bloques:</b> {editableBlocks.length}
              </p>
              <p>
                <b>Pago seleccionado:</b> {paymentSelected || "Sin seleccionar"}
              </p>
            </div>
          </div>
        </div>
      );
    }

    return null;
  })();

  return (
    <ProtectedRoute>
      <section className="p-3 text-slate-950 dark:text-white md:p-4">
        {loading ? (
          <div className="flex min-h-[60vh] items-center justify-center">
            <Spinner />
          </div>
        ) : error ? (
          <div className="rounded-3xl border border-rose-500/20 bg-rose-500/10 p-6 text-rose-700 dark:text-rose-200">
            {error}
          </div>
        ) : !booking ? (
          <div className="rounded-3xl border border-slate-200/70 bg-white p-6 text-slate-700 shadow-sm shadow-sky-900/5 dark:border-white/10 dark:bg-white/5 dark:text-slate-200">
            No se encontró la reserva.
          </div>
        ) : (
          <StudioShell
            eyebrow="Estudio de confirmación"
            title={`Reserva Nº ${bookingId || "—"}`}
            badges={[
              {
                label: `Servicios ${selectedServices.length}/${services.length}`,
                tone: "sky",
              },
              {
                label: `Bloques ${editableBlocks.length}`,
                tone: "slate",
              },
            ]}
            backHref={`/bookings/services/${id}`}
            backLabel="Volver a la reserva"
            tabs={tabs}
            tabsVariant="icon"
            tabColumnsDesktop={3}
            tabColumnsMobile={3}
            activeTab={studioPanel}
            onChangeTab={(key) => setStudioPanel(key as StudioPanel)}
            panelTitle={panelTitle}
            panelBody={panelBody}
            showMobilePanel
            mainContent={
              <div className="space-y-4">
                <div className={PANEL_CLASS}>
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="text-sm uppercase tracking-wide text-slate-500 dark:text-slate-300">
                        Confirmación automática
                      </p>
                      <p className="text-lg font-semibold">
                        {booking.details || "Reserva"} - Nº {bookingId}
                      </p>
                      <p className="mt-1 text-sm text-slate-500 dark:text-slate-300">
                        Salida: {formatDate(booking.departure_date)} · Regreso:{" "}
                        {formatDate(booking.return_date)}
                      </p>
                    </div>
                    <TemplatePdfDownload
                      cfg={rCfg}
                      agency={agencyForPdf}
                      user={userForPdf}
                      blocks={editableBlocks}
                      docLabel="Confirmación"
                      selectedCoverUrl={selectedCoverUrl}
                      paymentSelected={paymentSelected}
                      fileName={`confirmacion-${bookingId || "reserva"}.pdf`}
                      className="inline-flex items-center justify-center rounded-full border border-emerald-100 bg-emerald-50/90 px-5 py-2 text-sm font-medium text-emerald-900 shadow-sm shadow-emerald-900/10 transition hover:scale-[0.98] dark:border-emerald-100/70 dark:bg-emerald-500/20 dark:text-emerald-100"
                    >
                      Descargar PDF
                    </TemplatePdfDownload>
                  </div>
                </div>

                <div className={PANEL_CLASS}>
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="text-base font-semibold">Preview editable</h2>
                      <p className="text-sm text-slate-500 dark:text-slate-300">
                        Editá, reordená y agregá bloques antes de descargar.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {quickAddItems.map((item) => (
                        <button
                          key={item.type}
                          type="button"
                          onClick={() =>
                            setEditableBlocks((prev) => [
                              ...prev,
                              makeNewBlock(item.type),
                            ])
                          }
                          className="rounded-full border border-white/30 bg-white/40 px-3 py-1 text-xs font-medium text-sky-950 shadow-sm shadow-sky-950/10 transition hover:scale-[0.98] dark:border-white/10 dark:bg-white/10 dark:text-white"
                        >
                          + {item.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div
                    className={cx(
                      "rounded-3xl border border-white/10 bg-white/40 shadow-inner shadow-sky-950/5 dark:border-white/10 dark:bg-white/5",
                      uiTokens.padY,
                    )}
                    style={{ backgroundColor: bg, color: text }}
                  >
                    <div className={cx(uiTokens.padX, "pb-6")}>
                      <div className={cx("mx-auto", uiTokens.contentMaxW, "w-full")}>
                        <div className="mb-4 flex items-start justify-between gap-4">
                          <div>
                            <h3
                              className="text-2xl font-semibold"
                              style={{ color: text, fontFamily: headingFont }}
                            >
                              {agencyForPdf.name || "Agencia"}
                            </h3>
                            <div
                              className="mt-1 h-[2px] w-24"
                              style={{ backgroundColor: accent }}
                            />
                          </div>
                          <span
                            className="rounded-full border px-3 py-1 text-xs font-semibold uppercase"
                            style={{
                              borderColor: dividerColor,
                              color: accent,
                            }}
                          >
                            Confirmación
                          </span>
                        </div>

                        {contactLine.length > 0 && (
                          <div
                            className={cx(
                              "mb-4 flex flex-wrap gap-2 border p-2 text-xs",
                              uiTokens.innerRadiusClass,
                            )}
                            style={{
                              borderColor: dividerColor,
                              backgroundColor: panelBgStrong,
                            }}
                          >
                            {contactLine.map((item) => (
                              <span
                                key={`${item.label}-${item.value}`}
                                className={cx(
                                  "rounded-full px-2 py-1",
                                  uiTokens.innerRadiusClass,
                                )}
                                style={{
                                  backgroundColor: dividerColor,
                                  color: text,
                                }}
                              >
                                <strong style={{ color: accent }}>
                                  {item.label}:
                                </strong>{" "}
                                {item.value}
                              </span>
                            ))}
                          </div>
                        )}

                        {selectedCoverUrl ? (
                          <img
                            src={selectedCoverUrl}
                            alt="Portada confirmación"
                            className={cx(
                              "w-full object-cover",
                              uiTokens.innerRadiusClass,
                            )}
                            style={{
                              height:
                                uiTokens.density === "compact"
                                  ? 144
                                  : uiTokens.density === "relaxed"
                                  ? 220
                                  : 184,
                            }}
                          />
                        ) : null}

                        <div className={cx("mt-4", uiTokens.gapBlocks)}>
                          {editableBlocks.length === 0 ? (
                            <p className="text-sm opacity-70">
                              No hay contenido para mostrar.
                            </p>
                          ) : (
                            <BlocksCanvas
                              blocks={editableBlocks}
                              onChange={setEditableBlocks}
                              lockedIds={lockedIds}
                              showMeta
                              canToggleMode={canToggleInheritedLock}
                              onToggleMode={toggleInheritedLock}
                              options={{
                                dividerColor: uiTokens.dividers
                                  ? dividerColor
                                  : "transparent",
                                panelBgStrong,
                                innerRadiusClass: uiTokens.innerRadiusClass,
                                gapGridClass: uiTokens.gapGrid,
                                listSpaceClass: uiTokens.listSpace,
                                accentColor: accent,
                                headingFont,
                                headingWeight,
                                controlsOnDarkSurface: !isLightBg,
                              }}
                            />
                          )}
                        </div>

                        <PaymentPreview />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            }
          />
        )}
      </section>
    </ProtectedRoute>
  );
}
