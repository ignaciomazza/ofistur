// src/app/bookings/page.tsx
"use client";
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import ProtectedRoute from "@/components/ProtectedRoute";
import BookingForm from "@/components/bookings/BookingForm";
import BookingList, {
  BookingViewMode,
} from "@/components/bookings/BookingList";
import FilterPanel from "@/components/bookings/FilterPanel";
import Spinner from "@/components/Spinner";
import { motion } from "framer-motion";
import { toast, ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { Booking, Service, User, SalesTeam, PassengerCategory } from "@/types";
import { useAuth } from "@/context/AuthContext";
import { authFetch } from "@/utils/authFetch";
import { rankBookingsBySimilarity } from "@/utils/bookingSearch";
import { normalizeRole } from "@/utils/permissions";
import {
  toDateKeyInBuenosAires,
  toDateKeyInBuenosAiresLegacySafe,
  todayDateKeyInBuenosAires,
} from "@/lib/buenosAiresDate";

// === Constantes / Tipos ===
const FILTROS = [
  "lider",
  "gerente",
  "administrativo",
  "desarrollador",
] as const;
type FilterRole = (typeof FILTROS)[number];

type BookingFormData = {
  id_booking?: number;
  clientStatus: string;
  operatorStatus: string;
  status: string;
  details: string;
  invoice_type: string;
  invoice_observation: string;
  observation: string;
  titular_id: number;
  id_user: number;
  id_agency: number; // lo mantengo para no romper BookingForm; el backend lo ignora
  departure_date: string;
  return_date: string;
  pax_count: number;
  clients_ids: number[];
  agency_booking_id?: number | null;
  simple_companions?: Array<{
    category_id?: number | null;
    age?: number | null;
    notes?: string | null;
  }>;
  /** fecha de creación editable por admin/gerente/dev (YYYY-MM-DD) */
  creation_date?: string;
  /** si está activo, aplica ajustes administrativos (creador/fecha) */
  use_admin_adjustments?: boolean;
};

const VIEW_MODE_STORAGE_KEY = "bookings-view-mode";

// === Pills sutiles para UI (conteo resultados) ===
const pillBase = "rounded-full px-2.5 py-0.5 text-xs font-medium";
const pillOk = "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
const pillWarn = "bg-rose-500/15 text-rose-700 dark:text-rose-300";

// === Hook simple para debouncing ===
function useDebounced<T>(value: T, delay = 350): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

// Helper para ignorar aborts de fetch
type AbortErrorLike = { name?: unknown; code?: unknown };
const isAbortError = (e: unknown): e is AbortErrorLike => {
  if (typeof e !== "object" || e === null) return false;
  const { name, code } = e as AbortErrorLike;
  return name === "AbortError" || code === "ABORT_ERR";
};

const DATE_DEBUG_QUERY_KEY = "dateDebug";
const DATE_DEBUG_STORAGE_KEY = "ofistur_debug_booking_dates";

function isBookingDateDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get(DATE_DEBUG_QUERY_KEY) === "1") return true;
    return window.localStorage.getItem(DATE_DEBUG_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function getRuntimeDateContext() {
  return {
    browserTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    browserOffsetMinutes: new Date().getTimezoneOffset(),
    nowIso: new Date().toISOString(),
  };
}

function bookingDateSnapshot(booking: Partial<Booking>) {
  return {
    id_booking: booking.id_booking ?? null,
    agency_booking_id: booking.agency_booking_id ?? null,
    raw_creation_date: booking.creation_date ?? null,
    raw_departure_date: booking.departure_date ?? null,
    raw_return_date: booking.return_date ?? null,
    ui_creation_date: toDateKeyInBuenosAiresLegacySafe(
      booking.creation_date ?? null,
    ),
    ui_departure_date: toDateKeyInBuenosAiresLegacySafe(
      booking.departure_date ?? null,
    ),
    ui_return_date: toDateKeyInBuenosAiresLegacySafe(booking.return_date ?? null),
    ui_creation_date_ba_raw: toDateKeyInBuenosAires(booking.creation_date ?? null),
    ui_departure_date_ba_raw: toDateKeyInBuenosAires(
      booking.departure_date ?? null,
    ),
    ui_return_date_ba_raw: toDateKeyInBuenosAires(booking.return_date ?? null),
  };
}

function logBookingsDateSnapshot(context: string, items: Booking[]) {
  if (!isBookingDateDebugEnabled() || typeof window === "undefined") return;
  const rows = items.slice(0, 200).map((b) => bookingDateSnapshot(b));
  console.groupCollapsed(
    `[DATE-DEBUG][bookings] ${context} total=${items.length}`,
  );
  console.log("runtime", getRuntimeDateContext());
  console.table(rows);
  console.groupEnd();
}

function logOneBookingDateSnapshot(context: string, booking: Booking) {
  if (!isBookingDateDebugEnabled() || typeof window === "undefined") return;
  console.groupCollapsed(
    `[DATE-DEBUG][booking] ${context} id=${booking.id_booking}`,
  );
  console.log("runtime", getRuntimeDateContext());
  console.log(bookingDateSnapshot(booking));
  console.groupEnd();
}

// IDs válidos (>0, número finito)
const isValidId = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v > 0;

const formatBookingErrorMessage = (raw: string): string => {
  const msg = (raw || "").trim();
  const lower = msg.toLowerCase();
  if (!msg) return "No se pudo guardar la reserva.";

  if (lower.includes("todos los campos obligatorios")) {
    return "Faltan campos obligatorios para guardar la reserva.";
  }
  if (lower.includes("el titular no puede estar en la lista de acompañantes")) {
    return "El titular no puede estar incluido como acompañante.";
  }
  if (lower.includes("ids duplicados en los acompañantes")) {
    return "Hay acompañantes repetidos. Dejá cada pax una sola vez.";
  }
  if (lower.includes("titular inválido para tu agencia")) {
    return "El titular seleccionado no pertenece a tu agencia.";
  }
  if (lower.includes("hay acompañantes que no pertenecen a tu agencia")) {
    return "Uno o más acompañantes no pertenecen a tu agencia.";
  }
  if (lower.includes("usuario asignado inválido para tu agencia")) {
    return "El creador seleccionado no pertenece a tu agencia.";
  }
  if (lower.includes("no podés asignar fuera de tu equipo")) {
    return "No podés asignar como creador a un usuario fuera de tu equipo.";
  }
  if (lower.includes("no autorizado para reasignar usuario")) {
    return "No tenés permisos para cambiar el creador de la reserva.";
  }
  if (lower.includes("no autorizado para esta reserva")) {
    return "No tenés permisos para editar esta reserva.";
  }
  if (lower.includes("sin permisos para modificar el estado")) {
    return "No tenés permisos para modificar el estado de la reserva.";
  }
  if (lower.includes("no autenticado o token inválido")) {
    return "Tu sesión expiró. Iniciá sesión nuevamente.";
  }
  if (lower.includes("creation_date inválida")) {
    return "La fecha de creación no es válida.";
  }
  if (lower.includes("fechas inválidas")) {
    return "Revisá la fecha de salida, regreso y creación.";
  }
  if (lower.includes("hay categorías inválidas")) {
    return "Hay categorías de acompañantes inválidas para esta agencia.";
  }
  if (lower.includes("el número de reserva de agencia ya está en uso")) {
    return "El número de reserva de agencia ya está en uso.";
  }
  if (lower.includes("la carga manual de número de reserva está deshabilitada")) {
    return "La carga manual del número de reserva está deshabilitada en la configuración.";
  }
  if (
    lower.includes(
      "el número de reserva de agencia debe ser un entero mayor a 0",
    )
  ) {
    return "Ingresá un número de reserva válido (entero mayor a 0).";
  }
  if (lower.includes("datos duplicados detectados")) {
    return "Se detectaron datos duplicados al guardar la reserva.";
  }
  if (lower.includes("error creando la reserva")) {
    return "No se pudo crear la reserva. Intentá de nuevo.";
  }
  if (lower.includes("error actualizando la reserva")) {
    return "No se pudieron guardar los cambios de la reserva.";
  }

  return msg;
};

export default function Page() {
  const { token } = useAuth();

  // estados de carga
  const [loadingFilters, setLoadingFilters] = useState<boolean>(true);
  const [loadingBookings, setLoadingBookings] = useState<boolean>(true);

  const [profile, setProfile] = useState<{
    id_user: number;
    role: FilterRole | string;
  } | null>(null);
  const [teamMembers, setTeamMembers] = useState<User[]>([]);
  const [teamsList, setTeamsList] = useState<SalesTeam[]>([]);
  const [useSimpleCompanions, setUseSimpleCompanions] = useState(false);
  const [passengerCategories, setPassengerCategories] = useState<
    PassengerCategory[]
  >([]);
  const [allowManualAgencyBookingId, setAllowManualAgencyBookingId] =
    useState(false);
  const [nextAutoAgencyBookingId, setNextAutoAgencyBookingId] = useState<
    number | null
  >(null);

  const [selectedUserId, setSelectedUserId] = useState(0);
  const [selectedTeamId, setSelectedTeamId] = useState(0);

  const [selectedBookingStatus, setSelectedBookingStatus] = useState("Todas");
  const [selectedClientStatus, setSelectedClientStatus] = useState<
    "Todas" | "Pendiente" | "Pago" | "Facturado"
  >("Todas");
  const [selectedOperatorStatus, setSelectedOperatorStatus] = useState("Todas");

  const [creationFrom, setCreationFrom] = useState<string>("");
  const [creationTo, setCreationTo] = useState<string>("");
  const [travelFrom, setTravelFrom] = useState<string>("");
  const [travelTo, setTravelTo] = useState<string>("");

  const [searchTerm, setSearchTerm] = useState<string>("");
  const debouncedSearch = useDebounced(searchTerm, 400);

  const [bookings, setBookings] = useState<Booking[]>([]);
  const [expandedBookingId, setExpandedBookingId] = useState<number | null>(
    null,
  );

  const bookingFormRef = useRef<HTMLDivElement | null>(null);
  const pendingEditScrollRef = useRef(false);

  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  // Para evitar race conditions y cancelar requests
  const fetchAbortRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);

  const [viewMode, setViewMode] = useState<BookingViewMode>("grid");
  const take = viewMode === "list" ? 40 : 20;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(VIEW_MODE_STORAGE_KEY);
    if (stored === "grid" || stored === "list") {
      setViewMode(stored);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, viewMode);
  }, [viewMode]);

  const buildBookingsQuery = useCallback(
    (opts?: { cursor?: number | null }) => {
      const qs = new URLSearchParams();
      if (selectedUserId > 0) qs.append("userId", String(selectedUserId));
      if (selectedTeamId !== 0) qs.append("teamId", String(selectedTeamId));
      if (selectedBookingStatus !== "Todas")
        qs.append("status", selectedBookingStatus);
      if (selectedClientStatus !== "Todas")
        qs.append("clientStatus", selectedClientStatus);
      if (selectedOperatorStatus !== "Todas")
        qs.append("operatorStatus", selectedOperatorStatus);
      if (creationFrom) qs.append("creationFrom", creationFrom);
      if (creationTo) qs.append("creationTo", creationTo);
      if (travelFrom) qs.append("from", travelFrom);
      if (travelTo) qs.append("to", travelTo);
      if (debouncedSearch.trim()) qs.append("q", debouncedSearch.trim());
      qs.append("take", String(take));
      if (opts?.cursor) qs.append("cursor", String(opts.cursor));
      return qs.toString();
    },
    [
      selectedUserId,
      selectedTeamId,
      selectedBookingStatus,
      selectedClientStatus,
      selectedOperatorStatus,
      creationFrom,
      creationTo,
      travelFrom,
      travelTo,
      debouncedSearch,
      take,
    ],
  );

  const [isFormVisible, setIsFormVisible] = useState(false);
  const [editingBookingId, setEditingBookingId] = useState<number | null>(null);

  const todayYMD = () => {
    return todayDateKeyInBuenosAires();
  };

  const [formData, setFormData] = useState<BookingFormData>({
    id_booking: undefined,
    clientStatus: "Pendiente",
    operatorStatus: "Pendiente",
    status: "Abierta",
    details: "",
    invoice_type: "",
    invoice_observation: "",
    observation: "",
    titular_id: 0,
    id_user: 0,
    id_agency: 1,
    departure_date: "",
    return_date: "",
    pax_count: 1,
    clients_ids: [],
    agency_booking_id: 0,
    simple_companions: [],
    creation_date: todayYMD(),
    use_admin_adjustments: false,
  });

  const scrollToBookingForm = useCallback((behavior: ScrollBehavior) => {
    if (typeof window === "undefined") return;
    const target = bookingFormRef.current;
    if (!target) {
      window.scrollTo({ top: 0, behavior });
      return;
    }
    target.scrollIntoView({ behavior, block: "start" });
  }, []);

  useEffect(() => {
    if (!pendingEditScrollRef.current || !isFormVisible) return;
    if (typeof window === "undefined") return;

    const prefersReduced =
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const behavior: ScrollBehavior = prefersReduced ? "auto" : "smooth";

    const raf = window.requestAnimationFrame(() => {
      scrollToBookingForm(behavior);
      pendingEditScrollRef.current = false;
    });
    return () => window.cancelAnimationFrame(raf);
  }, [editingBookingId, isFormVisible, scrollToBookingForm]);

  // --- Carga de perfil + filtros ---
  useEffect(() => {
    if (!token) return;
    setLoadingFilters(true);

    const abort = new AbortController();

    (async () => {
      try {
        const profileRes = await authFetch(
          "/api/user/profile",
          { signal: abort.signal, cache: "no-store" },
          token || undefined,
        );
        if (!profileRes.ok) throw new Error("No se pudo obtener el perfil");
        const p = (await profileRes.json()) as {
          id_user: number;
          role: string;
          id_agency: number;
        };

        setProfile(p);
        const roleLower = normalizeRole(p.role || "");
        setFormData((prev) => ({ ...prev, id_user: p.id_user }));
        const visibilityDrivenRoles = [
          "vendedor",
          "lider",
          "gerente",
          "administrativo",
          "desarrollador",
        ];
        setSelectedUserId(
          visibilityDrivenRoles.includes(roleLower) ? 0 : p.id_user,
        );
        setSelectedTeamId(0);

        // 1) Equipos de la agencia
        const teamsRes = await authFetch(
          `/api/teams?agencyId=${p.id_agency}`,
          { signal: abort.signal, cache: "no-store" },
          token || undefined,
        );
        if (!teamsRes.ok) throw new Error("No se pudieron cargar los equipos");
        const allTeams = (await teamsRes.json()) as SalesTeam[];
        const allowed =
          roleLower === "lider"
            ? allTeams.filter((t) =>
                t.user_teams.some(
                  (ut) =>
                    ut.user.id_user === p.id_user && ut.user.role === "lider",
                ),
              )
            : allTeams;
        setTeamsList(allowed);

        // 2) Usuarios visibles (para asignar creador). Todos los de la agencia.
        if (FILTROS.includes(roleLower as FilterRole)) {
          const usersRes = await authFetch(
            "/api/users",
            { signal: abort.signal, cache: "no-store" },
            token || undefined,
          );
          if (usersRes.ok) {
            const users = (await usersRes.json()) as User[];
            setTeamMembers(users);
          }
        }

        // 3) Si es líder, obtener sólo sus miembros
        if (roleLower === "lider") {
          const mine = allTeams.filter((t) =>
            t.user_teams.some(
              (ut) => ut.user.id_user === p.id_user && ut.user.role === "lider",
            ),
          );
          const members = Array.from(
            new Map(
              mine.flatMap((t) =>
                t.user_teams.map((ut) => [ut.user.id_user, ut.user]),
              ),
            ).values(),
          );
          setTeamMembers(members as User[]);
        }
      } catch (error: unknown) {
        if (isAbortError(error)) return;
        const msg =
          error instanceof Error ? error.message : "Error inesperado.";
        console.error(msg);
        toast.error(msg);
      } finally {
        if (!abort.signal.aborted) setLoadingFilters(false);
      }
    })();

    return () => abort.abort();
  }, [token]);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    (async () => {
      try {
        const [cfgRes, catsRes, numberingRes] = await Promise.all([
          authFetch("/api/clients/config", { cache: "no-store" }, token),
          authFetch("/api/passenger-categories", { cache: "no-store" }, token),
          authFetch(
            "/api/bookings/config/numbering",
            { cache: "no-store" },
            token,
          ),
        ]);
        if (cfgRes.ok) {
          const cfg = (await cfgRes.json().catch(() => null)) as {
            use_simple_companions?: boolean;
          };
          if (alive) setUseSimpleCompanions(Boolean(cfg?.use_simple_companions));
        } else if (alive) {
          setUseSimpleCompanions(false);
        }
        if (catsRes.ok) {
          const cats = (await catsRes.json().catch(() => [])) as PassengerCategory[];
          if (alive) setPassengerCategories(cats);
        } else if (alive) {
          setPassengerCategories([]);
        }
        if (numberingRes.ok) {
          const numbering = (await numberingRes.json().catch(() => null)) as {
            allow_manual_agency_booking_id?: boolean;
            next_auto_agency_booking_id?: number;
          } | null;
          if (alive) {
            setAllowManualAgencyBookingId(
              Boolean(numbering?.allow_manual_agency_booking_id),
            );
            setNextAutoAgencyBookingId(
              typeof numbering?.next_auto_agency_booking_id === "number" &&
                Number.isFinite(numbering.next_auto_agency_booking_id)
                ? Math.max(1, Math.trunc(numbering.next_auto_agency_booking_id))
                : null,
            );
          }
        } else if (alive) {
          setAllowManualAgencyBookingId(false);
          setNextAutoAgencyBookingId(null);
        }
      } catch {
        if (alive) {
          setUseSimpleCompanions(false);
          setPassengerCategories([]);
          setAllowManualAgencyBookingId(false);
          setNextAutoAgencyBookingId(null);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [token]);

  // --- Carga de reservas (primera página con cursor) ---
  useEffect(() => {
    if (!profile || loadingFilters || !token) return;

    setLoadingBookings(true);

    // cancelar petición anterior si existe
    fetchAbortRef.current?.abort();
    const controller = new AbortController();
    fetchAbortRef.current = controller;

    const myRequestId = ++requestIdRef.current;

    (async () => {
      try {
        const qs = buildBookingsQuery();
        const resp = await authFetch(
          `/api/bookings?${qs}`,
          { signal: controller.signal, cache: "no-store" },
          token || undefined,
        );
        if (!resp.ok) throw new Error("No se pudieron obtener las reservas");

        const { items, nextCursor } = await resp.json();
        if (myRequestId !== requestIdRef.current) return;

        logBookingsDateSnapshot("list:first-page", items as Booking[]);
        setBookings(items);
        setNextCursor(nextCursor);
        setExpandedBookingId(null);
      } catch (err: unknown) {
        if (isAbortError(err)) return;
        console.error("Error fetching bookings:", err);
        const msg =
          err instanceof Error ? err.message : "Error al obtener reservas.";
        toast.error(msg);
      } finally {
        if (
          myRequestId === requestIdRef.current &&
          !controller.signal.aborted
        ) {
          setLoadingBookings(false);
        }
      }
    })();

    return () => controller.abort();
  }, [
    profile,
    loadingFilters,
    selectedUserId,
    selectedTeamId,
    selectedBookingStatus,
    selectedClientStatus,
    selectedOperatorStatus,
    creationFrom,
    creationTo,
    travelFrom,
    travelTo,
    token,
    buildBookingsQuery,
    debouncedSearch,
  ]);

  const handleChange = (
    e: React.ChangeEvent<
      HTMLTextAreaElement | HTMLInputElement | HTMLSelectElement
    >,
  ) => {
    const { name, value } = e.target;
    if (name === "agency_booking_id") {
      setFormData((prev) => {
        if (value === "") return { ...prev, agency_booking_id: 0 };
        const parsed = Number(value);
        return {
          ...prev,
          agency_booking_id: Number.isFinite(parsed)
            ? parsed
            : (prev.agency_booking_id ?? 0),
        };
      });
      return;
    }
    setFormData((prev) => ({
      ...prev,
      [name]: ["pax_count", "titular_id", "id_user"].includes(name)
        ? Number(value)
        : value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Sanitizar acompañantes: solo ids válidos (>0), únicos y que no sean el titular
    const sanitizedCompanions = Array.from(
      new Set(
        (formData.clients_ids || [])
          .filter(isValidId)
          .filter((id) => id !== formData.titular_id),
      ),
    );
    const sanitizedSimpleCompanions = Array.isArray(formData.simple_companions)
      ? formData.simple_companions
          .map((c) => {
            if (!c) return null;
            const category_id =
              c.category_id != null ? Number(c.category_id) : null;
            const age = c.age != null ? Number(c.age) : null;
            const notes =
              typeof c.notes === "string" && c.notes.trim()
                ? c.notes.trim()
                : null;
            const safeCategory =
              category_id != null && Number.isFinite(category_id) && category_id > 0
                ? Math.floor(category_id)
                : null;
            const safeAge =
              age != null && Number.isFinite(age) && age >= 0
                ? Math.floor(age)
                : null;
            if (safeCategory == null && safeAge == null && !notes) return null;
            return { category_id: safeCategory, age: safeAge, notes };
          })
          .filter(Boolean)
      : [];

    const roleLower = (profile?.role || "").toLowerCase();
    const canPickCreator =
      roleLower === "gerente" ||
      roleLower === "administrativo" ||
      roleLower === "desarrollador";
    const canEditCreationDate =
      roleLower === "gerente" ||
      roleLower === "administrativo" ||
      roleLower === "desarrollador";
    const adminAdjustEnabled = Boolean(formData.use_admin_adjustments);

    // ✅ Validaciones front mínimas (invoice_observation AHORA OPCIONAL)
    const missing: string[] = [];
    if (!formData.details.trim()) missing.push("Detalle");
    if (!formData.invoice_type.trim()) missing.push("Tipo de factura");
    if (!isValidId(formData.titular_id)) missing.push("Titular");
    if (!formData.departure_date) missing.push("Salida");
    if (!formData.return_date) missing.push("Regreso");
    if (!formData.clientStatus) missing.push("Estado pax");
    if (!formData.operatorStatus) missing.push("Estado operador");
    if (!formData.status) missing.push("Estado reserva");
    if (adminAdjustEnabled && canPickCreator && !isValidId(formData.id_user)) {
      missing.push("Creador de la reserva");
    }
    if (missing.length) {
      toast.error(`Faltan campos obligatorios: ${missing.join(", ")}.`);
      return;
    }

    if (
      formData.agency_booking_id != null &&
      formData.agency_booking_id !== 0 &&
      !isValidId(formData.agency_booking_id)
    ) {
      toast.error("El número de reserva de agencia debe ser un entero mayor a 0.");
      return;
    }

    if (sanitizedCompanions.includes(formData.titular_id)) {
      toast.error("El titular no puede estar de acompañante.");
      return;
    }

    // Validación extra para Factura A (con auth)
    if (formData.invoice_type === "Factura A") {
      try {
        const resClient = await authFetch(
          `/api/clients/${formData.titular_id}`,
          { cache: "no-store" },
          token || undefined,
        );
        if (!resClient.ok) {
          toast.error("No se pudo obtener la información del titular.");
          return;
        }
        const titular = await resClient.json();
        if (
          !titular.company_name?.trim() ||
          !titular.commercial_address?.trim() ||
          !titular.email?.trim() ||
          !titular.tax_id?.trim()
        ) {
          toast.error(
            "Para Factura A, el titular debe tener Razón Social, Domicilio Comercial, Email y CUIT.",
          );
          return;
        }
      } catch (error) {
        console.error("Error validando titular:", error);
        toast.error("Error al validar la información del titular.");
        return;
      }
    }

    try {
      const url = editingBookingId
        ? `/api/bookings/${editingBookingId}`
        : "/api/bookings";
      const method = editingBookingId ? "PUT" : "POST";

      // ---- TIPADO del payload sin `any` ----
      type BookingPayload = Omit<
        BookingFormData,
        | "id_booking"
        | "id_agency"
        | "id_user"
        | "creation_date"
        | "use_admin_adjustments"
        | "agency_booking_id"
      > & { pax_count: number; clients_ids: number[]; simple_companions?: BookingFormData["simple_companions"] } & Partial<
          Pick<BookingFormData, "id_user" | "creation_date" | "agency_booking_id">
        >;

      const payload: BookingPayload = {
        clientStatus: formData.clientStatus,
        operatorStatus: formData.operatorStatus,
        status: formData.status,
        details: formData.details,
        invoice_type: formData.invoice_type,
        invoice_observation: formData.invoice_observation, // opcional
        observation: formData.observation,
        titular_id: formData.titular_id,
        departure_date: formData.departure_date,
        return_date: formData.return_date,
        pax_count:
          1 + sanitizedCompanions.length + sanitizedSimpleCompanions.length,
        clients_ids: sanitizedCompanions,
        simple_companions: sanitizedSimpleCompanions as BookingPayload["simple_companions"],
        ...(isValidId(formData.agency_booking_id)
          ? { agency_booking_id: formData.agency_booking_id }
          : {}),
        ...(adminAdjustEnabled && canPickCreator && isValidId(formData.id_user)
          ? { id_user: formData.id_user }
          : {}),
        ...(adminAdjustEnabled && canEditCreationDate && formData.creation_date
          ? { creation_date: formData.creation_date }
          : {}),
      };
      if (isBookingDateDebugEnabled()) {
        console.log("[DATE-DEBUG][booking-submit]", {
          editingBookingId,
          payload_dates: {
            creation_date: payload.creation_date ?? null,
            departure_date: payload.departure_date,
            return_date: payload.return_date,
          },
          runtime: getRuntimeDateContext(),
        });
      }
      // --------------------------------------

      const response = await authFetch(
        url,
        { method, body: JSON.stringify(payload) },
        token || undefined,
      );

      if (!response.ok) {
        let msg = "Error al guardar la reserva.";
        try {
          const err = await response.json();
          msg = typeof err?.error === "string" ? err.error : msg;
        } catch {
          /* ignore */
        }
        throw new Error(formatBookingErrorMessage(msg));
      }

      // Refrescar primera página con los filtros actuales
      const qs = buildBookingsQuery();
      const listResp = await authFetch(
        `/api/bookings?${qs}`,
        { cache: "no-store" },
        token || undefined,
      );
      if (!listResp.ok) throw new Error("No se pudo refrescar la lista.");
      const { items, nextCursor } = await listResp.json();
      logBookingsDateSnapshot("list:after-save-refresh", items as Booking[]);
      setBookings(items);
      setNextCursor(nextCursor);
      setExpandedBookingId(null);

      try {
        const numberingRes = await authFetch(
          "/api/bookings/config/numbering",
          { cache: "no-store" },
          token || undefined,
        );
        if (numberingRes.ok) {
          const numbering = (await numberingRes.json().catch(() => null)) as {
            allow_manual_agency_booking_id?: boolean;
            next_auto_agency_booking_id?: number;
          } | null;
          setAllowManualAgencyBookingId(
            Boolean(numbering?.allow_manual_agency_booking_id),
          );
          setNextAutoAgencyBookingId(
            typeof numbering?.next_auto_agency_booking_id === "number" &&
              Number.isFinite(numbering.next_auto_agency_booking_id)
              ? Math.max(1, Math.trunc(numbering.next_auto_agency_booking_id))
              : null,
          );
        }
      } catch {
        // Si falla, no bloquea el guardado de reserva.
      }

      toast.success("¡Reserva guardada con éxito!");
      resetForm();
    } catch (error: unknown) {
      const msg = formatBookingErrorMessage(
        error instanceof Error ? error.message : "Error inesperado.",
      );
      toast.error(msg);
    }
  };

  // Cargar más (append con cursor)
  const loadMore = async () => {
    if (!nextCursor || !token || loadingMore) return;
    setLoadingMore(true);
    try {
      const qs = buildBookingsQuery({ cursor: nextCursor });
      const resp = await authFetch(
        `/api/bookings?${qs}`,
        { cache: "no-store" },
        token || undefined,
      );
      if (!resp.ok) throw new Error("No se pudieron obtener más reservas");

      const { items, nextCursor: newCursor } = await resp.json();
      logBookingsDateSnapshot("list:load-more", items as Booking[]);
      setBookings((prev) => [...prev, ...items]);
      setNextCursor(newCursor);
    } catch (e) {
      console.error("loadMore:", e);
      toast.error("No se pudieron cargar más reservas.");
    } finally {
      setLoadingMore(false);
    }
  };

  const resetForm = () => {
    setFormData((prev) => ({
      id_booking: undefined,
      clientStatus: "Pendiente",
      operatorStatus: "Pendiente",
      status: "Abierta",
      details: "",
      invoice_type: "",
      invoice_observation: "",
      observation: "",
      titular_id: 0,
      id_user: prev.id_user!, // mantener el usuario actual
      id_agency: 1,
      departure_date: "",
      return_date: "",
      pax_count: 1,
      clients_ids: [],
      agency_booking_id: 0,
      simple_companions: [],
      creation_date: todayYMD(),
      use_admin_adjustments: false,
    }));
    setIsFormVisible(false);
    setEditingBookingId(null);
  };

  const startEditingBooking = (booking: Booking) => {
    logOneBookingDateSnapshot("edit:open", booking);
    pendingEditScrollRef.current = true;
    const titularId = booking.titular?.id_client || 0;
    // Acompañantes reales: excluir titular, solo IDs válidos
    const companions = (booking.clients || [])
      .map((c) => c.id_client)
      .filter((id) => id !== titularId && isValidId(id));
    const simpleCompanions = Array.isArray(booking.simple_companions)
      ? booking.simple_companions.map((c) => ({
          category_id: c.category_id ?? null,
          age: c.age ?? null,
          notes: c.notes ?? "",
        }))
      : [];

    setFormData({
      id_booking: booking.id_booking,
      clientStatus: booking.clientStatus,
      operatorStatus: booking.operatorStatus,
      status: booking.status,
      details: booking.details,
      invoice_type: booking.invoice_type || "",
      invoice_observation: booking.invoice_observation || "",
      observation: booking.observation || "",
      titular_id: titularId,
      id_user: booking.user?.id_user || 0,
      id_agency: booking.agency?.id_agency || 0,
      departure_date:
        toDateKeyInBuenosAiresLegacySafe(booking.departure_date) || "",
      return_date: toDateKeyInBuenosAiresLegacySafe(booking.return_date) || "",
      pax_count: Math.max(1, 1 + companions.length + simpleCompanions.length),
      clients_ids: companions,
      agency_booking_id: booking.agency_booking_id ?? 0,
      simple_companions: simpleCompanions,
      creation_date:
        toDateKeyInBuenosAiresLegacySafe(booking.creation_date) || todayYMD(),
      use_admin_adjustments: false,
    });
    setEditingBookingId(booking.id_booking || null);
    setIsFormVisible(true);
  };

  const duplicateBooking = async (source: Booking) => {
    const titularId = source.titular?.id_client ?? 0;
    if (!isValidId(titularId)) {
      toast.error("No se pudo duplicar la reserva: titular inválido.");
      return;
    }

    const departureDate =
      toDateKeyInBuenosAiresLegacySafe(source.departure_date) || "";
    const returnDate = toDateKeyInBuenosAiresLegacySafe(source.return_date) || "";
    if (!departureDate || !returnDate) {
      toast.error("No se pudo duplicar la reserva: fechas inválidas.");
      return;
    }

    const companions = (source.clients || [])
      .map((c) => c.id_client)
      .filter((id) => isValidId(id) && id !== titularId);

    const simpleCompanions = Array.isArray(source.simple_companions)
      ? source.simple_companions
          .map((c) => {
            const category_id =
              c?.category_id != null ? Number(c.category_id) : null;
            const age = c?.age != null ? Number(c.age) : null;
            const notes =
              typeof c?.notes === "string" && c.notes.trim()
                ? c.notes.trim()
                : null;

            const safeCategory =
              category_id != null &&
              Number.isFinite(category_id) &&
              category_id > 0
                ? Math.floor(category_id)
                : null;
            const safeAge =
              age != null && Number.isFinite(age) && age >= 0
                ? Math.floor(age)
                : null;

            if (safeCategory == null && safeAge == null && !notes) return null;
            return { category_id: safeCategory, age: safeAge, notes };
          })
          .filter(
            (
              item,
            ): item is { category_id: number | null; age: number | null; notes: string | null } =>
              item !== null,
          )
      : [];

    const roleNormalized = normalizeRole(profile?.role || "");
    const canPickCreator = [
      "lider",
      "gerente",
      "administrativo",
      "desarrollador",
    ].includes(roleNormalized);
    const canEditCreationDate = [
      "gerente",
      "administrativo",
      "desarrollador",
    ].includes(roleNormalized);
    const creationDate =
      toDateKeyInBuenosAiresLegacySafe(source.creation_date) || undefined;
    const sourceStatus = String(source.status || "").trim().toLowerCase();
    const statusForDuplicate =
      sourceStatus === "bloqueada" || sourceStatus === "cancelada"
        ? "Abierta"
        : source.status || "Abierta";

    const payload: {
      clientStatus: string;
      operatorStatus: string;
      status: string;
      details: string;
      invoice_type: string;
      invoice_observation?: string;
      observation?: string;
      titular_id: number;
      departure_date: string;
      return_date: string;
      pax_count: number;
      clients_ids: number[];
      simple_companions: Array<{
        category_id: number | null;
        age: number | null;
        notes: string | null;
      }>;
      id_user?: number;
      creation_date?: string;
    } = {
      clientStatus: source.clientStatus || "Pendiente",
      operatorStatus: source.operatorStatus || "Pendiente",
      status: statusForDuplicate,
      details: source.details?.trim() || "Copia de reserva",
      invoice_type: source.invoice_type || "Coordinar con administracion",
      invoice_observation: source.invoice_observation || "",
      observation: source.observation || "",
      titular_id: titularId,
      departure_date: departureDate,
      return_date: returnDate,
      pax_count: 1 + companions.length + simpleCompanions.length,
      clients_ids: companions,
      simple_companions: simpleCompanions,
      ...(canPickCreator && isValidId(source.user?.id_user)
        ? { id_user: source.user.id_user }
        : {}),
      ...(canEditCreationDate && creationDate
        ? { creation_date: creationDate }
        : {}),
    };

    const readApiError = async (response: Response, fallback: string) => {
      try {
        const err = await response.json();
        return typeof err?.error === "string" ? err.error : fallback;
      } catch {
        return fallback;
      }
    };

    const resolveSourceServices = async (): Promise<Service[]> => {
      try {
        const servicesResp = await authFetch(
          `/api/services?bookingId=${source.id_booking}`,
          { cache: "no-store" },
          token || undefined,
        );
        if (!servicesResp.ok) {
          const msg = await readApiError(
            servicesResp,
            "No se pudieron obtener los servicios a duplicar.",
          );
          throw new Error(msg);
        }
        const data = (await servicesResp.json().catch(() => ({}))) as {
          services?: Service[];
        };
        if (Array.isArray(data.services)) return data.services;
      } catch (error) {
        if (Array.isArray(source.services)) return source.services;
        throw error;
      }

      return Array.isArray(source.services) ? source.services : [];
    };

    try {
      const servicesToDuplicate = await resolveSourceServices();

      const response = await authFetch(
        "/api/bookings",
        { method: "POST", body: JSON.stringify(payload) },
        token || undefined,
      );

      if (!response.ok) {
        const msg = await readApiError(response, "No se pudo duplicar la reserva.");
        throw new Error(formatBookingErrorMessage(msg));
      }

      const duplicatedBooking = (await response.json().catch(() => null)) as
        | Booking
        | null;
      const duplicatedBookingId = duplicatedBooking?.id_booking;
      if (!isValidId(duplicatedBookingId)) {
        throw new Error("No se pudo identificar la reserva duplicada.");
      }

      if (servicesToDuplicate.length > 0) {
        let duplicatedServices = 0;
        try {
          for (const service of servicesToDuplicate) {
            const serviceDeparture =
              toDateKeyInBuenosAiresLegacySafe(service.departure_date) ||
              departureDate;
            const serviceReturn =
              toDateKeyInBuenosAiresLegacySafe(service.return_date) || returnDate;

            const servicePayload = {
              type: service.type,
              description: service.description ?? "",
              note: service.note ?? "",
              sale_price: service.sale_price ?? 0,
              cost_price: service.cost_price ?? 0,
              destination: service.destination ?? "",
              reference: service.reference ?? "",
              tax_21: service.tax_21 ?? null,
              tax_105: service.tax_105 ?? null,
              exempt: service.exempt ?? null,
              other_taxes: service.other_taxes ?? null,
              currency: service.currency || "ARS",
              departure_date: serviceDeparture,
              return_date: serviceReturn,
              id_operator: service.id_operator,
              booking_id: duplicatedBookingId,
              nonComputable: service.nonComputable ?? null,
              taxableBase21: service.taxableBase21 ?? null,
              taxableBase10_5: service.taxableBase10_5 ?? null,
              commissionExempt: service.commissionExempt ?? null,
              commission21: service.commission21 ?? null,
              commission10_5: service.commission10_5 ?? null,
              vatOnCommission21: service.vatOnCommission21 ?? null,
              vatOnCommission10_5: service.vatOnCommission10_5 ?? null,
              totalCommissionWithoutVAT: service.totalCommissionWithoutVAT ?? null,
              impIVA: service.impIVA ?? null,
              card_interest: service.card_interest ?? null,
              card_interest_21: service.card_interest_21 ?? null,
              taxableCardInterest: service.taxableCardInterest ?? null,
              vatOnCardInterest: service.vatOnCardInterest ?? null,
              transfer_fee_pct: service.transfer_fee_pct ?? null,
              transfer_fee_amount: service.transfer_fee_amount ?? null,
              billing_override: service.billing_override ?? null,
              extra_costs_amount: service.extra_costs_amount ?? null,
              extra_taxes_amount: service.extra_taxes_amount ?? null,
              extra_adjustments: service.extra_adjustments ?? null,
            };

            const serviceResponse = await authFetch(
              "/api/services",
              {
                method: "POST",
                body: JSON.stringify(servicePayload),
              },
              token || undefined,
            );

            if (!serviceResponse.ok) {
              const msg = await readApiError(
                serviceResponse,
                "No se pudo duplicar uno de los servicios.",
              );
              throw new Error(formatBookingErrorMessage(msg));
            }

            duplicatedServices += 1;
          }
        } catch {
          const rollback = await authFetch(
            `/api/bookings/${duplicatedBookingId}`,
            { method: "DELETE" },
            token || undefined,
          ).catch(() => null);

          if (!rollback?.ok) {
            throw new Error(
              `No se pudieron duplicar todos los servicios (${duplicatedServices}/${servicesToDuplicate.length}). La reserva ${duplicatedBookingId} quedó creada parcialmente.`,
            );
          }

          throw new Error(
            `No se pudieron duplicar todos los servicios (${duplicatedServices}/${servicesToDuplicate.length}). Se revirtió la reserva duplicada.`,
          );
        }
      }

      const qs = buildBookingsQuery();
      const listResp = await authFetch(
        `/api/bookings?${qs}`,
        { cache: "no-store" },
        token || undefined,
      );
      if (!listResp.ok) throw new Error("No se pudo refrescar la lista.");
      const { items, nextCursor } = await listResp.json();
      logBookingsDateSnapshot("list:after-duplicate-refresh", items as Booking[]);
      setBookings(items);
      setNextCursor(nextCursor);
      setExpandedBookingId(null);

      try {
        const numberingRes = await authFetch(
          "/api/bookings/config/numbering",
          { cache: "no-store" },
          token || undefined,
        );
        if (numberingRes.ok) {
          const numbering = (await numberingRes.json().catch(() => null)) as {
            allow_manual_agency_booking_id?: boolean;
            next_auto_agency_booking_id?: number;
          } | null;
          setAllowManualAgencyBookingId(
            Boolean(numbering?.allow_manual_agency_booking_id),
          );
          setNextAutoAgencyBookingId(
            typeof numbering?.next_auto_agency_booking_id === "number" &&
              Number.isFinite(numbering.next_auto_agency_booking_id)
              ? Math.max(1, Math.trunc(numbering.next_auto_agency_booking_id))
              : null,
          );
        }
      } catch {
        // Si falla, no bloquea la duplicación.
      }

      if (servicesToDuplicate.length > 0) {
        toast.success(
          `Reserva duplicada con ${servicesToDuplicate.length} servicio${
            servicesToDuplicate.length === 1 ? "" : "s"
          }.`,
        );
      } else {
        toast.success("Reserva duplicada con éxito.");
      }
    } catch (error: unknown) {
      const msg = formatBookingErrorMessage(
        error instanceof Error ? error.message : "Error inesperado.",
      );
      toast.error(msg);
    }
  };

  const deleteBooking = async (id: number) => {
    try {
      const res = await authFetch(
        `/api/bookings/${id}`,
        { method: "DELETE" },
        token || undefined,
      );
      if (res.ok) {
        setBookings((prev) => prev.filter((b) => b.id_booking !== id));
        toast.success("¡Reserva eliminada con éxito!");
      } else {
        let msg = "Error al eliminar la reserva.";
        try {
          const err = await res.json();
          if (typeof err?.error === "string") msg = err.error;
        } catch {
          /* ignore */
        }
        throw new Error(msg);
      }
    } catch (err: unknown) {
      console.error("Error deleting booking:", err);
      toast.error((err as Error).message || "Error al eliminar la reserva.");
    }
  };

  // Refine local consistente con la búsqueda server-side.
  const displayedBookings = useMemo(() => {
    const query = debouncedSearch.trim();
    if (!query) return bookings;
    return rankBookingsBySimilarity(bookings, query);
  }, [bookings, debouncedSearch]);

  const displayedTeamMembers = useMemo(() => {
    // “Sin equipo”
    if (selectedTeamId === -1) {
      const assignedIds = teamsList.flatMap((t) =>
        t.user_teams.map((ut) => ut.user.id_user),
      );
      return teamMembers.filter((u) => !assignedIds.includes(u.id_user));
    }
    // Equipo específico
    if (selectedTeamId > 0) {
      const team = teamsList.find((t) => t.id_team === selectedTeamId);
      return team ? team.user_teams.map((ut) => ut.user) : [];
    }
    // Todo el equipo
    return teamMembers;
  }, [selectedTeamId, teamsList, teamMembers]);

  const roleLower = (profile?.role || "").toLowerCase();
  const canPickCreator = [
    "gerente",
    "administrativo",
    "desarrollador",
  ].includes(roleLower);
  const canEditCreationDate = [
    "gerente",
    "administrativo",
    "desarrollador",
  ].includes(roleLower);

  const isLoading = loadingFilters || loadingBookings;

  return (
    <ProtectedRoute>
      <section className="text-sky-950 dark:text-white">
        <motion.div layout ref={bookingFormRef}>
          <BookingForm
            token={token}
            formData={formData}
            handleChange={handleChange}
            handleSubmit={handleSubmit}
            editingBookingId={editingBookingId}
            isFormVisible={isFormVisible}
            setFormData={setFormData}
            setIsFormVisible={setIsFormVisible}
            /** props para elegir creador y fecha de creación */
            canPickCreator={canPickCreator}
            canEditCreationDate={canEditCreationDate}
            creatorsList={teamMembers}
            passengerCategories={passengerCategories}
            allowSimpleCompanions={useSimpleCompanions}
            allowManualAgencyBookingId={allowManualAgencyBookingId}
            nextAutoAgencyBookingId={nextAutoAgencyBookingId}
          />
        </motion.div>

        <div className="my-4 flex flex-wrap items-center justify-between gap-4">
          <h2 className="flex items-center gap-2 text-2xl font-semibold dark:font-medium">
            Reservas
            <span
              className={`${pillBase} ${
                displayedBookings.length > 0 ? pillOk : pillWarn
              }`}
              title="Resultados actuales"
            >
              {displayedBookings.length}{" "}
              {displayedBookings.length === 1 ? "resultado" : "resultados"}
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

        <div className="mb-4 space-y-4 text-sm md:text-base">
          <FilterPanel
            role={profile?.role as FilterRole}
            teams={teamsList}
            displayedTeamMembers={displayedTeamMembers}
            selectedUserId={selectedUserId}
            setSelectedUserId={setSelectedUserId}
            selectedTeamId={selectedTeamId}
            setSelectedTeamId={setSelectedTeamId}
            selectedBookingStatus={selectedBookingStatus}
            setSelectedBookingStatus={setSelectedBookingStatus}
            selectedClientStatus={selectedClientStatus}
            setSelectedClientStatus={setSelectedClientStatus}
            selectedOperatorStatus={selectedOperatorStatus}
            setSelectedOperatorStatus={setSelectedOperatorStatus}
            creationFrom={creationFrom}
            setCreationFrom={setCreationFrom}
            creationTo={creationTo}
            setCreationTo={setCreationTo}
            travelFrom={travelFrom}
            setTravelFrom={setTravelFrom}
            travelTo={travelTo}
            setTravelTo={setTravelTo}
            setSearchTerm={setSearchTerm}
            searchTerm={searchTerm}
          />
        </div>

        {isLoading ? (
          <div className="flex min-h-[50vh] items-center">
            <Spinner />
          </div>
        ) : (
          <BookingList
            bookings={displayedBookings}
            expandedBookingId={expandedBookingId}
            setExpandedBookingId={setExpandedBookingId}
            startEditingBooking={startEditingBooking}
            duplicateBooking={duplicateBooking}
            deleteBooking={deleteBooking}
            role={profile?.role as FilterRole}
            hasMore={Boolean(nextCursor)}
            onLoadMore={loadMore}
            loadingMore={loadingMore}
            viewMode={viewMode}
          />
        )}
        

        <ToastContainer />

        {/* Estilos globales para asegurar legibilidad de los <option> */}
        <style jsx global>{`
          select option {
            background-color: #ffffff;
            color: #0c4a6e; /* sky-950 */
          }
          .dark select option {
            background-color: #0b0f19; /* fondo oscuro neutro */
            color: #ffffff;
          }
        `}</style>
      </section>
    </ProtectedRoute>
  );
}
