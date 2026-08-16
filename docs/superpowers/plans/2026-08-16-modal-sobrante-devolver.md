# Modal "Sobrante por Devolver" al Finalizar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Al finalizar la última etapa de una orden `ENSAMBLAR`, el modal
"Sobrante por devolver" nunca ofrece complementos para devolver, aunque
sobren — porque `remaining` se calculaba como `aprobado - usado_por_ensamble
- devuelto`, y el ensamble automático (`_auto_apply_assembly`) marca el 100%
de lo aprobado como "usado" justo antes de que ese cálculo corra, dejando
`remaining` en 0 o negativo siempre. Además el texto del modal da a entender
que "algunos complementos no se usaron" en vez de invitar a revisar/devolver
sobrante en general.

**Regla de negocio confirmada por Rodrigo (2026-08-16):** nada se marca como
"usado" de forma independiente. `usado = aprobado - devuelto`, siempre, sin
importar en qué momento del proceso se registra la devolución (puede ser a
mitad de una etapa o al final, da igual). El "sobrante disponible para
devolver" de un complemento es simplemente `quantity - returned_quantity` —
`assembly_items`/`used_quantity` no debe intervenir en ese cálculo en
absoluto. `assembly_items` sigue existiendo para aprender la receta de
ensamble (`AssemblyRecipe`), pero deja de gatear si un complemento puede
devolverse.

**Architecture:** Dos cálculos de "remaining" que hoy usan la misma fórmula
rota, uno en backend (autoridad real, valida el movimiento de inventario) y
uno en frontend (decide qué mostrar en la lista de candidatos) — se
corrigen los dos para que dejen de leer `used`/`used_quantity`. Un cambio de
copy en el modal. Nada de esto requiere tocar `_auto_apply_assembly` ni
reordenar cuándo se aplica el ensamble — el fix es puramente en la fórmula
de "cuánto se puede devolver".

**Tech Stack:** Python/FastAPI (backend), TypeScript/React (frontend), pytest.

## Global Constraints

- No tocar `_auto_apply_assembly` ni el momento en que se llama desde
  `_finish_run` — sigue aplicando el 100% de lo aprobado (menos lo ya
  devuelto) al ensamble, eso no cambió con la aclaración de Rodrigo. Lo
  único que cambia es que ese "usado por ensamble" deja de restar en el
  cálculo de sobrante disponible para devolver.
- `used_quantity` (el campo, en `ProductionComplementRequest`/
  `ComplementRead`) NO se elimina del schema — sigue poblándose igual desde
  `assembly_items` en `_attach_plan_names`, por si algún reporte futuro lo
  necesita como dato informativo. Solo deja de usarse en la fórmula de
  `remaining`.
- Español-first: el nuevo texto del modal lo da este plan textual, no
  inventar otra redacción.

---

### Task 1: Backend — `return_complement` ignora `used`

**Files:**
- Modify: `backend/modules/production/service.py:2428-2453`
- Test: `backend/tests/production/test_assembly_auto_apply.py`

**Interfaces:**
- Consumes: `format_qty` de `backend.modules.shared.formatting` (del plan
  [Formato de decimales](2026-08-16-formato-decimales-errores.md) — si ese
  plan ya corrió, el import ya existe en este archivo; si no, agregarlo acá
  también, es idempotente).

- [ ] **Step 1: Escribir el test que falla**

Agregar al final de `backend/tests/production/test_assembly_auto_apply.py`
(ya tiene el fixture completo para crear una orden `ENSAMBLAR`, aprobar,
iniciar y terminar — ver `test_finish_run_auto_applies_assembly_from_approved_complements`
en ese mismo archivo para el patrón exacto):

```python
from backend.modules.production.schemas import ComplementReturnCreate


def test_return_complement_ignores_what_assembly_marked_as_used(
    db_session, production_service, current_user, process, raw_material, complement_item, catalog_finished_item,
):
    """Rodrigo (2026-08-16): nada se marca 'usado' de forma independiente --
    usado = aprobado - devuelto, siempre. _auto_apply_assembly marca el 100%
    de lo aprobado como assembly_items al terminar la corrida (ver el test
    de arriba); si esa marca restara en 'remaining', devolver cualquier cosa
    despues de terminar la produccion seria imposible (remaining ya en 0)."""
    raw_material.current_stock = Decimal("1000")
    complement_item.current_stock = Decimal("1000")
    db_session.flush()

    payload = ProductionRunCreate(
        process_id=process.id,
        raw_material_item_id=raw_material.id,
        quantity=Decimal("100"),
        assembly_mode="ENSAMBLAR",
        products=[RunProductCreate(target_item_id=catalog_finished_item.id, quantity=Decimal("100"))],
        complements=[RunComplementCreate(item_id=complement_item.id, quantity=Decimal("5"))],
    )
    run_read = production_service.create_run(payload, current_user)
    production_service.approve_materials(run_read.id, current_user)
    production_service.start_run(run_read.id, current_user)
    run = production_service.repository.get_run(run_read.id)

    finished = production_service.finish_stage(
        run.stages[0].id, ProductionRunStageFinish(final_weight=Decimal("95")), current_user
    )
    # El ensamble automatico ya marco los 5 aprobados como "usados".
    assert finished.assembly_items[0].quantity == Decimal("5")

    complement_id = finished.complements[0].id
    updated = production_service.return_complement(
        complement_id, ComplementReturnCreate(quantity=Decimal("2")), current_user
    )

    returned_complement = next(c for c in updated.complements if c.id == complement_id)
    assert returned_complement.returned_quantity == Decimal("2")


def test_return_complement_still_caps_at_approved_minus_returned(
    db_session, production_service, current_user, process, raw_material, complement_item, catalog_finished_item,
):
    """El tope sigue existiendo -- solo deja de contar lo 'usado' por el
    ensamble. No se puede devolver mas de lo aprobado menos lo ya devuelto."""
    raw_material.current_stock = Decimal("1000")
    complement_item.current_stock = Decimal("1000")
    db_session.flush()

    payload = ProductionRunCreate(
        process_id=process.id,
        raw_material_item_id=raw_material.id,
        quantity=Decimal("100"),
        assembly_mode="ENSAMBLAR",
        products=[RunProductCreate(target_item_id=catalog_finished_item.id, quantity=Decimal("100"))],
        complements=[RunComplementCreate(item_id=complement_item.id, quantity=Decimal("5"))],
    )
    run_read = production_service.create_run(payload, current_user)
    production_service.approve_materials(run_read.id, current_user)
    production_service.start_run(run_read.id, current_user)
    run = production_service.repository.get_run(run_read.id)
    finished = production_service.finish_stage(
        run.stages[0].id, ProductionRunStageFinish(final_weight=Decimal("95")), current_user
    )
    complement_id = finished.complements[0].id

    with pytest.raises(ProductionDomainError, match="Solo quedan 5"):
        production_service.return_complement(
            complement_id, ComplementReturnCreate(quantity=Decimal("6")), current_user
        )
```

- [ ] **Step 2: Correr y confirmar que falla**

Run: `docker-compose exec api pytest backend/tests/production/test_assembly_auto_apply.py -v`
Expected: `test_return_complement_ignores_what_assembly_marked_as_used` FALLA
con `ProductionDomainError: Solo quedan 0 und de sobrante para devolver.`
(porque `remaining = 5 - 5(usado) - 0 = 0`). El segundo test también puede
fallar por el mismo motivo (mensaje "Solo quedan 0" en vez de "Solo quedan
5").

- [ ] **Step 3: Implementar**

Ubicar en `backend/modules/production/service.py` (línea 2428-2453):

```python
    def return_complement(
        self, complement_id: UUID, payload: ComplementReturnCreate, current_user: CurrentUser
    ) -> ProductionRunRead:
        """Devuelve a inventario el sobrante de un complemento aprobado: se
        desconto entero al aprobar (approve_materials), pero el ensamble puede
        no haber usado todo (ej. 100 'bolas 2.5' aprobadas, 80 ensambladas,
        20 sobran). Genera un movimiento DEVOLUCION_PRODUCCION real y una
        linea AUTO en la acta, lado RECEPCION."""
        if self.inventory_service is None:
            raise ProductionDomainError("Inventario no esta disponible para devolver el sobrante.")
        complement = self.repository.get_complement_request(complement_id)
        if complement is None:
            raise ProductionNotFoundError("Complemento no encontrado.")
        if complement.status != ComplementRequestStatus.APPROVED:
            raise ProductionDomainError("Solo se puede devolver un complemento ya aprobado (descontado de inventario).")

        run = complement.run
        remaining = complement.quantity - complement.returned_quantity
        if payload.quantity > remaining:
            raise ProductionDomainError(
                f"Solo quedan {format_qty(remaining)} {complement.unit_code} de sobrante para devolver."
            )
```

(el resto del método, desde `from backend.modules.inventory.models import
InventoryItem` en adelante, no cambia.)

Si el import `from backend.modules.shared.formatting import format_qty`
todavía no existe en este archivo (el plan de formato de decimales no
corrió antes que este), agregarlo junto a los demás imports de módulo.

- [ ] **Step 4: Correr y confirmar que pasa**

Run: `docker-compose exec api pytest backend/tests/production/test_assembly_auto_apply.py -v`
Expected: PASS (los 2 tests nuevos + los 3 ya existentes en ese archivo).

- [ ] **Step 5: Correr toda la suite de producción**

Run: `docker-compose exec api pytest backend/tests/production -q`
Expected: todos en verde.

- [ ] **Step 6: Commit**

```bash
git add backend/modules/production/service.py backend/tests/production/test_assembly_auto_apply.py
git commit -m "$(cat <<'EOF'
fix(production): devolver complemento ya no lo bloquea el ensamble automatico

return_complement calculaba 'remaining' como aprobado - usado_por_
ensamble - devuelto. _auto_apply_assembly marca el 100% de lo aprobado
como usado al terminar la corrida (ENSAMBLAR), asi que remaining
quedaba en 0 o negativo siempre despues de finalizar -- imposible
devolver sobrante en la ventana de confirmacion (bug reportado).
Decision de Rodrigo: nada se marca "usado" de forma independiente,
usado = aprobado - devuelto, sin importar cuando se registra la
devolucion. assembly_items sigue existiendo para aprender la receta,
pero deja de gatear si un complemento puede devolverse.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Frontend — `returnableComplements` ignora `used_quantity`

**Files:**
- Modify: `frontend/components/production/acta-view.tsx:118-126`

**Interfaces:**
- Ninguna nueva — mismo tipo de retorno.

- [ ] **Step 1: Ubicar el código actual**

```ts
// Complementos aprobados con sobrante por devolver (aprobado - usado en
// ensamble - ya devuelto > 0). Se usa tanto dentro de la acta como en el
// paso automatico al terminar la produccion (ver production-dashboard.tsx).
export function returnableComplements(run: ProductionRun): Array<Complement & { remaining: number }> {
  return (run.complements ?? [])
    .filter((c) => c.status === "APROBADA")
    .map((c) => ({
      ...c,
      remaining: Number(c.quantity) - Number(c.used_quantity ?? 0) - Number(c.returned_quantity ?? 0),
    }))
    .filter((c) => c.remaining > 0.0001);
}
```

- [ ] **Step 2: Reemplazar**

```ts
// Complementos aprobados con sobrante por devolver (aprobado - devuelto >
// 0). Se usa tanto dentro de la acta como en el paso automatico al terminar
// la produccion (ver production-dashboard.tsx). Nada se marca "usado" de
// forma independiente (decision de Rodrigo, 2026-08-16): used_quantity
// viene del ensamble automatico, que al terminar la corrida marca el 100%
// de lo aprobado como usado -- si eso restara aqui, remaining quedaria en 0
// justo cuando el usuario recien puede declarar el sobrante.
export function returnableComplements(run: ProductionRun): Array<Complement & { remaining: number }> {
  return (run.complements ?? [])
    .filter((c) => c.status === "APROBADA")
    .map((c) => ({
      ...c,
      remaining: Number(c.quantity) - Number(c.returned_quantity ?? 0),
    }))
    .filter((c) => c.remaining > 0.0001);
}
```

- [ ] **Step 3: Type-check**

Run: `docker-compose exec web npm run build`
Expected: `Compiled successfully`.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/production/acta-view.tsx
git commit -m "$(cat <<'EOF'
fix(production): returnableComplements ya no descuenta used_quantity

Mismo fix que el commit de backend (return_complement) del lado del
frontend: la lista de candidatos a devolver usaba aprobado -
used_quantity - devuelto, y used_quantity (del ensamble automatico)
llegaba al 100% apenas terminaba la corrida, dejando la lista siempre
vacia para ordenes ENSAMBLAR. Ahora es aprobado - devuelto.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Copy del modal post-finalización

**Files:**
- Modify: `frontend/components/production/production-dashboard.tsx:4246-4255`

**Interfaces:** Ninguna — solo texto.

- [ ] **Step 1: Ubicar el código actual**

```tsx
      {postFinishReturnRun ? (
        <div className="modalBackdrop modalBackdropTop" role="dialog" aria-modal="true" aria-label="Sobrante por devolver">
          <section className="modalWindow">
            <div className="modalHeader">
              <div>
                <h2>Sobrante por devolver</h2>
                <p>
                  {postFinishReturnRun.production_code ?? postFinishReturnRun.process_name} quedó con complementos
                  o insumos que no se usaron enteros. Devuélvelos ahora o continúa — es opcional, se puede hacer
                  después desde la acta.
                </p>
              </div>
```

- [ ] **Step 2: Reemplazar el texto del subtítulo**

```tsx
      {postFinishReturnRun ? (
        <div className="modalBackdrop modalBackdropTop" role="dialog" aria-modal="true" aria-label="Sobrante por devolver">
          <section className="modalWindow">
            <div className="modalHeader">
              <div>
                <h2>Sobrante por devolver</h2>
                <p>
                  Revisa y devuelve los complementos o insumos de sobra de{" "}
                  {postFinishReturnRun.production_code ?? postFinishReturnRun.process_name}. Es opcional, se puede
                  hacer después desde la acta.
                </p>
              </div>
```

- [ ] **Step 3: Type-check**

Run: `docker-compose exec web npm run build`
Expected: `Compiled successfully`.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/production/production-dashboard.tsx
git commit -m "$(cat <<'EOF'
fix(production): aclara el texto del modal de sobrante al finalizar

"Quedo con complementos o insumos que no se usaron enteros" daba a
entender que algo salio mal. Nuevo texto invita directamente a
revisar/devolver, sin implicar un error (pedido de Rodrigo).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Peso del lote recibido descuenta lo devuelto

> Agregado tras confirmar con Rodrigo (2026-08-16): la receta de ensamble
> (`AssemblyRecipe`) ya no maneja pesos, no hay que tocarla. Pero el PESO
> DEL LOTE recibido si debe descontar la devolucion -- ejemplo suyo: 100g de
> plata + 10g de dijes para cadenas; si se devuelven 5g de dijes, el
> producto final pesa 100g + 5g, no 100g + 10g. Hoy `extra_grams_per_unit`
> en `receive_finished_product` usa `run.assembly_items[].quantity` (el
> 100% que el ensamble marco), sin restar `complement.returned_quantity` --
> mismo patron de bug que las Tasks 1 y 2 de este plan, en un tercer lugar
> que tambien lee esa cantidad.

**Files:**
- Modify: `backend/modules/production/service.py:2806-2835` (bloque de
  `extra_grams` dentro de `receive_finished_product`)
- Test: `backend/tests/production/test_assembly_auto_apply.py`

**Interfaces:**
- Ninguna nueva.

- [ ] **Step 1: Escribir el test que falla**

Numeros calcados del ejemplo de Rodrigo (100g materia prima, complemento a
1g/unidad, 10 aprobadas, 5 devueltas -> peso extra real = 5g, no 10g).
Agregar a `backend/tests/production/test_assembly_auto_apply.py`:

```python
from backend.modules.inventory.models import InventoryItem
from backend.modules.production.schemas import ComplementReturnCreate


def test_receive_extra_grams_discounts_returned_complement(
    db_session, production_service, current_user, process, raw_material, complement_item, catalog_finished_item,
):
    """Rodrigo (2026-08-16): 100g de plata + 10g de dijes -- si se
    devuelven 5g de dijes ANTES de recibir, el producto final debe pesar
    100g + 5g, no 100g + 10g. extra_grams_per_unit hoy suma
    assembly_items[].quantity (el 100% marcado por el ensamble automatico),
    sin restar complement.returned_quantity -- mismo patron de bug que
    return_complement (Task 1) y returnableComplements (Task 2), en un
    tercer lugar que tambien necesita 'usado = aprobado - devuelto'."""
    raw_material.current_stock = Decimal("1000")
    complement_item.current_stock = Decimal("1000")
    complement_item.weight_per_unit = Decimal("1")
    db_session.flush()

    payload = ProductionRunCreate(
        process_id=process.id,
        raw_material_item_id=raw_material.id,
        quantity=Decimal("100"),
        assembly_mode="ENSAMBLAR",
        products=[RunProductCreate(target_item_id=catalog_finished_item.id, quantity=Decimal("100"))],
        complements=[RunComplementCreate(item_id=complement_item.id, quantity=Decimal("10"))],
    )
    run_read = production_service.create_run(payload, current_user)
    production_service.approve_materials(run_read.id, current_user)
    production_service.start_run(run_read.id, current_user)
    run = production_service.repository.get_run(run_read.id)
    finished = production_service.finish_stage(
        run.stages[0].id, ProductionRunStageFinish(final_weight=Decimal("100")), current_user
    )
    # El ensamble automatico marco los 10 aprobados como "usados".
    assert finished.assembly_items[0].quantity == Decimal("10")

    complement_id = finished.complements[0].id
    production_service.return_complement(
        complement_id, ComplementReturnCreate(quantity=Decimal("5")), current_user
    )

    production_service.receive_finished_product(run.id, current_user)

    target = db_session.get(InventoryItem, catalog_finished_item.id)
    # weight_per_unit de la orden = total_required_material(100) / quantity(100) = 1 g/und.
    # extra_grams_per_unit correcto = (10 aprobado - 5 devuelto) / 100 = 0.05 g/und.
    # peso total por unidad = 1 + 0.05 = 1.05 -> 100 unidades convertidas = 105g.
    # Con el bug (sin restar lo devuelto): 1 + 0.10 = 1.10 -> 110g.
    assert target.current_stock == Decimal("105")
```

- [ ] **Step 2: Correr y confirmar que falla**

Run: `docker-compose exec api pytest backend/tests/production/test_assembly_auto_apply.py::test_receive_extra_grams_discounts_returned_complement -v`
Expected: FAIL -- `assert Decimal('110') == Decimal('105')` (o el valor que
resulte; el punto es que da MAS de 105, porque hoy no resta lo devuelto).

- [ ] **Step 3: Implementar**

Ubicar en `backend/modules/production/service.py` (linea 2806-2835):

```python
        assembly_note = None
        extra_grams_per_unit = None
        if run.assembly_mode == AssemblyMode.ASSEMBLE and run.assembly_items:
            from sqlalchemy import select

            item_ids = [entry.complement_item_id for entry in run.assembly_items]
            rows = self.repository.session.execute(
                select(InventoryItem).where(InventoryItem.id.in_(item_ids))
            ).all()
            complements = {row[0].id: row[0] for row in rows}
            names = {item_id: item.name for item_id, item in complements.items()}
            assembly_note = " + ".join(
                names.get(entry.complement_item_id, "complemento") for entry in run.assembly_items
            )
            # El ensamblado pesa lote + complementos: si el complemento se
            # mide en gramos, suma su cantidad total; si es por unidad con
            # peso_por_unidad conocido, suma cantidad x peso; sin dato de
            # peso no se inventa, no aporta.
            extra_grams = Decimal("0")
            for entry in run.assembly_items:
                item = complements.get(entry.complement_item_id)
                if item is None:
                    continue
                if item.unit_code == "g":
                    extra_grams += entry.quantity
                elif item.weight_per_unit:
                    extra_grams += entry.quantity * item.weight_per_unit
            if run.quantity and extra_grams > 0:
```

Reemplazar por:

```python
        assembly_note = None
        extra_grams_per_unit = None
        if run.assembly_mode == AssemblyMode.ASSEMBLE and run.assembly_items:
            from sqlalchemy import select

            item_ids = [entry.complement_item_id for entry in run.assembly_items]
            rows = self.repository.session.execute(
                select(InventoryItem).where(InventoryItem.id.in_(item_ids))
            ).all()
            complements = {row[0].id: row[0] for row in rows}
            names = {item_id: item.name for item_id, item in complements.items()}
            assembly_note = " + ".join(
                names.get(entry.complement_item_id, "complemento") for entry in run.assembly_items
            )
            # Lo devuelto (Rodrigo, 2026-08-16: "si se devuelven 5g de
            # dijes, el producto final pesa 100g + 5g, no 100g + 10g") resta
            # ACA tambien -- mismo criterio "usado = aprobado - devuelto"
            # que return_complement y returnableComplements, para que el
            # peso real del lote en inventario no cuente material que ya
            # volvio al estante.
            returned_by_item: dict = {}
            for complement in run.complements:
                returned_by_item[complement.item_id] = (
                    returned_by_item.get(complement.item_id, Decimal("0")) + complement.returned_quantity
                )
            # El ensamblado pesa lote + complementos: si el complemento se
            # mide en gramos, suma su cantidad total; si es por unidad con
            # peso_por_unidad conocido, suma cantidad x peso; sin dato de
            # peso no se inventa, no aporta.
            extra_grams = Decimal("0")
            for entry in run.assembly_items:
                item = complements.get(entry.complement_item_id)
                if item is None:
                    continue
                net_quantity = max(
                    Decimal("0"), entry.quantity - returned_by_item.get(entry.complement_item_id, Decimal("0"))
                )
                if item.unit_code == "g":
                    extra_grams += net_quantity
                elif item.weight_per_unit:
                    extra_grams += net_quantity * item.weight_per_unit
            if run.quantity and extra_grams > 0:
```

(El resto del bloque, desde el siguiente `extra_grams_per_unit = ...` en
adelante, no cambia.)

- [ ] **Step 4: Correr y confirmar que pasa**

Run: `docker-compose exec api pytest backend/tests/production/test_assembly_auto_apply.py -v`
Expected: PASS (el nuevo test + los ya existentes en ese archivo).

- [ ] **Step 5: Correr toda la suite de producción**

Run: `docker-compose exec api pytest backend/tests/production -q`
Expected: todos en verde.

- [ ] **Step 6: Commit**

```bash
git add backend/modules/production/service.py backend/tests/production/test_assembly_auto_apply.py
git commit -m "$(cat <<'EOF'
fix(production): peso del lote recibido descuenta el complemento devuelto

extra_grams_per_unit (receive_finished_product) sumaba el 100% de
run.assembly_items sin restar complement.returned_quantity -- mismo
patron de bug que return_complement y returnableComplements (tasks
anteriores de este plan), en un tercer lugar que lee la misma
cantidad. Confirmado con Rodrigo: si se devuelven 5g de un complemento
de 10g aprobados, el producto final debe pesar +5g, no +10g. Mismo
criterio "usado = aprobado - devuelto" aplicado aca tambien.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Verificación manual end-to-end del flujo completo

- [ ] **Step 1: Suite backend completa**

Run: `docker-compose exec api pytest`
Expected: todos los tests en verde.

- [ ] **Step 2: Build frontend completo**

Run: `docker-compose exec web npm run build`
Expected: `Compiled successfully`.

- [ ] **Step 3: Verificación manual en navegador — el caso exacto que reportó Rodrigo**

1. Crear una orden `ENSAMBLAR` con materia prima + un complemento (ej. 100
   unidades aprobadas).
2. Iniciar y avanzar hasta la última etapa SIN devolver nada del
   complemento en el camino.
3. Finalizar la última etapa. Confirmar que aparece el modal "Sobrante por
   devolver" con el nuevo texto, y que el complemento SÍ aparece en la
   lista con 100 unidades disponibles (antes no aparecía).
4. Devolver una parte (ej. 30) y confirmar que el acta registra la línea
   "Devolución: <complemento>" con 30, y que si se abre "Devolver sobrante"
   de nuevo más tarde desde Ver Acta, el sobrante restante es 70 (no 0 ni
   negativo).
5. Repetir el caso con una orden donde SÍ se devuelve algo de complemento
   ANTES de finalizar (mid-proceso, vía "Devolver sobrante" en Ver Acta) —
   confirmar que el modal final solo ofrece el remanente correcto (aprobado
   menos lo ya devuelto), no vuelve a ofrecer el total original.

- [ ] **Step 4: Volver al plan maestro**

Marcar el checkbox de este plan en
`docs/superpowers/plans/2026-08-16-acta-bugs-master.md` — con esto los 4
planes están completos. Reportar a Rodrigo el resumen final (qué se hizo,
qué se verificó) y dejar de trabajar hasta que él pruebe en el sistema real.
