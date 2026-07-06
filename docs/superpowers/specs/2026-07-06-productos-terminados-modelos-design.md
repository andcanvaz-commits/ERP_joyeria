# Productos terminados como modelos

Fecha: 2026-07-06
Estado: aprobado
Reemplaza: la sección 2 de `2026-07-06-producto-terminado-derivado-design.md` (form derivado de procesos).

## Problema

- Los 178 registros actuales de `FINISHED_PRODUCT` son piezas físicas individuales (SKU `PT-NNNN`, peso propio) y el campo `name` se repite como categoría (ARETES ×32, MEDALLAS ×38, ...). Mal normalizado.
- El form del spec anterior derivaba el tipo de producto de los procesos de producción, pero `production_processes` está vacía: el form quedaba inutilizable.
- `material_type` legacy ("PLATA") no coincide con los nombres de las materias primas reales (PLATA MIL, PLATA LIGADA, PLATA VARIOS).

## Decisión

Un producto terminado representa un **modelo** (ej. "Cadena BB 45cm") con una cantidad disponible en la unidad de medida con que se ingresó.

### 1. Modelo de datos (sin tablas nuevas, sin cambios de esquema)

`inventory_items` con `item_type = FINISHED_PRODUCT`:

| Campo | Uso |
|---|---|
| `name` | nombre del modelo |
| `material_type` | nombre de la materia prima (PLATA MIL, PLATA LIGADA, ...) |
| `purity` | ley heredada de la materia prima seleccionada |
| `unit_code` | del catálogo `units_of_measure` (g, und, ...) |
| `current_stock` | cantidad disponible del modelo en esa unidad |
| `total_weight`, `elaboration_date` | dejan de usarse en el form (eran datos de pieza); columnas se conservan |

### 2. Migración de datos (Alembic)

Consolidar los registros existentes de `FINISHED_PRODUCT`:

- Agrupar por `(name, purity, unit_code)` → ~13 modelos.
- Sobrevive una fila por grupo (SKU menor); `current_stock` y `total_weight` = suma del grupo.
- `inventory_movements.item_id` de las filas absorbidas se re-apunta a la fila sobreviviente; luego se borran las filas absorbidas.
- Normalizar `material_type` según ley: `99.99 → PLATA MIL`, `99.25 → PLATA LIGADA`; otras leyes conservan su valor actual.
- Migración reversible no requerida (downgrade no restaura piezas); documentar en el docstring de la migración.

### 3. Form (`finished-products-manager.tsx`)

| Campo | Comportamiento |
|---|---|
| Nombre del modelo | texto libre, obligatorio |
| Metal (materia prima) | select de items `RAW_MATERIAL`, obligatorio al crear |
| Ley / pureza | solo lectura, `purity` de la materia prima seleccionada |
| Unidad de medida | select de `units_of_measure` activas, obligatorio |
| Descripción | texto libre opcional |

- Se elimina la dependencia de procesos introducida en el diff de trabajo actual (se revierte).
- Se eliminan del form: peso total y fecha de elaboración.
- Editar: mismos campos; metal preseleccionado si `material_type` coincide con una materia prima; si el usuario no re-elige, se conservan los valores actuales.
- El stock NO se edita aquí: inicia en 0 y cambia solo por movimientos de inventario (kardex).

### 4. Listado

Columnas: nombre, metal, ley, unidad, stock actual.

## Fuera de alcance

- Campo "cantidad inicial" en el form (las existencias entran por movimientos).
- Asignación automática de `product_code`.
- Constructor de procesos (sigue igual; ya no bloquea este form).
