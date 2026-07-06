# Productos terminados agrupados en Inventario + quitar mantenimiento

Fecha: 2026-07-06
Estado: aprobado

## Problema

La pestaña Productos terminados de Inventario lista 178 piezas planas; el nombre se repite como categoría (ARETES ×31...) y es difícil de leer. Además, el mantenimiento de productos terminados en Mantenimientos duplica un listado que no aporta: los productos entran por producción, no por mantenimiento.

## Decisión

### 1. Vista agrupada en Inventario (`inventory-dashboard.tsx`)

En la pestaña Productos terminados, la tabla agrupa por `name`:

- Fila de grupo: chevron + nombre + `N piezas · X g` (suma de `current_stock` del grupo).
- Clic en la fila de grupo alterna expandido/colapsado (estado local `Set<string>` de nombres expandidos).
- Expandido: sub-filas con las piezas del grupo — Descripción (modelo), Ley/pureza, Stock, acción "Visualizar" (modal existente).
- Estado inicial: todos colapsados.
- Búsqueda activa (campo existente): se muestran solo los grupos con piezas que coinciden y esos grupos se renderizan expandidos.
- Se agrupa sobre `displayItems` (conserva el filtro `receivedCodes` existente).

### 2. Eliminar mantenimiento de productos terminados

En `production-dashboard.tsx` (vista Mantenimientos):

- Se elimina la sección "Productos terminados" (tiles crear/listar).
- Se elimina `"finished"` del tipo del estado `dataModal` y el render del modal correspondiente.
- Se elimina la query `finishedProductsList` (solo alimentaba el contador del tile).
- Se elimina el import y el archivo `frontend/components/mantenimiento/finished-products-manager.tsx`.

## Fuera de alcance

- Cambios de backend o de datos.
- Edición/creación manual de productos terminados (entran por recepción de producción).
