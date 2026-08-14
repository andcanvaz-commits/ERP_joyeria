# Wizard "Crear orden de producción" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el modal "Crear orden" (todo-en-una-pantalla) por un wizard de 3 pasos extraído a su propio componente.

**Architecture:** Nuevo componente `frontend/components/production/create-order-wizard.tsx` que solo maneja presentación y navegación de pasos (`createOrderStep` es estado local del componente). Todo el estado de dominio (proceso/material/insumos/modo/producto/cantidad elegidos, y el mecanismo de recetas de ensamble) sigue viviendo en `production-dashboard.tsx` — el wizard lo recibe por props y no duplica nada de eso, porque ese estado es compartido con otros flujos del dashboard (mantenimiento de recetas, edición de plan de producto).

**Tech Stack:** Next.js 16 App Router, React 18, TypeScript. Sin RHF/Zod/Tailwind (no agregar dependencias). Sin test runner de frontend configurado — verificación es `docker-compose exec web npm run build` + revisión manual en navegador.

## Global Constraints

- Español-first en labels, mensajes y estados (ver `CLAUDE.md`).
- No agregar dependencias frontend.
- Reusar clases/tokens existentes de `frontend/app/globals.css` antes de escribir CSS nuevo — este plan no agrega CSS nuevo, todo con clases (`fieldGroup`, `field searchField`, `tableWrap`, `table tableAuto`, `emptyState`, `materialRow`, `button`/`buttonPrimary`, `modalBackdrop`, `modalWindow processViewWindow`, `modalHeader`, `iconOnlyButton`) y estilos inline con tokens (`var(--gold-deep)`, `var(--muted)`, `var(--border)`) que ya usa `production-dashboard.tsx`.
- Mantenimiento de procesos (`ProcessForm`) no cambia — fuera de alcance.
- Referencia: `docs/superpowers/specs/2026-08-14-wizard-crear-orden-design.md`.

---

## Task 1: Compartir el tipo `ProductChoice`

**Files:**
- Modify: `frontend/types/production/index.ts` (agregar el tipo al final del archivo)
- Modify: `frontend/components/production/production-dashboard.tsx:89-95` (quitar la definición local, importar del tipo compartido)

**Interfaces:**
- Produce: `ProductChoice` exportado desde `@/types/production`, con la misma forma que tiene hoy.

- [ ] **Step 1: Agregar el tipo a `frontend/types/production/index.ts`**

Al final del archivo, agregar:

```typescript
// Producto resultante elegido: pieza existente (targetItemId) o tipo del
// catálogo aún sin piezas (productTypeId); label es lo que se muestra elegido.
export type ProductChoice = {
  targetItemId?: string;
  productTypeId?: string;
  label: string;
};
```

- [ ] **Step 2: Quitar la definición local de `production-dashboard.tsx` e importarla**

Reemplazar (líneas 89-95):

```typescript
// Producto resultante elegido: pieza existente (targetItemId) o tipo del
// catálogo aún sin piezas (productTypeId); label es lo que se muestra elegido.
type ProductChoice = {
  targetItemId?: string;
  productTypeId?: string;
  label: string;
};
```

por (queda vacío ese bloque, se elimina sin reemplazo).

En el import existente de tipos de producción (línea 54):

```typescript
import type { AssemblyRecipe, ProductionProcess, ProductionRun, ProductionRunStage } from "@/types/production";
```

cambiar a:

```typescript
import type { AssemblyRecipe, ProductChoice, ProductionProcess, ProductionRun, ProductionRunStage } from "@/types/production";
```

- [ ] **Step 3: Verificar que compila**

Run: `docker-compose exec web npm run build`
Expected: mismo resultado que antes de este cambio (sin nuevos errores; `ProductChoice` se sigue usando igual en todo el archivo, solo cambió de dónde viene).

- [ ] **Step 4: Commit**

```bash
git add frontend/types/production/index.ts frontend/components/production/production-dashboard.tsx
git commit -m "refactor(production): compartir tipo ProductChoice"
```

---

## Task 2: Crear el componente `CreateOrderWizard`

**Files:**
- Create: `frontend/components/production/create-order-wizard.tsx`

**Interfaces:**
- Consumes: `ProductChoice`, `ProductionProcess` de `@/types/production`; `InventoryItem` de `@/types/inventory`.
- Produces: `CreateOrderWizard` (default export), con las props detalladas en el Step 1.

No hay test automatizado (sin Jest en el proyecto); este task solo crea el archivo y se verifica junto con el Task 3 (compilación + prueba manual), porque un wizard no es útil ni renderizable de forma aislada sin estar montado en el dashboard.

- [ ] **Step 1: Crear el archivo completo**

```typescript
// frontend/components/production/create-order-wizard.tsx
"use client";

import { ReactNode, useEffect, useState } from "react";
import { X } from "lucide-react";
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

function StepIndicator({ step }: { step: 1 | 2 | 3 }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
      {STEP_LABELS.map(({ n, label }, index) => (
        <div key={n} style={{ display: "flex", alignItems: "center", gap: 6 }}>
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
          {index < STEP_LABELS.length - 1 ? (
            <span style={{ width: 24, height: 1, background: "var(--border)" }} />
          ) : null}
        </div>
      ))}
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

  useEffect(() => {
    if (isOpen) {
      setStep(1);
      setProcessSearch("");
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

        <StepIndicator step={step} />

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
              <span>Material</span>
              <select className="field" onChange={(e) => onSelectMaterial(e.target.value)} value={selectedMaterialId}>
                <option value="">Seleccionar material</option>
                {rawMaterials.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {numericText(item.current_stock)} {item.unit_code}
                  </option>
                ))}
              </select>
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

            <div className="modalActions">
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

            <div className="modalActions">
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
    </div>
  );
}
```

Nota: `modalActions` ya es una clase existente en `globals.css` (se usa en otras modales del mismo archivo, ej. la de "Definir ensamble"); confirmar con `grep -n "modalActions" frontend/app/globals.css` — si no existiera, usar en su lugar `style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 12 }}` en esos dos `div` en vez de la clase.

- [ ] **Step 2: Verificar sintaxis**

Run: `docker-compose exec web npm run build`
Expected: el build puede seguir fallando por errores en `production-dashboard.tsx` si ese archivo aún no importa/usa el nuevo componente (no debería, porque no lo importa todavía) — pero NO debe haber ningún error reportado en `create-order-wizard.tsx`. Si aparece un error en ese archivo, corregirlo antes de continuar.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/production/create-order-wizard.tsx
git commit -m "feat(production): componente CreateOrderWizard (aun no montado)"
```

---

## Task 3: Montar el wizard en `production-dashboard.tsx`

**Files:**
- Modify: `frontend/components/production/production-dashboard.tsx:2248-2394` (reemplazar el modal inline por `<CreateOrderWizard />`)
- Modify: `frontend/components/production/production-dashboard.tsx` (agregar import, agregar `handleOpenProductPicker`)

**Interfaces:**
- Consumes: `CreateOrderWizard`, `CreateOrderWizardProps` (Task 2).

- [ ] **Step 1: Agregar el import**

Junto a los demás imports de componentes de producción (cerca de la línea 13, después de `MaterialCategoryPicker`):

```typescript
import { CreateOrderWizard } from "@/components/production/create-order-wizard";
```

- [ ] **Step 2: Agregar `handleOpenProductPicker`**

Justo después de la función `applyProductChoice` (línea ~1621 hoy, la que termina en `}` después del bloque `else { setEditPlanProduct(patch); }`), agregar:

```typescript
  // Abre el picker correcto para el producto de "Crear orden": tipo del
  // catálogo en ENSAMBLAR (la receta depende del material+tipo, no de una
  // pieza puntual), pieza/tipo existente en ASIGNAR.
  function handleOpenProductPicker() {
    if (assemblyMode === "ENSAMBLAR") {
      setTypePickerFor("create");
    } else {
      setAssignPickerTab("PRODUCTOS");
      setItemPickerFor("create");
    }
  }
```

- [ ] **Step 3: Reemplazar el modal inline por el wizard**

Reemplazar todo el bloque (líneas 2248-2394, desde `{isCreateOrderOpen ? (` hasta el `) : null}` que cierra ese modal):

```tsx
      {isCreateOrderOpen ? (
        <div className="modalBackdrop" role="dialog" aria-modal="true">
          <section className="modalWindow processViewWindow">
            ...
          </section>
        </div>
      ) : null}
```

por:

```tsx
      <CreateOrderWizard
        isOpen={isCreateOrderOpen}
        onClose={() => {
          setIsCreateOrderOpen(false);
          resetCreateOrderState();
        }}
        isSaving={isSaving}
        onError={setError}
        processes={activeProcesses}
        selectedProcessId={selectedProcessId}
        onSelectProcess={setSelectedProcessId}
        rawMaterials={rawMaterials}
        selectedMaterialId={selectedMaterialId}
        onSelectMaterial={setSelectedMaterialId}
        selectedMaterial={selectedMaterial}
        suppliesList={suppliesList}
        configuredStageIngredients={configuredStageIngredients}
        stageIngredientQuantities={stageIngredientQuantities}
        onChangeStageIngredientQuantity={(configId, value) =>
          setStageIngredientQuantities((current) => ({ ...current, [configId]: value }))
        }
        assemblyMode={assemblyMode}
        onChangeAssemblyMode={handleAssemblyModeChange}
        orderProduct={orderProduct}
        renderProductChooser={renderProductChooser}
        onOpenProductPicker={handleOpenProductPicker}
        runQuantity={runQuantity}
        onChangeRunQuantity={setRunQuantity}
        onSubmit={() => void handleCreateProductionOrder()}
      />
```

- [ ] **Step 4: Verificar que compila**

Run: `docker-compose exec web npm run build`
Expected: build limpio, sin errores de TypeScript.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/production/production-dashboard.tsx
git commit -m "feat(production): montar CreateOrderWizard en Crear orden"
```

---

## Task 4: Verificación manual en navegador

**Files:** ninguno (solo verificación).

- [ ] **Step 1: Levantar y abrir la app**

El usuario ya tiene `docker-compose up` corriendo (no se toca el stack). Abrir `http://localhost:3000/produccion` (o el puerto configurado), iniciar sesión, ir a Producción.

- [ ] **Step 2: Probar el flujo ASIGNAR completo**

1. Clic en "Crear orden".
2. Paso 1: buscar un proceso por nombre, hacer clic en una fila → debe avanzar solo al paso 2, con el stepper marcando "Material" activo y "Proceso" con ✓.
3. Paso 2: elegir una materia prima. Si el proceso tiene insumos configurados, la tabla debe aparecer; dejar una cantidad vacía y hacer clic en "Siguiente" → debe mostrar el toast de error y NO avanzar. Completar las cantidades y hacer clic en "Siguiente" → debe avanzar al paso 3.
4. Paso 3: clic en "Atrás" → debe volver al paso 2 sin perder el material ni las cantidades de insumos ya cargadas. Avanzar de nuevo a paso 3.
5. Elegir "Asignar", elegir un producto, ingresar cantidad, clic en "Crear orden" → la orden se crea igual que antes del cambio (mismo mensaje de éxito, la lista de solicitudes se actualiza).

- [ ] **Step 3: Probar el flujo ENSAMBLAR**

Repetir el paso 1 y 2 del punto anterior, en el paso 3 elegir "Ensamblar", elegir un tipo de producto sin receta previa → debe abrirse la modal "Definir complementos" por encima del wizard igual que antes; completar y guardar; confirmar que "Crear orden" funciona.

- [ ] **Step 4: Confirmar que no quedan referencias muertas**

Run: `grep -n "isMaterialPickerOpen\|processMaterialPool" frontend/components/production/production-dashboard.tsx`
Expected: sin resultados (ya se habían quitado en el cambio anterior de este mismo módulo; este grep es solo para confirmar que el refactor del wizard no las reintrodujo).

- [ ] **Step 5: Reportar resultado al usuario**

Si todo lo anterior pasa, no hace falta commit adicional (Task 4 es solo verificación). Si algo falla, volver al task correspondiente, corregir, y repetir la verificación de ese task antes de continuar.
