"use client";

import { useCallback, useEffect, useState } from "react";
import { canUseWebGL } from "@/lib/webgl";

type NetworkInformation = {
  effectiveType?: "slow-2g" | "2g" | "3g" | "4g";
  saveData?: boolean;
};

const DEFAULT_CORES = 8;
const DEFAULT_MEMORY_GB = 8;
const LOW_END_CORES = 4;
const LOW_END_MEMORY_GB = 4;
const VERY_LOW_END_CORES = 2;
const VERY_LOW_END_MEMORY_GB = 2;
const FPS_SAMPLE_MS = 1600;
const FPS_THRESHOLD = 45;

export type VantaMode = "full" | "lite" | "off";

type VantaPerformance = {
  mode: VantaMode;
  monitorFps: () => () => void;
};

const getDeviceSignals = () => {
  if (typeof navigator === "undefined") {
    return {
      cores: DEFAULT_CORES,
      memoryGb: DEFAULT_MEMORY_GB,
      effectiveType: undefined,
      saveData: false,
    };
  }

  const nav = navigator as Navigator & {
    deviceMemory?: number;
    hardwareConcurrency?: number;
    connection?: NetworkInformation;
  };

  return {
    cores: nav.hardwareConcurrency ?? DEFAULT_CORES,
    memoryGb: nav.deviceMemory ?? DEFAULT_MEMORY_GB,
    effectiveType: nav.connection?.effectiveType,
    saveData: nav.connection?.saveData ?? false,
  };
};

export default function useVantaPerformance(): VantaPerformance {
  const [mode, setMode] = useState<VantaMode>("off");

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!canUseWebGL()) {
      setMode("off");
      return;
    }

    const reduceMotion =
      window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
    const { cores, memoryGb, effectiveType, saveData } = getDeviceSignals();

    const slowNetwork = effectiveType === "2g" || effectiveType === "slow-2g";
    const veryLowEndDevice =
      memoryGb <= VERY_LOW_END_MEMORY_GB || cores <= VERY_LOW_END_CORES;
    const lowEndDevice = memoryGb <= LOW_END_MEMORY_GB || cores <= LOW_END_CORES;

    if (reduceMotion || saveData || slowNetwork || veryLowEndDevice) {
      setMode("off");
      return;
    }

    setMode(lowEndDevice ? "lite" : "full");
  }, []);

  const monitorFps = useCallback(() => {
    if (mode === "off" || typeof window === "undefined") {
      return () => {};
    }

    let rafId = 0;
    let frames = 0;
    const start = performance.now();

    const tick = (now: number) => {
      frames += 1;
      if (now - start >= FPS_SAMPLE_MS) {
        const fps = (frames * 1000) / (now - start);
        if (fps < FPS_THRESHOLD) {
          setMode((prev) => {
            if (prev === "full") return "lite";
            return "off";
          });
        }
        return;
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [mode]);

  return { mode, monitorFps };
}
