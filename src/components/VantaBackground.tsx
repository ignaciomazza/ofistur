// src/components/VantaBackground.tsx
"use client";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import initVantaFog, { VantaOptions } from "vanta/dist/vanta.fog.min";
import useVantaPerformance from "@/hooks/useVantaPerformance";
import { canUseWebGL } from "@/lib/webgl";

// Tipado manual del efecto Vanta
type VantaEffect = { destroy: () => void };

export default function VantaBackground() {
  const vantaRef = useRef<HTMLDivElement>(null);
  const vantaEffect = useRef<VantaEffect | null>(null);
  const [currentTheme, setCurrentTheme] = useState<"light" | "dark">("light");
  const [webglBlocked, setWebglBlocked] = useState(false);
  const { mode, monitorFps } = useVantaPerformance();

  const getOptions = (
    theme: "light" | "dark",
    quality: "full" | "lite",
  ): VantaOptions => ({
    el: vantaRef.current!,
    THREE,
    mouseControls: quality === "full",
    touchControls: quality === "full",
    gyroControls: false,
    minHeight: 200.0,
    minWidth: 200.0,
    blurFactor: quality === "full" ? 0.9 : 0.6,
    speed: quality === "full" ? 0.5 : 0.25,
    zoom: quality === "full" ? 0.3 : 0.2,
    ...(theme === "light"
      ? {
          baseColor: 0xffffff,
          highlightColor: 0xdff0ff,
          midtoneColor: 0xffffff,
          lowlightColor: 0xffffff,
        }
      : {
          baseColor: 0x070721,
          highlightColor: 0x2d41,
          midtoneColor: 0x62059,
          lowlightColor: 0x4042a,
        }),
  });

  useEffect(() => {
    if (typeof document === "undefined") return;

    const syncTheme = () => {
      const isDark = document.documentElement.classList.contains("dark");
      setCurrentTheme(isDark ? "dark" : "light");
    };

    syncTheme();

    const observer = new MutationObserver(syncTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => observer.disconnect();
  }, []);

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

    vantaEffect.current?.destroy();
    let stopMonitor: (() => void) | undefined;
    try {
      vantaEffect.current = initVantaFog(getOptions(currentTheme, mode));
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
  }, [currentTheme, mode, monitorFps, webglBlocked]);

  const fallbackClass =
    currentTheme === "dark"
      ? "bg-[radial-gradient(70%_60%_at_50%_0%,#0b1120_0%,#020617_60%)]"
      : "bg-[radial-gradient(70%_60%_at_50%_0%,#e0f2fe_0%,#ffffff_60%)]";

  return (
    <div
      ref={vantaRef}
      className={`fixed left-0 top-0 -z-10 min-h-screen w-full transition-colors duration-500 ${fallbackClass}`}
    />
  );
}
