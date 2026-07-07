# Tipos de producto terminado (Mantenimientos)

Fecha: 2026-07-06
Estado: aprobado

## Problema

No hay forma de definir un tipo de producto terminado (tipo → categoría, ej. ANILLOS → VARIOS) sin crear piezas de inventario. Se necesita la definición pura en BD para que lógica posterior (producción, selección) la use. NO se crean productos específicos aquí — solo el par tipo + categoría.

## Decisión

### 1. Backend: módulo `backend/modules/product_types/`

Tabla `product_types` (migración Alembic nueva, sin tocar datos existentes):

| Campo | Tipo | Detalle |
|---|---|---|
| `id` | uuid PK | |
| `category_code` | String(10) NOT NULL | tipo del catálogo, ej. `02` (ANILLOS) |
| `model_code` | String(10) NOT NULL | categoría del catálogo, ej. `0002` (VARIOS) |
| `product_code` | String(20) NOT NULL UNIQUE | material+tipo+categoría, ej. `2020002` |
| `raw_material_item_id` | uuid FK → inventory_items NOT NULL | materia prima que fija el metal |
| `is_active` | bool default true | |
| `created_at` | timestamptz | |

Reglas del servicio:

- Dígito de material desde el catálogo: segmento `MATERIAL` cuyo `label` esté contenido en `material_type` de la materia prima elegida (PLATA MIL → PLATA → `2`). Sin match: error 422 claro.
- `product_code` = material(1) + category_code(2) + model_code(4); único.
- La materia prima debe existir y ser `RAW_MATERIAL`.

API (`/api/product-types`), JWT + permisos como el resto de mantenimientos:

- `GET /api/product-types` → lista (incluye labels de tipo/categoría y nombre de materia prima).
- `POST /api/product-types` → crea; body: `category_code`, `model_code`, `raw_material_item_id`.
- `DELETE /api/product-types/{id}` → elimina.

Segmentos de catálogo nuevos (tipo/categoría) se crean con la API de catálogo existente (`POST /api/catalog/segments`); este módulo no la duplica.

### 2. Frontend: sección en Mantenimientos (`production-dashboard.tsx` + componente nuevo)

Componente `frontend/components/mantenimiento/product-types-manager.tsx` (modal, patrón de managers existentes) y sección "Productos terminados" con dos tiles:

- **Crear tipo de producto** (modo create):
  - Tipo: select de segmentos `CATEGORY` del catálogo + opción "Crear nuevo tipo..." (input nombre; código automático vía `POST /api/catalog/segments`).
  - Categoría: select de segmentos `MODEL` del tipo elegido + opción "Crear nueva categoría..." (igual, código automático).
  - Materia prima: select de items `RAW_MATERIAL` existentes; ley visible solo lectura.
  - Vista previa del código resultante en vivo (ej. `#2020002`).
  - Sin campo de nombre de producto: aquí no se crean productos específicos.
- **Tipos de producto (N)** (modo view): lista unificada de pares tipo→categoría:
  - Los definidos en `product_types`.
  - Más los que ya existen en inventario (derivados del `product_code` de las piezas `FINISHED_PRODUCT`), marcados "En inventario", ej. `#02 ANILLOS → #2020003 FILIGRANA`.
  - Columnas: código, tipo, categoría, materia prima/metal (si se conoce), origen (Definido / En inventario), eliminar (solo los definidos aquí).

Cliente API nuevo: `frontend/lib/product-types-api.ts` (`listProductTypes`, `createProductType`, `deleteProductType`).

### 3. Fuera de alcance

- No crea items de inventario ni movimientos.
- Lógica que consuma estos tipos: diseño futuro.
- Edición (solo crear/eliminar).
