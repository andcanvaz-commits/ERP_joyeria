# Producto terminado derivado del sistema + quitar pestaña Codificación

Fecha: 2026-07-06
Estado: parcialmente reemplazado — la sección 2 (form derivado de procesos) fue reemplazada por `2026-07-06-productos-terminados-modelos-design.md`. La sección 1 (quitar Codificación) sigue vigente.

## Decisiones

### 1. Quitar pestaña Codificación

- Sale del sidebar (`app-shell.tsx`), del mapa de títulos y de las rutas por rol (`roles.ts`).
- Se elimina la ruta `app/(app)/codificacion/`.
- Se conservan intactos: componente `catalog-dashboard.tsx`, `lib/catalog-api.ts` y todo el backend `modules/catalog` (la lógica de códigos de producto sigue viva; `product_code` en items no cambia).

### 2. Form de producto terminado construido desde lo existente

En `finished-products-manager.tsx`:

| Campo | Comportamiento |
|---|---|
| Tipo de producto | select de procesos (`listProcesses`) |
| Metal (materia prima) | select limitado a las materias primas configuradas en el proceso elegido (`process.materials` → lookup en items RAW_MATERIAL) |
| Ley/pureza | solo lectura, `purity` de la materia prima seleccionada |
| Producto (nombre) | prellenado `{proceso} {materia prima}` al elegir; editable |
| Peso total (g) | manual (dato físico) |
| Descripción | manual opcional |

- El metal ES la materia prima: se guarda `material_type = nombre del item` y `purity = purity del item`. Payload al backend sin cambios de esquema.
- Crear: proceso y materia prima obligatorios.
- Editar: mismos selects; si el usuario no re-elige, se conservan los valores actuales del item.
- Cadena de negocio: proceso → limita materias primas → materia prima fija metal y pureza. Evita productos inconsistentes.

## Fuera de alcance

- Asignar `product_code` (codificación) automáticamente al crear producto.
- Cambios de backend.
