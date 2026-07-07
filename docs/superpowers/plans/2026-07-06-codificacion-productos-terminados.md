# Codificación de Productos Terminados — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recodificar las 178 piezas de productos terminados al formato material+categoría+modelo (`2010002-0001`) completando el catálogo con las categorías y modelos VARIOS faltantes.

**Architecture:** Una migración de datos Alembic (SQL puro): inserta categorías 30/31, inserta modelo VARIOS por categoría (PL/pgSQL, calcula siguiente código y es idempotente), recodifica `product_code` y `sku` de piezas `PT-%` con `ROW_NUMBER` por grupo. Backup pg_dump manual antes de aplicar.

**Tech Stack:** Alembic + PostgreSQL 16 (`gen_random_uuid()` nativo).

**Spec:** `docs/superpowers/specs/2026-07-06-codificacion-productos-terminados-design.md`

## Global Constraints

- Sin cambios de esquema; solo datos.
- Solo se recodifican piezas `item_type='FINISHED_PRODUCT' AND sku LIKE 'PT-%'`.
- Movimientos de kardex intactos (referencian `item_id`).
- `pg_dump` manual antes de aplicar la migración.
- Estado Alembic actual: head `c9d0e1f2a3b4` (verificado).

---

### Task 1: Migración de codificación

**Files:**
- Create: `backend/alembic/versions/e1f2a3b4c5d6_catalog_codes_finished_products.py`

**Interfaces:**
- Consumes: tablas `catalog_segments` (kind/code/label/parent_code/is_active/created_at, id uuid NOT NULL sin default en SQL → usar `gen_random_uuid()`), `inventory_items`.
- Produces: piezas con `product_code` = `2` + categoría(2) + modelo(4) y `sku` = `product_code-NNNN`.

- [ ] **Step 1: Backup manual previo**

```bash
docker compose exec -T db pg_dump -U erp_joyeria -d erp_joyeria -F c -f /tmp/pre_codificacion.dump && docker compose cp db:/tmp/pre_codificacion.dump ./backups/pre_codificacion.dump && ls -la backups/
```

Expected: archivo `backups/pre_codificacion.dump` presente (>40 KB).

- [ ] **Step 2: Escribir la migración**

Crear `backend/alembic/versions/e1f2a3b4c5d6_catalog_codes_finished_products.py`:

```python
"""Codifica productos terminados con la logica de catalogo.

material(1) + categoria(2) + modelo(4): product_code = p.ej. 2010002 y
sku = 2010002-0001. Crea categorias 30 DIJES / 31 JUEGOS y un modelo
'VARIOS' por categoria usada. Solo toca piezas con sku 'PT-%'.
Downgrade no restaura los SKU PT (camino de vuelta: backup pg_dump).

Revision ID: e1f2a3b4c5d6
Revises: c9d0e1f2a3b4
Create Date: 2026-07-06
"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e1f2a3b4c5d6"
down_revision: Union[str, None] = "c9d0e1f2a3b4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# name de las piezas -> codigo de categoria del catalogo
GROUP_TO_CATEGORY = {
    "ANILLOS DE FILIGRANA - VARIOS": "02",
    "ARETES": "01",
    "CADENAS": "06",
    "COLLARES": "29",
    "DENARIOS": "11",
    "DIJES": "30",
    "JUEGOS": "31",
    "MEDALLAS": "14",
    "MONEDAS": "28",
    "PULSERAS VARIAS": "20",
    "ROSARIOS": "21",
}
NEW_CATEGORIES = [("30", "DIJES"), ("31", "JUEGOS")]


def upgrade() -> None:
    # 1. Categorias faltantes.
    for code, label in NEW_CATEGORIES:
        op.execute(
            f"""
            INSERT INTO catalog_segments (id, kind, code, label, parent_code, is_active, created_at)
            SELECT gen_random_uuid(), 'CATEGORY', '{code}', '{label}', NULL, true, now()
            WHERE NOT EXISTS (
                SELECT 1 FROM catalog_segments WHERE kind = 'CATEGORY' AND code = '{code}' AND parent_code IS NULL
            )
            """
        )

    # 2. Modelo VARIOS por categoria usada (siguiente codigo libre; idempotente).
    categories = sorted(set(GROUP_TO_CATEGORY.values()))
    cats_sql = ", ".join(f"'{c}'" for c in categories)
    op.execute(
        f"""
        DO $$
        DECLARE cat text;
        BEGIN
            FOREACH cat IN ARRAY ARRAY[{cats_sql}] LOOP
                IF NOT EXISTS (
                    SELECT 1 FROM catalog_segments
                    WHERE kind = 'MODEL' AND parent_code = cat AND label = 'VARIOS'
                ) THEN
                    INSERT INTO catalog_segments (id, kind, code, label, parent_code, is_active, created_at)
                    SELECT gen_random_uuid(),
                           'MODEL',
                           LPAD((COALESCE(MAX(code::int), 0) + 1)::text, 4, '0'),
                           'VARIOS',
                           cat,
                           true,
                           now()
                    FROM catalog_segments
                    WHERE kind = 'MODEL' AND parent_code = cat AND code ~ '^[0-9]+$';
                END IF;
            END LOOP;
        END $$;
        """
    )

    # 3. Recodificar piezas PT-%: product_code y sku con secuencia por grupo.
    mapping_sql = ", ".join(f"('{name}', '{cat}')" for name, cat in GROUP_TO_CATEGORY.items())
    op.execute(
        f"""
        WITH mapping(group_name, cat) AS (VALUES {mapping_sql}),
        varios AS (
            SELECT parent_code AS cat, code AS model_code
            FROM catalog_segments
            WHERE kind = 'MODEL' AND label = 'VARIOS'
        ),
        numbered AS (
            SELECT i.id,
                   '2' || m.cat || v.model_code AS pcode,
                   ROW_NUMBER() OVER (PARTITION BY i.name ORDER BY i.sku) AS seq
            FROM inventory_items i
            JOIN mapping m ON m.group_name = i.name
            JOIN varios v ON v.cat = m.cat
            WHERE i.item_type = 'FINISHED_PRODUCT' AND i.sku LIKE 'PT-%'
        )
        UPDATE inventory_items i
        SET product_code = n.pcode,
            sku = n.pcode || '-' || LPAD(n.seq::text, 4, '0')
        FROM numbered n
        WHERE i.id = n.id
        """
    )


def downgrade() -> None:
    # Irreversible sin el backup: los SKU PT originales ya no existen.
    pass
```

- [ ] **Step 3: Aplicar**

```bash
docker compose exec -T api alembic upgrade head
```

Expected: `Running upgrade c9d0e1f2a3b4 -> e1f2a3b4c5d6` sin errores.

- [ ] **Step 4: Verificar**

```bash
docker compose exec -T db psql -U erp_joyeria -d erp_joyeria -c "SELECT name, product_code, MIN(sku) AS primer_sku, MAX(sku) AS ultimo_sku, COUNT(*) FROM inventory_items WHERE item_type='FINISHED_PRODUCT' GROUP BY name, product_code ORDER BY name;" -c "SELECT COUNT(*) AS piezas, COUNT(DISTINCT sku) AS skus_unicos, SUM(current_stock) AS stock, COUNT(*) FILTER (WHERE product_code !~ '^[0-9]{7}$') AS mal_codigo, COUNT(*) FILTER (WHERE sku !~ '^[0-9]{7}-[0-9]{4}$') AS mal_sku FROM inventory_items WHERE item_type='FINISHED_PRODUCT';" -c "SELECT code, label FROM catalog_segments WHERE (kind='CATEGORY' AND code IN ('30','31')) OR (kind='MODEL' AND label='VARIOS') ORDER BY kind, code;"
```

Expected:
- 11 grupos, cada uno con `product_code` de 7 dígitos iniciando en `2`.
- piezas=178, skus_unicos=178, stock=16427.5000, mal_codigo=0, mal_sku=0.
- Categorías 30/31 presentes y 11 modelos VARIOS.

- [ ] **Step 5: Commit**

```bash
git add backend/alembic/versions/e1f2a3b4c5d6_catalog_codes_finished_products.py
git commit -m "feat(inventario): codifica productos terminados con logica de catalogo (2+cat+modelo-seq)"
```
