"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export interface PaginationState {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  setPage: (page: number) => void;
}

/* Paginación client-side para listados: reemplaza los contenedores con scroll.
   resetKey vuelve a la primera página cuando cambia el contexto del listado
   (filtro, búsqueda o nivel de drill-down). */
export function usePagination<T>(items: T[], pageSize: number, resetKey = ""): PaginationState & { pageItems: T[] } {
  const [page, setPage] = useState(0);

  useEffect(() => {
    setPage(0);
  }, [resetKey]);

  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  // Si el listado se encoge (ej. se elimina el último item de la última página),
  // la página actual se ajusta sola sin quedar fuera de rango.
  const current = Math.min(page, pageCount - 1);
  const pageItems = useMemo(
    () => items.slice(current * pageSize, (current + 1) * pageSize),
    [items, current, pageSize],
  );

  return { pageItems, page: current, pageCount, total: items.length, pageSize, setPage };
}

/* Control compacto: ‹ 1–10 de 45 ›. No se renderiza si todo cabe en una página. */
export function Pager({ page, pageCount, total, pageSize, setPage }: PaginationState) {
  if (total <= pageSize) return null;
  const start = page * pageSize + 1;
  const end = Math.min(total, (page + 1) * pageSize);
  return (
    <div className="pager">
      <button
        aria-label="Página anterior"
        className="iconOnlyButton"
        disabled={page === 0}
        onClick={() => setPage(page - 1)}
        type="button"
      >
        <ChevronLeft aria-hidden="true" size={15} />
      </button>
      <span className="pagerRange">{start}–{end} de {total}</span>
      <button
        aria-label="Página siguiente"
        className="iconOnlyButton"
        disabled={page >= pageCount - 1}
        onClick={() => setPage(page + 1)}
        type="button"
      >
        <ChevronRight aria-hidden="true" size={15} />
      </button>
    </div>
  );
}
