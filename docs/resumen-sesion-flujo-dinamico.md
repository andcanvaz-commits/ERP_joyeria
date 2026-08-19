# Resumen de sesión — Rediseño del sistema de producción

> Documento de handoff: qué se implementó, por qué, qué falta y cómo probarlo.
> Pensado para que otra persona (dev o el propio Rodrigo) pueda revisar el
> trabajo, seguir probando y seguir mejorando sin tener que reconstruir el
> contexto desde cero.

Todo lo implementado responde a [`docs/cambios-sistema-produccion.md`](./cambios-sistema-produccion.md),
el documento de especificación que guió esta sesión. Léelo primero si falta
contexto de negocio — acá se documenta el *cómo*, no el *por qué* del negocio.

## Commits de esta sesión (orden cronológico)

```
a18a902 feat(production): fusiona roles, elimina recetas/ensamblaje, flujo dinamico de ordenes
e17b50e feat(messages): mensaje libre del Admin a la bandeja de Solicitudes
d60aa76 feat(production): frontend del rol fusionado, flujo dinamico y elimina ensamblaje
fd5d8e2 docs: reemplaza especificacion vieja por plan de cambios de produccion
8d15b4d feat(reportes): merma agregada por proceso incluye el flujo dinamico nuevo
862ca6e fix(production): corrige flujo de etapa segun feedback de Rodrigo
260ce4a fix(production): "Gestionar" abria vacio en una orden nueva recien creada
72ba485 fix(production): tarjeta "En proceso" no reconocia ordenes del flujo nuevo
```

Todos en `main`, todos pusheados a `origin`.

---

## 1. Rol fusionado: Producción/Inventario

**Qué cambió:** los roles `Jefe de producción` y `Jefe de inventario` dejaron
de existir por separado. Ahora hay un solo rol operativo, `Producción/Inventario`,
con los permisos de ambos.

**Dónde:**
- `backend/modules/auth/service.py` — `ROLE_PRODUCTION_INVENTORY`, permisos
  unidos en `PRODUCTION_INVENTORY_PERMISSIONS`.
- `backend/modules/production/router.py`, `backend/modules/inventory/router.py`
  — se sacaron los atajos por nombre de rol viejo (ya redundantes con la
  unión de permisos), y las 2 restricciones "solo producción puede editar
  el plan/ensamble" (ya no tiene sentido con un solo rol).
- Migración `a132961e2013_merge_produccion_inventario_role.py` — hace
  `UPDATE auth_users SET role='Producción/Inventario' WHERE role IN (...)`
  para los usuarios existentes con rol viejo. **Obligatoria**: sin ella, esos
  usuarios pierden todos sus permisos en su próximo login (`ROLE_PERMISSIONS`
  ya no tiene entrada para las claves viejas).
- Frontend: `frontend/lib/roles.ts` (`Role = "admin" | "operaciones" | "unknown"`),
  selector de rol en Usuarios (`production-dashboard.tsx`), y las pantallas
  que antes distinguían producción de inventario (`solicitudes-view.tsx`,
  `system-dashboard.tsx`, `reportes-view.tsx`) ahora muestran ambas vistas
  apiladas para el rol fusionado.

**Decisiones confirmadas por Rodrigo:** migración automática de usuarios
existentes; eliminar la restricción "solo producción" en vez de dejarla.

---

## 2. Recetas y ensamblaje: eliminados por completo

**Qué cambió:** el modo `ASIGNAR`/`ENSAMBLAR`, las recetas de ensamble por
modelo (`AssemblyRecipe`), y las solicitudes de complemento
(`ProductionComplementRequest`) ya no existen en ningún lado — ni backend,
ni frontend, ni base de datos.

**Dónde:**
- Modelos/tablas borrados: `AssemblyRecipe`, `AssemblyRecipeItem`,
  `ProductionRunAssemblyItem`, `ProductionComplementRequest`. Columnas
  `assembly_mode`/`assembly_pending` borradas de `production_runs`.
- Migración `83359a844e19_drop_assembly_recipes.py`.
- Backend: ~15 métodos de servicio borrados en
  `backend/modules/production/service.py` (`define_run_assembly`,
  `_auto_apply_assembly`, `return_complement`, `_model_key_for_run`, etc.),
  endpoints correspondientes en `router.py`, schemas en `schemas.py`.
- Frontend: `create-order-wizard.tsx` borrado entero; toggle
  Asignar/Ensamblar y sección "Recetas" de Mantenimientos sacados de
  `production-dashboard.tsx`.
- **Lo que NO se tocó:** el `item_type=COMPLEMENT` de inventario (una
  joyería fabrica sus propios complementos como cadenas base, broches,
  etc. — eso es una feature de inventario, no de recetas, y sigue viva
  intacta: `ComplementsManager`, `ComplementPicker`, la pestaña
  "Complementos" del catálogo).

**Importante:** las órdenes históricas (`ProductionRun`/`ProductionRunStage`
de antes de este cambio) **no se tocaron**. Sus datos ya estaban copiados al
crearse (el diseño del sistema ya desacoplaba la plantilla del historial), así
que Documentos/Reportes las sigue mostrando exactamente igual.

---

## 3. Banco de procesos + flujo dinámico de órdenes

Es el cambio más grande de la sesión — reemplaza buena parte del motor de
producción.

### 3.1 Banco de procesos

`ProductionProcess` (tabla `production_processes`) se aplanó: ya no tiene
sub-etapas (`ProductionProcessStage`) ni insumos preconfigurados
(`ProductionProcessStageIngredient`) ni restricción de tipos de producto
(`ProductionProcessProductType`) — esas 3 tablas se borraron.

Un "proceso" ahora es un paso suelto y reutilizable: `id`, `name`, `code`
(numérico autogenerado, `2000`, `2001`...), `description`, `is_active`. Sin
insumos precargados — se agregan sueltos, directo en el acta de cada etapa,
igual que ya funcionaba el botón "+" (ADMIN_STOCK) antes de esta sesión.

CRUD en Mantenimientos → Procesos, admin-only para crear/editar/borrar,
lectura abierta al rol fusionado (`production.processes.read`).

**⚠️ Pendiente, no lo pude hacer yo:** las 4 filas que ya existían en la base
(`MEDALLAS`, `CASTING DE JOYAS (ORO)`, `CADENAS`, `MONEDAS` — plantillas de
producto del sistema viejo, con descripciones de "4 fases" que ya no
aplican) más una fila `Proceso Test` de prueba, siguen ahí tal cual. Rodrigo
pidió renombrarlas a pasos sueltos (`Fundido`, `Laminado`, `Pulido`,
`Ensamble manual`) y borrar la de prueba. Intenté hacerlo yo por API pero no
tengo credenciales de admin vigentes (`SEED_ADMIN_PASSWORD` en `.env` está
vacío — probablemente Rodrigo cambió la contraseña desde la app). Queda
pendiente hacerlo a mano desde Mantenimientos → Procesos, o pasarme
credenciales/un token para que lo haga por API.

### 3.2 Orden nueva: solo un nombre

`ProductionRun` se extendió (no se reemplazó — todas sus columnas viejas
siguen ahí, con las que necesita el flujo viejo ahora `nullable`) con:

- `name` (texto libre, obligatorio a nivel de servicio para órdenes nuevas).
- Relación nueva `stage_attempts` (ver 3.3).
- Estado nuevo `TERMINADA` (además de los 7 viejos, que las órdenes
  históricas siguen usando tal cual).

`POST /api/production/orders` — payload `{name}` — crea la orden
directamente en `EN_PROCESO`, sin materia prima ni proceso todavía. **No hay
más aprobación de materiales para órdenes nuevas** (sección 2.3 del doc):
todo lo que entra a una etapa se mueve directo, sin gate de Inventario.

### 3.3 Intento de etapa (`ProductionRunStageAttempt`)

Tabla nueva `production_run_stage_attempts`. Cada fila = un ✔ o ✘. Campos
clave: `process_id`/`process_name`, `sequence_order`, `attempt_no_for_process`
(cuenta cuántas veces se usó ESE proceso en ESA orden — alimenta el código de
acta `OP-2026-0001-FUND-01`, `-02` si se repite), `responsable_name` (texto
libre, lo llena Producción/Inventario), `status`
(`EN_PROCESO`/`APROBADA`/`RECHAZADA`), `rejection_reason` (**opcional**,
confirmado por Rodrigo), `peso_al_finalizar`, `merma_weight`/`merma_percent`
(calculada SOLO contra la propia acta de esa etapa — nunca contra la etapa
anterior, confirmado por Rodrigo: "cada etapa es independiente, tiene su
propia merma como su propio certificado").

Flujo:

1. `POST /runs/{id}/stage-attempts` — `{process_id, responsable_name}` —
   secuencial estricto, rechaza con 409 si ya hay un intento `EN_PROCESO`.
2. El frontend, en el mismo paso, pide **materia prima y cantidad** (pedido
   explícito de Rodrigo tras el primer intento de implementación) y las
   manda como línea `ENTREGA` directa vía `POST /acta-lines/admin` con
   `stage_attempt_id` — dos llamadas HTTP encadenadas, sin cambio de
   backend.
3. Mientras la etapa está activa, el acta se ve **igual que siempre**
   (columnas ENTREGADO/RECIBIDO, componente `ActaSide` real reusado, no una
   tabla simplificada — esto se rompió en el primer intento y se corrigió
   después) y se puede seguir agregando líneas sueltas con el botón "+".
4. `POST /stage-attempts/{id}/finish` — `{peso_al_finalizar, decision,
   rejection_reason?}` — ✔/✘ son botones **solo ícono** (`Check`/`X` de
   lucide, sin texto), con los colores del sistema
   (`.successIconButton` = dorado / `--success`, `.dangerIconButton` = rojo
   / `--danger`, ya existía). El campo de motivo **solo aparece si tocás ✘**.
5. Rechazar no repite el proceso solo: vuelve a la selección, se puede
   elegir otro proceso y/o responsable distinto.
6. `POST /runs/{id}/assign-product` — disponible en **cualquier momento**
   de la orden (no solo al final), cierra la orden a `TERMINADA`. Reusa
   `InventoryService.create_finished_product_lot`/`convert_lot_to_product`,
   mismo mecanismo que ya existía.

`ProductionRunActaLine` ganó una columna `stage_attempt_id` (nullable,
convive con la vieja `stage_id` sin tocarla).

Migración: `02931dbd57ba_dynamic_production_flow.py`.

### 3.4 Bugs encontrados después del primer build (ya corregidos)

Estos 3 aparecieron al probar en el navegador real, no los agarró el build
de TypeScript porque son de lógica, no de tipos:

1. **Acta simplificada en vez de la real** — el primer intento mostraba una
   tabla plana (Detalle/Cantidad/Lado) para la etapa activa en vez del
   componente `ActaSide` de siempre. Corregido en `862ca6e`.
2. **Botón "Gestionar" en la tabla de Procesos abría el modal viejo** — el
   discriminador para saber si una orden es del flujo nuevo era
   `stage_attempts.length > 0`, que falla para una orden recién creada
   (todavía sin ninguna etapa iniciada). El modal viejo (`openRunStagesModal`)
   se abría vacío contra `run.stages = []`. Corregido en `260ce4a` usando
   `Boolean(run.name)` como discriminador (las órdenes nuevas siempre tienen
   nombre desde que se crean).
3. **Misma falla en la tarjeta "En proceso"** (lo primero que se ve al
   entrar a Producción) — tenía su propio `primaryAction` con el mismo bug,
   más mostraba título/cantidad/hora de inicio en blanco porque leía campos
   que no existen en órdenes nuevas (`process_name`, `quantity`,
   `started_at`). Corregido en `72ba485`.
4. **No había forma de cancelar una orden nueva** — el botón "Cancelar
   orden" solo existía en el modal viejo (`openRunStagesModal`); el panel
   nuevo (`dynamicOrderRun`) nunca lo tuvo. Sin él, las órdenes de prueba
   creadas durante esta sesión (`OP-2026-0054` a `0057`, nombres `test`)
   quedaron atascadas en `EN_PROCESO` sin manera de revertir el inventario
   que habían consumido desde la UI. Agregado reusando el mismo modal y
   `handleCancelRun` genéricos de siempre — `_revert_admin_stock_lines` en
   el backend ya reversaba líneas `ADMIN_STOCK` sin distinguir
   `stage_id`/`stage_attempt_id`, así que no hizo falta tocar backend.

Si algo más "no se ve" o abre vacío, es muy probablemente la misma familia
de bug: buscar `run.name` como discriminador en vez de asumir que
`stage_attempts`/`stages` van a estar poblados.

**Limpieza pendiente:** las órdenes de prueba `OP-2026-0054` a `0057`
(nombres `test`/`TEST`/`fundir barra`) siguen en `EN_PROCESO` en la base —
con el botón nuevo ya se pueden cancelar desde la UI (revierte el
inventario que consumieron). Las `OP-2026-0051` a `0053` ya estaban
`CANCELADA` antes de este fix (Rodrigo las canceló a mano por otra vía).

---

## 4. Mensaje libre del Admin

Módulo nuevo `backend/modules/messages/` (modelo, schema, service, router
completos e independientes — no comparte tablas con producción). El Admin
escribe texto libre, va a la bandeja de Solicitudes de Producción/Inventario,
que lo acepta o rechaza. **No crea ninguna orden automáticamente** — es solo
comunicación (sección 2.2 del doc).

- `POST /api/messages` (admin-only), `GET /api/messages` (ambos roles ven la
  misma lista completa — historial permanente), `POST /api/messages/{id}/respond`
  (solo `Producción/Inventario`).
- Migración `2ef338d9afa1_admin_messages.py`.
- Frontend: `frontend/lib/messages-api.ts`, componente `MessagesPanel` dentro
  de `solicitudes-view.tsx` (compone/lista para Admin, acepta/rechaza para
  Producción/Inventario). Se agregó `/solicitudes` a las rutas permitidas del
  Admin en `roles.ts` (antes no podía ni entrar a la pantalla).

**No implementado:** filtro de fecha o paginación en la lista de mensajes —
hoy trae todo el historial de una. Si crece mucho, va a hacer falta paginar.

---

## 5. Merma agregada por proceso (Reportes)

Sección 7 del doc. La tabla **"Merma por etapa"** que ya existía en
`reportes-dashboard.tsx` (agregaba `ProductionRunStage.waste_weight` por
`stage_name`, del flujo viejo) ahora **también** suma
`stage_attempt.merma_weight`/`merma_percent` de las etapas aprobadas del
flujo nuevo, bajo la misma clave (`process_name`). El filtro de periodo
(mes) que ya existía se reutiliza tal cual — no hizo falta agregar uno
nuevo.

**Limitación conocida, no resuelta:** las tablas "Ordenes por proceso" /
"Merma por proceso" (las que agrupan por `process_name ?? run.name`, NO la
de "por etapa" de arriba) siguen agrupando cada orden nueva por su propio
`name` individual, porque una orden del flujo nuevo puede usar varios
procesos distintos a lo largo de su vida — no tiene un "proceso" único como
las órdenes viejas. Es un parche mínimo dejado así a propósito (fuera de
alcance de la sección 7, que pedía específicamente la vista por etapa). Con
más órdenes del flujo nuevo, esas dos tablas en particular van a volverse
cada vez menos útiles y valdría la pena rediseñarlas.

---

## 6. Qué NO se tocó / deuda conocida preexistente

- `editPlanRun`/`editPlanProduct` en `production-dashboard.tsx`: feature del
  flujo viejo que ya estaba incompleta/no cableada antes de esta sesión
  (`itemPickerFor` nunca vale `"edit"` en ningún call site real). No se
  arregló porque no es parte de este cambio.
- El renombrado de los 4 procesos viejos + borrar el de prueba (sección 3.1)
  — bloqueado por falta de credenciales de admin vigentes.
- No se corrió ninguna migración en producción — todo lo de arriba asume
  que `docker-compose up` corre `alembic upgrade head` como ya hace siempre.

---

## 7. Cómo probar

Guía visual paso a paso ya publicada, con checklist y qué esperar en cada
punto: **[Bitácora de Pruebas](https://claude.ai/code/artifact/8a7c0984-afe7-4596-aa69-8039ed4001fd)**
(cubre los 7 puntos del doc de especificación; los 3 bugs de la sección 3.4
de arriba ya estaban corregidos cuando se armó esa guía, así que no los
menciona por separado — si algo ahí falla, es la primera sospecha).

Verificación automática ya corrida en esta sesión:
- Backend: `docker-compose exec api pytest backend/tests -q` → **178 passed,
  3 skipped, 0 failed** (incluye `test_dynamic_flow.py`, tests nuevos
  específicos del flujo dinámico: crear orden, dos intentos del mismo
  proceso con código `-01`/`-02`, rechazo sin motivo, reinicio con proceso
  distinto, asignar producto).
- Frontend: `docker-compose exec web npm run build` → limpio, 0 errores de
  TypeScript, 13 rutas generadas, en cada uno de los 8 commits de esta
  sesión.

Para quien vaya a seguir probando: los 3 bugs de la sección 3.4 salieron
todos de probar en el navegador real después de que el build ya pasaba
limpio — el `npm run build`/`pytest` de esta sesión certifican tipos y
lógica de negocio aislada, no reemplazan probar el flujo completo a mano.
