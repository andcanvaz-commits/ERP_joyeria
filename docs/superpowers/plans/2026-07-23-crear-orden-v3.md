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

### Task 2: APIs y tipos frontend

**Files:**
- Modify: `frontend/types/production/index.ts`, `frontend/lib/production-api.ts`

**Interfaces:**
- Produces:
  - Tipo `AssemblyRecipe = { product_type_id: string | null; items: Array<{ complement_item_id: string; name?: string | null; quantity_per_unit: string }> }` (exportado de types/production).
  - `getAssemblyRecipe(params: { productTypeId?: string; itemId?: string })` → GET `/api/production/assembly-recipes?product_type_id=…|item_id=…` (construir query con el param presente).
  - `upsertAssemblyRecipe(productTypeId: string, items: Array<{ complement_item_id: string; quantity_per_unit: string }>)` → PUT `/api/production/assembly-recipes/${productTypeId}` body `{ items }`.
- tsc: cero errores (solo se agregan tipos/funciones).

- [ ] **Step 1: Implementar.** — [ ] **Step 2: tsc = 0.** — [ ] **Step 3: Commit** — `feat(front): api de recetas de ensamble`

---

### Task 3: Modal Crear orden v3 — layout y producto único

**Files:**
- Modify: `frontend/components/production/production-dashboard.tsx`

**Interfaces:**
- Consumes: pickers v2 (FinishedItemPicker/CatalogProductPicker/ComplementPicker), estado v2 (`orderProducts`, `orderComplements`, `assemblyMode`, `productPickerFor`…), `createProductionRun`, `updateProductionRunProducts`.
- Produces:
  1. Estado de producto pasa de lista a UNO: `orderProduct: { targetItemId?: string; productTypeId?: string; label: string } | null` (eliminar `orderProducts` y el render de filas con cantidades; `renderProductRows` desaparece o queda para el modal de editar si se reusa — ver punto 4).
  2. Layout dentro de la modal, en este orden exacto: Proceso · Material · toggle Asignar|Ensamblar · sección "Solicitar complementos" (igual v2: botón + filas con cantidad) · "Elegir producto" (botón que abre FinishedItemPicker requireStock=false; onCreate → CatalogProductPicker; muestra label elegido con opción Cambiar) · campo "Cantidad a fabricar" AL FINAL · botón Crear orden.
  3. `handleCreateProductionOrder`: ambos modos mandan `products: [fila única {product_type_id|target_item_id, quantity: runQuantity}]`; validaciones: producto elegido (mensajes por modo), cantidad > 0, ENSAMBLAR ≥1 complemento (ya existe). Eliminar la validación de suma de split.
  4. Modal "Editar productos": pasa a producto único (mismo botón picker, sin cantidades); PUT manda una fila con `quantity = run.quantity`. (El backend v2 valida modo y suma: una fila con la cantidad de la orden pasa ambas.)
  5. NO tocar todavía el flujo de receta (Task 4) — en ENSAMBLAR elegir producto solo lo fija.
- tsc = 0 al cerrar.

- [ ] **Step 1: Estado + layout.** — [ ] **Step 2: Handler + editar plan.** — [ ] **Step 3: tsc = 0.** — [ ] **Step 4: Commit** — `feat(produccion): crear orden con producto unico y layout reordenado`

---

### Task 4: Flujo de receta en creación (ensamblar)

**Files:**
- Modify: `frontend/components/production/production-dashboard.tsx`

**Interfaces:**
- Consumes: `getAssemblyRecipe`/`upsertAssemblyRecipe` (Task 2), modal de ensamble v2 (`assemblyRun`/`assemblyLines` — se generaliza), `ComplementPicker`.
- Produces:
  1. Al elegir producto en modo ENSAMBLAR (tras el picker): `getAssemblyRecipe({productTypeId|itemId según lo elegido})`.
     - `items.length > 0` → guardar `orderRecipe = recipe` y autollenar `orderComplements` (ver punto 3).
     - `items.length === 0 && product_type_id !== null` → abrir **modal de receta** (punto 2) con ese product_type_id.
     - `product_type_id === null` (pieza sin tipo resoluble) → aviso terse ("Esta pieza no tiene tipo en el catálogo: el ensamble se definirá al finalizar producción.") y seguir sin receta.
  2. **Modal de receta**: generalizar el modal "Definir ensamble" de v2 a dos usos (extraer a función/JSX parametrizado o duplicar mínimamente respetando el idiom — preferir parametrizar):
     - Fuente de filas: los complementos del borrador (`orderComplements` con label) con input "por unidad"; botón "+ Elegir más" que abre `ComplementPicker` y agrega filas (también al borrador de solicitados).
     - Sin límite de "aprobado" aquí (no hay orden aún); validación: ≥1 fila con por-unidad > 0.
     - Guardar → `upsertAssemblyRecipe(productTypeId, items)` → set `orderRecipe` → cerrar y autollenar (punto 3). Mensaje éxito: "Receta guardada.".
     - Cancelar → el producto queda elegido pero sin receta (el respaldo post-producción de v2 aplica).
  3. **Autollenado editable con dirty-flag**: al fijar `orderRecipe` o al cambiar `runQuantity`, si el usuario NO ha editado manualmente las filas de complementos autollenadas (flag `complementsDirty`, se activa con cualquier edición manual de filas; se resetea al autollenar de nuevo tras cambiar de producto/receta), recalcular `orderComplements = items.map({itemId, quantity: String(per_unit × Number(runQuantity || 0))})` (labels desde `complementItems`). Cantidad vacía → filas con cantidad vacía (se llenan al poner cantidad).
  4. Reset de todo el estado nuevo al crear con éxito y al cerrar la modal con X (aprovechar para cerrar el follow-up v2: resetear TODO el estado de la modal — producto, complementos, modo, receta, dirty — en un `resetCreateOrderState()` usado por éxito y por cierre).
  5. El modal "Definir ensamble" post-producción (assemblyRun) sigue funcionando igual.
- tsc = 0 al cerrar.

- [ ] **Step 1: Query receta al elegir producto.** — [ ] **Step 2: Modal receta (parametrizado).** — [ ] **Step 3: Autollenado + dirty-flag + recálculo por cantidad.** — [ ] **Step 4: resetCreateOrderState en éxito y X.** — [ ] **Step 5: tsc = 0.** — [ ] **Step 6: Commit** — `feat(produccion): receta en creacion con autollenado de complementos`

---

### Task 5: Verificación

- [ ] **Step 1:** py_compile (production schemas/service/router) + tsc = 0.
- [ ] **Step 2 (PENDIENTE stack):** QA agregado al backlog: layout nuevo; asignar/ensamblar producto único; ensamblar sin receta abre modal de receta y la guarda; con receta autollena y recalcula al cambiar cantidad; edición manual detiene recálculo; pieza sin tipo → aviso y respaldo post-producción; crear orden ENSAMBLAR autollenada pasa la validación ≥1 complemento.
- [ ] **Step 3:** Spec update si hay desvíos; commit.
