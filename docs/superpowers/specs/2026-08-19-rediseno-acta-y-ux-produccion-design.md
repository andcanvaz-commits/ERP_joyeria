# Rediseño de acta, control de calidad, Documentos y mensajes — Design

## Contexto

Sesión de ajustes de UX/flujo sobre lo ya construido (automatización de
material por etapa, `docs/superpowers/specs/2026-08-19-automatizar-material-por-etapa-design.md`).
Cambios pedidos por Rodrigo, ya negociados en el hilo de brainstorming:

1. Limpieza de textos de ayuda en Crear orden y elegir proceso.
2. Elegir proceso pasa de combobox a ventana (reusa la que ya existe).
3. Mantenimiento de proceso gana **"Control de calidad"** (checkbox) — nada de
   "requiere pesaje", ese concepto se elimina.
4. Reporte de etapas pasadas se muda a ventana aparte (ícono de reporte); el
   acta se ensancha (sin scroll horizontal) y la columna Fecha se agranda.
5. Acta: "Agregar" único para Producción/Inventario y admin (ya casi está
   así en el código — falta el rótulo y la regla de RECEPCION). Se mantiene
   "Escribir a mano".
6. **RECEPCION** ("Agregar" del lado derecho) = la lógica de "Devolver
   sobrante" que ya existe (`ReturnCandidatesForm`/`AdminAddActaLineControl`
   con `side="RECEPCION"`), no código nuevo: solo ítems que ya aparecen en
   ENTREGA de esa etapa, tope = entregado − ya recibido.
7. **Producto resultante**: al iniciar una etapa, además de la materia prima
   (opcional, ya construida), se pide **obligatoriamente** producto
   resultante + gramos — mismo picker de catálogo que usaba "Asignar a
   producto terminado" (que se elimina como botón aparte). Escribe directo
   una línea RECEPCION de esa etapa.
8. **Finalizar etapa**: ya no pide peso (el picker de producto resultante ya
   lo cubre). Siempre hay un botón "Finalizar etapa". Si el proceso tiene
   control de calidad marcado, pide Aprobado/Denegado; si no, cierra directo.
   Denegado dejar una marca de agua permanente en esa acta, no revierte nada
   de inventario, y vuelve a la pantalla de elegir proceso.
9. Documentos: carpeta por orden — clic muestra las actas de cada etapa en
   secuencia; con una sola etapa, salta directo al acta.
10. Mensajes (Admin y Bandeja de Inventario): limpieza de textos y rediseño
    visual agrupado por fecha, sin scroll infinito.
11. Eliminar "Material adicional" por completo (ya redundante: con "Agregar"
    unificado en ENTREGA, nadie necesita "solicitar" nada, se agrega
    directo).

## B.1 — Proceso (banco) gana control de calidad

`ProductionProcess` gana `quality_control: bool` (default `False`). Migración
nueva. `ProductionProcessCreate`/`Update` y su formulario en
`production-dashboard.tsx` (`isFormOpen`) ganan el checkbox "Control de
calidad" (mismo patrón que el checkbox "Activo" ya existente).

## B.2 — Elegir proceso: picker en vez de combobox

`production-dashboard.tsx` ya tiene una ventana "Procesos" (`isProcessesOpen`,
lista + acciones) separada del combobox usado al iniciar etapa
(`<select value={selectedProcessId}>`). Se agrega un **modo picker** a esa
misma ventana: al iniciar etapa, un botón "Elegir proceso" la abre; cada fila
de proceso activo gana un `onClick` que fija `selectedProcessId` y cierra la
ventana; el botón "+ Crear proceso" (ya existe) sigue abriendo `isFormOpen`.
El combobox `<select>` se elimina de la pantalla de iniciar etapa.

## B.3 — Iniciar etapa: producto resultante obligatorio

**Backend.** `StageAttemptCreate` gana un campo obligatorio:

```python
class StageAttemptProductLine(BaseModel):
    model_config = ConfigDict(extra="forbid")
    product_type_id: UUID | None = None
    target_item_id: UUID | None = None
    quantity: Decimal = Field(gt=0)

    @model_validator(mode="after")
    def _check_one_target(self) -> "StageAttemptProductLine":
        if (self.product_type_id is None) == (self.target_item_id is None):
            raise ValueError("El producto resultante debe ser una pieza del inventario o un tipo del catalogo.")
        return self


class StageAttemptCreate(BaseModel):
    ...
    materials: list[StageAttemptMaterialLine] = Field(default_factory=list)
    product: StageAttemptProductLine
```

En `start_stage_attempt`, después de resolver materiales (bloque ya
existente, sin tocar), se procesa `payload.product` **siempre** — reusa la
lógica de `assign_product` (`InventoryService.create_finished_product_lot`,
`convert_lot_to_product`/`convert_lot_to_complement`) pero para **un solo
lote por orden**, alimentado incrementalmente por cada etapa en vez de una
sola vez:

- `InventoryService` gana `get_or_create_finished_product_lot(run, quantity,
  material_type, purity, received_by_user_id)`: busca un `INGRESO_PRODUCCION`
  existente con `reference_type="production_order"` y
  `reference_id=run.id`; si existe, reusa ese `InventoryItem` y le agrega
  **otro** movimiento `INGRESO_PRODUCCION` por `quantity` (no crea un item
  nuevo — así `reverse_finished_product_lot`, que ya asume un solo lote por
  orden, sigue funcionando sin tocarlo); si no existe, llama a
  `create_finished_product_lot` tal cual hoy.
- El material/pureza heredados salen del primer `ENTREGA` con `item_id` de
  **toda la orden** (mismo criterio que `assign_product` ya usaba, sin
  cambios — herencia dominante de todo el sistema).
- Se convierte `payload.product.quantity` del lote al destino elegido
  (`convert_lot_to_product`/`convert_lot_to_complement`, igual que
  `assign_product`).
- **Nuevo**: además de los movimientos de inventario, se agrega una
  `ProductionRunActaLine(side=RECEPCION, stage_attempt_id=attempt.id,
  item_id=target.id, quantity=payload.product.quantity,
  unit_code=target.unit_code, source=ActaLineSource.PLAN)` — hoy
  `convert_lot_to_product` no deja rastro en el acta, y el pedido explícito
  es que la declaración "se vaya directo a la parte derecha del acta".
- `run.status` **no cambia** (sigue `EN_PROCESO`) — a diferencia de
  `assign_product`, que cerraba la orden. Ya no hay un evento de "orden
  terminada": la orden queda abierta mientras se sigan agregando etapas: se
  cierra únicamente si se cancela.

`assign_product` (endpoint, servicio, frontend `handleAssignProduct`, botón
"Asignar a producto terminado") **se elimina** — su lógica vive ahora en
`start_stage_attempt`. `ProductionRunStatus.FINISHED`/`"TERMINADA"` deja de
usarse para órdenes nuevas (el valor del enum se conserva, por si hay que
leer históricas).

**Frontend.** El formulario de iniciar etapa (ya tiene proceso + responsable
+ materia prima opcional) gana un tercer bloque obligatorio "Producto
resultante": reusa el picker de catálogo que hoy alimenta
`handleAssignProduct`/`orderProduct`/`runQuantity`/`productRowToPayload`
(`itemPickerFor === "create"`), pero como parte del **mismo** formulario de
iniciar etapa, no como paso aparte después. `handleStartStageAttempt` no deja
enviar si `!orderProduct` o `!runQuantity`.

## B.4 — RECEPCION durante la etapa = "Devolver sobrante" reubicado

No es lógica nueva: es `AdminAddActaLineControl`/`add_admin_acta_line` que ya
se usa hoy en el lado RECEPCION de la etapa activa
(`production-dashboard.tsx:1841-1852`), con una regla nueva del lado
backend quitada del lado libre (picker de cualquier item) a un picker
acotado a lo entregado:

- `add_admin_acta_line`, cuando `side == RECEPCION` y `stage_attempt_id` no
  es nulo: el `item_id` debe corresponder a un item que ya tenga una línea
  `ENTREGA` en ese mismo `stage_attempt_id` (sea por `PLAN` -- materia
  prima declarada al iniciar -- o `AUTO` -- material asignado después por
  split), y `quantity` no puede superar `entregado_total - recibido_total`
  de ese item en ese intento (mismo cálculo que ya hace
  `_acta_line_max_quantity` para RECEPCION, generalizado a
  `stage_attempt_id` en vez de a la orden completa). Si no hay match, error:
  `"Solo se puede recibir un material que ya se entrego en esta etapa."`; si
  supera el tope, error con el sobrante disponible (mismo mensaje que
  `_acta_line_max_quantity` ya usa).
- La línea de "producto resultante" (B.3) usa el **mismo** endpoint
  internamente en el service (no pasa por esta validación porque no la llama
  el usuario a mano — la arma `start_stage_attempt` directo con `source=PLAN`
  fuera de este chequeo, que solo aplica al agregar manual).

**Frontend**: el picker de `AdminAddActaLineControl` en el lado RECEPCION,
cuando hay `stageAttemptId`, se restringe a los items que aparecen como
`ENTREGA` de ese intento (`activeActaLines` ya está filtrado por intento en
`production-dashboard.tsx`) en vez de la lista completa
`rawMaterials+supplies+complements+waste+finished`.

## B.5 — Unificar el botón "Agregar" (sin "(admin)")

`AdminAddActaLineControl`: el botón "Agregar línea (admin)" pasa a
**"Agregar"**. El componente ya renderiza igual para cualquier rol cuando
`stageAttemptId` está presente (`isAdmin` ya se pasa hardcodeado a `true`
desde `production-dashboard.tsx` para la etapa activa — no hay cambio de
permiso real, solo de rótulo). Se mantiene "Escribir a mano" tal cual.

## B.6 — Finalizar etapa: sin peso, con calidad condicional

`StageAttemptFinish` pierde `peso_al_finalizar` (ya no se pide). Queda:

```python
class StageAttemptFinish(BaseModel):
    model_config = ConfigDict(extra="forbid")
    decision: Literal["APROBADA", "RECHAZADA"] = "APROBADA"
    rejection_reason: str | None = Field(default=None, max_length=1000)
```

`finish_stage_attempt`:
- La merma ya no viene de `peso_al_finalizar`: se calcula
  `entrega_total - recepcion_total` de las líneas de ESE intento (mismo
  criterio "cada etapa es su propio certificado" ya documentado, solo que
  ahora la "salida" es la suma de RECEPCION en vez de un campo aparte).
  `entrega_total`/`recepcion_total` ya se pueden sacar de
  `run.acta_lines` filtrando por `stage_attempt_id` y `side` (mismo patrón
  que ya usa el método para `entrega_lines`).
- Si `process.quality_control` es `False`: `payload.decision` se ignora,
  siempre `APROBADA` (el frontend ni pregunta).
- Si `process.quality_control` es `True` y `decision == "RECHAZADA"`:
  `status = REJECTED`, guarda `rejection_reason`. No revierte ninguna línea
  ni movimiento (lo recibido en RECEPCION -- incluido el producto
  resultante -- ya se movió y queda igual, tal como se pidió: "usar ese
  producto mal hecho para iniciar otra etapa").
- `attempt.peso_al_finalizar`/`attempt.unit_code` dejan de fijarse (columna
  queda en el modelo para no romper histórico, simplemente no se escribe
  para intentos nuevos).

**Frontend**: se quita el input "Peso al finalizar". El botón "Finalizar
etapa" siempre está. Si `runningAttempt` viene de un proceso con
`quality_control` (hay que resolver el proceso por `process_id` desde la
lista `processes` ya cargada), se muestran los botones ✔ Aprobado / ✘
Denegado (con motivo opcional, tal cual el flujo de rechazo actual); si no,
un solo botón "Finalizar etapa" que llama `finishStageAttempt(attemptId, {
decision: "APROBADA" })`.

**Marca de agua**: cuando se muestra un intento con
`status === "RECHAZADA"` (tanto en el panel de etapas pasadas como en
Documentos), su acta se renderiza con una superposición visual "Rechazado
por control de calidad" (clase CSS nueva sobre `.actaDocFrame`, `opacity`
baja + texto diagonal, sin tocar los datos).

## B.7 — Reporte de etapas pasadas a ventana aparte

La tabla `pastAttempts` (Código/Proceso/Responsable/Estado/Merma), hoy
renderizada inline arriba del acta en el modal de la orden
(`production-dashboard.tsx`), se mueve a un modal propio
(`isStageReportOpen`), con un botón de ícono (`FileText`/reportes, ya
importado) junto al encabezado de la orden que lo abre.

## B.8 — Acta: ancho y columna Fecha

`opDocWrap`/`actaDocFrame`/`opThFecha` en `globals.css`: ensanchar el ancho
máximo del contenedor de acta (o quitar el límite que fuerza scroll
horizontal) y dar más `min-width`/`width` a `opThFecha`/`opTdFecha` para que
la fecha completa (`DD mes YYYY, HH:MM`) no se corte. Cambio puramente CSS,
sin tocar componentes.

## B.9 — Eliminar Material adicional

Redundante tras B.4/B.5: ENTREGA ya permite agregar directo (mueve stock de
inmediato), nadie necesita "pedir" material y esperar aprobación.

- Backend: borrar `request_additional_material`/`approve_additional_material`/
  `reject_additional_material` (service + router), modelo
  `ProductionRunAdditionalMaterialRequest`, migración que dropea la tabla,
  `additional_materials` de `ProductionRunRead`/`_attach_additional_materials`.
- Frontend: modal "Material adicional" y botón en `inventory-dashboard.tsx`
  (agregados la sesión pasada), `EntregaAction`/"Solicitar material" en
  `acta-view.tsx` (ya redundante, ver B.10), badge `pendingAdditionalMaterials`
  en `app-shell.tsx`, funciones en `production-api.ts`.
- Tests: `test_additional_material.py` se borra entero; el "Fix 2" de
  `test_admin_acta_line.py` (que prueba que aprobar material adicional no se
  fusiona con una línea ADMIN_STOCK) se borra también -- sin la solicitud, no
  hay nada que probar ahí.

## B.10 — Limpieza de acta-view.tsx (orden completa, flujo viejo)

`ActaView` (el modal "Ver acta" combinado de TODA la orden, distinto del
acta inline por intento de B.4/B.5 -- lo abren Producción, Inventario y el
propio panel de la orden) es un editor de nivel de ORDEN, no de etapa: sigue
teniendo sentido como herramienta de corrección puntual del admin, y **no
se elimina**. Lo que sí sale de adentro:

- `EntregaAction` ("Solicitar material", depende de
  `requestAdditionalMaterial`) -- se borra porque B.9 elimina esa función de
  raíz; ya no hay nada que llamar.
- `RecepcionActions`/`ReturnCandidatesForm`/`buildReturnCandidates` (usa
  `run.supply_consumptions`, pensado para "devolver sobrante" a nivel de
  ORDEN completa cuando el estado era `EN_PROCESO` del flujo viejo) -- ya no
  aplica, esa lógica ahora vive por intento de etapa (B.4).

Lo que **queda igual** dentro de `ActaView`: los dos
`AdminAddActaLineControl` sin `stageAttemptId` (ENTREGA y RECEPCION), que ya
están gateados por el `isAdmin` real (no hardcodeado) -- siguen siendo la
vía para que el administrador agregue una línea de corrección a nivel de
orden completa, sin atarla a ninguna etapa puntual. Ese botón también pierde
el texto "(admin)" por consistencia (B.5), aunque aquí sí siga siendo
admin-only de verdad.

Consumidor externo a borrar: `postFinishReturnRun`/`isPostFinishActa` en
`production-dashboard.tsx` (el ritual "post-finalizar: devolver sobrante"
que se disparaba al llegar a `PENDIENTE_RECEPCION`, estado que ya no existe
para órdenes nuevas, y llamaba a `ReturnCandidatesForm` directo).

## B.11 — Documentos: carpeta por orden

`documentos-dashboard.tsx` ya agrupa por orden (`groupRunFamilies`) en la
lista de la izquierda; hoy seleccionar una orden arma un único
`OrdenProduccionDoc` combinando TODAS las líneas de acta de la orden
(`buildOrdenProduccion`). Cambio:

- Si la orden (`selectedFamily`, resuelta a la corrida raíz sin split) tiene
  **más de un** `stage_attempts`, seleccionar la orden muestra primero una
  lista simple de sus intentos (Código, Proceso, Responsable, Estado) --
  mismas columnas que B.7 -- cada uno clickeable para ver SU acta
  (`buildOrdenProduccion` recibe un filtro nuevo `stageAttemptId` que acota
  `acta_lines` a ese intento antes de armar el modelo).
- Si la orden tiene **un solo** `stage_attempts` (o es histórica, sin
  `stage_attempts`), se salta la lista y muestra el acta directo, como hoy.
- Intentos con `status === "RECHAZADA"` llevan la misma marca de agua de B.6.

## B.12 — Mensajes: limpieza y rediseño

**Ambos lados** (`MessagesPanel` en `solicitudes-view.tsx`, reusado por Admin
y por el modal de Inventario):
- Quitar el subtítulo "Comunicacion libre -- cualquiera de los dos lados
  puede responder".
- Quitar el placeholder del textarea del compositor
  ("Ej: Necesito 20kg de este producto para el 30 de agosto").
- Agrupar los mensajes por fecha (encabezado de fecha tipo Documentos/acta,
  una vez por día, en vez de una tarjeta suelta por mensaje sin agrupar).
- El contenedor dejar de tener un `overflow-y` fijo con scroll infinito:
  altura acorde al resto de modales del sistema (`modalWindow`
  estándar/`processViewWindow`), paginado o con scroll solo dentro de la
  lista de mensajes (no de toda la ventana).
- Título:
  - Vista Admin (`role === "admin"`, dentro de `/solicitudes`): **"Mensajes
    con Producción"** (hoy "Mensajes con Produccion/Inventario").
  - Vista Inventario (`isMessagesOpen` en `inventory-dashboard.tsx`): título
    del modal pasa a **"Bandeja de entrada"** (hoy reusa el mismo
    `MessagesPanel` con su propio `<h2>` -- hay que exponer el título como
    prop en vez de calcularlo por `role` dentro del componente, para que las
    dos superficies puedan pedir el suyo).
- El lado Producción/Inventario ya solo puede responder, no iniciar
  (`role === "admin" ? <compositor> : null}` ya existe así) -- sin cambios
  de lógica, solo confirmar que el rediseño visual no rompe esa condición.

## Testing / verificación

- `docker-compose exec api pytest backend/tests/production` tras cada
  sub-paso de backend.
- `docker-compose exec api alembic upgrade head` tras cada migración.
- `docker-compose exec web npm run build` tras cada tanda de frontend.
- Smoke manual: iniciar etapa con producto resultante, agregar en RECEPCION
  (tope por lo entregado), finalizar con y sin control de calidad, Denegado
  muestra marca de agua, Documentos muestra carpeta con 2+ etapas, mensajes
  sin scroll infinito.
