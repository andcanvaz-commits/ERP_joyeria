# Familia de split: agrupar en UI + certificado unificado

Fecha: 2026-08-03
Continúa: `docs/superpowers/plans/2026-08-03-produccion-parcial-split-frontend.md` (ya implementado y probado en navegador por el usuario).

## Contexto

Al probar el split de producción en navegador, surgieron 3 pedidos de ajuste:

1. El certificado ("Orden de Producción") se genera hoy por `ProductionRun`
   individual. Un folio raíz partido en 2-3 corridas (`OP-2026-0005`,
   `OP-2026-0005-B`, ...) produce 2-3 certificados separados para lo que es,
   operativamente, una sola orden. Debe ser **un solo certificado por
   familia** (folio raíz + todas sus hijas).
2. En la lista "En proceso" del tablero de producción, una corrida y su
   hija (nacida del split) aparecen como filas sueltas sin relación visible
   más allá del chip "de `<folio>`" ya agregado. Se pidió poder ver/gestionar
   ambas juntas desde una sola vista.
3. (Ya resuelto en la iteración anterior: aviso al aprobar/destinar cuando
   ocurre un split, nombre de proceso + cantidad clara en el modal de
   inventario.)

## Decisiones (confirmadas con el usuario)

- **Agrupación "En proceso":** una familia con más de un miembro se muestra
  como **una sola fila** (folio raíz + cantidad de corridas). Click abre un
  modal que lista cada corrida de la familia con su propio botón
  "Gestionar" (abre el modal de etapas ya existente, sin cambios ahí). Si la
  familia tiene un solo miembro (caso normal, sin split), la fila y el click
  se comportan exactamente igual que hoy.
- **Certificado unificado:** el botón de imprimir "entrega" para una familia
  solo se habilita cuando **ya no queda ninguna corrida en
  `ESPERANDO_MATERIAL`** dentro de esa familia (todas arrancaron). El
  certificado junta cantidad total, y la sección ENTREGA pasa a ser una
  **lista de eventos** (uno por cada corrida que recibió material, con su
  propia fecha y responsable — pueden haber llegado en momentos distintos).
  RECEPCIÓN se trata igual: lista de eventos, uno por cada corrida recibida;
  "Imprimir recepción/completo" se habilita solo cuando todas las corridas
  de la familia están `RECIBIDA` (o `CANCELADA`).

## 1. `frontend/lib/orden-produccion.ts` — helpers de familia + modelo multi-evento

- `DocSide` (fecha + responsable + rows, un solo evento) se mantiene tal
  cual pero se usa como el tipo de **un evento**; `OrdenProduccionModel`
  cambia `entrega`/`recepcion` de `DocSide` a `DocSide[]`.
- Nuevas funciones de agrupación (usadas por los 3 componentes que tocan
  `ProductionRun[]`):
  - `runFamilyKey(run): string` → `run.root_production_code || run.production_code || run.id`.
  - `groupRunFamilies(runs): Map<string, ProductionRun[]>` → agrupa y ordena
    cada grupo por `production_code`.
  - `getRunFamily(runs, run): ProductionRun[]` → atajo para la familia de un
    run puntual dentro de una lista.
- `buildOrdenProduccion` cambia de firma: recibe `family: ProductionRun[]`
  (no un solo run). Folio = folio raíz de la familia; cantidad = suma de
  `quantity` de todos los miembros; categoría/responsable de producción =
  los del primer miembro (root); `entrega`/`recepcion` = un `DocSide` por
  cada miembro que tenga `materials_approved_at`/`received_at`,
  respectivamente, reutilizando la misma lógica de filas que ya existe hoy
  por-run.
- `canPrintEntrega(family)` / `canPrintRecepcion(family)` cambian de firma
  igual: reciben la familia completa, no un run.

## 2. `frontend/components/documentos/orden-produccion-doc.tsx` — render multi-evento

`SideColumn` pasa de recibir `side: DocSide` a `events: DocSide[]`. Cada
evento se imprime como su propio bloque dentro de la misma columna: una
fila de encabezado de grupo (fecha + responsable de ese evento, todo el
ancho de la tabla) seguida de sus filas de detalle. El padding a
`MIN_ROWS` se aplica una sola vez al final de todos los eventos, no por
evento, para que la columna no quede desproporcionadamente larga con varias
entregas chicas.

## 3. `frontend/components/documentos/documentos-dashboard.tsx` — un ítem por familia

La lista de la izquierda pasa de "un botón por `ProductionRun`" a "un botón
por familia" (`groupRunFamilies` sobre `runs`). El botón muestra el folio
raíz + nombre de proceso + un resumen de estado (p.ej. "2/3 recibidas" si
está parcialmente completa, o el estado único si la familia tiene un solo
miembro). Seleccionar una familia arma el modelo con
`buildOrdenProduccion(familia, itemNames)` y los botones de imprimir usan
`canPrintEntrega(familia)` / `canPrintRecepcion(familia)`.

## 4. `frontend/components/inventory/inventory-dashboard.tsx` — preview automático family-aware

- `printPreview` cambia de `{ run, mode }` a `{ family, mode }`.
- `handleApproveMaterials`: tras aprobar, arma la familia del run actualizado
  con los `nextRuns` ya refetcheados. Si `canPrintEntrega(familia)` es
  verdadero (no quedó ningún miembro `ESPERANDO_MATERIAL`), ofrece el
  preview de "entrega" como hoy; si quedó un split pendiente, **no** ofrece
  preview (ya se avisó el split por toast en la iteración anterior).
- `handleAllocateRun`: es el punto donde un split se puede terminar de
  resolver. Tras destinar y refetchear, si la familia ya no tiene ningún
  miembro `ESPERANDO_MATERIAL`, ofrece el preview de "entrega" ahí (es la
  primera vez que se cumple la condición para una familia que se partió).
- `handleReceiveFinishedProduct`: mismo patrón con `canPrintRecepcion`
  sobre la familia — solo ofrece preview de "recepción" cuando todos los
  miembros están `RECIBIDA`/`CANCELADA`.

## 5. `frontend/components/production/production-dashboard.tsx` — fila de familia + modal

- Import de `groupRunFamilies`/`getRunFamily` desde `orden-produccion.ts`.
- La sección "En proceso" agrupa `inProgressRuns` por familia (incluye
  miembros que no están `EN_PROCESO`, p.ej. una hija `ESPERANDO_MATERIAL`,
  para poder mostrar "1 en proceso · 1 esperando material").
  - Familia de 1 miembro: fila igual a la actual (sin cambios de
    comportamiento ni de layout).
  - Familia de 2+ miembros: fila colapsada con folio raíz, nombre de
    proceso, chip "Familia · N corridas" y un resumen de conteos por
    estado; click abre el modal de familia en vez del modal de etapas
    directo.
- Modal de familia nuevo (mismo patrón `modalWindow`/`modalHeader` que el
  resto del archivo): tabla con folio, estado (`StatusPunch`), cantidad y
  botón "Gestionar" por fila que cierra este modal y abre el modal de
  etapas existente (`openRunStagesModal`) para esa corrida puntual — cero
  cambios en el modal de etapas en sí.

## Fuera de alcance

- Cambios al layout físico exacto de la hoja impresa más allá de agregar el
  encabezado de grupo por evento (colores/tipografía se mantienen
  consistentes con el resto del documento existente).
- Verificación visual del PDF/impresión: requiere que el usuario lo revise
  en papel o preview de impresión — no soy capaz de verificarlo yo mismo sin
  navegador conectado.

## Plan de verificación manual

1. Repetir el split de antes (orden con material insuficiente → aprobar →
   nace `-B`). Confirmar que en "En proceso" del tablero aparece **una
   fila** para la familia (no dos), con el conteo correcto.
2. Click en esa fila → modal de familia lista root + `-B`, cada uno con su
   "Gestionar" funcional (abre el modal de etapas de esa corrida puntual).
3. Ir a Documentos: confirmar que la familia aparece como **un solo ítem**
   en la lista (no `OP-...` y `OP-...-B` por separado), y que "Imprimir
   entrega" está deshabilitado mientras `-B` siga `ESPERANDO_MATERIAL`.
4. Destinar material a `-B` desde inventario (sin generar otro split):
   confirmar que el preview de impresión de "entrega" aparece automático, y
   que en Documentos "Imprimir entrega" ya está habilitado y el PDF muestra
   dos bloques de ENTREGADO (uno por cada corrida) con sus fechas propias.
5. Recibir ambas corridas por separado: confirmar que "Imprimir
   recepción"/"completo" siguen deshabilitados hasta que la segunda se
   reciba, y que el preview automático de recepción aparece recién ahí.
