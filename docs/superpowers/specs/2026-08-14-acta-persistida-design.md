# Acta persistida (base) — Design

## Contexto

Es la pieza **B** de 4 (A: material adicional mid-proceso, B: esta, C: auto-alimentación,
D: revisión final + edición visual), decididas con el usuario en
`docs/superpowers/specs/2026-08-14-*` (conversación, no hay spec previo escrito para
la decomposición en sí). Orden acordado: B → A → C → D, cada una implementada y
verificada antes de pasar a la siguiente.

Hoy el "acta" (comprobante "Orden de Producción" en Documentos) **no existe como
dato persistido**: se calcula al vuelo en el frontend
(`frontend/lib/orden-produccion.ts:buildOrdenProduccion`) leyendo campos de
`ProductionRun` cada vez que se abre el documento. Se completa en dos eventos
discretos — ENTREGA cuando `materials_approved_at` se setea, RECEPCION cuando
`received_at` se setea — sin nada en el medio. El único precedente de líneas de
acta persistidas es `ProductionRunEventLine`/`event_lines`, pero es exclusivo de
las órdenes históricas migradas de papel, inmutable desde la app, y el service
bloquea explícitamente que una orden con `event_lines` pase por el flujo de
recepción en vivo (`service.py:1800-1806`) — no se reutiliza para esto.

## Objetivo de esta pieza (B)

Que cada `ProductionRun` tenga, desde el momento en que se crea, un acta
**persistida** (tabla propia) con las líneas de ENTREGA y RECEPCION que hoy se
calculan al vuelo, sembradas con los datos **planeados** de la orden (los que ya
se declararon al crearla). Todavía NO se toca el frontend ni el documento
imprimible — eso es la pieza D, que reemplazará `buildOrdenProduccion` por una
lectura de esta tabla. Esta pieza es puramente de datos: crear el modelo,
migrarlo, y sembrarlo en `create_run`.

## Modelo

Nueva tabla `production_run_acta_lines`, modelo `ProductionRunActaLine` en
`backend/modules/production/models.py`:

```python
class ActaLineSide(str, enum.Enum):
    ENTREGA = "ENTREGA"
    RECEPCION = "RECEPCION"


class ActaLineSource(str, enum.Enum):
    # Sembrada automaticamente al crear la orden, con los valores planeados.
    PLAN = "PLAN"
    # Agregada automaticamente por un evento del sistema (pieza C: material
    # adicional aprobado, etapa finalizada con merma, recepcion real).
    AUTO = "AUTO"
    # Agregada a mano por un usuario editando el acta (pieza D).
    MANUAL = "MANUAL"


class ProductionRunActaLine(Base):
    __tablename__ = "production_run_acta_lines"

    id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    run_id: Mapped[PyUUID] = mapped_column(
        ForeignKey("production_runs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Etapa a la que esta linea esta ligada (ej. merma de esa etapa), o NULL
    # si es una linea de nivel de orden (materia prima, producto final, etc.).
    stage_id: Mapped[PyUUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("production_run_stages.id", ondelete="SET NULL"), nullable=True
    )
    side: Mapped[str] = mapped_column(String(20), nullable=False)
    label: Mapped[str] = mapped_column(String(180), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(14, 4), nullable=False)
    unit_code: Mapped[str] = mapped_column(String(20), nullable=False)
    source: Mapped[str] = mapped_column(String(20), nullable=False, default=ActaLineSource.PLAN.value)
    line_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_user_id: Mapped[PyUUID | None] = mapped_column(PG_UUID(as_uuid=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    run: Mapped["ProductionRun"] = relationship(back_populates="acta_lines")
```

`side`/`source` como `String` (no `Enum` de Postgres), siguiendo la convención ya
usada en el resto del módulo (`ProductionRunStatus`, etc. se guardan como string
con un `Enum` de Python solo del lado de la aplicación — ver
`ComplementRequestStatus` en `models.py:126-129` como precedente exacto de este
patrón).

En `ProductionRun` (`models.py`), agregar:

```python
    acta_lines: Mapped[list["ProductionRunActaLine"]] = relationship(
        back_populates="run",
        cascade="all, delete-orphan",
        order_by="ProductionRunActaLine.line_order",
    )
```

## Siembra en `create_run`

Al final de `ProductionService.create_run` (`service.py`), después de que `run`
ya tiene `id` (post-flush) y ya se resolvieron los objetos `InventoryItem` de
materia prima, insumos y complementos (ya están en memoria en ese punto del
método, no hace falta releerlos), construir las líneas:

**ENTREGA** (una por recurso planeado, en este orden):
1. Materia prima: `label=item.name`, `quantity=payload.quantity`,
   `unit_code=unit_code` (la variable ya resuelta en el método), `source=PLAN`.
2. Un insumo por cada `payload.stage_ingredients` (en el mismo orden en que se
   valida hoy): `label=ingredient_items[ing.id].name`, `quantity=payload_by_id[ing.id]`,
   `unit_code=ingredient_items[ing.id].unit_code`, `source=PLAN`,
   `stage_id` = el `run.stages[].id` de la etapa a la que pertenece ese insumo
   (mismo mapeo que ya arma el método al copiar `stage.ingredients` a
   `run.stages[].ingredients`).
3. Un complemento por cada `payload.complements`: `label=complement_items[i].name`
   (mismo orden que `complement_items` ya construido en el método),
   `quantity=complement.quantity`, `unit_code=complement_items[i].unit_code`,
   `source=PLAN`.

**RECEPCION** (una por cada `payload.products`, resolviendo nombre igual que
`_attach_plan_names` pero inline):
- Si `product.product_type_id`: `label=product_type.name` (ya se validó y
  cargó el `ProductType` en `_validate_run_products`; para no duplicar la
  consulta, resolver de nuevo aquí con una sola query `select` por los
  `product_type_id` de `payload.products`, igual patrón que
  `_attach_plan_names`), `unit_code="und"`.
- Si `product.target_item_id`: `label=item.name`, `unit_code=item.unit_code`
  (requiere cargar el `InventoryItem`; ya se validó su existencia en
  `_validate_run_products`, se vuelve a cargar aquí por simplicidad — es un
  solo `create_run`, no un listado, el costo es despreciable).
- `quantity=product.quantity`, `source=PLAN`.

`line_order` es el índice secuencial dentro de cada lado (0, 1, 2… separado
para ENTREGA y RECEPCION). `created_by_user_id=None` (sembrada por el sistema).

Estas líneas se agregan a `run.acta_lines` antes del `self.repository.flush()`
final del método (mismo flush, no uno adicional).

## Qué NO hace esta pieza

- No cambia `approve_materials`, `finish_stage`, ni `receive_finished_product`:
  esos siguen sin tocar `acta_lines` (eso es la pieza C).
- No expone `acta_lines` en `ProductionRunRead` ni en ningún endpoint todavía
  (no hace falta: nada la lee aún). Se agrega en la pieza D, junto con los
  endpoints de edición.
- No toca `frontend/lib/orden-produccion.ts` ni `OrdenProduccionDoc`: el
  documento imprimible sigue calculándose al vuelo exactamente igual que hoy
  hasta la pieza D.
- No migra las órdenes existentes con datos retroactivos: `acta_lines` arranca
  vacía para toda orden creada antes de este cambio (aceptable — son datos
  operativos nuevos hacia adelante, no un backfill histórico).

## Testing

- Migración: `docker-compose exec api alembic upgrade head`.
- Tests nuevos en `backend/tests/production/test_acta_seed.py`: crear una orden
  (ASIGNAR simple, con y sin insumos configurados) vía `production_service.create_run`
  y verificar que `run.acta_lines` tiene exactamente las líneas esperadas (lado,
  label, quantity, unit_code, source=PLAN, stage_id correcto para insumos). Un
  caso con complementos (modo ENSAMBLAR) verificando que también se siembran.
- Correr toda la suite de producción (`docker-compose exec api pytest
  backend/tests/production`) para confirmar que sembrar líneas extra no rompe
  ningún test existente (ninguno debería tocar `acta_lines`, pero conviene
  confirmar que el flush adicional no genera efectos secundarios).
