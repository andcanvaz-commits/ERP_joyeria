# Tipos de Producto Terminado — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Definir tipos de producto terminado (tipo→categoría con materia prima, sin piezas de inventario) desde Mantenimientos.

**Architecture:** Backend: módulo `product_types` calcado del patrón `catalog` (models/schemas/service/router + registro en `main.py`) con migración Alembic de tabla nueva. Frontend: cliente API + manager modal calcado de `units-manager.tsx`, sección con 2 tiles en `production-dashboard.tsx`; la vista lista tipos definidos + pares derivados del inventario.

**Tech Stack:** FastAPI/SQLAlchemy/Alembic, Next.js/React/TS.

**Spec:** `docs/superpowers/specs/2026-07-06-tipos-producto-terminado-design.md`

## Global Constraints

- Head Alembic actual: `f2a3b4c5d6e7`; la nueva migración cuelga de ahí.
- Endpoints con JWT (`get_current_user`), patrón de `backend/modules/catalog/router.py`.
- No crea items de inventario ni movimientos.
- Typecheck: `docker compose exec -T web npx tsc --noEmit` → exit 0. API reinicia con `docker compose restart api`.
- Textos UI en español.

---

### Task 1: Backend módulo product_types + migración

**Files:**
- Create: `backend/modules/product_types/__init__.py` (vacío)
- Create: `backend/modules/product_types/models.py`
- Create: `backend/modules/product_types/schemas.py`
- Create: `backend/modules/product_types/service.py`
- Create: `backend/modules/product_types/router.py`
- Create: `backend/alembic/versions/a3b4c5d6e7f8_product_types.py`
- Modify: `backend/app/main.py` (import modelos + include_router)

**Interfaces:**
- Consumes: `Base` de `backend.modules.database.base`, `SessionLocal`, `get_current_user`, tablas `catalog_segments` e `inventory_items`.
- Produces: API `GET/POST/DELETE /api/product-types`; `ProductTypeRead` con campos `id, category_code, model_code, product_code, category_label, model_label, raw_material_item_id, raw_material_name, purity, is_active`.

- [ ] **Step 1: models.py**

```python
from datetime import datetime
from uuid import UUID as PyUUID, uuid4

from sqlalchemy import Boolean, DateTime, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from backend.modules.database.base import Base


class ProductType(Base):
    """Definicion de tipo de producto terminado: tipo (categoria de catalogo)
    + categoria (modelo de catalogo) + materia prima. No es inventario."""

    __tablename__ = "product_types"

    id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    category_code: Mapped[str] = mapped_column(String(10), nullable=False)
    model_code: Mapped[str] = mapped_column(String(10), nullable=False)
    product_code: Mapped[str] = mapped_column(String(20), nullable=False, unique=True, index=True)
    raw_material_item_id: Mapped[PyUUID] = mapped_column(ForeignKey("inventory_items.id"), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
```

- [ ] **Step 2: schemas.py**

```python
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ProductTypeCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    category_code: str = Field(min_length=1, max_length=10)
    model_code: str = Field(min_length=1, max_length=10)
    raw_material_item_id: UUID


class ProductTypeRead(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: UUID
    category_code: str
    model_code: str
    product_code: str
    category_label: str
    model_label: str
    raw_material_item_id: UUID
    raw_material_name: str
    purity: str | None = None
    is_active: bool = True
```

- [ ] **Step 3: service.py**

```python
from uuid import UUID

from sqlalchemy import select

from backend.modules.catalog.models import CatalogSegment
from backend.modules.inventory.models import InventoryItem
from backend.modules.product_types.models import ProductType
from backend.modules.product_types.schemas import ProductTypeCreate, ProductTypeRead


class ProductTypeError(ValueError):
    pass


class ProductTypeService:
    def __init__(self, session) -> None:
        self.session = session

    def _segment(self, kind: str, code: str, parent: str | None = None) -> CatalogSegment | None:
        query = select(CatalogSegment).where(CatalogSegment.kind == kind, CatalogSegment.code == code)
        query = query.where(CatalogSegment.parent_code == parent) if parent else query
        return self.session.execute(query).scalars().first()

    def _material_digit(self, material_type: str | None) -> str:
        """Segmento MATERIAL cuyo label este contenido en el material_type del item."""
        materials = self.session.execute(select(CatalogSegment).where(CatalogSegment.kind == "MATERIAL")).scalars().all()
        text = (material_type or "").upper()
        for segment in materials:
            if segment.label.upper() in text:
                return segment.code
        raise ProductTypeError("La materia prima no coincide con ningun material del catalogo (ORO, PLATA...).")

    def _to_read(self, row: ProductType) -> ProductTypeRead:
        category = self._segment("CATEGORY", row.category_code)
        model = self._segment("MODEL", row.model_code, parent=row.category_code)
        item = self.session.get(InventoryItem, row.raw_material_item_id)
        return ProductTypeRead(
            id=row.id,
            category_code=row.category_code,
            model_code=row.model_code,
            product_code=row.product_code,
            category_label=category.label if category else row.category_code,
            model_label=model.label if model else row.model_code,
            raw_material_item_id=row.raw_material_item_id,
            raw_material_name=item.name if item else "",
            purity=item.purity if item else None,
            is_active=row.is_active,
        )

    def list_types(self) -> list[ProductTypeRead]:
        rows = self.session.execute(select(ProductType).order_by(ProductType.product_code)).scalars().all()
        return [self._to_read(row) for row in rows]

    def create_type(self, payload: ProductTypeCreate) -> ProductTypeRead:
        item = self.session.get(InventoryItem, payload.raw_material_item_id)
        if item is None or item.item_type != "RAW_MATERIAL":
            raise ProductTypeError("La materia prima seleccionada no existe.")
        if self._segment("CATEGORY", payload.category_code) is None:
            raise ProductTypeError("El tipo (categoria de catalogo) no existe.")
        if self._segment("MODEL", payload.model_code, parent=payload.category_code) is None:
            raise ProductTypeError("La categoria (modelo) no existe dentro de ese tipo.")
        material = self._material_digit(item.material_type)
        product_code = f"{material}{payload.category_code}{payload.model_code}"
        existing = self.session.execute(
            select(ProductType).where(ProductType.product_code == product_code)
        ).scalars().first()
        if existing is not None:
            raise ProductTypeError("Ese tipo de producto ya esta definido.")
        row = ProductType(
            category_code=payload.category_code,
            model_code=payload.model_code,
            product_code=product_code,
            raw_material_item_id=payload.raw_material_item_id,
        )
        self.session.add(row)
        self.session.flush()
        return self._to_read(row)

    def delete_type(self, type_id: UUID) -> None:
        row = self.session.get(ProductType, type_id)
        if row is None:
            raise ProductTypeError("Tipo de producto no encontrado.")
        self.session.delete(row)
```

- [ ] **Step 4: router.py**

```python
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from backend.modules.auth.dependencies import CurrentUser, get_current_user
from backend.modules.database.session import SessionLocal
from backend.modules.product_types.schemas import ProductTypeCreate, ProductTypeRead
from backend.modules.product_types.service import ProductTypeError, ProductTypeService

router = APIRouter()


def get_product_type_service():
    session = SessionLocal()
    try:
        yield ProductTypeService(session)
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


@router.get("", response_model=list[ProductTypeRead])
def list_types(
    current_user: CurrentUser = Depends(get_current_user),
    service: ProductTypeService = Depends(get_product_type_service),
) -> list[ProductTypeRead]:
    return service.list_types()


@router.post("", response_model=ProductTypeRead, status_code=status.HTTP_201_CREATED)
def create_type(
    payload: ProductTypeCreate,
    current_user: CurrentUser = Depends(get_current_user),
    service: ProductTypeService = Depends(get_product_type_service),
) -> ProductTypeRead:
    try:
        return service.create_type(payload)
    except ProductTypeError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc


@router.delete("/{type_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_type(
    type_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    service: ProductTypeService = Depends(get_product_type_service),
) -> None:
    try:
        service.delete_type(type_id)
    except ProductTypeError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
```

- [ ] **Step 5: Registro en main.py**

Junto a los imports de catalog (línea ~20):

```python
from backend.modules.product_types import models as product_type_models  # noqa: F401
from backend.modules.product_types.router import router as product_types_router
```

Junto a los include_router (línea ~275):

```python
app.include_router(product_types_router, prefix="/api/product-types", tags=["product-types"])
```

- [ ] **Step 6: Migración**

`backend/alembic/versions/a3b4c5d6e7f8_product_types.py`:

```python
"""Tabla product_types: definicion de tipos de producto terminado.

Revision ID: a3b4c5d6e7f8
Revises: f2a3b4c5d6e7
Create Date: 2026-07-06
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

# revision identifiers, used by Alembic.
revision: str = "a3b4c5d6e7f8"
down_revision: Union[str, None] = "f2a3b4c5d6e7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "product_types",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("category_code", sa.String(10), nullable=False),
        sa.Column("model_code", sa.String(10), nullable=False),
        sa.Column("product_code", sa.String(20), nullable=False, unique=True, index=True),
        sa.Column("raw_material_item_id", UUID(as_uuid=True), sa.ForeignKey("inventory_items.id"), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("product_types")
```

- [ ] **Step 7: Aplicar y verificar API**

```bash
docker compose exec -T api alembic upgrade head
docker compose restart api && sleep 8
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/api/product-types
```

Expected: migración `f2a3b4c5d6e7 -> a3b4c5d6e7f8`; curl devuelve `401` (protegido, existente).

- [ ] **Step 8: Commit**

```bash
git add backend/modules/product_types backend/alembic/versions/a3b4c5d6e7f8_product_types.py backend/app/main.py
git commit -m "feat(mantenimientos): API de tipos de producto terminado (tipo+categoria+materia prima)"
```

---

### Task 2: Frontend — manager y sección en Mantenimientos

**Files:**
- Create: `frontend/lib/product-types-api.ts`
- Create: `frontend/components/mantenimiento/product-types-manager.tsx`
- Modify: `frontend/components/production/production-dashboard.tsx` (sección tiles + dataModal "productTypes")

**Interfaces:**
- Consumes: API Task 1; `listCatalogSegments`/`createCatalogSegment` de `@/lib/catalog-api`; `listInventoryItems("RAW_MATERIAL")` y `listInventoryItems("FINISHED_PRODUCT")` de `@/lib/inventory-api`; `useConfirm`/`confirmDelete`.
- Produces: componente `ProductTypesManager({ mode, onClose })`.

- [ ] **Step 1: product-types-api.ts**

```ts
import { apiRequest } from "@/lib/api";

export type ProductType = {
  id: string;
  category_code: string;
  model_code: string;
  product_code: string;
  category_label: string;
  model_label: string;
  raw_material_item_id: string;
  raw_material_name: string;
  purity: string | null;
  is_active: boolean;
};

export function listProductTypes() {
  return apiRequest<ProductType[]>("/api/product-types");
}

export function createProductType(payload: {
  category_code: string;
  model_code: string;
  raw_material_item_id: string;
}) {
  return apiRequest<ProductType>("/api/product-types", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function deleteProductType(id: string) {
  return apiRequest<void>(`/api/product-types/${id}`, { method: "DELETE" });
}
```

- [ ] **Step 2: product-types-manager.tsx**

Estructura (patrón `units-manager.tsx`: modalBackdrop/modalWindow/toastStack/confirmDelete). Contenido clave:

```tsx
"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, X } from "lucide-react";
import { createCatalogSegment, listCatalogSegments } from "@/lib/catalog-api";
import { listInventoryItems } from "@/lib/inventory-api";
import { createProductType, deleteProductType, listProductTypes } from "@/lib/product-types-api";
import { confirmDelete, useConfirm } from "@/components/ui/confirm-dialog";

const NEW = "__new__";

export function ProductTypesManager({ mode, onClose }: { mode: "create" | "view"; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: segments = [] } = useQuery({ queryKey: ["catalog-segments"], queryFn: listCatalogSegments });
  const { data: rawMaterials = [] } = useQuery({ queryKey: ["raw-materials"], queryFn: () => listInventoryItems("RAW_MATERIAL") });
  const { data: types = [], isLoading } = useQuery({ queryKey: ["product-types"], queryFn: listProductTypes });
  const { data: finishedItems = [] } = useQuery({
    queryKey: ["finished-products"],
    queryFn: () => listInventoryItems("FINISHED_PRODUCT"),
    enabled: mode === "view",
  });

  const categories = segments.filter((s) => s.kind === "CATEGORY");
  const [categoryCode, setCategoryCode] = useState("");
  const [newCategoryLabel, setNewCategoryLabel] = useState("");
  const [modelCode, setModelCode] = useState("");
  const [newModelLabel, setNewModelLabel] = useState("");
  const [materialItemId, setMaterialItemId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const { confirm, dialog } = useConfirm();

  const models = segments.filter((s) => s.kind === "MODEL" && s.parent_code === categoryCode);
  const selectedMaterial = rawMaterials.find((item) => item.id === materialItemId) ?? null;
  // Vista previa: 2 (PLATA) segun material de la materia prima; el backend calcula el real.
  const materialDigit = selectedMaterial?.material_type?.toUpperCase().includes("ORO") ? "1"
    : selectedMaterial?.material_type?.toUpperCase().includes("PLATA") ? "2" : "?";
  const codePreview = `${materialDigit}${categoryCode === NEW ? "??" : categoryCode || "??"}${modelCode === NEW ? "????" : modelCode || "????"}`;

  // Pares ya en inventario (derivados del product_code de las piezas).
  const inventoryPairs = useMemo(() => {
    const seen = new Map<string, number>();
    for (const item of finishedItems) {
      if (item.product_code && item.product_code.length === 7) {
        seen.set(item.product_code, (seen.get(item.product_code) ?? 0) + 1);
      }
    }
    const definedCodes = new Set(types.map((t) => t.product_code));
    const labelOf = (kind: string, code: string, parent?: string) =>
      segments.find((s) => s.kind === kind && s.code === code && (kind === "MODEL" ? s.parent_code === parent : true))?.label ?? code;
    return [...seen.entries()]
      .filter(([code]) => !definedCodes.has(code))
      .map(([code, count]) => ({
        code,
        categoryCode: code.slice(1, 3),
        modelCode: code.slice(3),
        categoryLabel: labelOf("CATEGORY", code.slice(1, 3)),
        modelLabel: labelOf("MODEL", code.slice(3), code.slice(1, 3)),
        pieces: count,
      }))
      .sort((a, b) => a.code.localeCompare(b.code));
  }, [finishedItems, types, segments]);

  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(() => setSuccess(null), 3000);
    return () => clearTimeout(timer);
  }, [success]);

  async function handleAdd(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!categoryCode || (categoryCode === NEW && !newCategoryLabel.trim())) {
      setError("Selecciona o escribe el tipo.");
      return;
    }
    if (!modelCode || (modelCode === NEW && !newModelLabel.trim())) {
      setError("Selecciona o escribe la categoria.");
      return;
    }
    if (!selectedMaterial) {
      setError("Selecciona la materia prima.");
      return;
    }
    setIsSaving(true);
    try {
      let cat = categoryCode;
      if (cat === NEW) {
        const created = await createCatalogSegment({ kind: "CATEGORY", label: newCategoryLabel.trim().toUpperCase() });
        cat = created.code;
      }
      let model = modelCode;
      if (model === NEW) {
        const created = await createCatalogSegment({ kind: "MODEL", label: newModelLabel.trim().toUpperCase(), parent_code: cat });
        model = created.code;
      }
      await createProductType({ category_code: cat, model_code: model, raw_material_item_id: selectedMaterial.id });
      setCategoryCode(""); setNewCategoryLabel(""); setModelCode(""); setNewModelLabel(""); setMaterialItemId("");
      setSuccess("Tipo de producto creado.");
      await queryClient.invalidateQueries({ queryKey: ["product-types"] });
      await queryClient.invalidateQueries({ queryKey: ["catalog-segments"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear el tipo.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(id: string, label: string) {
    const ok = await confirmDelete(confirm, label);
    if (!ok) return;
    setError(null);
    try {
      await deleteProductType(id);
      setSuccess("Tipo eliminado.");
      await queryClient.invalidateQueries({ queryKey: ["product-types"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo eliminar el tipo.");
    }
  }
  // ... render: form (create) / tabla unificada (view), ver Step 3
}
```

- [ ] **Step 3: Render del manager**

Create mode — grid de campos:

```tsx
{mode === "create" ? (
<form onSubmit={handleAdd} style={{ display: "grid", gap: 12 }}>
  <div className="materialRow">
    <label className="fieldGroup">
      <span>Tipo</span>
      <select className="field" disabled={isSaving} onChange={(e) => { setCategoryCode(e.target.value); setModelCode(""); }} value={categoryCode}>
        <option value="">Seleccionar tipo</option>
        {categories.map((c) => <option key={c.id} value={c.code}>#{c.code} {c.label}</option>)}
        <option value={NEW}>+ Crear nuevo tipo...</option>
      </select>
    </label>
    {categoryCode === NEW ? (
      <label className="fieldGroup">
        <span>Nombre del nuevo tipo</span>
        <input className="field" disabled={isSaving} maxLength={120} onChange={(e) => setNewCategoryLabel(e.target.value)} placeholder="Ej. TOBILLERAS" value={newCategoryLabel} />
      </label>
    ) : null}
  </div>
  <div className="materialRow">
    <label className="fieldGroup">
      <span>Categoría</span>
      <select className="field" disabled={isSaving || !categoryCode || categoryCode === NEW && !newCategoryLabel.trim()} onChange={(e) => setModelCode(e.target.value)} value={modelCode}>
        <option value="">{categoryCode ? "Seleccionar categoría" : "Elige primero el tipo"}</option>
        {categoryCode !== NEW ? models.map((m) => <option key={m.id} value={m.code}>#{m.code} {m.label}</option>) : null}
        <option value={NEW}>+ Crear nueva categoría...</option>
      </select>
    </label>
    {modelCode === NEW ? (
      <label className="fieldGroup">
        <span>Nombre de la nueva categoría</span>
        <input className="field" disabled={isSaving} maxLength={120} onChange={(e) => setNewModelLabel(e.target.value)} placeholder="Ej. FILIGRANA" value={newModelLabel} />
      </label>
    ) : null}
  </div>
  <div className="materialRow">
    <label className="fieldGroup">
      <span>Materia prima</span>
      <select className="field" disabled={isSaving} onChange={(e) => setMaterialItemId(e.target.value)} value={materialItemId}>
        <option value="">Seleccionar materia prima</option>
        {rawMaterials.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
    </label>
    <label className="fieldGroup">
      <span>Ley / pureza</span>
      <input className="field" disabled readOnly value={selectedMaterial?.purity ?? "—"} />
    </label>
  </div>
  <p className="panelText">Código resultante: <span className="orderCodeTag">#{codePreview}</span></p>
  <div className="modalActions">
    <button className="button buttonPrimary" disabled={isSaving} type="submit">
      <Plus aria-hidden="true" size={14} /> Crear tipo
    </button>
  </div>
</form>
) : null}
```

View mode — tabla unificada:

```tsx
{mode === "view" ? (
<div className="tableWrap" style={{ marginTop: 14, maxHeight: 320, overflowY: "auto" }}>
  <table className="table">
    <thead>
      <tr>
        <th>#</th>
        <th>Tipo</th>
        <th>Categoría</th>
        <th>Materia prima</th>
        <th>Origen</th>
        <th aria-label="Acciones" />
      </tr>
    </thead>
    <tbody>
      {types.map((t) => (
        <tr key={t.id}>
          <td><span className="orderCodeTag">#{t.product_code}</span></td>
          <td>#{t.category_code} {t.category_label}</td>
          <td>#{t.model_code} {t.model_label}</td>
          <td>{t.raw_material_name}{t.purity ? ` (${t.purity})` : ""}</td>
          <td>Definido</td>
          <td style={{ textAlign: "right" }}>
            <button aria-label={`Eliminar ${t.product_code}`} className="iconOnlyButton dangerIconButton" onClick={() => void handleDelete(t.id, `${t.category_label} / ${t.model_label}`)} type="button">
              <Trash2 aria-hidden="true" size={14} />
            </button>
          </td>
        </tr>
      ))}
      {inventoryPairs.map((p) => (
        <tr key={p.code}>
          <td><span className="orderCodeTag">#{p.code}</span></td>
          <td>#{p.categoryCode} {p.categoryLabel}</td>
          <td>#{p.modelCode} {p.modelLabel}</td>
          <td>—</td>
          <td>En inventario ({p.pieces} piezas)</td>
          <td />
        </tr>
      ))}
      {!isLoading && types.length === 0 && inventoryPairs.length === 0 ? (
        <tr><td colSpan={6}><div className="emptyState">Sin tipos de producto. Crea el primero.</div></td></tr>
      ) : null}
    </tbody>
  </table>
</div>
) : null}
```

- [ ] **Step 4: Sección en production-dashboard.tsx**

Import: `import { ProductTypesManager } from "@/components/mantenimiento/product-types-manager";`

Tipo dataModal (línea ~217): `{ type: "units" | "materials" | "productTypes"; mode: "create" | "view" }`.

Sección después de la de materias primas (donde estaba la eliminada):

```tsx
<section className="maintenanceSection" aria-label="Productos terminados">
  <h2>Productos terminados</h2>
  <div className="maintenanceGrid">
    <button className="maintenanceTile" onClick={() => setDataModal({ type: "productTypes", mode: "create" })} type="button">
      <Plus aria-hidden="true" size={22} />
      <strong>Crear tipo de producto</strong>
      <span>Tipo, categoría y materia prima.</span>
    </button>
    <button className="maintenanceTile" onClick={() => setDataModal({ type: "productTypes", mode: "view" })} type="button">
      <FileText aria-hidden="true" size={22} />
      <strong>Tipos de producto</strong>
      <span>Definidos y los ya presentes en inventario.</span>
    </button>
  </div>
</section>
```

Render del modal junto a los otros (línea ~2055):

```tsx
{dataModal?.type === "productTypes" ? <ProductTypesManager mode={dataModal.mode} onClose={() => setDataModal(null)} /> : null}
```

(Verificar que `FileText` siga importado de lucide-react; si se eliminó, re-agregarlo.)

- [ ] **Step 5: Typecheck + verificación**

```bash
docker compose exec -T web npx tsc --noEmit
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/mantenimientos
```

Expected: exit 0; http 200. Verificación visual: Mantenimientos → sección Productos terminados → crear tipo (selects funcionan, código en vivo) → listar muestra pares "En inventario" (ANILLOS/FILIGRANA...).

- [ ] **Step 6: Commit**

```bash
git add frontend/lib/product-types-api.ts frontend/components/mantenimiento/product-types-manager.tsx frontend/components/production/production-dashboard.tsx
git commit -m "feat(mantenimientos): crear tipos de producto terminado (tipo+categoria+materia prima)"
```
