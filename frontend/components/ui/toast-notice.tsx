"use client";

import { X } from "lucide-react";

// Aviso flotante (toast) de éxito o error con botón de cierre manual.
// `progress` muestra la barra que acompaña al autocierre por tiempo; los
// avisos compactos de las modales de mantenimiento no la usan.
export function ToastNotice({
  kind,
  message,
  onClose,
  compact = false,
  progress = false,
}: {
  kind: "success" | "error";
  message: string;
  onClose: () => void;
  compact?: boolean;
  progress?: boolean;
}) {
  return (
    <div
      className={`notice ${kind === "success" ? "noticeSuccess" : "noticeError"}${compact ? " noticeCompact" : ""}`}
      style={{ pointerEvents: "auto" }}
    >
      <span className="noticeInner">{message}</span>
      <button aria-label="Cerrar aviso" className="toastCloseButton" onClick={onClose} type="button">
        <X aria-hidden="true" size={14} />
      </button>
      {progress ? <span className="toastProgressBar" aria-hidden="true" /> : null}
    </div>
  );
}
