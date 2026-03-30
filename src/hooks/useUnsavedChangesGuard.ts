"use client";

import { useEffect } from "react";

const DEFAULT_MESSAGE = "Tenés cambios sin guardar. ¿Querés salir sin guardar?";

export function useUnsavedChangesGuard(
  enabled: boolean,
  message: string = DEFAULT_MESSAGE,
) {
  useEffect(() => {
    if (!enabled) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = message;
    };

    const handleDocumentClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const target = event.target;
      if (!(target instanceof Element)) return;

      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;

      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;

      const href = String(anchor.getAttribute("href") || "").trim();
      if (!href) return;
      if (
        href.startsWith("#") ||
        href.startsWith("mailto:") ||
        href.startsWith("tel:") ||
        href.startsWith("javascript:")
      ) {
        return;
      }

      const current = new URL(window.location.href);
      const next = new URL(anchor.href, current.href);
      const isSameDocument =
        current.pathname === next.pathname &&
        current.search === next.search &&
        current.hash === next.hash;
      if (isSameDocument) return;

      const confirmed = window.confirm(message);
      if (confirmed) return;

      event.preventDefault();
      event.stopPropagation();
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("click", handleDocumentClick, true);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("click", handleDocumentClick, true);
    };
  }, [enabled, message]);
}
