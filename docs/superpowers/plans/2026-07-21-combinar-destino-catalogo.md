# Combinar: destino desde catálogo + crear producto al vuelo — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** En el modal "Ensamblar producto" de inventario, el destino se elige desde un modal de catálogo (con opción de crear el producto ahí mismo y auto-seleccionarlo) y el material del resultado se deriva automáticamente de las piezas combinadas (editable).

**Architecture:** Se extiende el flujo existente `combine_products()` (backend) y el modal de combinar en `inventory-dashboard.tsx`. El picker de destino replica el patrón del modal de catálogo de producción (commit cef928c: agrupado por categoría, orden por código). `ProductTypesManager` gana un callback `onProductCreated` para auto-seleccionar el producto recién creado.

**Tech Stack:** FastAPI + Pydantic v2 + SQLAlchemy (backend), Next.js + React + TanStack Query (frontend).

## Global Constraints

- Nada de stock editado directo: todo por movimientos (CONVERSION_SALIDA/ENTRADA) — ya cumplido por `combine_products()`.
- Nada de procesos/etapas quemados en código.
- `material_code` = segmento de 1 carácter del catálogo (kind MATERIAL); `material_type` = texto libre máx. 80.
- No tocar stack docker (solo `docker exec`).
- Sin infra de tests en el repo: verificación = `tsc --noEmit` (frontend) + `python -m py_compile` (backend) + revisión manual de Rodrigo.

---

### Task 1: Backend — `material_type` en ensamble

**Files:**
- Modify: `backend/modules/inventory/schemas.py:87-93` (ProductCombineCreate)
- Modify: `backend/modules/inventory/service.py:525-598` (combine_products)

**Interfaces:**
- Produces: `ProductCombineCreate.material_type: str | None` (opcional, máx. 80). `combine_products()` guarda ese texto en `InventoryItem.material_type` del item resultante (al crear y al reutilizar).

- [ ] **Step 1: Schema**

```python
class ProductCombineCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sources: list[CombineSourceLine] = Field(min_length=2)
    material_code: str = Field(min_length=1, max_length=1)
    product_type_id: UUID
    quantity: Decimal = Field(gt=0)
    # Texto libre del material del resultado (ej. "ORO 18K + PLATA 925"),
    # derivado de las piezas en el frontend pero editable por el usuario.
    material_type: str | None = Field(default=None, max_length=80)
```

- [ ] **Step 2: Service** — en `combine_products()`, al crear `target` incluir `material_type=payload.material_type`; si `target` ya existía y `payload.material_type` viene, actualizarlo (`target.material_type = payload.material_type`).

- [ ] **Step 3: Verificar** — `python -m py_compile` de ambos archivos (via docker exec api o local).

- [ ] **Step 4: Commit** — `feat(inventario): material_type del producto ensamblado derivado de las piezas`

### Task 2: Frontend API — payload

**Files:**
- Modify: `frontend/lib/inventory-api.ts:93-107` (CombineProductsPayload)

**Interfaces:**
- Produces: `CombineProductsPayload.material_type?: string | null`.

- [ ] **Step 1:** agregar `material_type?: string | null;` al type. `combineProducts()` no cambia (pasa el payload entero).

### Task 3: `ProductTypesManager` — callback de creación

**Files:**
- Modify: `frontend/components/mantenimiento/product-types-manager.tsx:14` (props) y `:196-205` (handleCreateProduct)

**Interfaces:**
- Produces: prop opcional `onProductCreated?: (created: ProductType) => void` — se invoca tras crear producto (opción 3) con el `ProductType` devuelto por la API. Comportamiento actual intacto cuando no se pasa.

- [ ] **Step 1:** agregar prop; en `handleCreateProduct`, tras `invalidateQueries`, llamar `onProductCreated?.(created)`.

### Task 4: Modal de combinar — destino por catálogo + material auto

**Files:**
- Modify: `frontend/components/inventory/inventory-dashboard.tsx` (estado ~364, handler ~887, modal ~2655)

**Interfaces:**
- Consumes: Task 2 payload, Task 3 callback.

- [ ] **Step 1: Estado** — `combineForm` gana `material_type: ""`; nuevos estados `isCombineTargetOpen` (picker) y `isCombineCreateOpen` (ProductTypesManager embebido).

- [ ] **Step 2: Derivación de material** — al cambiar las piezas seleccionadas: por cada pieza, etiqueta = label del segmento MATERIAL cuyo code == `product_code[0]`, fallback `item.material_type`; únicos, join `" + "` → `combineForm.material_type` (sobrescribe; usuario edita después). `material_code` default = primer carácter del `product_code` de la primera pieza si existe en el catálogo (usuario puede cambiar).

- [ ] **Step 3: UI destino** — reemplazar el select "Tipo de producto resultante" por botón "Elegir del catálogo" + texto de selección (patrón cef928c). Modal picker: agrupado por categoría (`category_code · category_label`, sort por código), botones `processPicker` por producto; footer con botón "Crear producto nuevo" que abre `ProductTypesManager` con `onProductCreated` → set `product_type_id`, cerrar manager y picker.

- [ ] **Step 4: Material UI** — mantener select de segmento material (prefilled); agregar input de texto "Material (texto)" con `combineForm.material_type` editable.

- [ ] **Step 5: Submit** — incluir `material_type: combineForm.material_type || null` en payload; reset del form incluye el campo nuevo.

- [ ] **Step 6: Verificar** — `tsc --noEmit` en frontend (antes: borrar `validator.ts` residual de `.next` si estorba).

- [ ] **Step 7: Commit** — `feat(inventario): destino de ensamble desde catalogo con creacion al vuelo`
