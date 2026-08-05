# Picker de materiales en procesos (materia prima / complementos / merma)

## Problema

Mantenimiento de procesos usa `<select>` planos para elegir materiales del proceso y
de cada etapa, agregando uno por uno. Se pide reemplazar por una vista tipo
Inventario (tabs por categoría + búsqueda + tabla) para elegir material y cantidad
por unidad. Además, en Producción, al crear una orden el `<select>` de material
lista todas las materias primas del sistema en vez de solo las configuradas en el
proceso elegido.

## Alcance

1. Nivel proceso: picker con tabs Materia prima / Complementos / Merma (RAW_MATERIAL,
   COMPLEMENT, WASTE). Reemplaza el `<select>` en "Materias primas del proceso".
2. Nivel etapa: mismo componente picker, pero solo tab Insumos (SUPPLY). Reemplaza
   el `<select>` en "Materiales que entran en esta etapa". No se mezcla con el nivel
   de proceso.
3. Producción → Crear orden: el `<select>` "Material" se filtra a los items
   configurados en `selectedProcess.materials` (ya no a todos los RAW_MATERIAL del
   sistema). Sigue siendo un `<select>` simple, sin picker (lista corta por proceso).

Fuera de alcance: no se toca el modelo de `AssemblyRecipe`/complementos de ensamble,
ni el flujo de selección de complementos al crear una orden en modo ENSAMBLAR.

## Backend

`backend/modules/production/service.py::_validate_materials` (usada por
`create_process` y `update_process`) hoy permite `item_type in ("RAW_MATERIAL",
"SUPPLY")` para `process.materials`. Se cambia a `("RAW_MATERIAL", "COMPLEMENT",
"WASTE")`: se quita `SUPPLY` (nunca fue alcanzable desde el frontend, que ya
filtraba solo RAW_MATERIAL; insumos quedan exclusivos de etapa) y se agregan
`COMPLEMENT` y `WASTE` (merma reclasificada puede reingresar como material de un
proceso).

`ProductionProcessStageIngredient` (validación de insumos por etapa) no cambia:
sigue exigiendo `SUPPLY` vía el `<select>` filtrado en frontend (no hay validación
de tipo en backend para stage ingredients hoy — se mantiene así, el picker nuevo
solo ofrece SUPPLY como antes).

`create_run` (línea ~438): el fallback que permite elegir una materia prima fuera
de `process.materials` sigue existiendo (compatibilidad), pero deja de ser
alcanzable desde el nuevo `<select>` de Producción, que solo ofrece opciones ya
configuradas en el proceso.

Sin cambios de schema/DB — `ProductionProcessMaterial.inventory_item_id` ya acepta
cualquier item del inventario, la restricción es solo de validación de negocio.

## Frontend

### Componente nuevo: `frontend/components/production/material-category-picker.tsx`

Modal (mismo patrón visual que `FinishedItemPicker`): tabs por `item_type` (según
`allowedTypes` recibido), buscador por nombre/SKU, tabla (Nombre, Tipo, Stock,
Unidad), clic en fila = `onSelect(item)`. Excluye `excludeIds` (materiales ya
elegidos, evita duplicados — coincide con la validación backend "no repitas la
misma materia prima").

Props:
```ts
{
  title: string;
  items: InventoryItem[];       // pool ya cargado, se filtra client-side
  allowedTypes: InventoryItemType[]; // ["RAW_MATERIAL","COMPLEMENT","WASTE"] o ["SUPPLY"]
  excludeIds: string[];
  onSelect: (item: InventoryItem) => void;
  onClose: () => void;
}
```

### `production-dashboard.tsx` — carga de datos

`fetchProductionBundle` (línea ~176): variant `"maintenance"` hoy no trae
`COMPLEMENT` ni `WASTE`. Se agregan esas dos listas también para maintenance (ya se
traen para variant production). Se construye un mapa `itemsById` combinando todas
las listas cargadas (RAW_MATERIAL + SUPPLY + COMPLEMENT + WASTE + FINISHED_PRODUCT)
para resolver nombre/stock/unidad por id en ambos lugares que lo necesitan (líneas
de materiales del proceso, y el `<select>` filtrado de Producción).

### Mantenimiento — "Materias primas del proceso" (línea 3081-3139)

Se reemplaza el bloque `form.materials.map` (select + input inline) por:
- Tabla de líneas ya elegidas: Material | Tipo | Cantidad por unidad (input
  editable) | Unidad | Quitar.
- Botón "Agregar material" abre `MaterialCategoryPicker` con
  `allowedTypes={["RAW_MATERIAL","COMPLEMENT","WASTE"]}` y
  `excludeIds={form.materials.map(m => m.inventoryItemId)}`.
- `onSelect` hace push a `form.materials` con `quantityPerUnit: ""` y
  `unitCode: item.unit_code`, cierra el picker.

`addProcessMaterial`/`removeProcessMaterial`/`updateProcessMaterial` (helpers ya
existentes) se reutilizan tal cual — solo cambia cómo se agrega la fila (picker en
vez de select vacío pre-poblado).

### Mantenimiento — "Materiales que entran en esta etapa" (línea 3296-3375)

Mismo tratamiento: tabla de líneas (Insumo | Cantidad | Unidad | Quitar) + botón
"Agregar material" que abre el mismo `MaterialCategoryPicker` con
`allowedTypes={["SUPPLY"]}` y `excludeIds` de los insumos ya elegidos en esa etapa.
Se mantiene la regla de "sin stock no se puede elegir" (picker excluye o deshabilita
items con `current_stock <= 0`, igual que hoy).

### Producción — Crear orden (línea 2074-2084)

El `<select>` "Material" deja de iterar `rawMaterials.filter(RAW_MATERIAL)` global.
Pasa a iterar `selectedProcess.materials`, resolviendo cada uno contra `itemsById`
para mostrar nombre/stock/unidad. Si un material del proceso ya no existe en
inventario (borrado), se omite de la lista (no debería pasar por integridad
referencial, pero se filtra por defensividad mínima — un `.filter(Boolean)`, no
manejo de error visible).

## Testing

- Backend: extender test existente de creación/edición de proceso (o agregar caso)
  cubriendo que `COMPLEMENT` y `WASTE` son aceptados como `process.materials`, y que
  `SUPPLY` ahora es rechazado a nivel de proceso.
- Frontend: sin suite de tests de componentes en este proyecto (verificación manual
  vía `npm run build`/`tsc` + revisión visual del usuario, como en trabajo previo).
