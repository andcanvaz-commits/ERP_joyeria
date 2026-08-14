# Material adicional mid-proceso (pieza A) — Design

## Contexto

Pieza A de 4 (B: acta persistida — ya implementada, A: esta, C: auto-alimentación
del acta, D: revisión final + edición visual). Orden acordado con el usuario:
B → A → C → D.

Hoy, una vez que una orden pasa a `EN_PROCESO`, no hay forma de pedirle a
Inventario un material adicional (insumo, complemento o materia prima extra)
que no se haya declarado al crear la orden. Todo lo que la orden puede consumir
quedó fijado en `create_run` (materia prima, insumos de etapa, complementos) y
se consume una única vez en `approve_materials`, que **no es re-invocable**
(`service.py`, guard `run.status == PENDING_INVENTORY`).

El usuario pidió que este pedido pase por el **circuito real** de
aprobación/reserva/consumo de Inventario — no una simple línea de texto — igual
que hoy pasa con los complementos e insumos de la creación.

## Modelo

Nueva tabla `production_run_additional_material_requests`, modelo
`ProductionRunAdditionalMaterialRequest` en
`backend/modules/production/models.py` (mismo patrón que
`ProductionComplementRequest`, sin reserva parcial — a diferencia de los
complementos de creación, este pedido es puntual: se aprueba entero o se
rechaza, no se junta en varios ingresos):

```python
class ProductionRunAdditionalMaterialRequest(Base):
    __tablename__ = "production_run_additional_material_requests"

    id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    run_id: Mapped[PyUUID] = mapped_column(
        ForeignKey("production_runs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Etapa que estaba EN_PROCESO cuando se pidio (para trazabilidad/acta),
    # o NULL si al pedirlo ninguna etapa estaba activa.
    stage_id: Mapped[PyUUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("production_run_stages.id", ondelete="SET NULL"), nullable=True
    )
    item_id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(14, 4), nullable=False)
    unit_code: Mapped[str] = mapped_column(String(20), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default=ComplementRequestStatus.PENDING)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    requested_by_user_id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    requested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    approved_by_user_id: Mapped[PyUUID | None] = mapped_column(PG_UUID(as_uuid=True), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    run: Mapped["ProductionRun"] = relationship(back_populates="additional_material_requests")
```

Reusa `ComplementRequestStatus` (`PENDIENTE`/`APROBADA`/`RECHAZADA`) — mismo
significado, no hace falta un enum nuevo.

En `ProductionRun`, agregar:

```python
    additional_material_requests: Mapped[list["ProductionRunAdditionalMaterialRequest"]] = relationship(
        back_populates="run",
        cascade="all, delete-orphan",
        order_by="ProductionRunAdditionalMaterialRequest.requested_at",
    )
```

## Service — `backend/modules/production/service.py`

**`request_additional_material(run_id, payload, current_user) -> ProductionRunRead`**
- `run = self.repository.get_run(run_id)`; 404 si no existe.
- Solo si `run.status == ProductionRunStatus.IN_PROGRESS` (`ProductionDomainError` si no).
- Valida `item_id`: existe, `item_type` en `("RAW_MATERIAL", "SUPPLY", "COMPLEMENT")`
  (mismo criterio combinado que ya usa `_validate_materials`/los pickers de
  proceso — cualquier recurso que la producción puede consumir).
- Crea `ProductionRunAdditionalMaterialRequest` con `stage_id` = el id de la
  etapa con `status == ProductionRunStageStatus.IN_PROGRESS` dentro de
  `run.stages` (si hay una — puede no haberla si están todas pendientes/ya
  pasadas por algún estado transitorio; en ese caso `None`), `status=PENDING`,
  `requested_by_user_id=current_user.id`.
- `flush()`, devuelve `self._read_with_names(run)`.

**`approve_additional_material(request_id, current_user) -> ProductionRunRead`**
- Busca el `ProductionRunAdditionalMaterialRequest` por id (join a través del
  repositorio — necesita un método nuevo `get_additional_material_request` en
  `ProductionProcessRepository`, `select(...).where(id==...)`); 404 si no existe.
- Solo si `status == PENDING` (`ProductionDomainError` si no: "Esta solicitud ya
  fue procesada.").
- Resuelve el `InventoryItem`; si no existe, error de dominio.
- Consume con `self.inventory_service.consume_material_for_production(item_id=...,
  quantity=request.quantity, production_run_id=request.run_id, user_id=current_user.id,
  production_code=run.production_code or run.root_production_code,
  reason="Material adicional solicitado durante la etapa {stage_name}.")`
  — reusa tal cual, ya valida stock no negativo y ya está exento del chequeo de
  reservas de otras órdenes (`PRODUCTION_MOVEMENTS`, confirmado en la
  investigación previa). Si lanza `InventoryDomainError`, se traduce a
  `ProductionDomainError` (mismo patrón que el resto del service).
- Marca `status=APPROVED`, `approved_by_user_id`, `approved_at`.
- **Agrega la línea a la acta** (pieza B ya existe): `run.acta_lines.append(
  ProductionRunActaLine(side=ENTREGA, stage_id=request.stage_id,
  label=item.name, quantity=request.quantity, unit_code=request.unit_code,
  source=ActaLineSource.AUTO, line_order=<siguiente número de ENTREGA de esa
  corrida>))`. Esto es el único punto de "pieza C" que se resuelve junto con A,
  porque sin esto la funcionalidad no tiene efecto visible; el resto de
  auto-alimentación (merma por etapa, recepción real) queda para la pieza C.
- `flush()`, devuelve `self._read_with_names(run)`.

**`reject_additional_material(request_id, reason, current_user) -> ProductionRunRead`**
- Mismo patrón de búsqueda y guard `status == PENDING`.
- `status=REJECTED`, `rejection_reason=reason`, `approved_by_user_id=current_user.id`
  (reutilizado como "quien decidió", mismo patrón que `reject_materials` hoy),
  `approved_at=datetime.utcnow()`.

## Schemas

```python
class AdditionalMaterialRequestCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    item_id: UUID
    quantity: Decimal = Field(gt=0)
    note: str | None = Field(default=None, max_length=500)


class AdditionalMaterialRequestRead(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="forbid")
    id: UUID
    item_id: UUID
    name: str | None = None
    quantity: Decimal
    unit_code: str
    status: str
    stage_id: UUID | None = None
    stage_name: str | None = None
    note: str | None = None
    requested_by_name: str | None = None
    requested_at: datetime
    approved_by_name: str | None = None
    approved_at: datetime | None = None
    rejection_reason: str | None = None
```

`name`/`stage_name`/`requested_by_name`/`approved_by_name` se resuelven en
`_read_with_names` (mismo patrón que ya hace para complementos — batch query
de `InventoryItem`/`AuthUser` por los ids involucrados). Agregar
`additional_materials: list[AdditionalMaterialRequestRead] = Field(default_factory=list)`
a `ProductionRunRead`.

## Router — `backend/modules/production/router.py`

```
POST /runs/{run_id}/additional-materials        production.runs.update
POST /runs/additional-materials/{request_id}/approve   production.runs.update
POST /runs/additional-materials/{request_id}/reject    production.runs.update
```

Mismo permiso que el resto del ciclo de vida de una corrida (no hay permisos
granulares por acción en este módulo — ver `ROLE_PERMISSIONS`, todo comparte
`production.runs.update`, reforzado por el bypass de roles ya existente en
`router.py:48-59` que igual le da a "Jefe de inventario" acceso a
`production.runs.update`). No hace falta agregar permisos nuevos.

## Frontend

**Lado producción** (`production-dashboard.tsx`, modal de gestión de una
corrida `EN_PROCESO`, junto al carrusel de etapas): botón "Solicitar material"
que abre `MaterialCategoryPicker` (`allowedTypes: ["RAW_MATERIAL", "SUPPLY",
"COMPLEMENT"]`, mismo componente que ya se reusó para materia prima e
insumos) para elegir el item, seguido de un campo de cantidad (y nota
opcional) antes de confirmar — llama a `requestAdditionalMaterial(runId, {...})`.
Lista debajo las solicitudes ya hechas para esa corrida
(`run.additional_materials`) con su estado (Pendiente/Aprobada/Rechazada).

**Lado inventario** (`inventory-dashboard.tsx`, modal "Solicitudes de
producción"): nueva sección "Material adicional" listando las solicitudes con
`status === "PENDIENTE"` de todas las corridas `EN_PROCESO`, con
Aprobar/Rechazar (mismo patrón visual que la sección de materia prima ya
existente).

## Testing

- `backend/tests/production/test_additional_material.py`: pedir en
  `PENDING_INVENTORY`/`MATERIALES_APROBADOS` rechaza (solo `IN_PROGRESS`);
  pedir en `IN_PROGRESS` crea `PENDING` con `stage_id` de la etapa activa;
  aprobar consume stock real (`InventoryItem.current_stock` baja) y agrega
  línea a `run.acta_lines` (`source=AUTO`); aprobar sin stock suficiente
  lanza error y no crea la línea de acta; rechazar no toca stock ni acta;
  aprobar una solicitud ya `APROBADA`/`RECHAZADA` de nuevo lanza error.
- Suite completa de producción después de cada cambio.
- `npm run build` para el frontend.
