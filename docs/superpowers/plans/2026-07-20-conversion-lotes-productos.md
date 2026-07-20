# Conversión de Lotes a Productos Terminados — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir al jefe de inventario convertir parcialmente lotes de procesos terminados (pestaña "Procesos terminados") en productos del catálogo (pestaña "Productos terminados"), mediante movimientos `CONVERSION_SALIDA`/`CONVERSION_ENTRADA`.

**Architecture:** Columna nueva `source_lot_sku` en `inventory_items` para trazabilidad producto→lote. Servicio transaccional `convert_lot_to_product` que valida lote/material/tipo y registra el par de movimientos vía `create_movement` existente. Endpoint `POST /api/inventory/lots/{id}/convert`. Modal en pestaña Procesos terminados del dashboard de inventario.

**Tech Stack:** FastAPI + SQLAlchemy 2.0 + Alembic (backend), Next.js + TypeScript + TanStack Query (frontend).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-20-conversion-lotes-productos-design.md`.
- Todo cambio de stock por movimientos; nunca editar `current_stock` directo (regla CLAUDE.md).
- `product_code` de items = 7 dígitos: material(1)+categoría(2)+modelo(4) (convención `product-types-manager.tsx:48`).
- Permiso del endpoint: `inventory.movements.create` (jefe de inventario y admin, `router.py:ensure_permission`).
- No hay infraestructura de tests backend en el repo: verificación por arranque de API + llamadas reales + `tsc` en frontend.
- Repo corre en Docker; migración se aplica con alembic dentro del contenedor backend.

---

### Task 1: Migración + modelo + schemas backend

**Files:**
- Create: `backend/alembic/versions/f8a9b0c1d2e3_inventory_item_source_lot.py`
- Modify: `backend/modules/inventory/models.py` (columna en `InventoryItem`)
- Modify: `backend/modules/inventory/schemas.py` (Literal + `LotConversionCreate` + campo en Read)
- Modify: `backend/modules/inventory/service.py:56-57` (sets de movimientos)

**Interfaces:**
- Produces: `InventoryItem.source_lot_sku: str | None`; `LotConversionCreate {material_code, product_type_id, quantity}`; tipos de movimiento `CONVERSION_SALIDA` (negativo), `CONVERSION_ENTRADA` (positivo).

- [ ] Migración con `down_revision = "e7f8a9b0c1d2"` (head actual), `op.add_column("inventory_items", sa.Column("source_lot_sku", sa.String(30), nullable=True))`.
- [ ] Modelo: `source_lot_sku: Mapped[str | None] = mapped_column(String(30), nullable=True, index=True)` (índice también en migración).
- [ ] Schemas: agregar `"CONVERSION_SALIDA", "CONVERSION_ENTRADA"` al Literal `InventoryMovementType`; agregar `source_lot_sku: str | None = None` a `InventoryItemRead`; nueva clase:

```python
class LotConversionCreate(BaseModel):
    material_code: str = Field(min_length=1, max_length=1)
    product_type_id: UUID
    quantity: Decimal = Field(gt=0)
```

- [ ] Service: `CONVERSION_ENTRADA` a `POSITIVE_MOVEMENTS`, `CONVERSION_SALIDA` a `NEGATIVE_MOVEMENTS`.
- [ ] Commit.

### Task 2: Servicio `convert_lot_to_product`

**Files:**
- Modify: `backend/modules/inventory/service.py`

**Interfaces:**
- Consumes: `create_movement`, `ITEM_TYPE_PREFIXES`, `CatalogSegment`, `ProductType`.
- Produces: `InventoryService.convert_lot_to_product(lot_item_id: UUID, payload: LotConversionCreate, user_id: UUID | None) -> InventoryItemRead`.

- [ ] Implementar (imports locales de `CatalogSegment`/`ProductType` como hace el resto del código):

```python
def convert_lot_to_product(
    self, lot_item_id: UUID, payload: LotConversionCreate, user_id: UUID | None
) -> InventoryItemRead:
    from sqlalchemy import select
    from backend.modules.catalog.models import CatalogSegment
    from backend.modules.product_types.models import ProductType

    lot = self._get_item_or_raise(lot_item_id)
    if lot.item_type != "FINISHED_PRODUCT":
        raise InventoryDomainError("Solo se pueden convertir lotes de procesos terminados.")
    is_production_lot = any(
        movement.reference_type == "production_order"
        for movement in self.repository.list_movements(lot.id)
    )
    if not is_production_lot:
        raise InventoryDomainError("El item no es un lote de una orden de produccion.")
    if lot.current_stock < payload.quantity:
        raise InventoryDomainError("Stock insuficiente en el lote.")

    session = self.repository.session
    material = session.execute(
        select(CatalogSegment).where(
            CatalogSegment.kind == "MATERIAL",
            CatalogSegment.code == payload.material_code,
            CatalogSegment.is_active.is_(True),
        )
    ).scalar_one_or_none()
    if material is None:
        raise InventoryDomainError("Material no existe en el catalogo.")
    product_type = session.get(ProductType, payload.product_type_id)
    if product_type is None or not product_type.is_active:
        raise InventoryNotFoundError("Tipo de producto no encontrado o inactivo.")

    product_code = f"{payload.material_code}{product_type.category_code}{product_type.model_code}"
    target = next(
        (
            item
            for item in self.repository.list_items("FINISHED_PRODUCT")
            if item.product_code == product_code and item.source_lot_sku == lot.sku
        ),
        None,
    )
    if target is None:
        target = InventoryItem(
            item_type="FINISHED_PRODUCT",
            name=product_type.name or lot.name,
            sku=self._generate_sku("FINISHED_PRODUCT"),
            product_code=product_code,
            source_lot_sku=lot.sku,
            description=None,
            unit_code=lot.unit_code,
            minimum_stock=None,
        )
        self.repository.add_item(target)
        self.repository.flush()

    self.create_movement(
        InventoryMovementCreate(
            item_id=lot.id,
            movement_type="CONVERSION_SALIDA",
            quantity=payload.quantity,
            reason=f"Conversion a producto {product_code}",
            reference_type="lot_conversion",
            reference_id=target.id,
        ),
        user_id=user_id,
    )
    self.create_movement(
        InventoryMovementCreate(
            item_id=target.id,
            movement_type="CONVERSION_ENTRADA",
            quantity=payload.quantity,
            reason=f"Conversion desde lote {lot.sku}",
            reference_type="lot_conversion",
            reference_id=lot.id,
        ),
        user_id=user_id,
        lot_code=lot.sku,
    )
    self.repository.flush()
    return InventoryItemRead.model_validate(target)
```

- [ ] Commit.

### Task 3: Endpoint

**Files:**
- Modify: `backend/modules/inventory/router.py`

**Interfaces:**
- Produces: `POST /api/inventory/lots/{lot_item_id}/convert` → `InventoryItemRead`, permiso `inventory.movements.create`, 404/409.

- [ ] Endpoint siguiendo patrón existente (try/except NotFound→404, Domain→409). Import `LotConversionCreate`.

```python
@router.post("/lots/{lot_item_id}/convert", response_model=InventoryItemRead)
def convert_lot_to_product(
    lot_item_id: UUID,
    payload: LotConversionCreate,
    current_user: CurrentUser = Depends(get_current_user),
    service: InventoryService = Depends(get_inventory_service),
) -> InventoryItemRead:
    ensure_permission(current_user, "inventory.movements.create")
    try:
        return service.convert_lot_to_product(lot_item_id, payload, user_id=current_user.id)
    except InventoryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except InventoryDomainError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
```

- [ ] Aplicar migración en contenedor backend y verificar arranque sin errores.
- [ ] Commit.

### Task 4: Frontend — tipos y API

**Files:**
- Modify: `frontend/types/inventory/index.ts` (o donde viva `InventoryItem`/`InventoryMovementType`)
- Modify: `frontend/lib/inventory-api.ts`

**Interfaces:**
- Produces: `convertLotToProduct(lotItemId: string, payload: {material_code: string; product_type_id: string; quantity: string}) => Promise<InventoryItem>`; tipos de movimiento ampliados; `InventoryItem.source_lot_sku: string | null`.

- [ ] Ampliar union `InventoryMovementType` con `"CONVERSION_SALIDA" | "CONVERSION_ENTRADA"`; agregar `source_lot_sku` al tipo `InventoryItem`; etiquetas de movimiento donde exista el mapa de labels.
- [ ] `convertLotToProduct` en `inventory-api.ts` con `apiRequest` POST.
- [ ] Commit.

### Task 5: Frontend — UI de conversión

**Files:**
- Modify: `frontend/components/inventory/inventory-dashboard.tsx`

**Interfaces:**
- Consumes: `convertLotToProduct`, `listProductTypes` (`@/lib/product-types-api`), `catalogSegments` (ya cargados en el dashboard).

- [ ] Botón "Convertir" en filas de pestaña Procesos terminados (`~línea 1810`), habilitado solo si el item lote (`items.find(i => i.sku === run.production_code)`) tiene `current_stock > 0`; deshabilitado con título "Lote agotado" si 0.
- [ ] Modal de conversión: combo material (segmentos MATERIAL activos), combo tipo de producto (activos, label `category_label · model_label · name`), input cantidad entera (1..stock restante, stock visible), preview del código resultante (material+category+model), botón confirmar.
- [ ] Query de tipos de producto con TanStack Query (`queryKey: ["product-types"]`) si no está ya cargada.
- [ ] Al confirmar: `convertLotToProduct`, invalidar `["inventory"]`, mensaje éxito "Lote convertido en productos.", cerrar modal, manejar error con `setError`.
- [ ] Mostrar lote de origen (`source_lot_sku`) en el detalle del item de Productos terminados si existe.
- [ ] `npx tsc --noEmit` limpio en frontend (borrar validator.ts de .next si estorba — memoria).
- [ ] Commit.

### Task 6: Verificación end-to-end

- [ ] Con Docker arriba: login como jefe de inventario, convertir parcialmente un lote de prueba propio (crear y limpiar después — memoria: no dejar datos de prueba), verificar: stock lote baja, producto aparece en Productos terminados con código correcto, kardex muestra ambos movimientos, segunda conversión al mismo tipo suma al mismo item, conversión con cantidad > stock devuelve 409.
- [ ] Commit final si hubo ajustes.

## Self-Review

- Cobertura spec: 3.1→Task 1, 3.2→Tasks 2-3, 3.3→Tasks 4-5, permisos→Task 3, errores→Task 2/3, pruebas→Task 6 (manual: sin infra pytest en repo — desviación consciente del spec §5).
- Tipos consistentes entre tareas (LotConversionCreate, convertLotToProduct).
