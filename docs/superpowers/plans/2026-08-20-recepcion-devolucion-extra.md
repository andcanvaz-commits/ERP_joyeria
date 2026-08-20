# Recepción: unificar botón "Agregar" y permitir devolución extra — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El lado RECIBIDO del acta, durante una etapa activa, usa el mismo
botón "Agregar" (buscador completo de inventario + "Escribir a mano") que ya
usa el lado ENTREGADO, y permite registrar devoluciones de ítems que nunca
aparecieron como entregados en esa etapa (sin tope), además de las que sí
estaban entregadas (con tope, como hoy).

**Architecture:** Reusar `AdminAddActaLineControl` (ya existe, ya se usa para
ENTREGA) también para `side="RECEPCION"` en los dos sitios de
`production-dashboard.tsx` que hoy usan `StageRecepcionControl` (que se
borra). Un solo cambio de regla en el backend
(`add_admin_acta_line`/`service.py`): el tope `entregado − recibido` solo
aplica cuando `entregado > 0`; si el ítem nunca se entregó en esta etapa, se
permite sin tope. Sin componentes nuevos, sin migración, sin columna nueva.

**Tech Stack:** FastAPI + SQLAlchemy 2.0 (backend/modules/production), Next.js
16 + React 18 (frontend/components/production).

## Global Constraints

- Español-first en labels y mensajes de error (CLAUDE.md).
- La materia prima (`RAW_MATERIAL`) nunca se recibe por RECEPCION de etapa,
  entregada o no (spec 2026-08-20-recepcion-devolucion-extra-design.md,
  confirmado con Rodrigo).
- No `HTTPException` en services; `ProductionDomainError`/`ProductionNotFoundError` (CLAUDE.md).
- Todo cambio de stock nace de un `InventoryMovement` vía `create_movement()` (CLAUDE.md) — no se toca este mecanismo, solo la validación previa.
- Backend tocado → `docker-compose exec api pytest`. Frontend tocado → `docker-compose exec web npm run build`.

---

### Task 1: Backend — permitir devolución extra (item nunca entregado en la etapa) sin tope

**Files:**
- Modify: `backend/modules/production/service.py:874-906`
- Test: `backend/tests/production/test_admin_acta_line.py:570-588`

**Interfaces:**
- Consumes: `ProductionService.add_admin_acta_line(run_id, AdminActaLineCreate, current_user)` — sin cambios de firma.
- Produces: nada nuevo — mismo método, comportamiento relajado para `entregado == 0`.

- [ ] **Step 1: Reescribir el test que hoy espera error, para que espere éxito sin tope**

Reemplaza el test completo `test_add_admin_acta_line_recepcion_rejects_item_never_entregado` (líneas 570-588) por:

```python
def test_add_admin_acta_line_recepcion_allows_extra_never_entregado(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    """Devolucion 'extra': un item que nunca aparecio en ENTREGA de esta etapa
    (fuera de lo entregado) se puede recibir igual, sin tope -- Rodrigo,
    2026-08-20: produccion a veces devuelve algo que no estaba en lo
    entregado, y eso debe sumar al stock igual."""
    from backend.modules.inventory.models import InventoryItem

    order, attempt, _supply = _start_with_entrega(db_session, production_service, current_user, process, raw_material, target_complement)
    other_item = InventoryItem(
        item_type="SUPPLY", name="Otro insumo", sku=f"IN-TEST-{uuid.uuid4().hex[:8]}",
        unit_code="und", current_stock=Decimal("10"),
    )
    db_session.add(other_item)
    db_session.flush()

    result = production_service.add_admin_acta_line(
        order.id,
        AdminActaLineCreate(side="RECEPCION", item_id=other_item.id, quantity=Decimal("500"), stage_attempt_id=attempt.id),
        current_user,
    )

    db_session.refresh(other_item)
    assert other_item.current_stock == Decimal("510")  # 10 + 500 devuelto, sin tope
    lines = [l for l in result.acta_lines if l.item_id == other_item.id and l.side == "RECEPCION"]
    assert len(lines) == 1
    assert lines[0].quantity == Decimal("500")
```

(Quantity `500` es deliberadamente enorme frente a cualquier `entregado` real de la etapa — prueba que no hay tope de ningún tipo cuando `entregado` del propio ítem es 0.)

- [ ] **Step 2: Correr el test para verificar que falla con el código actual**

Run: `docker-compose exec api pytest backend/tests/production/test_admin_acta_line.py::test_add_admin_acta_line_recepcion_allows_extra_never_entregado -v`
Expected: FAIL — `ProductionDomainError: Solo se puede recibir un material que ya se entrego en esta etapa.`

- [ ] **Step 3: Relajar la regla en el service**

En `backend/modules/production/service.py`, dentro de `add_admin_acta_line`, reemplaza el bloque (líneas 879-906):

```python
            entregado = sum(
                (
                    l.quantity
                    for l in run.acta_lines
                    if l.side == ActaLineSide.ENTREGA
                    and l.item_id == item.id
                    and l.stage_attempt_id == payload.stage_attempt_id
                ),
                Decimal("0"),
            )
            if entregado <= 0:
                raise ProductionDomainError("Solo se puede recibir un material que ya se entrego en esta etapa.")
            recibido = sum(
                (
                    l.quantity
                    for l in run.acta_lines
                    if l.side == ActaLineSide.RECEPCION
                    and l.item_id == item.id
                    and l.stage_attempt_id == payload.stage_attempt_id
                ),
                Decimal("0"),
            )
            disponible = entregado - recibido
            if payload.quantity > disponible:
                raise ProductionDomainError(
                    f"La cantidad ({format_qty(payload.quantity)} {item.unit_code}) supera lo que en realidad "
                    f"se entrego para este material ({format_qty(disponible)} {item.unit_code})."
                )
```

por:

```python
            entregado = sum(
                (
                    l.quantity
                    for l in run.acta_lines
                    if l.side == ActaLineSide.ENTREGA
                    and l.item_id == item.id
                    and l.stage_attempt_id == payload.stage_attempt_id
                ),
                Decimal("0"),
            )
            # entregado == 0: devolucion "extra", un item que nunca se
            # entrego en esta etapa -- se permite sin tope (Rodrigo,
            # 2026-08-20). El tope entregado-recibido solo tiene sentido
            # cuando el item si se entrego.
            if entregado > 0:
                recibido = sum(
                    (
                        l.quantity
                        for l in run.acta_lines
                        if l.side == ActaLineSide.RECEPCION
                        and l.item_id == item.id
                        and l.stage_attempt_id == payload.stage_attempt_id
                    ),
                    Decimal("0"),
                )
                disponible = entregado - recibido
                if payload.quantity > disponible:
                    raise ProductionDomainError(
                        f"La cantidad ({format_qty(payload.quantity)} {item.unit_code}) supera lo que en realidad "
                        f"se entrego para este material ({format_qty(disponible)} {item.unit_code})."
                    )
```

- [ ] **Step 4: Correr el test nuevo y toda la suite del archivo**

Run: `docker-compose exec api pytest backend/tests/production/test_admin_acta_line.py -v`
Expected: PASS — todos los tests, incluido el nuevo
`test_add_admin_acta_line_recepcion_allows_extra_never_entregado`, y sin
regresión en `test_add_admin_acta_line_recepcion_rejects_raw_material` ni
`test_add_admin_acta_line_recepcion_caps_at_entregado_minus_recibido`.

- [ ] **Step 5: Correr la suite completa de producción por si algo más dependía del mensaje viejo**

Run: `docker-compose exec api pytest backend/tests/production -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/modules/production/service.py backend/tests/production/test_admin_acta_line.py
git commit -m "fix(produccion): permite devolucion extra en RECEPCION sin tope cuando el item nunca se entrego en la etapa"
```

---

### Task 2: Frontend — reemplazar StageRecepcionControl por AdminAddActaLineControl en RECEPCION

**Files:**
- Modify: `frontend/components/production/production-dashboard.tsx:17` (import)
- Modify: `frontend/components/production/production-dashboard.tsx:1729-1771` (vista de etapa corriendo)
- Modify: `frontend/components/production/production-dashboard.tsx:2067-2113` (vista "ver etapa")
- Delete: `frontend/components/production/stage-recepcion-control.tsx`

**Interfaces:**
- Consumes: `AdminAddActaLineControl` (from `@/components/production/admin-add-acta-line`, ya importado en el archivo) — props `{ isAdmin, items, onChanged, onError, onSuccess, runId, side, stageAttemptId }`.
- Produces: nada nuevo para otras tareas.

- [ ] **Step 1: Quitar el import de StageRecepcionControl**

En `frontend/components/production/production-dashboard.tsx`, borra la línea:

```typescript
import { StageRecepcionControl } from "@/components/production/stage-recepcion-control";
```

- [ ] **Step 2: Vista de etapa corriendo — quitar los consts que solo alimentaban StageRecepcionControl**

Reemplaza:

```typescript
                const materialItems = [...rawMaterials, ...orderSupplyItems, ...complementItems, ...wasteItems, ...finishedItems];
                const runningModel = buildOrdenProduccion([dynamicOrderRun], runningAttempt.id);
                const entregaLines = runningModel.entregaLines;
                const recepcionLines = runningModel.recepcionLines;
                return (
```

por:

```typescript
                const materialItems = [...rawMaterials, ...orderSupplyItems, ...complementItems, ...wasteItems, ...finishedItems];
                const runningModel = buildOrdenProduccion([dynamicOrderRun], runningAttempt.id);
                return (
```

- [ ] **Step 3: Vista de etapa corriendo — swap del recepcionFooter**

Reemplaza:

```typescript
                        recepcionFooter={
                          <StageRecepcionControl
                            entregaLines={entregaLines}
                            materialItems={materialItems}
                            onChanged={refreshDynamicOrder}
                            onError={setError}
                            onSuccess={setSuccess}
                            recepcionLines={recepcionLines}
                            runId={dynamicOrderRun.id}
                            stageAttemptId={runningAttempt.id}
                          />
                        }
```

por:

```typescript
                        recepcionFooter={
                          <AdminAddActaLineControl
                            isAdmin
                            items={materialItems}
                            onChanged={refreshDynamicOrder}
                            onError={setError}
                            onSuccess={setSuccess}
                            runId={dynamicOrderRun.id}
                            side="RECEPCION"
                            stageAttemptId={runningAttempt.id}
                          />
                        }
```

- [ ] **Step 4: Vista "ver etapa" — quitar los consts que solo alimentaban StageRecepcionControl**

Reemplaza:

```typescript
            const viewMaterialItems = [...rawMaterials, ...orderSupplyItems, ...complementItems, ...wasteItems, ...finishedItems];
            const viewingModel = buildOrdenProduccion([dynamicOrderRun], viewingAttempt.id);
            const viewEntregaLines = viewingModel.entregaLines;
            const viewRecepcionLines = viewingModel.recepcionLines;
            return (
```

por:

```typescript
            const viewMaterialItems = [...rawMaterials, ...orderSupplyItems, ...complementItems, ...wasteItems, ...finishedItems];
            const viewingModel = buildOrdenProduccion([dynamicOrderRun], viewingAttempt.id);
            return (
```

- [ ] **Step 5: Vista "ver etapa" — swap del recepcionFooter**

Reemplaza:

```typescript
                      recepcionFooter={
                        <StageRecepcionControl
                          entregaLines={viewEntregaLines}
                          materialItems={viewMaterialItems}
                          onChanged={() => void refreshViewingOrder()}
                          onError={setError}
                          onSuccess={setSuccess}
                          recepcionLines={viewRecepcionLines}
                          runId={dynamicOrderRun.id}
                          stageAttemptId={viewingAttempt.id}
                        />
                      }
```

por:

```typescript
                      recepcionFooter={
                        <AdminAddActaLineControl
                          isAdmin
                          items={viewMaterialItems}
                          onChanged={() => void refreshViewingOrder()}
                          onError={setError}
                          onSuccess={setSuccess}
                          runId={dynamicOrderRun.id}
                          side="RECEPCION"
                          stageAttemptId={viewingAttempt.id}
                        />
                      }
```

- [ ] **Step 6: Borrar el archivo que quedó sin uso**

`stage-recepcion-control.tsx` ya no tiene ningún caller. Bórralo:

```bash
rm frontend/components/production/stage-recepcion-control.tsx
```

- [ ] **Step 7: Build**

Run: `docker-compose exec web npm run build`
Expected: build sin errores (sin imports rotos, sin variables sin usar
apuntando a `entregaLines`/`recepcionLines`/`viewEntregaLines`/`viewRecepcionLines`).

- [ ] **Step 8: Commit**

```bash
git add frontend/components/production/production-dashboard.tsx
git rm frontend/components/production/stage-recepcion-control.tsx
git commit -m "feat(produccion): boton Agregar de RECEPCION en etapa activa igual al de ENTREGA (buscador completo + escribir a mano)"
```

---

### Task 3: Verificación manual end-to-end

**Files:** ninguno (solo prueba manual en navegador, `docker-compose` ya corriendo por el usuario).

- [ ] **Step 1: Iniciar una etapa con materia prima + complemento entregados, y un insumo (ej. hilo) entregado de más.**

- [ ] **Step 2: En el lado RECIBIDO, click "Agregar" — confirmar que se ve y abre igual que el de ENTREGADO (buscador + "Escribir a mano"), no la tabla vieja de candidatos.**

- [ ] **Step 3: Devolver el insumo que sí se entregó, de a poco, y confirmar que si se pasa del entregado da el error de tope (mensaje "supera lo que en realidad se entrego").**

- [ ] **Step 4: Con el picker, buscar y elegir un ítem que nunca se entregó en esta etapa (ej. otro complemento cualquiera), poner una cantidad y confirmar "Agregar y mover inventario" — debe aceptar sin error y sumar al stock de ese ítem.**

- [ ] **Step 5: Intentar devolver materia prima (entregada o no) — debe seguir bloqueado con el mensaje "no se devuelve por aca".**

- [ ] **Step 6: Repetir los pasos 2-5 abriendo la etapa desde "Ver etapa" (histórica, no la corriendo) para confirmar que el segundo call site también quedó igual.**

No hay commit para esta tarea — es solo confirmación de que Task 1 y Task 2 funcionan juntas en la app real.
