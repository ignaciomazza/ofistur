// src/components/LayoutWrapper.tsx
"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Header from "./Header";
import SideBar from "./SideBar";
import VantaBackground from "./VantaBackground";
import SubscriptionStatusBanner from "@/components/billing/SubscriptionStatusBanner";

export default function LayoutWrapper({
  children,
}: {
  children: React.ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const pathname = usePathname() || "";

  const toggleMenu = () => setMenuOpen(!menuOpen);
  const closeMenu = () => setMenuOpen(false);
  const toggleSidebar = () => setSidebarHidden((v) => !v);

  const isLoginPage = pathname === "/login";
  const isLanding = pathname === "/"; // ✅ NUEVO
  const isQr = pathname === "/qr";
  const isQuoteStudio = /^\/quotes\/[^/]+\/template$/.test(pathname);
  const isTemplatesStudio = pathname === "/templates";
  const isBookingVoucherStudio = /^\/bookings\/services\/[^/]+\/template$/.test(pathname);
  const isTemplateConfigStudio = /^\/template-config\/[^/]+$/.test(pathname);
  const isStudioPage =
    isQuoteStudio ||
    isTemplatesStudio ||
    isBookingVoucherStudio ||
    isTemplateConfigStudio;

  // ✅ En landing forzamos modo claro (sin dark)
  useEffect(() => {
    if (isLanding) {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("theme", "light");
    }
  }, [isLanding]);

  const showSidebar = !isLoginPage && !isLanding && !isQr && !isStudioPage; // ✅ sin sidebar en landing y modo estudio
  const showVanta = !isLoginPage; // mantenemos Vanta (en light queda bien)

  // Bloqueo del scroll cuando el menú lateral está abierto (mejor UX móvil)
  useEffect(() => {
    if (!showSidebar) return;
    const b = document.body;
    if (menuOpen) {
      const prev = b.style.overflow;
      b.style.overflow = "hidden";
      return () => {
        b.style.overflow = prev;
      };
    }
  }, [menuOpen, showSidebar]);

  return (
    <div className="flex min-h-screen flex-col text-sky-950 dark:text-white">
      {showVanta && <VantaBackground />}
      {!isQr && (
        <Header
          toggleMenu={toggleMenu}
          menuOpen={menuOpen}
          toggleSidebar={toggleSidebar}
          sidebarHidden={sidebarHidden}
          showSidebar={showSidebar}
        />
      )}
      <div
        className={`flex min-w-0 flex-1 ${isLoginPage ? "items-center justify-center" : ""}`}
      >
        {showSidebar && (
          <div
            className={`fixed inset-0 z-40 bg-sky-950/20 backdrop-blur-sm transition-opacity duration-300 ease-out md:hidden ${
              menuOpen ? "opacity-100" : "pointer-events-none opacity-0"
            }`}
            onClick={closeMenu}
            aria-hidden="true"
          />
        )}
        {showSidebar && (
          <SideBar
            menuOpen={menuOpen}
            closeMenu={closeMenu}
            currentPath={pathname}
            collapsed={sidebarHidden}
            toggleCollapsed={toggleSidebar}
          />
        )}
        <main
          className={`min-w-0 flex-1 transition-[margin,max-width,padding] duration-300 ease-out ${
            isStudioPage ? "px-0 pb-0 md:px-0" : "px-2 pb-6 md:px-6"
          } ${
            showSidebar
              ? sidebarHidden
                ? "md:mx-auto md:max-w-7xl md:px-8"
                : "md:pl-56 md:pr-8"
            : ""
          }`}
        >
          {showSidebar && <SubscriptionStatusBanner />}
          {children}
        </main>
      </div>
      <style jsx global>{`
        select {
          background-color: white;
          color: #0f172a;
        }
        .dark select {
          background-color: #000;
          color: #fff;
        }
        select option {
          background-color: white;
          color: #0f172a;
        }
        .dark select option {
          background-color: #000;
          color: #fff;
        }
      `}</style>
    </div>
  );
}
