# Formato de Decimales en Mensajes de Error Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Los mensajes de error que citan cantidades (`Decimal` de columnas
`Numeric(14,4)`) muestran ceros decimales de sobra ("400.0000 g" en vez de
"400 g") porque el `Decimal` se interpola directo en un f-string. Se agrega
un helper compartido `format_qty()` y se aplica en cada mensaje afectado.

**Architecture:** Un módulo nuevo `backend/modules/shared/formatting.py` con
una función pura `format_qty(value: Decimal) -> str`. Se importa desde
`production/service.py` e `inventory/service.py` (los dos módulos con
mensajes de error afectados) — vive en `shared` porque ambos módulos lo
necesitan y `shared` es justo el punto de este proyecto para eso (ver
CLAUDE.md, "No importar modelos de otro módulo al nivel de módulo").

**Tech Stack:** Python 3.12, `decimal.Decimal`, pytest.

## Global Constraints

- Español-first: solo se toca el VALOR numérico dentro del mensaje, el texto
  del mensaje no cambia.
- No tocar la línea `f"Solo quedan {remaining} {complement.unit_code}..."`
  en `return_complement` (service.py ~2452) — esa la toca el plan
  [Modal "Sobrante por devolver"](2026-08-16-modal-sobrante-devolver.md)
  junto con el cambio de fórmula de esa misma línea, para no pisarse.
- `docker-compose exec api pytest` debe seguir en verde al final (no solo el
  módulo tocado — correr la suite completa, por si algún test existente hace
  match exacto de un mensaje de error con ceros de sobra).

---

### Task 1: Helper `format_qty` y sus tests

**Files:**
- Create: `backend/modules/shared/formatting.py`
- Test: `backend/tests/shared/test_formatting.py`

**Interfaces:**
- Produces: `format_qty(value: Decimal) -> str` — usado por Task 2 y Task 3.

- [ ] **Step 1: Escribir el test que falla**

```python
# backend/tests/shared/test_formatting.py
from decimal import Decimal

from backend.modules.shared.formatting import format_qty


def test_format_qty_strips_trailing_zeros_on_integer_value():
    assert format_qty(Decimal("400.0000")) == "400"


def test_format_qty_keeps_significant_decimals():
    assert format_qty(Decimal("399.8000")) == "399.8"


def test_format_qty_keeps_small_fractional_value():
    assert format_qty(Decimal("0.2000")) == "0.2"


def test_format_qty_handles_whole_number_without_dot():
    assert format_qty(Decimal("10")) == "10"


def test_format_qty_keeps_all_significant_decimals():
    assert format_qty(Decimal("0.0001")) == "0.0001"
```

- [ ] **Step 2: Correr y confirmar que falla**

Run: `docker-compose exec api pytest backend/tests/shared/test_formatting.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'backend.modules.shared.formatting'`
(si `backend/tests/shared/__init__.py` no existe, crearlo vacío primero —
mismo patrón que `backend/tests/production/__init__.py`).

- [ ] **Step 3: Implementar**

```python
# backend/modules/shared/formatting.py
from decimal import Decimal


def format_qty(value: Decimal) -> str:
    """Cantidad lista para un mensaje al usuario: sin los ceros decimales
    que arrastran las columnas Numeric(14,4) (400.0000 -> 400). `format(...,
    "f")` evita la notacion cientifica que Decimal.normalize() produce para
    numeros redondos (Decimal('4E+2'))."""
    text = format(value, "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text
```

- [ ] **Step 4: Correr y confirmar que pasa**

Run: `docker-compose exec api pytest backend/tests/shared/test_formatting.py -v`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/modules/shared/formatting.py backend/tests/shared/test_formatting.py backend/tests/shared/__init__.py
git commit -m "$(cat <<'EOF'
feat(shared): agrega format_qty para mensajes de error sin ceros de sobra

Decimal de columnas Numeric(14,4) interpolado directo en un f-string
siempre trae 4 decimales (400.0000 g) aunque el valor sea entero --
Rodrigo reporto el mensaje "no puede ser mayor que el material en
proceso (400.0000 g)" como inconsistente. format_qty vive en shared
porque tanto production como inventory tienen mensajes afectados.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Aplicar en `production/service.py`

**Files:**
- Modify: `backend/modules/production/service.py:206-208` (`shortage_message`)
- Modify: `backend/modules/production/service.py:1922-1924` (`update_acta_line`)
- Modify: `backend/modules/production/service.py:2038-2040` (`finish_stage`)
- Modify: `backend/modules/production/service.py:2180-2182` (`edit_stage_weight`)
- Test: `backend/tests/production/test_error_message_formatting.py`

**Interfaces:**
- Consumes: `format_qty` de Task 1 (`from backend.modules.shared.formatting import format_qty`).

- [ ] **Step 1: Escribir el test que falla**

Reusa el fixture `weighed_process` de `test_receive_merma.py` (etapa que
pesa) para forzar el mensaje de `finish_stage` con un peso final mayor al
material en proceso.

```python
# backend/tests/production/test_error_message_formatting.py
from decimal import Decimal

import pytest

from backend.modules.production.models import ProductionProcess, ProductionProcessStage
from backend.modules.production.schemas import ProductionRunCreate, ProductionRunStageFinish, RunProductCreate
from backend.modules.production.service import ProductionDomainError


@pytest.fixture()
def weighed_process(db_session) -> ProductionProcess:
    proc = ProductionProcess(
        name="Cadenas formato test",
        waste_limit_percent=Decimal("100"),
        is_active=True,
        stages=[
            ProductionProcessStage(
                name="Etapa pesada", stage_type="PROCESS", stage_order=1, is_active=True,
                requires_weighing=True,
            )
        ],
    )
    db_session.add(proc)
    db_session.flush()
    return proc


def test_finish_stage_weight_error_has_no_trailing_zeros(
    db_session, production_service, current_user, weighed_process, raw_material, target_complement
):
    raw_material.current_stock = Decimal("2000")
    db_session.flush()
    payload = ProductionRunCreate(
        process_id=weighed_process.id,
        raw_material_item_id=raw_material.id,
        quantity=Decimal("400"),
        assembly_mode="ASIGNAR",
        products=[RunProductCreate(target_item_id=target_complement.id, quantity=Decimal("400"))],
        complements=[],
    )
    run_read = production_service.create_run(payload, current_user)
    production_service.approve_materials(run_read.id, current_user)
    production_service.start_run(run_read.id, current_user)
    run = production_service.repository.get_run(run_read.id)

    with pytest.raises(ProductionDomainError) as exc_info:
        production_service.finish_stage(
            run.stages[0].id,
            ProductionRunStageFinish(final_weight=Decimal("5000")),
            current_user,
        )

    message = str(exc_info.value)
    assert "400 g" in message
    assert "400.0000" not in message
```

- [ ] **Step 2: Correr y confirmar que falla**

Run: `docker-compose exec api pytest backend/tests/production/test_error_message_formatting.py -v`
Expected: FAIL — `assert '400.0000' not in message` falla, el mensaje trae "400.0000 g".

- [ ] **Step 3: Implementar**

En el import de `production/service.py`, agregar junto a los demás imports
de módulo:

```python
from backend.modules.shared.formatting import format_qty
```

`shortage_message` (línea ~199-209):

```python
    def shortage_message(self) -> str:
        origin = (
            " (complemento/insumo solicitado en la orden)"
            if self.limiting_is_complement
            else ""
        )
        return (
            f"Stock insuficiente de '{self.limiting_name}'{origin}: disponible "
            f"{format_qty(self.limiting_available)} {self.limiting_unit}, se requieren "
            f"{format_qty(self.limiting_required_per_unit)} {self.limiting_unit}."
        )
```

`update_acta_line` (línea ~1919-1925):

```python
        if payload.quantity is not None and line.side == ActaLineSide.RECEPCION and line.item_id is not None:
            cap = self._acta_line_max_quantity(line)
            if cap is not None and payload.quantity > cap:
                raise ProductionDomainError(
                    f"La cantidad ({format_qty(payload.quantity)} {line.unit_code}) supera lo que en realidad "
                    f"se entrego para este material ({format_qty(cap)} {line.unit_code})."
                )
```

`finish_stage` (línea ~2035-2041):

```python
        if stage.requires_weighing and payload.final_weight is not None:
            reference = self._previous_stage_weight(run, stage)
            if reference is not None and reference > 0 and payload.final_weight > reference:
                raise ProductionDomainError(
                    f"El peso final ({format_qty(payload.final_weight)} {run.raw_material_unit_code}) no puede ser "
                    f"mayor que el material en proceso ({format_qty(reference)} {run.raw_material_unit_code})."
                )
```

`edit_stage_weight` (línea ~2178-2183):

```python
        reference = self._previous_stage_weight(run, stage)
        if reference is not None and reference > 0 and payload.final_weight > reference:
            raise ProductionDomainError(
                f"El peso corregido ({format_qty(payload.final_weight)} {run.raw_material_unit_code}) no puede ser "
                f"mayor que el material que entro a la etapa ({format_qty(reference)} {run.raw_material_unit_code})."
            )
```

- [ ] **Step 4: Correr y confirmar que pasa**

Run: `docker-compose exec api pytest backend/tests/production/test_error_message_formatting.py -v`
Expected: PASS

- [ ] **Step 5: Correr toda la suite de producción (nada se rompió)**

Run: `docker-compose exec api pytest backend/tests/production -q`
Expected: todos los tests existentes en verde (algún test viejo podría
buscar el string exacto con ceros — si falla, es ese test el desactualizado,
ajustarlo al nuevo formato, no revertir el fix).

- [ ] **Step 6: Commit**

```bash
git add backend/modules/production/service.py backend/tests/production/test_error_message_formatting.py
git commit -m "$(cat <<'EOF'
fix(production): quita ceros decimales de sobra en mensajes de error

shortage_message, update_acta_line, finish_stage y edit_stage_weight
interpolaban Decimal directo (columnas Numeric(14,4), siempre 4
decimales) -- "no puede ser mayor que el material en proceso
(400.0000 g)" en vez de "(400 g)". Usa format_qty en los 4 lugares.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Aplicar en `inventory/service.py`

**Files:**
- Modify: `backend/modules/inventory/service.py:243-253` (reclasificación)
- Test: `backend/tests/inventory/test_reclassify_error_formatting.py`

**Interfaces:**
- Consumes: `format_qty` de Task 1.

- [ ] **Step 1: Leer el metodo completo antes de escribir el test**

Leer `backend/modules/inventory/service.py` alrededor de la línea 220-255
(el método que reclasifica stock) para confirmar el nombre exacto del
método público y sus parámetros — no está cubierto en el resto de este plan
y el test debe llamarlo con la firma real.

- [ ] **Step 2: Escribir el test que falla**

Basar el test en un fixture existente de `backend/tests/inventory/conftest.py`
que cree dos `InventoryItem` con el mismo `unit_code`, uno con
`current_stock` bajo (ej. `Decimal("10.5000")`), y llamar al método de
reclasificación pidiendo más de lo disponible. Confirmar:

```python
message = str(exc_info.value)
assert "10.5 " in message
assert "10.5000" not in message
```

(Ajustar el nombre del método/payload exacto a lo que arroje el Step 1 —
seguir el mismo patrón que otros tests de `backend/tests/inventory/`.)

- [ ] **Step 3: Correr y confirmar que falla**

Run: `docker-compose exec api pytest backend/tests/inventory/test_reclassify_error_formatting.py -v`
Expected: FAIL por los ceros de sobra.

- [ ] **Step 4: Implementar**

Agregar el import:

```python
from backend.modules.shared.formatting import format_qty
```

Y en el mensaje (línea ~244-246 y ~250-253):

```python
        if target_item.unit_code != source_item.unit_code:
            raise InventoryDomainError(
                f"No se puede reclasificar: unidades distintas ({source_item.unit_code} vs {target_item.unit_code})."
            )

        move_quantity = quantity if quantity is not None else movement.quantity
        if move_quantity > source_item.current_stock:
            raise InventoryDomainError(
                f"Solo quedan {format_qty(source_item.current_stock)} {source_item.unit_code} de "
                f'"{source_item.name}" para reclasificar.'
            )
```

- [ ] **Step 5: Correr y confirmar que pasa**

Run: `docker-compose exec api pytest backend/tests/inventory/test_reclassify_error_formatting.py -v`
Expected: PASS

- [ ] **Step 6: Correr toda la suite de inventario**

Run: `docker-compose exec api pytest backend/tests/inventory -q`
Expected: todos en verde.

- [ ] **Step 7: Commit**

```bash
git add backend/modules/inventory/service.py backend/tests/inventory/test_reclassify_error_formatting.py
git commit -m "$(cat <<'EOF'
fix(inventory): quita ceros decimales de sobra en error de reclasificar

Mismo patron que production (ver commit anterior): Decimal de
Numeric(14,4) interpolado directo en el mensaje de "Solo quedan X
para reclasificar". Usa format_qty.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Verificación final del plan

- [ ] **Step 1: Suite completa**

Run: `docker-compose exec api pytest`
Expected: todos los tests en verde.

- [ ] **Step 2: Volver al plan maestro**

Marcar el checkbox de este plan en
`docs/superpowers/plans/2026-08-16-acta-bugs-master.md` y abrir el siguiente
plan de la lista (Notificaciones con estilo ToastNotice) sin esperar
confirmación adicional.
