# Acta v2: sin splits/reservas, Entrada/Producto multi-línea, control de calidad universal

## Contexto

El "flujo nuevo" (`ProductionRunStageAttempt`, sección 4 de
`docs/cambios-sistema-produccion.md`) ya reemplazó al flujo viejo basado en
plantilla para órdenes nuevas. Pero conserva, a nivel de intento de etapa, la
misma idea de split/reserva que tenía el flujo viejo a nivel de orden:
`start_stage_attempt` calcula un `_material_coverage_ratio` sobre las líneas
de material declaradas, y si no alcanza el 100% crea DOS intentos (uno
`EN_PROCESO` con lo cubierto, otro `PENDIENTE_MATERIAL` con el remanente) que
se despierta con `allocate_stage_attempt_material`. El producto resultante se
declara como un solo destino al iniciar (`target_item_id`/
`target_product_type_id`) y la cantidad real recién se escribe al finalizar
(`finish_stage_attempt`, que en ese momento convierte un lote intermedio con
`get_or_create_finished_product_lot`/`convert_lot_to_product`).

Rodrigo pide simplificar esto: el usuario ya tiene control total del acta
(puede agregar/editar cualquier línea en cualquier momento vía el botón
"Agregar" que ya existe), así que el split automático y la reserva de
materia prima no hacen falta — si algo queda mal repartido, el propio usuario
lo corrige a mano en el acta. Esto es una revisión de la spec
[2026-08-19-rediseno-acta-y-ux-produccion-design.md](2026-08-19-rediseno-acta-y-ux-produccion-design.md)
y de todo lo construido sobre ella hasta hoy.

**No se toca el flujo viejo** (`ProductionRunStage`/`ProductionRunStageIngredient`,
estados `PENDIENTE_INVENTARIO`/`ESPERANDO_MATERIAL`/`MATERIALES_APROBADOS` a
nivel de `ProductionRun`): esas columnas y esa lógica existen solo para que
Documentos/Reportes sigan mostrando bien órdenes históricas ya cerradas antes
de este cambio, tal como ya lo dice el código actual. Este spec es
exclusivamente sobre el flujo nuevo (`ProductionRunStageAttempt`).

## Decisiones (confirmadas con Rodrigo)

1. **Sin paso de aprobación de materiales.** Crear la orden ya la deja lista
   para iniciar etapas directo (esto ya es así hoy en el flujo nuevo — se
   mantiene, no cambia).
2. **Entrada** (antes "materia prima"): la validación es
   `0 < cantidad <= stock_actual` del item, por línea. Si el stock es 0, no
   se puede ni empezar a cargar esa línea. Si se pide más de lo que hay, se
   bloquea (tope = stock disponible) — nunca se crea un intento
   `PENDIENTE_MATERIAL` ni se parte automáticamente.
3. **Producto(s) resultante**: se declaran al iniciar la etapa, en una lista
   igual que Entrada (n líneas, cada una con su cantidad/peso), y se agregan
   como líneas reales de RECEPCION **de inmediato** (mueven stock en el acto,
   igual que cualquier "Agregar") — no como una promesa que se resuelve al
   finalizar. Sin tope de validación (regla general: derecha = suma = sin
   validar stock).
4. **Control de calidad universal.** Se quita el checkbox
   `quality_control` del proceso — todas las etapas, siempre, muestran ✓/✗ en
   vez de "Finalizar etapa".
   - **✓ Aprobar**: cierra el intento (`APROBADA`). Calcula la merma como
     `entrega_total − recepción_total` (ambos ya están en el acta — no hay
     `product_quantity` que pedir, no hay conversión de lote que hacer: los
     productos resultantes ya movieron stock al agregarse en el paso 3). No
     mueve más inventario que el que ya se movió incrementalmente.
   - **✗ Rechazar**: **no cierra el intento.** Dispara un motivo (opcional,
     igual criterio que hoy: "el motivo de rechazo no es obligatorio") y
     queda registrado en una bitácora nueva por intento (ver más abajo). El
     intento sigue `EN_PROCESO`, el acta sigue editable, y se puede volver a
     apretar ✓ (o ✗ de nuevo) después de corregir.
5. **Validación de stock, regla final única:**
   - Lado ENTREGA (izquierda = resta de inventario): `0 < cantidad <=
     stock_actual` del item en ese momento. Aplica en Entrada al iniciar
     etapa Y en cualquier "Agregar" ENTREGA posterior (mismo código,
     `add_admin_acta_line`).
   - Lado RECEPCION (derecha = suma a inventario): sin validación de stock.
     Cualquier cantidad positiva se acepta (ej. se entregaron 60g y se
     reciben 60.1g por variación de fábrica — no es un error).
   - Nada de validación de pesos/conversión entre entrega y recepción más
     allá de la merma calculada al aprobar.
6. **Splits y reservas: eliminados por completo** del flujo nuevo.
   - `_material_coverage_ratio`, la rama que crea un intento
     `PENDIENTE_MATERIAL` dentro de `start_stage_attempt`, y
     `allocate_stage_attempt_material` se borran.
   - `StageAttemptStatus.WAITING_MATERIAL` deja de usarse en código nuevo
     (la constante puede quedar definida si hace falta para leer datos
     viejos, pero ningún flujo nuevo la genera).
   - `ProductionRunStageAttemptMaterial.quantity_pending` deja de tener
     sentido variable: se sigue poblando (una fila por línea de Entrada,
     para que `StageAttemptRead.materials` no rompa nada que ya lo lea) pero
     siempre con `quantity_pending = 0` (todo lo declarado se consume de
     inmediato, nunca queda pendiente).
7. **Auditoría de agregados post-arranque (motivo obligatorio).** Reusa el
   campo `note` que YA existe en `AdminActaLineCreate` (hoy opcional). Pasa a
   ser **obligatorio** solo cuando: `side == ENTREGA` **y** la línea se
   agrega a un `stage_attempt_id` que ya está `EN_PROCESO` (es decir, un
   "Agregar" hecho después de que la etapa ya arrancó con sus Entradas
   iniciales — el caso "se me olvidó materia prima"). Las Entradas
   declaradas al iniciar la etapa (paso 2) no piden motivo. RECEPCION nunca
   pide motivo, en ningún momento.
8. **Bitácora por intento** (nueva): cada vez que se aprueba o rechaza un
   intento de etapa queda una fila con quién, cuándo, decisión y motivo. Es
   la base de la vista de auditoría del admin (sub-proyecto C, fuera de este
   spec) — aquí solo se crea el modelo y se escribe en approve/reject.

## Diseño técnico

### Backend

**Nuevo modelo** `ProductionRunStageAttemptDecision`
(`backend/modules/production/models.py`, migración nueva):

```python
class ProductionRunStageAttemptDecision(Base):
    __tablename__ = "production_run_stage_attempt_decisions"

    id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    stage_attempt_id: Mapped[PyUUID] = mapped_column(
        ForeignKey("production_run_stage_attempts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    decision: Mapped[str] = mapped_column(String(20), nullable=False)  # APROBADA | RECHAZADA
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    decided_by_user_id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    decided_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
```

**Schemas** (`backend/modules/production/schemas.py`):

- `StageAttemptProductTarget` → se reemplaza por `StageAttemptProductLine`:
  ```python
  class StageAttemptProductLine(BaseModel):
      model_config = ConfigDict(extra="forbid")
      product_type_id: UUID | None = None
      target_item_id: UUID | None = None
      material_code: str | None = None  # requerido si product_type_id y no existe item aun
      quantity: Decimal = Field(gt=0)
  ```
  (mismo validador "uno de los dos" que tenía `StageAttemptProductTarget`.)
- `StageAttemptCreate.product: StageAttemptProductTarget` → `products: list[StageAttemptProductLine] = Field(min_length=1)`.
- `StageAttemptFinish` se elimina. Nuevo `StageAttemptReject`:
  ```python
  class StageAttemptReject(BaseModel):
      model_config = ConfigDict(extra="forbid")
      reason: str | None = Field(default=None, max_length=1000)
  ```
  Aprobar no necesita payload (`POST .../approve` sin body).
- `AdminActaLineCreate.note` pasa de `str | None = None` a seguir siendo
  opcional en el schema (la obligatoriedad es una regla de negocio
  condicional, no de tipo — se valida en el service, ver abajo).

**`backend/modules/production/service.py`:**

- Extraer helper compartido `_resolve_or_create_finished_item(item_id, product_type_id, material_code) -> InventoryItem`
  usado por `add_admin_acta_line` (ya existe esa lógica ahí, se mueve a este
  helper) y por el nuevo alta de líneas de producto en `start_stage_attempt`.
- `start_stage_attempt`: reescribir sin ratio/split.
  - Fase 1 (validar todo, sin mutar): por cada `StageAttemptMaterialLine`,
    cargar el item y chequear `0 < quantity <= item.current_stock`; si
    falla, `ProductionDomainError` nombrando el item y el stock disponible.
    Por cada `StageAttemptProductLine`, resolver/validar el item (o
    product_type_id+material_code) sin tope de stock.
  - Fase 2 (aplicar): un solo `_new_attempt(IN_PROGRESS, ...)` (nunca
    `WAITING_MATERIAL`); por cada material, `consume_material_for_production`
    + línea ENTREGA `PLAN` (como hoy, sin ratio); por cada producto, mover
    stock (`DEVOLUCION_PRODUCCION`, mismo mecanismo que
    `_apply_admin_acta_line_delta`) + línea RECEPCION `PLAN`.
  - Elimina `_material_coverage_ratio` y toda la rama
    `ratio <= 0`/`0 < ratio < 1` (waiting_attempt).
- Elimina `allocate_stage_attempt_material` completo (y su router/endpoint).
- `finish_stage_attempt` se divide en dos métodos:
  - `approve_stage_attempt(attempt_id, current_user) -> ProductionRunRead`:
    valida `status == IN_PROGRESS`; calcula
    `entrega_total = sum(ENTREGA de este attempt)`,
    `recepcion_total = sum(RECEPCION de este attempt)`,
    `merma = max(0, entrega_total - recepcion_total)`,
    `merma_percent = merma / entrega_total * 100` (si `entrega_total > 0`);
    si `merma > 0`, `get_or_create_waste_item` (igual que hoy); marca
    `status = APROBADA`, `finished_by_user_id`, `finished_at`; inserta
    `ProductionRunStageAttemptDecision(decision="APROBADA", reason=None, ...)`.
    Ya NO llama `get_or_create_finished_product_lot`/`convert_lot_to_product`
    — el producto resultante ya movió stock en `start_stage_attempt` (o en un
    "Agregar" posterior).
  - `reject_stage_attempt(attempt_id, payload: StageAttemptReject, current_user) -> ProductionRunRead`:
    valida `status == IN_PROGRESS`; **no** toca `status` del intento (sigue
    `IN_PROGRESS`); inserta
    `ProductionRunStageAttemptDecision(decision="RECHAZADA", reason=payload.reason, ...)`.
    No mueve inventario, no calcula merma.
  - `attempt.rejection_reason` (columna vieja) deja de escribirse por código
    nuevo — la razón vive en la bitácora. La columna no se borra (dato
    histórico).
  - `attempt.target_item_id`/`target_product_type_id` dejan de escribirse
    por código nuevo (las columnas no se borran). El "producto resultante"
    se lee directo de las líneas RECEPCION del acta.
- `add_admin_acta_line`: la validación "no puede recibir lo que nunca se
  entregó" desaparece del todo (ya no aplica ningún tope a RECEPCION,
  entregado o no — todo el bloque de cálculo `entregado`/`disponible` para
  RECEPCION se borra). Para ENTREGA, se agrega el mismo tope
  `0 < quantity <= item.current_stock` que aplica en `start_stage_attempt`
  (hoy `add_admin_acta_line` no valida esto en absoluto para ENTREGA — es
  agregado nuevo). Esto es ADEMAS del chequeo de stock reservado que ya
  existe en `_apply_admin_acta_line_delta` para `CONSUMO_PRODUCCION` (protege
  reservas de ordenes viejas en `ESPERANDO_MATERIAL`, que siguen existiendo
  como dato historico) -- ese chequeo no se toca, sigue aplicando igual. Se
  agrega la validación de `note` obligatorio: si
  `side == ENTREGA` y `stage_attempt_id` corresponde a un intento cuyo
  `started_at` ya pasó (siempre es así, se inicia con `started_at` al
  crearse) — la señal real es "esta línea se agrega DESPUÉS de que las
  líneas `PLAN` iniciales del attempt ya existen", que se puede detectar
  simplemente por ser un alta vía `add_admin_acta_line` (fuente
  `ADMIN_STOCK`) en vez de vía `start_stage_attempt` (fuente `PLAN`) — o sea,
  **toda** llamada a `add_admin_acta_line` con `side=ENTREGA` y
  `stage_attempt_id` no nulo exige `note` no vacío. Sin `stage_attempt_id`
  (nivel de orden, ActaView/Documentos) no exige nada (no hay "etapa ya
  arrancada" que perder de vista ahí).
- Router (`backend/modules/production/router.py`): reemplaza
  `POST /stage-attempts/{id}/finish` por
  `POST /stage-attempts/{id}/approve` (sin body) y
  `POST /stage-attempts/{id}/reject` (body `StageAttemptReject`). Elimina
  `POST /stage-attempts/{id}/allocate-material`.

### Frontend

- `frontend/lib/production-api.ts`: `finishStageAttempt(...)` →
  `approveStageAttempt(attemptId)` (sin body) y
  `rejectStageAttempt(attemptId, { reason })`. Elimina
  `allocateStageAttemptMaterial`. `startStageAttempt` payload cambia
  `product` → `products: [...]`.
- `production-dashboard.tsx`:
  - Formulario "Elegir proceso" (iniciar etapa): la sección "Materia prima"
    (picker único + cantidad) se generaliza a **Entrada**: lista de filas,
    cada una `{item, cantidad}`, botón "+ Agregar entrada" para sumar más
    filas, usando el mismo `MaterialCategoryPicker` que ya existe (todos los
    tipos, no solo materia prima — coincide con "cualquier item de
    inventario que entra a esta etapa", ya es así en el picker actual).
    Cantidad topada a stock disponible del item elegido (mismo picker, mismo
    patrón que ya usa `requireStock`/candidatos).
  - "Producto resultante" pasa de un botón único a la misma UI de lista
    (n filas, cada una elige pieza/tipo + cantidad), reusando
    `FinishedItemPicker`/`CatalogProductPicker` + el flujo de creación de
    pieza sin stock que ya se implementó para `AdminAddActaLineControl`
    (material + unidad si hace falta crear la pieza).
  - Se quita `recepcionPendingRow`/`runQuantity` (ya no hay "cantidad final"
    que pedir aparte — los productos ya están en el acta desde que se
    inician).
  - Botones de etapa: donde hoy se decide entre "Finalizar etapa" (sin QC) o
    Aprobado/Denegado (con QC), ahora siempre son dos botones ✓/✗ que llaman
    `approveStageAttempt`/`rejectStageAttempt`. ✗ abre un modal simple
    pidiendo motivo (opcional) y, al confirmar, dispara `rejectStageAttempt`
    y **no cierra la vista de la etapa** (sigue editable).
  - Formulario de crear/editar proceso: se quita el checkbox
    "Control de calidad".
  - Cualquier UI de "Asignar material disponible"/`PENDIENTE_MATERIAL` para
    intentos (branches de estado en la vista de etapas) se elimina.
- `AdminAddActaLineControl`/`MaterialCategoryPicker`: sin cambios de
  estructura por este spec (los cambios de motivo obligatorio se manejan
  agregando un campo "Motivo" visible solo cuando side=ENTREGA y hay
  `stageAttemptId`, con validación igual que ya hace el resto del
  componente para campos requeridos).

### Testing

- `backend/tests/production/test_stage_attempt_material.py`: los tests de
  split/cobertura parcial/`allocate_stage_attempt_material` se **borran**
  (esa lógica ya no existe). Se agregan tests para: bloqueo por
  `quantity > current_stock`, bloqueo por `current_stock == 0`, y consumo
  directo cuando alcanza.
- `backend/tests/production/test_stage_quality_control.py`: se reescriben
  para `approve_stage_attempt`/`reject_stage_attempt` en vez de
  `finish_stage_attempt` con `quality_control` condicional. Nuevo: rechazar
  dos veces seguidas deja dos filas en la bitácora y el intento sigue
  `IN_PROGRESS`; aprobar después de un rechazo cierra normal.
- `backend/tests/production/test_dynamic_flow.py`: ajustar los
  `StageAttemptCreate(product=...)` a `products=[...]`; ajustar cualquier
  aserción sobre conversión de lote al finalizar (ya no ocurre ahí).
- `backend/tests/production/test_revert_stage_attempt.py`: revisar que
  `revert_stage_attempt` siga funcionando con productos ya movidos como
  líneas normales (probablemente sin cambios, pero confirmar).
- Nuevo test: `add_admin_acta_line` con `side=ENTREGA`, `stage_attempt_id`
  no nulo, sin `note` → error; con `note` → ok. Con `side=RECEPCION` nunca
  exige `note`.
- Nuevo test: `add_admin_acta_line` ENTREGA con `quantity > current_stock`
  → error (tope nuevo que hoy no existe en esta función).

### Fuera de alcance (sub-proyectos B/C/D, especs separados)

- Botón "ir a Mantenimiento" desde el picker + mostrar todo sin stock en
  todos los tipos (hoy solo Terminados) — sub-proyecto B.
- Vista de auditoría para el admin (lista de decisiones + `note` de
  ENTREGA post-arranque, por orden) — sub-proyecto C. Este spec deja lista
  la bitácora (`ProductionRunStageAttemptDecision`) y el `note` obligatorio;
  la vista para consultarlo es aparte.
- Material en creación de complementos/productos terminados + filtrado por
  material en los pickers — sub-proyecto D.

## Verificación

- `docker-compose exec api alembic upgrade head` tras la migración nueva.
- `docker-compose exec api pytest backend/tests/production` (suite
  completa: nada de split/allocate debe seguir referenciado).
- `docker-compose exec web npm run build`.
- Smoke manual: iniciar etapa con 2 entradas + 2 productos resultantes,
  confirmar que ambos lados del acta ya muestran las líneas y el stock ya
  se movió; rechazar (✗) y confirmar que el intento sigue editable y la
  bitácora registra el rechazo; agregar una entrada de más por "Agregar"
  sin motivo (debe bloquear) y con motivo (debe pasar); aprobar (✓) y
  confirmar que la merma se calculó de los totales del acta.
