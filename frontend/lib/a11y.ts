import type { KeyboardEvent } from "react";

/**
 * Props para que un contenedor (tarjeta/fila) abra su ventana emergente al
 * hacer clic en cualquier parte, pensado para uso tactil en telefonos y
 * tablets. Tambien funciona con teclado (Enter / Espacio).
 *
 * Los botones internos del contenedor deben detener la propagacion
 * (`onClick={(e) => e.stopPropagation()}` en su contenedor) para conservar sus
 * propias acciones. No cambia logica de negocio: solo extiende el area de clic
 * hacia el contenedor reusando el mismo handler.
 */
export function openableProps(open: () => void, label?: string) {
  return {
    role: "button",
    tabIndex: 0,
    "aria-label": label,
    onClick: open,
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open();
      }
    }
  } as const;
}

/** Detiene la propagacion del clic; usar en contenedores de acciones internas. */
export function stopClick(event: { stopPropagation: () => void }): void {
  event.stopPropagation();
}
