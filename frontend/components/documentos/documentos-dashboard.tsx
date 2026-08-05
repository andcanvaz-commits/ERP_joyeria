"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { FileText, Printer } from "lucide-react";
import { listProductionRuns } from "@/lib/production-api";
import { listInventoryItems } from "@/lib/inventory-api";
import {
  buildItemNameMap,
  buildOrdenProduccion,
  canPrintEntrega,
  canPrintRecepcion,
  formatDocDate,
  groupRunFamilies
} from "@/lib/orden-produccion";
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
  const [kindFilter, setKindFilter] = useState<"ALL" | "LIVE" | "HISTORICAL">("ALL");

  function isHistoricalFamily(family: ProductionRun[]): boolean {
    return family.some((run) => (run.event_lines ?? []).length > 0);
  }

  function familyMonthKey(family: ProductionRun[]): string {
    const root = family.find((run) => !run.parent_run_id) ?? family[0];
    const date = new Date(root.requested_at);
    if (Number.isNaN(date.getTime())) return "Sin fecha";
    return date.toLocaleDateString("es-EC", { month: "long", year: "numeric" });
  }

  const itemNames = useMemo(() => buildItemNameMap(items), [items]);
  const families = useMemo(() => groupRunFamilies(runs), [runs]);
  const familyList = useMemo(() => {
    const term = search.trim().toLowerCase();
    return Array.from(families.entries()).filter(([key, family]) => {
      const historical = isHistoricalFamily(family);
      if (kindFilter === "LIVE" && historical) return false;
      if (kindFilter === "HISTORICAL" && !historical) return false;
      if (!term) return true;
      const root = family.find((run) => !run.parent_run_id) ?? family[0];
      const haystack = [
        key,
        root.process_name,
        root.created_by_name ?? "",
        root.materials_approved_by_name ?? "",
        root.received_by_name ?? ""
      ].join(" ").toLowerCase();
      return haystack.includes(term);
    });
  }, [families, search, kindFilter]);

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
                {(["ALL", "LIVE", "HISTORICAL"] as const).map((option) => (
                  <button
                    className={`button${kindFilter === option ? " buttonPrimary" : ""}`}
                    key={option}
                    onClick={() => setKindFilter(option)}
                    type="button"
                  >
                    {option === "ALL" ? "Todas" : option === "LIVE" ? "En vivo" : "Históricas"}
                  </button>
                ))}
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
                  const receivedCount = family.filter((run) => run.status === "RECIBIDA").length;
                  const statusText =
                    family.length === 1
                      ? STATUS_LABEL[family[0].status]
                      : `${receivedCount}/${family.length} recibidas`;
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
