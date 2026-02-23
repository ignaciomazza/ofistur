// src/components/templates/TemplatePdfDocument.tsx
/* eslint-disable react/no-unstable-nested-components */
/* eslint-disable jsx-a11y/alt-text */

import React from "react";
import {
  Document,
  Page,
  View,
  Text,
  Image,
  StyleSheet,
} from "@react-pdf/renderer";
import type {
  TemplateConfig,
  ContentBlock,
  Density,
  Agency,
} from "@/types/templates";
import {
  resolveBlockTextStyle,
  blockTextSizeToPdfPt,
  blockTextWeightToCss,
} from "@/lib/blockTextStyle";
import PdfSafeText from "./pdf/PdfSafeText";
import ParagraphSafe from "./pdf/ParagraphSafe";

/* ======================================================================
 * Tipos auxiliares
 * ==================================================================== */

type MinimalUser = {
  first_name?: string;
  last_name?: string;
  email?: string;
};

/** Campos “legacy” que algunas agencias aún traen sueltos. */
type AgencyLegacy = {
  phone?: string;
  email?: string;
  social?: Partial<{
    instagram: string;
    facebook: string;
    twitter: string;
    tiktok: string;
  }>;
};

/* ======================================================================
 * Utils
 * ==================================================================== */

const isBlank = (s?: string | null) => !s || s.trim().length === 0;

/** ========================= Color helpers ========================= */
function luminance(hex: string): number {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(
    (hex || "").trim(),
  );
  if (!m) return 0.5;
  const r = parseInt(m[1], 16) / 255;
  const g = parseInt(m[2], 16) / 255;
  const b = parseInt(m[3], 16) / 255;
  const a = [r, g, b].map((v) =>
    v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4),
  );
  return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
}
const hexToRgb = (hex: string) => {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(
    (hex || "").trim(),
  );
  if (!m) return { r: 255, g: 255, b: 255 };
  return {
    r: parseInt(m[1], 16),
    g: parseInt(m[2], 16),
    b: parseInt(m[3], 16),
  };
};
const parseRgba = (rgba: string) => {
  const m = rgba.match(/rgba?\(([^)]+)\)/i);
  if (!m) return { r: 0, g: 0, b: 0, a: 1 };
  const [r, g, b, a] = m[1].split(",").map((v) => v.trim());
  return {
    r: Math.round(Number(r)),
    g: Math.round(Number(g)),
    b: Math.round(Number(b)),
    a: a !== undefined ? Number(a) : 1,
  };
};
/** Mezcla un rgba con fondo HEX a HEX opaco (para borders en react-pdf). */
const blendToHex = (srcRgba: string, bgHex: string) => {
  const bg = hexToRgb(bgHex);
  const s = parseRgba(srcRgba);

  const mix = (src: number, bgc: number, a: number) =>
    Math.round(src * a + bgc * (1 - a));

  const r = mix(s.r, bg.r, s.a);
  const g = mix(s.g, bg.g, s.a);
  const b = mix(s.b, bg.b, s.a);

  const toHex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

const withAlpha = (hex: string, alpha: number) => {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

/* ======================================================================
 * Styles base
 * ==================================================================== */

const base = StyleSheet.create({
  page: {
    fontSize: 12,
    paddingTop: 28,
    paddingBottom: 22,
    paddingHorizontal: 28,
  },
  section: { marginTop: 10 },
  divider: { height: 1, width: "100%", marginVertical: 8 },
  row: { flexDirection: "row", justifyContent: "space-between" },
  col: { flex: 1 },
  listItem: { fontSize: 12, marginBottom: 4 },
});

/* ======================================================================
 * Props
 * ==================================================================== */

export type TemplatePdfDocumentProps = {
  rCfg: TemplateConfig;
  rAgency?: Partial<Agency>;
  rUser?: Partial<MinimalUser>;
  blocks?: ContentBlock[];
  docLabel?: string;
  selectedCoverUrl?: string;
  paymentSelected?: string;
};

/* ======================================================================
 * Component
 * ==================================================================== */

const TemplatePdfDocument: React.FC<TemplatePdfDocumentProps> = ({
  rCfg,
  rAgency = {},
  rUser = {},
  blocks = [],
  docLabel = "Documento",
  selectedCoverUrl = "",
  paymentSelected,
}) => {
  // Tokens de estilo
  const bg = rCfg?.styles?.colors?.background ?? "#111111";
  const text = rCfg?.styles?.colors?.text ?? "#ffffff";
  const accent = rCfg?.styles?.colors?.accent ?? "#9CA3AF";

  // Override para el bloque de pago (opcional)
  const paymentAccent = rCfg?.payment?.mupuStyle?.color || accent;

  const isLightBg = luminance(bg) >= 0.7;

  // Paneles / divisores
  const panelSoftRGBA = isLightBg
    ? withAlpha(accent, 0.05)
    : "rgba(255,255,255,0.06)";
  const panelStrongRGBA = isLightBg
    ? "rgba(0,0,0,0.06)"
    : "rgba(255,255,255,0.06)";
  const dividerRGBA = isLightBg ? "rgba(0,0,0,0.15)" : "rgba(255,255,255,0.12)";
  const borderSoftRGBA = isLightBg
    ? withAlpha(accent, 0.3)
    : "rgba(255,255,255,0.10)";

  // Bordes siempre en HEX sólido
  const borderSoftHEX = blendToHex(borderSoftRGBA, bg);

  // Density
  const densityRaw = rCfg?.styles?.ui?.density ?? "comfortable";
  const density: Density =
    densityRaw === "compact" || densityRaw === "relaxed"
      ? densityRaw
      : "comfortable";
  const coverH =
    density === "compact" ? 170 : density === "relaxed" ? 250 : 200;

  // Radius token
  const radiusToken = (rCfg?.styles?.ui?.radius || "md") as
    | "none"
    | "sm"
    | "md"
    | "lg"
    | "xl";
  const RADIUS =
    radiusToken === "none"
      ? 0
      : radiusToken === "sm"
        ? 6
        : radiusToken === "md"
          ? 8
          : radiusToken === "lg"
            ? 10
            : 14; // xl

  // Content width token
  const cw = (rCfg?.styles?.ui?.contentWidth || "wide") as
    | "narrow"
    | "normal"
    | "wide";
  const CONTENT_MAX = cw === "narrow" ? 460 : cw === "normal" ? 520 : 640;

  const layout = rCfg?.layout ?? "layoutA";

  // Línea corporativa
  const contactItems = Array.isArray(rCfg?.contactItems)
    ? rCfg!.contactItems!
    : [];
  const phones = Array.isArray(rAgency?.phones) ? rAgency!.phones! : [];
  const emails = Array.isArray(rAgency?.emails) ? rAgency!.emails! : [];

  // Soporte para campos legacy sin usar `any`
  const agLegacy: Partial<AgencyLegacy> = (rAgency ??
    {}) as Partial<AgencyLegacy>;

  const corporateLine: Array<{ label: string; value: string }> = [];
  const website = rAgency?.website || "";
  const address = rAgency?.address || "";
  const phone = phones[0] || agLegacy.phone || "";
  const email = emails[0] || agLegacy.email || "";
  const ig = rAgency?.socials?.instagram || agLegacy.social?.instagram || "";
  const fb = rAgency?.socials?.facebook || agLegacy.social?.facebook || "";
  const tw = rAgency?.socials?.twitter || agLegacy.social?.twitter || "";
  const tk = rAgency?.socials?.tiktok || agLegacy.social?.tiktok || "";

  if (contactItems.includes("website") && website)
    corporateLine.push({ label: "Web", value: website });
  if (contactItems.includes("address") && address)
    corporateLine.push({ label: "Dirección", value: address });
  if (contactItems.includes("phones") && phone)
    corporateLine.push({ label: "Tel", value: phone });
  if (contactItems.includes("email") && email)
    corporateLine.push({ label: "Mail", value: email });
  if (contactItems.includes("instagram") && ig)
    corporateLine.push({ label: "Instagram", value: ig });
  if (contactItems.includes("facebook") && fb)
    corporateLine.push({ label: "Facebook", value: fb });
  if (contactItems.includes("twitter") && tw)
    corporateLine.push({ label: "Twitter", value: tw });
  if (contactItems.includes("tiktok") && tk)
    corporateLine.push({ label: "TikTok", value: tk });

  const agencyName = rAgency?.name || "Nombre de la agencia";
  const legalName = rAgency?.legal_name || rAgency?.name || "Razón social";
  const logo = rAgency?.logo_url || "";
  const hasLogo = !!logo;

  const showDividers = rCfg?.styles?.ui?.dividers ?? true;

  // Medidas Layout C
  const SIDEBAR_W = 200;
  const MAIN_PAD = 14;

  const styles = StyleSheet.create({
    pageBase: {
      ...base.page,
      backgroundColor: bg,
      color: text,
    },
    pageNoPad: {
      fontSize: 12,
      padding: 0,
      backgroundColor: bg,
      color: text,
    },
    contentWrap: {
      width: "100%",
      maxWidth: CONTENT_MAX,
      alignSelf: "center",
    },
    title: {
      fontSize: 22,
      fontWeight: 700,
    },
    subtitle: {
      fontSize: 14,
      opacity: 0.95,
      marginTop: 2,
    },
    chip: {
      fontSize: 10,
      paddingVertical: 4,
      paddingHorizontal: 8,
      textTransform: "uppercase",
      alignSelf: "flex-start",
      borderRadius: RADIUS,
      backgroundColor: isLightBg
        ? withAlpha("#000000", 0.06)
        : "rgba(255,255,255,0.06)",
      color: accent,
      borderStyle: "solid",
      borderColor: borderSoftHEX,
      borderWidth: 1,
    },
    brandLine: {
      height: 2,
      width: "60%",
      marginTop: 4,
      backgroundColor: accent,
    },
    corpLine: {
      marginTop: 8,
      padding: 8,
      borderRadius: RADIUS,
      flexDirection: "row",
      flexWrap: "wrap",
      backgroundColor: panelSoftRGBA,
      borderStyle: "solid",
      borderColor: borderSoftHEX,
      borderWidth: 1,
    },
    corpItem: {
      fontSize: 10,
      paddingVertical: 2,
      paddingHorizontal: 6,
      borderRadius: RADIUS,
      marginRight: 6,
      marginBottom: 6,
      backgroundColor: isLightBg
        ? "rgba(0,0,0,0.05)"
        : "rgba(255,255,255,0.08)",
    },
    cover: {
      width: "100%",
      height: coverH,
      objectFit: "cover",
      borderRadius: RADIUS,
    },
    section: { ...base.section },
    divider: { ...base.divider, backgroundColor: dividerRGBA },
    card: {
      borderRadius: RADIUS,
      padding: 8,
      backgroundColor: panelStrongRGBA,
    },
    paymentCard: {
      borderRadius: RADIUS,
      padding: 8,
      backgroundColor: panelSoftRGBA,
      borderStyle: "solid",
      borderColor: borderSoftHEX,
      borderWidth: 1,
    },
    accentText: { color: paymentAccent, fontWeight: 600, marginBottom: 4 },
    footer: {
      marginTop: 16,
      paddingTop: 8,
      borderTopStyle: "solid",
      borderTopColor: blendToHex(dividerRGBA, bg),
      borderTopWidth: 1,
    },

    /* ====== Layout C ====== */
    sidebarFixed: {
      position: "absolute",
      left: 0,
      top: 0,
      bottom: 0,
      width: SIDEBAR_W,
      padding: 16,
      backgroundColor: panelSoftRGBA,
    },
    mainFlow: {
      marginLeft: SIDEBAR_W,
      padding: MAIN_PAD,
    },
  });

  /* ======================================================================
   * Blocks
   * ==================================================================== */

  const Block: React.FC<{ b: ContentBlock; index: number }> = ({
    b,
    index,
  }) => {
    const topDivider = showDividers && index > 0;
    const headingLevel =
      b.type === "heading" ? Math.max(1, Math.min(3, b.level ?? 1)) : undefined;
    const textStyle = resolveBlockTextStyle({
      type: b.type,
      headingLevel,
      textStyle: b.textStyle,
    });
    const textFontSize = blockTextSizeToPdfPt(textStyle.size);
    const textFontWeight = blockTextWeightToCss(textStyle.weight);

    if (b.type === "heading") {
      const textValue = b.text ?? "";
      if (b.mode === "form" && isBlank(textValue)) return null;

      return (
        <View style={[styles.section, styles.contentWrap]}>
          {topDivider && <View style={styles.divider} />}
          <PdfSafeText
            style={{ fontSize: textFontSize, fontWeight: textFontWeight }}
            text={textValue}
          />
        </View>
      );
    }

    if (b.type === "subtitle") {
      const t = b.text ?? "";
      if (b.mode === "form" && isBlank(t)) return null;
      return (
        <View style={[styles.section, styles.contentWrap]} wrap={false}>
          {topDivider && <View style={styles.divider} />}
          <PdfSafeText
            style={{
              fontSize: textFontSize,
              fontWeight: textFontWeight,
              opacity: 0.95,
            }}
            text={t}
          />
        </View>
      );
    }

    if (b.type === "paragraph") {
      const t = b.text ?? "";
      if (b.mode === "form" && isBlank(t)) return null;
      return (
        <View style={[styles.section, styles.contentWrap]}>
          {topDivider && <View style={styles.divider} />}
          <ParagraphSafe
            style={{
              lineHeight: 1.4,
              fontSize: textFontSize,
              fontWeight: textFontWeight,
            }}
            text={t}
          />
        </View>
      );
    }

    if (b.type === "list") {
      const items = Array.isArray(b.items) ? b.items : [];
      if (b.mode === "form" && items.length === 0) return null;
      const listItemStyle = {
        fontSize: textFontSize,
        fontWeight: textFontWeight,
        marginBottom: 4,
      };
      return (
        <View style={[styles.section, styles.contentWrap]}>
          {topDivider && <View style={styles.divider} />}
          <View>
            {items.map((it, i) => (
              <View
                key={i}
                style={{
                  flexDirection: "row",
                  alignItems: "flex-start",
                  marginBottom: 4,
                }}
              >
                <Text style={[listItemStyle, { marginRight: 6 }]}>•</Text>
                <ParagraphSafe style={listItemStyle} text={it} />
              </View>
            ))}
          </View>
        </View>
      );
    }

    if (b.type === "keyValue") {
      const pairs = Array.isArray(b.pairs) ? b.pairs : [];
      if (b.mode === "form" && pairs.length === 0) return null;
      return (
        <View style={[styles.section, styles.contentWrap]} wrap={false}>
          {topDivider && <View style={styles.divider} />}
          <View>
            {pairs.map((p, i) => (
              <View
                key={i}
                style={[
                  styles.card,
                  {
                    marginBottom: 4,
                    flexDirection: "row",
                    justifyContent: "space-between",
                  },
                ]}
              >
                <PdfSafeText
                  style={{ fontSize: textFontSize, fontWeight: textFontWeight }}
                  text={p.key}
                />
                <PdfSafeText
                  style={{ fontSize: textFontSize, fontWeight: textFontWeight }}
                  text={p.value}
                />
              </View>
            ))}
          </View>
        </View>
      );
    }

    if (b.type === "twoColumns") {
      const l = b.left ?? "";
      const r = b.right ?? "";
      const bothEmpty = isBlank(l) && isBlank(r);
      if (b.mode === "form" && bothEmpty) return null;

      return (
        <View style={[styles.section, styles.contentWrap]} wrap={false}>
          {topDivider && <View style={styles.divider} />}
          <View style={{ flexDirection: "row" }}>
            <View style={{ flex: 1, marginRight: 6 }}>
              <View style={styles.card}>
                <ParagraphSafe
                  style={{ fontSize: textFontSize, fontWeight: textFontWeight }}
                  text={l}
                />
              </View>
            </View>
            <View style={{ flex: 1, marginLeft: 6 }}>
              <View style={styles.card}>
                <ParagraphSafe
                  style={{ fontSize: textFontSize, fontWeight: textFontWeight }}
                  text={r}
                />
              </View>
            </View>
          </View>
        </View>
      );
    }

    if (b.type === "threeColumns") {
      const l = b.left ?? "";
      const c = b.center ?? "";
      const r = b.right ?? "";
      const empty = isBlank(l) && isBlank(c) && isBlank(r);
      if (b.mode === "form" && empty) return null;

      return (
        <View style={[styles.section, styles.contentWrap]} wrap={false}>
          {topDivider && <View style={styles.divider} />}
          <View style={{ flexDirection: "row" }}>
            <View style={{ flex: 1, marginRight: 6 }}>
              <View style={styles.card}>
                <ParagraphSafe
                  style={{ fontSize: textFontSize, fontWeight: textFontWeight }}
                  text={l}
                />
              </View>
            </View>
            <View style={{ flex: 1, marginHorizontal: 6 }}>
              <View style={styles.card}>
                <ParagraphSafe
                  style={{ fontSize: textFontSize, fontWeight: textFontWeight }}
                  text={c}
                />
              </View>
            </View>
            <View style={{ flex: 1, marginLeft: 6 }}>
              <View style={styles.card}>
                <ParagraphSafe
                  style={{ fontSize: textFontSize, fontWeight: textFontWeight }}
                  text={r}
                />
              </View>
            </View>
          </View>
        </View>
      );
    }

    return null;
  };

  const Payment: React.FC = () =>
    !paymentSelected ? null : (
      <View
        style={[base.section, styles.contentWrap, styles.paymentCard]}
        wrap={false}
      >
        <Text style={styles.accentText}>Forma de pago</Text>
        <ParagraphSafe text={paymentSelected} />
      </View>
    );

  const Header: React.FC = () => (
    <View style={[styles.contentWrap, { marginBottom: 12 }]}>
      <View style={{ ...base.row }}>
        <View>
          <PdfSafeText style={styles.title} text={agencyName} />
          <View style={styles.brandLine} />
        </View>
        <View>
          <PdfSafeText style={styles.chip} text={docLabel} />
        </View>
      </View>

      {corporateLine.length > 0 && (
        <View style={styles.corpLine}>
          {corporateLine.map((it, i) => (
            <Text key={i} style={styles.corpItem}>
              <Text style={{ color: accent, fontWeight: 600 }}>
                {it.label}:{" "}
              </Text>
              <PdfSafeText text={it.value} />
            </Text>
          ))}
        </View>
      )}
    </View>
  );

  const sellerName =
    [rUser?.first_name, rUser?.last_name].filter(Boolean).join(" ") ||
    "Vendedor/a";

  const Footer: React.FC = () => (
    <View style={[styles.footer, styles.contentWrap]} wrap={false}>
      <View style={base.row}>
        <View
          style={{
            borderRadius: RADIUS,
            padding: 8,
            backgroundColor: panelSoftRGBA,
            borderStyle: "solid",
            borderColor: borderSoftHEX,
            borderWidth: 1,
          }}
        >
          <Text style={{ color: accent, fontWeight: 600 }}>{sellerName}</Text>
          <PdfSafeText text={rUser?.email || "vendedor@agencia.com"} />
        </View>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          {hasLogo ? (
            <Image
              src={logo}
              style={{ height: 24, width: 72, objectFit: "contain" }}
            />
          ) : (
            <View
              style={{
                height: 24,
                width: 72,
                backgroundColor: isLightBg
                  ? "rgba(0,0,0,0.08)"
                  : "rgba(255,255,255,0.10)",
                borderRadius: RADIUS,
              }}
            />
          )}
          <Text style={{ fontSize: 9, opacity: 0.8, marginLeft: 8 }}>
            {legalName}
          </Text>
        </View>
      </View>
    </View>
  );

  const SidebarC: React.FC = () => (
    <View fixed style={styles.sidebarFixed}>
      {hasLogo ? (
        <Image
          src={logo}
          style={{
            height: 28,
            width: 100,
            objectFit: "contain",
            opacity: 0.9,
            marginBottom: 8,
          }}
        />
      ) : (
        <View
          style={{
            height: 28,
            width: 100,
            borderRadius: RADIUS,
            backgroundColor: isLightBg
              ? "rgba(0,0,0,0.08)"
              : "rgba(255,255,255,0.10)",
            marginBottom: 8,
          }}
        />
      )}

      <PdfSafeText
        style={{
          fontSize: 16,
          fontWeight: 700,
        }}
        text={agencyName}
      />
      <View
        style={{
          height: 2,
          width: "70%",
          backgroundColor: accent,
          marginTop: 4,
          borderRadius: 2,
        }}
      />

      <View style={{ marginTop: 8 }}>
        {corporateLine.length > 0 ? (
          corporateLine.map((it, i) => (
            <Text
              key={i}
              style={{ fontSize: 10, opacity: 0.85, marginBottom: 3 }}
            >
              <Text style={{ color: accent, fontWeight: 600 }}>
                {it.label}:{" "}
              </Text>
              <PdfSafeText text={it.value} />
            </Text>
          ))
        ) : (
          <Text style={{ fontSize: 10, opacity: 0.6 }}>
            Sin datos de contacto
          </Text>
        )}
      </View>

      <View
        style={{
          marginTop: 10,
          alignSelf: "flex-start",
          borderRadius: RADIUS,
          borderStyle: "solid",
          borderColor: borderSoftHEX,
          borderWidth: 1,
          paddingVertical: 4,
          paddingHorizontal: 8,
        }}
      >
        <PdfSafeText
          style={{
            fontSize: 10,
            textTransform: "uppercase",
            color: accent,
          }}
          text={docLabel}
        />
      </View>
    </View>
  );

  const Cover: React.FC = () =>
    selectedCoverUrl ? (
      <View style={styles.contentWrap} wrap={false}>
        <Image src={selectedCoverUrl} style={styles.cover} />
      </View>
    ) : hasLogo ? (
      <View
        style={[styles.contentWrap, { alignItems: "center", marginBottom: 4 }]}
        wrap={false}
      >
        <Image
          src={logo}
          style={{ height: 28, width: 100, objectFit: "contain", opacity: 0.9 }}
        />
      </View>
    ) : null;

  /* ======================================================================
   * Render
   * ==================================================================== */

  return (
    <Document>
      {(layout === "layoutA" || layout === "layoutB") && (
        <Page size="A4" style={styles.pageBase}>
          {layout === "layoutA" && (
            <>
              <Cover />
              <Header />
              {blocks.map((b, i) => (
                <Block key={b.id || i} b={b} index={i} />
              ))}
              <Payment />
              <Footer />
            </>
          )}

          {layout === "layoutB" && (
            <>
              <Header />
              <View style={[styles.contentWrap, { marginTop: 8 }]}>
                {selectedCoverUrl ? <Cover /> : null}
              </View>
              {blocks.map((b, i) => (
                <Block key={b.id || i} b={b} index={i} />
              ))}
              <Payment />
              <Footer />
            </>
          )}
        </Page>
      )}

      {layout === "layoutC" && (
        <Page size="A4" style={styles.pageNoPad}>
          <SidebarC />
          <View style={styles.mainFlow}>
            {selectedCoverUrl ? (
              <View style={{ marginBottom: 8 }}>
                <Cover />
              </View>
            ) : null}

            {blocks.map((b, i) => (
              <Block key={b.id || i} b={b} index={i} />
            ))}
            <Payment />
            <Footer />
          </View>
        </Page>
      )}
    </Document>
  );
};

export default TemplatePdfDocument;
