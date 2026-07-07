# Codificación de catálogo para productos terminados

Fecha: 2026-07-06
Estado: aprobado

## Problema

Las 178 piezas de productos terminados tienen SKU secuencial `PT-NNNN` y `product_code` vacío. No cumplen la lógica de codificación establecida: **material (1 dígito) + categoría (2 dígitos) + modelo (4 dígitos)** — ej. `2060004` = PLATA · CADENA · BB (ver `backend/modules/catalog/service.py`, `KIND_WIDTH`).

## Decisión

Migración de datos Alembic (sin cambios de esquema) que completa el catálogo y recodifica las piezas.

### 1. Completar catálogo (`catalog_segments`)

- Categorías nuevas (kind `CATEGORY`, sin padre): `30 DIJES`, `31 JUEGOS`.
- Modelo genérico `VARIOS` (kind `MODEL`) en cada categoría usada por los grupos actuales, con el siguiente código de 4 dígitos libre dentro de la categoría. Si la categoría ya tiene un modelo llamado `VARIOS`, se reutiliza.

### 2. Mapeo de grupos a categorías

| `name` de las piezas | Categoría |
|---|---|
| ANILLOS DE FILIGRANA - VARIOS | 02 ANILLOS |
| ARETES | 01 ARETES |
| CADENAS | 06 CADENA |
| COLLARES | 29 COLLAR |
| DENARIOS | 11 DENARIOS |
| DIJES | 30 DIJES (nueva) |
| JUEGOS | 31 JUEGOS (nueva) |
| MEDALLAS | 14 MEDALLA |
| MONEDAS | 28 MONEDAS |
| PULSERAS VARIAS | 20 PULSERAS |
| ROSARIOS | 21 ROSARIOS |

Material: todas las piezas son PLATA → dígito `2`.

### 3. Recodificar piezas (`inventory_items`, item_type FINISHED_PRODUCT)

- `product_code` = `2` + código de categoría + código del modelo VARIOS (7 dígitos, ej. `2010002`).
- `sku` = `product_code` + `-` + secuencia de 4 dígitos por modelo, ordenada por el SKU `PT-NNNN` actual (ej. `2010002-0001`, `2010002-0002`, ...).
- Los movimientos de kardex no se tocan (referencian `item_id`).
- Solo se recodifican piezas con SKU `PT-%`; items creados por recepción de producción (sku = código OP) quedan igual.

### 4. Seguridad

- `pg_dump` manual justo antes de aplicar la migración.
- Verificación posterior: 178 piezas con `product_code` de 7 dígitos, SKUs únicos, mismos totales de stock.
- Downgrade no restaura los SKU `PT-NNNN` (documentado en la migración); el dump es el camino de vuelta.

## Fuera de alcance

- Selector UI para reasignar modelo pieza a pieza (mejora futura).
- Codificación automática de items futuros creados por recepción de producción.
- Cambios de UI (las tablas ya muestran `sku`).
