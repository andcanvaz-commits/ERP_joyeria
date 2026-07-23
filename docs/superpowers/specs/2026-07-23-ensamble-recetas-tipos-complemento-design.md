# Diseño v2: Asignar/Ensamblar, recetas de ensamble y tipos de complemento

Fecha: 2026-07-23
Estado: Aprobado por Rodrigo
Base: rama `feat/orden-unificada-complementos` (diseño v1 ya implementado:
`2026-07-23-orden-unificada-complementos-design.md`).

## Objetivo

La orden de producción elige entre **asignar** (v1, split de resultantes) o
**ensamblar** (producto final + complementos según receta). Las recetas se
aprenden del primer ensamble manual y luego aplican solas. Los complementos se
organizan por **tipo de complemento** (catálogo propio con manager). Los
selectores de producto dejan de ser combos: usan las vistas drill-down
existentes.

## 1. Modal "Crear orden" v2 (producción)

- Proceso, material y cantidad: iguales a v1.
- Selector de modo por orden completa: **Asignar** | **Ensamblar**.
- **Asignar**: filas de resultantes como v1, pero el producto se elige con el
  picker visual de productos finales (drill tipo → piezas, como la vista de
  inventario; mismo patrón "Elegir del catálogo" de la conversión: pieza
  existente o tipo del catálogo para productos nuevos). Suma = cantidad.
- **Ensamblar**: pide UN producto final primero (mismo picker). Sin split; la
  cantidad ensamblada es la cantidad de la orden.
- **Solicitar complementos**: abre una vista drill-down agrupada por tipo de
  complemento (como la pestaña de inventario); se eligen ítems y cantidades.
  Reemplaza los combos inline de v1.

## 2. Tipos de complemento

- Entidad nueva `complement_types` (id, nombre, estado) con manager en
  mantenimiento (patrón de los managers existentes).
- `inventory_items.complement_type_id` (FK nullable) para ítems COMPLEMENT.
- La pestaña Complementos de inventario agrupa por tipo con drill-down
  (tipo → ítems), como productos terminados.
- Creación en mantenimiento (manager v1); el stock entra por entrada de
  inventario, misma lógica que insumos.
- Import XML: las líneas de factura pueden clasificarse como COMPLEMENT en la
  revisión manual existente (v1 lo excluía; se agrega como tipo elegible con
  la misma verificación línea por línea).

## 3. Recetas de ensamble

- `assembly_recipes` (product_type_id único) + `assembly_recipe_items`
  (complement_item_id, quantity_per_unit): cantidades POR UNIDAD ensamblada.
- Se crea/actualiza automáticamente al guardar un ensamble manual; el próximo
  ensamble de ese tipo de producto aplica solo.

## 4. Flujo de ensamble

- `production_runs.assembly_mode` = ASIGNAR | ENSAMBLAR;
  `assembly_pending` bool.
- Al finalizar la última etapa de una orden ENSAMBLAR:
  - Con receta del producto y complementos solicitados APROBADOS que cubren
    receta × unidades → se aplica sola: se registra la combinación en
    `production_run_assembly_items` (run_id, complement_item_id, quantity
    total) y `assembly_pending = false`.
  - Sin receta (o complementos insuficientes) → `assembly_pending = true`:
    producción ve "Definir ensamble" y abre la ventana de ensamble aparte
    (adaptación de la de combinar de inventario): elige entre los complementos
    solicitados cuáles y cuántos POR UNIDAD; al guardar se registra la
    combinación y se guarda/actualiza la receta.
- Recepción bloqueada (409) mientras `assembly_pending = true`.
- **Recepción**: igual que v1 (lote → conversión al destino del plan, pieza o
  tipo); el acta lista el producto ensamblado y los complementos de la
  combinación aplicada.
- Stock de complementos: ya se descuenta al aprobar materiales (v1); el
  ensamble no genera movimientos nuevos de complementos, solo registra la
  combinación para receta/acta/trazabilidad.

## 5. Cambios al plan de resultantes (datos)

- `production_run_products.product_type_id` pasa a nullable; se agrega
  `target_item_id` (FK a inventory_items, nullable). Exactamente uno de los
  dos por fila (pieza existente o tipo del catálogo).
- La conversión en recepción usa `target_item_id` si existe (la lógica de
  conversión ya lo soporta), si no `product_type_id`.
- Validación create_run: ASIGNAR → filas ≥ 1 y suma = cantidad; ENSAMBLAR →
  exactamente 1 fila con cantidad = cantidad de la orden.

## 6. Endpoints nuevos

- CRUD `/api/inventory/complement-types` (admin/mantenimiento).
- `POST /api/production/runs/{run_id}/assembly` (producción): guarda la
  combinación manual {complement_item_id, quantity_per_unit}[] → registra
  combinación total, guarda receta, `assembly_pending = false`.
- Reads de producción exponen `assembly_mode`, `assembly_pending`,
  `assembly_items` (con nombres).

## 7. Lo que no cambia

- Asignación directa v1, aprobación/rechazo de materiales y complementos,
  procesos terminados solo lectura, permisos, kardex por movimientos.

## 8. Precauciones

- pg_dump antes de migrar (la migración v1 `e3f4a5b6c7d8` sigue sin aplicarse;
  la v2 se encadena encima).
- No inventar datos de prueba sin permiso.
- Stack docker: solo `exec`; sigue apagado — verificación estática hasta que
  Rodrigo lo arranque.
