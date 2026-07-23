# Diseño v3: Crear orden con producto único y receta en creación

Fecha: 2026-07-23
Estado: Aprobado por Rodrigo
Base: rama `feat/orden-unificada-complementos` (v1 + v2 implementadas).

## Objetivo

Refinar la modal Crear orden: un solo producto final por orden (en ambos
modos), layout reordenado (cantidad al final, complementos antes del
producto), y en Ensamblar la receta se define/aplica en el momento de crear la
orden — si el producto elegido no tiene receta, se abre el modal de ensamble
ahí mismo, se guarda la receta y se vuelve con todo establecido.

## 1. Layout de la modal Crear orden (ambos modos)

Orden de campos:
1. Proceso
2. Material
3. Modo: **Asignar | Ensamblar**
4. **Solicitar complementos** (antes del producto)
5. **Elegir producto** — UNO solo, picker visual (pieza del inventario o tipo
   del catálogo)
6. **Cantidad a fabricar** — último campo

La cantidad de piezas del producto es la cantidad a fabricar (no hay input de
cantidad por producto). El split multi-producto de v1/v2 desaparece de la UI;
el backend conserva el plan multi-fila por compatibilidad (la UI siempre manda
una fila con `quantity = cantidad`).

"Editar productos" (plan de una orden existente) pasa a cambiar el producto
único (mismo picker, sin cantidades).

## 2. Ensamblar: receta en creación

- Al elegir el producto final, el frontend consulta si tiene receta:
  `GET /api/production/assembly-recipes?product_type_id=X` o `?item_id=Y`
  (con pieza, el backend resuelve el tipo con la lógica existente de
  `product_code` → category/model). Respuesta: receta con items
  `{complement_item_id, name, quantity_per_unit}` o vacío.
- **Sin receta** → se abre el modal de ensamble (adaptación del "Definir
  ensamble" de v2): lista los complementos ya solicitados en el borrador de la
  orden + botón para elegir más del inventario (ComplementPicker, que además
  los agrega a la solicitud); cantidades POR UNIDAD; guardar →
  `PUT /api/production/assembly-recipes/{product_type_id}` (upsert de items)
  → vuelve a Crear orden con el producto establecido y su receta.
  Si el producto elegido es una pieza cuyo tipo no se puede resolver, se
  informa que no se puede guardar receta (mensaje) y el ensamble se definirá
  al finalizar producción (respaldo v2).
- **Con receta** (existente o recién guardada) → la solicitud de complementos
  se autollena con receta × cantidad, editable. Mientras el usuario no edite
  manualmente las filas autollenadas, cambiar la cantidad recalcula solo.
- `create_run` ya exige ≥1 complemento en Ensamblar (v2 fix); con el
  autollenado esto se cumple naturalmente.

## 3. Backend nuevo

- `GET /api/production/assembly-recipes` con query `product_type_id` O
  `item_id` (exactamente uno): devuelve `{product_type_id, items:[{
  complement_item_id, name, quantity_per_unit}]}` o `{product_type_id, items: []}`
  (con `product_type_id` null si la pieza no resuelve tipo). Permiso: lectura
  de producción.
- `PUT /api/production/assembly-recipes/{product_type_id}`: upsert de la
  receta (items por unidad, min 1). Permiso: producción (mismo bloqueo de rol
  que definir ensamble).
- Reutiliza `AssemblyRecipe`/`AssemblyRecipeItem` (v2). El endpoint
  `POST /runs/{id}/assembly` y el auto-ensamble de `_finish_run` quedan como
  respaldo sin cambios.

## 4. Lo que no cambia

- Flujo Asignar (salvo producto único), aprobación de materiales/complementos,
  recepción, actas, tipos de complemento, XML, procesos terminados.

## 5. Precauciones

- Sin migraciones nuevas (tablas v2 ya existen).
- Stack docker apagado: verificación estática; QA pendiente acumulado.
