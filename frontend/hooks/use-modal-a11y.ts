"use client";

import { useEffect } from "react";

/**
 * Accesibilidad centralizada para todos los modales del sistema.
 *
 * No gestiona el estado abierto/cerrado de ningun modal (eso vive en cada
 * dashboard). Solo observa el DOM y, sobre cualquier overlay visible
 * (`.modalBackdrop` / `.confirmBackdrop`), aplica:
 *   - role="dialog" / "alertdialog" + aria-modal="true"
 *   - aria-label derivado del titulo del modal (h1/h2/h3)
 *   - foco inicial dentro del modal y restauracion al cerrar
 *   - trampa de foco (Tab/Shift+Tab no escapan del modal)
 *   - Escape cierra (reusa el boton de cierre existente)
 *   - bloqueo del scroll de fondo mientras hay un modal abierto
 *
 * Se monta una sola vez (en el AppShell). No cambia logica de negocio.
 */

const OVERLAY_SELECTOR = ".modalBackdrop, .confirmBackdrop";
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])'
].join(",");

function topOverlay(): HTMLElement | null {
  const overlays = document.querySelectorAll<HTMLElement>(OVERLAY_SELECTOR);
  return overlays.length ? overlays[overlays.length - 1] : null;
}

function visibleFocusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el.offsetParent !== null
  );
}

export function useModalA11y(): void {
  useEffect(() => {
    let lastFocused: HTMLElement | null = null;

    function decorate(overlay: HTMLElement): void {
      const dialog =
        overlay.querySelector<HTMLElement>(".modalWindow, .confirmDialog") ?? overlay;
      if (!dialog.getAttribute("role")) {
        dialog.setAttribute(
          "role",
          overlay.classList.contains("confirmBackdrop") ? "alertdialog" : "dialog"
        );
      }
      dialog.setAttribute("aria-modal", "true");
      if (!dialog.getAttribute("aria-label") && !dialog.getAttribute("aria-labelledby")) {
        const heading = dialog.querySelector("h1, h2, h3");
        const text = heading?.textContent?.trim();
        if (text) dialog.setAttribute("aria-label", text);
      }
    }

    function onAppear(overlay: HTMLElement): void {
      overlay.dataset.a11yReady = "1";
      lastFocused = document.activeElement as HTMLElement | null;
      decorate(overlay);
      document.body.style.overflow = "hidden";
      // Enfocar el primer control util (evitar el boton "Cerrar" si hay otro)
      const focusables = visibleFocusables(overlay);
      const target =
        focusables.find((el) => el.getAttribute("aria-label") !== "Cerrar") ?? focusables[0];
      target?.focus();
    }

    function onAllClosed(): void {
      document.body.style.overflow = "";
      if (lastFocused && document.contains(lastFocused)) lastFocused.focus();
      lastFocused = null;
    }

    function onKeyDown(event: KeyboardEvent): void {
      const overlay = topOverlay();
      if (!overlay) return;

      if (event.key === "Escape") {
        const closeBtn =
          overlay.querySelector<HTMLElement>('[aria-label="Cerrar"]') ??
          overlay.querySelector<HTMLElement>(".confirmDialogActions button");
        if (closeBtn) {
          event.preventDefault();
          closeBtn.click();
        }
        return;
      }

      if (event.key === "Tab") {
        const focusables = visibleFocusables(overlay);
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (!active || !overlay.contains(active)) {
          event.preventDefault();
          first.focus();
        } else if (event.shiftKey && active === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && active === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }

    const observer = new MutationObserver(() => {
      const overlay = topOverlay();
      if (overlay && !overlay.dataset.a11yReady) {
        onAppear(overlay);
      } else if (!overlay && lastFocused) {
        onAllClosed();
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("keydown", onKeyDown);

    return () => {
      observer.disconnect();
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
    };
  }, []);
}
