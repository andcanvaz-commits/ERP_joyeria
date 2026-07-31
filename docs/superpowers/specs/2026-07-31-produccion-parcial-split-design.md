# Producción parcial con orden hija vinculada al mismo folio

Fecha: 2026-07-31

## Contexto

Hoy, al aprobar materiales de una orden de producción (`ProductionService.approve_materials`,
`backend/modules/production/service.py:562`), el consumo de materia prima, insumos y
complementos es todo-o-nada: si falta stock de cualquiera de los tres, `InventoryDomainError`
revierte la aprobación completa (`backend/modules/inventory/service.py:589,768,830`).

No existe una entidad "certificado" separada. El folio (`ProductionRun.production_code`,
generado en `create_run`) ya funciona como documento único que registra entrega (aprobación de
materiales) y recepción (`receive_finished_product`) de principio a fin. Este diseño reutiliza
ese folio como el "certificado": cuando falta materia prima, la orden se parte en corridas
internas, pero todas comparten el mismo folio raíz para efectos de reporte.

**Alcance**: el split parcial aplica únicamente a falta de **materia prima** (oro/plata). Si falta
stock de un insumo o complemento configurado en el proceso, se mantiene el comportamiento actual
(revierte todo, sin partición).

## Modelo de datos

`backend/modules/production/models.py`:

- `ProductionRunStatus.WAITING_MATERIAL = "ESPERANDO_MATERIAL"`: nuevo estado, previo a
  `PENDIENTE_INVENTARIO` en el ciclo de vida de una corrida hija. No entra en la cola normal de
  aprobación de inventario.
- `ProductionRun.root_production_code: str`: folio del certificado, compartido por todas las
  corridas que nacieron de la misma orden original. Es el único campo con restricción de unicidad
  a nivel de "documento" (reemplaza la unicidad actual de `production_code`).
- `ProductionRun.production_code` deja de ser único global; sigue existiendo como identificador
  interno de cada corrida individual, con sufijo cuando hay partición (`OP-2026-0001`,
  `OP-2026-0001-B`, `OP-2026-0001-C`, ...). `_generate_production_code` y `_stage_code_for` se
  ajustan para derivar el sufijo sin romper el parseo de secuencia (`run_seq`) que ya usan.
- `ProductionRun.parent_run_id: UUID | None` (FK a `production_runs.id`): corrida de la que se
  partió. Permite reconstruir el árbol de particiones.

Migración Alembic: agrega `root_production_code`, `parent_run_id`; para filas existentes,
`root_production_code = production_code` (backfill). Quita la restricción unique de
`production_code`, agrega unique en `root_production_code` solo para corridas raíz (sin
`parent_run_id`) — o más simple: unique en `production_code` se mantiene (sigue siendo único por
sufijo), y se agrega índice (no unique) en `root_production_code` para las consultas de
agregación.

## Flujo backend

### 1. Partición al aprobar materiales (`approve_materials`)

Cuando `inventory_service.consume_material_for_production` de la **materia prima** (no
insumo/complemento) lanza `InventoryDomainError` por stock insuficiente:

1. Leer `current_stock` del ítem de materia prima.
2. `covered_qty = floor(current_stock / raw_material_quantity_per_unit)`.
3. Si `covered_qty <= 0`: comportamiento actual sin cambios (error, nada que aprobar).
4. Si `0 < covered_qty < run.quantity`:
   - Guardar `original_quantity = run.quantity`.
   - `run.quantity = covered_qty`; recalcular `total_required_material` y
     `expected_finished_weight` con la nueva cantidad.
   - Repartir proporcionalmente (mismo ratio `covered_qty / original_quantity`, redondeando hacia
     abajo y dejando el remanente a la hija) las líneas de `run.products` y
     `run.complements.quantity` entre la corrida actual y la hija que se crea a continuación.
   - Continuar la aprobación normal (consumo de insumos/complementos completos, igual que hoy) con
     la cantidad ya reducida.
   - Crear la corrida hija:
     - `quantity = original_quantity - covered_qty`
     - `status = ESPERANDO_MATERIAL`
     - `root_production_code` = el mismo de la corrida original
     - `production_code` = folio raíz + sufijo siguiente disponible
     - `parent_run_id` = id de la corrida que se partió
     - Copia de etapas activas del proceso (igual que `create_run`), sin iniciar ninguna.
     - `products`/`complements` con la porción remanente calculada arriba.
   - Si `covered_qty == run.quantity` (alcanza justo): no hay partición, aprobación normal.

### 2. "Destinar al proceso faltante" (nuevo endpoint)

`POST /api/production-orders/{run_id}/allocate-material` — payload: `{ quantity_units }`, en
unidades de producto (piezas), no en peso — así inventario piensa en "cuántas piezas cubro" y no
tiene que convertir gramos a mano. El backend valida que
`quantity_units * raw_material_quantity_per_unit <= stock_disponible` antes de aplicar nada.

Precondición: `run.status == ESPERANDO_MATERIAL`.

1. `covered_qty = min(quantity_units, run.quantity)`.
2. Si `covered_qty >= run.quantity`: se cubre toda la hija.
   - Ejecuta la misma lógica de `approve_materials` (consumo de materia prima e insumos/
     complementos de esta corrida) y encadena `start_run` automáticamente — sin esperar acción del
     jefe de producción.
3. Si `0 < covered_qty < run.quantity`: aplica el mismo mecanismo de partición del punto 1 sobre
   esta corrida — la porción cubierta se aprueba y arranca, se crea una nueva corrida
   `ESPERANDO_MATERIAL` (nieta) con el remanente, mismo `root_production_code`.
4. Si `covered_qty <= 0`: error de validación (nada que destinar).

### 3. Aviso al registrar ingreso (`InventoryService.create_movement`)

Al confirmar una `ENTRADA` de un ítem `RAW_MATERIAL`, después de aplicar el movimiento, buscar
corridas con `status == ESPERANDO_MATERIAL` y `raw_material_item_id` igual al ítem ingresado. Si
hay alguna, la respuesta del endpoint incluye esa lista (folio, corrida id, cantidad faltante,
peso faltante) para que el frontend muestre el aviso. No se auto-destina nada: inventario decide
cuánto asignar a cuál desde el modal.

## Frontend (`frontend/components/inventory/inventory-dashboard.tsx`)

- Modal "Registrar ingreso" de materia prima: tras guardar exitosamente, si la respuesta trae
  corridas esperando ese material, abre un segundo modal "Destinar material" listando cada corrida
  (folio, cantidad faltante) con un campo de cantidad a destinar por fila (puede dejarse en 0 para
  no destinar a esa corrida). Confirma con una llamada por corrida al endpoint de asignación.
- Tablero de producción: las corridas `ESPERANDO_MATERIAL` se listan aparte de las
  `PENDIENTE_INVENTARIO` (no compiten por el mismo botón "Aprobar"/"Rechazar" de inventario, ya que
  no se pueden rechazar — ver Casos borde). Al destinarse y arrancar, la corrida aparece en la
  lista de "en proceso" igual que cualquier otra, con una referencia visual a su folio raíz para
  quien quiera ver el certificado completo (ej. "OP-2026-0001 · parte 2").

## Certificado / reportes

Cualquier vista de detalle de orden/certificado agrupa por `root_production_code`: cantidad total
pedida = suma de `quantity` de todas las corridas del folio (incluye la o las que sigan en
`ESPERANDO_MATERIAL`), total entregado = suma de materia prima consumida por las corridas ya
aprobadas, total recibido = suma de lo recibido en las corridas que ya llegaron a `RECIBIDA`.
Reportes existentes que agrupan por `production_code` pasan a agrupar por `root_production_code`.

## Casos borde

- Falta de insumo o complemento (no materia prima): sin cambios, revierte todo con el error
  actual.
- Cancelar una corrida en proceso: el sistema ya no permite cancelar órdenes en proceso (sin
  cambios); esta regla no se toca.
- Corrida hija en `ESPERANDO_MATERIAL`: **no se puede cancelar/rechazar** una vez creada por
  partición — queda esperando indefinidamente hasta que se le destine material (decisión
  explícita: simplifica el flujo, evita casos de folios con historial incompleto).
- Partición recursiva: si un ingreso no alcanza para cubrir toda una corrida `ESPERANDO_MATERIAL`,
  se repite el mecanismo de partición (nieta, bisnieta, ...) hasta agotar la cantidad original.
