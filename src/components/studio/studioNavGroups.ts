export type StudioNavGroup = {
  title: string;
  links: Array<{ href: string; label: string }>;
};

export const STUDIO_NAV_GROUPS: StudioNavGroup[] = [
  {
    title: "General",
    links: [
      { href: "/profile", label: "Perfil" },
      { href: "/quick-load", label: "Carga rápida" },
    ],
  },
  {
    title: "Pasajeros",
    links: [
      { href: "/clients", label: "Pasajeros" },
      { href: "/client-stats", label: "Estadísticas" },
      { href: "/clients/config", label: "Configuración" },
    ],
  },
  {
    title: "Reservas",
    links: [
      { href: "/bookings", label: "Reservas" },
      { href: "/insights", label: "Estadísticas" },
      { href: "/invoices", label: "Facturas" },
      { href: "/bookings/config", label: "Configuración" },
    ],
  },
  {
    title: "Grupales",
    links: [
      { href: "/groups", label: "Grupales" },
      { href: "/groups/config", label: "Configuración" },
    ],
  },
  {
    title: "Ventas",
    links: [
      { href: "/quotes", label: "Cotizaciones" },
      { href: "/templates", label: "Estudio PDF" },
      { href: "/quotes/config", label: "Configuración" },
    ],
  },
  {
    title: "Finanzas",
    links: [
      { href: "/cashbox", label: "Caja" },
      { href: "/credits", label: "Créditos" },
      { href: "/finance/pases-saldo", label: "Pases de saldo" },
      { href: "/investments", label: "Inversión" },
      { href: "/receipts", label: "Recibos" },
      { href: "/finance/payment-plans", label: "Planes de pago" },
      { href: "/other-incomes", label: "Ingresos" },
      { href: "/receipts/verify", label: "Verificación ingresos" },
      { href: "/balances", label: "Saldos" },
      { href: "/earnings", label: "Ganancias" },
      { href: "/earnings/my", label: "Mis ganancias" },
      { href: "/finance/config", label: "Finanzas" },
    ],
  },
  {
    title: "Operadores",
    links: [
      { href: "/operators", label: "Operadores" },
      { href: "/operators/payments", label: "Pagos" },
      { href: "/operators/panel", label: "Panel" },
    ],
  },
  {
    title: "Recursos",
    links: [
      { href: "/resources", label: "Recursos" },
      { href: "/calendar", label: "Calendario" },
      { href: "/templates", label: "Estudio PDF" },
    ],
  },
  {
    title: "Agencia",
    links: [
      { href: "/agency", label: "Agencia" },
      { href: "/agency/subscription", label: "Suscripción" },
      { href: "/agency/storage", label: "Almacenamiento" },
      { href: "/arca", label: "Conectar ARCA" },
      { href: "/users", label: "Usuarios" },
      { href: "/teams", label: "Equipos" },
    ],
  },
  {
    title: "Dev",
    links: [
      { href: "/dev/agencies", label: "Agencias" },
      { href: "/dev/agencies/leads", label: "Leads" },
      { href: "/dev/collections/fx", label: "Cotización BSP" },
      { href: "/dev/collections/recurring", label: "Cobranzas recurrentes" },
    ],
  },
];
