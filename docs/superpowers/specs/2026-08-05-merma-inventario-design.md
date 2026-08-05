# Merma como inventario: recuperar el material de desperdicio en un item WASTE

Fecha: 2026-08-05

## Contexto

`ProductionRun`/`ProductionRunStage` ya calculan `waste_weight`/`waste_percent`
(`peso_esperado - peso_real`, formula de CLAUDE.md §7.9), y ese total ya se
muestra a Inventario como "Merma total" (`RunWasteHero`) justo en la card de
"Recibir" del flujo de recepción. Pero es puramente informativo: no genera
ningún movimiento de inventario ni ningún stock. `MERMA` existe como
`InventoryMovementType` válido desde el arranque del proyecto pero nunca se
crea en ningún lado del código — es la pieza que falta.

El Excel histórico (`Joyeria/Ordenes de Producción.xlsx`, ya importado como
certificados, ver spec `2026-08-04-certificados-historicos-design.md`)
confirma el patrón real de la joyería en papel. Orden 26 "Planchar /
Diamantar" (plata):

```
Entregado: 419.5g "BB 80"
Recibido:  402.2g "BB 80"              <- producto terminado
           17.2g  "Desp. Polvo Diamantar"  <- merma recuperable, nombrada por el proceso
           419.4g (subtotal 402.2+17.2)
           0.1g   "M"                  <- merma real, no recuperada, se pierde
```

El patrón se repite en decenas de órdenes con nombres como "Desp. cadena",
"Desp. medallas", "Desp. fundicion", "Granalla", "Limadura" — siempre del
lado **Recibido**, siempre nombrado según el proceso/tipo que lo generó.

Esta spec cubre **solo la porción recuperable**: todo `waste_weight`
calculado se trata como material que vuelve a inventario (no se modela la
distinción "Desp." vs "M" residual del papel — sería una funcionalidad
nueva no pedida, fuera de alcance).

## Decisiones confirmadas (con el usuario)

1. **La cantidad no se recalcula.** Se usa `run.waste_weight` tal cual ya
   existe (suma de `stage.waste_weight` por etapa). Cero lógica de cálculo
   nueva.

2. **Confirma Inventario, en el mismo momento de "Recibir".** No hay paso
   nuevo para Producción. Cuando Inventario recibe una orden con
   `waste_weight > 0`, un modal de confirmación (mismo patrón que el de
   aprobación parcial de materiales ya existente) muestra la cantidad y el
   item WASTE destino sugerido, editable antes de confirmar. Si
   `waste_weight <= 0`, "Recibir" funciona exactamente igual que hoy — sin
   modal, sin movimiento de merma.

3. **Auto-asignación por proceso, sin catálogo nuevo en Mantenimiento.** El
   destino sugerido es un item `item_type = "WASTE"` llamado
   `"Merma <process_name>"` (ej. "Merma Cadenas", "Merma Planchar/Diamantar").
   Se busca por nombre exacto; si no existe, se crea ahí mismo. El proceso ya
   es un dato configurable (regla del proyecto: no quemar procesos en
   código), así que esto no necesita ninguna pantalla nueva de
   administración — la categorización nace gratis de un dato que ya existe.

4. **Reclasificable en dos momentos:**
   - **Al recibir**: el selector del modal permite cambiar el item WASTE
     sugerido por otro existente, o escribir uno nuevo, antes de confirmar.
   - **Después de recibido**: acción dedicada "Reclasificar merma" sobre
     cualquier movimiento de merma ya posteado, que mueve la cantidad (o una
     porción) de un item WASTE a otro.

5. **Lado Recibido, no Entrega** — confirmado contra el patrón real del
   Excel (la merma vuelve junto con el producto terminado, no al momento de
   entregar materia prima).

6. **Se reusan tipos de movimiento existentes, no se inventan salvo lo
   estrictamente necesario:**
   - Merma entra a inventario con `INGRESO_PRODUCCION` (ya existe, ya es
     positivo, ya significa "producción entrega algo que entra a
     inventario" — mismo bucket que usa la conversión de lote a producto
     terminado). Item destino: el WASTE resuelto en la decisión 3.
   - `MERMA` (declarado, negativo, nunca usado) **queda intacto, sin
     tocar** — se reserva para un futuro flujo de "dar de baja material
     dañado/perdido", semánticamente distinto (ahí sí se pierde stock, no
     se recupera). Esta spec no lo usa ni lo redefine.
   - Reclasificación: dos tipos nuevos, seteando el mismo patrón que ya usa
     `CONVERSION_SALIDA`/`CONVERSION_ENTRADA` — `RECLASIFICACION_SALIDA`
     (negativo, sale del item viejo) y `RECLASIFICACION_ENTRADA` (positivo,
     entra al item nuevo), misma `reference_id` compartida para que el
     kardex los lea como un par, no como dos ajustes sueltos.

## Modelo de datos

Sin tabla nueva, sin migración de esquema. `item_type` en `InventoryItem` ya
es `String(40)` libre — se agrega `"WASTE"` como valor válido:

- Backend: `ITEM_TYPE_PREFIXES` en `inventory/service.py` gana
  `"WASTE": "ME"` (prefijo de SKU auto-generado).
- Frontend: `InventoryItemType` (`frontend/types/inventory/index.ts`) gana
  `"WASTE"`.
- `inventory/schemas.py` (lista de movement types válidos) gana
  `RECLASIFICACION_SALIDA` y `RECLASIFICACION_ENTRADA`.
- `NEGATIVE_MOVEMENTS`/`POSITIVE_MOVEMENTS` (`inventory/service.py`) se
  actualizan: `RECLASIFICACION_SALIDA` a `NEGATIVE_MOVEMENTS`,
  `RECLASIFICACION_ENTRADA` a `POSITIVE_MOVEMENTS`.

Item WASTE auto-creado: `unit_code` = `raw_material_unit_code` del run (el
desperdicio es el mismo metal que se entregó), `current_stock` arranca en 0
(el movimiento `INGRESO_PRODUCCION` lo sube), `sku` autogenerado con el
prefijo `ME`.

## Flujo de recepción

`POST /api/production/runs/{id}/receive-finished` gana un body opcional:

```
{ "waste_item_id": "<uuid> | null" }
```

- `waste_item_id` ausente/null y `run.waste_weight > 0`: el backend resuelve
  (busca o crea) el item `"Merma <process_name>"` él mismo.
- `waste_item_id` presente: usa ese item tal cual (debe ser `item_type ==
  "WASTE"`, si no existe o no es WASTE, error de dominio).
- `run.waste_weight` es `None` o `<= 0`: se ignora el campo, comportamiento
  idéntico al actual.

Todo dentro de la misma transacción que ya crea el lote y convierte a
producto terminado: si algo falla, no queda merma huérfana ni producto sin
su merma. El movimiento generado:

```
InventoryMovement(
  movement_type="INGRESO_PRODUCCION",
  item_id=<waste item>,
  quantity=run.waste_weight,
  unit_code=run.raw_material_unit_code,
  reason=f"Merma recibida de {run.production_code}",
  reference_type="production_run",
  reference_id=run.id,
)
```

### Frontend

`frontend/components/inventory/inventory-dashboard.tsx`, card de
"Recepción de producto terminado" (línea ~4842 en adelante):

- `handleReceiveClick(run)`: si `Number(run.waste_weight ?? 0) <= 0`, llama
  directo a `handleReceiveFinishedProduct(run)` como hoy. Si no, abre un
  modal (`receiveMermaConfirm` state, mismo molde que
  `approveSplitConfirm`) con:
  - Cantidad de merma + unidad.
  - Nombre del item WASTE sugerido (`Merma ${run.process_name}`), resuelto
    contra la lista de items ya cargada en el dashboard si existe, o
    marcado como "se creará" si no.
  - Selector/buscador para elegir otro item WASTE existente, o escribir un
    nombre nuevo.
  - Confirmar → `handleReceiveFinishedProduct(run, wasteItemId)`, que pasa
    el `waste_item_id` elegido (o `null` para el default automático) a
    `receiveProductionRunFinishedProduct`.
- `receiveProductionRunFinishedProduct` (`lib/production-api.ts`) gana un
  segundo parámetro opcional `wasteItemId?: string`.

## Reclasificación posterior

Nuevo endpoint `POST /api/inventory/movements/{movement_id}/reclassify-waste`:

- Solo válido sobre movimientos `movement_type == "INGRESO_PRODUCCION"` con
  `reference_type == "production_run"` cuyo item destino es `item_type ==
  "WASTE"` (filtra cualquier otro `INGRESO_PRODUCCION` que no sea de
  merma).
- Body: `{ "target_item_id": "<uuid>", "quantity": "<decimal, opcional, default = cantidad original>" }`.
- Valida stock suficiente en el item origen (no se puede reclasificar más
  de lo que quedó ahí — si ya se consumió, error de dominio explicando
  cuánto queda).
- Crea el par `RECLASIFICACION_SALIDA` (item origen) + `RECLASIFICACION_ENTRADA`
  (item destino), ambos con `reference_type="production_run"` y
  `reference_id=<run.id del movimiento original>` (mismo esquema que ya usa
  el `INGRESO_PRODUCCION` que se está reclasificando), reason
  `"Reclasificado desde <item origen>"` / `"Reclasificado hacia <item destino>"`.

### Frontend

Botón "Reclasificar" en el detalle de un movimiento del kardex cuando
`movement_type === "INGRESO_PRODUCCION"` y el item es `item_type ===
"WASTE"` (mismo lugar donde hoy vive "Revertir" para la última entrada).
Abre un modal simple: item destino (buscador) + cantidad (default: toda la
cantidad del movimiento).

## UI: pestaña "Merma" en Inventario

`ITEM_TYPES` (`inventory-dashboard.tsx`, línea ~54) gana una entrada:

```ts
{ value: "WASTE", label: "Merma" }
```

Eso basta — la pestaña, la lista, el kardex por item y la búsqueda ya
funcionan genéricamente para cualquier `item_type`, no hay layout nuevo que
construir.

## Fuera de alcance

- No se modela la distinción "merma recuperable" vs "merma real perdida"
  (el "M" residual del Excel) — todo `waste_weight` se trata como
  recuperable. Si en el futuro se necesita esa distinción, es una spec
  aparte.
- No se toca el certificado de Documentos (`buildOrdenProduccion`) — esto
  aplica a recepciones en vivo nuevas, no a las órdenes históricas
  migradas (que ya tienen sus propias `event_lines` congeladas del papel).
- No se toca `MERMA` (el movement_type ya existente) — queda reservado sin
  usar para un futuro flujo de baja de material.
- No hay catálogo de categorías de merma en Mantenimiento — la
  categorización es 1:1 con el proceso, sin paso de administración extra.

## Plan de verificación manual

1. Recibir una orden con `waste_weight = 0`: comportamiento idéntico al
   actual, sin modal.
2. Recibir una orden con `waste_weight > 0` sin cambiar el destino
   sugerido: confirma que se crea (o reusa) el item "Merma <proceso>" y su
   stock sube exactamente `waste_weight`.
3. Recibir una segunda orden del mismo proceso: confirma que reusa el
   mismo item WASTE (no crea uno duplicado) y el stock se suma.
4. Recibir eligiendo un item WASTE distinto al sugerido: confirma que el
   movimiento va al item elegido, no al default.
5. Reclasificar una merma ya recibida a otro item: confirma el par de
   movimientos, que el stock del item origen baja y el del destino sube
   exactamente lo reclasificado, y que ambos comparten `reference_id`.
6. Intentar reclasificar más cantidad de la que queda en el item origen:
   confirma que rechaza con el mensaje de stock insuficiente.
7. Pestaña "Merma" en Inventario: aparecen los items WASTE creados, con su
   kardex navegable igual que cualquier otro item.
