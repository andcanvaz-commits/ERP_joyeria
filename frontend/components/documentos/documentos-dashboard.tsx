"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, ChevronLeft, ChevronRight, FileText, Printer, X } from "lucide-react";
import { listProductionRuns } from "@/lib/production-api";
import { listInventoryItems } from "@/lib/inventory-api";
import { openableProps } from "@/lib/a11y";
import {
  buildItemNameMap,
  buildOrdenProduccion,
  canPrintEntrega,
  canPrintRecepcion,
  formatDocDate,
  groupRunFamilies
} from "@/lib/orden-produccion";
import { WEEK_DAYS, buildCalendarDays, dateKey, monthKey } from "@/lib/calendar";
import type { ProductionRun } from "@/types/production";
import type { InventoryItem } from "@/types/inventory";
import { DocMode, OrdenProduccionDoc } from "./orden-produccion-doc";

const STATUS_LABEL: Record<ProductionRun["status"], string> = {
  PENDIENTE_INVENTARIO: "Pendiente de inventario",
  MATERIALES_APROBADOS: "Materiales aprobados",
  EN_PROCESO: "En proceso",
  PENDIENTE_RECEPCION: "Pendiente de recepción",
  RECIBIDA: "Recibida",
  CANCELADA: "Cancelada",
  ESPERANDO_MATERIAL: "Esperando material"
};

async function fetchDocumentosBundle(): Promise<{ runs: ProductionRun[]; items: InventoryItem[] }> {
  const [runs, items] = await Promise.all([listProductionRuns(), listInventoryItems("TODOS")]);
  return { runs, items };
}

// La recepcion es un acto unico por familia (aunque varios responsables hayan
// entregado partes por separado) — no se muestra como fraccion "X/Y
// recibidas", solo el estado real: "Recibida" cuando la familia entera lo
// esta (misma regla que canPrintRecepcion), o el estado de la corrida raiz.
function familyStatusText(family: ProductionRun[]): string {
  if (family.length === 1) return STATUS_LABEL[family[0].status];
  if (canPrintRecepcion(family)) return "Recibida";
  const root = family.find((run) => !run.parent_run_id) ?? family[0];
  return STATUS_LABEL[root.status];
}

export function DocumentosDashboard() {
  const { data, isLoading } = useQuery({
    queryKey: ["documentos"],
    queryFn: fetchDocumentosBundle
  });
  // Una orden rechazada no genera acta: no aparece en Documentos.
  const runs = (data?.runs ?? []).filter((run) => run.status !== "CANCELADA");
  const items = data?.items ?? [];
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [printMode, setPrintMode] = useState<DocMode | null>(null);
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<"ALL" | "LIVE">("ALL");
  // Historial por calendario: mismo patron que Inventario > Movimientos
  // (boton con icono abre un mes navegable, click en un dia filtra la
  // lista de la derecha por esa fecha).
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => monthKey(new Date()));
  const [calendarDate, setCalendarDate] = useState(() => dateKey(new Date()));
  const [calendarSearch, setCalendarSearch] = useState("");

  function isHistoricalFamily(family: ProductionRun[]): boolean {
    return family.some((run) => (run.event_lines ?? []).length > 0);
  }

  function familyRoot(family: ProductionRun[]): ProductionRun {
    return family.find((run) => !run.parent_run_id) ?? family[0];
  }

  function familyDate(family: ProductionRun[]): Date | null {
    const date = new Date(familyRoot(family).requested_at);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function familyDateKey(family: ProductionRun[]): string | null {
    const date = familyDate(family);
    return date ? dateKey(date) : null;
  }

  function familyMonthKey(family: ProductionRun[]): string {
    const date = familyDate(family);
    if (!date) return "Sin fecha";
    return date.toLocaleDateString("es-EC", { month: "long", year: "numeric" });
  }

  function familyHaystack(key: string, family: ProductionRun[]): string {
    const root = familyRoot(family);
    return [
      key,
      root.process_name,
      root.created_by_name ?? "",
      root.materials_approved_by_name ?? "",
      root.received_by_name ?? ""
    ].join(" ").toLowerCase();
  }

  const itemNames = useMemo(() => buildItemNameMap(items), [items]);
  const families = useMemo(() => groupRunFamilies(runs), [runs]);
  const familyEntries = useMemo(() => Array.from(families.entries()), [families]);
  const familyList = useMemo(() => {
    const term = search.trim().toLowerCase();
    return familyEntries.filter(([key, family]) => {
      const historical = isHistoricalFamily(family);
      if (kindFilter === "LIVE" && historical) return false;
      if (!term) return true;
      return familyHaystack(key, family).includes(term);
    });
  }, [familyEntries, search, kindFilter]);

  const familyGroups = useMemo(() => {
    const groups = new Map<string, Array<[string, ProductionRun[]]>>();
    for (const entry of familyList) {
      const monthKey = familyMonthKey(entry[1]);
      const list = groups.get(monthKey) ?? [];
      list.push(entry);
      groups.set(monthKey, list);
    }
    return Array.from(groups.entries());
  }, [familyList]);

  // Conteo por dia para los puntos del calendario: sobre familyList, para
  // que respete el filtro Todas/En vivo si esta activo al abrir el modal.
  const familyCountsByDate = useMemo(() => {
    const counts = new Map<string, number>();
    for (const [, family] of familyList) {
      const key = familyDateKey(family);
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [familyList]);

  const calendarDays = useMemo(() => buildCalendarDays(calendarMonth), [calendarMonth]);
  const calendarMonthLabel = useMemo(() => {
    const [year, month] = calendarMonth.split("-").map(Number);
    return new Date(year, month - 1, 1).toLocaleDateString("es-EC", { month: "long", year: "numeric" });
  }, [calendarMonth]);

  const calendarSearchActive = calendarSearch.trim().length > 0;
  const calendarSearchResults = useMemo(() => {
    if (!calendarSearchActive) return [] as Array<[string, ProductionRun[]]>;
    const term = calendarSearch.trim().toLowerCase();
    return familyList.filter(([key, family]) => familyHaystack(key, family).includes(term));
  }, [calendarSearch, calendarSearchActive, familyList]);

  const calendarDayEntries = useMemo(
    () => familyList.filter(([, family]) => familyDateKey(family) === calendarDate),
    [familyList, calendarDate]
  );

  function moveCalendarMonth(direction: -1 | 1) {
    const [year, month] = calendarMonth.split("-").map(Number);
    const nextDate = new Date(year, month - 1 + direction, 1);
    const nextMonth = monthKey(nextDate);
    setCalendarMonth(nextMonth);
    const firstInMonth = familyList.find(([, family]) => familyDateKey(family)?.startsWith(nextMonth));
    setCalendarDate(firstInMonth ? familyDateKey(firstInMonth[1]) ?? `${nextMonth}-01` : `${nextMonth}-01`);
  }

  function openCalendar() {
    const mostRecent = familyList
      .map(([, family]) => familyDateKey(family))
      .filter((key): key is string => key !== null)
      .sort()
      .pop();
    const startDate = mostRecent ?? dateKey(new Date());
    setCalendarDate(startDate);
    setCalendarMonth(startDate.slice(0, 7));
    setCalendarSearch("");
    setIsCalendarOpen(true);
  }

  function selectFamilyFromCalendar(key: string) {
    setSelectedKey(key);
    setIsCalendarOpen(false);
  }

  const selectedFamily = selectedKey ? families.get(selectedKey) ?? null : null;
  const model = useMemo(
    () => (selectedFamily ? buildOrdenProduccion(selectedFamily, itemNames) : null),
    [selectedFamily, itemNames]
  );

  useEffect(() => {
    if (!printMode) return;
    const timer = setTimeout(() => {
      window.print();
      setPrintMode(null);
    }, 60);
    return () => clearTimeout(timer);
  }, [printMode]);

  return (
    <div className="content">
      <section className="card panelBody">
        <div className="panelHeader">
          <div>
            <h2 className="panelTitle">Orden de Producción</h2>
            <p className="panelText">
              Selecciona una orden para ver e imprimir su comprobante. La entrega se imprime tras la
              aprobación de materiales y la recepción se sobreimprime en la misma hoja.
            </p>
          </div>
          <FileText aria-hidden="true" size={20} />
        </div>

        <div className="documentosLayout">
          <div className="documentosList">
            {/* Fijo (sticky) dentro de .documentosList: con 37+ familias
                historicas la lista scrollea largo y estos controles se
                perdian de vista. */}
            <div
              style={{
                display: "grid",
                gap: 8,
                marginBottom: 4,
                position: "sticky",
                top: 0,
                zIndex: 1,
                background: "var(--surface)",
                paddingTop: 2,
                paddingBottom: 8
              }}
            >
              <input
                aria-label="Buscar por folio, proceso o responsable"
                className="field"
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar folio, proceso, responsable..."
                type="text"
                value={search}
              />
              <div style={{ display: "flex", gap: 6 }}>
                {(["ALL", "LIVE"] as const).map((option) => (
                  <button
                    className={`button${kindFilter === option ? " buttonPrimary" : ""}`}
                    key={option}
                    onClick={() => setKindFilter(option)}
                    type="button"
                  >
                    {option === "ALL" ? "Todas" : "En vivo"}
                  </button>
                ))}
                <button
                  aria-label="Abrir historial por calendario"
                  className="button"
                  disabled={familyEntries.length === 0}
                  onClick={openCalendar}
                  title="Historial por calendario"
                  type="button"
                >
                  <CalendarDays aria-hidden="true" size={16} />
                  Calendario
                </button>
              </div>
            </div>
            {isLoading ? <div className="emptyState">Cargando órdenes...</div> : null}
            {!isLoading && runs.length === 0 ? (
              <div className="emptyState">No hay órdenes registradas.</div>
            ) : null}
            {!isLoading && runs.length > 0 && familyList.length === 0 ? (
              <div className="emptyState">Ninguna orden coincide con la búsqueda/filtro.</div>
            ) : null}
            {familyGroups.map(([monthLabel, entries]) => (
              <div key={monthLabel} style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", marginTop: 6 }}>
                  {monthLabel}
                </span>
                {entries.map(([key, family]) => {
                  const isSel = key === selectedKey;
                  const root = family.find((run) => !run.parent_run_id) ?? family[0];
                  const statusText = familyStatusText(family);
                  return (
                    <button
                      className={`processPicker${isSel ? " processPickerActive" : ""}`}
                      key={key}
                      onClick={() => setSelectedKey(key)}
                      type="button"
                    >
                      <span style={{ display: "grid", gap: 2, textAlign: "left" }}>
                        <strong style={{ color: "var(--text)", fontSize: 14 }}>
                          {key} · {root.process_name}
                        </strong>
                        <span>{statusText}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          <div className="documentosPreview">
            {model && selectedFamily ? (
              <>
                <div className="documentosActions">
                  <button
                    className="button"
                    disabled={!selectedFamily || !canPrintEntrega(selectedFamily)}
                    onClick={() => setPrintMode("entrega")}
                    type="button"
                  >
                    <Printer aria-hidden="true" size={16} />
                    Imprimir entrega
                  </button>
                  <button
                    className="button"
                    disabled={!selectedFamily || !canPrintRecepcion(selectedFamily)}
                    onClick={() => setPrintMode("recepcion")}
                    type="button"
                  >
                    <Printer aria-hidden="true" size={16} />
                    Imprimir recepción
                  </button>
                  <button
                    className="button buttonPrimary"
                    disabled={!selectedFamily || !canPrintRecepcion(selectedFamily)}
                    onClick={() => setPrintMode("completo")}
                    type="button"
                  >
                    <Printer aria-hidden="true" size={16} />
                    Imprimir completo
                  </button>
                </div>
                <div className="documentosPreviewFrame">
                  <OrdenProduccionDoc model={model} mode="completo" />
                </div>
              </>
            ) : (
              <div className="emptyState">Selecciona una orden para ver su comprobante.</div>
            )}
          </div>
        </div>
      </section>

      {isCalendarOpen ? (
        <div className="modalBackdrop" role="dialog" aria-modal="true" aria-label="Historial de ordenes por calendario">
          <section className="modalWindow movementHistoryWindow">
            <div className="modalHeader">
              <div>
                <h2>Historial de órdenes</h2>
                <p>Selecciona una fecha para revisar sus órdenes</p>
              </div>
              <button aria-label="Cerrar" className="iconOnlyButton" onClick={() => setIsCalendarOpen(false)} type="button">
                <X aria-hidden="true" size={18} />
              </button>
            </div>
            <div className="movementHistoryLayout">
              <section className="movementCalendarPanel" aria-label="Calendario de ordenes">
                <div className="movementCalendarHeader">
                  <button aria-label="Mes anterior" className="iconOnlyButton" onClick={() => moveCalendarMonth(-1)} type="button">
                    <ChevronLeft aria-hidden="true" size={18} />
                  </button>
                  <strong>{calendarMonthLabel}</strong>
                  <button aria-label="Mes siguiente" className="iconOnlyButton" onClick={() => moveCalendarMonth(1)} type="button">
                    <ChevronRight aria-hidden="true" size={18} />
                  </button>
                </div>
                <div className="movementCalendarWeekdays">
                  {WEEK_DAYS.map((day) => <span key={day}>{day}</span>)}
                </div>
                <div className="movementCalendarGrid">
                  {calendarDays.map((day) => {
                    const count = familyCountsByDate.get(day.key) ?? 0;
                    return day.isEmpty ? (
                      <span className="movementCalendarEmpty" key={day.key} />
                    ) : (
                      <button
                        className={`movementCalendarDay ${calendarDate === day.key ? "movementCalendarSelected" : ""} ${count > 0 ? "movementCalendarHasMovements" : ""}`}
                        key={day.key}
                        onClick={() => setCalendarDate(day.key)}
                        type="button"
                      >
                        <span>{day.label}</span>
                        {count > 0 ? <strong>{count}</strong> : null}
                      </button>
                    );
                  })}
                </div>
              </section>

              <section className="movementDateDetail">
                <input
                  className="field searchField"
                  onChange={(event) => setCalendarSearch(event.target.value)}
                  placeholder="Buscar por folio, proceso o responsable"
                  value={calendarSearch}
                />
                <div>
                  {calendarSearchActive ? (
                    <>
                      <h3>Resultados de búsqueda</h3>
                      <p>{calendarSearchResults.length} órdenes en todo el historial</p>
                    </>
                  ) : (
                    <>
                      <h3>{formatDocDate(`${calendarDate}T00:00:00`) || "Sin fecha"}</h3>
                      <p>{calendarDayEntries.length} órdenes</p>
                    </>
                  )}
                </div>
                <div className="movementList movementHistoryEntries pagedListFloor">
                  {(calendarSearchActive ? calendarSearchResults : calendarDayEntries).map(([key, family]) => {
                    const root = familyRoot(family);
                    const statusText = familyStatusText(family);
                    return (
                      <article
                        className="movementRow"
                        key={key}
                        {...openableProps(() => selectFamilyFromCalendar(key), `Ver comprobante de ${key}`)}
                      >
                        <div>
                          <strong>{key} · {root.process_name}</strong>
                          <span>
                            {calendarSearchActive ? `${formatDocDate(root.requested_at) || "Sin fecha"} · ` : ""}
                            {statusText}
                          </span>
                        </div>
                        <div />
                      </article>
                    );
                  })}
                  {(calendarSearchActive ? calendarSearchResults : calendarDayEntries).length === 0 ? (
                    <div className="emptyState">
                      {calendarSearchActive ? "Ninguna orden coincide con la búsqueda." : "No hay órdenes en esta fecha."}
                    </div>
                  ) : null}
                </div>
              </section>
            </div>
          </section>
        </div>
      ) : null}

      {printMode && model
        ? createPortal(
            <div className="printArea">
              <OrdenProduccionDoc model={model} mode={printMode} />
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
