# Fases del lado RECIBIDO en el certificado/acta — Design

## Contexto

El comprobante "Orden de Producción" tiene dos formas hoy: el documento
imprimible (`frontend/components/documentos/orden-produccion-doc.tsx`, modelo
armado por `frontend/lib/orden-produccion.ts:buildOrdenProduccion`) y la vista
editable "Ver acta" (`frontend/components/production/acta-view.tsx`). Ambos
muestran dos columnas, ENTREGADO y RECIBIDO, con la misma tabla
FECHA/CANTIDAD/DETALLES rellenada con filas en blanco cuando no hay datos.

El problema: el lado RECIBIDO se ve igual (tabla vacía con filas en blanco)
tanto si inventario todavía no aprobó nada como si ya aprobó pero la
producción no ha avanzado. No comunica en qué estado real está la orden, y
`computeBalanceTotals`/la lógica equivalente en `orden-produccion.ts` ya
calcula un "Total recibido" (`entregaTotal - mermaAcumulada`) apenas hay
entrega, aunque mermaAcumulada sea 0 porque ninguna etapa terminó — dando la
impresión de que ya se recibió algo cuando no pasó nada todavía.

## Objetivo

El lado RECIBIDO pasa por 3 fases visuales según el avance real de la orden
(o de toda la familia, si es un split), sin cambios de backend — todo el dato
necesario ya viaja en `ProductionRun` (`stages`, `acta_lines`, `products`).

## Fases

Función pura `actaRightPhase()` en `frontend/lib/orden-produccion.ts`:

```ts
export type ActaRightPhase = "NO_APROBADO" | "SOLO_PRODUCTO" | "CONSTRUYENDO";

export function actaRightPhase(params: {
  approved: boolean;
  stages: Pick<ProductionRunStage, "requires_weighing" | "status">[];
  hasRecepcionLines: boolean;
}): ActaRightPhase {
  if (!params.approved) return "NO_APROBADO";
  const hasWeighedStage = params.stages.some(
    (s) => s.requires_weighing && s.status === "FINALIZADA"
  );
  if (hasWeighedStage || params.hasRecepcionLines) return "CONSTRUYENDO";
  return "SOLO_PRODUCTO";
}
```

| Fase | Cuándo | Lado RECIBIDO muestra |
|---|---|---|
| `NO_APROBADO` | `approved = false` | Sin tabla. Texto: **"Aún no aprobado por inventario"** |
| `SOLO_PRODUCTO` | Aprobado, ninguna etapa que pesa terminó, sin devoluciones | Sin tabla. Título **"Producto resultante"** + lista `nombre (cantidad und)` unidas por " · " (mismo formato que `RunSummaryRows` en `solicitudes-view.tsx:91-96`); si `products` viene vacío (caso anómalo, no debería pasar dado que se declara al crear la orden) se muestra "—" |
| `CONSTRUYENDO` | Aprobado y (alguna etapa `requires_weighing` en `FINALIZADA`, o existe al menos una línea de RECEPCION real) | Tabla actual sin cambios: filas + `recepcionTotalRows` (Total recibido / Merma total) |

El trigger de `CONSTRUYENDO` usa "etapa que pesa y terminó", no "merma > 0":
una etapa que pesa y cierra con 0% de merma es avance real igual, y no debe
dejar la orden pegada en `SOLO_PRODUCTO`.

Familias históricas (`event_lines` no vacío) y canceladas quedan **fuera** de
esta lógica — se comportan exactamente igual que hoy (esta pieza no las toca).

## Nivel corrida individual (Ver acta)

`acta-view.tsx` calcula la fase con los datos de la corrida sola:
- `approved = run.materials_approved_at !== null`
- `stages = run.stages`
- `hasRecepcionLines = (run.acta_lines ?? []).some(l => l.side === "RECEPCION")`

`ActaDocSide` del lado RECIBIDO (la llamada en `ActaView` con
`title="RECIBIDO"`) recibe la fase; si es distinta de `CONSTRUYENDO` no
renderiza `<table className="opTable">` (headers incluidos) — en su lugar un
bloque de texto simple dentro de `.opCol` con el aviso o la lista de
`run.products`. El título de columna "RECIBIDO" y su subtítulo
fecha/responsable **se mantienen** siempre (siguen siendo `—` hasta que haya
`received_at` real). Las acciones (`RecepcionActions`/devolver sobrante) se
siguen mostrando igual — devolver sobrante ya empuja a `CONSTRUYENDO` en el
siguiente render porque agrega una línea RECEPCION real.

## Nivel familia (Documentos, splits)

`buildOrdenProduccion` en `orden-produccion.ts` calcula la fase para toda la
familia y la agrega a `OrdenProduccionModel` como campo `recepcionPhase:
ActaRightPhase`:

- `approved = canPrintEntrega(family)` (mismo criterio que ya usa el botón
  "Imprimir entrega": nadie en `PENDIENTE_INVENTARIO`/`ESPERANDO_MATERIAL`).
- `stages` = concatenación de `stages` de todos los miembros de la familia.
- `hasRecepcionLines` = concatenación de `acta_lines` de todos los miembros,
  `.some(l => l.side === "RECEPCION")`.
- Lista de "Producto resultante": concatenar `products` de todos los
  miembros (un split reparte el plan entre padre e hijas — ver
  `service.py:810-824`), agrupar por identidad (`product_type_id` ??
  `target_item_id` ?? `product_name`) sumando `quantity`, formatear igual que
  `RunSummaryRows`. Nuevo campo `productosResultantes: string` (ya formateado,
  string vacío si no hay) en `OrdenProduccionModel`.

Si `isHistorical`, `recepcionPhase` se fuerza a `"CONSTRUYENDO"` (comportamiento
actual intacto, tabla siempre visible con `event_lines`).

`OrdenProduccionDoc` → `SideColumn` del lado RECIBIDO: mismo reemplazo que en
`acta-view.tsx` — si `model.recepcionPhase !== "CONSTRUYENDO"` no renderiza la
tabla, muestra el aviso o `model.productosResultantes`.

## Qué NO cambia

- Ningún campo ni endpoint de backend.
- El lado ENTREGADO: sin cambios en ninguna fase (sigue mostrando lo que
  siempre mostró, incluida su tabla vacía con filas en blanco antes de
  aprobar).
- `canPrintEntrega`/`canPrintRecepcion` (habilitar botones de impresión): sin
  cambios — siguen gobernando qué se puede imprimir, independiente de qué se
  ve en pantalla.
- `computeBalanceTotals` / el cálculo de `entregaTotalRows` /
  `recepcionTotalRows`: sin cambios en su lógica interna. Solo se deja de
  *renderizar* la tabla que los contendría mientras la fase no sea
  `CONSTRUYENDO` (aunque el cálculo exista, no se muestra).

## Testing

Es un cambio 100% frontend, sin lógica de negocio nueva en backend — no
aplica `pytest`. Verificación:
- `docker-compose exec web npx tsc --noEmit -p tsconfig.json` sin errores.
- Manual en navegador (3 escenarios, una orden real por cada fase):
  1. Orden recién creada (`PENDIENTE_INVENTARIO`): Ver Acta y Documentos
     muestran "Aún no aprobado por inventario" del lado derecho.
  2. Orden con materiales aprobados, ninguna etapa terminada: lado derecho
     muestra "Producto resultante" con la lista correcta.
  3. Terminar una etapa que pesa (o devolver un sobrante): lado derecho pasa
     a la tabla real con totales, igual que hoy.
