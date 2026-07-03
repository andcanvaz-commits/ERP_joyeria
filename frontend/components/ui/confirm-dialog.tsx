"use client";

import { ReactNode, useState } from "react";
import { X } from "lucide-react";

type ConfirmOpts = {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
};

type State = ConfirmOpts & { resolve: (value: boolean) => void };

// Hook de confirmacion por modal (nada de window.confirm). Devuelve una promesa;
// encadenar dos llamadas da la "doble confirmacion" para acciones destructivas.
export function useConfirm(): { confirm: (opts: ConfirmOpts) => Promise<boolean>; dialog: ReactNode } {
  const [state, setState] = useState<State | null>(null);

  function confirm(opts: ConfirmOpts) {
    return new Promise<boolean>((resolve) => setState({ ...opts, resolve }));
  }

  function close(value: boolean) {
    state?.resolve(value);
    setState(null);
  }

  const dialog: ReactNode = state ? (
    <div className="modalBackdrop" role="dialog" aria-modal="true" aria-label={state.title}>
      <section className="modalWindow confirmWindow">
        <div className="modalHeader">
          <div><h2>{state.title}</h2></div>
          <button aria-label="Cerrar" className="iconOnlyButton" onClick={() => close(false)} type="button">
            <X aria-hidden="true" size={18} />
          </button>
        </div>
        <p className="panelText">{state.message}</p>
        <div className="modalActions">
          <button className="button" onClick={() => close(false)} type="button">Cancelar</button>
          <button
            className={`button ${state.danger ? "buttonDanger" : "buttonPrimary"}`}
            onClick={() => close(true)}
            type="button"
          >
            {state.confirmLabel ?? "Confirmar"}
          </button>
        </div>
      </section>
    </div>
  ) : null;

  return { confirm, dialog };
}

// Confirmacion estandar para eliminar (una sola, por modal).
export function confirmDelete(
  confirm: (opts: ConfirmOpts) => Promise<boolean>,
  nombre: string,
): Promise<boolean> {
  return confirm({
    title: "Eliminar",
    message: `¿Eliminar "${nombre}"? Esta acción no se puede deshacer.`,
    confirmLabel: "Eliminar",
    danger: true,
  });
}
