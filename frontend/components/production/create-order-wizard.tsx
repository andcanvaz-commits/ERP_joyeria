"use client";

import { ReactNode, useEffect, useState } from "react";
import { X } from "lucide-react";
import { MaterialCategoryPicker } from "@/components/production/material-category-picker";
import type { InventoryItem } from "@/types/inventory";
import type { ProductChoice, ProductionProcess } from "@/types/production";

function numericText(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return "0";
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString("es-EC", { maximumFractionDigits: 4 }) : String(value);
}

type ConfiguredStageIngredient = {
  configId: string;
  stageName: string;
  inventoryItemId: string;
};

export type CreateOrderWizardProps = {
  isOpen: boolean;
  onClose: () => void;
  isSaving: boolean;
  onError: (message: string) => void;

  processes: ProductionProcess[];
  selectedProcessId: string;
  onSelectProcess: (id: string) => void;

  rawMaterials: InventoryItem[];
  selectedMaterialId: string;
  onSelectMaterial: (id: string) => void;
  selectedMaterial: InventoryItem | null;

  suppliesList: InventoryItem[];
  configuredStageIngredients: ConfiguredStageIngredient[];
  stageIngredientQuantities: Record<string, string>;
  onChangeStageIngredientQuantity: (configId: string, value: string) => void;

  assemblyMode: "ASIGNAR" | "ENSAMBLAR";
  onChangeAssemblyMode: (mode: "ASIGNAR" | "ENSAMBLAR") => void;
  orderProduct: ProductChoice | null;
  renderProductChooser: (current: ProductChoice | null, onOpenPicker: () => void) => ReactNode;
  onOpenProductPicker: () => void;

  runQuantity: string;
  onChangeRunQuantity: (value: string) => void;

  onSubmit: () => void;
};

const STEP_LABELS: Array<{ n: 1 | 2 | 3; label: string }> = [
  { n: 1, label: "Proceso" },
  { n: 2, label: "Material" },
  { n: 3, label: "Producto" },
];

function StepIndicator({ step, onStepClick }: { step: 1 | 2 | 3; onStepClick: (n: 1 | 2 | 3) => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
      {STEP_LABELS.map(({ n, label }, index) => {
        // Solo se puede volver a un paso ya recorrido: adelantar de un
        // salto se salta la validación de los pasos intermedios.
        const isReachable = n < step;
        return (
          <div key={n} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button
              disabled={!isReachable}
              onClick={() => onStepClick(n)}
              type="button"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                background: "none",
                border: "none",
                padding: 0,
                cursor: isReachable ? "pointer" : "default",
              }}
            >
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 22,
                  height: 22,
                  borderRadius: "50%",
                  border: `1px solid ${n <= step ? "var(--gold-deep)" : "var(--border)"}`,
                  color: n <= step ? "var(--gold-deep)" : "var(--muted)",
                  fontSize: 12,
                  flexShrink: 0,
                }}
              >
                {n < step ? "✓" : n}
              </span>
              <span style={{ fontSize: 13, fontWeight: n === step ? 700 : 500, color: n === step ? "var(--gold-deep)" : "var(--muted)" }}>
                {label}
              </span>
            </button>
            {index < STEP_LABELS.length - 1 ? (
              <span style={{ width: 24, height: 1, background: "var(--border)" }} />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function CreateOrderWizard(props: CreateOrderWizardProps) {
  const {
    isOpen,
    onClose,
    isSaving,
    onError,
    processes,
    selectedProcessId,
    onSelectProcess,
    rawMaterials,
    selectedMaterialId,
    onSelectMaterial,
    selectedMaterial,
    suppliesList,
    configuredStageIngredients,
    stageIngredientQuantities,
    onChangeStageIngredientQuantity,
    assemblyMode,
    onChangeAssemblyMode,
    orderProduct,
    renderProductChooser,
    onOpenProductPicker,
    runQuantity,
    onChangeRunQuantity,
    onSubmit,
  } = props;

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [processSearch, setProcessSearch] = useState("");
  const [isMaterialPickerOpen, setIsMaterialPickerOpen] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setStep(1);
      setProcessSearch("");
      setIsMaterialPickerOpen(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const term = processSearch.trim().toLowerCase();
  const filteredProcesses = processes.filter(
    (process) => term === "" || process.name.toLowerCase().includes(term),
  );

  function goToStep2() {
    setStep(2);
  }

  function goToStep3() {
    if (!selectedMaterialId) {
      onError("Selecciona la materia prima con la que se fabricará esta orden.");
      return;
    }
    const missingIngredient = configuredStageIngredients.find(
      (ing) => !(Number(stageIngredientQuantities[ing.configId]) > 0),
    );
    if (missingIngredient) {
      onError("Ingresa la cantidad de todos los insumos de este proceso.");
      return;
    }
    setStep(3);
  }

  return (
    <div className="modalBackdrop" role="dialog" aria-modal="true">
      <section className="modalWindow processViewWindow">
        <div className="modalHeader">
          <div>
            <h2>Crear orden</h2>
            <p>Proceso, material, producto y cantidad a fabricar</p>
          </div>
          <button aria-label="Cerrar" className="iconOnlyButton" onClick={onClose} type="button">
            <X aria-hidden="true" size={18} />
          </button>
        </div>

        <StepIndicator step={step} onStepClick={setStep} />

        {step === 1 ? (
          <div className="fieldGroup">
            <span>Elige el proceso</span>
            <input
              aria-label="Buscar proceso"
              className="field searchField"
              onChange={(event) => setProcessSearch(event.target.value)}
              placeholder="Buscar por nombre..."
              type="text"
              value={processSearch}
            />
            <div className="tableWrap">
              <table className="table tableAuto">
                <tbody>
                  {filteredProcesses.map((process) => (
                    <tr
                      key={process.id}
                      onClick={() => {
                        onSelectProcess(process.id);
                        goToStep2();
                      }}
                      style={{
                        cursor: "pointer",
                        borderLeft: process.id === selectedProcessId ? "3px solid var(--gold-deep)" : "3px solid transparent",
                        fontWeight: process.id === selectedProcessId ? 700 : 400,
                      }}
                    >
                      <td>{process.name}</td>
                    </tr>
                  ))}
                  {filteredProcesses.length === 0 ? (
                    <tr>
                      <td>
                        <div className="emptyState">
                          {processes.length === 0 ? "No hay procesos activos." : "Ningún proceso coincide con la búsqueda."}
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {step === 2 ? (
          <>
            <label className="fieldGroup">
              <span>Materia prima</span>
              <div className="materialRow">
                <button
                  className="button"
                  onClick={() => setIsMaterialPickerOpen(true)}
                  style={{ flex: 1, justifyContent: "flex-start" }}
                  type="button"
                >
                  {selectedMaterial
                    ? `${selectedMaterial.name} · ${numericText(selectedMaterial.current_stock)} ${selectedMaterial.unit_code}`
                    : "Elegir materia prima"}
                </button>
                {selectedMaterial ? (
                  <button className="button" onClick={() => setIsMaterialPickerOpen(true)} type="button">
                    Cambiar
                  </button>
                ) : null}
              </div>
            </label>

            {configuredStageIngredients.length > 0 ? (
              <div className="fieldGroup">
                <span>Insumos de este proceso</span>
                <div className="tableWrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Insumo</th>
                        <th>Etapa</th>
                        <th className="num">Cantidad</th>
                      </tr>
                    </thead>
                    <tbody>
                      {configuredStageIngredients.map((ing) => {
                        const item = suppliesList.find((candidate) => candidate.id === ing.inventoryItemId);
                        return (
                          <tr key={ing.configId}>
                            <td>{item?.name ?? ing.inventoryItemId}</td>
                            <td>{ing.stageName}</td>
                            <td className="num">
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                                <input
                                  aria-label={`Cantidad de ${item?.name ?? "insumo"}`}
                                  className="field"
                                  min="0"
                                  onChange={(event) => onChangeStageIngredientQuantity(ing.configId, event.target.value)}
                                  step="0.0001"
                                  style={{ width: 90 }}
                                  type="number"
                                  value={stageIngredientQuantities[ing.configId] ?? ""}
                                />
                                <span style={{ color: "var(--muted)", fontSize: 13 }}>{item?.unit_code ?? ""}</span>
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginTop: 4 }}>
              <button className="button" onClick={() => setStep(1)} type="button">
                Atrás
              </button>
              <button className="button buttonPrimary" onClick={goToStep3} type="button">
                Siguiente
              </button>
            </div>
          </>
        ) : null}

        {step === 3 ? (
          <>
            <div className="fieldGroup">
              <span>Destino del producto</span>
              <div className="materialRow" style={{ gap: 8 }}>
                <button
                  className={`button${assemblyMode === "ASIGNAR" ? " buttonPrimary" : ""}`}
                  onClick={() => onChangeAssemblyMode("ASIGNAR")}
                  type="button"
                >
                  Asignar
                </button>
                <button
                  className={`button${assemblyMode === "ENSAMBLAR" ? " buttonPrimary" : ""}`}
                  onClick={() => onChangeAssemblyMode("ENSAMBLAR")}
                  type="button"
                >
                  Ensamblar
                </button>
              </div>
            </div>

            <label className="fieldGroup">
              <span>{assemblyMode === "ENSAMBLAR" ? "Producto final" : "Producto"}</span>
              {renderProductChooser(orderProduct, onOpenProductPicker)}
            </label>

            <label className="fieldGroup">
              <span>Cantidad a fabricar {selectedMaterial ? `(${selectedMaterial.unit_code})` : ""}</span>
              <input
                className="field"
                min="0.0001"
                onChange={(e) => onChangeRunQuantity(e.target.value)}
                step="0.0001"
                type="number"
                value={runQuantity}
              />
            </label>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginTop: 4 }}>
              <button className="button" onClick={() => setStep(2)} type="button">
                Atrás
              </button>
              <button className="button buttonPrimary" disabled={isSaving} onClick={onSubmit} type="button">
                Crear orden
              </button>
            </div>
          </>
        ) : null}
      </section>

      {isMaterialPickerOpen ? (
        <MaterialCategoryPicker
          allowedTypes={["RAW_MATERIAL"]}
          description="Elige la materia prima con la que se fabricará esta orden"
          items={rawMaterials}
          onClose={() => setIsMaterialPickerOpen(false)}
          onSelect={(item) => {
            onSelectMaterial(item.id);
            setIsMaterialPickerOpen(false);
          }}
          title="Elegir materia prima"
        />
      ) : null}
    </div>
  );
}
