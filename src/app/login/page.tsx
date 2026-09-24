// src/app/login/page.tsx
"use client";

import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import Spinner from "@/components/Spinner";
import { toast, ToastContainer } from "react-toastify";
import { authFetch } from "@/utils/authFetch";

export default function LoginPage() {
  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [emailError, setEmailError] = useState<string>("");
  const [passwordError, setPasswordError] = useState<string>("");
  const { setToken } = useAuth();
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);

  const [showSpinner, setShowSpinner] = useState<boolean>(false);
  const spinnerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Limpieza del timeout si el componente se desmonta
  useEffect(() => {
    return () => {
      if (spinnerTimerRef.current) clearTimeout(spinnerTimerRef.current);
    };
  }, []);

  const validateEmail = (value: string) => {
    const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return regex.test(value);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    formRef.current?.classList.remove("animate-shake");

    let valid = true;
    if (!validateEmail(email)) {
      setEmailError("Por favor, ingresá un email válido.");
      valid = false;
    } else {
      setEmailError("");
    }
    if (password.trim().length < 6) {
      setPasswordError("La contraseña debe tener al menos 6 caracteres.");
      valid = false;
    } else {
      setPasswordError("");
    }
    if (!valid) {
      formRef.current?.classList.add("animate-shake");
      return;
    }

    setLoading(true);
    spinnerTimerRef.current = setTimeout(() => {
      setShowSpinner(true);
    }, 300);

    try {
      const response = await authFetch(
        "/api/login",
        {
          method: "POST",
          body: JSON.stringify({ email, password }),
        },
        null, // sin token en login
      );

      if (spinnerTimerRef.current) {
        clearTimeout(spinnerTimerRef.current);
        spinnerTimerRef.current = null;
      }
      setShowSpinner(false);

      if (!response.ok) {
        let msg = "Error al iniciar sesión";
        try {
          const errorData = await response.json();
          msg = errorData.error || msg;
        } catch {
          // por si la API no devuelve JSON
        }
        formRef.current?.classList.add("animate-shake");
        toast.error(msg);
        return;
      }

      const data = await response.json();
      setToken(data.token);
      router.push("/profile");
    } catch {
      if (spinnerTimerRef.current) {
        clearTimeout(spinnerTimerRef.current);
        spinnerTimerRef.current = null;
      }
      setShowSpinner(false);
      formRef.current?.classList.add("animate-shake");
      toast.error("Ha ocurrido un error inesperado");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center overflow-hidden bg-[radial-gradient(70%_60%_at_50%_0%,#e0f2fe_0%,#ffffff_60%)] dark:bg-[radial-gradient(70%_60%_at_50%_0%,#0b1120_0%,#020617_60%)]">
      <form
        ref={formRef}
        onSubmit={handleSubmit}
        className="relative z-20 mx-4 w-full max-w-lg space-y-6 rounded-3xl border border-sky-100/10 bg-white/80 p-8 shadow-xl shadow-sky-950/10 dark:bg-slate-900/80 dark:text-white"
        noValidate
      >
        <h2 className="text-center text-3xl text-sky-950/80 dark:text-sky-100">
          Iniciar Sesión
        </h2>

        {/* Campos de Email */}
        <div className="space-y-1">
          <label
            htmlFor="email"
            className="ml-1 block text-sm font-light text-sky-950/80 dark:text-sky-100/80"
          >
            Email
          </label>
          <div className="relative">
            <input
              id="email"
              type="email"
              value={email}
              placeholder="juanperez@correo.com"
              onChange={(e) => setEmail(e.target.value)}
              required
              aria-invalid={!!emailError}
              aria-describedby="email-error"
              autoFocus
              className={`input-glass w-full rounded-xl border border-sky-950/10 bg-white/10 px-4 py-2 pr-10 text-base text-sky-950 outline-none transition-colors placeholder:text-sky-950/50 focus:border-sky-950/30 focus:ring-1 focus:ring-sky-950/30 dark:border-sky-100/20 dark:text-sky-100 dark:placeholder:text-sky-100/50 ${
                emailError ? "border-red-600 focus:ring-red-300" : ""
              }`}
            />
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="absolute right-3 top-1/2 size-5 -translate-y-1/2 text-sky-950/50 dark:text-sky-100/50"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21 12.79V7.5a2.5 2.5 0 00-2.5-2.5H5.5A2.5 2.5 0 003 7.5v9a2.5 2.5 0 002.5 2.5h9.29M21 12.79L12 18.5l-9-5.71"
              />
            </svg>
          </div>
          {emailError && (
            <span
              id="email-error"
              className="text-xs text-red-600"
              role="alert"
              aria-live="polite"
            >
              {emailError}
            </span>
          )}
        </div>

        {/* Campos de Contraseña */}
        <div className="space-y-1">
          <label
            htmlFor="password"
            className="ml-1 block text-sm font-light text-sky-950/80 dark:text-sky-100/80"
          >
            Contraseña
          </label>
          <div className="relative">
            <input
              id="password"
              type={showPassword ? "text" : "password"}
              value={password}
              placeholder="••••••••"
              onChange={(e) => setPassword(e.target.value)}
              required
              aria-invalid={!!passwordError}
              aria-describedby="password-error"
              className={`input-glass w-full rounded-xl border border-sky-950/10 bg-white/10 px-4 py-2 pr-10 text-base text-sky-950 outline-none transition-colors placeholder:text-sky-950/50 focus:border-sky-950/30 focus:ring-1 focus:ring-sky-950/30 dark:border-sky-100/20 dark:text-sky-100 dark:placeholder:text-sky-100/50 ${
                passwordError ? "border-red-600 focus:ring-red-300" : ""
              }`}
            />
            <button
              id="toggle-password-visibility"
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-sky-950/75 transition-opacity hover:opacity-100 dark:text-sky-100/75"
              aria-label={
                showPassword ? "Ocultar contraseña" : "Mostrar contraseña"
              }
            >
              {showPassword ? (
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
                    d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
                  />
                </svg>
              ) : (
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
                    d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88"
                  />
                </svg>
              )}
            </button>
          </div>
          {passwordError && (
            <span
              id="password-error"
              className="text-xs text-red-600"
              role="alert"
              aria-live="polite"
            >
              {passwordError}
            </span>
          )}
        </div>

        {/* Botón submit */}
        <div className="flex justify-center">
          <button
            type="submit"
            disabled={loading}
            className="flex w-full justify-center rounded-full bg-sky-100 px-12 py-3 text-base text-sky-950 shadow-sm shadow-sky-950/20 transition-transform hover:scale-95 focus:outline-none focus:ring-1 focus:ring-sky-950/50 active:scale-90"
          >
            {loading ? (
              <Spinner />
            ) : (
              <div className="flex gap-1">
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
                    d="M8.25 9V5.25A2.25 2.25 0 0 1 10.5 3h6a2.25 2.25 0 0 1 2.25 2.25v13.5A2.25 2.25 0 0 1 16.5 21h-6a2.25 2.25 0 0 1-2.25-2.25V15M12 9l3 3m0 0-3 3m3-3H2.25"
                  />
                </svg>
                <p className="">Ingresar</p>
              </div>
            )}
          </button>
        </div>

        <p className="mt-2 text-center text-xs font-light tracking-wide text-sky-950/60 dark:text-sky-100/60">
          © 2025 Ofist
        </p>
      </form>

      {showSpinner && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/40">
          <Spinner />
        </div>
      )}

      <ToastContainer position="top-right" autoClose={3000} />
    </div>
  );
}
