# Cantidades directas en producción (sin "unidad por gramo")

## Contexto

Producción hoy calcula la materia prima requerida como
`quantity_per_unit × cantidad_a_fabricar` (piezas). La joyería no trabaja así:
al crear una orden dicen directamente cuántos gramos (u otra unidad, según la
materia prima) de tal cosa van a hacer, sin cálculo de piezas. Este spec quita
toda la lógica de "cantidad por unidad" de mantenimientos, materia prima,
complementos e insumos, y hace que todo se ingrese como cantidad directa en la
unidad de medida del recurso.

Confirmado con el usuario:
- La orden ya NO trackea número de piezas, solo cantidad total en unidad de
  medida.
- El plan de productos (a qué tipo/pieza del catálogo se convierte el lote)
  sigue siendo automático: una sola línea, cantidad = la misma de la orden. No
  se pide un número aparte.
- El split automático por falta de materia prima se mantiene, pero pasa de
  "cuántas piezas cubro" a "qué fracción del pedido cubro", aplicada por igual
  a materia prima y a cada complemento/insumo pendiente.
- Insumos por etapa siguen la misma lógica nueva que complementos: se
  configuran (qué insumo, en qué etapa) en mantenimiento sin cantidad, y la
  cantidad se pide obligatoria al crear la orden.
- Las recetas de ensamble dejan de aplicarse solas: siempre se piden/confirman
  a mano las cantidades de cada complemento, aunque exista una receta previa
  (esta solo prellena como sugerencia).

## Fuera de alcance

- `ProductionProcessStageIngredient` ya era cantidad fija por orden (no por
  unidad fabricada) — el problema de "unidad por gramo" no lo tocaba
  directamente, pero por pedido explícito del usuario también pasa a pedirse
  en creación de orden (ver sección 5).
- Recepción de producto terminado (lote = peso real, merma a la sección
  Mermas) ya funciona así hoy; no se toca.
- `inventory_item.weight_per_unit` (peso real de piezas de producto terminado
  en inventario) es un concepto distinto, no relacionado; no se toca.

## 1. Creación de orden — materia prima

- `ProductionRunCreate.quantity`: quita `decimal_places=0` y la validación
  "debe ser un número entero" (frontend). Pasa a `Decimal` libre — es
  directamente la cantidad total de materia prima en la unidad del item
  elegido.
- `create_run`: `total_required_material = payload.quantity` directo (hoy es
  `quantity_per_unit × payload.quantity`). `expected_finished_weight` sigue
  igual a `total_required_material`.
- Se elimina la resolución de `quantity_per_unit`/`unit_code` desde
  `ProductionProcessMaterial` — la unidad siempre se lee del
  `InventoryItem.unit_code` de la materia prima elegida.
- El plan de productos (`RunProductCreate`) no cambia de forma: sigue
  mandándose 1 línea con `quantity = payload.quantity`. Solo cambia que ya no
  es "piezas enteras" (`decimal_places=0` también se quita ahí).

## 2. Mantenimiento de procesos — materiales

`ProductionProcessMaterial` pierde las columnas `quantity_per_unit` y
`unit_code`. Queda solo `inventory_item_id`: una lista de materias primas que
el proceso puede usar (whitelist), sin configuración de cantidad. La unidad
que se muestra en cualquier lado sale siempre del item de inventario.

Formulario de mantenimiento: la fila de cada materia prima pierde el input
"cantidad por unidad".

## 3. Complementos y ensamble

- `RunComplementCreate.quantity` ya es total hoy (el backend no lo multiplica
  por nada) — sin cambio en el schema/persistencia.
- Frontend, modo ENSAMBLAR: deja de auto-calcular
  `receta.quantity_per_unit × cantidad_a_fabricar` para armar el payload de
  complementos en silencio. Pasa a mostrar un formulario editable: un input de
  cantidad total por complemento. Si existe una receta previa para ese
  modelo+material, sus valores prellenan los inputs como sugerencia, pero el
  usuario siempre confirma/edita antes de crear la orden.
- `finish_stage` (última etapa): se elimina el bloque de auto-ensamble
  ("si la receta aprendida alcanza con lo aprobado, se aplica sola"). En
  ENSAMBLAR, `assembly_pending` queda siempre `True` al terminar y se define a
  mano en `define_run_assembly`, con el mismo patrón de prellenado-editable.
- `AssemblyRecipeItem.quantity_per_unit` → renombrar a `quantity` (deja de ser
  ratio por pieza, pasa a ser "última cantidad total usada"). Dejar de
  multiplicar por `run.quantity` en todos los usos
  (`define_run_assembly`, `_upsert_recipe_items`, lectura de receta).
- Migración de datos: vaciar `assembly_recipes` / `assembly_recipe_items`
  existentes. Sus valores eran gramos-por-pieza; reinterpretarlos como totales
  daría sugerencias sin sentido (ej. "0.5" como si fuera el total). Vuelven a
  aprenderse solas desde el próximo ensamble manual.

## 4. Split parcial por falta de material

Se mantiene el split automático en `approve_materials`, pero el cálculo pasa
de "cuántas piezas cubro" a "qué fracción del pedido cubro hoy":

```
fracción = min(
  1,
  disponible_materia_prima / necesaria,
  disponible_complemento_i / necesario_i   (para cada complemento pendiente),
  disponible_insumo_i / necesario_i        (para cada insumo pendiente),
)
```

Esa única fracción se aplica a materia prima, a cada complemento y a cada
insumo para repartir entre la orden cubierta y la corrida hija en
`ESPERANDO_MATERIAL` — mismo mecanismo de reparto proporcional que ya existe
hoy para complementos (`ratio_missing` en `_split_run_for_partial_material`),
extendido a materia prima (hoy usa floor-division por piezas,
`raw_available // quantity_per_unit`) e insumos (hoy no participaban del
split: eran cantidad fija). Montos continuos, sin redondeo a enteros.

`_compute_coverage`/`_MaterialCoverage`: se reescribe para trabajar en
cantidades directas (no piezas): `covered_qty`/`target_qty` pasan a ser
gramos (u unidad) de materia prima, no piezas. `limiting_required_per_unit`
se reemplaza por el monto total necesario del recurso limitante.

`allocate_material`/`preview_allocation`: el parámetro `quantity_units`
("unidades a destinar") pasa a ser la cantidad de materia prima que se
intenta cubrir ahora mismo (por defecto, todo lo que falta).

## 5. Insumos por etapa

- `ProductionProcessStageIngredient` pierde `quantity` y `unit_code`. Queda
  `inventory_item_id` por etapa: mantenimiento solo elige qué insumos usa cada
  etapa, sin monto.
- Nueva tabla `ProductionRunStageIngredient` (run_stage_id, inventory_item_id,
  quantity, unit_code): la cantidad real que el usuario ingresó al crear ESA
  orden, copiada a `ProductionRunStage` al crear la corrida — mismo patrón que
  ya usa el dominio para copiar etapas del proceso a la corrida (editar el
  proceso después no altera el historial).
- `ProductionRunCreate` gana `stage_ingredients: list[{process_stage_ingredient_id, quantity}]`.
  Debe cubrir 1:1 todos los insumos configurados en las etapas activas del
  proceso elegido (todos obligatorios, `> 0`); si falta alguno o sobra uno que
  no está configurado, error de dominio.
- Formulario de creación de orden: sección nueva (mismo patrón visual que
  complementos) listando cada insumo configurado en las etapas activas, con
  input obligatorio de cantidad total.
- `approve_materials`: el consumo de insumos deja de leer
  `process.stages[].ingredients` (configuración viva) y pasa a leer
  `run.stages[].ingredients` (lo copiado/ingresado en la orden). De paso
  corrige una inconsistencia existente: hoy este único punto del código lee el
  proceso en vivo en lugar de la copia de la corrida, al revés de como
  funciona el resto del dominio.
- Split parcial: los insumos entran al cálculo de fracción de cobertura como
  un recurso más (ver sección 4).

## 6. Migraciones de esquema (Alembic)

- `production_process_materials`: drop `quantity_per_unit`, drop `unit_code`.
- `production_runs`: drop `raw_material_quantity_per_unit`.
- `production_process_stage_ingredients`: drop `quantity`, drop `unit_code`.
- Nueva tabla `production_run_stage_ingredients` (run_stage_id FK cascade,
  inventory_item_id, quantity Numeric(14,4), unit_code).
- `assembly_recipe_items`: rename `quantity_per_unit` → `quantity`.
- Data migration: `DELETE FROM assembly_recipe_items; DELETE FROM assembly_recipes;`
  (recetas aprendidas se reinician, ver sección 3).
- `production_runs.quantity` / `.total_required_material`: no requieren
  cambio de columna (ya son `Numeric(14,4)`); el límite a enteros era solo en
  el schema Pydantic.

Nota: `total_required_material` de órdenes YA EXISTENTES no se pierde ni se
recalcula — ya tiene el monto absoluto correcto guardado, independiente de que
se borre la columna de ratio.

## 7. Tests a reescribir

`backend/tests/production/test_material_split.py`,
`test_material_reservation.py`, `test_process_materials_validation.py`,
`test_process_product_types.py`, `test_receive_merma.py`, y los fixtures de
`conftest.py` — todos asumen `quantity_per_unit` y/o piezas enteras. Se
reescriben para el modelo de cantidades directas, más casos nuevos para:
fracción de cobertura con insumos en juego, y el flujo de insumos obligatorios
al crear orden.

## 8. Frontend a tocar

`frontend/components/production/production-dashboard.tsx` (mantenimiento de
procesos: materiales y etapas/insumos; modal de creación de orden: materia
prima ya no valida entero, sección nueva de insumos, sección de complementos
pasa de auto-calculada a formulario editable; modal de definir ensamble;
mantenimiento de recetas de ensamble), `frontend/lib/production-api.ts`,
`frontend/types/production/index.ts`.
