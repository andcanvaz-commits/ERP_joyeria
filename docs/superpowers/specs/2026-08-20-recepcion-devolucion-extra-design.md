# Recepción: unificar botón "Agregar" y permitir devolución fuera de lo entregado

## Contexto

El spec [2026-08-19-rediseno-acta-y-ux-produccion-design.md](2026-08-19-rediseno-acta-y-ux-produccion-design.md)
decidió deliberadamente que el botón "Agregar" del lado RECEPCION, durante una
etapa activa, solo mostrara ítems que ya tuvieran una línea ENTREGA en ese
mismo `stage_attempt_id`, con tope `entregado − recibido`. En la práctica se
implementó como un widget separado, `StageRecepcionControl`
([frontend/components/production/stage-recepcion-control.tsx](../../../frontend/components/production/stage-recepcion-control.tsx)):
una tabla de "candidatos" (solo lo entregado y no recibido) que abre un modal
propio, visualmente distinto del botón "Agregar" del lado ENTREGA
(`AdminAddActaLineControl`, buscador completo de inventario + "Escribir a
mano").

Rodrigo pide dos cosas:

1. El botón "Agregar" del lado derecho (RECIBIDO) debe verse y comportarse
   como el de la izquierda (ENTREGADO).
2. Producción a veces devuelve algo que **no** estaba en lo entregado de esa
   etapa (ej. un complemento que ya tenían de sobra). Eso debe poder
   registrarse igual — eligiendo un ítem real de inventario, indicando
   cuánto devuelven — y sumarse al stock, sin necesidad de que haya
   aparecido antes como ENTREGA de esa etapa.

Esto revierte la restricción del spec del 19 (no lo elimina — el spec queda
como registro histórico de por qué existía).

## Diseño

### Frontend

- Se elimina `StageRecepcionControl` (único caller: `production-dashboard.tsx`,
  dos sitios — vista en vivo de la etapa corriendo y vista de "ver etapa"
  histórica).
- En su lugar, ambos sitios usan `AdminAddActaLineControl` con
  `side="RECEPCION"` y el mismo `stageAttemptId` que ya usan para ENTREGA —
  el mismo componente, mismo estilo, mismo picker (`MaterialCategoryPicker`)
  y misma opción "Escribir a mano". No hay componente nuevo.
- `items`/`materialItems` que ya se pasan a `StageRecepcionControl` se pasan
  igual a `AdminAddActaLineControl` (prop `items`).

### Backend (`backend/modules/production/service.py`, `add_admin_acta_line`)

Regla actual (líneas ~874-906) cuando `side == RECEPCION` y
`stage_attempt_id` no es nulo:

1. Si `item.item_type == RAW_MATERIAL` → error (sin cambios: la materia
   prima nunca se recibe por acá, entregada o no).
2. Si `entregado <= 0` → error "Solo se puede recibir un material que ya se
   entregó en esta etapa." **← se elimina este bloqueo.**
3. Si `quantity > entregado - recibido` → error de tope. **← se mantiene,
   pero solo aplica cuando `entregado > 0`.**

Regla nueva:

- `RAW_MATERIAL` sigue bloqueado siempre (entregado o no).
- Si `entregado > 0` (el ítem sí se entregó en esta etapa): se mantiene el
  tope `entregado − recibido` tal cual hoy.
- Si `entregado == 0` (el ítem nunca se entregó en esta etapa, cualquier
  otro tipo): se permite sin tope — es una devolución "extra", fuera de lo
  entregado. Usa el mismo mecanismo de siempre
  (`_apply_admin_acta_line_delta` → movimiento `DEVOLUCION_PRODUCCION`, que
  ya suma al stock). No hace falta columna, flag ni migración nueva: la
  diferencia de comportamiento sale solo de si `entregado` es `> 0` o `== 0`.

### Testing

- `test_add_admin_acta_line_recepcion_rejects_item_never_entregado` (backend/tests/production/test_admin_acta_line.py:570)
  cambia de "espera error" a "espera éxito + stock sumado" (mismo patrón que
  `test_add_admin_acta_line_recepcion_caps_at_entregado_minus_recibido`).
- `test_add_admin_acta_line_recepcion_rejects_raw_material` y
  `test_add_admin_acta_line_recepcion_caps_at_entregado_minus_recibido` no
  cambian.
- Nuevo test: devolución extra (item nunca entregado en la etapa, no raw
  material) no tiene tope — probar con una cantidad mayor a cualquier cosa
  entregada en la etapa y confirmar que se suma al stock sin error.

### Fuera de alcance

- No se toca el lado ENTREGA ni `AdminAddActaLineControl` en sí — ya sirve
  para ambos lados sin cambios de código, solo de uso.
- No se toca `ActaView`/Documentos (usan `AdminAddActaLineControl` a nivel
  de orden completa, sin `stageAttemptId`, ya sin tope — sin cambios).

## Verificación

- `docker-compose exec api pytest backend/tests/production/test_admin_acta_line.py`
- `docker-compose exec web npm run build`
- Smoke manual: iniciar etapa, devolver algo ya entregado (debe topear),
  devolver algo nunca entregado (debe sumar sin tope), intentar devolver
  materia prima (debe seguir bloqueado).
