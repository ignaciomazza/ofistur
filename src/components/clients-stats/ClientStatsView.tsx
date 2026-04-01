// src/components/clients-stats/ClientStatsView.tsx
"use client";

import React from "react";
import Spinner from "@/components/Spinner";
import ExportSheetButton from "@/components/ui/ExportSheetButton";

/* ============================================
 * Tipos UI (solo para este componente)
 * ============================================ */
export type VisibleKey =
  | "id_client"
  | "full_name"
  | "phone"
  | "email"
  | "owner"
  | "dni_number"
  | "passport_number"
  | "tax_id"
  | "nationality"
  | "gender"
  | "birth_date"
  | "age"
  | "locality"
  | "registration_date";

export type ColumnDef = { key: VisibleKey; label: string; always?: boolean };

export type StatsBuckets = {
  u18: number;
  a18_25: number;
  a26_40: number;
  a41_60: number;
  g60: number;
};

export type TopPair = [string, number];
export type GenderCounts = { M: number; F: number; X: number; U: number };

export type StatsState = {
  count: number;
  recent30d: number;
  withPhoneN: number;
  withEmailN: number;
  avgAge: number | null;
  buckets: StatsBuckets;
  topOwners: TopPair[];
  topNat: TopPair[];
  topLocality: TopPair[];
  gender: GenderCounts;
};

export type SortKey =
  | "id_client"
  | "registration_date"
  | "full_name"
  | "owner"
  | "age";
export type SortDir = "asc" | "desc";

/* ============================================
 * Props
 * ============================================ */
export type ClientStatsViewProps<
  Row extends { id_client?: number } = { id_client?: number },
> = {
  title?: string;

  // KPIs & resumen
  stats: StatsState;
  statsLoading: boolean;

  // Filtros (valores + opciones)
  filters: {
    q: string;
    ownerId: number | 0;
    isVendor: boolean;
    canPickOwner: boolean;
    vendorSelfId?: number | null;
    owners: Array<[number, string]>;

    gender: "" | "M" | "F" | "X";
    hasPhone: "" | "yes" | "no";
    hasEmail: "" | "yes" | "no";

    nat: string;
    natOptions: string[];

    ageMin: string;
    ageMax: string;

    dateFrom: string;
    dateTo: string;

    filtersOpen: boolean;
  };

  // Callbacks de filtros
  onFilters: {
    toggleFiltersOpen: () => void;
    setQ: (s: string) => void;
    setOwnerId: (n: number) => void;
    setGender: (g: "" | "M" | "F" | "X") => void;
    setHasPhone: (v: "" | "yes" | "no") => void;
    setHasEmail: (v: "" | "yes" | "no") => void;
    setNat: (s: string) => void;
    setAgeMin: (s: string) => void;
    setAgeMax: (s: string) => void;
    setDateFrom: (s: string) => void;
    setDateTo: (s: string) => void;
    clearFilters: () => void;
    applyFilters: () => void;
  };

  // Columnas visibles + modal picker
  visibleColumns: ColumnDef[];
  columnPicker: {
    open: boolean;
    items: { key: VisibleKey; label: string; locked?: boolean }[];
    visibleKeys: VisibleKey[];
    onToggle: (k: VisibleKey) => void;
    onAll: () => void;
    onNone: () => void;
    onReset: () => void;
    onClose: () => void;
    onOpen: () => void;
  };

  // Tabla
  rows: Row[];
  renderCell: (colKey: VisibleKey, row: Row) => React.ReactNode;

  // Sorting
  sort: { key: SortKey; dir: SortDir };
  onToggleSort: (k: SortKey) => void;

  // Paginación
  tableLoading: boolean;
  pageInit: boolean;
  footer: {
    normalizedCount: number; // cantidad de rows normalizados cargados (para el texto del footer)
    canLoadMore: boolean;
    onLoadMore: () => void;
  };

  // Acciones
  onDownloadCSV: () => void;
  csvLoading: boolean;
};

/* ============================================
 * Tokens de estilo
 * ============================================ */
const GLASS =
  "rounded-3xl border border-white/30 bg-white/10 backdrop-blur shadow-lg shadow-sky-900/10 dark:bg-white/10 dark:border-white/5";
const CHIP =
  "inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/10 backdrop-blur px-3 py-1.5 text-sm shadow-sm shadow-sky-900/5 dark:bg-white/10 dark:border-white/10";
const ICON_BTN =
  "rounded-3xl bg-sky-600/30 px-3 py-1.5 text-sm text-sky-950/80 hover:text-sky-950 dark:text-white shadow-sm shadow-sky-900/10 hover:bg-sky-600/30 border border-sky-600/30 active:scale-[.99] transition";
const PRIMARY_BTN =
  "rounded-3xl bg-sky-600/30 px-3 py-1.5 text-sm text-sky-950/80 hover:text-sky-950 dark:text-white shadow-sm shadow-sky-900/10 hover:bg-sky-600/30 border border-sky-600/30 active:scale-[.99] transition";

/* ============================================
 * Componente principal (UI pura)
 * ============================================ */
export default function ClientStatsView<
  Row extends { id_client?: number } = { id_client?: number },
>({
  title = "Client Stats",
  stats,
  statsLoading,
  filters,
  onFilters,
  visibleColumns,
  columnPicker,
  rows,
  renderCell,
  sort,
  onToggleSort,
  tableLoading,
  pageInit,
  footer,
  onDownloadCSV,
  csvLoading,
}: ClientStatsViewProps<Row>) {
  return (
    <div>
      {/* Header + KPIs */}
      <div className="mb-8 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-white">
          {title}
        </h1>

        <div className="flex flex-wrap gap-2">
          <ChipKPI label="Total" value={stats.count} loading={statsLoading} />
          <ChipKPI
            label="Últimos 30 días"
            value={stats.recent30d}
            loading={statsLoading}
          />
          <ChipKPI
            label="Con teléfono"
            value={stats.withPhoneN}
            loading={statsLoading}
          />
          <ChipKPI
            label="Con email"
            value={stats.withEmailN}
            loading={statsLoading}
          />
          <ChipKPI
            label="Edad prom."
            value={stats.avgAge ?? "—"}
            loading={statsLoading}
          />
        </div>
      </div>

      {/* Barra superior de acciones */}
      <div className="mb-8 flex flex-wrap items-center gap-2">
        <button onClick={onFilters.toggleFiltersOpen} className={ICON_BTN}>
          {filters.filtersOpen ? "Ocultar filtros" : "Mostrar filtros"}
        </button>

        <button onClick={columnPicker.onOpen} className={ICON_BTN}>
          Columnas
        </button>

        <ExportSheetButton
          onClick={onDownloadCSV}
          loading={csvLoading}
          disabled={csvLoading}
        />
      </div>

      {/* Panel de filtros */}
      {filters.filtersOpen && (
        <div className={`${GLASS} mb-8 p-4`}>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
            {/* q */}
            <div className="md:col-span-4">
              <Label>Buscar</Label>
              <Input
                value={filters.q}
                onChange={(e) => onFilters.setQ(e.target.value)}
                placeholder="Nombre, DNI, email, empresa..."
              />
            </div>

            {/* dueño */}
            <div className="md:col-span-3">
              <Label>Vendedor</Label>
              <select
                value={filters.ownerId}
                onChange={(e) => onFilters.setOwnerId(Number(e.target.value))}
                disabled={!filters.canPickOwner && filters.isVendor}
                className="w-full cursor-pointer appearance-none rounded-3xl border border-white/30 bg-white/10 px-3 py-2 outline-none backdrop-blur dark:border-white/10 dark:bg-white/10"
              >
                {!filters.isVendor && <option value={0}>Todos</option>}
                {filters.isVendor && filters.vendorSelfId && (
                  <option value={filters.vendorSelfId}>Mis pasajeros</option>
                )}
                {(!filters.isVendor || filters.canPickOwner) &&
                  filters.owners.map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
              </select>
            </div>

            {/* género */}
            <div className="md:col-span-2">
              <Label>Género</Label>
              <select
                value={filters.gender}
                onChange={(e) =>
                  onFilters.setGender(e.target.value as "M" | "F" | "X" | "")
                }
                className="w-full cursor-pointer appearance-none rounded-3xl border border-white/30 bg-white/10 px-3 py-2 outline-none backdrop-blur dark:border-white/10 dark:bg-white/10"
              >
                <option value="">Todos</option>
                <option value="M">Masculino</option>
                <option value="F">Femenino</option>
                <option value="X">Otro/No binario</option>
              </select>
            </div>

            {/* tel / email */}
            <div className="grid grid-cols-2 gap-3 md:col-span-3">
              <div>
                <Label>Teléfono</Label>
                <select
                  value={filters.hasPhone}
                  onChange={(e) =>
                    onFilters.setHasPhone(e.target.value as "" | "yes" | "no")
                  }
                  className="w-full cursor-pointer appearance-none rounded-3xl border border-white/30 bg-white/10 px-3 py-2 outline-none backdrop-blur dark:border-white/10 dark:bg-white/10"
                >
                  <option value="">Todos</option>
                  <option value="yes">Con teléfono</option>
                  <option value="no">Sin teléfono</option>
                </select>
              </div>
              <div>
                <Label>Email</Label>
                <select
                  value={filters.hasEmail}
                  onChange={(e) =>
                    onFilters.setHasEmail(e.target.value as "" | "yes" | "no")
                  }
                  className="w-full cursor-pointer appearance-none rounded-3xl border border-white/30 bg-white/10 px-3 py-2 outline-none backdrop-blur dark:border-white/10 dark:bg-white/10"
                >
                  <option value="">Todos</option>
                  <option value="yes">Con email</option>
                  <option value="no">Sin email</option>
                </select>
              </div>
            </div>

            {/* nacionalidad */}
            <div className="md:col-span-3">
              <Label>Nacionalidad</Label>
              <Input
                list="nat-list"
                value={filters.nat}
                onChange={(e) => onFilters.setNat(e.target.value)}
                placeholder="Argentina, Uruguay..."
              />
              <datalist id="nat-list">
                {filters.natOptions.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
            </div>

            {/* edad */}
            <div className="grid grid-cols-2 gap-3 md:col-span-3">
              <div>
                <Label>Edad mín.</Label>
                <Input
                  type="number"
                  inputMode="numeric"
                  value={filters.ageMin}
                  onChange={(e) => onFilters.setAgeMin(e.target.value)}
                />
              </div>
              <div>
                <Label>Edad máx.</Label>
                <Input
                  type="number"
                  inputMode="numeric"
                  value={filters.ageMax}
                  onChange={(e) => onFilters.setAgeMax(e.target.value)}
                />
              </div>
            </div>

            {/* fechas */}
            <div className="flex gap-3">
              <div>
                <Label>Desde</Label>
                <Input
                  type="date"
                  value={filters.dateFrom}
                  onChange={(e) => onFilters.setDateFrom(e.target.value)}
                />
              </div>
              <div>
                <Label>Hasta</Label>
                <Input
                  type="date"
                  value={filters.dateTo}
                  onChange={(e) => onFilters.setDateTo(e.target.value)}
                />
              </div>
            </div>

            {/* acciones filtros */}
            <div className="flex flex-wrap items-end justify-end gap-2 md:col-span-12">
              <button onClick={onFilters.clearFilters} className={ICON_BTN}>
                Limpiar
              </button>
              <button
                onClick={onFilters.applyFilters}
                className={`${PRIMARY_BTN}`}
              >
                Aplicar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Resumen (4 columnas) */}
      <div className={`${GLASS} mb-8 p-4`}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">Resumen</h2>
          {statsLoading && <Spinner />}
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          {/* Edad buckets */}
          <div>
            <p className="mb-2 text-sm opacity-70">Distribución por edad</p>
            <div className="flex flex-wrap gap-2">
              <AgeChip label="≤17" n={stats.buckets.u18} />
              <AgeChip label="18–25" n={stats.buckets.a18_25} />
              <AgeChip label="26–40" n={stats.buckets.a26_40} />
              <AgeChip label="41–60" n={stats.buckets.a41_60} />
              <AgeChip label="60+" n={stats.buckets.g60} />
            </div>
          </div>

          {/* Top nacionalidades (solo nombre de país) */}
          <div>
            <p className="mb-2 text-sm opacity-70">Top nacionalidades</p>
            <ul className="space-y-1 text-sm">
              {stats.topNat.length === 0 && !statsLoading && (
                <li className="rounded-3xl border border-white/30 bg-white/10 px-3 py-2 opacity-70 backdrop-blur dark:border-white/10 dark:bg-white/10">
                  Sin datos
                </li>
              )}
              {stats.topNat.map(([label, n]) => (
                <li
                  key={label}
                  className="flex items-center justify-between rounded-3xl border border-white/30 bg-white/10 px-3 py-2 shadow-sm shadow-sky-900/5 backdrop-blur dark:border-white/10 dark:bg-white/10"
                >
                  <span className="truncate pr-2">{label}</span>
                  <span className="font-medium">{n}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Top localidades (ya deduplicadas/normalizadas desde la lógica) */}
          <div>
            <p className="mb-2 text-sm opacity-70">Top localidades</p>
            <ul className="space-y-1 text-sm">
              {stats.topLocality.length === 0 && !statsLoading && (
                <li className="rounded-3xl border border-white/30 bg-white/10 px-3 py-2 opacity-70 backdrop-blur dark:border-white/10 dark:bg-white/10">
                  Sin datos
                </li>
              )}
              {stats.topLocality.map(([label, n]) => (
                <li
                  key={label}
                  className="flex items-center justify-between rounded-3xl border border-white/30 bg-white/10 px-3 py-2 shadow-sm shadow-sky-900/5 backdrop-blur dark:border-white/10 dark:bg-white/10"
                >
                  <span className="truncate pr-2">{label}</span>
                  <span className="font-medium">{n}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Distribución por género */}
          <div>
            <p className="mb-2 text-sm opacity-70">Distribución por género</p>
            <ul className="space-y-1 text-sm">
              <li className="flex items-center justify-between rounded-3xl border border-white/30 bg-white/10 px-3 py-2 shadow-sm shadow-sky-900/5 backdrop-blur dark:border-white/10 dark:bg-white/10">
                <span className="truncate pr-2">Masculino</span>
                <span className="font-medium">{stats.gender.M}</span>
              </li>
              <li className="flex items-center justify-between rounded-3xl border border-white/30 bg-white/10 px-3 py-2 shadow-sm shadow-sky-900/5 backdrop-blur dark:border-white/10 dark:bg-white/10">
                <span className="truncate pr-2">Femenino</span>
                <span className="font-medium">{stats.gender.F}</span>
              </li>
              <li className="flex items-center justify-between rounded-3xl border border-white/30 bg-white/10 px-3 py-2 shadow-sm shadow-sky-900/5 backdrop-blur dark:border-white/10 dark:bg-white/10">
                <span className="truncate pr-2">Otro/No binario</span>
                <span className="font-medium">{stats.gender.X}</span>
              </li>
              {stats.gender.U > 0 && (
                <li className="flex items-center justify-between rounded-3xl border border-white/30 bg-white/10 px-3 py-2 shadow-sm shadow-sky-900/5 backdrop-blur dark:border-white/10 dark:bg-white/10">
                  <span className="truncate pr-2">Sin dato</span>
                  <span className="font-medium">{stats.gender.U}</span>
                </li>
              )}
            </ul>
          </div>
        </div>
      </div>

      {/* Tabla */}
      <div className={`${GLASS} mb-8 overflow-x-auto`}>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-zinc-700 backdrop-blur dark:text-zinc-200">
              {visibleColumns.map((c) => {
                const sortable: Partial<Record<VisibleKey, SortKey>> = {
                  id_client: "id_client",
                  registration_date: "registration_date",
                  full_name: "full_name",
                  owner: "owner",
                  age: "age",
                };
                const sk = sortable[c.key];
                const isActive = sk && sort.key === sk;
                const arrow = !sk ? "" : sort.dir === "asc" ? "▲" : "▼";

                return (
                  <th key={c.key} className="p-4 text-center font-medium">
                    {sk ? (
                      <button
                        onClick={() => onToggleSort(sk)}
                        className="inline-flex items-center gap-1 underline decoration-transparent hover:decoration-sky-600"
                      >
                        {c.label} {isActive && <span>{arrow}</span>}
                      </button>
                    ) : (
                      c.label
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {rows.map((row, i) => (
              <tr
                key={(row.id_client as number | undefined) ?? i}
                className="border-t border-white/30 backdrop-blur-sm transition hover:bg-white/10 dark:border-white/10 dark:hover:bg-white/10"
              >
                {visibleColumns.map((col) => (
                  <td key={col.key} className="px-4 py-2 text-center">
                    {renderCell(col.key, row)}
                  </td>
                ))}
              </tr>
            ))}

            {tableLoading && rows.length === 0 && (
              <tr>
                <td
                  colSpan={visibleColumns.length}
                  className="px-4 py-10 text-center"
                >
                  <Spinner />
                </td>
              </tr>
            )}

            {!tableLoading && rows.length === 0 && pageInit && (
              <tr>
                <td
                  colSpan={visibleColumns.length}
                  className="px-4 py-10 text-center opacity-70"
                >
                  No hay resultados. Ajustá los filtros y probá de nuevo.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {/* Footer paginación */}
        <div className="flex w-full items-center justify-between border-t border-white/30 bg-white/10 px-3 py-2 text-xs backdrop-blur dark:border-white/10 dark:bg-white/10">
          <div className="opacity-70">
            {rows.length} filas (de {footer.normalizedCount} cargadas)
          </div>
          <button
            onClick={footer.onLoadMore}
            disabled={tableLoading || !footer.canLoadMore}
            className={`${ICON_BTN} disabled:opacity-50`}
          >
            {!footer.canLoadMore
              ? "No hay más"
              : tableLoading
                ? "Cargando..."
                : "Cargar más"}
          </button>
        </div>
      </div>

      {/* Modal columnas */}
      <ColumnPickerModal
        open={columnPicker.open}
        onClose={columnPicker.onClose}
        items={columnPicker.items}
        visibleKeys={columnPicker.visibleKeys}
        onToggle={columnPicker.onToggle}
        onAll={columnPicker.onAll}
        onNone={columnPicker.onNone}
        onReset={columnPicker.onReset}
      />
    </div>
  );
}

/* ============================================
 * Subcomponentes UI (átomos / modal)
 * ============================================ */
function ChipKPI({
  label,
  value,
  loading,
}: {
  label: string;
  value: React.ReactNode;
  loading?: boolean;
}) {
  return (
    <div className={CHIP}>
      <span className="opacity-70">{label}</span>
      <span className="font-medium">{loading ? <Spinner /> : value}</span>
    </div>
  );
}

function AgeChip({ label, n }: { label: string; n: number }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-white/30 bg-white/10 px-2 py-1 text-xs shadow-sm shadow-sky-900/5 backdrop-blur dark:border-white/10 dark:bg-white/10">
      <span className="opacity-70">{label}</span>
      <span className="font-medium">{n}</span>
    </span>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className="mb-1 block text-xs opacity-70">{children}</label>;
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`block w-full min-w-fit appearance-none rounded-2xl border border-sky-200 bg-white/50 px-4 py-2 shadow-sm shadow-sky-950/10 outline-none backdrop-blur placeholder:opacity-60 dark:border-sky-200/60 dark:bg-sky-100/10 ${props.className || ""}`}
    />
  );
}

function ColumnPickerModal({
  open,
  onClose,
  items,
  visibleKeys,
  onToggle,
  onAll,
  onNone,
  onReset,
}: {
  open: boolean;
  onClose: () => void;
  items: { key: VisibleKey; label: string; locked?: boolean }[];
  visibleKeys: VisibleKey[];
  onToggle: (k: VisibleKey) => void;
  onAll: () => void;
  onNone: () => void;
  onReset: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100]">
      <div
        className="absolute inset-0 bg-black/10 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        className={`${GLASS} absolute left-1/2 top-1/2 w-[min(92vw,560px)] -translate-x-1/2 -translate-y-1/2 p-5`}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold">Columnas</h3>
          <button onClick={onClose} className={ICON_BTN}>
            ✕
          </button>
        </div>
        <div className="max-h-72 space-y-1 overflow-auto pr-1">
          {items.map((it) => (
            <label
              key={it.key}
              className={`flex cursor-pointer items-center justify-between rounded-3xl px-2 py-1 text-sm ${it.locked ? "opacity-60" : "hover:bg-white/10 dark:hover:bg-zinc-800/50"}`}
            >
              <span>{it.label}</span>
              <input
                type="checkbox"
                checked={visibleKeys.includes(it.key)}
                onChange={() => !it.locked && onToggle(it.key)}
                disabled={it.locked}
              />
            </label>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button onClick={onAll} className={ICON_BTN}>
            Todas
          </button>
          <button onClick={onNone} className={ICON_BTN}>
            Ninguna
          </button>
          <button onClick={onReset} className={ICON_BTN}>
            Reset
          </button>
        </div>
        <div className="mt-4 flex justify-end">
          <button onClick={onClose} className={PRIMARY_BTN}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
