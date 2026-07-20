# Conversión de lotes (procesos terminados) a productos terminados

Fecha: 2026-07-20
Estado: aprobado por Rodrigo (diseño conversado en sesión)

## 1. Contexto

Hoy, cuando el jefe de inventario recibe una orden de producción finalizada
(`POST /api/production/runs/{id}/receive-finished`), se crea un item de inventario
`FINISHED_PRODUCT` cuyo SKU es el código OP y cuyo nombre es el nombre del proceso
(ej. "PLATA CADENA BB"). Ese lote aparece en la pestaña **Procesos terminados**
del panel de inventario. Ahí termina el flujo: el lote nunca se convierte en
productos del catálogo (tipos de producto con material + categoría + modelo).

Se necesita la operación que cierra el ciclo: partir de un lote de proceso
terminado y generar productos terminados del catálogo, de forma parcial y
repetible, siempre mediante movimientos de inventario (nunca edición directa
de stock).

## 2. Alcance

**Incluye:**

- Nueva operación "Convertir" sobre lotes de la pestaña Procesos terminados.
- Conversión parcial 1:1: consumir N unidades del lote → nacen N unidades de un
  tipo de producto. Repetible hasta agotar el lote.
- Dos nuevos tipos de movimiento: `CONVERSION_SALIDA` y `CONVERSION_ENTRADA`.
- Trazabilidad: producto → lote de origen → orden de producción.

**No incluye (fuera de alcance):**

- Acta/comprobante imprimible de conversión en el módulo Documentos (los
  movimientos quedan en kardex; puede agregarse después).
- Casting que consume productos terminados como insumo de producción (diseño
  aparte, pendiente).
- Cambios al flujo de recepción actual (el click "Recibir" queda igual).

## 3. Diseño

### 3.1 Modelo de datos

- Nueva columna nullable en `inventory_items`:
  `source_lot_sku: String(30)` — SKU (código OP) del lote de origen para items
  nacidos por conversión. Migración Alembic.
- Nuevos valores en `InventoryMovementType` (Literal en
  `backend/modules/inventory/schemas.py`):
  - `CONVERSION_SALIDA` → agregar a `NEGATIVE_MOVEMENTS` (service.py:57).
  - `CONVERSION_ENTRADA` → agregar a `POSITIVE_MOVEMENTS` (service.py:56).
- No se crea tabla nueva: la conversión queda registrada por el par de
  movimientos con `reference_type = "lot_conversion"`, donde cada movimiento
  referencia al item contraparte (la salida apunta al item destino y la
  entrada apunta al lote).

### 3.2 Backend

Endpoint nuevo en `backend/modules/inventory/router.py`:

```
POST /api/inventory/lots/{lot_item_id}/convert
Permiso: inventory.movements.create
Payload: {
  material_code: str,      # segmento MATERIAL (1 dígito) del catálogo
  product_type_id: UUID,   # tipo de producto (categoría + modelo + nombre)
  quantity: Decimal > 0
}
```

Lógica en `InventoryService.convert_lot_to_product` (transaccional):

1. Validar lote: existe, `item_type == "FINISHED_PRODUCT"`, tiene SKU de
   producción (es lote de OP), `current_stock >= quantity`.
2. Validar `material_code` contra `CatalogSegment` kind `MATERIAL` y
   `product_type_id` contra `ProductType` activo.
3. Construir `product_code = material_code + category_code + model_code`
   (1 + 2 + 4 dígitos, convención existente).
4. Buscar item destino por `(product_code, source_lot_sku = lote.sku)`:
   - Si existe → se reutiliza (suma stock).
   - Si no → crear item `FINISHED_PRODUCT` con SKU autogenerado (`PT-`),
     `name` = nombre del tipo de producto, `product_code`, `source_lot_sku`,
     `unit_code` = el del lote ("und").
   - Items de lotes distintos nunca se consolidan aunque compartan
     `product_code` (regla existente: piezas se rastrean por lote).
5. Registrar movimientos vía `create_movement` (actualiza stock por delta):
   - `CONVERSION_SALIDA` sobre el lote, cantidad N,
     razón "Conversión a producto {product_code}",
     `reference_type="lot_conversion"`, `reference_id=item_destino.id`.
   - `CONVERSION_ENTRADA` sobre el item destino, cantidad N,
     razón "Conversión desde lote {lote.sku}",
     `reference_type="lot_conversion"`, `reference_id=lote.id`,
     `lot_code = lote.sku`.
6. Devolver item destino actualizado.

Errores de dominio → HTTP 409; lote/tipo inexistente → 404.
Auditoría: la que ya aplique a movimientos de inventario.

### 3.3 Frontend

Pestaña **Procesos terminados** (`inventory-dashboard.tsx`):

- Cada lote con `current_stock > 0` muestra botón "Convertir".
- Modal de conversión:
  - Combo material (segmentos MATERIAL del catálogo).
  - Combo tipo de producto (tipos activos: categoría + modelo + nombre).
  - Campo cantidad: entero > 0, máx = stock restante del lote (visible).
  - Vista previa del `product_code` resultante.
- Al confirmar: llamada al endpoint, refrescar queries de inventario,
  mensaje de éxito. El producto aparece/suma en la pestaña
  **Productos terminados**.
- Lote con stock 0 queda visible como agotado (comportamiento actual de
  stock 0; sin estado nuevo).
- El detalle del item convertido muestra su lote de origen (código OP).

### 3.4 Trazabilidad

Cadena completa consultable por movimientos:

producto (item PT) → `source_lot_sku` → lote (SKU = código OP) →
orden de producción → materiales consumidos → actas de entrega/recepción.

### 3.5 Permisos y roles

- Solo jefe de inventario (y admin): permiso `inventory.movements.create`,
  ya existente y ya asignado a ese rol.
- Jefe de producción no ve ni ejecuta conversiones (frontend oculta,
  backend valida).

## 4. Manejo de errores

- Cantidad > stock del lote → 409 "Stock insuficiente en el lote".
- Lote no es de producción (sin código OP) → 409.
- Tipo de producto inactivo/inexistente → 404/409.
- Material inexistente en catálogo → 409.
- Todo dentro de una transacción: si falla un movimiento, no queda ninguno.

## 5. Pruebas

- Servicio: conversión feliz (lote 20 → 10 convertidas, stock lote 10,
  producto 10), segunda conversión mismo tipo/lote suma al mismo item,
  conversión de tipo distinto crea item aparte, stock insuficiente falla,
  lote inválido falla, transacción atómica.
- Router: permiso requerido (403 sin `inventory.movements.create`).
- Delta de movimientos: `CONVERSION_SALIDA` resta, `CONVERSION_ENTRADA` suma.

## 6. Criterios de aceptación

- Jefe de inventario convierte parcialmente un lote en productos del catálogo
  desde la pestaña Procesos terminados.
- Todo cambio de stock queda como movimiento en kardex; nada de edición manual.
- Producto convertido conserva referencia a su lote y orden de producción.
- Conversiones repetidas agotan el lote hasta stock 0.
- Producción no puede convertir; inventario sí.
