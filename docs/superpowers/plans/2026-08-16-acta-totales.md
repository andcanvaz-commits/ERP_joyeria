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

### Task 3: "Total recibido" resta devoluciones del entregado, no las suma al producto

> Agregado tras reporte real de Rodrigo (2026-08-16, orden OP-2026-0045):
> entregó 400g materia prima + 400g complemento (Total entregado 800g,
> correcto), devolvió 200 del complemento, merma de etapa 0,10g. El acta
> mostró "Total recibido: 600,00g" -- Rodrigo esperaba 599,90g. Causa: la
> formula de Task 1/2 sumaba `producto_real + fila_devolucion +
> fila_merma_etapa` -- la merma se contaba DOS veces (una ya implicita en
> `producto_real`, que nace de `actual_finished_weight` neto de merma, y
> otra vez sumando la fila "Merma Etapa 2"). Ademas, confirmado
> explicitamente por Rodrigo: el lado recibido debe sumar lo REALMENTE
> USADO de cada complemento/insumo devuelto (aprobado - devuelto), no el
> monto devuelto en si -- con devolucion simetrica (200 de 400, uso 200)
> ambas lecturas casualmente dan el mismo numero, por eso el reporte no lo
> distinguia solo; se confirmo con Rodrigo usando un caso hipotetico
> asimetrico (devolver 150 de 400 -> uso 250) antes de escribir este fix.
>
> La formula que cumple TODO a la vez (merma fuera del total, y
> devoluciones descontadas como "usado", no sumadas como "devuelto") es una
> identidad algebraica:
>
> ```text
> Total entregado - merma - devoluciones
>   = (materia_prima_entregada + complementos_entregados) - merma - devuelto
>   = (materia_prima_entregada - merma) + (complementos_entregados - devuelto)
>   = producto_real + usado
> ```
>
> Restar las devoluciones del `entregaTotal` (en vez de sumarlas al
> `producto_real`) da matematicamente el mismo resultado que "producto_real
> + usado", para CUALQUIER split (simetrico o no) -- y de paso ya no hace
> falta seguir sumando "producto_real" ni las filas de merma dentro del
> calculo del total en absoluto: alcanza con `entregaTotal - merma -
> devoluciones`, todos numeros que ya se calculan.
>
> Falta distinguir "linea de devolucion real" (complemento/insumo, hay que
> restarla) de "linea de merma por etapa" o "Peso final recibido" (materia
> prima, NO hay que restarla -- esas dos ya estan implicitas en
> `entregaTotal - merma`). La senal robusta -- ninguna es por texto de
> label, que es fragil -- es `item_id`: las lineas de merma por etapa y
> "Peso final recibido" siempre llevan `item_id === rawMaterialId` (la
> materia prima); las devoluciones de complemento/insumo llevan el
> `item_id` de ESE complemento/insumo, nunca el de la materia prima.

**Files:**
- Modify: `frontend/lib/orden-produccion.ts:109-144` (`computeRunTotals`)
- Modify: `frontend/lib/orden-produccion.ts:391-433` (bloque de totales en `buildFamilyActaSides`)

**Interfaces:**
- Ninguna nueva. `productoRealLines`/`realProductsForRun` siguen usandose
  para las FILAS mostradas (`recepcionLines`), solo dejan de usarse para
  calcular el TOTAL.

- [ ] **Step 1: Escribir el test que falla — reproduce el reporte real de Rodrigo**

Este proyecto no tiene test runner de frontend (confirmado en planes
anteriores). En su lugar, agregar un caso de verificacion manual EXACTO al
reporte real, para correrlo en el navegador en el Step 5 -- y de forma
inmediata, verificar la funcion a mano con un script node/ts-node si esta
disponible en el contenedor `web`, o razonando la aritmetica linea por
linea contra el codigo actual, ANTES de tocar nada, para confirmar que hoy
da 600,00 y no 599,90 (documentarlo en el reporte).

- [ ] **Step 2: Ubicar el código actual de `computeRunTotals`**

```ts
function computeRunTotals(run: ProductionRun): { entregaTotalRows: ActaSideTotal[]; recepcionTotalRows: ActaSideTotal[] } {
  const unit = run.raw_material_unit_code;
  const rawMaterialId = run.raw_material_item_id;
  if (!unit || !rawMaterialId) return { entregaTotalRows: [], recepcionTotalRows: [] };
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
  if (run.finished_at !== null) {
    recepcionTotalRows.push({ label: "Merma total", quantity: mermaAcumulada, unit, kind: "merma" });
  }
  return {
    entregaTotalRows: [{ label: "Total entregado", quantity: entregaTotal, unit, kind: "total" }],
    recepcionTotalRows,
  };
}
```

- [ ] **Step 3: Reemplazar**

```ts
function computeRunTotals(run: ProductionRun): { entregaTotalRows: ActaSideTotal[]; recepcionTotalRows: ActaSideTotal[] } {
  const unit = run.raw_material_unit_code;
  const rawMaterialId = run.raw_material_item_id;
  if (!unit || !rawMaterialId) return { entregaTotalRows: [], recepcionTotalRows: [] };
  if (run.materials_approved_at === null) return { entregaTotalRows: [], recepcionTotalRows: [] };
  const lines = run.acta_lines ?? [];
  const entregaTotal = sumLinesByUnit(lines.filter((l) => l.side === "ENTREGA"), unit);
  if (entregaTotal <= 0) return { entregaTotalRows: [], recepcionTotalRows: [] };

  const mermaAcumulada = run.stages.reduce((sum, stage) => sum + num(stage.waste_weight), 0);
  // "Total recibido" = entregado - merma - devoluciones -- identidad
  // algebraica equivalente a "producto_real + usado" (usado = aprobado -
  // devuelto), la regla que Rodrigo confirmo (2026-08-16). Las lineas de
  // devolucion de complemento/insumo se distinguen de las de merma por
  // etapa / "Peso final recibido" por item_id: estas dos ultimas siempre
  // llevan el item_id de la MATERIA PRIMA (ya estan implicitas en
  // entregaTotal - merma), las devoluciones llevan el item_id del
  // complemento/insumo devuelto.
  const devolucionesTotal = sumLinesByUnit(
    lines.filter((l) => l.side === "RECEPCION" && l.source !== "PLAN" && l.item_id !== rawMaterialId),
    unit
  );
  const recepcionTotal = entregaTotal - mermaAcumulada - devolucionesTotal;

  const recepcionTotalRows: ActaSideTotal[] = [
    { label: "Total recibido", quantity: recepcionTotal, unit, kind: "total" },
  ];
  if (run.finished_at !== null) {
    recepcionTotalRows.push({ label: "Merma total", quantity: mermaAcumulada, unit, kind: "merma" });
  }
  return {
    entregaTotalRows: [{ label: "Total entregado", quantity: entregaTotal, unit, kind: "total" }],
    recepcionTotalRows,
  };
}
```

- [ ] **Step 4: Mismo cambio en `buildFamilyActaSides`**

Ubicar el bloque de totales dentro de `buildFamilyActaSides` (linea
391-433):

```ts
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
      const allFinished = family.every((run) => run.finished_at !== null || run.status === "CANCELADA");
      if (allFinished) {
        recepcionTotalRows.push({ label: "Merma total", quantity: mermaAcumulada, unit: rawUnit, kind: "merma" });
      }
    }
  }
```

Reemplazar por:

```ts
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
      // Misma regla que computeRunTotals (arriba): entregado - merma -
      // devoluciones, no producto_real + devuelto -- ver el comentario
      // largo al inicio de este Task en el plan para la prueba algebraica.
      const familyDevolucionesInUnit = sumLinesByUnit(
        familyAllLines.filter(
          (line) => line.side === "RECEPCION" && line.source !== "PLAN" && line.item_id !== rawMaterialId
        ),
        rawUnit
      );
      entregaTotalRows.push({ label: "Total entregado", quantity: entregaTotal, unit: rawUnit, kind: "total" });
      recepcionTotalRows.push({
        label: "Total recibido",
        quantity: entregaTotal - mermaAcumulada - familyDevolucionesInUnit,
        unit: rawUnit,
        kind: "total",
      });
      const allFinished = family.every((run) => run.finished_at !== null || run.status === "CANCELADA");
      if (allFinished) {
        recepcionTotalRows.push({ label: "Merma total", quantity: mermaAcumulada, unit: rawUnit, kind: "merma" });
      }
    }
  }
```

(`familyRealProducts` sigue existiendo y usandose mas abajo, en
`recepcionLines` -- no tocar esa parte, solo el bloque de totales de
arriba.)

- [ ] **Step 5: Type-check**

Run: `docker-compose exec web npm run build`
Expected: `Compiled successfully`.

- [ ] **Step 6: Verificación manual — caso real de Rodrigo (OP-2026-0045)**

En el navegador: reproducir el caso exacto (materia prima + complemento en
la misma unidad, aprobar, entregar/registrar una devolucion parcial de
complemento, alguna merma de etapa) y confirmar:
- "Total recibido" = Total entregado − Merma total − lo devuelto (NO
  productoReal + fila_devolucion + fila_merma).
- Con los numeros del reporte (entregado 800, merma 0,10, devuelto 200):
  Total recibido debe dar **599,90**, no 600,00.
- Repetir con una devolucion asimetrica si es posible (ej. aprobar 400,
  devolver 150) y confirmar que el total refleja "aprobado - devuelto"
  (250 usado), no el monto devuelto (150) -- son numeros distintos en ese
  caso, a diferencia del reporte original donde coincidian.
- Repetir en una orden con split (familia) para confirmar el mismo
  comportamiento en Documentos.

- [ ] **Step 7: Commit**

```bash
git add frontend/lib/orden-produccion.ts
git commit -m "$(cat <<'EOF'
fix(production): Total recibido resta devoluciones del entregado, no las suma

Bug reportado por Rodrigo con datos reales (OP-2026-0045): "Total
recibido" sumaba producto_real + fila_devolucion + fila_merma_etapa --
la merma se contaba dos veces (una ya implicita en producto_real, neto
de merma, y otra vez via la fila "Merma Etapa 2"). Ademas confirmado
por Rodrigo: el lado recibido debe reflejar "aprobado - devuelto"
(usado), no el monto devuelto en si -- con split simetrico ambas
lecturas coinciden por casualidad, con split asimetrico no.

Nueva formula: Total recibido = Total entregado - merma - devoluciones,
identidad algebraica equivalente a "producto_real + usado" para
cualquier split. Las devoluciones se identifican por item_id distinto
al de la materia prima (nunca por texto de label), asi no se confunden
con las lineas de merma por etapa o "Peso final recibido", que llevan
el item_id de la materia prima y ya estan implicitas en entregado-merma.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Peso del producto en ENSAMBLAR suma el complemento usado

> Agregado tras reporte real de Rodrigo (2026-08-16, misma orden
> OP-2026-0045, ENSAMBLAR): entrego 400g materia prima + 400g complemento,
> mermo 0,10g, devolvio 200g de complemento. "Producto: ARETES TEST" mostro
> 399,90g (solo materia prima neta de merma) -- Rodrigo espera 599,90g,
> porque el complemento se COMBINA fisicamente en la pieza en modo
> ENSAMBLAR (su propio ejemplo de sesion: "100g de plata + dijes, el
> producto final pesa la plata mas los dijes que SI se usaron").
>
> Formula confirmada por Rodrigo, textual: **"el peso del producto final es
> igual al peso inicial menos la merma mas la cantidad usada en los
> ensambles, que es igual a lo ingresado si no se devolvio nada, y si si
> [se devolvio] es igual al total menos la devolucion."** Y explicitamente
> **sin conversion por unidad/peso_por_unidad** -- rechazo esa idea de
> plano ("NO HAY NADA POR UNIDAD... SOLAMENTE LO SUMAS Y PUNTO"): el
> complemento ya viene en la misma unidad que la materia prima (gramos en
> este caso), se suma directo.
>
> A diferencia de las Tasks 1-3 (que tocaban DOS funciones,
> `computeRunTotals` y el bloque de `buildFamilyActaSides`), este fix es
> UN solo lugar: `realProductsForRun`, que ya es la fuente compartida que
> ambas funciones consumen (`buildRunActaSides` para una corrida sola,
> `buildFamilyActaSides` para familias con split) -- arreglarla ahi cubre
> los dos casos sin duplicar logica.
>
> ENSAMBLAR siempre tiene EXACTAMENTE 1 producto declarado (`create_run`
> lo valida: `if len(products) != 1... "En modo ensamblar el plan es un
> solo producto"`, `backend/modules/production/service.py:313-317`) -- no
> hace falta repartir el peso del complemento entre varios productos, va
> entero a esa unica fila. No toca nada del lado ASIGNAR (los complementos
> ahi son piezas asignadas aparte, no se combinan en el peso del
> producto).
>
> No hace falta tocar el backend: `run.complements` (con `quantity`,
> `returned_quantity`, `unit_code`, `status`) ya llega al frontend
> completo (`frontend/types/production/index.ts:142-155`) -- alcanza con
> sumar `quantity - returned_quantity` de los complementos APROBADOS cuya
> unidad coincida con la de la materia prima.

**Files:**
- Modify: `frontend/lib/orden-produccion.ts:43-61` (`realProductsForRun`)

**Interfaces:**
- Ninguna nueva. Mismo tipo de retorno
  (`NonNullable<ProductionRun["products"]>`).

- [ ] **Step 1: Ubicar el código actual**

```ts
/** Productos resultantes de UNA corrida con la cantidad REAL producida, no
 * la planeada -- vacio mientras la corrida sigue en curso (`finished_at`
 * null): el lado RECIBIDO no debe adelantar un numero que todavia no se
 * sabe. Al terminar, `run.actual_finished_weight` (peso real = entregado
 * menos merma real, ver `_finish_run` en backend/modules/production/service.py)
 * se reparte entre las lineas de producto declaradas en la MISMA proporcion
 * que se planearon -- si una corrida declaro dos productos 70/30, el peso
 * real tambien se reparte 70/30, igual que hace `_split_run_for_partial_material`
 * al partir una orden. */
function realProductsForRun(run: ProductionRun): NonNullable<ProductionRun["products"]> {
  if (run.finished_at === null || run.actual_finished_weight === null || run.actual_finished_weight === undefined) {
    return [];
  }
  const products = run.products ?? [];
  const plannedTotal = products.reduce((sum, p) => sum + num(p.quantity), 0);
  if (plannedTotal <= 0) return [];
  const ratio = Number(run.actual_finished_weight) / plannedTotal;
  return products.map((p) => ({ ...p, quantity: String(num(p.quantity) * ratio) }));
}
```

- [ ] **Step 2: Reemplazar**

```ts
/** Productos resultantes de UNA corrida con la cantidad REAL producida, no
 * la planeada -- vacio mientras la corrida sigue en curso (`finished_at`
 * null): el lado RECIBIDO no debe adelantar un numero que todavia no se
 * sabe. Al terminar, `run.actual_finished_weight` (peso real = entregado
 * menos merma real, ver `_finish_run` en backend/modules/production/service.py)
 * se reparte entre las lineas de producto declaradas en la MISMA proporcion
 * que se planearon -- si una corrida declaro dos productos 70/30, el peso
 * real tambien se reparte 70/30, igual que hace `_split_run_for_partial_material`
 * al partir una orden. En ENSAMBLAR (siempre 1 solo producto, create_run
 * lo exige) el peso de la pieza no es solo materia prima: se le suma lo
 * que de verdad se incorporo de cada complemento aprobado -- aprobado
 * menos devuelto, en la misma unidad de la materia prima, sin conversion
 * de peso por unidad (Rodrigo, 2026-08-16: "sin nada por unidad, sumas y
 * punto"). Si nada se devolvio, usado = todo lo aprobado. */
function realProductsForRun(run: ProductionRun): NonNullable<ProductionRun["products"]> {
  if (run.finished_at === null || run.actual_finished_weight === null || run.actual_finished_weight === undefined) {
    return [];
  }
  const products = run.products ?? [];
  const plannedTotal = products.reduce((sum, p) => sum + num(p.quantity), 0);
  if (plannedTotal <= 0) return [];
  const ratio = Number(run.actual_finished_weight) / plannedTotal;
  const scaled = products.map((p) => ({ ...p, quantity: String(num(p.quantity) * ratio) }));
  if (run.assembly_mode === "ENSAMBLAR" && scaled.length === 1) {
    const unit = run.raw_material_unit_code;
    const complementWeight = (run.complements ?? [])
      .filter((c) => c.status === "APROBADA" && c.unit_code === unit)
      .reduce((sum, c) => sum + (num(c.quantity) - num(c.returned_quantity ?? 0)), 0);
    if (complementWeight > 0) {
      scaled[0] = { ...scaled[0], quantity: String(num(scaled[0].quantity) + complementWeight) };
    }
  }
  return scaled;
}
```

- [ ] **Step 3: Type-check**

Run: `docker-compose exec web npm run build`
Expected: `Compiled successfully`.

- [ ] **Step 4: Verificación aritmética a mano — caso real OP-2026-0045**

Antes de tocar el codigo (o inmediatamente despues, comparando), confirmar
en el reporte:
- Materia prima entregada 400g, merma 0,10g -> peso base = 399,90g
  (`actual_finished_weight`, sin cambios).
- Complemento aprobado 400g, devuelto 200g -> `complementWeight` = 200.
- `scaled[0].quantity` final = 399,90 + 200 = **599,90** (antes de este
  fix daba 399,90 a secas).
- Confirmar que "Total recibido" (arreglado en la Task 3) sigue dando
  599,90 tambien -- por construccion algebraica coincide en este caso
  (con 1 solo producto y sin insumos de por medio), no es casualidad ni
  hace falta que este fix toque esa formula.

- [ ] **Step 5: Verificación manual en navegador**

Abrir Ver Acta de una orden ENSAMBLAR con complemento parcialmente
devuelto (la misma OP-2026-0045 si sigue disponible, o una nueva
equivalente) y confirmar que "Producto: X" muestra el peso combinado
(materia prima neta + complemento usado), no solo la materia prima.
Confirmar tambien que una orden ASIGNAR con complemento NO cambia (el
complemento sigue sin sumarse al producto ahi).

- [ ] **Step 6: Commit**

```bash
git add frontend/lib/orden-produccion.ts
git commit -m "$(cat <<'EOF'
fix(production): peso del producto en ENSAMBLAR suma el complemento usado

realProductsForRun solo repartia actual_finished_weight (materia
prima neta de merma) entre los productos declarados -- en ENSAMBLAR el
complemento se combina fisicamente en la pieza y su peso nunca se
sumaba: "Producto: ARETES TEST" mostraba 399,90g en vez de 599,90g
(materia prima 399,90 + complemento usado 200, con 400 aprobados y 200
devueltos). Formula confirmada por Rodrigo, sin conversion por unidad:
usado = aprobado - devuelto, directo. Un solo cambio cubre corridas
sueltas y familias con split porque ambas comparten esta funcion.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: "Total recibido" = suma literal de las filas mostradas; "Merma Etapa X" deja de mostrarse como fila

> Agregado tras un CUARTO reporte de Rodrigo sobre esta misma orden real
> (OP-2026-0045, 2026-08-16), despues de la Task 4 (que ya arreglo
> "Producto: ARETES TEST" para que sume el complemento usado, 599,90g).
> Con eso ya arreglado, el acta ahora muestra:
>
> ```text
> Producto: ARETES TEST       599,90 g
> Devolucion: COMPLEMENTO TEST 200,00 g
> Merma Etapa 2                 0,10 g
> Total recibido               599,90 g   <- Rodrigo: falta sumar la devolucion
> Merma total                   0,10 g
> ```
>
> Rodrigo, textual: **"falta sumar la devolución para el peso total del
> recibido... y la merma solo sale abajo (la que está en rojo) la otra
> repetida ya no debe salir."** Dos pedidos en una frase:
>
> 1. "Total recibido" debe sumar tambien la fila de devolucion (599,90 +
>    200 = 799,90), no restarla del entregado -- la Task 3 restaba
>    `devoluciones` del `entregaTotal` asumiendo que "usado" nunca se
>    mostraba en ningun lado; la Task 4 cambio eso: ahora "Producto: X" YA
>    muestra "usado" (aprobado-devuelto) para ENSAMBLAR, asi que restar la
>    devolucion otra vez del total la resta DOS veces.
> 2. La fila "Merma Etapa 2" (el detalle por etapa) ya NO debe aparecer
>    como fila en el listado de RECEPCION -- solo la fila roja de abajo
>    ("Merma total") debe existir. Hoy se muestran las dos (una arriba
>    listada, otra abajo como resumen) y son el mismo numero repetido.
>
> **La forma mas robusta de cumplir ambos pedidos a la vez, sin volver a
> depender de una formula aparte que pueda divergir de las filas (la causa
> raiz de CADA una de las ultimas 4 correcciones de este plan):** que
> "Total recibido" sea la suma LITERAL de las filas que
> `recepcionLines`/`recepcionSide.lines` YA CONSTRUYEN para mostrarse --
> ni una formula de `entregado - merma - devoluciones` (Task 3) ni
> `producto_real + filas` (Task 1/2) calculadas por separado, sino sumar
> el mismo array `ActaSideLine[]` que el usuario ve en pantalla. Asi el
> total NUNCA puede desincronizarse de lo que se imprime, por
> construccion -- no por una formula que alguien tiene que mantener
> sincronizada a mano cada vez que cambia que filas se muestran (que es
> literalmente lo que paso en las Tasks 1, 3 y ahora esta).
>
> Para lograrlo:
> - Se agrega `sumRowsByUnit`, que suma un array de `ActaSideLine` (las
>   filas YA armadas para mostrar), en vez de `sumLinesByUnit` (que sumaba
>   `acta_lines` crudas, re-derivando su propio filtro por separado del que
>   arma las filas -- la fuente de la divergencia).
> - Las filas de merma por etapa se excluyen de `recepcionLines` en el
>   punto donde se arman (no en el calculo del total): se identifican por
>   `stage_id != null` (las de merma por etapa siempre lo llevan, ver
>   `_sync_stage_waste_acta_line`/`finish_stage` en
>   `backend/modules/production/service.py`; devoluciones y "Peso final
>   recibido" nunca lo llevan) -- MISMA senal que ya se uso en la Task 3
>   para excluirlas del calculo, ahora se usa para excluirlas tambien de
>   la vista.
> - `computeRunTotals` cambia de firma: recibe `entregaLines`/`recepcionLines`
>   ya construidas (en vez de re-derivar todo de `run.acta_lines` con su
>   propio filtro) y solo las suma.
> - `sumLinesByUnit` queda sin uso despues de este cambio -- eliminar (no
>   dejar codigo muerto).
>
> **Verificacion con los numeros reales:** `recepcionLines` pasa a ser
> `[Producto: ARETES TEST (599,90), Devolucion: COMPLEMENTO TEST (200,00)]`
> (la fila "Merma Etapa 2" ya no esta ahi). `sumRowsByUnit` de esas dos
> filas = 799,90. **Total recibido: 799,90g.** "Merma total" sigue
> mostrandose abajo (0,10g, la unica fila de merma que queda, gated por
> `finished_at !== null` como siempre).

**Files:**
- Modify: `frontend/lib/orden-produccion.ts:97-166` (`sumLinesByUnit`,
  `computeRunTotals`) — reemplaza `sumLinesByUnit` por `sumRowsByUnit` y
  reescribe `computeRunTotals`.
- Modify: `frontend/lib/orden-produccion.ts:183-211` (`buildRunActaSides`)
  — filtra `stage_id` al armar `recepcionLines`, pasa las lineas ya
  armadas a `computeRunTotals`.
- Modify: `frontend/lib/orden-produccion.ts:277-292` (`recepcionRowsForRun`)
  — mismo filtro de `stage_id`, usado por la familia.
- Modify: `frontend/lib/orden-produccion.ts:391-479` (`buildFamilyActaSides`)
  — reordena para construir `recepcionLines`/`entregaSide.lines` ANTES del
  bloque de totales, y suma esas filas en vez de re-derivar de
  `run.acta_lines`.

**Interfaces:**
- `computeRunTotals` cambia de firma: `(run, entregaLines: ActaSideLine[],
  recepcionLines: ActaSideLine[])` en vez de `(run)` solo. Sigue siendo
  una funcion privada del archivo (no exportada), asi que no hay
  consumidores externos que romper.

- [ ] **Step 1: Ubicar `sumLinesByUnit` y `computeRunTotals` actuales**

```ts
function sumLinesByUnit(lines: Array<{ unit_code: string; quantity: string }>, unit: string): number {
  return lines.filter((l) => l.unit_code === unit).reduce((sum, l) => sum + num(l.quantity), 0);
}

// "Total entregado" es la suma LITERAL de las lineas ENTREGA en la unidad
// de la materia prima -- igual que el subtotal de cualquier recibo, no una
// formula aparte que pueda divergir de las filas de arriba (bug reportado:
// antes solo sumaba la materia prima e ignoraba un complemento en la misma
// unidad -- 400g+405g mostraba 400g). "Total recibido" NO suma las filas
// de recepcion -- resta las devoluciones del entregado (ver el comentario
// junto a `devolucionesTotal` mas abajo, misma logica que repite
// buildFamilyActaSides para la familia completa).
function computeRunTotals(run: ProductionRun): { entregaTotalRows: ActaSideTotal[]; recepcionTotalRows: ActaSideTotal[] } {
  const unit = run.raw_material_unit_code;
  const rawMaterialId = run.raw_material_item_id;
  if (!unit || !rawMaterialId) return { entregaTotalRows: [], recepcionTotalRows: [] };
  if (run.materials_approved_at === null) return { entregaTotalRows: [], recepcionTotalRows: [] };
  const lines = run.acta_lines ?? [];
  const entregaTotal = sumLinesByUnit(lines.filter((l) => l.side === "ENTREGA"), unit);
  if (entregaTotal <= 0) return { entregaTotalRows: [], recepcionTotalRows: [] };

  const mermaAcumulada = run.stages.reduce((sum, stage) => sum + num(stage.waste_weight), 0);
  // "Total recibido" = entregado - merma - devoluciones -- identidad
  // algebraica equivalente a "producto_real + usado" (usado = aprobado -
  // devuelto), la regla que Rodrigo confirmo (2026-08-16). Las lineas de
  // devolucion de complemento/insumo se distinguen de las de merma por
  // etapa / "Peso final recibido" por item_id: estas dos ultimas siempre
  // llevan el item_id de la MATERIA PRIMA (ya estan implicitas en
  // entregaTotal - merma), las devoluciones llevan el item_id del
  // complemento/insumo devuelto.
  const devolucionesTotal = sumLinesByUnit(
    lines.filter((l) => l.side === "RECEPCION" && l.source !== "PLAN" && l.item_id !== rawMaterialId),
    unit
  );
  const recepcionTotal = entregaTotal - mermaAcumulada - devolucionesTotal;

  const recepcionTotalRows: ActaSideTotal[] = [
    { label: "Total recibido", quantity: recepcionTotal, unit, kind: "total" },
  ];
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
function sumRowsByUnit(lines: ActaSideLine[], unit: string): number {
  return lines
    .filter((l): l is Extract<ActaSideLine, { kind: "row" }> => l.kind === "row" && l.unit_code === unit)
    .reduce((sum, l) => sum + num(l.quantity), 0);
}

// Los totales son la suma LITERAL de las filas que YA se muestran
// (entregaLines/recepcionLines, construidas por el caller) -- ni una
// formula de "entregado - merma - devoluciones" ni "producto + filas"
// calculada aparte, para que el total nunca pueda desincronizarse de lo
// impreso (fue la causa raiz de tres correcciones seguidas de este plan).
// "Merma Etapa X" no aparece en recepcionLines (se filtra al armarlas, ver
// buildRunActaSides/recepcionRowsForRun) -- por eso no hace falta
// excluirla aca: sumar recepcionLines tal cual ya da el numero correcto.
function computeRunTotals(
  run: ProductionRun,
  entregaLines: ActaSideLine[],
  recepcionLines: ActaSideLine[]
): { entregaTotalRows: ActaSideTotal[]; recepcionTotalRows: ActaSideTotal[] } {
  const unit = run.raw_material_unit_code;
  const rawMaterialId = run.raw_material_item_id;
  if (!unit || !rawMaterialId) return { entregaTotalRows: [], recepcionTotalRows: [] };
  if (run.materials_approved_at === null) return { entregaTotalRows: [], recepcionTotalRows: [] };
  const entregaTotal = sumRowsByUnit(entregaLines, unit);
  if (entregaTotal <= 0) return { entregaTotalRows: [], recepcionTotalRows: [] };

  const mermaAcumulada = run.stages.reduce((sum, stage) => sum + num(stage.waste_weight), 0);
  const recepcionTotal = sumRowsByUnit(recepcionLines, unit);

  const recepcionTotalRows: ActaSideTotal[] = [
    { label: "Total recibido", quantity: recepcionTotal, unit, kind: "total" },
  ];
  if (run.finished_at !== null) {
    recepcionTotalRows.push({ label: "Merma total", quantity: mermaAcumulada, unit, kind: "merma" });
  }
  return {
    entregaTotalRows: [{ label: "Total entregado", quantity: entregaTotal, unit, kind: "total" }],
    recepcionTotalRows,
  };
}
```

- [ ] **Step 3: `buildRunActaSides` — filtrar `stage_id` y pasar las filas armadas**

Ubicar:

```ts
export function buildRunActaSides(run: ProductionRun): RunActaSides {
  const lines = run.acta_lines ?? [];
  const entregaLines: ActaSideLine[] = lines
    .filter((l) => l.side === "ENTREGA")
    .map((l) => ({ kind: "row" as const, id: l.id, label: l.label, quantity: l.quantity, unit_code: l.unit_code, editable: l.source === "MANUAL" }));
  // La linea RECEPCION "PLAN" (producto resultante planeado, sembrada al
  // crear la orden) no es un recibo real -- se queda fuera de las filas
  // mostradas; el producto resultante REAL se antepone abajo, vacio
  // mientras la corrida sigue en curso (ver productoRealLines).
  const recepcionLines: ActaSideLine[] = [
    ...productoRealLines(realProductsForRun(run), run.raw_material_unit_code),
    ...lines
      .filter((l) => l.side === "RECEPCION" && l.source !== "PLAN")
      .map((l) => ({ kind: "row" as const, id: l.id, label: l.label, quantity: l.quantity, unit_code: l.unit_code, editable: l.source === "MANUAL" })),
  ];

  const { entregaTotalRows, recepcionTotalRows } = computeRunTotals(run);
```

Reemplazar por:

```ts
export function buildRunActaSides(run: ProductionRun): RunActaSides {
  const lines = run.acta_lines ?? [];
  const entregaLines: ActaSideLine[] = lines
    .filter((l) => l.side === "ENTREGA")
    .map((l) => ({ kind: "row" as const, id: l.id, label: l.label, quantity: l.quantity, unit_code: l.unit_code, editable: l.source === "MANUAL" }));
  // La linea RECEPCION "PLAN" (producto resultante planeado, sembrada al
  // crear la orden) no es un recibo real -- se queda fuera de las filas
  // mostradas; el producto resultante REAL se antepone abajo, vacio
  // mientras la corrida sigue en curso (ver productoRealLines). Las de
  // merma por etapa (stage_id != null) tampoco se muestran como fila --
  // solo "Merma total" (Rodrigo, 2026-08-16: la de arriba estaba
  // repetida con la de abajo).
  const recepcionLines: ActaSideLine[] = [
    ...productoRealLines(realProductsForRun(run), run.raw_material_unit_code),
    ...lines
      .filter((l) => l.side === "RECEPCION" && l.source !== "PLAN" && l.stage_id == null)
      .map((l) => ({ kind: "row" as const, id: l.id, label: l.label, quantity: l.quantity, unit_code: l.unit_code, editable: l.source === "MANUAL" })),
  ];

  const { entregaTotalRows, recepcionTotalRows } = computeRunTotals(run, entregaLines, recepcionLines);
```

(El resto de la funcion, el `return { ... }`, no cambia.)

- [ ] **Step 4: `recepcionRowsForRun` — mismo filtro de `stage_id` (lo usa la familia)**

Ubicar:

```ts
function recepcionRowsForRun(run: ProductionRun): Extract<ActaSideLine, { kind: "row" }>[] {
  const eventLines = (run.event_lines ?? []).filter((line) => line.side === "RECEPCION");
  if (eventLines.length > 0) {
    return eventLines.map((line, i) => ({
      kind: "row" as const,
      id: `${run.id}-rec-ev-${i}`,
      label: line.detalle ?? "",
      quantity: line.gramos,
      unit_code: line.unidad,
      editable: false,
    }));
  }
  return (run.acta_lines ?? [])
    .filter((line) => line.side === "RECEPCION" && line.source !== "PLAN")
    .map((line) => ({ kind: "row" as const, id: line.id, label: line.label, quantity: line.quantity, unit_code: line.unit_code, editable: false }));
}
```

Reemplazar solo el ultimo `return` (el de `event_lines` no cambia -- las
actas historicas no tienen `stage_id`, no aplica):

```ts
  return (run.acta_lines ?? [])
    .filter((line) => line.side === "RECEPCION" && line.source !== "PLAN" && line.stage_id == null)
    .map((line) => ({ kind: "row" as const, id: line.id, label: line.label, quantity: line.quantity, unit_code: line.unit_code, editable: false }));
}
```

- [ ] **Step 5: `buildFamilyActaSides` — reordenar y sumar filas ya armadas**

Ubicar el bloque completo desde `familyRealProducts` hasta el final de la
funcion (linea 421-479 aprox., DESPUES de las Tasks 1-4 de este plan):

```ts
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
      // Misma regla que computeRunTotals (arriba): entregado - merma -
      // devoluciones, no producto_real + devuelto -- devolucionesTotal ahi
      // arriba tiene la explicacion completa (item_id distinto al de la
      // materia prima = devolucion real, no merma ni "Peso final recibido").
      const familyDevolucionesInUnit = sumLinesByUnit(
        familyAllLines.filter(
          (line) => line.side === "RECEPCION" && line.source !== "PLAN" && line.item_id !== rawMaterialId
        ),
        rawUnit
      );
      entregaTotalRows.push({ label: "Total entregado", quantity: entregaTotal, unit: rawUnit, kind: "total" });
      recepcionTotalRows.push({
        label: "Total recibido",
        quantity: entregaTotal - mermaAcumulada - familyDevolucionesInUnit,
        unit: rawUnit,
        kind: "total",
      });
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

  return {
    entregaLines: entregaSide.lines,
    entregaFecha: entregaSide.fecha,
    entregaResponsable: entregaSide.responsable,
    recepcionLines,
    recepcionFecha: recepcionSide.fecha,
    recepcionResponsable: recepcionSide.responsable,
    entregaTotalRows,
    recepcionTotalRows,
  };
}
```

Reemplazar por (nota: `recepcionLines` se construye ANTES del bloque de
totales ahora, porque el total la necesita):

```ts
  const rawUnit = root.raw_material_unit_code;
  const rawMaterialId = root.raw_material_item_id;
  const familyRealProducts = family.flatMap((run) => realProductsForRun(run));
  // Solo aporta cada corrida que ya termino (realProductsForRun devuelve
  // vacio mientras sigue en curso) -- si el padre ya acabo y la hija sigue
  // ESPERANDO_MATERIAL, la familia muestra unicamente lo real del padre, no
  // el plan completo de ambos.
  const recepcionLines: ActaSideLine[] = [
    ...productoRealLines(familyRealProducts, root.raw_material_unit_code),
    ...recepcionSide.lines,
  ];

  // Totales entregado/recibido/merma para la familia completa: suma
  // LITERAL de las filas YA construidas arriba (entregaSide.lines,
  // recepcionLines) -- mismo criterio que computeRunTotals, para que el
  // total nunca pueda desincronizarse de lo impreso. No aplica a familias
  // historicas (event_lines, migradas de papel): esas no necesariamente
  // reconciliaban. Sin aprobar todavia no hay total que mostrar.
  const entregaTotalRows: ActaSideTotal[] = [];
  const recepcionTotalRows: ActaSideTotal[] = [];
  if (!isHistorical && rawUnit && rawMaterialId && canPrintEntrega(family)) {
    const entregaTotal = sumRowsByUnit(entregaSide.lines, rawUnit);
    if (entregaTotal > 0) {
      const mermaAcumulada = family
        .flatMap((run) => run.stages)
        .reduce((sum, stage) => sum + num(stage.waste_weight), 0);
      const recepcionTotal = sumRowsByUnit(recepcionLines, rawUnit);
      entregaTotalRows.push({ label: "Total entregado", quantity: entregaTotal, unit: rawUnit, kind: "total" });
      recepcionTotalRows.push({ label: "Total recibido", quantity: recepcionTotal, unit: rawUnit, kind: "total" });
      const allFinished = family.every((run) => run.finished_at !== null || run.status === "CANCELADA");
      if (allFinished) {
        recepcionTotalRows.push({ label: "Merma total", quantity: mermaAcumulada, unit: rawUnit, kind: "merma" });
      }
    }
  }

  return {
    entregaLines: entregaSide.lines,
    entregaFecha: entregaSide.fecha,
    entregaResponsable: entregaSide.responsable,
    recepcionLines,
    recepcionFecha: recepcionSide.fecha,
    recepcionResponsable: recepcionSide.responsable,
    entregaTotalRows,
    recepcionTotalRows,
  };
}
```

- [ ] **Step 6: Confirmar que `sumLinesByUnit` quedo sin uso y eliminarla**

Run: `grep -n "sumLinesByUnit" "frontend/lib/orden-produccion.ts"`
Expected: cero apariciones si el Step 1-5 se aplico completo (ya no debe
quedar ninguna, ni su propia definicion). Si el grep todavia la muestra en
algun lugar no cubierto por los steps anteriores, revisar por que antes de
borrarla.

- [ ] **Step 7: Type-check**

Run: `docker-compose exec web npm run build`
Expected: `Compiled successfully`.

- [ ] **Step 8: Verificación aritmética a mano — caso real OP-2026-0045**

Confirmar en el reporte:
- `recepcionLines` para esta orden queda como `[Producto: ARETES TEST
  (599,90), Devolucion: COMPLEMENTO TEST (200,00)]` -- la fila "Merma
  Etapa 2" ya NO aparece en la lista.
- `sumRowsByUnit` de esas dos filas = **799,90** -> "Total recibido:
  799,90 g" (antes daba 599,90).
- "Merma total" sigue mostrandose abajo, 0,10g, sin cambios.
- "Total entregado" sigue en 800g, sin cambios (no toca `entregaLines`).

- [ ] **Step 9: Verificación manual en navegador**

Abrir Ver Acta de OP-2026-0045 (o una orden equivalente) y confirmar:
- El listado RECEPCION ya NO muestra una fila "Merma Etapa X" -- solo
  Producto y Devolucion(es)/insumo(s) devueltos.
- "Total recibido" = suma de esas filas (799,90 en este caso).
- "Merma total" sigue apareciendo abajo, en rojo, una sola vez.
- Repetir en Documentos para la misma orden y en una orden con split
  (familia) para confirmar que las tres vistas coinciden.

- [ ] **Step 10: Commit**

```bash
git add frontend/lib/orden-produccion.ts
git commit -m "$(cat <<'EOF'
fix(production): Total recibido suma las filas mostradas, sin merma repetida

Cuarto reporte seguido de Rodrigo sobre la misma orden real: con
"Producto: X" ya sumando el complemento usado (fix anterior), restar
la devolucion del total OTRA VEZ la restaba dos veces -- y la fila
"Merma Etapa X" se mostraba tanto en el listado como, repetida, en el
resumen de abajo. Fix estructural en vez de otro parche de formula:
"Total recibido"/"Total entregado" pasan a ser la suma LITERAL de las
filas que entregaLines/recepcionLines YA construyen para mostrarse
(sumRowsByUnit sobre ActaSideLine[], reemplaza sumLinesByUnit sobre
acta_lines crudas) -- el total no puede desincronizarse de lo impreso
por construccion. Las filas de merma por etapa (stage_id != null) se
excluyen al armar recepcionLines, no en el calculo del total; solo
queda "Merma total" como resumen, una sola vez.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Verificación final del plan

- [ ] **Step 1: Build completo**

Run: `docker-compose exec web npm run build`
Expected: `Compiled successfully`.

- [ ] **Step 2: Volver al plan maestro**

Marcar el checkbox de este plan en
`docs/superpowers/plans/2026-08-16-acta-bugs-master.md` y abrir el siguiente
plan de la lista (Modal "Sobrante por devolver") sin esperar confirmación
adicional.
