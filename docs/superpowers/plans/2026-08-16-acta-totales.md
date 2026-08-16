# Totales del Acta (Total Entregado / Total Recibido) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "Total entregado" y "Total recibido" del acta solo sumaban la
línea de materia prima (por `item_id`), ignorando complementos que
comparten la misma unidad — Rodrigo entregó 400g de materia prima + 405g de
complemento y el total mostró 400g en vez de 805g. Además "Total recibido"
se calculaba como `entregado - merma` sin considerar devoluciones, por lo
que se veía "quemado" (no cambiaba al registrar una devolución). Se
reemplaza la fórmula por la suma literal de las filas que ya se muestran en
cada lado, filtradas a la unidad de la materia prima.

**Architecture:** Un solo archivo de lógica pura
(`frontend/lib/orden-produccion.ts`), función `computeRunTotals`. Sin
componentes nuevos, sin cambios de backend — todos los datos que hacen
falta (`acta_lines`, `stages`, productos reales) ya llegan en `ProductionRun`.

**Tech Stack:** TypeScript puro, sin dependencias nuevas.

## Global Constraints

- No hay test runner en frontend — verificación vía `docker-compose exec
  web npm run build` + revisión manual en navegador (mismo criterio que el
  plan de notificaciones).
- `buildRunActaSides` y `buildFamilyActaSides` son la ÚNICA fuente para Ver
  Acta y Documentos (comentario ya en el código: "así no pueden divergir de
  nuevo") — este plan solo toca `computeRunTotals`, que ambas funciones ya
  llaman; no crear una segunda función de totales para la vista de familia.
- No tocar la fila "Merma total" (`kind: "merma"`) — sigue siendo un
  resumen informativo aparte, no se sumó nunca dentro de "Total recibido" y
  eso no cambia.

---

### Task 1: Reescribir `computeRunTotals`

**Files:**
- Modify: `frontend/lib/orden-produccion.ts:97-137`

**Interfaces:**
- Consumes: `productoRealLines`, `realProductsForRun` (ya definidas más
  arriba en el mismo archivo, líneas 55-95).
- Produces: mismo tipo de retorno que antes — `{ entregaTotalRows:
  ActaSideTotal[]; recepcionTotalRows: ActaSideTotal[] }` — no cambia la
  interfaz pública, solo el cálculo interno.

- [ ] **Step 1: Ubicar el código actual**

```ts
function sumByItem(lines: NonNullable<ProductionRun["acta_lines"]>, itemId: string): number {
  return lines.filter((l) => l.item_id === itemId).reduce((sum, l) => sum + num(l.quantity), 0);
}

// Merma total, como fila del propio certificado (no una caja aparte): los
// gramos que entraron a producir NO quedan fijos -- se actualizan segun la
// merma que se va registrando. Por eso la fuente de la merma no es ninguna
// linea de la acta (ni "Merma etapa X" ni el producto resultante, que nace
// con la cantidad PLANEADA al crear la orden y nunca se corrige despues del
// pesaje real): es `stage.waste_weight`, el mismo numero que ya mantiene al
// dia finish_stage/_recompute_stage_waste_chain etapa por etapa. Recibido =
// entregado menos esa merma acumulada; nunca una segunda cuenta aparte que
// termine restando (o sumando) la merma dos veces.
function computeRunTotals(run: ProductionRun): { entregaTotalRows: ActaSideTotal[]; recepcionTotalRows: ActaSideTotal[] } {
  const unit = run.raw_material_unit_code;
  const rawMaterialId = run.raw_material_item_id;
  if (!unit || !rawMaterialId) return { entregaTotalRows: [], recepcionTotalRows: [] };
  // Sin aprobar todavia no hay total que mostrar -- la materia prima PLAN se
  // siembra al crear la orden, asi que sumar por item_id sin este chequeo
  // daba un "Total entregado"/"Total recibido" desde el dia 1, antes de que
  // inventario aprobara nada.
  if (run.materials_approved_at === null) return { entregaTotalRows: [], recepcionTotalRows: [] };
  const lines = run.acta_lines ?? [];
  const entregaTotal = sumByItem(lines.filter((l) => l.side === "ENTREGA"), rawMaterialId);
  if (entregaTotal <= 0) return { entregaTotalRows: [], recepcionTotalRows: [] };
  const mermaAcumulada = run.stages.reduce((sum, stage) => sum + num(stage.waste_weight), 0);
  const recepcionTotalRows: ActaSideTotal[] = [
    { label: "Total recibido", quantity: entregaTotal - mermaAcumulada, unit, kind: "total" },
  ];
  // La fila de merma total solo tiene sentido "al final": finished_at queda
  // seteado en _finish_run sin importar si hubo o no una etapa que pese.
  // Antes de eso el proceso sigue en curso -- lo que "falta" en recibido no
  // es merma todavia, es simplemente material que aun no paso por una etapa.
  if (run.finished_at !== null) {
    recepcionTotalRows.push({ label: "Merma total", quantity: mermaAcumulada, unit, kind: "merma" });
  }
  return {
    entregaTotalRows: [{ label: "Total entregado", quantity: entregaTotal, unit, kind: "total" }],
    recepcionTotalRows,
  };
}
```

- [ ] **Step 2: Reemplazar**

```ts
function sumLinesByUnit(lines: Array<{ unit_code: string; quantity: string }>, unit: string): number {
  return lines.filter((l) => l.unit_code === unit).reduce((sum, l) => sum + num(l.quantity), 0);
}

// Los totales son la suma LITERAL de lo que ya se muestra en cada lado del
// certificado, filtrado a la unidad de la materia prima -- igual que el
// subtotal de cualquier recibo, no una formula aparte que pueda divergir de
// las filas de arriba (bug reportado: "Total entregado" solo sumaba la
// materia prima e ignoraba un complemento en la misma unidad -- 400g+405g
// mostraba 400g). "Total recibido" suma el producto real + las filas RECEPCION
// no-PLAN (devoluciones, merma por etapa) en esa unidad -- por eso SI cambia
// al registrar una devolucion (antes no dependia de eso, se veia "quemado").
function computeRunTotals(run: ProductionRun): { entregaTotalRows: ActaSideTotal[]; recepcionTotalRows: ActaSideTotal[] } {
  const unit = run.raw_material_unit_code;
  const rawMaterialId = run.raw_material_item_id;
  if (!unit || !rawMaterialId) return { entregaTotalRows: [], recepcionTotalRows: [] };
  // Sin aprobar todavia no hay total que mostrar -- la materia prima PLAN se
  // siembra al crear la orden, asi que sumar sin este chequeo daba un
  // "Total entregado"/"Total recibido" desde el dia 1, antes de que
  // inventario aprobara nada.
  if (run.materials_approved_at === null) return { entregaTotalRows: [], recepcionTotalRows: [] };
  const lines = run.acta_lines ?? [];
  const entregaTotal = sumLinesByUnit(lines.filter((l) => l.side === "ENTREGA"), unit);
  if (entregaTotal <= 0) return { entregaTotalRows: [], recepcionTotalRows: [] };

  const mermaAcumulada = run.stages.reduce((sum, stage) => sum + num(stage.waste_weight), 0);
  const productoReal = productoRealLines(realProductsForRun(run), unit).reduce((sum, l) => sum + num(l.quantity), 0);
  const recepcionRowsInUnit = sumLinesByUnit(
    lines.filter((l) => l.side === "RECEPCION" && l.source !== "PLAN"),
    unit
  );
  const recepcionTotal = productoReal + recepcionRowsInUnit;

  const recepcionTotalRows: ActaSideTotal[] = [
    { label: "Total recibido", quantity: recepcionTotal, unit, kind: "total" },
  ];
  // La fila de merma total solo tiene sentido "al final": finished_at queda
  // seteado en _finish_run sin importar si hubo o no una etapa que pese.
  // Antes de eso el proceso sigue en curso -- lo que "falta" en recibido no
  // es merma todavia, es simplemente material que aun no paso por una etapa.
  if (run.finished_at !== null) {
    recepcionTotalRows.push({ label: "Merma total", quantity: mermaAcumulada, unit, kind: "merma" });
  }
  return {
    entregaTotalRows: [{ label: "Total entregado", quantity: entregaTotal, unit, kind: "total" }],
    recepcionTotalRows,
  };
}
```

Nota: `sumByItem` queda sin uso tras este cambio — confirmar en el Step 3 si
algún otro lugar del archivo la sigue llamando; si no, eliminarla (no dejar
código muerto).

- [ ] **Step 3: Confirmar si `sumByItem` sigue en uso**

Run: `grep -n "sumByItem" "frontend/lib/orden-produccion.ts"`
Expected: si la única aparición restante es su propia definición,
eliminarla junto con el cambio del Step 2. Si algo más la llama, dejarla.

- [ ] **Step 4: Type-check**

Run: `docker-compose exec web npm run build`
Expected: `Compiled successfully`, sin errores de tipos.

- [ ] **Step 5: Verificación manual — caso del reporte original**

En el navegador: abrir una orden con materia prima + un complemento
aprobados (misma unidad, ej. gramos) y un insumo en otra unidad (ej.
litros). Abrir "Ver Acta":
- "Total entregado" debe ser la suma de materia prima + complemento (NO
  incluir el insumo en litros).
- Avanzar la orden hasta que tenga alguna devolución de complemento
  registrada (vía "Devolver sobrante") y confirmar que "Total recibido"
  cambia al registrarla (ya no se ve "quemado").
- Confirmar que Documentos (la vista impresa) muestra los mismos totales
  que Ver Acta para la misma orden — ambas comparten `buildRunActaSides`.

- [ ] **Step 6: Commit**

```bash
git add frontend/lib/orden-produccion.ts
git commit -m "$(cat <<'EOF'
fix(production): Total entregado/recibido suman todas las lineas, no solo materia prima

computeRunTotals solo sumaba la linea de materia prima por item_id --
un complemento en la misma unidad quedaba afuera (400g materia prima +
405g complemento mostraba "Total entregado: 400g"). Ahora suma todas
las lineas ENTREGA/RECEPCION que comparten la unidad de la materia
prima, igual que el subtotal de cualquier recibo. Total recibido
tambien pasa a depender de las devoluciones registradas -- antes se
calculaba solo como entregado-merma y se veia "quemado" (reportado
por separado, misma causa).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `buildFamilyActaSides` — mismo fix para órdenes divididas (split)

> Agregado durante la ejecución del plan: `buildFamilyActaSides` (usada
> cuando una orden se partió en `-B`/`-C`, ver `groupRunFamilies`/
> `getRunFamily`) resultó tener su PROPIA copia del cálculo de totales,
> independiente de `computeRunTotals` — el Task 1 no la tocaba y por lo
> tanto el bug seguía vivo para órdenes con split. Mismo fix, generalizado a
> sumar sobre todos los miembros de la familia en vez de un solo run.

**Files:**
- Modify: `frontend/lib/orden-produccion.ts:391-424`

**Interfaces:**
- Consumes: `sumLinesByUnit` (agregada en Task 1, módulo-level, ya en este
  mismo archivo — no reimplementar), `productoRealLines`, `realProductsForRun`,
  `canPrintEntrega`, `num` (todas ya definidas en este archivo).

- [ ] **Step 1: Ubicar el bloque actual dentro de `buildFamilyActaSides`**

```ts
  // Totales entregado/recibido/merma para la familia completa: misma logica
  // que computeRunTotals (arriba) pero sumando todos los miembros -- los
  // gramos que entraron a producir no quedan fijos, se actualizan segun la
  // merma real registrada
  // (stage.waste_weight de cada etapa de cada miembro de la familia), no
  // segun ninguna linea de la acta. No aplica a familias historicas
  // (event_lines, migradas de papel): esas no necesariamente reconciliaban.
  // Sin aprobar todavia no hay total que mostrar -- la materia prima PLAN se
  // siembra al crear la orden, asi que sumar por item_id sin chequear
  // aprobacion daba un total desde el dia 1.
  const rawUnit = root.raw_material_unit_code;
  const rawMaterialId = root.raw_material_item_id;
  const entregaTotalRows: ActaSideTotal[] = [];
  const recepcionTotalRows: ActaSideTotal[] = [];
  if (!isHistorical && rawUnit && rawMaterialId && canPrintEntrega(family)) {
    const entregaTotal = family
      .flatMap((run) => run.acta_lines ?? [])
      .filter((line) => line.side === "ENTREGA" && line.item_id === rawMaterialId)
      .reduce((sum, line) => sum + num(line.quantity), 0);
    if (entregaTotal > 0) {
      const mermaAcumulada = family
        .flatMap((run) => run.stages)
        .reduce((sum, stage) => sum + num(stage.waste_weight), 0);
      entregaTotalRows.push({ label: "Total entregado", quantity: entregaTotal, unit: rawUnit, kind: "total" });
      recepcionTotalRows.push({ label: "Total recibido", quantity: entregaTotal - mermaAcumulada, unit: rawUnit, kind: "total" });
      // "Al final": es UNA sola acta para toda la familia (padre + hijas de
      // split) -- la merma total recien tiene sentido cuando TODAS las
      // corridas activas terminaron su ultima etapa, no apenas una.
      const allFinished = family.every((run) => run.finished_at !== null || run.status === "CANCELADA");
      if (allFinished) {
        recepcionTotalRows.push({ label: "Merma total", quantity: mermaAcumulada, unit: rawUnit, kind: "merma" });
      }
    }
  }

  // Solo aporta cada corrida que ya termino (realProductsForRun devuelve
  // vacio mientras sigue en curso) -- si el padre ya acabo y la hija sigue
  // ESPERANDO_MATERIAL, la familia muestra unicamente lo real del padre, no
  // el plan completo de ambos.
  const recepcionLines: ActaSideLine[] = [
    ...productoRealLines(family.flatMap((run) => realProductsForRun(run)), root.raw_material_unit_code),
    ...recepcionSide.lines,
  ];
```

- [ ] **Step 2: Reemplazar**

```ts
  // Totales entregado/recibido/merma para la familia completa: misma logica
  // que computeRunTotals (arriba, sumLinesByUnit) pero sumando las lineas de
  // TODOS los miembros -- los gramos que entraron a producir no quedan
  // fijos, se actualizan segun la merma real registrada (stage.waste_weight
  // de cada etapa de cada miembro), no segun ninguna linea de la acta. No
  // aplica a familias historicas (event_lines, migradas de papel): esas no
  // necesariamente reconciliaban. Sin aprobar todavia no hay total que
  // mostrar -- la materia prima PLAN se siembra al crear la orden.
  const rawUnit = root.raw_material_unit_code;
  const rawMaterialId = root.raw_material_item_id;
  const familyRealProducts = family.flatMap((run) => realProductsForRun(run));
  const entregaTotalRows: ActaSideTotal[] = [];
  const recepcionTotalRows: ActaSideTotal[] = [];
  if (!isHistorical && rawUnit && rawMaterialId && canPrintEntrega(family)) {
    const familyAllLines = family.flatMap((run) => run.acta_lines ?? []);
    const entregaTotal = sumLinesByUnit(familyAllLines.filter((line) => line.side === "ENTREGA"), rawUnit);
    if (entregaTotal > 0) {
      const mermaAcumulada = family
        .flatMap((run) => run.stages)
        .reduce((sum, stage) => sum + num(stage.waste_weight), 0);
      const familyProductoReal = productoRealLines(familyRealProducts, rawUnit).reduce(
        (sum, l) => sum + num(l.quantity), 0
      );
      const familyRecepcionInUnit = sumLinesByUnit(
        familyAllLines.filter((line) => line.side === "RECEPCION" && line.source !== "PLAN"),
        rawUnit
      );
      entregaTotalRows.push({ label: "Total entregado", quantity: entregaTotal, unit: rawUnit, kind: "total" });
      recepcionTotalRows.push({
        label: "Total recibido",
        quantity: familyProductoReal + familyRecepcionInUnit,
        unit: rawUnit,
        kind: "total",
      });
      // "Al final": es UNA sola acta para toda la familia (padre + hijas de
      // split) -- la merma total recien tiene sentido cuando TODAS las
      // corridas activas terminaron su ultima etapa, no apenas una.
      const allFinished = family.every((run) => run.finished_at !== null || run.status === "CANCELADA");
      if (allFinished) {
        recepcionTotalRows.push({ label: "Merma total", quantity: mermaAcumulada, unit: rawUnit, kind: "merma" });
      }
    }
  }

  // Solo aporta cada corrida que ya termino (realProductsForRun devuelve
  // vacio mientras sigue en curso) -- si el padre ya acabo y la hija sigue
  // ESPERANDO_MATERIAL, la familia muestra unicamente lo real del padre, no
  // el plan completo de ambos.
  const recepcionLines: ActaSideLine[] = [
    ...productoRealLines(familyRealProducts, root.raw_material_unit_code),
    ...recepcionSide.lines,
  ];
```

(Nota: `familyRealProducts` se calcula una sola vez y se reutiliza en el
bloque de totales y en `recepcionLines` — antes `family.flatMap((run) =>
realProductsForRun(run))` se llamaba dos veces con el mismo resultado.)

- [ ] **Step 3: Type-check**

Run: `docker-compose exec web npm run build`
Expected: `Compiled successfully`.

- [ ] **Step 4: Verificación manual — caso de orden dividida**

En el navegador: abrir Producción → una orden que se haya partido por falta
de stock (folio raíz + sufijo `-B`, ver `OP-2026-XXXX-B` en la lista) donde
tanto el padre como la hija tengan materia prima + complemento entregados.
Abrir "Ver Acta" desde cualquiera de las dos corridas (debe mostrar la
familia sumada, encabezado con el folio raíz) y confirmar que "Total
entregado" suma materia prima + complemento de AMBAS corridas, no solo la
materia prima. Repetir en Documentos para la misma orden (debe coincidir
exactamente con Ver Acta).

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/orden-produccion.ts
git commit -m "$(cat <<'EOF'
fix(production): totales del acta tambien se arreglan para ordenes con split

buildFamilyActaSides (familias con split, folio raiz + -B/-C) tenia su
propia copia del calculo de totales, independiente de computeRunTotals
-- el fix anterior (mismo bug, orden sin split) no la cubria. Mismo
fix generalizado: suma por unidad sobre las lineas de TODOS los
miembros de la familia, no solo la materia prima de cada corrida por
separado.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Verificación final del plan

- [ ] **Step 1: Build completo**

Run: `docker-compose exec web npm run build`
Expected: `Compiled successfully`.

- [ ] **Step 2: Volver al plan maestro**

Marcar el checkbox de este plan en
`docs/superpowers/plans/2026-08-16-acta-bugs-master.md` y abrir el siguiente
plan de la lista (Modal "Sobrante por devolver") sin esperar confirmación
adicional.
