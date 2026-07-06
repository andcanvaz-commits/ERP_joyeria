# Tabla de productos en proceso (inventario)

Fecha: 2026-07-06
Estado: aprobado

## Contexto

En la pestaña "Producto en proceso" del inventario (`frontend/components/inventory/inventory-dashboard.tsx`), las órdenes en proceso se muestran hoy como filas de lista simple (código + proceso + cantidad). No se ve la etapa actual sin abrir el detalle.

## Decisión

Reemplazar la lista por una tabla con el mismo patrón visual que la tabla de productos terminados (scroll interno, `tableWrap`).

### Columnas

| Columna | Fuente | Formato |
|---|---|---|
| Código | `production_code` | tag de código (`orderCodeTag`); vacío si null |
| Proceso | `process_name` | texto |
| Cantidad | `quantity` | `N und` |
| Etapa actual | etapa con status `EN_PROCESO`, o primera `PENDIENTE` si ninguna corre; `—` si no hay ninguna | `nombre (orden/total)` |
| Inicio | `started_at` | fecha corta `dd/mm hh:mm` |
| Acción | — | botón Visualizar (abre detalle existente `setViewingRun`) |

### Reglas

- Filas: órdenes con `status === "EN_PROCESO"` (mismo filtro actual).
- Sin peso esperado ni merma en la tabla: viven en el detalle.
- Estado vacío: "No hay productos en proceso."
- Estado de carga: mismo patrón "Cargando inventario..." de las otras pestañas.
- Sin cambios de backend: todos los datos ya vienen en `ProductionRun`.

## Fuera de alcance

- Cambios en las pestañas de materia prima y producto terminado.
- Cambios en el modal de detalle de la orden.
