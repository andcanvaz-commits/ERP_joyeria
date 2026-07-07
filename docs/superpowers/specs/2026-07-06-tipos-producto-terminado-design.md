# Tipos de producto terminado (Mantenimientos)

Fecha: 2026-07-06
Estado: aprobado

## Problema

No hay forma de definir un tipo de producto terminado (tipo → categoría → nombre, con su materia prima) sin crear una pieza de inventario. Se necesita la definición pura en BD para que lógica posterior (producción, selección) la use.

## Decisión

### 1. Backend: módulo `backend/modules/product_types/`

Tabla `product_types` (migración Alembic nueva, sin tocar datos existentes):

| Campo | Tipo | Detalle |
|---|---|---|
| `id` | uuid PK | |
| `name` | String(180) NOT NULL | nombre dentro de la categoría, ej. "GOTA" |
| `category_code` | String(10) NOT NULL | tipo del catálogo, ej. `02` (ANILLOS) |
| `model_code` | String(10) NOT NULL | categoría del catálogo, ej. `0003` (FILIGRANA) |
| `product_code` | String(20) NOT NULL | material+tipo+categoría, ej. `2020003` |
| `raw_material_item_id` | uuid FK → inventory_items NOT NULL | materia prima |
| `is_active` | bool default true | |
| `created_at` | timestamptz | |

Reglas del servicio:

- El dígito de material sale del catálogo: segmento `MATERIAL` cuyo `label` esté contenido en el `material_type` de la materia prima elegida (PLATA MIL → PLATA → `2`). Si no hay match: error 422 claro.
- `product_code` = material(1) + category_code(2) + model_code(4).
- Unicidad: (`product_code`, `name`) único — mismo nombre no se repite dentro de la misma categoría.
- La materia prima debe existir y ser `RAW_MATERIAL`.

API (`/api/product-types`), JWT + permisos como el resto de mantenimientos:

- `GET /api/product-types` → lista (incluye nombre de la materia prima).
- `POST /api/product-types` → crea; body: `name`, `category_code`, `model_code`, `raw_material_item_id`.
- `DELETE /api/product-types/{id}` → elimina.

La creación de segmentos de catálogo (tipo/categoría nuevos) usa la API de catálogo existente (`POST /api/catalog/segments`); este módulo no duplica esa lógica.

### 2. Frontend: sección en Mantenimientos (`production-dashboard.tsx` + componente nuevo)

Componente `frontend/components/mantenimiento/product-types-manager.tsx` (modal, patrón de los managers existentes) y sección "Productos terminados" con dos tiles:

- **Crear tipo de producto** (modo create):
  - Tipo: select de segmentos `CATEGORY` del catálogo + opción "Crear nuevo tipo..." (input nombre; código automático al guardar vía `POST /api/catalog/segments`).
  - Categoría: select de segmentos `MODEL` del tipo elegido + opción "Crear nueva categoría..." (igual, código automático).
  - Nombre: texto libre obligatorio.
  - Materia prima: select de items `RAW_MATERIAL` existentes; muestra ley de la seleccionada (solo lectura).
  - Vista previa del código resultante en vivo (ej. `#2020003`).
- **Tipos de producto (N)** (modo view): tabla — código, nombre, tipo, categoría, materia prima, acción eliminar (con confirmación).

Cliente API nuevo: `frontend/lib/product-types-api.ts` (`listProductTypes`, `createProductType`, `deleteProductType`).

### 3. Fuera de alcance

- No crea items de inventario ni movimientos.
- La lógica que consuma estos tipos (producción, selección) es diseño futuro.
- Edición de tipos (solo crear/eliminar en esta fase).
