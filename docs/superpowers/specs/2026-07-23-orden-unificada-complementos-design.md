# Diseño: Orden de producción unificada, split de resultantes y complementos

Fecha: 2026-07-23
Estado: Aprobado por Rodrigo

## Objetivo

Unificar la creación de la orden de producción en una sola modal que incluya la
asignación del producto resultante (hoy vive en "procesos terminados"), permitir
que una producción genere varios productos finales (split), agregar solicitud de
complementos de inventario a la orden, y hacer que la recepción de inventario
cree los productos finales directamente al aceptar el acta.

## 1. Modal "Crear orden" (frontend, producción)

- El panel actual "Nueva orden" (`frontend/components/production/production-dashboard.tsx:1219`)
  se reemplaza por un único botón **Crear orden** que abre una modal.
- Campos de la modal:
  - **Proceso**: combo de procesos activos (desde BD, nunca quemados en código).
  - **Material**: combo de materias primas metal con stock disponible. Define el
    metal de la producción; los productos finales heredan material/pureza según
    la regla de gramos dominantes ya vigente.
  - **Cantidad a fabricar**: número de piezas.
  - **Productos resultantes**: lista de filas `[tipo de producto del catálogo] + [cantidad]`
    con botón "+ agregar producto". Una producción de 10 puede declarar 5 + 5.
    Validación: la suma de cantidades debe igualar la cantidad a fabricar.
    El selector usa los tipos de producto existentes (tipo + categoría + nombre).
  - **Solicitar complementos** (botón): abre la vista de inventario filtrada a la
    pestaña "Complementos"; se eligen n ítems con n cantidades. Quedan adjuntos a
    la orden como solicitud en estado PENDIENTE.
- El plan de resultantes es **ajustable después de crear la orden** (por el jefe
  de producción) mientras la orden no haya sido recibida por inventario.

## 2. Backend: datos y endpoints

### Tabla nueva `production_run_products`

| Campo | Tipo | Nota |
|---|---|---|
| id | PK | |
| run_id | FK production_runs | |
| product_type_id | FK tipos de producto | |
| quantity | int | > 0 |

- Reemplaza al campo único `ProductionRun.target_product_type_id`
  (`backend/modules/production/models.py:174`), que queda deprecado. Migración
  Alembic: crear tabla y copiar `target_product_type_id` existente como fila
  única con la cantidad de la orden.
- `ProductionRunCreate` (`backend/modules/production/schemas.py:118`) acepta
  lista `products: [{product_type_id, quantity}]`; validación Pydantic de suma.
- Endpoint para editar el plan mientras la orden no esté recibida
  (PUT sobre la orden o subrecurso `/products`).

### Tabla nueva `production_complement_requests`

| Campo | Tipo | Nota |
|---|---|---|
| id | PK | |
| run_id | FK production_runs | |
| item_id | FK ítem de inventario (COMPLEMENT) | |
| quantity | numérico | > 0 |
| status | PENDIENTE / APROBADA / RECHAZADA | |
| approved_by / approved_at | FK usuario, timestamp | al resolver |

- Flujo: producción crea solicitud PENDIENTE al crear la orden (o después).
  El jefe de inventario la ve y aprueba o rechaza. Al aprobar se genera el
  movimiento de inventario `CONSUMO_PRODUCCION` del complemento (transacción,
  kardex, referencia a la orden). Nunca se descuenta stock sin movimiento.

### Pestaña "Complementos" en inventario

- Nuevo `item_type = "COMPLEMENT"`, SKU con prefijo `CO-`.
- Misma lógica de pestañas existente (como insumos `IN-`): listado, stock,
  archivados, semáforo, kardex.

### Recepción directa a productos finales

- `receive_finished_product` (`backend/modules/production/service.py:770`,
  endpoint `POST /api/production/runs/{run_id}/receive-finished`) cambia:
  al aceptar la recepción y generar el acta, se crean directamente los
  productos finales según el plan de `production_run_products`, con material
  heredado por gramos dominantes y movimientos `INGRESO_PRODUCCION`.
- Desaparece el paso manual "Agregar al catálogo" / convertir lote para
  producciones nuevas. La conversión de lotes queda solo para lotes antiguos
  ya existentes.
- El acta de recepción incluye: productos resultantes creados, pesos/mermas y
  complementos aprobados/consumidos de la orden.

## 3. Procesos terminados

- Deja de asignar producto resultante (esa función se elimina de ahí).
- Queda como vista de solo lectura: mermas por etapa, pesos, información
  relevante de la producción.
- Visibilidad: jefe de producción (y admin). Se retira de la vista del jefe de
  inventario.

## 4. Permisos

- Crear orden, editar plan de resultantes, solicitar complementos:
  `production.runs.*` (jefe de producción, admin).
- Aprobar/rechazar complementos: `inventory.movements.create` (jefe de
  inventario, admin).
- Validación de permisos siempre en backend.

## 5. Fuera de alcance

- Import de Excel pendiente (pesos y códigos oficiales) — tarea aparte.
- Cambios al constructor de procesos.

## 6. Desvíos aceptados en implementación (2026-07-23)

- El picker de complementos es inline en la modal de crear orden (no abre la
  vista de inventario); más directo, mismo resultado.
- La aprobación de complementos va dentro de aprobar/rechazar materiales (un
  solo paso atómico de inventario), no como resolución individual.
- Admin conserva la pestaña legada "Procesos terminados" en inventario para
  convertir lotes viejos sin plan; el jefe de inventario la pierde.
- La creación de complementos vive en un `ComplementsManager` de mantenimiento
  (espejo de insumos), porque toda creación de ítems vive en managers.
- El backfill de la migración solo migra el producto objetivo de órdenes
  vivas (excluye RECIBIDA/CANCELADA) para no alterar actas históricas.

## 7. Riesgos y precauciones

- `pg_dump` antes de la migración Alembic (regla del proyecto).
- No inventar datos de prueba en BD sin permiso; borrar tras verificar.
- No tocar el stack Docker (solo `exec`); si el frontend dev se corrompe tras
  reinicio, limpiar `.next` según procedimiento conocido.
