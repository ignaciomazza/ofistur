"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { toast, ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { requestGroupApi } from "@/lib/groups/clientApi";

type GroupType = "AGENCIA" | "ESTUDIANTIL" | "MICRO" | "PRECOMPRADO";
type GroupStatus =
  | "BORRADOR"
  | "PUBLICADA"
  | "CONFIRMADA"
  | "CERRADA"
  | "CANCELADA";

type GroupItem = {
  id_travel_group: number;
  agency_travel_group_id: number | null;
  public_id: string | null;
  name: string;
  code: string | null;
  type: GroupType;
  status: GroupStatus;
  start_date: string | null;
  end_date: string | null;
  capacity_mode: string;
  capacity_total: number | null;
  allow_overbooking: boolean;
  waitlist_enabled: boolean;
  sale_mode?: string | null;
  _count: {
    departures: number;
    passengers: number;
    bookings: number;
    inventories: number;
  };
};

const TYPE_OPTIONS: Array<{ label: string; value: GroupType }> = [
  { label: "Agencia", value: "AGENCIA" },
  { label: "Estudiantil", value: "ESTUDIANTIL" },
  { label: "Micro", value: "MICRO" },
  { label: "Cupos", value: "PRECOMPRADO" },
];

const GROUP_TYPE_LABELS: Record<GroupType, string> = {
  AGENCIA: "Agencia",
  ESTUDIANTIL: "Estudiantil",
  MICRO: "Micro",
  PRECOMPRADO: "Cupos",
};

const PILL_BASE =
  "rounded-full border px-3 py-1 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60";
const PILL_INACTIVE =
  "border-slate-300 bg-white/80 text-slate-700 hover:border-slate-400 dark:border-slate-600 dark:bg-slate-900/60 dark:text-slate-200 dark:hover:border-slate-500";
const PILL_SKY_ACTIVE =
  "border-sky-400 bg-sky-100/90 text-sky-800 dark:border-sky-500 dark:bg-sky-900/35 dark:text-sky-200";
const PILL_EMERALD_ACTIVE =
  "border-emerald-400 bg-emerald-100/90 text-emerald-800 dark:border-emerald-500 dark:bg-emerald-900/35 dark:text-emerald-200";
const PILL_AMBER_ACTIVE =
  "border-amber-400 bg-amber-100/90 text-amber-800 dark:border-amber-500 dark:bg-amber-900/35 dark:text-amber-200";
const RESULT_PILL_BASE = "rounded-full px-2.5 py-0.5 text-xs font-medium";
const RESULT_PILL_OK =
  "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
const RESULT_PILL_WARN = "bg-rose-500/15 text-rose-700 dark:text-rose-300";

function pillClass(
  active: boolean,
  tone: "sky" | "emerald" | "amber" = "sky",
): string {
  if (!active) return `${PILL_BASE} ${PILL_INACTIVE}`;
  const toneClass =
    tone === "emerald"
      ? PILL_EMERALD_ACTIVE
      : tone === "amber"
        ? PILL_AMBER_ACTIVE
        : PILL_SKY_ACTIVE;
  return `${PILL_BASE} ${toneClass}`;
}

function formatGroupType(value: GroupType): string {
  return GROUP_TYPE_LABELS[value] ?? value;
}

function formatGroupReference(group: GroupItem): string {
  const code = typeof group.code === "string" ? group.code.trim() : "";
  if (code) return `Código ${code}`;
  if (group.agency_travel_group_id)
    return `Grupal Nº${group.agency_travel_group_id}`;
  return `Grupal Nº${group.id_travel_group}`;
}

const DEPARTURE_DATE_FORMATTER = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

function formatDepartureDate(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  return DEPARTURE_DATE_FORMATTER.format(parsed);
}

function buildDepartureSummary(group: GroupItem): {
  title: string;
  note: string;
} {
  const start = formatDepartureDate(group.start_date);
  const end = formatDepartureDate(group.end_date);
  if (start && end) {
    return { title: `${start} -> ${end}`, note: "Rango operativo" };
  }
  if (start) {
    return { title: `Salida: ${start}`, note: "Fecha operativa cargada" };
  }
  if (group._count.departures > 0) {
    const departuresLabel =
      group._count.departures === 1 ? "salida cargada" : "salidas cargadas";
    return {
      title: `${group._count.departures} ${departuresLabel}`,
      note: "Completá fechas dentro de cada salida",
    };
  }
  return { title: "Sin fechas cargadas", note: "Definilas en salidas" };
}

function isMultipleDepartureGroup(group: GroupItem): boolean {
  const normalizedSaleMode = String(group.sale_mode || "").toUpperCase();
  return normalizedSaleMode === "MULTIPLE" || group._count.departures > 1;
}

function Spinner({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="size-3 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700 dark:border-slate-600 dark:border-t-slate-200" />
      {label}
    </span>
  );
}

function CollapsiblePanel({
  open,
  children,
  className = "",
}: {
  open: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <AnimatePresence initial={false}>
      {open ? (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.24, ease: "easeInOut" }}
          className={`overflow-hidden ${className}`}
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

export default function GroupsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [groups, setGroups] = useState<GroupItem[]>([]);

  const [name, setName] = useState("");
  const [status, setStatus] = useState<GroupStatus>("BORRADOR");
  const [capacityMode, setCapacityMode] = useState<"TOTAL" | "SERVICIO">(
    "TOTAL",
  );
  const [capacityTotal, setCapacityTotal] = useState<string>("");
  const [departureMode, setDepartureMode] = useState<"UNICA" | "MULTIPLE">(
    "UNICA",
  );
  const [departureName, setDepartureName] = useState("");
  const [departureDate, setDepartureDate] = useState("");
  const [departureReturnDate, setDepartureReturnDate] = useState("");

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"ALL" | GroupType>("ALL");
  const [viewMode, setViewMode] = useState<"LIST" | "GRID" | "TABLE">("GRID");
  const [showAdvancedCreate, setShowAdvancedCreate] = useState(false);
  const [showDepartureDraft, setShowDepartureDraft] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingGroup, setEditingGroup] = useState<GroupItem | null>(null);
  const [expandedDepartureCards, setExpandedDepartureCards] = useState<
    Record<number, boolean>
  >({});
  const [schemaWarning, setSchemaWarning] = useState<string | null>(null);
  const [schemaSolution, setSchemaSolution] = useState<string | null>(null);
  const [schemaCode, setSchemaCode] = useState<string | null>(null);

  const loadGroups = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams();
      query.set("take", "200");
      if (search.trim()) query.set("q", search.trim());
      if (typeFilter !== "ALL") query.set("type", typeFilter);

      const data = await requestGroupApi<{
        items?: GroupItem[];
        code?: string;
        warning?: string;
        solution?: string;
      }>(
        `/api/groups?${query.toString()}`,
        {
          credentials: "include",
          cache: "no-store",
        },
        "No pudimos cargar las grupales.",
      );
      setGroups(Array.isArray(data.items) ? data.items : []);
      if (data.code === "GROUP_SCHEMA_UNAVAILABLE") {
        setSchemaWarning(
          data.warning ??
            "La estructura de grupales todavía no está disponible en esta base.",
        );
        setSchemaSolution(data.solution ?? null);
        setSchemaCode("GROUP_SCHEMA_UNAVAILABLE");
        setShowCreateForm(false);
      } else if (data.code === "GROUP_BOOKING_LINK_PARTIAL") {
        setSchemaWarning(
          data.warning ?? "Algunas métricas de contexto aún no están completas.",
        );
        setSchemaSolution(
          data.solution ??
            "Podés crear y gestionar grupales. Aplicá las migraciones pendientes para completar el contexto.",
        );
        setSchemaCode("GROUP_BOOKING_LINK_PARTIAL");
      } else {
        setSchemaWarning(null);
        setSchemaSolution(null);
        setSchemaCode(null);
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "No pudimos cargar las grupales.";
      setError(message);
      toast.error(message);
      setGroups([]);
      setSchemaWarning(null);
      setSchemaSolution(null);
      setSchemaCode(null);
    } finally {
      setLoading(false);
    }
  }, [search, typeFilter]);

  useEffect(() => {
    void loadGroups();
  }, [loadGroups]);

  const sortedGroups = useMemo(() => {
    return [...groups].sort((a, b) => b.id_travel_group - a.id_travel_group);
  }, [groups]);
  const createDisabled =
    saving || loading || schemaCode === "GROUP_SCHEMA_UNAVAILABLE";

  function resetGroupForm() {
    setName("");
    setStatus("BORRADOR");
    setDepartureMode("UNICA");
    setCapacityMode("TOTAL");
    setCapacityTotal("");
    setDepartureName("");
    setDepartureDate("");
    setDepartureReturnDate("");
    setShowDepartureDraft(false);
    setShowAdvancedCreate(false);
  }

  function startEditGroup(group: GroupItem) {
    setEditingGroup(group);
    setName(group.name || "");
    setStatus(group.status || "BORRADOR");
    setCapacityMode(group.capacity_mode === "SERVICIO" ? "SERVICIO" : "TOTAL");
    setCapacityTotal(
      typeof group.capacity_total === "number"
        ? String(group.capacity_total)
        : "",
    );
    const normalizedSaleMode = String(group.sale_mode || "").toUpperCase();
    if (normalizedSaleMode === "MULTIPLE" || group._count.departures > 1) {
      setDepartureMode("MULTIPLE");
    } else {
      setDepartureMode("UNICA");
    }
    setDepartureName("");
    setDepartureDate("");
    setDepartureReturnDate("");
    setShowDepartureDraft(false);
    setShowAdvancedCreate(true);
    setShowCreateForm(true);
    if (typeof window !== "undefined") {
      window.requestAnimationFrame(() => {
        const formPanel = document.getElementById("group-form-panel");
        formPanel?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  }

  function stopEditGroup() {
    setEditingGroup(null);
    resetGroupForm();
  }

  async function handleDeleteGroup(group: GroupItem) {
    const ref = formatGroupReference(group);
    const confirmText =
      "Solo se puede eliminar si está en borrador y sin pasajeros/servicios asociados.";
    const accepted =
      typeof window === "undefined"
        ? false
        : window.confirm(`¿Eliminar ${ref}?\n\n${confirmText}`);
    if (!accepted) return;

    setSaving(true);
    setError(null);
    try {
      const slug = group.public_id || String(group.id_travel_group);
      await requestGroupApi(
        `/api/groups/${encodeURIComponent(slug)}`,
        {
          method: "DELETE",
          credentials: "include",
        },
        "No pudimos eliminar la grupal.",
      );

      if (editingGroup?.id_travel_group === group.id_travel_group) {
        stopEditGroup();
        setShowCreateForm(false);
      }

      await loadGroups();
      toast.success("Grupal eliminada correctamente.");
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "No pudimos eliminar la grupal.";
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      const msg = "El nombre de la grupal es obligatorio.";
      setError(msg);
      toast.error(msg);
      return;
    }
    const rawCapacityTotal = capacityTotal.trim();
    let normalizedCapacityTotal: number | null = null;
    if (rawCapacityTotal !== "") {
      const parsedCapacityTotal = Number(rawCapacityTotal.replace(",", "."));
      if (
        !Number.isFinite(parsedCapacityTotal) ||
        parsedCapacityTotal < 0 ||
        !Number.isInteger(parsedCapacityTotal)
      ) {
        const msg = "El cupo debe ser un número entero mayor o igual a 0.";
        setError(msg);
        toast.error(msg);
        return;
      }
      normalizedCapacityTotal = parsedCapacityTotal;
    }
    if (!editingGroup && departureMode === "UNICA" && !departureDate) {
      const msg =
        "Para grupales con salida única, la fecha de salida es obligatoria.";
      setError(msg);
      toast.error(msg);
      return;
    }
    if (schemaWarning && schemaCode === "GROUP_SCHEMA_UNAVAILABLE") {
      const msg = schemaSolution
        ? `${schemaWarning} ${schemaSolution}`
        : schemaWarning;
      setError(msg);
      toast.info(msg);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        name: name.trim(),
        type: "AGENCIA",
        status,
        sale_mode: departureMode,
        capacity_mode: capacityMode,
        capacity_total: normalizedCapacityTotal,
        allow_overbooking: true,
        waitlist_enabled: false,
      };

      if (!editingGroup) {
        if (departureMode === "UNICA") {
          payload.departures = [
            {
              name: name.trim(),
              status,
              departure_date: departureDate,
              return_date: departureReturnDate || null,
              capacity_total: normalizedCapacityTotal,
              allow_overbooking: true,
              waitlist_enabled: false,
            },
          ];
        } else if (departureName.trim() && departureDate) {
          payload.departures = [
            {
              name: departureName.trim(),
              departure_date: departureDate,
              return_date: departureReturnDate || null,
              capacity_total: normalizedCapacityTotal,
              allow_overbooking: true,
              waitlist_enabled: false,
            },
          ];
        }

        await requestGroupApi(
          "/api/groups",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify(payload),
          },
          "No pudimos crear la grupal.",
        );

        resetGroupForm();
        setShowCreateForm(false);
        await loadGroups();
        toast.success("Grupal creada correctamente.");
      } else {
        const slug =
          editingGroup.public_id || String(editingGroup.id_travel_group);
        await requestGroupApi(
          `/api/groups/${encodeURIComponent(slug)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify(payload),
          },
          "No pudimos actualizar la grupal.",
        );

        stopEditGroup();
        setShowCreateForm(false);
        await loadGroups();
        toast.success("Grupal actualizada correctamente.");
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : editingGroup
            ? "No pudimos actualizar la grupal."
            : "No pudimos crear la grupal.";
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  const actionIconButtonClass =
    "inline-flex size-9 items-center justify-center rounded-full border border-slate-300/80 bg-white/80 text-slate-700 transition hover:border-slate-400 hover:bg-white dark:border-slate-600 dark:bg-slate-900/60 dark:text-slate-200 dark:hover:border-slate-500";

  function renderGroupActions(group: GroupItem) {
    const slug = group.public_id || String(group.id_travel_group);
    return (
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => startEditGroup(group)}
          disabled={saving}
          className={actionIconButtonClass}
          title="Editar grupal"
          aria-label="Editar grupal"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            className="size-5"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10"
            />
          </svg>
        </button>

        <button
          type="button"
          onClick={() => void handleDeleteGroup(group)}
          disabled={saving}
          className={`${actionIconButtonClass} border-amber-300/80 text-amber-800 hover:border-amber-400 dark:border-amber-600 dark:text-amber-200`}
          title="Eliminar grupal"
          aria-label="Eliminar grupal"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            className="size-5"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
            />
          </svg>
        </button>

        <Link
          href={`/groups/${slug}`}
          className="rounded-2xl border border-sky-300/80 bg-sky-100/40 px-3 py-2 text-xs font-semibold text-sky-800 transition hover:border-sky-400 hover:bg-sky-100/60 dark:border-sky-600 dark:bg-slate-900/60 dark:text-sky-200 dark:hover:border-sky-500"
        >
          Gestionar
        </Link>
      </div>
    );
  }

  return (
    <main className="min-h-screen px-4 py-6 text-sky-950 dark:text-sky-50 sm:px-6 lg:px-8 [&_*]:!text-sky-950 dark:[&_*]:!text-sky-50">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <div className="flex flex-col gap-6">
          <section
            id="group-form-panel"
            className="rounded-3xl border border-slate-300/80 bg-white/90 p-5 shadow-sm shadow-slate-900/10 backdrop-blur-sm dark:border-slate-700/80 dark:bg-slate-900/70"
          >
            <div className="flex flex-wrap items-center justify-between gap-1">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                {editingGroup ? "Editar grupal" : "Nueva grupal"}
              </h2>
              <div className="flex items-center gap-2">
                {editingGroup ? (
                  <button
                    type="button"
                    onClick={() => {
                      stopEditGroup();
                      setShowCreateForm(false);
                    }}
                    className={pillClass(false, "amber")}
                  >
                    Cancelar edición
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setShowCreateForm((v) => !v)}
                  className={`grid size-9 place-items-center rounded-full border border-sky-500/20 bg-sky-50/50 text-sky-950 shadow-sm shadow-sky-950/10 dark:bg-sky-100/10 dark:text-sky-100`}
                  title={
                    showCreateForm ? "Ocultar formulario" : "Mostrar formulario"
                  }
                  aria-label={
                    showCreateForm ? "Ocultar formulario" : "Mostrar formulario"
                  }
                >
                  {showCreateForm ? (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="size-5"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.6}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M5 12h14"
                      />
                    </svg>
                  ) : (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="size-5"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.6}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M12 4.5v15m7.5-7.5h-15"
                      />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {schemaWarning ? (
              <p
                className={`mt-3 rounded-2xl border px-3 py-2 text-sm ${
                  schemaCode === "GROUP_SCHEMA_UNAVAILABLE"
                    ? "border-sky-300/80 bg-sky-100/80 text-sky-900 dark:border-sky-600 dark:bg-sky-900/35 dark:text-sky-100"
                    : "border-amber-300/80 bg-amber-100/85 text-amber-900 dark:border-amber-600 dark:bg-amber-900/35 dark:text-amber-100"
                }`}
              >
                {schemaWarning}
                {schemaSolution ? ` ${schemaSolution}` : ""}
              </p>
            ) : null}

            <CollapsiblePanel open={showCreateForm} className="mt-4">
              <form onSubmit={handleCreate} className="flex flex-col gap-3">
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-slate-800 dark:text-slate-200">
                    Nombre
                  </span>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={createDisabled}
                    className="rounded-xl border border-slate-300/90 bg-white/95 px-3 py-2 text-slate-900 outline-none transition focus:border-slate-500 disabled:cursor-not-allowed disabled:opacity-70 dark:border-slate-600 dark:bg-slate-900/70 dark:text-slate-100 dark:focus:border-slate-400"
                    placeholder="Egresados 2027 / Cupo México"
                    required
                  />
                </label>

                <div className="flex flex-col gap-1 text-sm">
                  <span className="text-slate-800 dark:text-slate-200">
                    Salidas
                  </span>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setDepartureMode("UNICA")}
                      disabled={createDisabled}
                      className={pillClass(departureMode === "UNICA", "sky")}
                    >
                      Salida única
                    </button>
                    <button
                      type="button"
                      onClick={() => setDepartureMode("MULTIPLE")}
                      disabled={createDisabled}
                      className={pillClass(
                        departureMode === "MULTIPLE",
                        "emerald",
                      )}
                    >
                      Múltiples salidas
                    </button>
                  </div>
                  {editingGroup ? (
                    <p className="text-xs text-slate-600 dark:text-slate-400">
                      Las fechas se gestionan en la sección de salidas dentro de
                      cada grupal.
                    </p>
                  ) : departureMode === "UNICA" ? (
                    <p className="text-xs text-slate-600 dark:text-slate-400">
                      Completá la fecha de salida principal.
                    </p>
                  ) : (
                    <p className="text-xs text-slate-600 dark:text-slate-400">
                      Las fechas operativas se cargan por salida.
                    </p>
                  )}
                </div>

                <div>
                  <button
                    type="button"
                    onClick={() => setShowAdvancedCreate((v) => !v)}
                    disabled={createDisabled}
                    className={pillClass(showAdvancedCreate, "emerald")}
                  >
                    {showAdvancedCreate
                      ? "Ocultar opciones avanzadas"
                      : "Mostrar opciones avanzadas"}
                  </button>
                </div>

                <CollapsiblePanel
                  open={showAdvancedCreate}
                  className="flex flex-col gap-3"
                >
                  <div className="flex flex-col gap-1 text-sm">
                    <span className="text-slate-800 dark:text-slate-200">
                      Modo de cupo
                    </span>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setCapacityMode("TOTAL")}
                        disabled={createDisabled}
                        className={pillClass(capacityMode === "TOTAL", "sky")}
                      >
                        Cupo por salida
                      </button>
                      <button
                        type="button"
                        onClick={() => setCapacityMode("SERVICIO")}
                        disabled={createDisabled}
                        className={pillClass(
                          capacityMode === "SERVICIO",
                          "sky",
                        )}
                      >
                        Cupo por servicio
                      </button>
                    </div>
                  </div>

                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-slate-800 dark:text-slate-200">
                      Cupo total por salida
                    </span>
                    <input
                      value={capacityTotal}
                      onChange={(e) => setCapacityTotal(e.target.value)}
                      inputMode="numeric"
                      disabled={createDisabled}
                      className="rounded-xl border border-slate-300/90 bg-white/95 px-3 py-2 text-slate-900 outline-none transition focus:border-slate-500 disabled:cursor-not-allowed disabled:opacity-70 dark:border-slate-600 dark:bg-slate-900/70 dark:text-slate-100 dark:focus:border-slate-400"
                      placeholder="20"
                    />
                    <span className="text-xs text-slate-600 dark:text-slate-400">
                      Este cupo se aplica en cada salida. La grupal no usa cupo
                      global.
                    </span>
                  </label>
                </CollapsiblePanel>

                {!editingGroup && departureMode === "UNICA" ? (
                  <div className="rounded-2xl border border-slate-300/80 bg-slate-100/70 p-3 dark:border-slate-700 dark:bg-slate-800/60">
                    <p className="text-xs font-semibold uppercase tracking-wide text-sky-800 dark:text-sky-100">
                      Salida principal
                    </p>
                    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <label className="flex flex-col gap-1 text-xs text-slate-700 dark:text-slate-300">
                        Fecha de salida
                        <input
                          type="date"
                          value={departureDate}
                          onChange={(e) => setDepartureDate(e.target.value)}
                          disabled={createDisabled}
                          className="rounded-xl border border-slate-300/90 bg-white/95 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-500 disabled:cursor-not-allowed disabled:opacity-70 dark:border-slate-600 dark:bg-slate-900/70 dark:text-slate-100 dark:focus:border-slate-400"
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-xs text-slate-700 dark:text-slate-300">
                        Fecha de regreso
                        <input
                          type="date"
                          value={departureReturnDate}
                          onChange={(e) =>
                            setDepartureReturnDate(e.target.value)
                          }
                          disabled={createDisabled}
                          className="rounded-xl border border-slate-300/90 bg-white/95 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-500 disabled:cursor-not-allowed disabled:opacity-70 dark:border-slate-600 dark:bg-slate-900/70 dark:text-slate-100 dark:focus:border-slate-400"
                        />
                      </label>
                    </div>
                  </div>
                ) : null}

                {!editingGroup && departureMode === "MULTIPLE" ? (
                  <div>
                    <button
                      type="button"
                      onClick={() => setShowDepartureDraft((v) => !v)}
                      disabled={createDisabled}
                      className={pillClass(showDepartureDraft, "sky")}
                    >
                      {showDepartureDraft
                        ? "Ocultar salida inicial"
                        : "Agregar salida inicial"}
                    </button>
                  </div>
                ) : null}

                <CollapsiblePanel
                  open={
                    !editingGroup &&
                    departureMode === "MULTIPLE" &&
                    showDepartureDraft
                  }
                  className="mt-1"
                >
                  <div className="rounded-2xl border border-slate-300/80 bg-slate-100/70 p-3 dark:border-slate-700 dark:bg-slate-800/60">
                    <p className="text-xs font-semibold uppercase tracking-wide text-sky-800 dark:text-sky-100">
                      Salida inicial (opcional)
                    </p>
                    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <input
                        value={departureName}
                        onChange={(e) => setDepartureName(e.target.value)}
                        disabled={createDisabled}
                        className="rounded-xl border border-slate-300/90 bg-white/95 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-500 disabled:cursor-not-allowed disabled:opacity-70 dark:border-slate-600 dark:bg-slate-900/70 dark:text-slate-100 dark:focus:border-slate-400"
                        placeholder="Lote 1"
                      />
                      <input
                        type="date"
                        value={departureDate}
                        onChange={(e) => setDepartureDate(e.target.value)}
                        disabled={createDisabled}
                        className="rounded-xl border border-slate-300/90 bg-white/95 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-500 disabled:cursor-not-allowed disabled:opacity-70 dark:border-slate-600 dark:bg-slate-900/70 dark:text-slate-100 dark:focus:border-slate-400"
                      />
                      <input
                        type="date"
                        value={departureReturnDate}
                        onChange={(e) => setDepartureReturnDate(e.target.value)}
                        disabled={createDisabled}
                        className="rounded-xl border border-slate-300/90 bg-white/95 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-500 disabled:cursor-not-allowed disabled:opacity-70 dark:border-slate-600 dark:bg-slate-900/70 dark:text-slate-100 dark:focus:border-slate-400"
                      />
                    </div>
                  </div>
                </CollapsiblePanel>

                <button
                  type="submit"
                  disabled={createDisabled}
                  className="mt-1 rounded-full border border-sky-400 bg-sky-50/80 px-4 py-2 text-sm font-semibold text-sky-900 transition hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-sky-500 dark:bg-slate-800/75 dark:text-sky-100 dark:hover:bg-slate-800"
                >
                  {saving ? (
                    <Spinner
                      label={editingGroup ? "Guardando..." : "Creando..."}
                    />
                  ) : editingGroup ? (
                    "Guardar cambios"
                  ) : (
                    "Crear grupal"
                  )}
                </button>
              </form>
            </CollapsiblePanel>

            {!showCreateForm ? (
              <p className="text-sm text-slate-700 dark:text-slate-300">
                Desplegá el formulario para crear una nueva grupal.
              </p>
            ) : null}

            {error ? (
              <p className="mt-3 rounded-xl border border-amber-300/80 bg-amber-100/90 px-3 py-2 text-sm text-amber-900 dark:border-amber-600 dark:bg-amber-900/30 dark:text-amber-200">
                {error}
              </p>
            ) : null}
          </section>

          <section className="flex flex-col gap-4 text-sky-950 dark:text-white">
            <div className="my-1 flex flex-wrap items-center justify-between gap-4">
              <h2 className="flex items-center gap-2 text-2xl font-semibold">
                Listado de grupales
                <span
                  className={`${RESULT_PILL_BASE} ${
                    sortedGroups.length > 0 ? RESULT_PILL_OK : RESULT_PILL_WARN
                  }`}
                  title="Resultados actuales"
                >
                  {sortedGroups.length}{" "}
                  {sortedGroups.length === 1 ? "resultado" : "resultados"}
                </span>
              </h2>

              <div className="flex items-center gap-1 rounded-full border border-white/10 bg-white/5 p-1 text-xs dark:border-white/5 dark:bg-white/5">
                <button
                  type="button"
                  onClick={() => setViewMode("GRID")}
                  className={`flex items-center justify-center gap-1 rounded-full px-4 py-1.5 text-sm transition-colors ${
                    viewMode === "GRID"
                      ? "bg-emerald-500/15 text-emerald-700 shadow-sm shadow-emerald-900/20 dark:text-emerald-300"
                      : "text-emerald-900/70 hover:text-emerald-900 dark:text-emerald-100"
                  }`}
                  aria-pressed={viewMode === "GRID"}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.5}
                    stroke="currentColor"
                    className="size-4"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z"
                    />
                  </svg>
                  Grilla
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("LIST")}
                  className={`flex items-center justify-center gap-1 rounded-full px-4 py-1.5 text-sm transition-colors ${
                    viewMode === "LIST"
                      ? "bg-emerald-500/15 text-emerald-700 shadow-sm shadow-emerald-900/20 dark:text-emerald-300"
                      : "text-emerald-900/70 hover:text-emerald-900 dark:text-emerald-100"
                  }`}
                  aria-pressed={viewMode === "LIST"}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.5}
                    stroke="currentColor"
                    className="size-4"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0ZM3.75 12h.007v.008H3.75V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm-.375 5.25h.007v.008H3.75v-.008Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z"
                    />
                  </svg>
                  Lista
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("TABLE")}
                  className={`flex items-center justify-center gap-1 rounded-full px-4 py-1.5 text-sm transition-colors ${
                    viewMode === "TABLE"
                      ? "bg-emerald-500/15 text-emerald-700 shadow-sm shadow-emerald-900/20 dark:text-emerald-300"
                      : "text-emerald-900/70 hover:text-emerald-900 dark:text-emerald-100"
                  }`}
                  aria-pressed={viewMode === "TABLE"}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.5}
                    stroke="currentColor"
                    className="size-4"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M3.75 5.25h16.5M3.75 9.75h16.5M3.75 14.25h16.5M3.75 18.75h16.5"
                    />
                  </svg>
                  Tabla
                </button>
              </div>
            </div>

            <p className="text-sm text-slate-700 dark:text-slate-300">
              Entrá a cada grupal para gestionar pasajeros y operaciones
              masivas.
            </p>

            <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center">
              <div className="flex w-full items-center gap-2 rounded-2xl border border-sky-200 bg-white/50 px-4 py-1 text-sky-950 shadow-sm shadow-sky-950/10 backdrop-blur dark:border-sky-200/60 dark:bg-sky-100/10 dark:text-white">
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full bg-transparent py-1 outline-none placeholder:font-light placeholder:tracking-wide"
                  placeholder="Buscar por nombre o código..."
                />
                <button
                  type="button"
                  aria-label="Buscar"
                  onClick={() => void loadGroups()}
                  className="p-1 opacity-80 hover:opacity-100"
                  title="Buscar"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.5}
                    stroke="currentColor"
                    className="size-6"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
                    />
                  </svg>
                </button>
              </div>

              <button
                type="button"
                onClick={() => setShowFilters((v) => !v)}
                className="flex items-center justify-center gap-2 rounded-2xl border border-sky-300/70 bg-sky-50/35 px-6 py-2 text-sky-950 shadow-sm shadow-sky-900/10 backdrop-blur transition hover:border-sky-400 hover:bg-sky-100/50 dark:border-sky-500/60 dark:bg-sky-900/20 dark:text-sky-100 dark:hover:bg-sky-900/30"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.4}
                  stroke="currentColor"
                  className="size-5"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-9.75 0h9.75"
                  />
                </svg>
                <span>{showFilters ? "Ocultar" : "Filtros"}</span>
              </button>

              <button
                type="button"
                onClick={() => void loadGroups()}
                disabled={loading}
                className="inline-flex size-10 items-center justify-center rounded-2xl border border-sky-300/70 bg-sky-50/35 px-2 text-sky-950 shadow-sm shadow-sky-900/10 backdrop-blur transition hover:border-sky-400 hover:bg-sky-100/50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-sky-500/60 dark:bg-sky-900/20 dark:text-sky-100 dark:hover:bg-sky-900/30"
                title="Refrescar"
                aria-label="Refrescar"
              >
                {loading ? (
                  <span className="size-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700 dark:border-slate-600 dark:border-t-slate-200" />
                ) : (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.5}
                    stroke="currentColor"
                    className="size-6"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"
                    />
                  </svg>
                )}
              </button>
            </div>

            <CollapsiblePanel open={showFilters}>
              <div className="overflow-hidden rounded-3xl border border-white/10 bg-white/10 p-4 text-sky-950 shadow-sm shadow-sky-950/10 backdrop-blur dark:bg-white/5 dark:text-white">
                <div className="grid grid-cols-1 gap-3">
                  <div>
                    <label className="mb-1 block text-sm font-medium">
                      Tipo
                    </label>
                    <select
                      value={typeFilter}
                      onChange={(e) =>
                        setTypeFilter(e.target.value as "ALL" | GroupType)
                      }
                      className="w-full cursor-pointer appearance-none rounded-2xl border border-sky-200 bg-white/50 p-2 px-3 text-sm shadow-sm shadow-sky-950/10 outline-none backdrop-blur dark:border-sky-200/60 dark:bg-sky-100/10 dark:text-white"
                    >
                      <option value="ALL">Todos los tipos</option>
                      {TYPE_OPTIONS.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            </CollapsiblePanel>

            <div className="mt-2">
              {loading ? (
                <p className="text-sm text-slate-700 dark:text-slate-300">
                  Cargando grupales...
                </p>
              ) : sortedGroups.length === 0 ? (
                <p className="text-sm text-slate-700 dark:text-slate-300">
                  No hay grupales cargadas.
                </p>
              ) : viewMode === "TABLE" ? (
                <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white/10 shadow-sm shadow-sky-950/10 backdrop-blur dark:bg-white/5">
                  <table className="min-w-full text-left text-sm">
                    <thead className="border-b border-white/10 text-xs uppercase tracking-[0.08em] text-sky-900/80 dark:text-sky-100/80">
                      <tr>
                        <th className="p-3">Grupal</th>
                        <th className="p-3">Código</th>
                        <th className="p-3">Tipo</th>
                        <th className="p-3">Salidas</th>
                        <th className="p-3">Pasajeros</th>
                        <th className="p-3">Acción</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedGroups.map((group) => {
                        return (
                          <tr
                            key={group.id_travel_group}
                            className="border-b border-white/10"
                          >
                            <td className="p-3 font-semibold">{group.name}</td>
                            <td className="p-3 text-xs text-sky-900/80 dark:text-sky-100/80">
                              {formatGroupReference(group)}
                            </td>
                            <td className="p-3 text-xs">
                              {formatGroupType(group.type)}
                            </td>
                            <td className="p-3 text-xs">
                              {group._count.departures}
                            </td>
                            <td className="p-3 text-xs">
                              {group._count.passengers}
                            </td>
                            <td className="p-3">{renderGroupActions(group)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : viewMode === "GRID" ? (
                <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
                  {sortedGroups.map((group) => {
                    const multipleDepartures = isMultipleDepartureGroup(group);
                    const departureSummary = buildDepartureSummary(group);
                    const departureExpanded = Boolean(
                      expandedDepartureCards[group.id_travel_group],
                    );
                    return (
                      <article
                        key={group.id_travel_group}
                        className="dark:bg-sky/5 rounded-2xl border border-sky-200/80 bg-sky-50/10 p-4 text-sky-950 shadow-sm shadow-sky-950/10 backdrop-blur dark:text-sky-100"
                      >
                        <div className="flex justify-between">
                          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-900/80 dark:text-sky-100/80">
                            {formatGroupReference(group)}
                          </p>
                          <span className="rounded-full border border-sky-100/10 bg-sky-50/15 px-2 py-0.5 text-[11px] font-semibold dark:bg-sky-100/10">
                            Pasajeros: {group._count.passengers}
                          </span>
                        </div>
                        <p className="mt-2 line-clamp-2 text-xl font-semibold leading-tight">
                          {group.name}
                        </p>
                        <p className="mt-4 text-xs text-sky-900/85 dark:text-sky-100/85">
                          Cupo base por salida: {group.capacity_total ?? "-"}
                        </p>
                        <CollapsiblePanel
                          open={multipleDepartures && departureExpanded}
                          className="mt-4"
                        >
                          <div className="rounded-2xl border border-sky-200/60 bg-sky-50/35 px-3 py-2 dark:border-sky-600/40 dark:bg-sky-900/20">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-sky-900/75 dark:text-sky-100/80">
                              Fechas por salida
                            </p>
                            <p className="mt-1 text-sm font-semibold text-sky-900 dark:text-sky-100">
                              {departureSummary.title}
                            </p>
                            <p className="mt-0.5 text-xs text-sky-900/75 dark:text-sky-100/75">
                              {departureSummary.note}
                            </p>
                          </div>
                        </CollapsiblePanel>
                        <div className="mt-4 flex min-h-9 items-center justify-between gap-2">
                          {multipleDepartures ? (
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedDepartureCards((prev) => ({
                                  ...prev,
                                  [group.id_travel_group]:
                                    !prev[group.id_travel_group],
                                }))
                              }
                              className="inline-flex items-center gap-1 text-xs font-semibold text-sky-900/85 transition hover:text-sky-900 dark:text-sky-100/85 dark:hover:text-sky-100"
                              aria-expanded={departureExpanded}
                            >
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                fill="none"
                                viewBox="0 0 24 24"
                                strokeWidth={1.8}
                                stroke="currentColor"
                                className={`size-4 transition-transform ${
                                  departureExpanded ? "rotate-90" : ""
                                }`}
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  d="m9 6 6 6-6 6"
                                />
                              </svg>
                              {departureExpanded
                                ? "Ocultar fechas"
                                : "Ver fechas"}
                            </button>
                          ) : (
                            <span aria-hidden="true" />
                          )}
                          {renderGroupActions(group)}
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="space-y-3">
                  {sortedGroups.map((group) => {
                    const multipleDepartures = isMultipleDepartureGroup(group);
                    const departureSummary = buildDepartureSummary(group);
                    const departureExpanded = Boolean(
                      expandedDepartureCards[group.id_travel_group],
                    );
                    return (
                      <article
                        key={group.id_travel_group}
                        className="rounded-2xl border border-white/10 bg-white/10 p-4 text-sky-950 shadow-sm shadow-sky-950/10 backdrop-blur dark:bg-white/5 dark:text-white"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-900/80 dark:text-sky-100/80">
                              {formatGroupReference(group)}
                            </p>
                            <p className="mt-1 truncate text-lg font-semibold">
                              {group.name}
                            </p>
                          </div>

                          <div className="flex items-center gap-2">
                            <span className="rounded-full border border-white/10 bg-white/15 px-2 py-0.5 text-[11px] font-semibold dark:bg-white/10">
                              Pasajeros: {group._count.passengers}
                            </span>
                          </div>
                        </div>

                        <div className="mt-3 flex min-h-9 items-center justify-between gap-2">
                          {multipleDepartures ? (
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedDepartureCards((prev) => ({
                                  ...prev,
                                  [group.id_travel_group]:
                                    !prev[group.id_travel_group],
                                }))
                              }
                              className="inline-flex items-center gap-1 text-xs font-semibold text-sky-900/85 transition hover:text-sky-900 dark:text-sky-100/85 dark:hover:text-sky-100"
                              aria-expanded={departureExpanded}
                            >
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                fill="none"
                                viewBox="0 0 24 24"
                                strokeWidth={1.8}
                                stroke="currentColor"
                                className={`size-4 transition-transform ${
                                  departureExpanded ? "rotate-90" : ""
                                }`}
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  d="m9 6 6 6-6 6"
                                />
                              </svg>
                              {departureExpanded
                                ? "Ocultar fechas"
                                : "Ver fechas"}
                            </button>
                          ) : (
                            <span aria-hidden="true" />
                          )}
                          {renderGroupActions(group)}
                        </div>

                        <CollapsiblePanel
                          open={multipleDepartures && departureExpanded}
                          className="mt-1"
                        >
                          <div className="rounded-2xl border border-sky-200/60 bg-sky-50/35 px-3 py-2 dark:border-sky-600/40 dark:bg-sky-900/20">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-sky-900/75 dark:text-sky-100/80">
                              Fechas por salida
                            </p>
                            <p className="mt-1 text-sm font-semibold text-sky-900 dark:text-sky-100">
                              {departureSummary.title}
                            </p>
                            <p className="mt-0.5 text-xs text-sky-900/75 dark:text-sky-100/75">
                              {departureSummary.note}
                            </p>
                          </div>
                        </CollapsiblePanel>

                        <p className="mt-3 text-xs text-sky-900/85 dark:text-sky-100/85">
                          Cupo base por salida: {group.capacity_total ?? "-"}
                        </p>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
      <ToastContainer position="top-right" autoClose={3200} />
    </main>
  );
}
