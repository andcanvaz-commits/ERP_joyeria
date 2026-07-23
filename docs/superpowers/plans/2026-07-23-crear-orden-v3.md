# Crear Orden v3 — Producto Único y Receta en Creación — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Modal Crear orden con un solo producto (ambos modos), layout reordenado (complementos antes del producto, cantidad al final) y, en Ensamblar, receta consultada/definida en el momento de crear la orden con autollenado de complementos.

**Architecture:** Sin migraciones. Backend: dos endpoints de recetas standalone sobre las tablas v2. Frontend: rework de la modal (producto único, orden de campos, flujo de receta con el modal de ensamble reutilizado), autollenado receta × cantidad con dirty-flag.

**Tech Stack:** FastAPI + SQLAlchemy + Pydantic v2; Next.js + React + TanStack Query. Docker solo `exec` (stack APAGADO → verificación estática).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-23-crear-orden-v3-receta-en-creacion-design.md`.
- Backend conserva plan multi-fila (compat); la UI siempre manda UNA fila con `quantity = cantidad a fabricar`.
- `create_run` sigue exigiendo ≥1 complemento en ENSAMBLAR (v2); el autollenado lo satisface.
- Sin pytest; verificación = `python -m py_compile` + `npx tsc --noEmit` (hoy CERO errores; debe seguir en cero al cerrar cada task).
- UI/comentarios español terse; idiom de cada archivo. Decimal en backend; en UI los números son display (backend autoritativo).
- Permisos: recetas GET = lectura de producción (`production.runs.read` vía `ensure_permission`); PUT = mismo patrón que POST /runs/{id}/assembly (403 "Jefe de inventario" + `ensure_permission("production.runs.update")`).

---

### Task 1: Endpoints de recetas standalone (backend)

**Files:**
- Modify: `backend/modules/production/schemas.py`, `backend/modules/production/service.py`, `backend/modules/production/router.py`

**Interfaces:**
- Produces:
  - Schemas:
    - `AssemblyRecipeItemRead {complement_item_id: UUID, name: str | None = None, quantity_per_unit: Decimal}` (from_attributes).
    - `AssemblyRecipeRead {product_type_id: UUID | None = None, items: list[AssemblyRecipeItemRead] = []}`.
    - `AssemblyRecipeUpsert {items: list[RunAssemblyLineCreate] min 1}` (reusa `RunAssemblyLineCreate {complement_item_id, quantity_per_unit}` de v2; sin repetidos — validar en service).
  - Service:
    - `get_assembly_recipe(product_type_id: UUID | None, item_id: UUID | None) -> AssemblyRecipeRead`: exactamente uno de los dos (Domain error si no); con `item_id` resuelve el tipo reutilizando la MISMA lógica de `_resolve_plan_product_type_id` (extraer un helper `_product_type_id_for_piece(item_id)` que ambos usen: pieza FINISHED_PRODUCT con product_code len 7 → match ProductType por category/model; None si no). Sin tipo → `AssemblyRecipeRead(product_type_id=None, items=[])`. Con tipo: cargar `AssemblyRecipe` (select por product_type_id) → items con nombres de complementos (batch de InventoryItem, mismo patrón de attach existente) o `items=[]`.
    - `upsert_assembly_recipe(product_type_id: UUID, payload: AssemblyRecipeUpsert, current_user) -> AssemblyRecipeRead`: valida tipo existe y activo (Domain si no); sin `complement_item_id` repetidos; cada item existe y es COMPLEMENT (Domain con nombre); upsert igual que en `define_run_assembly` (replace items, `updated_at`); devuelve el read con nombres. REFACTOR: `define_run_assembly` pasa a delegar su bloque de guardado de receta en un helper compartido con este método (no duplicar el upsert).
  - Router:
    - `GET /assembly-recipes` (query `product_type_id: UUID | None = None`, `item_id: UUID | None = None`) → `ensure_permission("production.runs.read")`; Domain→409 (para el "exactamente uno"), respuesta `AssemblyRecipeRead`.
    - `PUT /assembly-recipes/{product_type_id}` → bloqueo "Jefe de inventario" 403 + `ensure_permission("production.runs.update")`; Domain→409, NotFound→404.

- [ ] **Step 1: Schemas.** — [ ] **Step 2: Service (helper compartido + get + upsert; refactor define_run_assembly para reutilizar el upsert).** — [ ] **Step 3: Router.** — [ ] **Step 4: `python -m py_compile` ×3.** — [ ] **Step 5: Commit** — `feat(produccion): endpoints de recetas de ensamble standalone`

---

### Task 2: Endpoint de tipos con receta (backend) + APIs y tipos frontend

**Files:**
- Modify: `backend/modules/production/service.py`, `backend/modules/production/router.py`
- Modify: `frontend/types/production/index.ts`, `frontend/lib/production-api.ts`

**Interfaces:**
- Produces (backend):
  - Service `list_assembly_recipe_type_ids(self) -> list[UUID]` (select de `AssemblyRecipe.product_type_id`).
  - Router `GET /assembly-recipes/types` → `ensure_permission("production.runs.read")`, response `list[UUID]`. Declararlo ANTES de cualquier ruta con path param bajo el mismo prefijo si la hubiera (hoy solo existe PUT `/assembly-recipes/{product_type_id}`, método distinto — sin conflicto, pero mantener orden por claridad).
- Produces (frontend):
  - Tipo `AssemblyRecipe = { product_type_id: string | null; items: Array<{ complement_item_id: string; name?: string | null; quantity_per_unit: string }> }` (exportado de types/production).
  - `getAssemblyRecipe(params: { productTypeId?: string; itemId?: string })` → GET `/api/production/assembly-recipes?product_type_id=…|item_id=…` (construir query con el param presente).
  - `upsertAssemblyRecipe(productTypeId: string, items: Array<{ complement_item_id: string; quantity_per_unit: string }>)` → PUT `/api/production/assembly-recipes/${productTypeId}` body `{ items }`.
  - `listAssemblyRecipeTypeIds()` → GET `/api/production/assembly-recipes/types` → `string[]`.
- Verificación: py_compile backend ×2 + tsc = 0.

- [ ] **Step 1: Backend endpoint.** — [ ] **Step 2: Frontend tipos+APIs.** — [ ] **Step 3: py_compile + tsc = 0.** — [ ] **Step 4: Commit** — `feat(produccion): api de recetas y tipos con receta`

---

### Task 3: Modal Crear orden v3 — layout y producto único

**Files:**
- Modify: `frontend/components/production/production-dashboard.tsx`

**Interfaces:**
- Consumes: pickers v2 (FinishedItemPicker/CatalogProductPicker), estado v2 (`orderProducts`, `orderComplements`, `assemblyMode`, `productPickerFor`…), `createProductionRun`, `updateProductionRunProducts`.
- Produces:
  1. Estado de producto pasa de lista a UNO: `orderProduct: { targetItemId?: string; productTypeId?: string; label: string } | null` (eliminar `orderProducts` y el render de filas con cantidades; `renderProductRows` desaparece o queda para el modal de editar si se reusa — ver punto 4).
  2. **La sección "Solicitar complementos" se ELIMINA de la modal** (junto con `orderComplements` como estado editable por el usuario y el uso de ComplementPicker desde la modal de crear; ComplementPicker se seguirá usando desde la ventana de receta en Task 4 — no borrar el componente).
  3. Layout dentro de la modal, en este orden exacto: Proceso · Material · toggle Asignar|Ensamblar · "Elegir producto" (botón que abre FinishedItemPicker requireStock=false; onCreate → CatalogProductPicker; muestra label elegido con opción Cambiar) · campo "Cantidad a fabricar" AL FINAL · botón Crear orden.
  4. `handleCreateProductionOrder`: ambos modos mandan `products: [fila única {product_type_id|target_item_id, quantity: runQuantity}]`; ASIGNAR manda `complements: []`; ENSAMBLAR manda los complementos calculados de la receta (Task 4 — en esta task, ENSAMBLAR puede quedar temporalmente con `complements: []`, lo que el backend rechaza con 409: aceptable hasta Task 4, anotarlo en el reporte). Validaciones: producto elegido (mensajes por modo), cantidad > 0. Eliminar la validación de suma de split.
  5. Modal "Editar productos": pasa a producto único (mismo botón picker, sin cantidades); PUT manda una fila con `quantity = run.quantity`. (El backend v2 valida modo y suma: una fila con la cantidad de la orden pasa ambas.)
  6. NO tocar todavía el flujo de receta ni el filtrado de pickers (Task 4) — en ENSAMBLAR elegir producto solo lo fija.
- tsc = 0 al cerrar.

- [ ] **Step 1: Estado + layout (sin complementos).** — [ ] **Step 2: Handler + editar plan.** — [ ] **Step 3: tsc = 0.** — [ ] **Step 4: Commit** — `feat(produccion): crear orden con producto unico y layout reordenado`

---

### Task 4: Flujo de receta en creación (ensamblar)

**Files:**
- Modify: `frontend/components/production/production-dashboard.tsx`

**Interfaces:**
- Consumes: `getAssemblyRecipe`/`upsertAssemblyRecipe`/`listAssemblyRecipeTypeIds` (Tasks 1-2), `ComplementPicker`, `productTypesList` (tiene `category_code`/`model_code` por tipo), `complementItems` del bundle.
- Produces:
  1. **Estado de receta**: `orderRecipe: AssemblyRecipe | null`. Al elegir producto en modo ENSAMBLAR (tras el picker): `getAssemblyRecipe({productTypeId|itemId según lo elegido})`.
     - `items.length > 0` → `orderRecipe = recipe` (la solicitud se calcula al crear, punto 3).
     - `items.length === 0 && product_type_id !== null` → abrir **modal de receta** (punto 2) con ese product_type_id.
     - `product_type_id === null` (pieza sin tipo resoluble) → NO se puede ensamblar: error terse ("Esta pieza no tiene tipo en el catálogo: usa Asignar.") y limpiar la selección de producto.
  2. **Modal de receta** (abre sobre la de crear, `modalBackdropTop`): filas de receta empiezan VACÍAS; botón "Elegir complementos" abre `ComplementPicker` (items COMPLEMENT del bundle, excludeIds los ya elegidos) y cada selección agrega fila {label, input "por unidad"}. Quitar fila con basurero. Validación: ≥1 fila con por-unidad > 0. Guardar → `upsertAssemblyRecipe(productTypeId, items)` → `orderRecipe = receta guardada` → cerrar, success "Receta guardada.". Cancelar → limpiar la selección de producto (sin receta no hay ensamble).
  3. **Solicitud automática (sin UI)**: `handleCreateProductionOrder` en ENSAMBLAR calcula `complements = orderRecipe.items.map({item_id: complement_item_id, quantity: String(per_unit × Number(runQuantity))})`; si `orderRecipe` es null o sin items → error "Este producto necesita receta para ensamblar." (no debería pasar por el punto 1/2). ASIGNAR → `complements: []`. No hay sección de complementos en la modal (Task 3 ya la quitó).
  4. **Filtrado de pickers en ASIGNAR**: cargar `recipeTypeIds` (query `["assembly-recipe-types"]`, `listAssemblyRecipeTypeIds`, enabled variante production). En modo ASIGNAR: `FinishedItemPicker` recibe items filtrados excluyendo piezas cuyo tipo tiene receta (resolver tipo de pieza en frontend: `productTypesList.find(t => t.category_code === code.slice(1,3) && t.model_code === code.slice(3,7))`; si el tipo resuelto está en `recipeTypeIds` → excluir); `CatalogProductPicker` en ASIGNAR excluye tipos con receta (según sus props: pasar lista filtrada o allowed — leer el componente y aplicar el mecanismo que ofrezca; si solo acepta `allowed`, construir la lista de ids permitidos = todos los tipos activos sin receta). ENSAMBLAR muestra todo.
  5. **Reset total**: `resetCreateOrderState()` (producto, modo, receta, cantidad, pickers) usado en éxito Y en el botón X (cierra follow-up v2). Invalidar query `["assembly-recipe-types"]` tras guardar receta.
  6. El modal "Definir ensamble" post-producción (assemblyRun) sigue igual.
- tsc = 0 al cerrar.

- [ ] **Step 1: Query receta al elegir producto + bloqueo pieza sin tipo.** — [ ] **Step 2: Modal receta.** — [ ] **Step 3: Solicitud automática en handler.** — [ ] **Step 4: Filtrado de pickers ASIGNAR.** — [ ] **Step 5: resetCreateOrderState + invalidación.** — [ ] **Step 6: tsc = 0.** — [ ] **Step 7: Commit** — `feat(produccion): receta en creacion, solicitud automatica y pickers filtrados`

---

### Task 5: Verificación

- [ ] **Step 1:** py_compile (production schemas/service/router) + tsc = 0.
- [ ] **Step 2 (PENDIENTE stack):** QA agregado al backlog: layout nuevo; asignar/ensamblar producto único; ensamblar sin receta abre modal de receta y la guarda; con receta autollena y recalcula al cambiar cantidad; edición manual detiene recálculo; pieza sin tipo → aviso y respaldo post-producción; crear orden ENSAMBLAR autollenada pasa la validación ≥1 complemento.
- [ ] **Step 3:** Spec update si hay desvíos; commit.
