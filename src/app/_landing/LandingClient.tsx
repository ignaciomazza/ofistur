// src/app/_landing/LandingClient.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChartVentasUp,
  ChartAdminDown,
  ChartControlEquipo,
} from "./LandingCharts";
import Spinner from "@/components/Spinner";
import { authFetch } from "@/utils/authFetch";
import { trackCompleteRegistration, trackContact } from "@/lib/meta/pixel";

/* ===========================
 * Config
 * =========================== */
const WA_NUMBER = process.env.NEXT_PUBLIC_WA_NUMBER ?? "54911XXXXXXXX";
const WA_MSG = encodeURIComponent("Hola, quiero más info sobre Ofistur.");
const WA_URL = `https://wa.me/${WA_NUMBER}?text=${WA_MSG}`;
const handleWhatsAppClick = () => {
  trackContact({ content_name: "landing_whatsapp" });
};

/* ===========================
 * Motion presets
 * =========================== */
const viewPreset = {
  initial: { opacity: 0, y: 8, scale: 0.995 },
  whileInView: { opacity: 1, y: 0, scale: 1 },
  viewport: { once: true, margin: "-15%" },
  transition: { duration: 0.3, ease: "easeOut" },
} as const;

const hoverPreset = {
  whileHover: { y: -4, scale: 1.01 },
  whileTap: { scale: 0.995 },
  transition: { type: "spring", stiffness: 320, damping: 22 },
} as const;

/* ===========================
 * Pricing logic
 * =========================== */
type PlanKey = "basico" | "medio" | "pro";

type BspRateResponse = {
  ok?: boolean;
  arsPerUsd?: number;
  date?: string | null;
  source?: string;
  error?: string;
};

const PLAN_BASE_PRICES: Record<PlanKey, number> = {
  basico: 20,
  medio: 40,
  pro: 50,
};

const PLAN_FEATURES: Record<
  PlanKey,
  { label: string; bullets: string[]; highlight?: boolean }
> = {
  basico: {
    label: "Básico",
    bullets: [
      "Pasajeros, reservas y servicios",
      "Operadores y pagos a operadores",
      "Facturación AFIP y notas de crédito",
      "Recibos y planes de pago",
      "Vencimientos y control de estados",
      "Usuarios, roles y equipos",
      "Configuración financiera y de servicios",
    ],
  },
  medio: {
    label: "Medio",
    highlight: true,
    bullets: [
      "Calendario y recursos internos",
      "Templates PDF y documentos listos",
      "Gastos / inversiones y caja mensual",
      "Saldos por reserva e impuestos",
      "Ganancias, comisiones y análisis",
      "Estadísticas avanzadas de pasajeros",
      "Verificación de recibos y cuentas de crédito",
    ],
  },
  pro: {
    label: "Pro",
    bullets: [
      "Asesoramiento personalizado",
      "Capacitaciones",
      "Nuevas funcionalidades a medida",
    ],
  },
};

const MODULE_GROUPS: {
  title: string;
  variant?: "sky" | "amber" | "emerald";
  items: string[];
}[] = [
  {
    title: "Operativa diaria",
    variant: "sky",
    items: [
      "Pasajeros",
      "Reservas",
      "Servicios",
      "Operadores",
      "Calendario",
      "Recursos internos",
    ],
  },
  {
    title: "Documentos y finanzas",
    variant: "emerald",
    items: [
      "Facturación AFIP y notas de crédito",
      "Recibos y planes de pago",
      "Pagos a operadores",
      "Gastos / inversiones",
      "Caja mensual",
      "Saldos por reserva",
      "Cuentas de crédito",
      "Templates PDF",
    ],
  },
  {
    title: "Analítica y control",
    variant: "amber",
    items: [
      "Ganancias y comisiones",
      "Análisis comerciales",
      "Estadísticas de pasajeros",
      "Verificación de recibos",
      "Usuarios y roles",
      "Equipos de ventas",
      "Configuración financiera",
    ],
  },
];

// Costo usuarios extra (4–10 = $5 c/u, 11+ = $10 c/u)
function calcExtraUsersCost(users: number): number {
  if (users <= 3) return 0;
  if (users <= 10) {
    return (users - 3) * 5;
  }
  // usuarios >10
  // hasta 10 => 7 * 5 = 35
  // resto => 10 c/u
  return 35 + (users - 10) * 10;
}

// Infraestructura / Nube:
// 1–3 = 0
// 4–7 = 20
// 8–12 = 30
// 13+ = 30 + 10 c/u extra
function calcCloudCost(users: number): number {
  if (users <= 3) return 0;
  if (users <= 7) return 20;
  if (users <= 12) return 30;
  return 30 + (users - 12) * 10;
}

/* ===========================
 * Primitives
 * =========================== */
type BtnSize = "sm" | "md";

function ButtonPrimary({
  href,
  children,
  onClick,
  type = "button",
  className = "",
  size = "sm",
  variant,
  disabled,
}: {
  href?: string;
  children: React.ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  className?: string;
  size?: BtnSize;
  variant?: "emerald";
  disabled?: boolean;
}) {
  const sizing =
    size === "sm" ? "px-4 py-2 text-sm" : "px-5 py-2.5 text-[15px]";
  const base =
    "rounded-full transition-all hover:scale-[0.98] active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none";
  const content = (
    <motion.span
      {...hoverPreset}
      className={[
        base,
        sizing,
        className,
        variant === "emerald"
          ? "border border-emerald-300/50 bg-emerald-50/70 text-emerald-900 shadow-sm shadow-emerald-950/5"
          : "bg-sky-100 text-sky-950 shadow-sm shadow-sky-950/20 focus:ring-1 focus:ring-sky-950/40",
      ].join(" ")}
    >
      {children}
    </motion.span>
  );
  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-disabled={disabled}
        onClick={onClick}
      >
        {content}
      </a>
    );
  }
  return (
    <button type={type} onClick={onClick} disabled={disabled}>
      {content}
    </button>
  );
}

function ButtonGhost({
  href,
  children,
  className = "",
  size = "sm",
}: {
  href?: string;
  children: React.ReactNode;
  className?: string;
  size?: BtnSize;
}) {
  const sizing =
    size === "sm" ? "px-4 py-2 text-sm" : "px-5 py-2.5 text-[15px]";
  const base =
    "rounded-full border border-white/10 bg-white/10 text-sky-950 shadow-sm shadow-sky-950/10 transition-all hover:scale-[0.98] active:scale-95 focus:outline-none focus:ring-1 focus:ring-sky-950/30";
  const content = (
    <motion.span {...hoverPreset} className={`${base} ${sizing} ${className}`}>
      {children}
    </motion.span>
  );
  if (href) return <a href={href}>{content}</a>;
  return <span>{content}</span>;
}

function Card({
  className = "",
  children,
  animated = true,
}: {
  className?: string;
  children: React.ReactNode;
  animated?: boolean;
}) {
  const classes =
    "min-w-0 rounded-3xl border border-white/10 bg-white/10 p-6 sm:p-8 text-sky-950 shadow-md shadow-sky-950/10 backdrop-blur " +
    className;
  if (!animated) return <div className={classes}>{children}</div>;
  return (
    <motion.div className={classes} {...viewPreset} {...hoverPreset}>
      {children}
    </motion.div>
  );
}

/* ===== Chips con variantes ===== */
function Chip({
  children,
  variant = "sky",
}: {
  children: React.ReactNode;
  variant?: "sky" | "amber" | "emerald";
}) {
  const map = {
    sky: "border border-sky-300/80 bg-sky-100/80 text-sky-900",
    amber: "border border-amber-300/80 bg-amber-100/80 text-amber-900",
    emerald: "border border-emerald-300/50 bg-emerald-50/70 text-emerald-900",
  } as const;
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-xs font-medium ${map[variant]}`}
    >
      {children}
    </span>
  );
}

/* ===== Inputs con label flotante =====
   - El label queda arriba por defecto.
   - Si el campo está vacío (placeholder-shown), baja visualmente.
   - Si hay valor o foco, vuelve arriba.
*/
function FloatingInput({
  label,
  name,
  type = "text",
  required,
  placeholder = " ",
  disabled = false,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <div className="relative">
      <input
        name={name}
        type={type}
        required={required}
        disabled={disabled}
        placeholder={placeholder}
        className="peer w-full rounded-2xl border border-sky-950/10 bg-white/10 p-3 text-sky-950 outline-none backdrop-blur placeholder:text-transparent focus:border-sky-950/30 focus:ring-1 focus:ring-sky-950/30 disabled:cursor-not-allowed disabled:opacity-60"
      />
      <label
        className={[
          "pointer-events-none absolute left-3 z-10 rounded-lg px-2 py-1 text-[11px] font-medium text-sky-950/80 transition-all duration-200",
          "top-0 -translate-y-1/2 bg-white/60",
          "peer-placeholder-shown:top-1/2 peer-placeholder-shown:-translate-y-1/2 peer-placeholder-shown:bg-white/0 peer-placeholder-shown:text-sky-950/50",
          "peer-focus:top-0 peer-focus:-translate-y-1/2 peer-focus:bg-white/60 peer-focus:text-sky-950",
        ].join(" ")}
      >
        {label}
      </label>
    </div>
  );
}

function FloatingTextarea({
  label,
  name,
  rows = 4,
  placeholder = " ",
  disabled = false,
}: {
  label: string;
  name: string;
  rows?: number;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <div className="relative">
      <textarea
        name={name}
        rows={rows}
        placeholder={placeholder}
        disabled={disabled}
        className="peer w-full rounded-2xl border border-sky-950/10 bg-white/10 p-3 text-sky-950 outline-none backdrop-blur placeholder:text-transparent focus:border-sky-950/30 focus:ring-1 focus:ring-sky-950/30 disabled:cursor-not-allowed disabled:opacity-60"
      />
      <label
        className={[
          "pointer-events-none absolute left-3 z-10 rounded-lg px-2 py-1 text-[11px] font-medium text-sky-950/80 transition-all duration-200",
          "top-0 -translate-y-1/2 bg-white/60",
          "peer-placeholder-shown:top-3 peer-placeholder-shown:translate-y-0 peer-placeholder-shown:bg-white/0 peer-placeholder-shown:text-sky-950/50",
          "peer-focus:top-0 peer-focus:-translate-y-1/2 peer-focus:bg-white/60 peer-focus:text-sky-950",
        ].join(" ")}
      >
        {label}
      </label>
    </div>
  );
}

function SelectField({
  label,
  name,
  children,
  required,
  disabled = false,
}: {
  label: string;
  name: string;
  children: React.ReactNode;
  required?: boolean;
  disabled?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="ml-1 text-xs font-medium text-sky-950/80">{label}</span>
      <div className="relative">
        <select
          name={name}
          required={required}
          disabled={disabled}
          className="relative z-[1] w-full cursor-pointer appearance-none rounded-2xl border border-sky-950/10 bg-white/10 p-3 text-sky-950 outline-none backdrop-blur focus:border-sky-950/30 focus:ring-1 focus:ring-sky-950/30 disabled:cursor-not-allowed disabled:opacity-60"
          defaultValue=""
        >
          {children}
        </select>
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sky-950/60">
          ▾
        </span>
      </div>
    </label>
  );
}

/* ===========================
 * Helpers de sección
 * =========================== */
function Section({
  id,
  title,
  eyebrow,
  children,
}: {
  id?: string;
  title: string;
  eyebrow?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 py-16 sm:py-20">
      <div className="mx-auto max-w-7xl px-1 md:px-8">
        <motion.header {...viewPreset}>
          {eyebrow && (
            <div className="mb-3 inline-flex rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs font-medium text-sky-950/80 backdrop-blur">
              {eyebrow}
            </div>
          )}
          <h2 className="text-2xl font-semibold text-sky-950 sm:text-3xl">
            {title}
          </h2>
        </motion.header>
        <div className="mt-8">{children}</div>
      </div>
    </section>
  );
}

function FeatureCard({
  title,
  desc,
  icon,
}: {
  title: string;
  desc: string;
  icon: React.ReactNode;
}) {
  return (
    <motion.div
      className="rounded-3xl border border-white/10 bg-white/10 p-6 shadow-md shadow-sky-950/10 backdrop-blur"
      {...viewPreset}
      {...hoverPreset}
    >
      <div className="mb-4 inline-flex items-center gap-3">
        <span className="grid size-9 place-items-center rounded-full bg-sky-100 text-sky-950 shadow-sm shadow-sky-950/20">
          {icon}
        </span>
        <h3 className="text-base font-semibold text-sky-950">{title}</h3>
      </div>
      <p className="text-[15px] leading-relaxed text-sky-950/80">{desc}</p>
    </motion.div>
  );
}

/* =========================================
 * YouTube helpers
 * ========================================= */
function getYouTubeEmbed(rawUrl: string): string {
  if (!rawUrl) return "";
  try {
    const u = new URL(rawUrl);
    if (u.hostname.includes("youtu.be")) {
      const idFromPath = u.pathname.replace("/", "");
      if (idFromPath) {
        return `https://www.youtube.com/embed/${idFromPath}?rel=0`;
      }
    }
    if (u.hostname.includes("youtube.com")) {
      if (u.pathname.startsWith("/embed/")) {
        return rawUrl;
      }
      const v = u.searchParams.get("v");
      if (v) {
        return `https://www.youtube.com/embed/${v}?rel=0`;
      }
    }
  } catch {
    return rawUrl;
  }
  return rawUrl;
}

type TutorialVideo = {
  title: string;
  desc: string;
  videoUrl: string;
};

function TutorialVideoCard({ title, desc, videoUrl }: TutorialVideo) {
  const finalUrl = getYouTubeEmbed(videoUrl);
  const [playing, setPlaying] = useState(false);
  const playbackUrl = `${finalUrl}${finalUrl.includes("?") ? "&" : "?"}autoplay=1`;

  return (
    <motion.div
      className="flex flex-col overflow-hidden rounded-3xl border border-white/10 bg-white/20 shadow-md shadow-sky-950/10"
      {...viewPreset}
    >
      <div className="relative aspect-video w-full bg-gradient-to-br from-slate-900 via-sky-950 to-slate-800">
        {playing && finalUrl ? (
          <iframe
            className="absolute inset-0 size-full rounded-t-3xl"
            src={playbackUrl}
            title={title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        ) : finalUrl ? (
          <button
            type="button"
            onClick={() => setPlaying(true)}
            className="absolute inset-0 flex size-full flex-col items-center justify-center gap-3 text-white transition-colors hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-sky-300"
            aria-label={`Reproducir ${title}`}
          >
            <span className="grid size-16 place-items-center rounded-full border border-white/30 bg-white/15 shadow-lg">
              <svg
                viewBox="0 0 24 24"
                className="size-7 translate-x-0.5"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M7 4.5a1 1 0 0 1 1.53-.85l11 7.5a1 1 0 0 1 0 1.7l-11 7.5A1 1 0 0 1 7 19.5z" />
              </svg>
            </span>
            <span className="text-xs font-medium tracking-wide">Ver video</span>
          </button>
        ) : (
          <div className="absolute inset-0 grid place-items-center text-[11px] tracking-wide text-white/60">
            VIDEO
          </div>
        )}
      </div>
      <div className="flex flex-col px-5 py-4">
        <p className="text-sm font-semibold text-sky-950">{title}</p>
        <p className="mt-2 text-xs leading-relaxed text-sky-950/70">{desc}</p>
      </div>
    </motion.div>
  );
}

/* ===========================
 * Roles / valor por perfil
 * =========================== */
function RoleCard({ title, bullets }: { title: string; bullets: string[] }) {
  return (
    <motion.div
      className="rounded-3xl border border-white/10 bg-white/10 p-6 shadow-md shadow-sky-950/10 backdrop-blur"
      {...viewPreset}
      {...hoverPreset}
    >
      <h3 className="text-base font-semibold text-sky-950">{title}</h3>
      <ul className="mt-4 space-y-2 text-sm text-sky-950/80">
        {bullets.map((b, i) => (
          <li key={i} className="flex gap-2">
            <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-sky-800" />
            <span>{b}</span>
          </li>
        ))}
      </ul>
    </motion.div>
  );
}

/* ===========================
 * Tutorial videos data
 * =========================== */
const VIDEOS: TutorialVideo[] = [
  {
    title: "Ofistur N° 1: Presentación, Login y Dashboard",
    desc: "Conocé Ofistur desde cero: landing, inicio de sesión y el panel que centraliza todo en 2 clics. Ideal si venís de un “sistema prehistórico” y querés ver métricas, alertas y accesos rápidos hechos por y para agencias de viaje. Más información.",
    videoUrl: "https://youtu.be/p3Lzg1y2D7Y",
  },
  {
    title: "Ofistur N° 2: Pasajeros — Alta, Edición, Baja y KPIs rápidos",
    desc: "Cargá, editá y eliminá pasajeros sin vueltas. Vemos fichas, búsquedas, segmentación y estadísticas clave (deuda, historial, valor). Todo listo para cotizar y confirmar más rápido. Más información.",
    videoUrl: "https://youtu.be/-Ps3wLSCVDg",
  },
  {
    title: "Ofistur N° 3: Reservas — Flujo básico y primer vistazo a Servicios",
    desc: "Creá tu primera reserva, editála, eliminála y conectála con el titular. Además, te muestro la primera pantalla de Servicios para entender cómo se arma cada viaje paso a paso. Más información.",
    videoUrl: "https://youtu.be/uhR4D87JbWo",
  },
  {
    title: "Ofistur N° 4: Servicios — CRUD completo y resumen con estadísticas",
    desc: "Alta/edición/baja de servicios dentro de la reserva y un tablero de resumen con importes, comisiones e impuestos automáticos. Visualizá en 2 clics el estado global de cada viaje. Más información.",
    videoUrl: "https://youtu.be/UNYCNBVi528",
  },
  {
    title:
      "Ofistur N° 5: Servicios a fondo — Planes de pago, Recibos y Operadores",
    desc: "Definí planes de pago, emití recibos, gestioná vencimientos y registrá pagos al operador. Controlá el estado de la reserva y evitá olvidos con avisos claros para el equipo. Más información.",
    videoUrl: "https://youtu.be/uK4dy_c-n2c",
  },
  {
    title: "Ofistur N° 6: Facturas y Notas de Crédito — Flujo y Estadísticas",
    desc: "Emití facturas y notas de crédito, vinculalas a servicios y seguí su impacto en la rentabilidad. Cerramos con un tablero de métricas de facturación para decisiones en tiempo real. Más información.",
    videoUrl: "https://youtu.be/QWPOFHY7za4",
  },
  {
    title: "Ofistur N° 7: Finanzas — Gastos, Saldos, Ganancias y Configuración",
    desc: "Inversiones (gastos), pagos al operador, recibos, saldos de reservas y cálculo automático de comisiones (vendedor/líder/agencia). Además, configuración de monedas, cuentas, métodos y categorías. Más información.",
    videoUrl: "https://youtu.be/XQWpJ1J4JcE",
  },
  {
    title:
      "Ofistur N° 8: Recursos del Equipo — Notas, Calendario y Templates PDF",
    desc: "Organizá al equipo con anotaciones colaborativas, calendario de pasajeros y plantillas listas para cotización y confirmación en PDF. Centralizá comunicación y documentación en un solo lugar. Más información.",
    videoUrl: "https://youtu.be/xJFyNUfTDjc",
  },
  {
    title:
      "Ofistur N° 9: Agencia — Identidad, AFIP, Operadores, Usuarios y Roles",
    desc: "Ajustá datos de la agencia (logo, certificados AFIP, Costos bancarios), gestioná Operadores, Usuarios y Equipos de ventas, y administrá roles y contraseñas con control fino de permisos. Más información.",
    videoUrl: "https://youtu.be/3hXinQcW1ck",
  },
  {
    title: "Ofistur N° 10: Cierre del Tutorial",
    desc: "Pedí una demo, migrá a Ofistur y trabajá desde Mac/Windows/iOS/Android. Todo centralizado y en 2 clics. Más información.",
    videoUrl: "https://youtu.be/7RmdJWiiEIQ",
  },
];

/* ===========================
 * Formulario de leads (landing)
 * =========================== */
function LeadForm() {
  const [sent, setSent] = useState<null | "ok" | "err">(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setSent(null);

    const formEl = e.currentTarget;
    const formData = new FormData(formEl);

    // payload para /api/leads (POST público)
    const payload = {
      name: String(formData.get("name") ?? ""),
      agency: String(formData.get("agency") ?? ""),
      role: String(formData.get("role") ?? ""),
      size: String(formData.get("size") ?? ""),
      location: String(formData.get("location") ?? ""),
      email: String(formData.get("email") ?? ""),
      whatsapp: String(formData.get("whatsapp") ?? ""),
      message: String(formData.get("message") ?? ""),
    };

    try {
      const res = await authFetch(
        "/api/leads",
        {
          method: "POST",
          body: JSON.stringify(payload),
        },
        null, // público, sin token
      );

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        console.error("[lead][submit] error:", errJson);
        throw new Error(
          (errJson as { error?: string }).error || "Error al enviar",
        );
      }

      // éxito
      trackCompleteRegistration(
        { content_name: "landing_lead_form" },
        {
          user: {
            email: payload.email,
            phone: payload.whatsapp,
            city: payload.location,
          },
        },
      );
      setSent("ok");
      formEl.reset();
    } catch (err) {
      console.error(err);
      setSent("err");
    } finally {
      setLoading(false);
    }
  }

  // estado "enviado"
  if (sent === "ok") {
    return (
      <motion.div
        className="rounded-3xl border border-emerald-300/50 bg-emerald-50/70 p-6 text-emerald-900 shadow-md shadow-emerald-950/10 backdrop-blur md:p-7"
        {...viewPreset}
      >
        <div className="flex items-start gap-3">
          <div className="mt-1 rounded-full bg-emerald-600/10 p-2 text-emerald-700 shadow-sm shadow-emerald-900/10">
            <IconCheckCircle className="size-5" />
          </div>
          <div className="flex-1">
            <h4 className="text-lg font-semibold leading-tight">
              ¡Listo! Ya recibimos tus datos
            </h4>
            <p className="mt-2 text-sm text-emerald-900/80">
              Te vamos a escribir por WhatsApp y email para coordinar un Meet de
              demo / onboarding. También podés hablarnos directo ahora 👇
            </p>

            <div className="mt-5 flex flex-wrap items-center gap-4">
              <ButtonPrimary
                variant="emerald"
                href={WA_URL}
                size="sm"
                onClick={handleWhatsAppClick}
              >
                Abrir WhatsApp
              </ButtonPrimary>
              <p className="text-[11px] leading-snug text-emerald-900/70">
                Respuesta humana real, no bot.
              </p>
            </div>
          </div>
        </div>
      </motion.div>
    );
  }

  // estado normal
  return (
    <motion.form
      onSubmit={onSubmit}
      className="relative rounded-3xl border border-white/10 bg-white/10 px-3 py-6 text-sky-950 shadow-md shadow-sky-950/10 backdrop-blur md:p-7"
      {...viewPreset}
      noValidate
    >
      {/* overlay cargando */}
      {loading && (
        <div className="absolute inset-0 z-20 flex items-center justify-center rounded-3xl bg-white/50 backdrop-blur-sm">
          <Spinner />
        </div>
      )}

      <div
        className={`grid gap-5 md:grid-cols-2 ${loading ? "pointer-events-none opacity-60" : ""}`}
      >
        <FloatingInput
          label="Nombre y apellido *"
          name="name"
          required
          disabled={loading}
        />
        <FloatingInput
          label="Agencia / Operador *"
          name="agency"
          required
          disabled={loading}
        />

        <SelectField label="Rol *" name="role" required disabled={loading}>
          <option value="" disabled>
            Seleccionar…
          </option>
          <option>Dueño/Gerente</option>
          <option>Administración</option>
          <option>Líder</option>
          <option>Vendedor</option>
        </SelectField>

        <SelectField label="Tamaño" name="size" disabled={loading}>
          <option value="" disabled>
            Seleccionar…
          </option>
          <option>Freelancer</option>
          <option>2–5</option>
          <option>6–15</option>
          <option>16–30</option>
          <option>30+</option>
        </SelectField>

        <FloatingInput
          label="País / Ciudad"
          name="location"
          disabled={loading}
        />
        <FloatingInput
          label="Email *"
          name="email"
          type="email"
          required
          disabled={loading}
        />
        <FloatingInput
          label="WhatsApp (opcional)"
          name="whatsapp"
          disabled={loading}
        />

        <div className="md:col-span-2">
          <FloatingTextarea
            label="Mensaje (opcional)"
            name="message"
            rows={4}
            disabled={loading}
          />
        </div>
      </div>

      <div
        className={`mt-6 flex flex-wrap items-center gap-3 ${loading ? "pointer-events-none opacity-60" : ""}`}
      >
        <ButtonPrimary
          type="submit"
          size="sm"
          className="min-w-[120px]"
          disabled={loading}
        >
          {loading ? "Enviando…" : "Enviar"}
        </ButtonPrimary>

        <ButtonPrimary
          variant="emerald"
          href={WA_URL}
          size="sm"
          onClick={handleWhatsAppClick}
        >
          WhatsApp
        </ButtonPrimary>

        <p className="text-xs text-sky-950/70">
          Al enviar aceptás nuestras{" "}
          <a className="underline" href="/legal/terminos">
            Condiciones
          </a>{" "}
          y{" "}
          <a className="underline" href="/legal/privacidad">
            Privacidad
          </a>
          .
        </p>
      </div>

      {sent === "err" && (
        <motion.p
          className="mt-3 text-sm text-red-600"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
        >
          Hubo un error. Probá de nuevo o escribinos por WhatsApp.
        </motion.p>
      )}
    </motion.form>
  );
}

/* ===========================
 * Pricing section (refinado)
 * =========================== */

function PricingSection() {
  return (
    <section id="pricing" className="scroll-mt-24 py-16 sm:py-20">
      <div className="mx-auto max-w-7xl px-1 md:px-8">
        {/* Header */}
        <motion.header {...viewPreset}>
          <div className="mb-3 inline-flex rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs font-medium text-sky-950/80 backdrop-blur">
            Precios
          </div>
          <h2 className="text-2xl font-semibold text-sky-950 sm:text-3xl">
            Planes y estimador
          </h2>
          <p className="mt-2 max-w-xl text-sm text-sky-950/70">
            Todos los planes incluyen acceso web y mobile. Podés cancelar cuando
            quieras.
          </p>
        </motion.header>

        {/* Wrapper */}
        <div className="mt-8">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10 rounded-3xl bg-[radial-gradient(circle_at_20%_0%,rgba(186,230,253,0.5)_0%,transparent_60%)]"
          />

          <div className="flex flex-col gap-6">
            {/* Columna izquierda: 3 planes */}
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {(["basico", "medio", "pro"] as PlanKey[]).map((p) => (
                <PriceTierCard key={p} planKey={p} />
              ))}
            </div>

            {/* Columna derecha */}
            <div className="flex flex-col">
              <PricingCalculator />
            </div>
          </div>

          <p className="mt-8 text-[11px] leading-relaxed text-sky-950/60">
            Valores estimados en USD + IVA (según corresponda). La
            infraestructura en la nube escala con tu equipo. Sin período mínimo.
          </p>
        </div>
      </div>
    </section>
  );
}

function PriceTierCard({ planKey }: { planKey: PlanKey }) {
  const info = PLAN_FEATURES[planKey];
  const base = PLAN_BASE_PRICES[planKey];

  const highlight = !!info.highlight;

  return (
    <motion.div
      className={[
        "flex flex-col rounded-2xl border shadow-md backdrop-blur-sm",
        highlight
          ? "border-emerald-300/50 bg-emerald-50/30 text-emerald-900 shadow-emerald-950/10"
          : "border-white/10 bg-white/40 text-sky-950 shadow-sky-950/10",
      ].join(" ")}
      {...viewPreset}
      {...hoverPreset}
    >
      {/* Header precio */}
      <div
        className={[
          "rounded-t-2xl border-b px-5 py-5",
          highlight
            ? "border-emerald-300/40 bg-white/60 text-emerald-900 shadow-sm shadow-emerald-900/5"
            : "border-white/20 bg-white/60 text-sky-950 shadow-sm shadow-sky-950/5",
        ].join(" ")}
      >
        <div className="flex flex-wrap items-baseline gap-2">
          <h3
            className={[
              "text-base font-semibold leading-none",
              highlight ? "text-emerald-900" : "text-sky-950",
            ].join(" ")}
          >
            {info.label}
          </h3>

          {highlight && (
            <span className="rounded-full border border-emerald-300/50 bg-emerald-50/70 px-2 py-[2px] text-[10px] font-semibold leading-none text-emerald-900 shadow-sm shadow-emerald-900/10">
              Más elegido
            </span>
          )}
        </div>

        <div className="mt-3 text-3xl font-semibold leading-none">
          USD {base}{" "}
          <span className="text-sm font-medium opacity-70">+ IVA /mes</span>
        </div>

        <p className="mt-2 text-[11px] font-medium leading-snug opacity-70">
          Incluye 3 usuarios.
        </p>
      </div>

      {/* Body bullets */}
      <div className="flex flex-1 flex-col p-5 text-[13px] leading-relaxed">
        <ul
          className={[
            "flex flex-col gap-2",
            highlight ? "text-emerald-900/90" : "text-sky-950/80",
          ].join(" ")}
        >
          {info.bullets.map((b, i) => (
            <li key={i} className="flex items-start gap-2">
              <span
                className={[
                  "mt-[3px] flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold leading-none shadow-sm",
                  highlight
                    ? "bg-emerald-600/15 text-emerald-800 shadow-emerald-900/10"
                    : "bg-sky-100 text-sky-900 shadow-sky-950/10",
                ].join(" ")}
              >
                <IconCheckMini className="size-3" />
              </span>
              <span>{b}</span>
            </li>
          ))}
        </ul>

        {/* Footnote caja */}
        <div
          className={[
            "mt-5 rounded-xl border p-3 text-[11px] leading-snug shadow-sm",
            highlight
              ? "border-emerald-300/40 bg-white/60 text-emerald-900/80 shadow-emerald-950/5"
              : "border-white/20 bg-white/50 text-sky-950/70 shadow-sky-950/5",
          ].join(" ")}
        >
          <p className="font-semibold">Usuarios</p>
          <p>3 usuarios incluidos. +USD 5 c/u (4–10). +USD 10 c/u (11+).</p>

          <p className="mt-3 font-semibold">Nube / Infraestructura</p>
          <p>
            Hasta 3 usuarios sin costo. Desde 4 usuarios sumamos
            infraestructura: USD 20 /mes (4–7), USD 30 /mes (8–12), luego +USD
            10 por usuario.
          </p>
        </div>
      </div>
    </motion.div>
  );
}

/* ===========================
 * Cotizador
 * =========================== */
function PricingCalculator() {
  const [plan, setPlan] = useState<PlanKey>("medio");
  const [users, setUsers] = useState<number>(6);
  const [bspRate, setBspRate] = useState<number | null>(null);
  const [bspDate, setBspDate] = useState<string | null>(null);
  const [bspStatus, setBspStatus] = useState<"idle" | "loading" | "ok" | "err">(
    "idle",
  );
  const bspCacheRef = useRef<{
    ts: number;
    rate: number;
    date: string | null;
  } | null>(null);

  const basePrice = PLAN_BASE_PRICES[plan];
  const extraUsers = calcExtraUsersCost(users);
  const cloud = calcCloudCost(users);
  const total = basePrice + extraUsers + cloud;

  useEffect(() => {
    const now = Date.now();
    const cached = bspCacheRef.current;
    const ttlMs = 10 * 60 * 1000;

    if (cached && now - cached.ts < ttlMs) {
      setBspRate(cached.rate);
      setBspDate(cached.date);
      setBspStatus("ok");
      return;
    }

    const ac = new AbortController();

    (async () => {
      try {
        setBspStatus("loading");
        const res = await fetch(`/api/bsp-rate?ts=${now}`, {
          signal: ac.signal,
        });
        if (!res.ok) throw new Error("bsp rate fetch failed");
        const data = (await res.json()) as BspRateResponse;
        if (data?.ok && typeof data.arsPerUsd === "number") {
          const rate = data.arsPerUsd;
          const date = data.date ?? null;
          setBspRate(rate);
          setBspDate(date);
          bspCacheRef.current = { ts: Date.now(), rate, date };
          setBspStatus("ok");
        } else {
          setBspStatus("err");
        }
      } catch (err) {
        if ((err as { name?: string })?.name !== "AbortError") {
          setBspStatus("err");
        }
      }
    })();

    return () => ac.abort();
  }, []);

  const formatBspRate = (value: number) =>
    new Intl.NumberFormat("es-AR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);

  const formatBspDate = (value: string | null) => {
    if (!value) return null;
    const m = value.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return value;
    return `${m[3]}/${m[2]}/${m[1]}`;
  };

  const formatArs = (value: number) =>
    new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency: "ARS",
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(value);

  return (
    <motion.div
      className="rounded-2xl border border-sky-200/60 bg-white/50 p-5 text-sky-950 shadow-md shadow-sky-950/10 backdrop-blur-sm sm:p-6"
      {...viewPreset}
    >
      {/* Header */}
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-sky-950">
          Calculá tu estimación
        </h3>
        <p className="mt-1 text-[13px] leading-snug text-sky-950/70">
          Elegí un plan y cuántas personas lo van a usar.
        </p>
      </div>

      {/* Plan selector */}
      <div className="mb-5">
        <span className="mb-2 block text-xs font-medium text-sky-950/80">
          Plan
        </span>

        <div className="inline-flex rounded-full border border-sky-900/10 bg-white/60 p-1 text-sm shadow-inner shadow-sky-950/10">
          {(["basico", "medio", "pro"] as PlanKey[]).map((pKey) => {
            const active = plan === pKey;
            const info = PLAN_FEATURES[pKey];
            const highlight = !!info.highlight;
            return (
              <button
                key={pKey}
                type="button"
                onClick={() => setPlan(pKey)}
                className={[
                  "whitespace-nowrap rounded-full px-3 py-1.5 font-medium transition-all",
                  active
                    ? highlight
                      ? "bg-emerald-600/10 text-emerald-900 shadow-sm shadow-emerald-900/20 ring-1 ring-emerald-400/40"
                      : "bg-sky-100 text-sky-950 shadow-sm shadow-sky-950/20 ring-1 ring-sky-400/40"
                    : "text-sky-950/60",
                ].join(" ")}
              >
                {info.label}
              </button>
            );
          })}
        </div>

        <p className="mt-2 text-[11px] text-sky-950/60">
          {PLAN_FEATURES[plan].label}: USD {PLAN_BASE_PRICES[plan]} + IVA / mes.
        </p>
      </div>

      {/* Users selector */}
      <div className="mb-6">
        <div className="mb-2 flex items-center justify-between text-xs font-medium text-sky-950/80">
          <span>Usuarios totales</span>
          <span className="rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-semibold text-sky-950 shadow-sm shadow-sky-950/10 ring-1 ring-sky-900/10">
            {users} usuarios
          </span>
        </div>

        <input
          id="usersRange"
          type="range"
          min={1}
          max={20}
          value={users}
          onChange={(e) => setUsers(parseInt(e.target.value, 10))}
          className="w-full cursor-pointer accent-sky-600/40 backdrop-blur"
        />

        <div className="mt-3 flex items-center justify-center gap-2">
          <input
            type="number"
            min={1}
            max={20}
            value={users}
            onChange={(e) => {
              const val = parseInt(e.target.value, 10);
              if (!Number.isNaN(val)) {
                // clamp 1..20
                const clamped = Math.min(20, Math.max(1, val));
                setUsers(clamped);
              }
            }}
            className="w-16 rounded-xl border border-sky-950/10 bg-white/70 p-2 text-center text-sm font-semibold text-sky-950 shadow-inner shadow-sky-950/10 outline-none backdrop-blur-sm focus:border-sky-950/30 focus:ring-1 focus:ring-sky-950/30"
          />
          <span className="text-[11px] text-sky-950/60">
            Incluye escritorio y acceso móvil.
          </span>
        </div>
      </div>

      {/* Breakdown */}
      <div className="mb-6 grid gap-4 rounded-xl border border-white/20 bg-white/60 p-4 text-sky-950 shadow-inner shadow-sky-950/5">
        <BreakdownRow
          icon={<IconPlan className="size-4" />}
          label={`Plan ${PLAN_FEATURES[plan].label}`}
          note="incluye hasta 3 usuarios"
          amount={basePrice}
        />
        <BreakdownRow
          icon={<IconUsers className="size-4" />}
          label="Usuarios extra"
          note="4–10 = USD 5 c/u · 11+ = USD 10 c/u"
          amount={extraUsers}
        />
        <BreakdownRow
          icon={<IconCloud className="size-4" />}
          label="Infraestructura / Nube"
          note="escala según usuarios"
          amount={cloud}
        />

        <div className="border-t border-white/40 pt-4 text-right">
          <div className="text-[13px] font-medium text-sky-950">
            Estimación mensual:
          </div>
          <div className="text-xl font-semibold tabular-nums text-sky-950">
            USD {total.toFixed(2)}{" "}
            <span className="text-base font-normal opacity-70"> + IVA</span>
          </div>
          {bspStatus === "loading" && (
            <div className="mt-1 text-[11px] text-sky-950/60">
              Cargando TC BSP...
            </div>
          )}
          {bspStatus === "ok" && bspRate != null && (
            <div className="mt-2 rounded-lg border border-white/30 bg-white/60 px-3 py-2 text-left text-sky-950 shadow-inner shadow-sky-950/5">
              <div className="text-[11px] font-medium text-sky-950/70">
                Estimacion en ARS
              </div>
              <div className="text-base font-semibold tabular-nums text-sky-950">
                {formatArs(total * bspRate + total * bspRate * 0.21)}{" "}
                <span className="text-xs font-light tabular-nums text-sky-950/70">
                  con IVA incluido
                </span>
              </div>
              <div className="mt-1 text-[10px] text-sky-950/60">
                TC BSP {formatBspRate(bspRate)}
                {bspDate ? ` · ${formatBspDate(bspDate)}` : ""}
              </div>
            </div>
          )}
          {bspStatus === "err" && (
            <div className="mt-1 text-[11px] text-sky-950/60">
              TC BSP no disponible.
            </div>
          )}
          {/* <div className="text-[11px] text-sky-950/60">
            + IVA según corresponda. Valores estimados en USD.
          </div> */}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <ButtonPrimary
          variant="emerald"
          href={WA_URL}
          size="sm"
          onClick={handleWhatsAppClick}
        >
          Quiero cotizar con alguien
        </ButtonPrimary>
        <p className="text-[11px] text-sky-950/60">
          Te ayudamos a elegir el plan.
        </p>
      </div>
    </motion.div>
  );
}

function BreakdownRow({
  icon,
  label,
  note,
  amount,
}: {
  icon: React.ReactNode;
  label: string;
  note?: string;
  amount: number;
}) {
  return (
    <div className="flex items-start justify-between gap-4 text-sm leading-snug text-sky-950">
      <div className="flex min-w-0 items-start gap-2">
        <span className="mt-[2px] flex size-8 shrink-0 items-center justify-center rounded-full bg-white/70 text-sky-950 shadow-sm shadow-sky-950/10 ring-1 ring-sky-900/10">
          {icon}
        </span>
        <div className="min-w-0">
          <p className="font-medium text-sky-950">{label}</p>
          {note && (
            <p className="text-[11px] leading-snug text-sky-950/60">{note}</p>
          )}
        </div>
      </div>
      <div className="text-right font-semibold tabular-nums text-sky-950">
        USD {amount.toFixed(2)}
      </div>
    </div>
  );
}

/* ===========================
 * Landing page
 * =========================== */
export default function LandingClient() {
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden py-24 sm:py-40">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60%_50%_at_50%_0%,#e0f2fe_0%,transparent_60%)]"
        />
        <div className="mx-auto max-w-7xl px-1 md:px-8">
          <Card className="max-w-4xl bg-white/20" animated={false}>
            <motion.h1
              className="text-4xl font-semibold leading-tight tracking-tight text-sky-950 sm:text-6xl"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, ease: "easeOut" }}
            >
              La gestión completa para{" "}
              <span className="relative inline-block">
                <span className="relative z-10">agencias de viajes</span>
                <span
                  aria-hidden
                  className="absolute inset-x-0 bottom-1 h-3 rounded-sm bg-amber-200/70"
                />
              </span>
              , en un solo lugar.
            </motion.h1>

            <motion.p
              className="mt-6 max-w-2xl text-lg text-sky-950/80"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, ease: "easeOut", delay: 0.06 }}
            >
              Centralizá procesos, documentos y finanzas. Disponible en
              Argentina. Coordinemos un Meet por WhatsApp y vemos tu operación
              en vivo.
            </motion.p>

            <motion.div
              className="mt-8 flex flex-wrap items-center gap-6 sm:gap-3"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, ease: "easeOut", delay: 0.12 }}
            >
              <ButtonPrimary
                variant="emerald"
                href={WA_URL}
                size="sm"
                onClick={handleWhatsAppClick}
              >
                Agendar Meet por WhatsApp
              </ButtonPrimary>
              <ButtonGhost href="#contacto" size="sm">
                Dejar mis datos
              </ButtonGhost>
            </motion.div>

            <div className="mt-7 flex flex-wrap items-center gap-2 text-xs">
              <Chip>AFIP</Chip>
              <Chip>Copias de seguridad</Chip>
              <Chip>Accesos por rol</Chip>
              <Chip>Soporte técnico</Chip>
            </div>
          </Card>
        </div>
      </section>

      {/* Producto / pilares + charts */}
      <Section id="producto" title="Qué resuelve" eyebrow="Producto">
        <div className="grid grid-cols-1 gap-5 sm:gap-6 md:[grid-template-columns:repeat(auto-fit,minmax(220px,1fr))] lg:gap-7">
          <FeatureCard
            title="Operativa"
            desc="Pasajeros, reservas y servicios, operadores, calendario y recursos internos."
            icon={<IconCalendar className="size-5" aria-hidden />}
          />
          <FeatureCard
            title="Finanzas"
            desc="Facturación AFIP, notas de crédito, recibos, planes de pago, caja y saldos por reserva."
            icon={<IconInvoice className="size-5" aria-hidden />}
          />
          <FeatureCard
            title="Control"
            desc="Usuarios, roles y equipos con visibilidad por persona y coordinación."
            icon={<IconShield className="size-5" aria-hidden />}
          />
          <FeatureCard
            title="Productividad"
            desc="Templates PDF, documentos listos para enviar y menos retrabajo. Funciona también desde el celu."
            icon={<IconZap className="size-5" aria-hidden />}
          />
        </div>

        {/* Charts marketing */}
        <div className="mt-10 grid grid-cols-1 gap-5 sm:gap-6 md:[grid-template-columns:repeat(auto-fit,minmax(260px,1fr))] lg:gap-7">
          <ChartVentasUp />
          <ChartAdminDown />
          <ChartControlEquipo />
        </div>
      </Section>

      <Section id="modulos" title="Módulos incluidos" eyebrow="Alcance">
        <div className="grid grid-cols-1 gap-5 sm:gap-6 md:[grid-template-columns:repeat(auto-fit,minmax(240px,1fr))] lg:gap-7">
          {MODULE_GROUPS.map((group) => (
            <Card key={group.title}>
              <h3 className="text-base font-semibold text-sky-950">
                {group.title}
              </h3>
              <div className="mt-4 flex flex-wrap gap-2">
                {group.items.map((item) => (
                  <Chip key={`${group.title}-${item}`} variant={group.variant}>
                    {item}
                  </Chip>
                ))}
              </div>
            </Card>
          ))}
        </div>
      </Section>

      {/* Tutorial en video */}
      <Section
        id="videos"
        title="Tutorial completo (10 videos cortos)"
        eyebrow="Videos"
      >
        <p className="text-sm text-sky-950/80">
          Mirá el flujo real de trabajo: alta de pasajeros, reservas, servicios,
          finanzas, facturación y permisos. Son pantallas reales, tal cual las
          usa tu agencia hoy.
        </p>

        <div className="mt-7 grid grid-cols-1 gap-6 sm:gap-7 md:[grid-template-columns:repeat(auto-fit,minmax(320px,1fr))]">
          {VIDEOS.map((v, i) => (
            <TutorialVideoCard
              key={i}
              title={v.title}
              desc={v.desc}
              videoUrl={v.videoUrl}
            />
          ))}
        </div>
      </Section>

      {/* Roles */}
      <Section id="roles" title="Valor por rol" eyebrow="Perfiles">
        <div className="grid gap-6 [grid-template-columns:repeat(auto-fit,minmax(260px,1fr))]">
          <RoleCard
            title="Dueño / Gerente"
            bullets={[
              "Visión por equipo",
              "Comisiones y caja claras",
              "Indicadores sin planillas",
            ]}
          />
          <RoleCard
            title="Administración"
            bullets={[
              "Facturación sin fricción",
              "Recibos / Notas de crédito ordenados",
              "Menos errores y retrabajo",
            ]}
          />
          <RoleCard
            title="Líder"
            bullets={[
              "Seguimiento de ventas",
              "Objetivos y pipeline simple",
              "Documentación prolija",
            ]}
          />
          <RoleCard
            title="Vendedor"
            bullets={[
              "Cotizar rápido",
              "Confirmar fácil",
              "Docs prolijos para enviar",
            ]}
          />
        </div>
      </Section>

      {/* Seguridad */}
      <Section
        id="seguridad"
        title="Seguridad e integraciones"
        eyebrow="Confianza"
      >
        <ul className="mt-3 list-disc gap-2 pl-6 text-sm text-sky-950/80">
          <li>Integración AFIP</li>
          <li>Copias de seguridad automáticas</li>
          <li>Cifrado en tránsito y en reposo</li>
          <li>Accesos por rol y registro de cambios</li>
        </ul>
      </Section>

      {/* FAQ */}
      <Section id="faq" title="Preguntas frecuentes" eyebrow="FAQ">
        <motion.div className="rounded-3xl border border-white/10 bg-white/10 p-1 shadow-md shadow-sky-950/10 backdrop-blur">
          {FAQ_ITEMS.map(([q, a], i) => (
            <FAQItem key={i} question={q} answer={a} />
          ))}
        </motion.div>
      </Section>

      {/* Pricing + cotizador */}
      <PricingSection />

      {/* Contacto */}
      <Section id="contacto" title="Dejá tus datos" eyebrow="Contacto">
        <div className="grid gap-6 sm:gap-7 md:grid-cols-[1fr,1.2fr] lg:grid-cols-[1fr,1.3fr]">
          {/* CTA card */}
          <Card>
            <h3 className="text-lg font-semibold">
              ¿Preferís coordinar un Meet?
            </h3>
            <p className="mt-2 text-sm text-sky-950/80">
              Te respondemos por WhatsApp para agendar un Meet y ver tu caso.
            </p>
            <div className="mt-4">
              <ButtonPrimary
                variant="emerald"
                href={WA_URL}
                size="sm"
                onClick={handleWhatsAppClick}
              >
                Abrir WhatsApp
              </ButtonPrimary>
            </div>
            <div className="mt-6 text-xs text-sky-950/70">
              También podés completar el formulario y te contactamos por
              WhatsApp y email.
            </div>
          </Card>

          {/* Lead form */}
          <LeadForm />
        </div>
      </Section>

      {/* Footer mini */}
      <footer className="border-t border-white/10 py-10 text-center text-sm text-sky-950/70">
        © {new Date().getFullYear()} Ofistur ·{" "}
        <a href="/legal/terminos" className="underline">
          Términos
        </a>{" "}
        ·{" "}
        <a href="/legal/privacidad" className="underline">
          Privacidad
        </a>
      </footer>

      {/* Botón flotante WhatsApp */}
      <a
        href={WA_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Escribir por WhatsApp"
        className="fixed bottom-5 right-5 z-[60] inline-flex size-12 items-center justify-center rounded-full border border-emerald-300/50 bg-emerald-50 text-emerald-950 shadow-lg shadow-emerald-950/20 transition hover:scale-105 active:scale-95"
        onClick={handleWhatsAppClick}
      >
        <IconWhatsApp className="size-6" />
      </a>
    </>
  );
}

/* ===========================
 * FAQ orientada a dolores reales
 * =========================== */
const FAQ_ITEMS: [string, string][] = [
  [
    "Hoy tengo todo en Excel y WhatsApp. ¿Me sirve igual?",
    "Sí. Ese es justamente el caso más común: reservas en un Excel, audios con precios, PDFs sueltos. Ofistur junta pasajeros, reservas, vencimientos, facturas y cobranzas en un solo lugar para que no dependas de mil chats y planillas.",
  ],
  [
    "¿Cuánto tiempo le ahorra a mi equipo?",
    "La mayoría del tiempo perdido es repetir datos, corregir facturas, perseguir saldos o pedir info al vendedor. En Ofistur ya está cargado una sola vez y lo ve todo el equipo. Eso baja mucho las horas de administración y retrabajo interno.",
  ],
  [
    "¿Necesito alguien técnico para usarlo?",
    "No. Está pensado para equipos de viaje, no para contadores ni programadores. Los permisos por rol hacen que cada persona solo vea/edite lo que necesita (ventas, caja, AFIP, etc.) sin miedo a “romper” algo.",
  ],
  [
    "¿Me ayuda con AFIP y la facturación?",
    "Sí. Podés emitir comprobantes, notas de crédito y tenerlos ligados a cada reserva/servicio. Además se ve la rentabilidad y las comisiones sin tener que armar reportes a mano.",
  ],
  [
    "¿Estoy atado a un contrato largo?",
    "No. Podés dejar de usar la plataforma cuando quieras. Si después decidís volver a tus planillas, lo hacés. No hay permanencia mínima.",
  ],
];

function FAQItem({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false);
  const id = question.toLowerCase().replace(/\s+/g, "-");
  return (
    <div className="border-b border-white/10 first:rounded-t-3xl last:rounded-b-3xl">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left text-sky-950"
      >
        <span className="font-medium">{question}</span>
        <span
          className={`rounded-full bg-sky-100 px-2 py-0.5 text-xs text-sky-900 transition ${open ? "rotate-45" : ""}`}
        >
          +
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={`${id}-panel`}
            key="content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="overflow-hidden px-5"
          >
            <p className="pb-4 text-sm text-sky-950/80">{answer}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ===========================
 * Iconos inline
 * =========================== */
function IconCalendar(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      {...props}
    >
      <path d="M8 2v3M16 2v3M3 10h18M5 6h14a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z" />
    </svg>
  );
}
function IconInvoice(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      {...props}
    >
      <path d="M7 3h7l4 4v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
      <path d="M14 3v4h4M8 13h8M8 17h6M8 9h3" />
    </svg>
  );
}
function IconShield(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      {...props}
    >
      <path d="M12 3l7 3v6c0 5-3.5 8-7 9-3.5-1-7-4-7-9V6l7-3Z" />
      <path d="M9.5 12.5l2 2 3-3" />
    </svg>
  );
}
function IconZap(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      {...props}
    >
      <path d="M13 2L3 14h7l-1 8 11-14h-7l1-6z" />
    </svg>
  );
}
function IconWhatsApp(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="1em"
      height="1em"
      viewBox="0 0 464 488"
      {...props}
    >
      <path
        fill="#064e3b"
        d="M462 228q0 93-66 159t-160 66q-56 0-109-28L2 464l40-120q-32-54-32-116q0-93 66-158.5T236 4t160 65.5T462 228zM236 39q-79 0-134.5 55.5T46 228q0 62 36 111l-24 70l74-23q49 31 104 31q79 0 134.5-55.5T426 228T370.5 94.5T236 39zm114 241q-1-1-10-7q-3-1-19-8.5t-19-8.5q-9-3-13 2q-1 3-4.5 7.5t-7.5 9t-5 5.5q-4 6-12 1q-34-17-45-27q-7-7-13.5-15t-12-15t-5.5-8q-3-7 3-11q4-6 8-10l6-9q2-5-1-10q-4-13-17-41q-3-9-12-9h-11q-9 0-15 7q-19 19-19 45q0 24 22 57l2 3q2 3 4.5 6.5t7 9t9 10.5t10.5 11.5t13 12.5t14.5 11.5t16.5 10t18 8.5q16 6 27.5 10t18 5t9.5 1t7-1t5-1q9-1 21.5-9t15.5-17q8-21 3-26z"
      ></path>
    </svg>
  );
}
function IconCheckCircle(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      strokeWidth={1.8}
      stroke="currentColor"
      fill="none"
      {...props}
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8 12.5l2.5 2.5L16 9"
      />
    </svg>
  );
}

function IconCheckMini(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      strokeWidth={2}
      stroke="currentColor"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M4 8l3 3 5-5" />
    </svg>
  );
}

function IconPlan(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      strokeWidth={1.8}
      stroke="currentColor"
      fill="none"
      {...props}
    >
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="M8 9h8M8 13h5M8 17h3" />
    </svg>
  );
}

function IconUsers(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      strokeWidth={1.8}
      stroke="currentColor"
      fill="none"
      {...props}
    >
      <circle cx="9" cy="8" r="4" />
      <path d="M2 20c0-4 3-6 7-6" />
      <circle cx="17" cy="10" r="3" />
      <path d="M22 20c0-3-2-5-5-5" />
    </svg>
  );
}

function IconCloud(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      strokeWidth={1.8}
      stroke="currentColor"
      fill="none"
      {...props}
    >
      <path d="M7 18h10a4 4 0 0 0 0-8h-.5A6.5 6.5 0 0 0 4 11.5 4.5 4.5 0 0 0 7 18z" />
    </svg>
  );
}
