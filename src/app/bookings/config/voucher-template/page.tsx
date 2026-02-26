"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import Spinner from "@/components/Spinner";
import { useAuth } from "@/context/AuthContext";
import { authFetch } from "@/utils/authFetch";
import TemplateConfigContainer from "@/components/template-config/TemplateConfigContainer";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

type Role =
  | "gerente"
  | "desarrollador"
  | "administrativo"
  | "equipo"
  | "vendedor"
  | "lider"
  | "marketing"
  | "admin"
  | "administrador"
  | "dev"
  | string;

function canManageTemplateConfig(role: string | null | undefined): boolean {
  const normalized = String(role || "").trim().toLowerCase();
  return [
    "gerente",
    "administrativo",
    "admin",
    "administrador",
    "desarrollador",
    "dev",
    "developer",
  ].includes(normalized);
}

export default function BookingVoucherTemplatePage() {
  const { token } = useAuth();
  const [role, setRole] = useState<Role | null>(null);
  const [loadingRole, setLoadingRole] = useState(true);

  useEffect(() => {
    if (!token) {
      setRole(null);
      setLoadingRole(false);
      return;
    }

    const controller = new AbortController();
    (async () => {
      try {
        setLoadingRole(true);
        const res = await authFetch(
          "/api/user/profile",
          { cache: "no-store", signal: controller.signal },
          token,
        );
        const data = (await res.json().catch(() => ({}))) as { role?: string };
        if (!res.ok) throw new Error("Error al obtener perfil");
        setRole((data.role || "").toLowerCase() as Role);
      } catch {
        setRole(null);
      } finally {
        setLoadingRole(false);
      }
    })();

    return () => controller.abort();
  }, [token]);

  const canAccess = canManageTemplateConfig(role);

  return (
    <ProtectedRoute>
      {loadingRole ? (
        <div className="flex min-h-[60vh] items-center justify-center">
          <Spinner />
        </div>
      ) : !canAccess ? (
        <section className="mx-auto max-w-3xl p-6 text-slate-900 dark:text-white">
          <h1 className="text-2xl font-semibold">Confirmación de reservas</h1>
          <p className="mt-2 text-sm opacity-80">
            No tenés permisos para acceder a esta configuración.
          </p>
          <Link
            href="/bookings/config"
            className="mt-4 inline-flex items-center rounded-full border border-slate-200/70 bg-white px-4 py-2 text-sm shadow-sm shadow-slate-900/5 transition hover:scale-[0.98] dark:border-white/10 dark:bg-white/5"
          >
            Volver a Configuración de Reservas
          </Link>
          <ToastContainer />
        </section>
      ) : (
        <>
          <TemplateConfigContainer docType="voucher" />
          <ToastContainer />
        </>
      )}
    </ProtectedRoute>
  );
}
