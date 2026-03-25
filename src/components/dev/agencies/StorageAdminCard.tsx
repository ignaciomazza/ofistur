"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";
import { useAuth } from "@/context/AuthContext";
import { authFetch } from "@/utils/authFetch";
import { STORAGE_BASE_GB, TRANSFER_BASE_GB } from "@/lib/storage/constants";

type StorageConfig = {
  id_config?: number;
  id_agency: number;
  enabled: boolean;
  scope: "agency" | "group";
  storage_pack_count: number;
  transfer_pack_count: number;
  notes?: string | null;
};

type StorageResponse = {
  agency: {
    id_agency: number;
    name: string;
    legal_name: string;
    billing_owner_agency_id: number | null;
  };
  owner: {
    id_agency: number;
    name: string;
    legal_name: string;
    is_owner: boolean;
  } | null;
  local_config?: StorageConfig | null;
  owner_config?: StorageConfig | null;
};

type Props = { agencyId: number };

export default function StorageAdminCard({ agencyId }: Props) {
  const { token } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [forbidden, setForbidden] = useState(false);

  const [agencyLabel, setAgencyLabel] = useState<string>("");
  const [ownerLabel, setOwnerLabel] = useState<string>("");
  const [isOwner, setIsOwner] = useState(true);
  const [localConfig, setLocalConfig] = useState<StorageConfig | null>(null);
  const [ownerConfig, setOwnerConfig] = useState<StorageConfig | null>(null);

  const [scope, setScope] = useState<"agency" | "group">("agency");
  const [form, setForm] = useState({
    enabled: false,
    storage_pack_count: 1,
    transfer_pack_count: 1,
    notes: "",
  });

  const totalStorageGb = useMemo(
    () => form.storage_pack_count * STORAGE_BASE_GB,
    [form.storage_pack_count],
  );
  const totalTransferGb = useMemo(
    () => form.transfer_pack_count * TRANSFER_BASE_GB,
    [form.transfer_pack_count],
  );

  const loadConfig = useCallback(
    async (signal?: AbortSignal) => {
      if (!token) return;
      setLoading(true);
      try {
        const res = await authFetch(
          `/api/dev/agencies/${agencyId}/storage`,
          { signal },
          token,
        );
        if (res.status === 403) {
          setForbidden(true);
          return;
        }
        if (!res.ok) throw new Error("No se pudo cargar storage");

        const data = (await res.json()) as StorageResponse;
        setAgencyLabel(
          `${data.agency.name} (${data.agency.legal_name})`.trim(),
        );
        setOwnerLabel(
          data.owner
            ? `${data.owner.name} (${data.owner.legal_name})`.trim()
            : "",
        );
        setIsOwner(Boolean(data.owner?.is_owner));
        setLocalConfig(data.local_config ?? null);
        setOwnerConfig(data.owner_config ?? null);

        const initialScope =
          data.local_config?.scope ??
          data.owner_config?.scope ??
          "agency";
        setScope(initialScope);

        const seed =
          initialScope === "group"
            ? data.owner_config
            : data.local_config;
        setForm({
          enabled: seed?.enabled ?? false,
          storage_pack_count: seed?.storage_pack_count ?? 1,
          transfer_pack_count: seed?.transfer_pack_count ?? 1,
          notes: seed?.notes ?? "",
        });
      } catch (err) {
        if ((err as DOMException).name !== "AbortError") {
          console.error("[storage-admin]", err);
          toast.error("Error cargando storage");
        }
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [agencyId, token],
  );

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    void loadConfig(controller.signal);
    return () => controller.abort();
  }, [loadConfig, token]);

  useEffect(() => {
    const seed = scope === "group" ? ownerConfig : localConfig;
    setForm({
      enabled: seed?.enabled ?? false,
      storage_pack_count: seed?.storage_pack_count ?? 1,
      transfer_pack_count: seed?.transfer_pack_count ?? 1,
      notes: seed?.notes ?? "",
    });
  }, [scope, ownerConfig, localConfig]);

  const handleChange = <K extends keyof typeof form>(
    key: K,
    value: (typeof form)[K],
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const saveConfig = async () => {
    if (!token) return;
    setSaving(true);
    try {
      const res = await authFetch(
        `/api/dev/agencies/${agencyId}/storage`,
        {
          method: "PUT",
          body: JSON.stringify({
            enabled: form.enabled,
            scope,
            storage_pack_count: form.storage_pack_count,
            transfer_pack_count: form.transfer_pack_count,
            notes: form.notes,
          }),
        },
        token,
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || "No se pudo guardar");
      }
      toast.success("Plan de storage actualizado");
      await loadConfig();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error al guardar";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const targetLabel = useMemo(() => {
    if (scope === "group") return ownerLabel || "Grupo de facturacion";
    return agencyLabel || "Agencia";
  }, [scope, ownerLabel, agencyLabel]);

  if (loading) return <div>Cargando storage...</div>;
  if (forbidden)
    return (
      <p className="text-sm text-sky-950/70 dark:text-white/70">
        No tenes permisos para editar storage.
      </p>
    );

  return (
    <div className="space-y-4 rounded-3xl border border-sky-300/30 bg-white/10 p-6 shadow-md shadow-sky-950/10 backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-medium">Plan de almacenamiento</h3>
          <p className="text-xs text-sky-950/70 dark:text-white/60">
            {scope === "group"
              ? "Aplica al grupo de facturacion"
              : "Aplica solo a esta agencia"}
          </p>
        </div>
        <span className="rounded-full border border-sky-300/40 bg-sky-100/20 px-3 py-1 text-xs text-sky-900 dark:text-sky-200">
          {targetLabel}
        </span>
      </div>

      {!isOwner && scope === "group" && (
        <p className="text-xs text-sky-900/80 dark:text-sky-200">
          La configuracion se guarda en la agencia owner del grupo.
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <label className="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => handleChange("enabled", e.target.checked)}
          />
          Plan activo
        </label>

        <div className="flex items-center gap-3 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="storage-scope"
              checked={scope === "agency"}
              onChange={() => setScope("agency")}
            />
            Agencia
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="storage-scope"
              checked={scope === "group"}
              onChange={() => setScope("group")}
            />
            Grupo
          </label>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="text-sm">
          Packs de almacenamiento
          <input
            type="number"
            min={1}
            value={form.storage_pack_count}
            onChange={(e) =>
              handleChange(
                "storage_pack_count",
                Math.max(1, Number(e.target.value || 1)),
              )
            }
            className="mt-2 w-full rounded-2xl border border-sky-300/30 bg-white/60 px-3 py-2 text-sm outline-none dark:bg-white/10"
          />
          <span className="mt-1 block text-xs text-sky-950/60 dark:text-white/60">
            {totalStorageGb} GB total
          </span>
        </label>

        <label className="text-sm">
          Packs de transferencia
          <input
            type="number"
            min={1}
            value={form.transfer_pack_count}
            onChange={(e) =>
              handleChange(
                "transfer_pack_count",
                Math.max(1, Number(e.target.value || 1)),
              )
            }
            className="mt-2 w-full rounded-2xl border border-sky-300/30 bg-white/60 px-3 py-2 text-sm outline-none dark:bg-white/10"
          />
          <span className="mt-1 block text-xs text-sky-950/60 dark:text-white/60">
            {totalTransferGb} GB/mes total
          </span>
        </label>
      </div>

      <label className="text-sm">
        Notas internas
        <textarea
          value={form.notes}
          onChange={(e) => handleChange("notes", e.target.value)}
          className="mt-2 min-h-[80px] w-full rounded-2xl border border-sky-300/30 bg-white/60 px-3 py-2 text-sm outline-none dark:bg-white/10"
        />
      </label>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-sky-950/60 dark:text-white/60">
          Base: {STORAGE_BASE_GB} GB storage · {TRANSFER_BASE_GB} GB transferencia/mes
        </p>
        <button
          type="button"
          onClick={saveConfig}
          disabled={saving}
          className="rounded-full border border-sky-300/40 bg-sky-100/20 px-6 py-2 text-xs text-sky-900 shadow-sm shadow-sky-950/10 transition-transform hover:scale-95 active:scale-90 disabled:opacity-50 dark:text-sky-200"
        >
          {saving ? "Guardando..." : "Guardar"}
        </button>
      </div>
    </div>
  );
}
