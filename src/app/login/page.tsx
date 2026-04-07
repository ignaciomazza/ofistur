// src/app/login/page.tsx
"use client";

import { useState, useEffect, useRef } from "react";
import * as THREE from "three";
import initVantaFog, { VantaOptions } from "vanta/dist/vanta.fog.min";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import Spinner from "@/components/Spinner";
import { toast, ToastContainer } from "react-toastify";
import { motion, AnimatePresence } from "framer-motion";
import { authFetch } from "@/utils/authFetch";
import useVantaPerformance from "@/hooks/useVantaPerformance";
import { canUseWebGL } from "@/lib/webgl";

export default function LoginPage() {
  const vantaRef = useRef<HTMLDivElement>(null);
  const vantaEffect = useRef<{ destroy(): void } | null>(null);
  const { mode, monitorFps } = useVantaPerformance();
  const [webglBlocked, setWebglBlocked] = useState(false);

  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [emailError, setEmailError] = useState<string>("");
  const [passwordError, setPasswordError] = useState<string>("");
  const { setToken } = useAuth();
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);

  const [preloading, setPreloading] = useState<boolean>(true);
  const [progress, setProgress] = useState<number>(0);

  const [showSpinner, setShowSpinner] = useState<boolean>(false);
  const spinnerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (mode === "off" || webglBlocked) {
      vantaEffect.current?.destroy();
      vantaEffect.current = null;
      return;
    }

    if (!vantaRef.current) return;
    if (!canUseWebGL()) {
      setWebglBlocked(true);
      vantaEffect.current?.destroy();
      vantaEffect.current = null;
      return;
    }

    const options: VantaOptions = {
      el: vantaRef.current,
      THREE,
      mouseControls: mode === "full",
      touchControls: mode === "full",
      gyroControls: false,
      minHeight: 200.0,
      minWidth: 200.0,
      highlightColor: 0xbae6fd,
      midtoneColor: 0xffffff,
      lowlightColor: 0xffffff,
      baseColor: 0xffffff,
      blurFactor: mode === "full" ? 0.9 : 0.6,
      speed: mode === "full" ? 2.7 : 1.2,
      zoom: mode === "full" ? 0.3 : 0.2,
    };

    vantaEffect.current?.destroy();
    let stopMonitor: (() => void) | undefined;
    try {
      vantaEffect.current = initVantaFog(options);
      stopMonitor = monitorFps();
    } catch {
      setWebglBlocked(true);
      vantaEffect.current = null;
      return;
    }

    return () => {
      stopMonitor?.();
      vantaEffect.current?.destroy();
      vantaEffect.current = null;
    };
  }, [mode, monitorFps, webglBlocked]);

  // Limpieza del timeout si el componente se desmonta
  useEffect(() => {
    return () => {
      if (spinnerTimerRef.current) clearTimeout(spinnerTimerRef.current);
    };
  }, []);

  // Simulación de progreso preloader
  useEffect(() => {
    const duration = 2000;
    const intervalTime = 50;
    const steps = duration / intervalTime;
    let currentStep = 0;
    const interval = setInterval(() => {
      currentStep++;
      setProgress(Math.min(100, Math.floor((currentStep / steps) * 100)));
      if (currentStep >= steps) {
        clearInterval(interval);
        setPreloading(false);
      }
    }, intervalTime);
    return () => clearInterval(interval);
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
    <>
      {/* 1) Filtro SVG en la misma página */}
      <svg aria-hidden style={{ position: "absolute", width: 0, height: 0 }}>
        <filter id="noiseFilter">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="1"
            numOctaves="1"
            seed="2"
          >
            <animate
              attributeName="baseFrequency"
              dur="1s"
              values="0.6;0.8;0.6"
              repeatCount="indefinite"
            />
          </feTurbulence>
          <feComponentTransfer>
            <feFuncA type="linear" slope="0.2" />
          </feComponentTransfer>
        </filter>
      </svg>

      {/* 2) Contenedor Vanta + overlay de ruido */}
      <motion.div
        ref={vantaRef}
        className="fixed inset-0 flex items-center justify-center overflow-hidden bg-[radial-gradient(70%_60%_at_50%_0%,#e0f2fe_0%,#ffffff_60%)] dark:bg-[radial-gradient(70%_60%_at_50%_0%,#0b1120_0%,#020617_60%)]"
      >
        <div
          className="pointer-events-none absolute inset-0 z-10"
          style={{ filter: "url(#noiseFilter)" }}
        />
        <AnimatePresence mode="wait" initial={false}>
          {preloading ? (
            <motion.div
              key="loader"
              className="absolute inset-0 z-20 flex items-center justify-center"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5 }}
            >
              <div className="h-1 w-48 overflow-hidden rounded-full bg-sky-950/10 backdrop-blur">
                <motion.div
                  className="h-full bg-sky-200 backdrop-blur"
                  initial={{ width: 0 }}
                  animate={{ width: `${progress}%` }}
                  transition={{ duration: 0.05 }}
                />
              </div>
            </motion.div>
          ) : (
            <motion.form
              key="form"
              ref={formRef}
              onSubmit={handleSubmit}
              className="relative z-20 mx-4 w-full max-w-lg space-y-6 rounded-3xl border border-sky-100/10 bg-sky-100/30 p-8 shadow-xl shadow-sky-950/10 backdrop-blur transition-colors duration-300 ease-in-out"
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: -20 }}
              transition={{ type: "spring", stiffness: 80, damping: 15 }}
              style={{ willChange: "opacity, transform" }}
              noValidate
            >
              <h2 className="text-center text-3xl text-sky-950/80">
                Iniciar Sesión
              </h2>

              {/* Campos de Email */}
              <div className="space-y-1">
                <label
                  htmlFor="email"
                  className="ml-1 block text-sm font-light text-sky-950/80"
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
                    className={`input-glass w-full rounded-xl border border-sky-950/10 bg-white/10 px-4 py-2 pr-10 text-base text-sky-950 outline-none transition-colors placeholder:text-sky-950/50 focus:border-sky-950/30 focus:ring-1 focus:ring-sky-950/30 ${
                      emailError ? "border-red-600 focus:ring-red-300" : ""
                    }`}
                  />
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="absolute right-3 top-1/2 size-5 -translate-y-1/2 text-sky-950/50"
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
                  className="ml-1 block text-sm font-light text-sky-950/80"
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
                    className={`input-glass w-full rounded-xl border border-sky-950/10 bg-white/10 px-4 py-2 pr-10 text-base text-sky-950 outline-none transition-colors placeholder:text-sky-950/50 focus:border-sky-950/30 focus:ring-1 focus:ring-sky-950/30 ${
                      passwordError ? "border-red-600 focus:ring-red-300" : ""
                    }`}
                  />
                  <button
                    id="toggle-password-visibility"
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-sky-950/75 transition-opacity hover:opacity-100"
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
                  className="flex w-full justify-center rounded-full bg-sky-100 px-12 py-3 text-base text-sky-950 shadow-sm shadow-sky-950/20 backdrop-blur transition-transform hover:scale-95 focus:outline-none focus:ring-1 focus:ring-sky-950/50 active:scale-90"
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

              <p className="mt-2 text-center text-xs font-light tracking-wide text-sky-950/60">
                © 2025 Ofist
              </p>
            </motion.form>
          )}
        </AnimatePresence>

        {showSpinner && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/40">
            <Spinner />
          </div>
        )}

        <ToastContainer position="top-right" autoClose={3000} />
      </motion.div>
    </>
  );
}
