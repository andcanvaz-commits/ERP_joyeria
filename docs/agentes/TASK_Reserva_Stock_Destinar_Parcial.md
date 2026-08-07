# Reserva de stock al destinar parcial (materia prima + complementos)

> **ESTADO: implementado** (2026-08-06). Ver sección 8 al final para qué quedó
> dónde y las decisiones que se tomaron sobre los puntos abiertos.

Documento de handoff para implementar en otra sesión. Contiene todo el contexto necesario para arrancar sin haber estado en la conversación original.

## 1. Contexto del sistema (por si no lo conocés)

ERP de joyería (`Sistema ERP Web para Joyería`, ver `CLAUDE.md` en la raíz del repo — léelo primero, tiene las reglas del proyecto). Stack: FastAPI + SQLAlchemy + PostgreSQL en `backend/`, Next.js + TypeScript en `frontend/`. Docker Compose con servicios `db`, `api`, `web`. **No reinicies contenedores vos mismo** — el usuario (Rodrigo) los maneja manualmente; usá `docker exec` para inspeccionar/probar, nunca `up`/`down`/`restart`.

Módulo relevante: **Producción** (`backend/modules/production/`) e **Inventario** (`backend/modules/inventory/`).

### Flujo de una orden de producción (resumen)

1. Jefe de producción crea una orden: elige proceso, materia prima, cantidad, y modo `ASIGNAR` (destino = pieza/tipo existente) o `ENSAMBLAR` (destino = producto final que arrastra complementos según una receta).
2. Orden queda `PENDIENTE_INVENTARIO`.
3. Jefe de inventario aprueba materiales (`approve_materials` en `backend/modules/production/service.py`): descuenta materia prima, insumos por etapa, y complementos solicitados (si `ENSAMBLAR`).
4. Si no alcanza el stock (de materia prima **o** de algún complemento), la orden se **parte**: la porción que sí alcanza sigue (`MATERIALES_APROBADOS` → arranca), y el remanente queda como corrida **hija** en estado `ESPERANDO_MATERIAL` (mismo folio raíz, código con sufijo `-B`, `-C`, etc.).
5. Cuando llega más stock (ENTRADA en inventario), si hay corridas `ESPERANDO_MATERIAL` que lo necesitan, sale un modal automático **"Destinar"** en `frontend/components/inventory/inventory-dashboard.tsx` para asignar ese ingreso a la orden que espera.

### Archivos clave

- `backend/modules/production/models.py` — `ProductionRun`, `ProductionRunStatus` (incluye `WAITING_MATERIAL = "ESPERANDO_MATERIAL"`), `ProductionComplementRequest` (con `ComplementRequestStatus`: `PENDING`/`APPROVED`/`REJECTED`), `AssemblyMode`.
- `backend/modules/production/service.py`:
  - `approve_materials(run_id, current_user)` — el corazón del cálculo: recorre materia prima y cada complemento `PENDING`, calcula cuánto alcanza a cubrir (`covered_qty`, el **mínimo** entre todos los recursos), parte la orden si hace falta (`_split_run_for_partial_material`), y consume/aprueba lo que sí cubre.
  - `allocate_material(run_id, quantity_units, current_user)` — "Inventario destina un ingreso nuevo a una corrida ESPERANDO_MATERIAL": parte si `quantity_units < run.quantity`, pone `PENDIENTE_INVENTARIO`, llama `approve_materials`, y luego `start_run` (arranca automático, sin preguntar).
  - `start_run(run_id, current_user)` — pasa la orden a `EN_PROCESO`.
- `backend/modules/inventory/router.py`:
  - `_find_waiting_production_runs(session, item_id)` — busca corridas `ESPERANDO_MATERIAL` que necesiten este item (por materia prima **o** por complemento pendiente — esto ya se corrigió, ver sección 3).
  - Endpoint `POST /api/inventory/movements` (crear movimiento): si es `ENTRADA` de `RAW_MATERIAL` o `COMPLEMENT`, llama lo anterior y devuelve `waiting_production_runs` en la respuesta.
- `frontend/components/inventory/inventory-dashboard.tsx`:
  - Estado `allocateRuns` (líneas ~483-486): se llena cuando `createInventoryMovement` devuelve `waiting_production_runs` no vacío (línea ~1863).
  - `handleAllocateRun(run)` (línea ~1168): llama `allocateProductionRunMaterial(run.run_id, quantity)` → hace el destinar de verdad (consume y arranca).
  - Modal "Destinar material" (línea ~3402 en adelante).
  - `frontend/lib/production-api.ts` — `allocateProductionRunMaterial`.

## 2. El problema que hay que resolver

Hoy, cuando Inventario hace clic en "Destinar" en ese modal, el sistema **siempre** intenta arrancar automáticamente lo que alcance a cubrir (partiendo la orden de nuevo si no alcanza para todo). El dueño del sistema (Rodrigo) quiere la opción de **no arrancar producción todavía** cuando prefiera esperar a completar TODO lo que falta (materia prima + complementos) antes de empezar, en vez de que el sistema fragmente la orden en cada vez más partes conforme llega stock de a poco.

## 3. Ya arreglado en la sesión anterior (verificar que siga así, no repetir)

Bug encontrado y corregido: el aviso "Destinar" solo se disparaba con `item_type == "RAW_MATERIAL"`, nunca con `COMPLEMENT` — entrar complementos jamás abría el modal. Cambios ya hechos:

1. `backend/modules/inventory/router.py`, `_find_waiting_production_runs`: ahora hace `UNION` de dos búsquedas — corridas `WAITING_MATERIAL` con `raw_material_item_id == item_id`, **y** corridas `WAITING_MATERIAL` que tengan un `ProductionComplementRequest` con `status == PENDING` y `item_id` igual al item recién ingresado.
2. El trigger del endpoint de movimientos pasó de `result.item.item_type == "RAW_MATERIAL"` a `result.item.item_type in ("RAW_MATERIAL", "COMPLEMENT")`.
3. `backend/modules/production/service.py`, `allocate_material`: se quitó una validación prematura que chequeaba **solo** stock de materia prima antes de llamar a `approve_materials` (que sí calcula el mínimo real entre materia prima y complementos). Esa validación bloqueaba con un mensaje engañoso ("falta materia prima") incluso cuando el problema real era solo un complemento, o viceversa. Ahora `approve_materials` es la única fuente de verdad para decidir cuánto alcanza.

Con esto, la lógica de "toma el mínimo entre ambos recursos y parte lo que no alcanza" ya funciona correctamente de punta a punta. Lo que falta es la capa de **preview + reserva + confirmación** descrita abajo.

## 4. Decisiones ya confirmadas por Rodrigo (no volver a preguntar esto)

1. **Cuándo avisar**: el aviso de "esto va a quedar parcial" debe aparecer **antes** de confirmar la acción de "Destinar" (preview, sin tocar stock todavía) — no después con un botón de deshacer.
2. **Qué pasa con el stock si elige "esperar, no empezar todavía"**: ese stock (lo que puso en el campo "Destinar") queda **reservado para esa orden puntual** — no se consume, pero tampoco queda libre para que otra orden lo use.
3. **Cuándo aparece el aviso**: **siempre** que "Destinar" vaya a resultar parcial (no cubre el 100% de lo que le falta a la orden), sea por materia prima, complemento, o ambos.

## 5. Diseño técnico a implementar

### 5.1 Modelo de datos: "reservado" separado de "consumido"

- En `ProductionRun`: hoy no hay concepto de cantidad reservada de materia prima. Agregar un campo (ej. `reserved_material_quantity: Decimal`, default 0) que trackee cuánto de `total_required_material` está reservado-pero-no-consumido.
- En `ProductionComplementRequest`: hoy solo tiene `status` (`PENDING`/`APPROVED`/`REJECTED`) y `quantity` (la cantidad total pedida, todo o nada). Necesita soportar reserva **parcial**: agregar `reserved_quantity: Decimal` (default 0), o un status intermedio `RESERVED` si se prefiere modelar como "todo o nada" por complemento — a definir según cómo se quiera simplificar la lógica de cobertura (revisar si conviene reservar completo por complemento en vez de parcial, para no complicar de más).
- Requiere migración Alembic (`backend/alembic/versions/`).

### 5.2 CRÍTICO: stock disponible en TODO el sistema

Hoy "disponible" = `inventory_items.current_stock` a secas, usado directamente en:
- Validación de stock al crear una orden nueva (¿alcanza para fabricar?).
- `approve_materials` (¿alcanza para aprobar?).
- Alertas de stock mínimo/bajo en el dashboard.
- Cualquier otro lugar que lea `current_stock` para decidir si hay suficiente.

Si se reserva stock para una orden, ese stock **debe restarse del disponible en cada uno de esos lugares**. Si no, dos órdenes distintas podrían reservar/consumir el mismo stock físico y el inventario queda inconsistente (negativo o duplicado). Este es el punto de **mayor riesgo** del cambio.

Recomendación: buscar (o crear) un único helper/función central "stock disponible de un item" que reste `SUM(reservas activas de ese item)` de `current_stock`, y auditar **todos** los callers actuales que hoy usan `item.current_stock` directamente para decidir disponibilidad, migrándolos a ese helper. No alcanza con agregar la reserva en el flujo nuevo si el resto del sistema sigue mirando `current_stock` a secas.

### 5.3 Endpoint de preview (dry-run)

Nuevo endpoint (o parámetro) que calcule lo mismo que `approve_materials` (mínimo entre materia prima y cada complemento pendiente según `covered_qty`) **sin consumir ni cambiar estado**. El frontend lo llama al hacer clic en "Destinar", antes de pedir confirmación. Debe devolver algo como: `{ covered_qty: Decimal, total_qty: Decimal, is_partial: bool, limiting_resource: str }`.

### 5.4 Flujo en el modal "Destinar" (frontend)

1. Usuario hace clic en "Destinar" con una cantidad.
2. Frontend llama al preview.
3. Si `is_partial == false` (cubre el 100%): procede directo, igual que hoy (aprueba y arranca).
4. Si `is_partial == true`: muestra confirmación — "Esto solo cubre X de Y unidades. ¿Arrancar con lo que alcanza (el resto sigue esperando) o reservar esto y esperar a completar todo antes de empezar?" con dos botones:
   - **Arrancar con lo que alcanza**: comportamiento actual (llama `allocateProductionRunMaterial`, que aprueba+parte+arranca).
   - **Reservar y esperar**: nueva acción que solo marca como reservado (no consume, no arranca, no parte la orden todavía).

### 5.5 Botón "Iniciar" cuando todo está reservado

Cuando una orden tiene **todo** (materia prima + todos los complementos) reservado al 100%, debe aparecer una acción explícita en la orden para recién ahí consumir de verdad y arrancar (`approve_materials` + `start_run` sobre las cantidades reservadas).

### 5.6 Ver / liberar reservas

Debe poder verse qué está reservado y para qué orden (probablemente en la vista de detalle de la orden, o en un panel dedicado), y liberarlo (volver a disponible) si el usuario se arrepiente.

## 6. Otro cambio de la sesión anterior (no relacionado, ya hecho — no tocar salvo que pidan)

`frontend/components/dashboard/system-dashboard.tsx`, gráfico "Más fabricado" (`productionByProduct`): antes sacaba los datos de `production_runs.products`, y las órdenes migradas de papel (sin producto declarado) mostraban el **nombre del proceso** como si fuera un producto (ej. "Máquinas", "Soldar" aparecían como "productos fabricados", cosa que no existe en inventario y confundió a Rodrigo). Se cambió para que salga de inventario real de productos terminados (`current_stock` en gramos, agrupado por `description` de la pieza).

## 7. Cómo arrancar

1. Leer `CLAUDE.md` completo (reglas del proyecto).
2. Confirmar que los 3 fixes de la sección 3 siguen en el código (`git log` / `git diff` si hace falta, o simplemente releer los archivos mencionados).
3. Diseñar el modelo de reserva (sección 5.1) y la migración.
4. Encontrar/crear el helper central de "disponible" (sección 5.2) — **esto primero**, antes de tocar UI, porque todo lo demás depende de que este cálculo sea consistente en todo el sistema.
5. Endpoint de preview (5.3).
6. UI del modal de confirmación (5.4) en `inventory-dashboard.tsx`, cerca de `handleAllocateRun`.
7. Botón "Iniciar" cuando reserva completa (5.5).
8. Vista de reservas (5.6).
9. Antes de dar por terminado: probar en vivo con `docker exec` contra la DB real (como se hizo en la sesión anterior) simulando una orden con materia prima Y complemento faltantes a la vez, para confirmar que el mínimo se calcula bien y que NINGÚN otro lugar del sistema deja pasar el stock reservado como si estuviera libre.

## 8. Implementación (2026-08-06)

### Modelo y migración

- `ProductionRun.reserved_material_quantity` y `ProductionComplementRequest.reserved_quantity`,
  ambos `NUMERIC(14,4) NOT NULL DEFAULT 0`.
- Migración `d0e1f2a3b4c5_reserva_de_stock_destinar_parcial.py`, aditiva: `server_default='0'`
  significa "nada reservado", que es el comportamiento previo. Las filas existentes no
  cambian de valor ni de significado.
- Espejo idempotente en `upgrade_production_tables()` de `main.py` (bases de dev viejas).

**Decisión sobre el punto abierto del 5.1:** reserva **parcial** por complemento
(`reserved_quantity`), no un status `RESERVADO` de todo-o-nada. El caso de uso es juntar
el faltante en varias entradas; un status binario lo impediría.

### Stock disponible (5.2 — el punto de mayor riesgo)

Fuente única en `InventoryService`:

- `reserved_by_item(exclude_run_id=None)` — una sola agregación SQL, sin N+1.
- `reserved_stock(item_id, ...)` y `available_stock(item, ...)`.

`exclude_run_id` existe porque la reserva **propia** de una corrida sí está disponible
para ella: es justamente el stock que se le guardó.

Callers migrados de `current_stock` a disponible:

| dónde | qué decide |
|---|---|
| `ProductionService._compute_coverage` | cuánto alcanza a cubrir (aprobar y preview) |
| `InventoryService.get_summary` | alerta de stock bajo |
| `InventoryService.check_material_availability` | contrato con producción |
| `InventoryService.create_movement` | **bloquea** una SALIDA que se lleve stock reservado |
| `InventoryService.list_items` | expone `reserved_stock` / `available_stock` a la UI |

`CONSUMO_PRODUCCION` queda exento del tope (`PRODUCTION_MOVEMENTS`) porque
`approve_materials` libera la reserva de la corrida **antes** de consumir.

Los `current_stock` que quedan son de lotes `FINISHED_PRODUCT`/`WASTE` (conversión,
combinación, reclasificación) y de `delete_item`/`archive_item`: ninguno decide
disponibilidad de materia prima o complementos, que son los únicos tipos reservables.

### Cobertura: una sola fuente

`_compute_coverage(run, target_qty)` la usan **tanto** el preview (dry-run) como
`approve_materials` (consumo real). Si divergieran, el aviso de "esto va a quedar
parcial" mentiría.

### Endpoints nuevos (`/api/production/runs/{id}/...`)

- `POST allocation-preview` → `{covered_qty, target_qty, is_partial, limiting_*}`. No muta.
- `POST reserve-material` → guarda sin consumir, sin arrancar y **sin partir** la orden.
- `POST release-reservation` → devuelve todo al disponible.
- `POST start-reserved` → solo con reserva al 100%: consume de verdad y arranca.

`reserve-material` reserva lo que **de verdad alcanza** (`covered_qty`), no lo que se
pidió: reservar stock inexistente dejaría el disponible en negativo.

### Frontend

- `inventory-dashboard.tsx`: "Destinar" ahora llama al preview primero. Si cubre todo,
  procede igual que antes; si va a quedar parcial, abre confirmación con
  **"Arrancar con lo que alcanza"** vs **"Reservar y esperar a completar"**, indicando
  qué recurso limita y cuánto queda.
- Tablas de materia prima y complementos: muestran "X reservado" bajo el stock.
- `production-dashboard.tsx`, panel "Esperando material": muestra reservado/requerido,
  con **"Iniciar con lo reservado"** (solo si `reservation_is_complete`) y
  **"Liberar reserva"**.

### Verificación

- `pytest`: 53 pasan. 12 tests nuevos en `test_material_reservation.py`.
  Los 3 fallos restantes (`test_historical_import_parser`) son **preexistentes**:
  buscan `/tmp/ordenes.xlsx`, que no está en el repo.
- `test_allocate_material_rejects_insufficient_stock` estaba **rojo desde antes** de este
  cambio: quedó desactualizado por el fix #3 de la sección 3 (ya no lanza error, ahora
  parte y arranca lo cubierto). Se reemplazó por dos tests que cubren el comportamiento real.
- `npm run build`: limpio. `tsc --noEmit`: limpio.
- Prueba en vivo contra la API con una orden a la que le faltan materia prima **y**
  complemento a la vez: el mínimo sale del complemento (4 de 10 unidades), y el stock
  reservado queda invisible para `available_stock`, `list_items`,
  `check_material_availability`, una SALIDA manual y el `approve_materials` de otra orden.

### Pendiente / a criterio

- `npm run lint` está roto de antes: `next lint` ya no existe en Next 16.
- La reserva no expira sola. Si una orden queda reservada y olvidada, ese stock queda
  fuera del disponible hasta que alguien la libere a mano.
