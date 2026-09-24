// src/components/Header.tsx
/* eslint-disable @next/next/no-img-element */
"use client";

import ThemeToggle from "@/components/ThemeToggle";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

interface HeaderProps {
  toggleMenu: () => void;
  menuOpen: boolean;
  toggleSidebar?: () => void;
  sidebarHidden?: boolean;
  showSidebar?: boolean;
}

const WA_NUMBER = process.env.NEXT_PUBLIC_WA_NUMBER ?? "54911XXXXXXXX";
const WA_MSG = encodeURIComponent("Hola, quiero más info sobre Ofistur.");
const WA_URL = `https://wa.me/${WA_NUMBER}?text=${WA_MSG}`;

/* ---------- Botones renovados (solo light) ---------- */
function WhatsAppBtn() {
  return (
    <a
      href={WA_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={[
        "inline-flex items-center gap-2 rounded-full",
        "border border-emerald-300/50 bg-emerald-50/70 px-3.5 py-1.5",
        "text-sm font-medium text-emerald-900 shadow-sm",
        "transition-[background-color,transform] hover:-translate-y-0.5 hover:bg-emerald-50/90 active:scale-[0.98]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40",
      ].join(" ")}
      aria-label="Escribir por WhatsApp"
    >
      <IconWhatsApp className="size-4" />
      <span>WhatsApp</span>
    </a>
  );
}

function PlatformBtn() {
  return (
    <div className="inline-flex transition-transform hover:-translate-y-0.5 active:scale-[0.98]">
      <Link
        href="/login"
        className={[
          "inline-flex items-center gap-2 rounded-full",
          "border border-sky-300/50 bg-sky-50/70 px-3.5 py-1.5 text-sm font-medium text-sky-900",
          "shadow-md shadow-sky-950/10 transition-colors",
          "hover:bg-sky-50/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/40",
          "active:scale-[0.99]",
        ].join(" ")}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="size-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M8.25 9V5.25A2.25 2.25 0 0 1 10.5 3h6A2.25 2.25 0 0 1 18.75 5.25V18A2.25 2.25 0 0 1 16.5 20.25h-6A2.25 2.25 0 0 1 8.25 18V15M12 9l3 3m0 0-3 3m3-3H3.75"
          />
        </svg>
        Plataforma
      </Link>
    </div>
  );
}

export default function Header({
  toggleMenu,
  menuOpen,
  toggleSidebar,
  sidebarHidden = false,
  showSidebar = true,
}: HeaderProps) {
  const pathname = usePathname() || "/";
  const isLoginPage = pathname === "/login";
  const isLanding = pathname === "/";

  const [open, setOpen] = useState(false);
  const islandRef = useRef<HTMLDivElement | null>(null);
  const [panelTop, setPanelTop] = useState<number>(96); // fallback seguro

  useLayoutEffect(() => {
    if (!isLanding || !open || !islandRef.current) return;
    const island = islandRef.current;
    const measure = () => {
      const rect = island.getBoundingClientRect();
      setPanelTop(Math.max(72, rect.bottom + 10));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(island);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [isLanding, open]);

  // Bloqueo del scroll del body cuando el menú está abierto (mejor UX móvil)
  useEffect(() => {
    const b = document.body;
    if (open) {
      const prev = b.style.overflow;
      b.style.overflow = "hidden";
      return () => {
        b.style.overflow = prev;
      };
    }
  }, [open]);

  /* ---------- Header LANDING ---------- */
  if (isLanding) {
    return (
      <>
        <div className="pointer-events-none fixed inset-x-0 top-3 z-[70] flex justify-center sm:top-4 sm:px-4">
          <div className="pointer-events-auto w-full">
            <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
              <div
                ref={islandRef}
                className={[
                  "mx-auto flex items-center justify-between gap-2",
                  "rounded-[22px] sm:rounded-[28px]",
                  "border border-white/30 bg-white/55 shadow-lg shadow-sky-950/10 backdrop-blur-md",
                ].join(" ")}
              >
                {/* Paddings fijos para evitar saltos */}
                <div className="flex w-full items-center justify-between px-3.5 py-2.5 sm:px-5 sm:py-3">
                  {/* Brand */}
                  <Link
                    href="/"
                    className="flex select-none items-center gap-1"
                  >
                    <img src="/logo-dark.png" alt="" className="size-6" />
                    <p className="text-base font-medium tracking-tight text-sky-950">
                      Ofis<span className="font-light">tur</span>
                    </p>
                  </Link>

                  {/* Nav desktop */}
                  <nav className="hidden items-center gap-5 text-sm text-sky-950 md:flex">
                    {[
                      { href: "#producto", label: "Producto" },
                      { href: "#roles", label: "Para roles" },
                      { href: "#seguridad", label: "Seguridad" },
                      { href: "#faq", label: "FAQ" },
                      { href: "#pricing", label: "Precios" },
                      { href: "#contacto", label: "Contacto" },
                    ].map((item) => (
                      <a
                        key={item.href}
                        href={item.href}
                        className="rounded-full px-3 py-1 transition-colors hover:bg-white/50"
                      >
                        {item.label}
                      </a>
                    ))}
                  </nav>

                  {/* Acciones */}
                  <div className="flex items-center gap-1 sm:gap-2">
                    <div className="hidden items-center gap-1 sm:gap-2 md:flex">
                      <WhatsAppBtn />
                      <PlatformBtn />
                    </div>
                    {/* Toggle menú móvil */}
                    <button
                      type="button"
                      onClick={() => setOpen((v) => !v)}
                      className="ml-1 inline-flex size-9 items-center justify-center rounded-full border border-white/40 bg-white/60 text-sky-950 shadow-sm transition hover:bg-white/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/40 md:hidden"
                      aria-label="Abrir menú"
                      aria-expanded={open}
                    >
                      {open ? (
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          className="size-5"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M6 18L18 6M6 6l12 12"
                          />
                        </svg>
                      ) : (
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          className="size-5"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M4 6h16M4 12h16M4 18h16"
                          />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Menú móvil (anclado bajo la isla, nunca se corta) */}
        {open && (
          <>
            <button
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-[65] bg-black/20 backdrop-blur-[2px] md:hidden"
              aria-label="Cerrar menú"
            />
            <div
              className="fixed z-[75] md:hidden"
              style={{
                top: panelTop + 10,
                left: 0,
                right: 0,
                // márgenes seguros a los lados (safe areas + padding)
                paddingLeft: "clamp(0.75rem, 3vw, 2rem)",
                paddingRight: "clamp(0.75rem, 3vw, 2rem)",
              }}
            >
              <div className="mx-auto w-full max-w-7xl">
                <div className="rounded-2xl border border-white/30 bg-white/75 p-3 text-sky-950 shadow-xl backdrop-blur-xl">
                  <ul className="divide-y divide-white/30">
                    {[
                      { href: "#producto", label: "Producto" },
                      { href: "#roles", label: "Para roles" },
                      { href: "#seguridad", label: "Seguridad" },
                      { href: "#faq", label: "FAQ" },
                      { href: "#contacto", label: "Contacto" },
                    ].map((item) => (
                      <li key={item.href}>
                        <a
                          href={item.href}
                          onClick={() => setOpen(false)}
                          className="block px-2 py-3"
                        >
                          {item.label}
                        </a>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
                    <WhatsAppBtn />
                    <PlatformBtn />
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </>
    );
  }

  /* ---------- Header PLATAFORMA (ligero y responsive, solo light) ---------- */
  return (
    <header className="z-50 flex w-full items-center justify-between px-4 py-6 text-sky-950 dark:text-sky-100 md:top-0">
      {isLoginPage && (
        <Link href={`/`}>
          <img
            src="/logo.png"
            alt=""
            className="absolute bottom-4 right-4 z-50 size-14 transition-transform hover:scale-105 active:scale-95"
          />
        </Link>
      )}
      {!isLoginPage && showSidebar && toggleSidebar && (
        <div
          className={`absolute left-4 hidden items-center gap-2 transition-[opacity,transform] duration-300 ease-out md:left-8 md:flex ${
            sidebarHidden
              ? "translate-x-0 opacity-100"
              : "pointer-events-none -translate-x-2 opacity-0"
          }`}
          aria-hidden={!sidebarHidden}
        >
          <button
            type="button"
            onClick={toggleSidebar}
            className="group inline-flex items-center gap-2 rounded-full border border-sky-200 bg-white/70 px-3 py-1.5 text-sm font-medium text-sky-900 shadow-sm transition hover:bg-white/90"
            aria-label="Mostrar sidebar"
            aria-pressed={sidebarHidden}
            tabIndex={sidebarHidden ? 0 : -1}
          >
            <span>Mostrar menú</span>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="size-4 transition-transform duration-300 group-hover:-translate-x-0.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </button>
        </div>
      )}
      <div className="flex w-full flex-auto justify-start md:justify-center">
        {!isLoginPage ? (
          <div className="flex select-none items-center gap-1">
            <div className="hidden dark:block">
              <img src="/logo.png" alt="" className="size-5" />
            </div>
            <div className="block dark:hidden">
              <img src="/logo-dark.png" alt="" className="size-5" />
            </div>
            <p className="text-base font-medium tracking-tight">
              Ofis<span className="font-light">tur</span>
            </p>
          </div>
        ) : (
          <p className="text-lg font-medium text-sky-950">
            Ofis<span className="font-light">tur</span>
          </p>
        )}
      </div>

      <div className="absolute right-4 flex items-center gap-2 md:right-8">
        {!isLoginPage && <ThemeToggle />}
        {!isLoginPage && (
          <button
            className="relative inline-flex size-9 items-center justify-center rounded-full border border-sky-200 bg-white/70 text-sky-900 shadow-sm transition hover:bg-white/90 md:hidden"
            onClick={toggleMenu}
            aria-label={menuOpen ? "Cerrar menu" : "Abrir menu"}
            aria-expanded={menuOpen}
          >
            <span
              className={`absolute h-0.5 w-4 rounded bg-current transition-transform duration-300 ${
                menuOpen ? "translate-y-0 rotate-45" : "-translate-y-1.5"
              }`}
            />
            <span
              className={`absolute h-0.5 w-4 rounded bg-current transition-opacity duration-300 ${
                menuOpen ? "opacity-0" : "opacity-100"
              }`}
            />
            <span
              className={`absolute h-0.5 w-4 rounded bg-current transition-transform duration-300 ${
                menuOpen ? "translate-y-0 -rotate-45" : "translate-y-1.5"
              }`}
            />
          </button>
        )}
      </div>
    </header>
  );
}

/* ---------- Iconos ---------- */
function IconWhatsApp(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="1em"
      height="1em"
      viewBox="0 0 464 488"
      {...props}
    >
      <path
        fill="#064e3b"
        d="M462 228q0 93-66 159t-160 66q-56 0-109-28L2 464l40-120q-32-54-32-116q0-93 66-158.5T236 4t160 65.5T462 228zM236 39q-79 0-134.5 55.5T46 228q0 62 36 111l-24 70l74-23q49 31 104 31q79 0 134.5-55.5T426 228T370.5 94.5T236 39zm114 241q-1-1-10-7q-3-1-19-8.5t-19-8.5q-9-3-13 2q-1 3-4.5 7.5t-7.5 9t-5 5.5q-4 6-12 1q-34-17-45-27q-7-7-13.5-15t-12-15t-5.5-8q-3-7 3-11q4-6 8-10l6-9q2-5-1-10q-4-13-17-41q-3-9-12-9h-11q-9 0-15 7q-19 19-19 45q0 24 22 57l2 3q2 3 4.5 6.5t7 9t9 10.5t10.5 11.5t13 12.5t14.5 11.5t16.5 10t18 8.5q16 6 27.5 10t18 5t9.5 1t7-1t5-1q9-1 21.5-9t15.5-17q8-21 3-26z"
      ></path>
    </svg>
  );
}
