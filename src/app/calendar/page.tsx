// src/app/calendar/page.tsx
"use client";
import React, { useState, useEffect, useRef, useMemo } from "react";
import FullCalendar from "@fullcalendar/react";
import { EventInput, EventApi, EventContentArg } from "@fullcalendar/core";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin, { DateClickArg } from "@fullcalendar/interaction";
import esLocale from "@fullcalendar/core/locales/es";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import Spinner from "@/components/Spinner";
import ProtectedRoute from "@/components/ProtectedRoute";
import { authFetch } from "@/utils/authFetch";
import { formatDateInBuenosAires } from "@/lib/buenosAiresDate";
import {
  canAccessFinanceSection,
  canManageResourceSection,
  normalizeFinanceSectionRules,
  normalizeResourceSectionRules,
  resolveCalendarVisibility,
  type FinanceSectionKey,
  type ResourceSectionAccessRule,
} from "@/utils/permissions";

type ClientStatus = "Todas" | "Pendiente" | "Pago" | "Facturado";
type ViewOption = "dayGridMonth" | "dayGridWeek" | "dayGridDay";
type NoteMode = "create" | "view" | "edit";
type CalendarContext =
  | "trips"
  | "birthdays"
  | "notes"
  | "payment_plans"
  | "operator_dues";
type OperationsMode = "bookings" | "services";
type FinanceStatus = "PENDIENTE" | "VENCIDA" | "PAGADA" | "CANCELADA";
type DetailMode = "name" | "detail";

interface User {
  id_user: number;
  first_name: string;
  last_name: string;
  role: string;
  id_agency: number;
}

interface CalendarEvent extends EventInput {
  extendedProps?: {
    kind?:
      | "booking"
      | "service"
      | "note"
      | "birthday"
      | "client_payment"
      | "operator_due";
    content?: string;
    creator?: string;
    bookingPublicId?: number | string;
    bookingId?: number;
    details?: string;
    paxCount?: number;
    clientStatus?: string;
    status?: string;
    servicesCount?: number;
    returnDate?: string | Date;
    serviceType?: string;
    destination?: string;
    reference?: string;
    description?: string;
    note?: string;
    amount?: number;
    currency?: string;
    paymentId?: number;
    paymentPublicId?: number;
    operatorDueId?: number;
    operatorDuePublicId?: number;
    clientId?: number;
    birthDate?: string | Date;
    turningAge?: number;
  };
}

interface NoteModalData {
  open: boolean;
  mode: NoteMode;
  id?: number;
  date: string;
  title: string;
  content: string;
  creator: string;
}

export default function CalendarPage() {
  const { token, role } = useAuth();
  const router = useRouter();
  const calendarRef = useRef<FullCalendar>(null);
  const [calendarTitle, setCalendarTitle] = useState("");
  const [calendarYear, setCalendarYear] = useState("");

  const [profile, setProfile] = useState<User | null>(null);
  const [vendors, setVendors] = useState<User[]>([]);
  const [vendorInput, setVendorInput] = useState("");
  const [selectedVendor, setSelectedVendor] = useState(0);
  const [selectedClientStatus, setSelectedClientStatus] =
    useState<ClientStatus>("Todas");
  const [travelDateRange, setTravelDateRange] = useState<{
    from: string;
    to: string;
  }>({
    from: "",
    to: "",
  });
  const [notesDateRange, setNotesDateRange] = useState<{ from: string; to: string }>(
    {
      from: "",
      to: "",
    },
  );
  const [birthdayDateRange, setBirthdayDateRange] = useState<{
    from: string;
    to: string;
  }>({
    from: "",
    to: "",
  });
  const [dueDateRange, setDueDateRange] = useState<{ from: string; to: string }>(
    {
      from: "",
      to: "",
    },
  );
  const [calendarContext, setCalendarContext] =
    useState<CalendarContext>("trips");
  const [operationsMode, setOperationsMode] =
    useState<OperationsMode>("bookings");
  const [selectedFinanceStatuses, setSelectedFinanceStatuses] = useState<
    FinanceStatus[]
  >(["PENDIENTE", "VENCIDA"]);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [currentView, setCurrentView] = useState<ViewOption>("dayGridMonth");
  const [detailMode, setDetailMode] = useState<DetailMode>("name");
  const [financeSectionGrants, setFinanceSectionGrants] = useState<
    FinanceSectionKey[]
  >([]);
  const [financeSectionLoaded, setFinanceSectionLoaded] = useState(false);

  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [loadingNote, setLoadingNote] = useState(false);
  const [resourceRule, setResourceRule] =
    useState<ResourceSectionAccessRule | null>(null);
  const [resourceHasCustomRule, setResourceHasCustomRule] = useState(false);

  const [noteModal, setNoteModal] = useState<NoteModalData>({
    open: false,
    mode: "create",
    date: "",
    title: "",
    content: "",
    creator: "",
  });

  const [form, setForm] = useState<{ title: string; content: string }>({
    title: "",
    content: "",
  });

  const clientStatusOptions: ClientStatus[] = [
    "Todas",
    "Pendiente",
    "Pago",
    "Facturado",
  ];
  const financeStatusOptions: FinanceStatus[] = [
    "PENDIENTE",
    "VENCIDA",
    "PAGADA",
    "CANCELADA",
  ];

  const canManageCalendarNotes = useMemo(
    () =>
      canManageResourceSection(
        role,
        resourceRule?.sections ?? [],
        "calendar",
        resourceHasCustomRule,
      ),
    [resourceHasCustomRule, resourceRule, role],
  );

  const calendarVisibility = useMemo(
    () => resolveCalendarVisibility(role, resourceRule, resourceHasCustomRule),
    [resourceHasCustomRule, resourceRule, role],
  );

  const canAccessPaymentPlansContext = useMemo(
    () =>
      canAccessFinanceSection(
        role,
        financeSectionGrants,
        "payment_plans",
      ),
    [financeSectionGrants, role],
  );

  const canAccessOperatorDuesContext = useMemo(
    () =>
      canAccessFinanceSection(
        role,
        financeSectionGrants,
        "operator_payments",
      ),
    [financeSectionGrants, role],
  );

  const availableContexts = useMemo(() => {
    const options: Array<{ value: CalendarContext; label: string }> = [
      { value: "trips", label: "Viajes" },
      { value: "birthdays", label: "Cumple pax" },
      { value: "notes", label: "Notas" },
    ];
    if (canAccessPaymentPlansContext) {
      options.push({ value: "payment_plans", label: "Planes pago" });
    }
    if (canAccessOperatorDuesContext) {
      options.push({ value: "operator_dues", label: "Venc. operador" });
    }
    return options;
  }, [canAccessOperatorDuesContext, canAccessPaymentPlansContext]);

  const calendarContextLabel = useMemo(() => {
    const match = availableContexts.find((item) => item.value === calendarContext);
    return match?.label ?? "Viajes";
  }, [availableContexts, calendarContext]);

  const activeRangeLabel = useMemo(() => {
    if (calendarContext === "trips") return "Rango fechas de viaje";
    if (calendarContext === "birthdays") return "Rango cumpleaños";
    if (calendarContext === "notes") return "Rango de notas";
    return "Rango vencimientos";
  }, [calendarContext]);

  const canShowFinanceStatusFilter =
    calendarContext === "payment_plans" || calendarContext === "operator_dues";

  const canShowPaxStatusFilter = calendarContext === "trips";

  const canShowTripsMode = calendarContext === "trips";

  const canShowNotesInfo = calendarContext === "notes";

  const canShowVendorFilter = calendarVisibility === "all";

  const activeDateRange = useMemo(() => {
    if (calendarContext === "trips") return travelDateRange;
    if (calendarContext === "birthdays") return birthdayDateRange;
    if (calendarContext === "notes") return notesDateRange;
    return dueDateRange;
  }, [
    birthdayDateRange,
    calendarContext,
    dueDateRange,
    notesDateRange,
    travelDateRange,
  ]);

  const setActiveDateRange = (field: "from" | "to", value: string) => {
    if (calendarContext === "trips") {
      setTravelDateRange((prev) => ({ ...prev, [field]: value }));
      return;
    }
    if (calendarContext === "birthdays") {
      setBirthdayDateRange((prev) => ({ ...prev, [field]: value }));
      return;
    }
    if (calendarContext === "notes") {
      setNotesDateRange((prev) => ({ ...prev, [field]: value }));
      return;
    }
    setDueDateRange((prev) => ({ ...prev, [field]: value }));
  };

  // Perfil + vendors + teams
  useEffect(() => {
    if (!token) return;
    setLoadingEvents(true);

    (async () => {
      try {
        const rProfile = await authFetch(
          "/api/user/profile",
          { cache: "no-store" },
          token,
        );
        if (!rProfile.ok) throw new Error("Error al obtener perfil");
        const p = (await rProfile.json()) as User;
        setProfile(p);

        const rUsers = await authFetch(
          `/api/users?agencyId=${p.id_agency}`,
          { cache: "no-store" },
          token,
        );
        if (!rUsers.ok) throw new Error("Error al obtener vendedores");
        const users = (await rUsers.json()) as User[];

        setVendors(users);
      } catch (e) {
        console.error(e);
      } finally {
        setLoadingEvents(false);
      }
    })();
  }, [token]);

  useEffect(() => {
    if (!token) return;
    let alive = true;

    (async () => {
      try {
        const res = await authFetch(
          "/api/resources/config",
          { cache: "no-store" },
          token,
        );
        if (!res.ok) {
          if (alive) {
            setResourceRule(null);
            setResourceHasCustomRule(false);
          }
          return;
        }
        const payload = (await res.json()) as {
          rules?: unknown;
          has_custom_rule?: boolean;
        };
        const parsed = normalizeResourceSectionRules(payload?.rules);
        if (!alive) return;
        setResourceRule(parsed[0] ?? null);
        setResourceHasCustomRule(
          typeof payload?.has_custom_rule === "boolean"
            ? payload.has_custom_rule
            : parsed.length > 0,
        );
      } catch {
        if (!alive) return;
        setResourceRule(null);
        setResourceHasCustomRule(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [token]);

  useEffect(() => {
    if (!token) return;
    let alive = true;

    (async () => {
      try {
        const res = await authFetch(
          "/api/finance/section-access",
          { cache: "no-store" },
          token,
        );
        if (!res.ok) {
          if (!alive) return;
          setFinanceSectionGrants([]);
          setFinanceSectionLoaded(true);
          return;
        }
        const payload = (await res.json()) as {
          rules?: unknown;
        };
        const rules = normalizeFinanceSectionRules(payload?.rules);
        if (!alive) return;
        setFinanceSectionGrants(rules[0]?.sections ?? []);
      } catch {
        if (!alive) return;
        setFinanceSectionGrants([]);
      } finally {
        if (!alive) return;
        setFinanceSectionLoaded(true);
      }
    })();

    return () => {
      alive = false;
    };
  }, [token]);

  useEffect(() => {
    if (!financeSectionLoaded) return;
    const allowed = new Set(availableContexts.map((item) => item.value));
    if (!allowed.has(calendarContext)) {
      setCalendarContext(availableContexts[0]?.value ?? "trips");
    }
  }, [availableContexts, calendarContext, financeSectionLoaded]);

  // Vendedores permitidos según rol
  const allowedVendors = useMemo(() => {
    if (!profile) return [];
    if (calendarVisibility === "own") {
      return vendors.filter((u) => u.id_user === profile.id_user);
    }
    return vendors;
  }, [calendarVisibility, profile, vendors]);

  // Autocompletar -> id de vendedor
  useEffect(() => {
    const match = allowedVendors.find(
      (u) => `${u.first_name} ${u.last_name}` === vendorInput,
    );
    setSelectedVendor(match ? match.id_user : 0);
  }, [vendorInput, allowedVendors]);

  useEffect(() => {
    if (calendarVisibility !== "own") return;
    setSelectedVendor(0);
  }, [calendarVisibility]);

  // Cargar eventos de calendario
  useEffect(() => {
    if (!token || !profile) return;
    if (
      (calendarContext === "payment_plans" && !canAccessPaymentPlansContext) ||
      (calendarContext === "operator_dues" && !canAccessOperatorDuesContext)
    ) {
      setEvents([]);
      setLoadingEvents(false);
      return;
    }

    const qs = new URLSearchParams();
    if (calendarVisibility === "own") {
      qs.append("userId", String(profile.id_user));
    } else if (selectedVendor) {
      qs.append("userId", String(selectedVendor));
    }

    if (
      calendarContext === "payment_plans" ||
      calendarContext === "operator_dues"
    ) {
      qs.append("context", "finance");
      if (calendarContext === "payment_plans") {
        qs.append("financeKinds", "client_payments");
      } else {
        qs.append("financeKinds", "operator_dues");
      }
      if (dueDateRange.from) qs.append("dueFrom", dueDateRange.from);
      if (dueDateRange.to) qs.append("dueTo", dueDateRange.to);
      qs.append("financeStatuses", selectedFinanceStatuses.join(","));
    } else if (calendarContext === "trips") {
      qs.append("context", "operations");
      qs.append("operationsKinds", "trips");
      if (selectedClientStatus !== "Todas") {
        qs.append("clientStatus", selectedClientStatus);
      }
      if (travelDateRange.from) qs.append("from", travelDateRange.from);
      if (travelDateRange.to) qs.append("to", travelDateRange.to);
      if (operationsMode === "services") qs.append("mode", "services");
    } else if (calendarContext === "birthdays") {
      qs.append("context", "operations");
      qs.append("operationsKinds", "birthdays");
      if (birthdayDateRange.from) qs.append("from", birthdayDateRange.from);
      if (birthdayDateRange.to) qs.append("to", birthdayDateRange.to);
    } else {
      qs.append("context", "operations");
      qs.append("operationsKinds", "notes");
      if (notesDateRange.from) qs.append("from", notesDateRange.from);
      if (notesDateRange.to) qs.append("to", notesDateRange.to);
    }

    setLoadingEvents(true);
    authFetch(`/api/calendar?${qs.toString()}`, { cache: "no-store" }, token)
      .then((r) => r.json() as Promise<CalendarEvent[]>)
      .then((data) => {
        const normalized = data.map((ev) => ({
          ...ev,
          allDay: true,
          extendedProps: {
            ...ev.extendedProps,
            kind:
              ev.extendedProps?.kind ??
              (String(ev.id).startsWith("n-")
                ? "note"
                : String(ev.id).startsWith("s-")
                  ? "service"
                  : String(ev.id).startsWith("cp-")
                    ? "client_payment"
                    : String(ev.id).startsWith("od-")
                      ? "operator_due"
                      : String(ev.id).startsWith("bd-")
                        ? "birthday"
                        : "booking"),
          },
        }));
        setEvents(normalized);
      })
      .catch(console.error)
      .finally(() => setLoadingEvents(false));
  }, [
    token,
    profile,
    calendarVisibility,
    selectedVendor,
    calendarContext,
    canAccessPaymentPlansContext,
    canAccessOperatorDuesContext,
    selectedClientStatus,
    travelDateRange,
    birthdayDateRange,
    notesDateRange,
    dueDateRange,
    operationsMode,
    selectedFinanceStatuses,
  ]);

  const handleViewChange = (view: ViewOption) => {
    calendarRef.current?.getApi().changeView(view);
    setCurrentView(view);
  };

  const getEventKind = (event: EventApi) => {
    const kind = (event.extendedProps as CalendarEvent["extendedProps"])?.kind;
    if (kind) return kind;
    if (event.id.startsWith("n-")) return "note";
    if (event.id.startsWith("s-")) return "service";
    if (event.id.startsWith("cp-")) return "client_payment";
    if (event.id.startsWith("od-")) return "operator_due";
    if (event.id.startsWith("bd-")) return "birthday";
    return "booking";
  };

  const getBookingRouteId = (event: EventApi) => {
    const props = event.extendedProps as CalendarEvent["extendedProps"];
    return props?.bookingPublicId ?? props?.bookingId ?? event.id.slice(2);
  };

  const handleEventDidMount = ({
    event,
    el,
  }: {
    event: EventApi;
    el: HTMLElement;
  }) => {
    const kind = getEventKind(event);
    const props = event.extendedProps as CalendarEvent["extendedProps"];
    const amountLabel =
      props?.amount != null && props?.currency
        ? `${new Intl.NumberFormat("es-AR", {
            style: "currency",
            currency: String(props.currency || "ARS").toUpperCase(),
            minimumFractionDigits: 2,
          }).format(props.amount)}`
        : null;
    const tooltip =
      kind === "note"
        ? `Nota: ${event.title}`
        : kind === "birthday"
          ? [
              event.title,
              props?.turningAge != null && `Cumple ${props.turningAge}`,
              props?.birthDate &&
                `Nac. ${formatDateInBuenosAires(props.birthDate, {
                  day: "2-digit",
                  month: "2-digit",
                })}`,
            ]
              .filter(Boolean)
              .join(" · ")
        : kind === "service"
          ? [
              event.title,
              props?.serviceType && `Servicio: ${props.serviceType}`,
              props?.destination && `Destino: ${props.destination}`,
              props?.description && `Detalle: ${props.description}`,
              props?.reference && `Ref: ${props.reference}`,
            ]
              .filter(Boolean)
              .join(" · ")
          : kind === "client_payment"
            ? [
                event.title,
                props?.paymentPublicId != null &&
                  `Cuota ${props.paymentPublicId}`,
                amountLabel,
                props?.status && `Estado: ${props.status}`,
              ]
                .filter(Boolean)
                .join(" · ")
            : kind === "operator_due"
              ? [
                  event.title,
                  props?.operatorDuePublicId != null &&
                    `Venc. ${props.operatorDuePublicId}`,
                  props?.details && `Concepto: ${props.details}`,
                  amountLabel,
                  props?.status && `Estado: ${props.status}`,
                ]
                  .filter(Boolean)
                  .join(" · ")
          : [
              event.title,
              props?.details && `Detalle: ${props.details}`,
              props?.paxCount != null && `Pax: ${props.paxCount}`,
              props?.servicesCount != null &&
                `Servicios: ${props.servicesCount}`,
            ]
              .filter(Boolean)
              .join(" · ");
    el.setAttribute("title", tooltip);
    el.style.cursor = "pointer";
  };

  const handleEventClick = ({ event }: { event: EventApi }) => {
    const kind = getEventKind(event);
    if (kind === "note") {
      const id = Number(event.id.slice(2));
      const { content, creator } = event.extendedProps as {
        content?: string;
        creator?: string;
      };
      setNoteModal({
        open: true,
        mode: "view",
        id,
        date: event.startStr,
        title: event.title,
        content: content ?? "",
        creator: creator ?? "",
      });
      return;
    }

    if (kind === "client_payment") {
      router.push("/finance/payment-plans");
      return;
    }
    if (kind === "birthday") {
      router.push("/clients/panel");
      return;
    }

    const bookingId = getBookingRouteId(event);
    if (!bookingId) {
      if (kind === "operator_due") {
        router.push("/operators/payments");
      }
      return;
    }
    router.push(`/bookings/services/${bookingId}`);
  };

  const handleDateClick = (arg: DateClickArg) => {
    if (calendarContext === "notes" && canManageCalendarNotes) {
      setNoteModal({
        open: true,
        mode: "create",
        date: arg.dateStr,
        title: "",
        content: "",
        creator: "",
      });
    }
  };

  // Crear nota
  const submitNote = async () => {
    if (!canManageCalendarNotes) {
      alert("No tenés permisos para crear notas.");
      return;
    }
    if (!form.title.trim()) {
      alert("El título es obligatorio");
      return;
    }

    setLoadingNote(true);
    try {
      const res = await authFetch(
        "/api/calendar/notes",
        {
          method: "POST",
          body: JSON.stringify({
            title: form.title.trim(),
            content: form.content.trim(),
            date: noteModal.date,
          }),
        },
        token,
      );

      if (!res.ok) {
        const error = await res.json();
        alert(error.error || "Error al crear la nota");
        return;
      }

      const newNote = await res.json();
      setEvents((prev) => [
        ...prev,
        {
          id: `n-${newNote.id}`,
          title: `${newNote.title}`,
          start: newNote.date,
          allDay: true,
          extendedProps: {
            kind: "note",
            content: newNote.content,
            creator: `${profile!.first_name} ${profile!.last_name}`,
          },
        },
      ]);
      setNoteModal((m) => ({ ...m, open: false }));
      setForm({ title: "", content: "" });
    } catch {
      alert("Ocurrió un error al crear la nota");
    } finally {
      setLoadingNote(false);
    }
  };

  // Eliminar nota
  const deleteNote = async (id: number) => {
    if (!canManageCalendarNotes) {
      alert("No tenés permisos para eliminar notas.");
      return;
    }
    if (!confirm("¿Seguro que querés eliminar esta nota?")) return;

    setLoadingNote(true);
    try {
      const res = await authFetch(
        `/api/calendar/${id}`,
        { method: "DELETE" },
        token,
      );

      if (res.status === 204) {
        setEvents((e) => e.filter((ev) => ev.id !== `n-${id}`));
        setNoteModal((m) => ({ ...m, open: false }));
      } else {
        alert("Error al eliminar");
      }
    } catch {
      alert("Ocurrió un error al eliminar la nota");
    } finally {
      setLoadingNote(false);
    }
  };

  // Actualizar nota
  const updateNote = async () => {
    if (!canManageCalendarNotes) {
      alert("No tenés permisos para editar notas.");
      return;
    }
    if (!noteModal.id) return;

    setLoadingNote(true);
    try {
      const res = await authFetch(
        `/api/calendar/${noteModal.id}`,
        {
          method: "PUT",
          body: JSON.stringify({
            title: form.title.trim(),
            content: form.content.trim(),
          }),
        },
        token,
      );

      if (!res.ok) {
        alert("Error al actualizar");
        return;
      }

      const updated = await res.json();
      setEvents((prev) =>
        prev.map((ev) =>
          ev.id === `n-${updated.id}`
            ? {
                ...ev,
                title: `${updated.title}`,
                extendedProps: {
                  ...ev.extendedProps!,
                  content: updated.content,
                },
              }
            : ev,
        ),
      );
      setNoteModal((m) => ({ ...m, open: false }));
    } catch {
      alert("Ocurrió un error al actualizar la nota");
    } finally {
      setLoadingNote(false);
    }
  };

  const onEditClick = () => {
    if (!canManageCalendarNotes) return;
    setForm({
      title: noteModal.title,
      content: noteModal.content,
    });
    setNoteModal((m) => ({ ...m, mode: "edit" }));
  };

  const formatShortDate = (value?: string | Date) => {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return new Intl.DateTimeFormat("es-AR", {
      day: "2-digit",
      month: "short",
    }).format(date);
  };

  const getStatusPillClass = (status: ClientStatus, selected: boolean) => {
    if (selected) {
      if (status === "Pendiente") {
        return "bg-amber-100/70 text-amber-950 ring-1 ring-amber-200/80 dark:bg-amber-400/15 dark:text-amber-100 dark:ring-amber-300/30";
      }
      if (status === "Pago") {
        return "bg-emerald-100/70 text-emerald-950 ring-1 ring-emerald-200/80 dark:bg-emerald-400/15 dark:text-emerald-100 dark:ring-emerald-300/30";
      }
      if (status === "Facturado") {
        return "bg-sky-100/70 text-sky-950 ring-1 ring-sky-200/80 dark:bg-sky-400/15 dark:text-sky-100 dark:ring-sky-300/30";
      }
      return "bg-white/80 text-sky-950 ring-1 ring-sky-200/80 dark:bg-white/10 dark:text-white dark:ring-white/10";
    }

    if (status === "Pendiente") {
      return "bg-amber-50/70 text-amber-900/70 ring-1 ring-amber-100/80 hover:bg-amber-100/60 dark:bg-amber-400/5 dark:text-amber-100/70 dark:ring-amber-300/20 dark:hover:bg-amber-400/10";
    }
    if (status === "Pago") {
      return "bg-emerald-50/70 text-emerald-900/70 ring-1 ring-emerald-100/80 hover:bg-emerald-100/60 dark:bg-emerald-400/5 dark:text-emerald-100/70 dark:ring-emerald-300/20 dark:hover:bg-emerald-400/10";
    }
    if (status === "Facturado") {
      return "bg-sky-50/70 text-sky-900/70 ring-1 ring-sky-100/80 hover:bg-sky-100/60 dark:bg-sky-400/5 dark:text-sky-100/70 dark:ring-sky-300/20 dark:hover:bg-sky-400/10";
    }
    return "bg-white/40 text-sky-950/70 ring-1 ring-sky-100/70 hover:bg-white/60 dark:bg-white/5 dark:text-white/60 dark:ring-white/10 dark:hover:bg-white/10";
  };

  const getFinanceStatusPillClass = (
    status: FinanceStatus,
    selected: boolean,
  ) => {
    if (selected) {
      if (status === "PENDIENTE") {
        return "bg-amber-100/70 text-amber-950 ring-1 ring-amber-200/80 dark:bg-amber-400/15 dark:text-amber-100 dark:ring-amber-300/30";
      }
      if (status === "VENCIDA") {
        return "bg-red-100/70 text-red-950 ring-1 ring-red-200/80 dark:bg-red-400/15 dark:text-red-100 dark:ring-red-300/30";
      }
      if (status === "PAGADA") {
        return "bg-emerald-100/70 text-emerald-950 ring-1 ring-emerald-200/80 dark:bg-emerald-400/15 dark:text-emerald-100 dark:ring-emerald-300/30";
      }
      return "bg-zinc-100/70 text-zinc-950 ring-1 ring-zinc-200/80 dark:bg-zinc-400/15 dark:text-zinc-100 dark:ring-zinc-300/30";
    }

    if (status === "PENDIENTE") {
      return "bg-amber-50/70 text-amber-900/70 ring-1 ring-amber-100/80 hover:bg-amber-100/60 dark:bg-amber-400/5 dark:text-amber-100/70 dark:ring-amber-300/20 dark:hover:bg-amber-400/10";
    }
    if (status === "VENCIDA") {
      return "bg-red-50/70 text-red-900/70 ring-1 ring-red-100/80 hover:bg-red-100/60 dark:bg-red-400/5 dark:text-red-100/70 dark:ring-red-300/20 dark:hover:bg-red-400/10";
    }
    if (status === "PAGADA") {
      return "bg-emerald-50/70 text-emerald-900/70 ring-1 ring-emerald-100/80 hover:bg-emerald-100/60 dark:bg-emerald-400/5 dark:text-emerald-100/70 dark:ring-emerald-300/20 dark:hover:bg-emerald-400/10";
    }
    return "bg-zinc-50/70 text-zinc-900/70 ring-1 ring-zinc-100/80 hover:bg-zinc-100/60 dark:bg-zinc-400/5 dark:text-zinc-100/70 dark:ring-zinc-300/20 dark:hover:bg-zinc-400/10";
  };

  const toggleFinanceStatus = (status: FinanceStatus) => {
    setSelectedFinanceStatuses((prev) => {
      if (prev.includes(status)) {
        const next = prev.filter((item) => item !== status);
        return next.length > 0 ? next : prev;
      }
      return [...prev, status];
    });
  };

  const eventClassNames = ({ event }: { event: EventApi }) => {
    const kind = getEventKind(event);
    const base = [
      "rounded-2xl",
      "border",
      "shadow-sm",
      "backdrop-blur",
      "px-2",
      "py-1",
      "whitespace-normal",
      "transition",
      "hover:scale-[1.01]",
    ];

    if (kind === "note") {
      return [
        ...base,
        "!bg-amber-100/70",
        "!text-sky-950",
        "border-amber-200/70",
        "dark:!bg-amber-400/10",
        "dark:!text-amber-100",
        "dark:border-amber-300/20",
      ];
    }

    if (kind === "service") {
      return [
        ...base,
        "!bg-emerald-100/70",
        "!text-sky-950",
        "border-emerald-200/70",
        "dark:!bg-emerald-400/10",
        "dark:!text-emerald-100",
        "dark:border-emerald-300/20",
      ];
    }

    if (kind === "client_payment") {
      return [
        ...base,
        "!bg-violet-100/70",
        "!text-sky-950",
        "border-violet-200/70",
        "dark:!bg-violet-400/10",
        "dark:!text-violet-100",
        "dark:border-violet-300/20",
      ];
    }

    if (kind === "operator_due") {
      return [
        ...base,
        "!bg-rose-100/70",
        "!text-sky-950",
        "border-rose-200/70",
        "dark:!bg-rose-400/10",
        "dark:!text-rose-100",
        "dark:border-rose-300/20",
      ];
    }
    if (kind === "birthday") {
      return [
        ...base,
        "!bg-pink-100/70",
        "!text-sky-950",
        "border-pink-200/70",
        "dark:!bg-pink-400/10",
        "dark:!text-pink-100",
        "dark:border-pink-300/20",
      ];
    }

    return [
      ...base,
      "!bg-sky-100/70",
      "!text-sky-950",
      "border-sky-200/80",
      "dark:!bg-sky-400/10",
      "dark:!text-sky-100",
      "dark:border-sky-300/20",
    ];
  };

  const renderEventContent = (arg: EventContentArg) => {
    const kind = getEventKind(arg.event);
    const props = arg.event.extendedProps as CalendarEvent["extendedProps"];
    const isDay = arg.view.type === "dayGridDay";
    const showDetails = isDay || detailMode === "detail";
    const noteSnippet =
      props?.content && props.content.length > 80
        ? `${props.content.slice(0, 80)}…`
        : props?.content;
    const amountLabel =
      props?.amount != null && props?.currency
        ? new Intl.NumberFormat("es-AR", {
            style: "currency",
            currency: String(props.currency || "ARS").toUpperCase(),
            minimumFractionDigits: 2,
          }).format(props.amount)
        : null;

    const secondaryLine =
      kind === "booking"
        ? props?.details
        : kind === "birthday"
          ? props?.birthDate
            ? `Nacimiento ${formatDateInBuenosAires(props.birthDate, {
                day: "2-digit",
                month: "short",
              })}`
            : undefined
        : kind === "service"
          ? [props?.serviceType, props?.destination, props?.description]
              .filter(Boolean)
              .join(" · ")
          : kind === "client_payment"
            ? [props?.serviceType, props?.description].filter(Boolean).join(" · ")
            : kind === "operator_due"
              ? [props?.details, props?.serviceType, props?.description]
                  .filter(Boolean)
                  .join(" · ")
          : noteSnippet;

    const badges: { label: string; tone: "sky" | "emerald" | "amber" }[] = [];
    if (kind === "booking") {
      if (props?.paxCount != null) {
        badges.push({ label: `Pax ${props.paxCount}`, tone: "emerald" });
      }
      if (props?.servicesCount != null) {
        badges.push({
          label: `Servicios ${props.servicesCount}`,
          tone: "sky",
        });
      }
      const returnLabel = formatShortDate(props?.returnDate);
      if (returnLabel) {
        badges.push({ label: `Regreso ${returnLabel}`, tone: "sky" });
      }
      if (props?.clientStatus) {
        badges.push({ label: props.clientStatus, tone: "amber" });
      }
    }
    if (kind === "service") {
      if (props?.reference) {
        badges.push({ label: `Ref ${props.reference}`, tone: "sky" });
      }
      const returnLabel = formatShortDate(props?.returnDate);
      if (returnLabel) {
        badges.push({ label: `Regreso ${returnLabel}`, tone: "sky" });
      }
      if (props?.clientStatus) {
        badges.push({ label: props.clientStatus, tone: "amber" });
      }
    }
    if (kind === "note" && props?.creator) {
      badges.push({ label: props.creator, tone: "sky" });
    }
    if (kind === "client_payment") {
      if (props?.paymentPublicId != null) {
        badges.push({ label: `Cuota ${props.paymentPublicId}`, tone: "sky" });
      }
      if (amountLabel) {
        badges.push({ label: amountLabel, tone: "emerald" });
      }
      if (props?.status) {
        badges.push({ label: props.status, tone: "amber" });
      }
    }
    if (kind === "operator_due") {
      if (props?.operatorDuePublicId != null) {
        badges.push({ label: `Venc. ${props.operatorDuePublicId}`, tone: "sky" });
      }
      if (amountLabel) {
        badges.push({ label: amountLabel, tone: "emerald" });
      }
      if (props?.status) {
        badges.push({ label: props.status, tone: "amber" });
      }
    }
    if (kind === "birthday") {
      if (props?.turningAge != null) {
        badges.push({ label: `Cumple ${props.turningAge}`, tone: "amber" });
      }
      const birthLabel = formatShortDate(props?.birthDate);
      if (birthLabel) {
        badges.push({ label: `Nac. ${birthLabel}`, tone: "sky" });
      }
    }

    const icon = isDay ? (
      kind === "note" ? (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          className="size-3"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M16.862 4.487 19.5 7.125m-2.638-2.638L7.5 13.85l-1 4.15 4.15-1 9.212-9.213a2.121 2.121 0 0 0-3-3Z"
          />
        </svg>
      ) : kind === "client_payment" ? (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          className="size-3"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3.75 8.25h16.5m-15 0 1.5-3h10.5l1.5 3m-12 0V18a1.5 1.5 0 0 0 1.5 1.5h8.25a1.5 1.5 0 0 0 1.5-1.5V8.25M9 12h6"
          />
        </svg>
      ) : kind === "operator_due" ? (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          className="size-3"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 6v6l3.75 2.25M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
          />
        </svg>
      ) : kind === "service" ? (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          className="size-3"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="m14.25 6.087 1.5-1.5a2.121 2.121 0 1 1 3 3l-1.5 1.5m-3-3 3 3m-3-3-6.364 6.364a2.121 2.121 0 0 0-.621 1.5V17.5h3.55a2.12 2.12 0 0 0 1.5-.621L18 10.5m-4.5 9.75H19.5"
          />
        </svg>
      ) : kind === "birthday" ? (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          className="size-3"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 3v3m-4.5 1.5h9A2.25 2.25 0 0 1 18.75 9.75v2.625A2.625 2.625 0 0 1 21 15v3.75A2.25 2.25 0 0 1 18.75 21H5.25A2.25 2.25 0 0 1 3 18.75V15a2.625 2.625 0 0 1 2.25-2.625V9.75A2.25 2.25 0 0 1 7.5 7.5Zm0 6.75h9"
          />
        </svg>
      ) : (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          className="size-3"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M8 6.75h8m-8 3.5h8m-8 3.5h8M6.75 3.75h10.5A1.5 1.5 0 0 1 18.75 5.25v13.5a1.5 1.5 0 0 1-1.5 1.5H6.75a1.5 1.5 0 0 1-1.5-1.5V5.25a1.5 1.5 0 0 1 1.5-1.5Z"
          />
        </svg>
      )
    ) : detailMode === "name" ? (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        className="size-3"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M15.75 7.5a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.5 19.5a7.5 7.5 0 0 1 15 0v.75H4.5v-.75Z"
        />
      </svg>
    ) : (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        className="size-3"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M8.25 6.75h7.5m-7.5 3.75h7.5m-7.5 3.75h4.5M5.25 3.75h10.5A2.25 2.25 0 0 1 18 6v12a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 18V6a2.25 2.25 0 0 1 2.25-2.25Z"
        />
      </svg>
    );

    return (
      <div
        className={`flex flex-col ${isDay ? "gap-1" : "gap-0.5"} text-sky-950 dark:text-sky-100`}
      >
        <div className="flex items-center gap-1">
          <span className="flex size-4 items-center justify-center rounded-full bg-white/70 text-sky-950/80 dark:bg-white/10 dark:text-white/80">
            {icon}
          </span>
          <span
            className={`font-semibold ${isDay ? "text-sm" : "text-[11px]"}`}
          >
            {arg.event.title}
          </span>
        </div>
        {showDetails && secondaryLine ? (
          <span className={`${isDay ? "text-xs" : "text-[10px]"} opacity-80`}>
            {secondaryLine}
          </span>
        ) : null}
        {isDay && badges.length ? (
          <div className="mt-0.5 flex flex-wrap gap-1">
            {badges.map((badge) => (
              <span
                key={`${badge.tone}-${badge.label}`}
                className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  badge.tone === "emerald"
                    ? "bg-emerald-200/70 text-emerald-900 ring-1 ring-emerald-300/60 dark:bg-emerald-300/20 dark:text-emerald-100 dark:ring-emerald-300/30"
                    : badge.tone === "amber"
                      ? "bg-amber-200/70 text-amber-900 ring-1 ring-amber-300/60 dark:bg-amber-300/20 dark:text-amber-100 dark:ring-amber-300/30"
                      : "bg-sky-200/70 text-sky-900 ring-1 ring-sky-300/60 dark:bg-sky-300/20 dark:text-sky-100 dark:ring-sky-300/30"
                }`}
              >
                {badge.label}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <ProtectedRoute>
      <div className="space-y-6 p-6">
        <div className="flex justify-center">
          <h1 className="text-3xl font-semibold">Calendario</h1>
        </div>

        <div className="rounded-3xl border border-sky-200/60 bg-white/20 p-4 text-sky-950 shadow-md shadow-sky-950/10 backdrop-blur dark:border-white/10 dark:bg-white/10 dark:text-white">
          <div className="grid grid-cols-1 items-end gap-4">
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-sky-950/60 dark:text-white/60">
                Contexto
              </span>
              <div className="flex flex-wrap items-center gap-1 rounded-full border border-indigo-200/70 bg-indigo-100/20 p-1 shadow-inner shadow-indigo-950/5 dark:border-indigo-300/20 dark:bg-indigo-400/5 dark:shadow-none">
                {availableContexts.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    title={option.label}
                    onClick={() => setCalendarContext(option.value)}
                    className={`h-10 min-w-[108px] flex-1 cursor-pointer justify-center whitespace-nowrap rounded-full px-2 text-[11px] transition sm:px-3 sm:text-xs ${
                      calendarContext === option.value
                        ? "bg-indigo-100/5 text-indigo-950 shadow-sm shadow-indigo-950/10 ring-1 ring-indigo-200/80 dark:bg-indigo-400/5 dark:text-indigo-100 dark:ring-indigo-300/30"
                        : "text-sky-950/60 hover:bg-white/40 dark:text-white/60 dark:hover:bg-white/10"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-sky-200/60 pt-3 dark:border-white/10">
            <div className="flex flex-wrap items-center gap-2 text-xs text-sky-950/70 dark:text-white/70">
              <span className="rounded-full border border-white/20 bg-white/30 px-3 py-1 dark:bg-white/10">
                {calendarContextLabel}
              </span>
              {canShowNotesInfo && (
                <span className="rounded-full border border-white/20 bg-white/30 px-3 py-1 dark:bg-white/10">
                  {canManageCalendarNotes
                    ? "Click en una fecha para crear nota"
                    : "Notas en modo solo lectura"}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setShowAdvancedFilters((prev) => !prev)}
              className="rounded-full border border-sky-200/80 bg-white/40 px-4 py-2 text-xs font-medium transition hover:bg-white/60 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
            >
              {showAdvancedFilters
                ? "Ocultar filtros avanzados"
                : "Mostrar filtros avanzados"}
            </button>
          </div>

          {showAdvancedFilters && (
            <div className="mt-4 grid grid-cols-1 items-end gap-4 border-t border-sky-200/60 pt-4 dark:border-white/10 md:grid-cols-2">
              <div className="flex flex-col gap-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-sky-950/60 dark:text-white/60">
                  Vista
                </span>
                <div className="grid grid-cols-3 items-center gap-1 rounded-full border border-sky-200/70 bg-sky-100/20 p-1 shadow-inner shadow-sky-950/5 dark:border-white/10 dark:bg-white/5 dark:shadow-none">
                  {(
                    ["dayGridMonth", "dayGridWeek", "dayGridDay"] as ViewOption[]
                  ).map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => handleViewChange(v)}
                      className={`h-9 min-w-0 cursor-pointer justify-center whitespace-nowrap rounded-full px-2 text-xs transition ${
                        currentView === v
                          ? "bg-white/80 text-sky-950 shadow-sm shadow-sky-950/10 ring-1 ring-sky-200/80 dark:bg-white/10 dark:text-white dark:ring-white/10"
                          : "text-sky-950/60 hover:bg-white/40 dark:text-white/60 dark:hover:bg-white/10"
                      }`}
                    >
                      {v === "dayGridMonth"
                        ? "Mes"
                        : v === "dayGridWeek"
                          ? "Semana"
                          : "Día"}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block cursor-text text-sm font-medium dark:text-white">
                  {activeRangeLabel}
                </label>
                <div className="mt-1 flex items-center gap-2">
                  <input
                    type="date"
                    value={activeDateRange.from}
                    onChange={(e) => setActiveDateRange("from", e.target.value)}
                    className="cursor-text rounded-2xl border border-sky-200/70 bg-white/20 px-3 py-2 text-sm outline-none transition focus:border-sky-300/80 focus:ring-2 focus:ring-sky-200/40 dark:border-white/10 dark:bg-white/10 dark:text-white dark:focus:border-white/30 dark:focus:ring-white/10"
                  />
                  <span className="text-sky-950 dark:text-white">–</span>
                  <input
                    type="date"
                    value={activeDateRange.to}
                    onChange={(e) => setActiveDateRange("to", e.target.value)}
                    className="cursor-text rounded-2xl border border-sky-200/70 bg-white/20 px-3 py-2 text-sm outline-none transition focus:border-sky-300/80 focus:ring-2 focus:ring-sky-200/40 dark:border-white/10 dark:bg-white/10 dark:text-white dark:focus:border-white/30 dark:focus:ring-white/10"
                  />
                </div>
              </div>

              {canShowTripsMode && (
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-sky-950/60 dark:text-white/60">
                    Tipo de viaje
                  </span>
                  <div className="flex flex-wrap items-center gap-1 rounded-full border border-emerald-200/70 bg-emerald-100/20 p-1 shadow-inner shadow-emerald-950/5 dark:border-emerald-300/20 dark:bg-emerald-400/5 dark:shadow-none">
                    <button
                      onClick={() => setOperationsMode("bookings")}
                      type="button"
                      className={`flex-1 cursor-pointer justify-center rounded-full px-4 py-2 text-xs transition ${
                        operationsMode === "bookings"
                          ? "bg-emerald-100/5 text-emerald-950 shadow-sm shadow-emerald-950/10 ring-1 ring-emerald-200/80 dark:bg-emerald-400/5 dark:text-emerald-100 dark:ring-emerald-300/30"
                          : "text-sky-950/60 hover:bg-white/40 dark:text-white/60 dark:hover:bg-white/10"
                      }`}
                    >
                      Reservas
                    </button>
                    <button
                      onClick={() => setOperationsMode("services")}
                      type="button"
                      className={`flex-1 cursor-pointer justify-center rounded-full px-4 py-2 text-xs transition ${
                        operationsMode === "services"
                          ? "bg-emerald-100/5 text-emerald-950 shadow-sm shadow-emerald-950/10 ring-1 ring-emerald-200/80 dark:bg-emerald-400/5 dark:text-emerald-100 dark:ring-emerald-300/30"
                          : "text-sky-950/60 hover:bg-white/40 dark:text-white/60 dark:hover:bg-white/10"
                      }`}
                    >
                      Servicios
                    </button>
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-sky-950/60 dark:text-white/60">
                  Detalle
                </span>
                <div className="grid grid-cols-2 items-center gap-1 rounded-full border border-amber-200/70 bg-amber-100/20 p-1 shadow-inner shadow-amber-950/5 dark:border-amber-300/20 dark:bg-amber-400/5 dark:shadow-none">
                  <button
                    type="button"
                    onClick={() => setDetailMode("name")}
                    className={`h-10 min-w-0 cursor-pointer justify-center whitespace-nowrap rounded-full px-2 text-[11px] transition sm:text-xs ${
                      detailMode === "name"
                        ? "bg-amber-100/5 text-amber-950 shadow-sm shadow-amber-950/10 ring-1 ring-amber-200/80 dark:bg-amber-400/15 dark:text-amber-100 dark:ring-amber-300/30"
                        : "text-amber-900/70 hover:bg-amber-100/50 dark:text-amber-100/70 dark:hover:bg-amber-400/10"
                    }`}
                  >
                    Solo nombre
                  </button>
                  <button
                    type="button"
                    onClick={() => setDetailMode("detail")}
                    className={`h-10 min-w-0 cursor-pointer justify-center whitespace-nowrap rounded-full px-2 text-[11px] transition sm:text-xs ${
                      detailMode === "detail"
                        ? "bg-amber-100/5 text-amber-950 shadow-sm shadow-amber-950/10 ring-1 ring-amber-200/80 dark:bg-amber-400/15 dark:text-amber-100 dark:ring-amber-300/30"
                        : "text-amber-900/70 hover:bg-amber-100/50 dark:text-amber-100/70 dark:hover:bg-amber-400/10"
                    }`}
                  >
                    Nombre + detalle
                  </button>
                </div>
              </div>

              {canShowVendorFilter && (
                <div className="min-w-[200px]">
                  <label className="block cursor-text text-sm font-medium dark:text-white">
                    Vendedor
                  </label>
                  <input
                    list="vendors-list"
                    value={vendorInput}
                    onChange={(e) => setVendorInput(e.target.value)}
                    placeholder="Buscar vendedor..."
                    className="mt-1 w-full appearance-none rounded-2xl border border-sky-200/70 bg-white/20 px-3 py-2 text-sm outline-none transition focus:border-sky-300/80 focus:ring-2 focus:ring-sky-200/40 dark:border-white/10 dark:bg-white/10 dark:text-white dark:focus:border-white/30 dark:focus:ring-white/10"
                  />
                  <datalist id="vendors-list">
                    {allowedVendors.map((v) => (
                      <option
                        key={v.id_user}
                        value={`${v.first_name} ${v.last_name}`}
                      />
                    ))}
                  </datalist>
                </div>
              )}

              {canShowPaxStatusFilter && (
                <div>
                  <label className="block cursor-text text-sm font-medium dark:text-white">
                    Estado pax
                  </label>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {clientStatusOptions.map((status) => (
                      <button
                        key={status}
                        type="button"
                        onClick={() => setSelectedClientStatus(status)}
                        className={`rounded-full px-3 py-1 text-xs transition ${getStatusPillClass(
                          status,
                          selectedClientStatus === status,
                        )}`}
                      >
                        {status}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {canShowFinanceStatusFilter && (
                <div>
                  <label className="block cursor-text text-sm font-medium dark:text-white">
                    Estado financiero
                  </label>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {financeStatusOptions.map((status) => (
                      <button
                        key={status}
                        type="button"
                        onClick={() => toggleFinanceStatus(status)}
                        className={`rounded-full px-3 py-1 text-xs transition ${getFinanceStatusPillClass(
                          status,
                          selectedFinanceStatuses.includes(status),
                        )}`}
                      >
                        {status}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="">
          {loadingEvents ? (
            <div className="flex h-[400px] items-center justify-center">
              <Spinner />
            </div>
          ) : (
            <>
              <div className="mb-4 flex items-center justify-center py-2">
                <div className="flex gap-4">
                  <button
                    onClick={() => calendarRef.current?.getApi().prev()}
                    className="flex w-full items-center text-sm tracking-wide text-sky-950/60 transition-all hover:text-sky-950 dark:text-white/60 hover:dark:text-white"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="size-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={1.4}
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M15.75 19.5 8.25 12l7.5-7.5"
                      />
                    </svg>
                    anterior
                  </button>

                  <p className="flex items-center gap-2 text-2xl font-semibold text-sky-950 dark:text-white">
                    {calendarTitle}
                    <span className="text-sm font-light text-sky-950/80 dark:text-white/80">
                      {calendarYear}
                    </span>
                  </p>

                  <button
                    onClick={() => calendarRef.current?.getApi().next()}
                    className="flex items-center text-sm tracking-wide text-sky-950/60 transition-all hover:text-sky-950 dark:text-white/60 hover:dark:text-white"
                  >
                    siguiente
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="size-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={1.4}
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="m8.25 4.5 7.5 7.5-7.5 7.5"
                      />
                    </svg>
                  </button>
                </div>
              </div>
              <div className="overflow-hidden rounded-3xl border border-sky-200/60 bg-gradient-to-br from-white/60 via-white/10 to-sky-50/30 p-4 text-sky-950 shadow-md shadow-sky-950/10 backdrop-blur dark:border-white/10 dark:from-white/10 dark:via-white/5 dark:to-sky-900/10 dark:text-white">
                <FullCalendar
                  ref={calendarRef}
                  plugins={[dayGridPlugin, interactionPlugin]}
                  initialView={currentView}
                  timeZone="America/Argentina/Buenos_Aires"
                  locale={esLocale}
                  headerToolbar={false}
                  dayHeaderFormat={{ weekday: "long" }}
                  dayHeaderClassNames={() => ["capitalize"]}
                  datesSet={(arg) => {
                    if (arg.view.type !== "dayGridMonth") {
                      const yearTitle = new Intl.DateTimeFormat("es-AR", {
                        year: "numeric",
                      }).format(arg.view.currentStart);
                      if (arg.view.type === "dayGridDay") {
                        const dayTitle = new Intl.DateTimeFormat("es-AR", {
                          day: "numeric",
                          month: "long",
                        }).format(arg.view.currentStart);
                        setCalendarTitle(
                          dayTitle.charAt(0).toUpperCase() + dayTitle.slice(1),
                        );
                        setCalendarYear(yearTitle);
                        return;
                      }

                      const monthTitle = new Intl.DateTimeFormat("es-AR", {
                        month: "long",
                      }).format(arg.view.currentStart);
                      setCalendarTitle(
                        monthTitle.charAt(0).toUpperCase() +
                          monthTitle.slice(1),
                      );
                      setCalendarYear(yearTitle);
                      return;
                    }

                    const fullTitle = arg.view.title;
                    const onlyMonth = fullTitle.split(" ")[0];
                    const parts = fullTitle.split(" ");
                    setCalendarYear(parts[parts.length - 1]);
                    setCalendarTitle(
                      onlyMonth.charAt(0).toUpperCase() + onlyMonth.slice(1),
                    );
                  }}
                  fixedWeekCount={false}
                  showNonCurrentDates={false}
                  buttonText={{ today: "Hoy" }}
                  events={events}
                  eventClassNames={eventClassNames}
                  eventContent={renderEventContent}
                  eventDidMount={handleEventDidMount}
                  eventClick={handleEventClick}
                  dateClick={handleDateClick}
                  height="auto"
                />
              </div>
            </>
          )}
        </div>

        {noteModal.open && noteModal.mode === "create" && (
          <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
            <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-sky-900/5 p-6 text-sky-950 shadow-md shadow-sky-950/10 backdrop-blur-2xl dark:bg-white/20 dark:text-white">
              <h2 className="mb-2 flex justify-between text-lg font-semibold dark:text-white">
                Nueva nota
                <span className="text-base font-normal">
                  {formatDateInBuenosAires(noteModal.date)}
                </span>
              </h2>
              <input
                type="text"
                placeholder="Título"
                value={form.title}
                onChange={(e) =>
                  setForm((f) => ({ ...f, title: e.target.value }))
                }
                disabled={loadingNote}
                className={`mb-2 w-full rounded-2xl border border-sky-950/10 bg-white/10 px-3 py-2 outline-none dark:border-white/10 dark:bg-white/10 dark:text-white ${
                  loadingNote ? "cursor-not-allowed opacity-50" : ""
                }`}
              />
              <textarea
                placeholder="Contenido"
                value={form.content}
                onChange={(e) =>
                  setForm((f) => ({ ...f, content: e.target.value }))
                }
                disabled={loadingNote}
                rows={4}
                className={`mb-4 w-full rounded-2xl border border-sky-950/10 bg-white/10 px-3 py-2 outline-none dark:border-white/10 dark:bg-white/10 dark:text-white ${
                  loadingNote ? "cursor-not-allowed opacity-50" : ""
                }`}
              />
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setNoteModal((m) => ({ ...m, open: false }))}
                  className="rounded-full bg-red-600 px-6 py-2 text-center text-red-100 shadow-sm shadow-red-950/20 transition-transform hover:scale-95 active:scale-90 dark:bg-red-800"
                  disabled={loadingNote}
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
                      d="M6 18 18 6M6 6l12 12"
                    />
                  </svg>
                </button>
                <button
                  onClick={submitNote}
                  disabled={loadingNote}
                  className={`rounded-full bg-sky-100 px-6 py-2 text-sky-950 shadow-sm shadow-sky-950/20 transition-transform hover:scale-95 active:scale-90 dark:bg-white/10 dark:text-white dark:backdrop-blur ${
                    loadingNote
                      ? "cursor-not-allowed bg-sky-100/80 text-sky-950/80 dark:text-white/50"
                      : ""
                  }`}
                >
                  {loadingNote ? <Spinner /> : "Crear"}
                </button>
              </div>
            </div>
          </div>
        )}

        {noteModal.open && noteModal.mode === "view" && (
          <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
            <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-sky-900/5 p-6 text-sky-950 shadow-md shadow-sky-950/10 backdrop-blur-2xl dark:bg-white/20 dark:text-white">
              <h2 className="mb-2 text-xl font-semibold dark:text-white">
                {noteModal.title}
              </h2>
              <p className="mb-1 text-sm text-gray-500 dark:text-gray-400">
                Creada por <strong>{noteModal.creator}</strong> el{" "}
                {formatDateInBuenosAires(noteModal.date)}
              </p>
              <div className="mb-6 whitespace-pre-wrap dark:text-white">
                {noteModal.content || <em>(Sin contenido adicional)</em>}
              </div>
              <div className="flex gap-3">
                {canManageCalendarNotes && (
                  <>
                    <button
                      onClick={onEditClick}
                      className="rounded-full bg-sky-100 px-6 py-2 text-sky-950 shadow-sm shadow-sky-950/20 transition-transform hover:scale-95 active:scale-90 dark:bg-white/10 dark:text-white dark:backdrop-blur"
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
                          d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10"
                        />
                      </svg>
                    </button>
                    <button
                      onClick={() =>
                        noteModal.id !== undefined && deleteNote(noteModal.id)
                      }
                      className={`rounded-full bg-red-600 px-6 py-2 text-center text-red-100 shadow-sm shadow-red-950/20 transition-transform hover:scale-95 active:scale-90 dark:bg-red-800 ${
                        loadingNote
                          ? "cursor-not-allowed bg-red-600/80 text-red-100/80 dark:bg-red-800/80"
                          : ""
                      }`}
                      disabled={loadingNote}
                    >
                      {loadingNote ? (
                        <Spinner />
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
                            d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
                          />
                        </svg>
                      )}
                    </button>
                  </>
                )}

                <div className="flex w-full justify-end">
                  <button
                    onClick={() => setNoteModal((m) => ({ ...m, open: false }))}
                    className="rounded-full bg-sky-100 px-6 py-2 text-sky-950 shadow-sm shadow-sky-950/20 transition-transform hover:scale-95 active:scale-90 dark:bg-white/10 dark:text-white dark:backdrop-blur"
                    disabled={loadingNote}
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
                        d="M6 18 18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {noteModal.open && noteModal.mode === "edit" && (
          <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
            <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-sky-900/5 p-6 text-sky-950 shadow-md shadow-sky-950/10 backdrop-blur-2xl dark:bg-white/20 dark:text-white">
              <h2 className="mb-2 text-xl font-semibold dark:text-white">
                Editar nota: {noteModal.date}
              </h2>
              <input
                type="text"
                placeholder="Título"
                value={form.title}
                onChange={(e) =>
                  setForm((f) => ({ ...f, title: e.target.value }))
                }
                disabled={loadingNote}
                className={`mb-2 w-full rounded-2xl border border-sky-950/10 bg-white/10 px-3 py-2 outline-none dark:border-white/10 dark:bg-white/10 dark:text-white ${
                  loadingNote ? "cursor-not-allowed opacity-50" : ""
                }`}
              />
              <textarea
                placeholder="Contenido"
                value={form.content}
                onChange={(e) =>
                  setForm((f) => ({ ...f, content: e.target.value }))
                }
                disabled={loadingNote}
                rows={4}
                className={`mb-4 w-full rounded-2xl border border-sky-950/10 bg-white/10 px-3 py-2 outline-none dark:border-white/10 dark:bg-white/10 dark:text-white ${
                  loadingNote ? "cursor-not-allowed opacity-50" : ""
                }`}
              />
              <div className="flex justify-between">
                <button
                  onClick={updateNote}
                  disabled={loadingNote}
                  className={`rounded-full bg-sky-100 px-6 py-2 text-sky-950 shadow-sm shadow-sky-950/20 transition-transform hover:scale-95 active:scale-90 dark:bg-white/10 dark:text-white dark:backdrop-blur ${
                    loadingNote
                      ? "cursor-not-allowed bg-sky-100/80 text-sky-950/80 dark:text-white/50"
                      : ""
                  }`}
                >
                  {loadingNote ? "Guardando..." : "Guardar"}
                </button>
                <button
                  onClick={() => setNoteModal((m) => ({ ...m, open: false }))}
                  className="rounded-full bg-red-600 px-6 py-2 text-center text-red-100 shadow-sm shadow-red-950/20 transition-transform hover:scale-95 active:scale-90 dark:bg-red-800"
                  disabled={loadingNote}
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
                      d="M6 18 18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </ProtectedRoute>
  );
}
