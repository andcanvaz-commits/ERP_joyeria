# Documento "Orden de Producción" — diseño

**Fecha:** 2026-06-30
**Base:** `actas.md` (spec del comprobante) + flujo de producción/inventario.

## Objetivo

Generar el comprobante "Orden de Producción" (talonario horizontal, tinta azul) a
partir de los datos reales de una orden, imprimible por mitades en la misma hoja:

1. Producción crea la orden → sistema calcula MP y genera solicitud de consumo.
2. Inventario aprueba la salida de MP → se imprime la **mitad ENTREGADO** (izquierda).
3. Producción ejecuta y finaliza.
4. Inventario recibe el producto terminado → se imprime la **mitad RECIBIDO** (derecha)
   sobre la **misma hoja**.
5. En `/documentos` queda el documento **completo** con toda la información de la
   sesión donde se generó (ambos responsables, fechas, filas y totales).

## Responsables (requisito)

- **Responsable de producción** = cuenta que creó/ejecutó la orden (`created_by_user_id`).
- **Responsable de inventario** = cuenta autenticada que **aprobó** (mitad entrega) y la
  que **recibió** (mitad recepción).

El backend hoy NO guarda quién aprobó/recibió. Se extiende (auditoría, no cambia reglas
de producción).

## Cambios de backend (mínimos, aditivos)

`backend/modules/production/`:

- **models.py** — `ProductionRun`: agregar
  `materials_approved_by_user_id: UUID | None`, `received_by_user_id: UUID | None`.
- **app/main.py** — tras `create_all`, ejecutar idempotente (no hay Alembic):
  `ALTER TABLE production_runs ADD COLUMN IF NOT EXISTS materials_approved_by_user_id UUID;`
  y la análoga para `received_by_user_id`. (Postgres soporta `IF NOT EXISTS`.)
- **service.py**
  - `approve_materials(run_id, current_user)`: setear
    `run.materials_approved_by_user_id = current_user.id`.
  - `receive_finished_product(run_id, current_user)`: nuevo parámetro; setear
    `run.received_by_user_id = current_user.id`.
  - Al mapear a `ProductionRunRead`, resolver nombres de aprobador/receptor con
    `_resolve_run_user_names` (igual que `created_by_name`).
- **router.py** — `receive_finished_product` ya tiene `current_user`; pasarlo al servicio.
- **schemas.py** — `ProductionRunRead`: `materials_approved_by_name`, `received_by_name`
  (`str | None`).

## Cambios de frontend

### Datos
- **types/production**: `ProductionRun` += `materials_approved_by_name?`, `received_by_name?`.

### Mapeo `ProductionRun` → modelo del documento
| Campo doc | Origen |
|---|---|
| Folio Nº (rojo) | `production_code` |
| Responsable producción | `created_by_name` |
| Responsable inventario (entrega) | `materials_approved_by_name` |
| Responsable inventario (recepción) | `received_by_name` |
| Categoría/material (barra azul der.) | vacío/parametrizable (default nombre de MP resuelto) |
| ENTREGADO — fecha | `materials_approved_at` |
| ENTREGADO — filas | MP principal `{gramos: total_required_material, detalle: nombre MP}` + ingredientes de etapa (`stages[].ingredients`, nombre resuelto vía mapa de inventario) si existen |
| ENTREGADO — TOTAL | suma automática de gramos |
| RECIBIDO — fecha | `received_at` |
| RECIBIDO — filas | Producto terminado `{gramos: actual_finished_weight, detalle: process_name}` + Merma `{gramos: waste_weight, detalle: "Merma"}` |
| RECIBIDO — TOTAL | suma automática |
| Sello CANCELADO | si `status == "CANCELADA"` |

Nombres de MP/ingredientes se resuelven con un mapa `inventory_item_id → name`
(`listInventoryItems`, ya usado por los dashboards).

### Componentes
- `lib/orden-produccion.ts` — `buildOrdenProduccion(run, itemMap)` → modelo + totales.
- `components/documentos/orden-produccion-doc.tsx` — documento presentacional puro.
  Props: `{ model, mode: "entrega" | "recepcion" | "completo" }`.
- `components/documentos/documentos-dashboard.tsx` — cliente: lista de órdenes,
  selección, vista previa en pantalla y botones Imprimir (entrega/recepción/completo) →
  `window.print()`.
- `app/documentos/page.tsx` — monta el dashboard dentro de `AppShell`.

### Impresión por mitades en la misma hoja
El documento se renderiza **idéntico** en los tres modos; el modo solo controla qué
lleva tinta vía `visibility` (preserva el layout → alineación garantizada al reinsertar):
- `entrega`: todo visible, columna RECIBIDO con celdas de datos en blanco.
- `recepcion`: solo los datos de RECIBIDO visibles; el resto `visibility: hidden`
  (ocupa el mismo espacio, sin tinta) → sobreimprime alineado.
- `completo`: todo visible (preview, PDF, copia íntegra).

CSS en `globals.css`: `@page { size: landscape }`, `@media print` que oculta el chrome
del app y muestra solo el contenedor del documento; clases `docMode-*` con las reglas de
visibilidad.

### Disparadores (ambos)
- **Contextual (flujo):** en `inventory-dashboard` (solicitudes):
  - Tras **aprobar** materiales → abrir vista previa + imprimir **entrega**. Responsable
    inventario = usuario actual (y queda persistido por el backend).
  - Tras **recibir** producto → abrir vista previa + imprimir **recepción**.
- **Central:** `/documentos` → seleccionar orden → ver/imprimir **completo** (o cualquier
  mitad), con ambos responsables y todas las fechas.

Disponibilidad: entrega si `materials_approved_at`; recepción/completo si `received_at`.

## Estética del documento

Facsímil del talonario, **independiente del tema oro del ERP**: tinta azul (`#1c3f7a`)
sobre blanco, orientación **landscape**, barra de título azul redondeada con texto blanco,
folio en rojo, dos columnas espejo (ENTREGADO / RECIBIDO) con tablas FECHA·GRAMOS·DETALLES,
filas reticuladas, línea de subtotal y `TOTAL:` al pie de cada columna. Tipografía:
sans para datos; números tabulares en GRAMOS.

## Multi-sesión y auditoría de acciones (requisito)

La app se usará con **cuentas y sesiones distintas** (inventario y producción, además de
admin), sobre la **misma base de datos**:

- El compartir información entre sesiones **ya funciona** server-side: las solicitudes y
  órdenes viven en la DB y se exponen por API; cada acción está protegida por permisos de
  rol (`Jefe de inventario`, `Jefe de producción`, admin). Cualquier cuenta de inventario
  activa ve las solicitudes pendientes; cualquier cuenta de producción ve los procesos y
  ejecuta según permiso.
- Para que los cambios de una sesión aparezcan en otra sin recargar, los dashboards hacen
  **refetch periódico** (polling ligero) de runs/solicitudes. (Mejora de usabilidad, no de
  lógica.)

**Atribución por acción** — siempre se registra qué cuenta hizo cada cosa. Columnas
nullable `*_by_user_id` seteadas desde `current_user` (ya disponible en los routers):

| Acción | Dónde se guarda |
|---|---|
| Crear orden | `production_runs.created_by_user_id` (ya existe) |
| Iniciar producción (`start_run`) | `production_runs.started_by_user_id` (nuevo) |
| Aprobar materiales | `production_runs.materials_approved_by_user_id` (nuevo) |
| Recibir producto | `production_runs.received_by_user_id` (nuevo) |
| Avanzar/finalizar etapa (`finish_stage`) | `production_run_stages.finished_by_user_id` (nuevo) |

`schemas.py` expone los nombres resueltos: `started_by_name`, `materials_approved_by_name`,
`received_by_name` (run) y `finished_by_name` (stage). El documento usa
creador/aprobador/receptor; el resto queda registrado y disponible para auditoría y la
línea de tiempo de etapas (UI futura). Pasar `current_user` a `start_run` y `finish_stage`
en el router.

## No-objetivos
- No se cambian reglas de cálculo de producción, merma ni inventario (solo se leen).
- No se agrega Alembic ni se reescribe la persistencia; columnas vía `ADD COLUMN IF NOT EXISTS`.
- No se agregan librerías de PDF; impresión nativa del navegador.

## Criterios de aceptación
- Aprobar materiales imprime la mitad ENTREGADO con responsable de inventario correcto.
- Recibir producto imprime la mitad RECIBIDO alineada sobre la misma hoja.
- `/documentos` muestra el documento completo con ambos responsables, fechas, filas y
  totales auto-calculados.
- Backend persiste aprobador/receptor; `build` de frontend y arranque de backend OK.
