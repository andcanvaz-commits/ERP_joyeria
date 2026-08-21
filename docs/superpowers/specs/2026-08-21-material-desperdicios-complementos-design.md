# Material en Desperdicios y Complementos, y filtro por material en el picker de actas

2026-08-21. Pedido de Rodrigo.

## Contexto

Los items `WASTE` (Desperdicios) ya tienen columna `material_type` (string,
nullable) pero `WasteManager` la expone como input de texto libre. Los items
`COMPLEMENT` tienen la misma columna disponible en el modelo/schema pero
`ComplementsManager` la manda siempre en `null` -- no hay forma de cargarla
desde la UI.

`MaterialCategoryPicker` (el selector que se abre para agregar líneas
ENTREGA/RECEPCION en una etapa o vía "Agregar" del acta) agrupa hoy
Complementos por `complement_type_id` y Terminados por categoría de catálogo,
pero no tiene ningún filtro por material -- con varios materiales cargados
(oro, plata) todo aparece revuelto en una sola lista.

## Cambios

### 1. WasteManager -- material por selector, no texto libre

El campo "Material" del formulario de crear/editar desperdicio pasa de
`<input type="text">` a `<select>`. Opciones:

- Una por cada valor distinto de `material_type` (con fallback a `name`
  cuando no tiene `material_type`) entre las materias primas activas del
  inventario (`listInventoryItems("RAW_MATERIAL")`), sin duplicados,
  ordenadas alfabéticamente.
- "No aplica" al final -- selecciona esta opción y el payload manda
  `material_type: null` (igual que hoy si se deja vacío).

No hay opción de escribir un material nuevo a mano: si el material no existe
todavía, primero se crea como materia prima. Es intencional -- evita que
Desperdicios acumule variantes del mismo material por typos ("Oro" vs "oro"
vs "ORO 18k") que después el picker no puede agrupar bien.

### 2. ComplementsManager -- material como texto libre

Se agrega un input de texto libre "Material" (opcional, placeholder "Ej. Oro,
Plata") al paso 2 del formulario ("Crear un complemento"), junto a Nombre.
Se manda como `material_type: value.trim() || null`. Sin selector ni opción
"No aplica" explícita -- vacío ya significa sin material. No se agrega edición
de material a complementos existentes (`ComplementsManager` no tiene modo
edición hoy; fuera de alcance).

### 3. MaterialCategoryPicker -- sub-pestañas por material

Para los tabs `WASTE` y `COMPLEMENT` (los dos únicos con `material_type`
relevante para este filtro), debajo de la barra de tabs de tipo aparece una
segunda barra de sub-pestañas, **solo si hay más de un valor distinto de
material entre los items de ese tipo**:

- "Todos" (activa por defecto) -- comportamiento actual, sin filtrar.
- Una por cada `material_type` distinto presente entre los items de ese tab
  (orden alfabético).
- "Sin material" -- solo si existe al menos un item de ese tab con
  `material_type` nulo/vacío.

Elegir una sub-pestaña filtra `candidates` a items de exactamente ese
material (o sin material) antes de cualquier otro agrupamiento -- en
Complementos, el drill-down por tipo (broches, cadenas base, etc.) sigue
funcionando igual mostrando solo los tipos/piezas del material elegido.
Cambiar de tab de tipo (Desperdicios ↔ Complementos ↔ etc.) resetea la
sub-pestaña a "Todos".

Si todos los items de ese tab comparten el mismo material (o ninguno tiene
material), no se muestra la barra de sub-pestañas -- no tiene nada que
filtrar.

## Fuera de alcance

- No se migra ni normaliza el `material_type` de los desperdicios/complementos
  ya existentes -- las sub-pestañas simplemente los agrupan tal como están
  hoy (incluido "Sin material" para los que no tengan valor).
- No se toca el backend: `material_type` ya acepta cualquier string o null en
  `InventoryItemCreate`/`InventoryItemUpdate` para los tres tipos.
- No se agrega edición de material a Complementos (`ComplementsManager` no
  tiene modo edición para ningún campo hoy).
