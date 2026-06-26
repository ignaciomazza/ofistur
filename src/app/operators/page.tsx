// src/app/operators/page.tsx
"use client";
import { useState, useEffect, useMemo } from "react";
import ProtectedRoute from "@/components/ProtectedRoute";
import OperatorForm from "@/components/operators/OperatorForm";
import OperatorList from "@/components/operators/OperatorList";
import { Operator } from "@/types";
import { motion } from "framer-motion";
import { toast, ToastContainer } from "react-toastify";
import Spinner from "@/components/Spinner";
import "react-toastify/dist/ReactToastify.css";
import { useAuth } from "@/context/AuthContext";
import { authFetch } from "@/utils/authFetch";

type BalanceFilter = "all" | "withBalance" | "credit" | "debit" | "zero";

export default function OperatorsPage() {
  const { token } = useAuth();
  const [operators, setOperators] = useState<Operator[]>([]);
  const [agencyId, setAgencyId] = useState<number | null>(null);
  const [expandedOperatorId, setExpandedOperatorId] = useState<number | null>(
    null,
  );

  const [formData, setFormData] = useState<Omit<Operator, "id_operator">>({
    name: "",
    email: "",
    phone: "",
    website: "",
    address: "",
    postal_code: "",
    city: "",
    state: "",
    country: "",
    vat_status: "",
    legal_name: "",
    tax_id: "",
    registration_date: "",
    id_agency: 0, // se inyecta desde el perfil
    credit_balance: 0,
    debit_balance: 0,
  });

  const [isFormVisible, setIsFormVisible] = useState(false);
  const [editingOperatorId, setEditingOperatorId] = useState<number | null>(
    null,
  );
  const [loadingOperators, setLoadingOperators] = useState<boolean>(true);

  const [searchTerm, setSearchTerm] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [countryFilter, setCountryFilter] = useState("all");
  const [vatFilter, setVatFilter] = useState("all");
  const [balanceFilter, setBalanceFilter] = useState<BalanceFilter>("all");

  // 1) Obtener agencyId y pre-llenar formData.id_agency
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();

    (async () => {
      try {
        const res = await authFetch(
          "/api/user/profile",
          { signal: controller.signal },
          token,
        );
        if (!res.ok) throw new Error("No se pudo obtener el perfil");
        const profile = await res.json();
        setAgencyId(profile.id_agency);
        setFormData((f) => ({ ...f, id_agency: profile.id_agency }));
      } catch (err) {
        if ((err as DOMException)?.name !== "AbortError") {
          console.error("Error fetching profile:", err);
          toast.error("Error al obtener perfil de usuario");
        }
      }
    })();

    return () => controller.abort();
  }, [token]);

  // 2) Cargar operadores filtrados por agencyId
  useEffect(() => {
    if (agencyId === null || !token) return;
    setLoadingOperators(true);
    const controller = new AbortController();

    (async () => {
      try {
        const res = await authFetch(
          `/api/operators?agencyId=${agencyId}`,
          { signal: controller.signal },
          token,
        );
        if (!res.ok) throw new Error("Error al obtener operadores");
        const data: Operator[] = await res.json();
        setOperators(data);
      } catch (error) {
        if ((error as DOMException)?.name !== "AbortError") {
          console.error("Error fetching operators:", error);
          toast.error("Error al obtener operadores");
        }
      } finally {
        if (!controller.signal.aborted) setLoadingOperators(false);
      }
    })();

    return () => controller.abort();
  }, [agencyId, token]);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      toast.error("El nombre comercial es obligatorio.");
      return;
    }

    const url = editingOperatorId
      ? `/api/operators/${editingOperatorId}`
      : "/api/operators";
    const method = editingOperatorId ? "PUT" : "POST";

    try {
      const res = await authFetch(
        url,
        {
          method,
          body: JSON.stringify(formData),
        },
        token,
      );

      if (!res.ok) {
        let msg = "Error al guardar el operador.";
        try {
          const err = await res.json();
          msg = err?.error || msg;
        } catch {}
        throw new Error(msg);
      }

      const operator: Operator = await res.json();
      setOperators((prev) =>
        editingOperatorId
          ? prev.map((op) =>
              op.id_operator === editingOperatorId ? operator : op,
            )
          : [operator, ...prev],
      );

      toast.success(
        editingOperatorId
          ? "Operador actualizado con éxito!"
          : "Operador creado con éxito!",
      );
    } catch (error) {
      if (error instanceof Error) {
        console.error("Error al guardar el operador:", error.message);
        toast.error(error.message);
      }
    } finally {
      resetForm();
    }
  };

  const resetForm = () => {
    setFormData({
      name: "",
      email: "",
      phone: "",
      website: "",
      address: "",
      postal_code: "",
      city: "",
      state: "",
      country: "",
      vat_status: "",
      legal_name: "",
      tax_id: "",
      registration_date: "",
      id_agency: agencyId!, // mantener agency actual
      credit_balance: 0,
      debit_balance: 0,
    });
    setEditingOperatorId(null);
    setIsFormVisible(false);
  };

  const startEditingOperator = (operator: Operator) => {
    setFormData({
      name: operator.name,
      email: operator.email || "",
      phone: operator.phone || "",
      website: operator.website || "",
      address: operator.address || "",
      postal_code: operator.postal_code || "",
      city: operator.city || "",
      state: operator.state || "",
      country: operator.country || "",
      vat_status: operator.vat_status || "",
      legal_name: operator.legal_name || "",
      tax_id: operator.tax_id || "",
      registration_date: operator.registration_date,
      id_agency: operator.id_agency,
      credit_balance: operator.credit_balance || 0,
      debit_balance: operator.debit_balance || 0,
    });
    setEditingOperatorId(operator.id_operator);
    setIsFormVisible(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const deleteOperator = async (id_operator: number) => {
    try {
      const res = await authFetch(
        `/api/operators/${id_operator}`,
        { method: "DELETE" },
        token,
      );
      if (!res.ok) throw new Error("Error al eliminar el operador.");
      setOperators((prev) =>
        prev.filter((op) => op.id_operator !== id_operator),
      );
      toast.success("Operador eliminado con éxito!");
    } catch (error) {
      if (error instanceof Error) {
        console.error("Error al eliminar el operador:", error.message);
        toast.error("Error al eliminar el operador.");
      }
    }
  };

  const countries = useMemo(() => {
    const values = operators
      .map((op) => (op.country || "").trim())
      .filter(Boolean);
    return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b, "es"));
  }, [operators]);

  const vatStatuses = useMemo(() => {
    const values = operators
      .map((op) => (op.vat_status || "").trim())
      .filter(Boolean);
    return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b, "es"));
  }, [operators]);

  const displayedOperators = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    let list = [...operators];

    if (term) {
      list = list.filter((op) =>
        [
          op.name,
          op.email,
          op.phone,
          op.website,
          op.legal_name,
          op.tax_id,
          op.city,
          op.country,
        ].some((field) => (field || "").toLowerCase().includes(term)),
      );
    }

    if (countryFilter !== "all") {
      list = list.filter((op) => (op.country || "").trim() === countryFilter);
    }

    if (vatFilter !== "all") {
      list = list.filter((op) => (op.vat_status || "").trim() === vatFilter);
    }

    if (balanceFilter !== "all") {
      list = list.filter((op) => {
        const credit = Number(op.credit_balance) || 0;
        const debit = Number(op.debit_balance) || 0;
        if (balanceFilter === "withBalance") return credit !== 0 || debit !== 0;
        if (balanceFilter === "credit") return credit > 0;
        if (balanceFilter === "debit") return debit > 0;
        return credit === 0 && debit === 0;
      });
    }

    return list;
  }, [operators, searchTerm, countryFilter, vatFilter, balanceFilter]);

  const pillBase = "rounded-full px-2.5 py-0.5 text-xs font-medium";
  const pillOk = "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
  const pillWarn = "bg-rose-500/15 text-rose-700 dark:text-rose-300";

  const filterVariants = {
    closed: { height: 0, opacity: 0, padding: 0, marginTop: 0 },
    open: { height: "auto", opacity: 1, padding: 24, marginTop: 16 },
  };

  const selectClass =
    "w-full cursor-pointer appearance-none rounded-2xl border border-sky-950/10 p-2 px-3 outline-none backdrop-blur placeholder:font-light placeholder:tracking-wide dark:border-white/10 dark:bg-white/10 dark:text-white";

  return (
    <ProtectedRoute>
      <section className="text-sky-950 dark:text-white">
        <motion.div layout>
          <OperatorForm
            formData={formData}
            handleChange={handleChange}
            handleSubmit={handleSubmit}
            editingOperatorId={editingOperatorId}
            isFormVisible={isFormVisible}
            setIsFormVisible={setIsFormVisible}
          />
        </motion.div>

        <div className="my-4 flex flex-wrap items-center justify-between gap-4">
          <h2 className="flex items-center gap-2 text-2xl font-semibold dark:font-medium">
            Operadores
            <span
              className={`${pillBase} ${
                displayedOperators.length > 0 ? pillOk : pillWarn
              }`}
              title="Resultados actuales"
            >
              {displayedOperators.length}{" "}
              {displayedOperators.length === 1 ? "resultado" : "resultados"}
            </span>
          </h2>

          <div className="flex items-center gap-1 rounded-full border border-white/10 bg-white/5 p-1 text-xs dark:border-white/5 dark:bg-white/5">
            <button
              onClick={() => setViewMode("grid")}
              className={`flex items-center justify-center gap-1 rounded-full px-4 py-1.5 text-sm transition-colors ${
                viewMode === "grid"
                  ? "bg-emerald-500/15 text-emerald-700 shadow-sm shadow-emerald-900/20 dark:text-emerald-300"
                  : "text-emerald-900/70 hover:text-emerald-900 dark:text-emerald-100"
              }`}
              aria-pressed={viewMode === "grid"}
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
              onClick={() => setViewMode("list")}
              className={`flex items-center justify-center gap-1 rounded-full px-4 py-1.5 text-sm transition-colors ${
                viewMode === "list"
                  ? "bg-emerald-500/15 text-emerald-700 shadow-sm shadow-emerald-900/20 dark:text-emerald-300"
                  : "text-emerald-900/70 hover:text-emerald-900 dark:text-emerald-100"
              }`}
              aria-pressed={viewMode === "list"}
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
          </div>
        </div>

        <div className="mb-4 flex flex-col gap-2">
          <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex w-full items-center gap-2 rounded-2xl border border-white/10 bg-white/10 px-4 py-1 text-sky-950 shadow-md backdrop-blur dark:border-white/10 dark:text-white">
              <input
                type="text"
                placeholder="Buscar operadores..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-transparent outline-none placeholder:font-light placeholder:tracking-wide"
              />
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                className="size-5 text-sky-900/70 dark:text-white/70"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
                />
              </svg>
            </div>

            <button
              onClick={() => setFiltersOpen((open) => !open)}
              className="flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/10 px-6 py-2 text-sky-950 shadow-md backdrop-blur dark:border-white/10 dark:text-white"
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
              <span>Filtros</span>
            </button>
          </div>

          <motion.div
            initial="closed"
            animate={filtersOpen ? "open" : "closed"}
            variants={filterVariants}
            transition={{ duration: 0.3 }}
            className="overflow-hidden rounded-3xl border border-white/10 bg-white/10 text-sky-950 shadow-md backdrop-blur dark:text-white"
          >
            <div className="grid grid-cols-1 gap-6 text-sm md:grid-cols-2 xl:grid-cols-3">
              <div>
                <label className="mb-1 block font-medium">País</label>
                <select
                  value={countryFilter}
                  onChange={(e) => setCountryFilter(e.target.value)}
                  className={selectClass}
                >
                  <option value="all">Todos</option>
                  {countries.map((country) => (
                    <option key={country} value={country}>
                      {country}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block font-medium">Condición IVA</label>
                <select
                  value={vatFilter}
                  onChange={(e) => setVatFilter(e.target.value)}
                  className={selectClass}
                >
                  <option value="all">Todas</option>
                  {vatStatuses.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block font-medium">Saldo</label>
                <select
                  value={balanceFilter}
                  onChange={(e) => setBalanceFilter(e.target.value as BalanceFilter)}
                  className={selectClass}
                >
                  <option value="all">Todos</option>
                  <option value="withBalance">Con saldo</option>
                  <option value="credit">Solo crédito</option>
                  <option value="debit">Solo débito</option>
                  <option value="zero">Sin saldo</option>
                </select>
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setSearchTerm("");
                  setCountryFilter("all");
                  setVatFilter("all");
                  setBalanceFilter("all");
                }}
                className="rounded-full border border-white/10 bg-white/10 px-4 py-2 text-xs text-sky-950 shadow-sm shadow-sky-950/10 transition hover:scale-95 dark:text-white"
              >
                Limpiar filtros
              </button>
            </div>
          </motion.div>
        </div>

        {loadingOperators ? (
          <div className="flex min-h-[50vh] items-center">
            <Spinner />
          </div>
        ) : displayedOperators.length === 0 ? (
          <div className="rounded-3xl border border-white/10 bg-white/10 p-10 text-center text-sky-950 shadow-sm shadow-sky-950/10 backdrop-blur dark:text-white">
            <p className="text-lg font-semibold">
              {operators.length === 0
                ? "Todavía no hay operadores"
                : "No encontramos resultados"}
            </p>
            <p className="mt-2 text-sm text-sky-900/70 dark:text-white/70">
              {operators.length === 0
                ? "Agregá tu primer operador para comenzar."
                : "Probá con otro término o ajustá los filtros."}
            </p>
          </div>
        ) : (
          <OperatorList
            operators={displayedOperators}
            expandedOperatorId={expandedOperatorId}
            setExpandedOperatorId={setExpandedOperatorId}
            startEditingOperator={startEditingOperator}
            deleteOperator={deleteOperator}
            viewMode={viewMode}
          />
        )}

        <ToastContainer />
      </section>
    </ProtectedRoute>
  );
}
