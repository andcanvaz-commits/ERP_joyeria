# Wizard "Crear orden de producción" — Design

## Contexto

El modal "Crear orden" en `frontend/components/production/production-dashboard.tsx`
(sección `isCreateOrderOpen`, ~líneas 2248-2394) muestra hoy todo de una vez:
combo de proceso, combo de material, toggle Asignar/Ensamblar, selector de
producto, cantidad a fabricar y (si aplica) tabla de insumos configurados —
todo en una sola pantalla del modal.

El usuario pidió partir esto en un flujo paso a paso para que no aparezcan
muchos elementos a la vez ni "de la nada", y que el paso de elegir proceso
deje de ser un combo box.

**Fuera de alcance:** mantenimiento de procesos (`ProcessForm` y su JSX) no
cambia. Los procesos se siguen creando/editando exactamente igual que hoy.
Este documento cubre solo el flujo de creación de una orden (runtime).

## Pasos acordados con el usuario

1. **Proceso** — buscador + lista vertical de procesos activos (solo el
   nombre, sin metadata de etapas/insumos). Clic en una fila selecciona el
   proceso y avanza sola al paso 2 (no hace falta botón "Siguiente": es una
   elección de un solo clic).
2. **Material e insumos** — combo de materia prima (igual que hoy, ya lista
   TODAS las materias primas del inventario) + tabla de insumos configurados
   en las etapas activas del proceso elegido (aparece solo si el proceso
   tiene insumos configurados; si no tiene, el paso es solo el combo).
   Botón "Siguiente" valida: material elegido y cantidad > 0 en cada insumo
   configurado (misma validación que hoy tiene `handleCreateProductionOrder`,
   pero movida a este punto del flujo).
3. **Destino, producto y cantidad** — toggle Asignar/Ensamblar + selector de
   producto (reutiliza los pickers existentes, ver "Qué NO se mueve" abajo) +
   cantidad a fabricar. Botón final "Crear orden" en vez de "Siguiente".

Navegación: stepper numerado arriba (`① Proceso ② Material ③ Producto`,
resaltando el paso actual) + botón "Atrás" en los pasos 2 y 3. Un solo modal
para todo el flujo — el contenido cambia por paso, no se abren/cierran
modales distintos.

Si el modo es ENSAMBLAR y el producto elegido no tiene una receta ya
confirmada para esta combinación, se sigue abriendo la modal "Definir
complementos" que ya existe hoy (`recipeModalModelKey`), por encima del
wizard, antes de poder crear la orden — sin cambios en ese mecanismo.

## Extracción a componente propio

Se extrae la UI del wizard (los 3 pasos + navegación) a
`frontend/components/production/create-order-wizard.tsx`. Justificación:
`production-dashboard.tsx` ya tiene ~4k líneas; este modal por sí solo pasaría
a ser ~200+ líneas de JSX con lógica de pasos, y aislarlo es más fácil de
razonar y de tocar a futuro sin arrastrar el resto del dashboard.

### Qué se mueve al nuevo componente

- El estado de navegación `createOrderStep: 1 | 2 | 3` (nuevo, vive DENTRO
  del componente — es un detalle de presentación, no de dominio). Se resetea
  a `1` cuando `isOpen` pasa a `true` (via `useEffect`).
- El JSX de los 3 pasos, el stepper, los botones Atrás/Siguiente/Crear orden.
- La validación de "Siguiente" del paso 2 (insumos completos).
- El buscador y filtro de la lista de procesos del paso 1 (estado local
  `processSearch: string`, solo dentro del wizard).

### Qué NO se mueve (queda en `production-dashboard.tsx`)

Motivo: es estado compartido con otros flujos del dashboard (mantenimiento de
recetas, edición de plan de producto de una corrida ya creada) que no forman
parte de este wizard. Moverlo rompería esos flujos.

- `selectedProcessId`, `selectedMaterialId`, `runQuantity`,
  `stageIngredientQuantities`, `assemblyMode`, `orderProduct`: el wizard los
  recibe como props (valor + setter), igual que hoy los usa el modal inline.
- `orderRecipe`, `recipeLines`, `recipeModalContext`, `recipeModalModelKey` y
  las funciones `loadOrderRecipeForChoice`/`handleSaveRecipe`: siguen en el
  padre porque `recipeModalContext` también vale `"maintenance"` para el tile
  "Crear receta" de mantenimiento, que no tiene nada que ver con este wizard.
- Los pickers de producto (`itemPickerFor`/`typePickerFor`/`assignPickerTab`
  y sus modales `MaterialCategoryPicker`/tipo): compartidos con el flujo de
  "editar plan de producto" (`itemPickerFor === "edit"`). El wizard solo
  dispara `onOpenProductPicker()` (callback ya armado en el padre con la
  lógica actual de "ENSAMBLAR abre selector de tipo, ASIGNAR abre selector de
  pieza") y recibe el resultado ya resuelto vía `orderProduct` prop.
- `error`/`success` (toasts de página): el wizard llama a `onError(message)`
  para la validación del paso 2, reutilizando el mismo toast de siempre — no
  se inventa un patrón de error nuevo dentro del modal.
- `handleCreateProductionOrder`, `resetCreateOrderState`,
  `configuredStageIngredients` (derivado de `selectedProcessId`): siguen en
  el padre: el wizard los recibe como props (`onSubmit`, `onClose`,
  `configuredStageIngredients`).

### Props del componente

```ts
type CreateOrderWizardProps = {
  isOpen: boolean;
  onClose: () => void;
  isSaving: boolean;
  onError: (message: string) => void;

  processes: ProductionProcess[]; // ya filtrados a activos por el padre
  selectedProcessId: string;
  onSelectProcess: (id: string) => void;

  rawMaterials: InventoryItem[];
  selectedMaterialId: string;
  onSelectMaterial: (id: string) => void;
  selectedMaterial: InventoryItem | null;

  suppliesList: InventoryItem[];
  configuredStageIngredients: Array<{ configId: string; stageName: string; inventoryItemId: string }>;
  stageIngredientQuantities: Record<string, string>;
  onChangeStageIngredientQuantity: (configId: string, value: string) => void;

  assemblyMode: "ASIGNAR" | "ENSAMBLAR";
  onChangeAssemblyMode: (mode: "ASIGNAR" | "ENSAMBLAR") => void;
  orderProduct: ProductChoice | null;
  onOpenProductPicker: () => void;

  runQuantity: string;
  onChangeRunQuantity: (value: string) => void;

  onSubmit: () => void; // dispara handleCreateProductionOrder en el padre
};
```

`ProductChoice` e `InventoryItem`/`ProductionProcess` se importan de los
mismos `types/` que ya usa `production-dashboard.tsx`.

## Paso 1 en detalle

- Input de búsqueda arriba (filtra por `name`, client-side, sin llamada a
  API — la lista de procesos ya está cargada).
- Lista vertical de filas clicables, solo `process.name`. Sin contador de
  etapas ni de insumos (decisión explícita del usuario).
- Clic en una fila: `onSelectProcess(id)` + avanza el `createOrderStep`
  interno a `2`.
- Si no hay procesos activos: estado vacío ("No hay procesos activos.").
- Si el buscador no matchea nada: estado vacío de "sin resultados".

## Paso 2 en detalle

- Combo `<select>` de materia prima, igual que el actual (no se convierte a
  lista — el usuario solo pidió el cambio de vista para el paso de proceso).
- Debajo, la tabla de insumos configurados (idéntica a la que existe hoy),
  solo si `configuredStageIngredients.length > 0`.
- Botón "Siguiente": si `!selectedMaterialId` o falta cantidad en algún
  insumo → `onError(...)` y no avanza. Si pasa, `createOrderStep` interno a
  `3`.
- Botón "Atrás": `createOrderStep` interno a `1` (no toca las selecciones ya
  hechas).

## Paso 3 en detalle

- Toggle Asignar/Ensamblar (`onChangeAssemblyMode`), selector de producto
  (`renderProductChooser`-equivalente usando `orderProduct` +
  `onOpenProductPicker`), input de cantidad a fabricar
  (`onChangeRunQuantity`), con la unidad de `selectedMaterial.unit_code`
  igual que hoy.
- Botón "Crear orden": llama `onSubmit()` (el padre mantiene toda la
  validación y el llamado a `createProductionRun` que ya existe en
  `handleCreateProductionOrder`, sin cambios de lógica).
- Botón "Atrás": vuelve a `2`.

## Testing / verificación

No hay tests automatizados de frontend en este proyecto (sin Jest/Testing
Library configurado). Verificación manual en navegador tras implementar:
buscar proceso, elegir, llenar insumos si aplica, volver atrás y confirmar
que no se pierden las selecciones previas, ambos modos ASIGNAR y ENSAMBLAR
(incluyendo el camino de "Definir complementos"), y `npm run build` sin
errores de tipos.
