# Pestaña "Órdenes terminadas" en Inventario

Fecha: 2026-07-06
Estado: aprobado

## Problema

Las órdenes de producción recibidas (status `RECIBIDA`) se pintan hoy como filas mezcladas dentro de la tabla de productos terminados en Inventario. Son cosas distintas: una orden terminada no es un producto terminado.

## Decisión

Todo en `frontend/components/inventory/inventory-dashboard.tsx`; sin cambios de backend.

### 1. Nueva pestaña

Al selector segmentado de Inventario se agrega la opción **"Órdenes terminadas"** (valor de filtro local `"ORDENES_TERMINADAS"`; no es un `item_type` de inventario).

### 2. Contenido de la pestaña

Tabla con las órdenes de producción en estado `RECIBIDA` (ya cargadas vía `listProductionRuns`; hoy filtradas como `receivedRuns`). Columnas:

| Columna | Fuente |
|---|---|
| Código | `production_code` |
| Proceso | `process_name` |
| Cantidad | `quantity` |
| Peso final | `actual_finished_weight` |
| Merma % | `waste_percent` |
| Recibida por | `received_by_name` |
| Fecha recepción | `received_at` |
| Acción | "Visualizar" — reusa el modal de orden existente (`setViewingRun`) |

Subtítulo del panel para la pestaña: "Órdenes de producción recibidas en inventario".

### 3. Limpieza de productos terminados

Las filas `receivedRuns` se eliminan de la tabla de productos terminados; esa tabla queda solo con items `FINISHED_PRODUCT`.

### 4. Salida

El botón "Salida" sigue apareciendo únicamente en la pestaña Producto terminado. La nueva pestaña no tiene acciones de movimiento.

## Fuera de alcance

- Cambios de backend o de datos.
- Acciones sobre las órdenes desde esta pestaña (recepción se mantiene donde está).
