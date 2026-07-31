# TASK Produccion

## Registro de cambios

### 2026-06-29 (3) - Rediseno completo produccion: carousel, tiempo visual, solicitudes badge

Que se hizo:
- **Rediseno del dashboard de produccion**:
  - Barra de metricas con 4 stats: "Esperando inventario", "Listas para iniciar", "En proceso", "Finalizadas".
  - Layout principal en 2 columnas: crear orden (izquierda) + carousel de ordenes en proceso (derecha).
  - El carousel muestra UNA orden a la vez con animacion de deslizamiento al navegar (izquierda/derecha).
    - Keyframe `slideFromRight` / `slideFromLeft`; se activa con `carouselKey` + `carouselDir`.
    - Muestra: nombre de proceso, unidades, tiempo transcurrido, barra de progreso de etapas, indicador de timing.
  - Control visual del tiempo: punto de color (verde=a tiempo, ambar=por vencer, rojo=retrasada) + pill de texto + barra de progreso de la etapa actual con porcentaje basado en `scheduled_start_at`/`scheduled_finish_at`.
  - Seccion "Listas para iniciar" como filas compactas horizontales (no cards apiladas).
  - Seccion "Historial reciente" compacta con boton para abrir historial completo.
  - Modal de etapas rediseniado: timeline vertical con numero de etapa como circulo de color, pill de timing por etapa, barra de progreso individual para etapas EN_PROCESO, tiempos de inicio y fin estimado.
  - Helpers nuevos: `getRunProgress`, `getRunTimingStatus`, `getElapsedLabel`, `getStageTimingStatus`, `nextCarouselRun`, `prevCarouselRun`.
- **Solicitudes como badge en inventario**:
  - Reemplazada la seccion condicional inline de inventario por un boton "Solicitudes de produccion" con badge rojo de conteo (estilo notificacion de app).
  - Al hacer clic abre modal con dos secciones: salidas de materia prima (PENDIENTE_INVENTARIO) y recepciones de producto terminado (PENDIENTE_RECEPCION).
  - Cada solicitud es expandible con clic o icono de ojo para ver detalle y boton de accion.
- **Productos en proceso**: Las ordenes con status `EN_PROCESO` ahora aparecen en la vista "Producto en proceso" del modulo de inventario (con fondo azul claro para distinguirlas de items de inventario estaticos).
- **CSS nuevo**: `.productionStatsRow`, `.productionStatCard`, `.productionMainGrid`, `.productionCarouselPanel`, `.carouselHeader`, `.carouselNav`, `.carouselCounter`, `.carouselWindow`, `@keyframes slideFromRight/Left`, `.slideFromRight`, `.slideFromLeft`, `.runCard`, `.runCardTitle`, `.runCardQuantityRow`, `.timingDot`, `.timingOnTime`, `.timingWarning`, `.timingLate`, `.timingPending`, `.progressTrack`, `.progressFill`, `.progressFillWarning`, `.progressFillLate`, `.runCurrentStage`, `.runCurrentStageName`, `.runStageTimingPill`, `.runStageMiniBar`, `.readyToStartList`, `.readyToStartRow`, `.readyToStartInfo`, `.stageTimelineList`, `.stageTimelineItem`, `.stageTimeline{STATUS}`, `.stageTimelineHead`, `.stageTimelineLeft`, `.stageTimelineNum`, `.stageTimelineNumActive`, `.stageTimelineNumDone`, `.solicitudesButton`, `.solicitudesBadge`, `.solicitudesModal`, `.solicitudCard`, `.solicitudCardOpen`, `.solicitudCardHead`, `.solicitudCardDetail`, `.solicitudDetailItem`.

Archivos modificados (2026-06-29 tercera iteracion):
- `frontend/components/production/production-dashboard.tsx`
- `frontend/components/inventory/inventory-dashboard.tsx`
- `frontend/app/globals.css`
- `TASK_Produccion.md`

Verificaciones:
- `npm run build` en `frontend`: OK, TypeScript limpio, todas las rutas compiladas.
- No se levanto Docker (el usuario lo ejecuta manualmente).

Pendiente:
- Validar en navegador: carousel animado, indicadores de tiempo, badge de solicitudes.
- Los indicadores de tiempo dependen de `scheduled_start_at`/`scheduled_finish_at` en las etapas; si el backend no los rellena al iniciar etapas, los calculos de timing caen a "no_time"/"En proceso" (comportamiento seguro). Se deberia verificar que el backend llena esos campos correctamente.

---

### 2026-06-29 (2) - Separacion de inventario, dialogo de confirmacion, flujo visual de procesos

Que se hizo:
- **Separacion de responsabilidades**: Las acciones de inventario dentro del modulo de produccion fueron eliminadas y movidas al modulo de inventario.
  - Removido del modulo de produccion: panel "Solicitudes para Inventario" (aprobar salida de materia prima) y panel "Recepcion de producto terminado".
  - Agregado al modulo de inventario: seccion dinamica "Solicitudes de materia prima" y "Recepcion de producto terminado" que aparece automaticamente cuando hay ordenes pendientes. El Jefe de Inventario ve y gestiona ambas desde `/inventario`.
  - Las funciones `handleApproveMaterials` y `handleReceiveFinishedProduct` fueron movidas a `inventory-dashboard.tsx`.
  - El modulo de produccion ahora solo cubre: crear orden, ver ordenes listas para iniciar (MATERIALES_APROBADOS), ejecutar etapas e historial.
- **Sin alerts nativos**: Los tres `window.confirm()` fueron reemplazados por un dialogo modal emergente (`confirmDialog` state + `showConfirm()` helper):
  - Eliminar proceso (`handleDelete`)
  - Finalizar etapa antes del tiempo estimado (`handleFinishStage`)
  - Eliminar usuario (`handleDeleteUser`)
  - El dialogo tiene titulo, mensaje explicativo y botones "Cancelar" / "Confirmar" (o "Eliminar") con variantes peligro/primario.
- **Visualizacion de proceso rediseniada** (modal "Visualizar" en mantenimientos):
  - Reemplazado el listado plano por un flujo visual vertical estilo diagrama.
  - Encabezado del proceso: materia prima, cantidad por unidad, limite de merma.
  - Cada etapa es una tarjeta con borde lateral de color segun su tipo (indigo=Proceso, rojo=Termico, ambar=Quimico, verde=Control, purpura=Decision).
  - Numero de etapa en circulo de color, nombre y badge de tipo.
  - Caja verde para "Control de calidad" si existe, caja ambar para "Si no cumple / reproceso" si existe.
  - Footer con chips de pesaje y duracion.
  - Cabecera de fase como etiqueta pill cuando cambia la fase.
  - Flecha conectora entre etapas.
  - Modal mas ancho (860px) con scroll vertical.
- **CSS nuevo**:
  - Estilos del flujo visual: `.processFlowWindow`, `.processFlowList`, `.processFlowStage`, `.processFlowStage{TYPE}`, `.processFlowCallout{Check,Rework}`, etc.
  - Estilos del dialogo de confirmacion: `.confirmBackdrop`, `.confirmDialog`, `.confirmDialogActions`, `.buttonDanger`.
  - Estilos de cards de produccion en inventario: `.productionRequestsList`, `.productionRequestCard`, `.receptionRequestCard`.

Archivos modificados (2026-06-29 segunda iteracion):
- `frontend/components/production/production-dashboard.tsx`
- `frontend/components/inventory/inventory-dashboard.tsx`
- `frontend/app/globals.css`
- `TASK_Produccion.md`

Verificaciones:
- `npm run build` en `frontend`: OK, TypeScript limpio, todas las rutas compiladas.
- No se levanto Docker (el usuario lo ejecuta manualmente).

Pendiente:
- Validar en navegador despues de reiniciar Docker que los paneles de produccion aparecen en inventario y que la visualizacion de procesos luce correcta.
- Considerar permisos por rol en los paneles de inventario: actualmente cualquier usuario autenticado con acceso al modulo de inventario puede aprobar salidas y recibir productos; la restriccion deberia limitar esas acciones al Jefe de Inventario (pendiente de implementar RBAC completo en frontend/backend).

---

### 2026-06-29 - Mantenimiento de procesos dinamico y siembra de procesos reales

Que se hizo:
- Se hizo dinamico el mantenimiento "Crear proceso" para soportar TODOS los procesos de los documentos e imagenes (cadenas, monedas, medallas y casting).
- Cada etapa del formulario ahora captura, ademas de nombre/descripcion/pesaje/tiempo:
  - Tipo de etapa: Proceso, Proceso termico, Proceso quimico, Control/Revision y Decision (control con reproceso).
  - Fase (opcional) para agrupar etapas por fases del flujo (ej. "Fase 2 - Fabricacion").
  - Control de calidad / pregunta (opcional) para puntos de revision.
  - Accion si no cumple / reproceso (opcional) para describir el retorno del flujo.
- Estos campos ya existian en el modelo backend (`phase_name`, `stage_type`, `quality_check`, `rework_action`); solo faltaba exponerlos en el formulario y en el payload del frontend. No se quemo ninguna logica de procesos: todo sigue siendo dato configurable.
- La ventana "Visualizar" del proceso ahora muestra tipo de etapa, fase, control y reproceso por etapa.
- Se reemplazo `seed_demo_processes` (2 procesos demo de 3 etapas genericas) por `seed_example_processes`, que siembra 4 procesos de ejemplo reales con sus etapas, fases y controles tomados de los documentos:
  - Cadenas de Oro (14 etapas, incluye decisiones de laminado, amoniaco, soldado y diamantado).
  - Monedas (11 etapas, incluye revision de peso y revision de calidad).
  - Medallas (17 etapas en 4 fases, con baño/esmaltado/secado).
  - Casting de Joyas (Oro) (16 etapas en 4 fases, ceras, revestimiento, casting y acabado).
- Limpieza de datos antiguos en el arranque (idempotente):
  - Se eliminan procesos demo viejos por nombre ("Monedas de oro", "Cadenas de oro") o por firma de 3 etapas genericas ("Preparacion/Trabajo principal/Control final").
  - Se eliminan ordenes de produccion huerfanas (`production_runs`) que apuntaban a procesos ya eliminados, via `ProductionProcessRepository.delete_orphan_runs()`.
  - La siembra solo crea un proceso de ejemplo si no existe por nombre, asi se respetan ediciones del usuario en arranques posteriores.
- El item de materia prima de ejemplo paso a llamarse "Oro 18K" con stock inicial 5000 g.

Que falta:
- El item de inventario antiguo "Oro 18K demo" queda sin uso tras la limpieza; se puede borrar manualmente desde inventario si se desea (no se elimino por seguridad de movimientos historicos).
- Implementar codificacion de orden/lote/etapa (OP-AAAA-####, LOT-XX-AA####, COD-OP####-##) sugerida en el documento de codificacion, cuando se formalice la trazabilidad documental.
- Modelar control de calidad/reprocesos como movimientos historicos (nunca borrar, solo agregar) cuando se construya el modulo de calidad.

Archivos modificados:
- `frontend/components/production/production-dashboard.tsx`
- `frontend/lib/production-api.ts`
- `frontend/app/globals.css`
- `backend/modules/production/service.py`
- `backend/modules/production/repository.py`
- `backend/app/main.py`
- `TASK_Produccion.md`

Puntos para integrar luego con inventario:
- La limpieza solo afecta procesos/ordenes de produccion; no toca stock ni movimientos de inventario.
- El item "Oro 18K demo" antiguo permanece para no romper movimientos historicos de inventario.

Docker:
- No se levanto ni reinicio Docker (el usuario lo ejecuta manualmente).
- La limpieza y siembra corren en el arranque con `AUTO_CREATE_TABLES=true`; en el proximo `docker-compose up` se aplicaran automaticamente.

Verificaciones ejecutadas:
- `python -m py_compile` sobre `service.py`, `repository.py` y `main.py`: OK.
- `npm run build` en `frontend`: compilo correctamente con TypeScript, incluida la ruta `/mantenimientos` y `/produccion`.

Verificaciones no ejecutadas o no completadas:
- No se valido en navegador ni se corrio Docker (lo ejecuta el usuario manualmente).
- No se probo el flujo de creacion/edicion de proceso con los nuevos campos contra la base real.

### 2026-06-17

Que se hizo:
- Se leyo `claude.md` y se tomo como regla principal no quemar procesos ni etapas en codigo.
- Se limpio estructura anidada accidental vacia en backend y frontend.
- Se creo la arquitectura modular base en `backend/modules`.
- Se inicializaron los modulos requeridos: auth, users, security, production, inventory, documents, reports, dashboard, shared, database y config.
- Se comenzo solo el modulo de produccion con modelos, esquemas, repositorio, servicio y router base.
- Se definio en `shared` un contrato de integracion con inventario sin implementar logica de inventario.
- Se creo `TASK_Inventario.md` para uso posterior del developer de inventario.
- Se agregaron marcadores `.gitkeep` en carpetas frontend base para conservar la estructura modular vacia.

Que falta:
- Conectar sesiones reales de base de datos en el composition root.
- Implementar autenticacion JWT real y permisos por endpoint.
- Crear migraciones Alembic para las tablas de produccion.
- Implementar lectura de plantillas de proceso y copia de etapas dinamicas hacia la orden.
- Implementar calculo de materiales desde composiciones versionadas.
- Agregar pruebas unitarias de estados y validaciones criticas.

Archivos modificados:
- `backend/app/main.py`
- `backend/modules/auth/*`
- `backend/modules/config/*`
- `backend/modules/database/*`
- `backend/modules/production/*`
- `backend/modules/security/*`
- `backend/modules/shared/contracts/inventory.py`
- `TASK_Produccion.md`
- `TASK_Inventario.md`
- `frontend/app/*/.gitkeep`
- `frontend/components/*/.gitkeep`
- `frontend/hooks/.gitkeep`
- `frontend/lib/.gitkeep`
- `frontend/stores/.gitkeep`
- `frontend/types/*/.gitkeep`

Puntos para integrar luego con inventario:
- `InventoryIntegrationPort.check_material_availability` debe consultar stock sin mutarlo.
- `InventoryIntegrationPort.reserve_materials_for_production` queda reservado para bloqueo o reserva futura de materiales.
- `InventoryIntegrationPort.commit_finished_production` debe ser implementado por inventario para crear movimientos historicos, descontar consumo y registrar ingreso de producto terminado.
- Produccion no debe escribir stock directamente ni crear movimientos de inventario fuera del contrato compartido.

Verificaciones ejecutadas:
- Se reviso `git status -sb` antes de modificar: el arbol estaba limpio en `main...origin/main`.

Verificaciones no ejecutadas o no completadas:
- No se pudo ejecutar compilacion Python porque `python` no esta disponible en PATH.
- No se pudo ejecutar compilacion con `py` porque el launcher reporto que no hay Python instalado.

### 2026-06-17 - Continuacion modulo produccion

Que se hizo:
- Se reviso `PROMPT_AGENTE_PRODUCCION.md`, `TASK_Inventario.md` y `backend/modules/shared/contracts/inventory.py` antes de editar.
- Se reviso la estructura actual del proyecto, el estado de git y los archivos existentes del modulo de produccion.
- Se agregaron modelos de plantillas de proceso y etapas configurables dentro de produccion.
- Se agregaron esquemas Pydantic para crear y leer plantillas de proceso, etapas de orden y operaciones de inicio/finalizacion de etapa.
- Se amplio el repositorio de produccion para persistir plantillas, consultar plantillas, consultar etapas y hacer `flush` transaccional.
- Se implemento en el servicio la creacion de plantillas con orden de etapas unico.
- Se implemento la creacion de orden copiando etapas activas desde la plantilla como snapshot historico de la orden.
- Se implementaron reglas base para iniciar orden, iniciar etapa, finalizar etapa y finalizar orden.
- Se dejo la finalizacion de orden conectada solo al puerto `InventoryIntegrationPort.commit_finished_production`, sin actualizar stock ni crear movimientos.
- Se cableo el router de produccion con sesion de base de datos existente, permisos preparados y endpoints de plantillas, ordenes y etapas.

Que falta:
- Crear migraciones Alembic para `production_process_templates` y `production_process_template_stages`.
- Implementar autenticacion JWT real en `auth` para que `get_current_user` deje de ser placeholder.
- Definir permisos reales en RBAC para `production.process_templates.create`, `production.create`, `production.start`, `production.finish`, `production.stages.start` y `production.stages.finish`.
- Implementar endpoints de lectura/listado para ordenes, plantillas y etapas si el frontend los requiere.
- Implementar calculo de materiales desde composiciones versionadas cuando exista el modulo correspondiente.
- Integrar validacion de disponibilidad/reserva de materiales mediante el contrato compartido, sin mutar inventario desde produccion.
- Agregar pruebas unitarias de estados, snapshots de etapas y validaciones de pesos/observaciones/merma.

Archivos modificados:
- `backend/modules/production/models.py`
- `backend/modules/production/schemas.py`
- `backend/modules/production/repository.py`
- `backend/modules/production/service.py`
- `backend/modules/production/router.py`
- `TASK_Produccion.md`

Puntos para integrar luego con inventario:
- `PendingInventoryIntegration` en el router es un adaptador temporal que falla con `501` cuando se intenta confirmar producto terminado.
- Inventario debera proveer una implementacion real de `InventoryIntegrationPort.commit_finished_production`.
- Produccion aun no invoca `check_material_availability` ni `reserve_materials_for_production` porque no existe calculo de requerimientos desde composicion.
- Cuando existan requerimientos de materiales, produccion debe consultar disponibilidad y solicitar reserva solo por el contrato compartido.
- La finalizacion de orden ya esta preparada para notificar producto terminado por contrato, pero inventario debe encargarse de movimientos historicos, consumo, merma e ingreso de producto terminado.

Verificaciones ejecutadas:
- `git status -sb`
- `git diff --name-only`
- Revision del diff de los archivos de produccion modificados.
- Verificacion de frontera: los cambios listados por git estan en `backend/modules/production/*` y `TASK_Produccion.md`; no se modifico `backend/modules/inventory`.

Verificaciones no ejecutadas o no completadas:
- `python -m compileall backend` no pudo ejecutarse porque `python` no esta disponible en PATH.
- `py -m compileall backend` no pudo ejecutarse porque no hay una instalacion de Python detectada por el launcher.
- No se ejecutaron pruebas automatizadas porque el repositorio no tiene configuracion visible de pytest/requirements/pyproject y no hay Python disponible en el entorno.

### 2026-06-17 - Docker de desarrollo

Que se hizo:
- Se agrego Docker para levantar la API FastAPI y PostgreSQL con `docker-compose`.
- Se agrego `requirements.txt` con dependencias minimas del backend.
- Se agrego `.dockerignore` para evitar copiar basura de desarrollo al build.
- Se agrego `AUTO_CREATE_TABLES` como bandera de desarrollo para crear tablas automaticamente mientras no existan migraciones Alembic.
- Se documento en `README.md` como levantar, revisar logs y abrir `/docs`.

Que falta:
- Reemplazar `AUTO_CREATE_TABLES` por migraciones Alembic cuando el esquema se estabilice.
- Agregar healthcheck formal para esperar PostgreSQL antes de iniciar la API.
- Agregar Docker del frontend cuando exista una aplicacion Next.js real y `package.json`.

Archivos modificados:
- `Dockerfile`
- `docker-compose.yml`
- `.dockerignore`
- `requirements.txt`
- `README.md`
- `backend/app/main.py`
- `backend/modules/config/settings.py`
- `TASK_Produccion.md`

Puntos para integrar luego con inventario:
- El Docker no implementa inventario; solo provee PostgreSQL para que produccion pueda probar persistencia.
- La finalizacion de orden sigue dependiendo de una implementacion futura de `InventoryIntegrationPort`.

Verificaciones ejecutadas:
- `docker-compose config` valido correctamente la estructura del compose.

Verificaciones no ejecutadas o no completadas:
- Aun no se ejecuto `docker-compose up --build` en esta sesion.
- `docker-compose config` mostro warning de acceso denegado a `C:\Users\MSI I7\.docker\config.json`, pero devolvio exit code 0.

### 2026-06-17 - Instrucciones Docker para agentes

Que se hizo:
- Se actualizo `PROMPT_AGENTE_PRODUCCION.md` para exigir que el agente de produccion mantenga Docker actualizado si agrega dependencias, variables, puertos, servicios o comandos.
- Se actualizo `PROMPT_AGENTE_INVENTARIO.md` con la misma regla para el agente de inventario.
- Se actualizo `PROMPT_AGENTE_GENERICO.md` para que cualquier agente de modulo trate Docker como parte del contrato de ejecucion compartida.
- Se actualizo `TASK_Inventario.md` con el recordatorio inicial para el agente de inventario.

Que falta:
- Cada agente debe seguir registrando en su `TASK_*.md` si Docker cambio o si no requirio cambios.
- Si un modulo agrega dependencias o servicios, debe ejecutar `docker-compose config` y, si es razonable, `docker-compose up --build`.

Archivos modificados:
- `PROMPT_AGENTE_GENERICO.md`
- `PROMPT_AGENTE_PRODUCCION.md`
- `PROMPT_AGENTE_INVENTARIO.md`
- `TASK_Inventario.md`
- `TASK_Produccion.md`

Puntos para integrar luego con inventario:
- El agente de inventario ya tiene instruccion explicita de mantener Docker compatible cuando implemente `InventoryIntegrationPort`.
- La integracion futura debe seguir usando `shared` y no mezclar logica entre produccion e inventario.

Docker:
- Sin cambios tecnicos adicionales en Docker en esta sesion; se actualizaron instrucciones para que futuros cambios de modulo mantengan Docker al dia.

Verificaciones ejecutadas:
- `git status -sb`
- `git diff --name-only`

Verificaciones no ejecutadas o no completadas:
- No se ejecuto `docker-compose config` por esta actualizacion de prompts porque no se modificaron archivos Docker.

### 2026-06-17 - Skill global de frontend

Que se hizo:
- Se normalizo `SKILL.md` como skill global de diseno web para todo el ERP.
- Se agregaron reglas de interfaz integrada para que produccion e inventario compartan lenguaje visual, estados, tablas, formularios, componentes y patrones de flujo.
- Se actualizo `PROMPT_AGENTE_PRODUCCION.md` para exigir leer `SKILL.md` antes de cualquier cambio frontend.
- Se actualizo `PROMPT_AGENTE_INVENTARIO.md` para que el agente de inventario use el mismo skill global.
- Se actualizo `PROMPT_AGENTE_GENERICO.md` para que cualquier modulo frontend use `SKILL.md`.

Que falta:
- Cuando se implemente frontend de produccion, crear o reutilizar componentes compartidos siguiendo `SKILL.md`.
- Cuando inventario implemente su frontend, reutilizar los mismos componentes compartidos siempre que aplique.
- Definir package/scripts frontend reales cuando exista una app Next.js funcional.

Archivos modificados:
- `SKILL.md`
- `PROMPT_AGENTE_GENERICO.md`
- `PROMPT_AGENTE_PRODUCCION.md`
- `PROMPT_AGENTE_INVENTARIO.md`
- `TASK_Produccion.md`
- `TASK_Inventario.md`

Puntos para integrar luego con inventario:
- Produccion e inventario deben usar componentes compartidos para tablas, filtros, badges, estados vacios, carga, errores, dialogs, drawers y layout.
- Produccion debe mostrar puntos de integracion con inventario sin implementar logica de inventario.
- Inventario debe mostrar puntos de integracion con produccion sin implementar logica de produccion.

Docker:
- Sin cambios requeridos por esta actualizacion; solo se modificaron instrucciones y el skill global.

Reglas de `SKILL.md` aplicadas:
- Se establecio un diseno ERP SaaS integrado, operacional y consistente.
- Se priorizo frontend compartido para patrones reutilizables entre modulos.

Verificaciones ejecutadas:
- `git status -sb`

Verificaciones no ejecutadas o no completadas:
- No se ejecuto `docker-compose config` porque no se modificaron archivos Docker.

### 2026-06-17 - Lectura y ciclo de vida de ordenes

Que se hizo:
- Se reviso `claude.md`, `PROMPT_AGENTE_PRODUCCION.md`, `TASK_Produccion.md`, `TASK_Inventario.md` y `backend/modules/shared/contracts/inventory.py` antes de editar.
- Se reviso la estructura actual del proyecto y el estado de git.
- Se detecto un directorio no rastreado `ERP_joyeria/` con una copia anidada del proyecto; no se modifico.
- Se agregaron consultas de repositorio para obtener y listar plantillas de proceso con sus etapas precargadas.
- Se agregaron consultas de repositorio para obtener y listar ordenes de produccion con sus etapas precargadas.
- Se agregaron servicios de lectura/listado de plantillas y ordenes.
- Se agrego validacion de estado al filtrar ordenes de produccion.
- Se agregaron reglas de pausa, reanudacion y cancelacion de ordenes sin tocar inventario.
- Se agregaron endpoints `GET /api/production/process-templates`, `GET /api/production/process-templates/{process_template_id}`, `GET /api/production/orders`, `GET /api/production/orders/{order_id}`, `POST /api/production/orders/{order_id}/pause`, `POST /api/production/orders/{order_id}/resume` y `POST /api/production/orders/{order_id}/cancel`.
- Se normalizo el mapeo de errores de dominio para devolver `404` cuando el recurso no existe y `409` para conflictos de negocio.

Que falta:
- Crear migraciones Alembic para las tablas de produccion.
- Implementar autenticacion JWT real y permisos RBAC reales para los permisos nuevos: `production.read`, `production.process_templates.read`, `production.pause`, `production.resume` y `production.cancel`.
- Agregar pruebas unitarias para lectura/listado, filtro por estado, pausa, reanudacion y cancelacion.
- Definir si se necesita auditoria especifica para pausa, reanudacion y cancelacion cuando exista el modulo de auditoria.
- Implementar calculo de materiales desde composiciones versionadas cuando exista el modulo correspondiente.
- Integrar disponibilidad/reserva de materiales mediante el contrato compartido, sin mutar inventario desde produccion.

Archivos modificados:
- `backend/modules/production/repository.py`
- `backend/modules/production/service.py`
- `backend/modules/production/router.py`
- `TASK_Produccion.md`

Puntos para integrar luego con inventario:
- No se agrego logica de inventario ni se modifico `backend/modules/inventory`.
- La lectura y los cambios de estado de orden no actualizan stock ni crean movimientos.
- La finalizacion de orden sigue dependiendo de `InventoryIntegrationPort.commit_finished_production`.
- Cuando existan requerimientos de materiales, produccion debera usar `check_material_availability` y `reserve_materials_for_production` desde `shared`.

Docker:
- Sin cambios requeridos en archivos Docker, dependencias, variables, puertos ni comandos.
- Se uso Docker existente para validar la API y compilar el backend dentro del contenedor.

Reglas de `SKILL.md` aplicadas:
- No aplica; no se modifico frontend.

Verificaciones ejecutadas:
- `git status -sb`
- `git diff --name-only`
- Revision del diff de `backend/modules/production/repository.py`, `backend/modules/production/service.py` y `backend/modules/production/router.py`.
- `python -m compileall backend` intento local: fallo porque `python` no esta disponible en PATH.
- `py -m compileall backend` intento local: fallo porque no hay Python instalado detectado por el launcher.
- `docker-compose config` valido correctamente la configuracion, con warning de acceso denegado a `C:\Users\MSI I7\.docker\config.json`.
- `docker-compose up --build -d` reconstruyo y levanto la API y PostgreSQL.
- `docker-compose exec api python -m compileall backend` compilo correctamente el backend dentro del contenedor.
- `docker-compose ps` mostro `api` y `db` en estado `Up`.
- `docker-compose logs api --tail 80` mostro arranque correcto de Uvicorn y startup completo.

Verificaciones no ejecutadas o no completadas:
- No se ejecutaron pruebas automatizadas porque el repositorio aun no tiene suite visible de tests para produccion.
- No se probaron endpoints HTTP autenticados porque `get_current_user` sigue siendo placeholder hasta implementar JWT real.

### 2026-06-17 - Frontend Next.js y servicio Docker web

Que se hizo:
- Se leyo `SKILL.md` completo antes de modificar frontend.
- Se creo una app Next.js real dentro de `frontend` con TypeScript.
- Se creo la ruta `/` redirigiendo a `/produccion`.
- Se creo la pantalla `/produccion` con shell ERP, navegacion lateral, resumen operativo, tabla de ordenes, filtros, acciones y panel de integracion pendiente con inventario.
- Se agregaron componentes compartidos de layout y badge de estado para reutilizacion posterior.
- Se agregaron tipos frontend especificos de produccion.
- Se agrego `frontend/Dockerfile` para instalar dependencias Node y correr Next en Docker.
- Se agrego el servicio `web` a `docker-compose.yml` en el puerto 3000.
- Se agrego `NEXT_PUBLIC_API_URL=http://localhost:8000` al servicio `web`.
- Se actualizo `.dockerignore`, `frontend/.dockerignore`, `frontend/.gitignore` y `README.md`.
- Se actualizo Next a `16.2.9` y ESLint a `9.39.4` despues de que npm reporto vulnerabilidad en `next@14.2.20`.

Que falta:
- Conectar la pantalla de produccion con API real cuando JWT y permisos esten implementados.
- Crear formularios reales para nueva orden y plantillas de proceso.
- Reemplazar datos demo de la tabla por consultas a endpoints de produccion.
- Implementar estados de carga, error y vacio conectados a API real.
- Agregar pruebas frontend cuando exista configuracion de test.

Archivos modificados:
- `.dockerignore`
- `README.md`
- `docker-compose.yml`
- `frontend/Dockerfile`
- `frontend/.dockerignore`
- `frontend/.eslintrc.json`
- `frontend/.gitignore`
- `frontend/next-env.d.ts`
- `frontend/next.config.mjs`
- `frontend/package.json`
- `frontend/tsconfig.json`
- `frontend/app/globals.css`
- `frontend/app/layout.tsx`
- `frontend/app/page.tsx`
- `frontend/app/produccion/page.tsx`
- `frontend/components/layout/app-shell.tsx`
- `frontend/components/production/production-dashboard.tsx`
- `frontend/components/ui/status-badge.tsx`
- `frontend/types/production/index.ts`
- `TASK_Produccion.md`

Puntos para integrar luego con inventario:
- La UI muestra el estado "Pendiente de integracion" sin implementar logica de inventario.
- Inventario debera implementar disponibilidad, reservas y movimientos mediante los contratos compartidos.
- El componente `StatusBadge` puede reutilizarse luego para inventario con estados compatibles.
- El `AppShell` compartido queda preparado para que inventario use la misma navegacion y lenguaje visual.

Docker:
- Se agrego el servicio `web` para levantar Next.js en `http://localhost:3000`.
- `docker-compose up --build -d` deberia instalar dependencias del backend y frontend dentro de contenedores.
- No se requiere Python ni Node local para trabajar si Docker esta funcionando.

Reglas de `SKILL.md` aplicadas:
- Pantalla operacional, no landing page.
- Sidebar y header como shell ERP integrado.
- UI densa, escaneable y en espanol.
- Componentes compartidos para layout y badges.
- No se hardcodearon nombres reales de procesos, etapas, materiales o categorias de joyeria como logica de UI.

Verificaciones ejecutadas:
- `docker-compose config` valido correctamente el servicio `web`, con warning de acceso denegado a `C:\Users\MSI I7\.docker\config.json`.
- `docker-compose up --build -d` con Next 14 levanto `web`, `api` y `db`.
- `docker-compose exec web npm run build` compilo correctamente la ruta `/produccion` con Next 14.
- `curl.exe -I http://localhost:3000/produccion` devolvio `200 OK` antes del upgrade de Next.
- `curl.exe -I http://localhost:8000/docs` devolvio `200 OK`.
- `docker-compose up --build -d web` con Next 16 llego a instalar dependencias y construir imagen `web`, pero fallo al recrear contenedores por error interno de Docker Desktop.

Verificaciones no ejecutadas o no completadas:
- No se pudo confirmar el contenedor final con Next 16 en esta maquina porque Docker Desktop entro en errores `input/output error` al recrear contenedores, leer logs y ejecutar comandos dentro de `web`.
- `docker info` termino con permisos/daemon inconsistentes y el intento de esperar el engine fue abortado.
- Queda pendiente ejecutar nuevamente `docker-compose up --build -d` en un Docker Desktop sano para confirmar el estado final del contenedor local.

### 2026-06-17 - Docker confirmado para backend y frontend

Que se hizo:
- Se reinicio WSL con `wsl --shutdown` para recuperar Docker Desktop despues de errores `input/output error`.
- Se inicio Docker Desktop y se espero a que el engine respondiera correctamente.
- Se ajusto `.dockerignore` para excluir `frontend` del contexto de build del backend, evitando que cambios del front fuercen rebuilds innecesarios del API.
- Se actualizo el volumen `frontend_node_modules` ejecutando `npm install` dentro del contenedor `web`.
- Se agrego `frontend/app/not-found.tsx` para que `next build` con Next 16 compile correctamente.
- Se aceptaron los ajustes automaticos de Next en `frontend/tsconfig.json`.
- Se genero `frontend/package-lock.json` desde el contenedor para fijar dependencias del frontend.
- Se recreo el contenedor `web` para que arranque con Next 16.2.9.

Que falta:
- Conectar datos reales del frontend con la API cuando JWT y permisos esten listos.
- Resolver las vulnerabilidades moderadas reportadas por `npm audit` cuando Next publique una ruta de fix sin downgrade incompatible.

Archivos modificados:
- `.dockerignore`
- `frontend/app/not-found.tsx`
- `frontend/package-lock.json`
- `frontend/tsconfig.json`
- `TASK_Produccion.md`

Puntos para integrar luego con inventario:
- Sin cambios de logica de inventario.
- El Docker compartido ya levanta frontend, backend y base para que inventario pueda trabajar sobre el mismo entorno.

Docker:
- Confirmado con `docker-compose up --build -d`.
- Servicios arriba: `web`, `api` y `db`.
- Frontend disponible en `http://localhost:3000` y `http://localhost:3000/produccion`.
- API disponible en `http://localhost:8000/docs`.
- No se requiere Python ni Node local para levantar el proyecto.

Reglas de `SKILL.md` aplicadas:
- Se mantuvo pantalla operacional con shell compartido y componentes reutilizables.

Verificaciones ejecutadas:
- `wsl --shutdown`
- Inicio de Docker Desktop.
- Espera de Docker engine hasta `Docker engine ready`.
- `docker-compose up --build -d`
- `docker-compose ps`
- `docker-compose logs web --tail 80`
- `docker-compose logs api --tail 80`
- `docker-compose exec web npm install`
- `docker-compose exec web npm run build`
- `docker-compose up -d --force-recreate web`
- `curl.exe -I http://localhost:3000/produccion` devolvio `200 OK`.
- `curl.exe -I http://localhost:8000/docs` devolvio `200 OK`.
- `docker-compose exec api python -m compileall backend` compilo correctamente.
- `docker-compose config` valido correctamente, con warning persistente de acceso denegado a `C:\Users\MSI I7\.docker\config.json`.
- `docker-compose exec web npm audit --audit-level=high` devolvio exit code 0; solo reporto vulnerabilidades moderadas.

Verificaciones no ejecutadas o no completadas:
- No se aplico `npm audit fix --force` porque proponia un cambio incompatible que bajaria Next a `9.3.3`.

### 2026-06-17 - Produccion funcional sin datos falsos en frontend

Que se hizo:
- Se elimino el uso de datos demo en la pantalla de produccion.
- Se agrego cliente HTTP frontend en `frontend/lib/api.ts`.
- Se agrego servicio frontend de produccion en `frontend/lib/production-api.ts`.
- Se ampliaron tipos frontend de produccion para plantillas, ordenes y etapas reales.
- Se convirtio `ProductionDashboard` en componente cliente que consume la API real.
- Se implemento listado real de plantillas activas desde `GET /api/production/process-templates`.
- Se implemento listado real de ordenes desde `GET /api/production/orders`.
- Se implemento formulario real para crear plantillas con etapas dinamicas.
- Se implemento formulario real para crear ordenes de produccion contra plantillas existentes.
- Se implementaron acciones reales de iniciar, pausar, reanudar y cancelar ordenes desde frontend.
- Se agregaron estados de carga, error, exito, vacio y filtros reales en la pantalla.
- Se agrego CORS en FastAPI configurable por `CORS_ORIGINS`.
- Se agrego modo `DEV_AUTH_ENABLED` para que Docker levante un usuario local con permisos de produccion mientras JWT real sigue pendiente.
- Se actualizo `docker-compose.yml` con `CORS_ORIGINS=http://localhost:3000` y `DEV_AUTH_ENABLED=true`.
- Se actualizo `README.md` documentando el usuario local de desarrollo.

Que falta:
- Reemplazar `DEV_AUTH_ENABLED` por autenticacion JWT real antes de produccion.
- Conectar ordenes con catalogo real de productos cuando exista el modulo correspondiente; por ahora se usa UUID de producto porque produccion no debe implementar productos ni inventario.
- Crear formularios avanzados para configurar flags por etapa: pesos, merma, observacion obligatoria, tiempo estimado y obligatoriedad.
- Implementar pantalla de detalle de orden y ejecucion granular de etapas desde frontend.
- Implementar finalizacion de orden cuando inventario implemente `InventoryIntegrationPort.commit_finished_production`.
- Agregar pruebas automatizadas frontend/backend.

Archivos modificados:
- `backend/app/main.py`
- `backend/modules/auth/dependencies.py`
- `backend/modules/config/settings.py`
- `docker-compose.yml`
- `README.md`
- `frontend/app/globals.css`
- `frontend/components/production/production-dashboard.tsx`
- `frontend/lib/api.ts`
- `frontend/lib/production-api.ts`
- `frontend/types/production/index.ts`
- `TASK_Produccion.md`

Puntos para integrar luego con inventario:
- La pantalla ya no simula datos; consume produccion real.
- La finalizacion sigue bloqueada hasta que inventario provea el puerto real.
- Produccion sigue sin actualizar stock ni crear movimientos de inventario.
- Cuando inventario este listo, el frontend debera mostrar disponibilidad, reservas y handoff terminado usando datos reales del contrato.

Docker:
- Confirmado con rebuild completo.
- `web`, `api` y `db` levantan con `docker-compose up --build -d`.
- `DEV_AUTH_ENABLED=true` es solo para desarrollo Docker local.

Reglas de `SKILL.md` aplicadas:
- Se mantuvo UI operacional y escaneable.
- Se agregaron formularios, filtros, estados de carga, error, exito y vacio.
- No se agregaron nombres reales de procesos o etapas de joyeria como logica fija; el usuario crea plantillas desde datos.

Verificaciones ejecutadas:
- `docker-compose up --build -d`
- `docker-compose exec web npm run build`
- `docker-compose exec api python -m compileall backend`
- `curl.exe -sS -o NUL -w "FRONT=%{http_code}" http://localhost:3000/produccion` devolvio `FRONT=200`.
- `curl.exe -sS -o NUL -w "API=%{http_code}" http://localhost:8000/docs` devolvio `API=200`.
- Prueba API real: `POST /api/production/process-templates` creo una plantilla en PostgreSQL.
- Prueba API real: `POST /api/production/orders` creo una orden en PostgreSQL usando la plantilla creada.
- Prueba API real: `GET /api/production/orders` devolvio ordenes persistidas.
- Prueba CORS: `OPTIONS /api/production/orders` con origen `http://localhost:3000` devolvio `200 OK` y `access-control-allow-origin`.
- Logs de API confirmaron `GET` reales desde el frontend a plantillas y ordenes.

Verificaciones no ejecutadas o no completadas:
- No se probo finalizacion de orden porque el adaptador de inventario todavia responde `501` por diseno.

### 2026-06-17 - Ejecucion real de etapas desde frontend

Que se hizo:
- Se agregaron funciones frontend reales para `POST /api/production/stages/{stage_id}/start` y `POST /api/production/stages/{stage_id}/finish`.
- Se agrego panel de detalle de orden en la pantalla de produccion.
- Se permite seleccionar una orden y ver sus etapas reales persistidas.
- Se agregaron acciones para iniciar y finalizar etapas desde el frontend.
- Se agregaron campos operativos por etapa para peso inicial, peso final, merma y observaciones cuando aplican.
- Se agregaron estilos responsive para el panel de etapas.

Que falta:
- Crear vista dedicada de detalle de orden con historial completo.
- Agregar confirmaciones para cancelacion y finalizacion cuando inventario este listo.
- Agregar validaciones frontend mas ricas segun flags de cada etapa.
- Implementar finalizacion de orden cuando exista adaptador real de inventario.

Archivos modificados:
- `frontend/app/globals.css`
- `frontend/components/production/production-dashboard.tsx`
- `frontend/lib/production-api.ts`
- `TASK_Produccion.md`

Puntos para integrar luego con inventario:
- La ejecucion de etapas no toca inventario.
- La finalizacion de orden completa sigue pendiente del puerto `InventoryIntegrationPort.commit_finished_production`.
- La merma capturada por etapa queda en produccion; inventario debera decidir como registrar movimientos cuando se confirme produccion terminada.

Docker:
- Sin cambios adicionales de Docker en este bloque.
- El stack siguio levantado con `web`, `api` y `db`.

Reglas de `SKILL.md` aplicadas:
- Se agrego flujo operativo real dentro de la pantalla, con acciones compactas y estados visibles.
- Se mantuvo interfaz densa y sin datos falsos.

Verificaciones ejecutadas:
- `docker-compose exec web npm run build`
- `docker-compose exec api python -m compileall backend`
- `curl.exe -sS -o NUL -w "FRONT=%{http_code}" http://localhost:3000/produccion` devolvio `FRONT=200`.
- `curl.exe -sS -o NUL -w "API=%{http_code}" http://localhost:8000/docs` devolvio `API=200`.
- Prueba API real: se inicio una orden pendiente con `POST /api/production/orders/{order_id}/start`.
- Prueba API real: se inicio una etapa pendiente con `POST /api/production/stages/{stage_id}/start`.
- Prueba API real: se finalizo la etapa iniciada con `POST /api/production/stages/{stage_id}/finish`.
- `docker-compose ps` mostro `web`, `api` y `db` arriba.

Verificaciones no ejecutadas o no completadas:
- No se ejecuto finalizacion total de orden porque inventario aun no implementa el contrato y el endpoint responde `501` por diseno.

### 2026-06-17 - Correccion de flujo: procesos y ejecucion por etapas

Que se hizo:
- Se corrigio el lenguaje de la interfaz para eliminar "plantillas" y "ordenes" como conceptos visibles.
- Se reorganizo la pantalla en dos flujos:
  - Crear proceso.
  - Jefe de produccion: seleccionar proceso, introducir cantidad de materia prima e iniciar ejecucion.
- Se implemento creacion de etapas con nombre, descripcion, requiere pesaje y tiempo de duracion en minutos.
- Se elimino el campo visible de producto/UUID del flujo operativo; el frontend genera el identificador tecnico temporal porque aun no existe catalogo de productos/materia prima.
- Se agrego listado de procesos creados para seleccionar rapidamente.
- Se agrego tabla de procesos en ejecucion con materia prima, estado, etapa actual y tiempo transcurrido.
- Se agrego panel de avance por etapas con duracion estimada, tiempo transcurrido, requerimiento de pesaje, peso, merma y observaciones.
- Se ajusto el topbar para que la pantalla no parezca "owner", sino modulo de produccion con configuracion y ejecucion.

Que falta:
- Separar por rol real cuando exista autenticacion/RBAC completo: administrador/owner crea procesos y jefe de produccion ejecuta procesos.
- Reemplazar el UUID tecnico generado en frontend por seleccion real de materia prima/producto cuando existan esos modulos.
- Agregar avance automatico opcional a la siguiente etapa luego de finalizar la actual.
- Agregar bloqueo visual por secuencia estricta si se requiere que solo una etapa pueda estar activa a la vez.
- Crear vista dedicada para detalle historico de ejecucion.

Archivos modificados:
- `frontend/app/globals.css`
- `frontend/components/layout/app-shell.tsx`
- `frontend/components/production/production-dashboard.tsx`
- `TASK_Produccion.md`

Puntos para integrar luego con inventario:
- La cantidad ingresada se trata como materia prima operativa en produccion, pero no descuenta stock.
- Cuando inventario este listo, esa cantidad debe validarse/reservarse con `InventoryIntegrationPort.check_material_availability` y `reserve_materials_for_production`.
- La merma registrada por etapa queda preparada para que inventario la convierta en movimiento cuando se confirme la produccion.

Docker:
- Sin cambios adicionales de Docker.

Reglas de `SKILL.md` aplicadas:
- Se mantuvo una pantalla operacional, no demostrativa.
- Se quitaron datos falsos y se priorizo flujo real de trabajo.
- Se mantuvieron procesos y etapas como datos configurables, sin quemar nombres de joyeria.

Verificaciones ejecutadas:
- `docker-compose exec web npm run build`
- Prueba API real: se creo proceso con etapa que requiere pesaje y duracion.
- Prueba API real: se inicio proceso con cantidad de materia prima.
- Prueba API real: se inicio etapa ingresando peso inicial.
- Prueba API real: se avanzo/finalizo etapa ingresando peso final y merma.

Verificaciones no ejecutadas o no completadas:
- No se integro seleccion real de materia prima porque pertenece al modulo de inventario y no debe implementarse aqui.

### 2026-06-17 - Mantenimiento de produccion solo para admin

Que se hizo:
- Se redujo el alcance actual a un unico usuario sembrado: `admin`.
- Se elimino la cuenta `owner` del login, Docker y README; en el siguiente arranque de desarrollo cualquier usuario legacy `owner` queda desactivado.
- Se ajustaron permisos de admin para crear y leer procesos: `production.processes.create` y `production.processes.read`.
- Se dejo la API de produccion limitada a crear y listar procesos configurables con etapas.
- Se preparo limpieza automatica de tablas obsoletas de plantillas/ordenes en el arranque de desarrollo con `AUTO_CREATE_TABLES=true`.
- Se reemplazo la pantalla de produccion por `Mantenimiento de produccion`.
- La pantalla ahora muestra solo el formulario de creacion de procesos.
- El formulario inicia con una sola etapa y permite agregar mas etapas con `+`.
- Las etapas se organizan dentro de una ventana con scroll para no agrandar toda la pagina.
- Se eliminaron del frontend activo las llamadas y tipos de ordenes, plantillas visibles, ejecucion, pausa, avance, cancelacion y etapas operativas.

Que falta:
- Crear migraciones Alembic reales cuando el esquema se estabilice; por ahora la limpieza de tablas viejas ocurre solo en modo desarrollo al arrancar la API.
- Implementar luego el usuario operativo que llenara/ejecutara procesos, separado de este mantenimiento.
- Agregar pruebas automatizadas cuando exista suite de tests del proyecto.

Archivos modificados:
- `backend/app/main.py`
- `backend/modules/auth/dependencies.py`
- `backend/modules/auth/service.py`
- `backend/modules/config/settings.py`
- `backend/modules/production/models.py`
- `backend/modules/production/repository.py`
- `backend/modules/production/router.py`
- `backend/modules/production/schemas.py`
- `backend/modules/production/service.py`
- `docker-compose.yml`
- `README.md`
- `frontend/app/globals.css`
- `frontend/app/login/page.tsx`
- `frontend/components/layout/app-shell.tsx`
- `frontend/components/production/production-dashboard.tsx`
- `frontend/lib/production-api.ts`
- `frontend/types/production/index.ts`
- `TASK_Produccion.md`

Puntos para integrar luego con inventario:
- Sin logica de inventario implementada.
- La creacion de procesos solo define etapas y si requieren pesaje; no valida stock, no reserva materiales y no crea movimientos.
- Cuando se implemente el usuario operativo, la cantidad/materiales deberan validarse mediante `InventoryIntegrationPort.check_material_availability`.
- La reserva futura de materiales debera pasar por `InventoryIntegrationPort.reserve_materials_for_production`.
- La finalizacion futura de produccion debera pasar por `InventoryIntegrationPort.commit_finished_production`.

Docker:
- Se actualizo `docker-compose.yml` para sembrar solo el usuario admin (credenciales via `.env`, ver `.env.example`).
- No se reiniciaron contenedores ni se ejecuto `docker-compose up`, por instruccion expresa del usuario.
- En el proximo arranque manual, `AUTO_CREATE_TABLES=true` limpiara tablas obsoletas de ordenes/plantillas anteriores.

Reglas de `SKILL.md` aplicadas:
- Pantalla operacional, no landing page.
- Un solo formulario enfocado en la tarea actual.
- Controles familiares: checkbox para pesaje, input numerico para duracion y boton `+` para etapas.
- Panel de etapas con scroll para mantener estable el layout.

Verificaciones ejecutadas:
- `git status -sb`
- `git diff --name-only`
- `rg` en rutas activas para confirmar que no quedan endpoints/imports de ordenes, plantillas visibles ni ejecucion operativa de produccion.
- `npm.cmd run build` intento local del frontend.

Verificaciones no ejecutadas o no completadas:
- `npm.cmd run build` no pudo completarse porque Windows no reconoce `next` como comando local fuera del contenedor.
- No se ejecuto build dentro de Docker porque el usuario pidio no reiniciar ni tocar contenedores.
- No se ejecuto `docker-compose config` ni `docker-compose up` por la misma instruccion.
- No se ejecuto compilacion Python dentro del contenedor por la misma instruccion.

### 2026-06-17 - Ventanas de mantenimiento y administracion de procesos

Que se hizo:
- Se cambio la pantalla para que el formulario no aparezca siempre.
- Se agrego un boton `Crear proceso` que abre el formulario en una ventana.
- Se agrego un boton `Procesos` que abre una ventana con los procesos creados.
- Se cambio la captura de etapas para mostrar solo una etapa a la vez.
- Se agregaron flechas izquierda/derecha para navegar entre etapas del formulario.
- Se mantiene el boton `+` para agregar una nueva etapa y moverse directamente a ella.
- Se movio la informacion de sesion al encabezado superior derecho con icono de perfil y boton de salida.
- Se quitaron de la pantalla los botones `Actualizar` y `Salir` que estaban dentro del contenido.
- Se agregaron opciones reales para visualizar, editar y eliminar procesos desde la ventana `Procesos`.
- Se agregaron endpoints backend `PUT /api/production/processes/{process_id}` y `DELETE /api/production/processes/{process_id}`.
- Se ajusto el cliente frontend para aceptar respuestas `204 No Content` al eliminar.

Que falta:
- Agregar confirmaciones visuales propias del sistema en lugar de `window.confirm` cuando exista componente compartido de dialog.
- Agregar pruebas automatizadas para actualizar y eliminar procesos.
- Validar visualmente en navegador cuando el usuario reinicie manualmente Docker.

Archivos modificados:
- `backend/modules/auth/dependencies.py`
- `backend/modules/auth/service.py`
- `backend/modules/production/repository.py`
- `backend/modules/production/router.py`
- `backend/modules/production/schemas.py`
- `backend/modules/production/service.py`
- `frontend/app/globals.css`
- `frontend/components/layout/app-shell.tsx`
- `frontend/components/production/production-dashboard.tsx`
- `frontend/lib/api.ts`
- `frontend/lib/production-api.ts`
- `TASK_Produccion.md`

Puntos para integrar luego con inventario:
- Sin logica de inventario implementada.
- Editar o eliminar procesos solo modifica configuracion de produccion; no descuenta stock ni crea movimientos.
- La futura ejecucion operativa debera consumir disponibilidad, reservas y finalizacion por `InventoryIntegrationPort`.

Docker:
- Sin cambios requeridos.
- No se reiniciaron contenedores ni se ejecuto Docker por instruccion expresa del usuario.

Reglas de `SKILL.md` aplicadas:
- Formulario dentro de ventana de mantenimiento.
- Uso de botones con iconos para acciones claras: crear, visualizar, editar, eliminar, guardar y salir.
- Una etapa visible por vez para evitar scroll largo del formulario.
- Listado de procesos en ventana separada con panel de detalle.

Verificaciones ejecutadas:
- `rg` para confirmar que no quedan referencias activas a plantillas visibles, ordenes ni ejecucion operativa en produccion.
- `rg` para confirmar permisos y endpoints actuales de procesos.
- `git diff --name-only`

Verificaciones no ejecutadas o no completadas:
- No se ejecuto build local porque `next` no esta disponible como comando en Windows fuera del contenedor.
- No se ejecuto build en Docker, `docker-compose config`, `docker-compose up` ni compilacion Python dentro del contenedor porque el usuario pidio no reiniciar ni tocar contenedores.

### 2026-06-17 - Correccion de crear proceso y visualizar

Que se hizo:
- Se corrigio el bloqueo de `Crear proceso` para que admin pueda abrir el formulario aunque el token o la base local todavia tengan permisos antiguos.
- Se agrego bypass backend para rol `admin` en permisos `production.processes.*`, evitando que una sesion local vieja bloquee crear/editar/eliminar procesos.
- Se cambio `Visualizar` para abrir una ventana dedicada con nombre, descripcion y etapas del proceso.
- Se mantuvieron `Editar` y `Eliminar` como acciones separadas en la ventana `Procesos`.

Que falta:
- Reiniciar o recargar manualmente el contenedor/navegador si la UI aun muestra bundle anterior.
- Cerrar sesion y volver a entrar si el navegador conserva un token viejo y la recarga automatica no lo actualiza.

Archivos modificados:
- `backend/modules/production/router.py`
- `frontend/app/globals.css`
- `frontend/components/production/production-dashboard.tsx`
- `TASK_Produccion.md`

Puntos para integrar luego con inventario:
- Sin cambios; no se implemento inventario ni movimientos de stock.

Docker:
- Sin cambios requeridos.
- No se reiniciaron contenedores ni se ejecuto Docker por instruccion previa del usuario.

Verificaciones ejecutadas:
- `rg` confirmo `canCreate`, `canUpdate`, `canDelete`, ventana `viewingProcess` y bypass admin en router.
- `git diff --name-only`

Verificaciones no ejecutadas o no completadas:
- No se ejecuto build ni pruebas en Docker porque el usuario pidio no tocar contenedores.

### 2026-06-17 - Mantenimientos del sistema y usuarios

Que se hizo:
- Se cambio el item del sidebar a `Mantenimientos`.
- Se elimino `Usuarios` del sidebar.
- Se cambio el encabezado superior a `Mantenimientos del sistema`.
- Se cambio el titulo de la pantalla a `Mantenimientos del sistema`.
- Se organizo la pantalla en secciones de mantenimiento:
  - `Produccion`
  - `Usuarios`
- Debajo de Produccion se mantienen `Crear proceso` y `Procesos`.
- Debajo de Usuarios se agregaron `Crear usuario` y `Usuarios`.
- Se conecto Usuarios al backend real de autenticacion usando `auth_users`.
- Se agregaron endpoints para listar, crear, editar y eliminar usuarios:
  - `GET /api/auth/users`
  - `POST /api/auth/users`
  - `PUT /api/auth/users/{user_id}`
  - `DELETE /api/auth/users/{user_id}`
- Se agregaron funciones frontend para consumir esos endpoints.
- Se agrego formulario real de usuario con usuario, contrasena, rol admin y estado activo.
- Se agrego listado real de usuarios con editar y eliminar.
- Se bloqueo eliminar el usuario de la sesion actual desde la UI.

Que falta:
- Definir roles adicionales cuando el sistema deje de manejar solo `admin`.
- Agregar permisos RBAC completos para usuarios cuando exista el modulo formal de roles/permisos.
- Cambiar confirmaciones nativas por un dialog compartido del sistema.

Archivos modificados:
- `backend/modules/auth/router.py`
- `backend/modules/auth/schemas.py`
- `backend/modules/auth/service.py`
- `frontend/app/globals.css`
- `frontend/components/layout/app-shell.tsx`
- `frontend/components/production/production-dashboard.tsx`
- `frontend/lib/auth-api.ts`
- `TASK_Produccion.md`

Puntos para integrar luego con inventario:
- Sin cambios; no se implemento logica de inventario.

Docker:
- Sin cambios requeridos.
- No se reiniciaron contenedores ni se ejecuto Docker.

Verificaciones ejecutadas:
- `rg` confirmo `Mantenimientos` en sidebar y encabezado.
- `rg` confirmo que ya no existe `label: "Usuarios"` en el sidebar.
- `rg` confirmo endpoints y cliente frontend de `/api/auth/users`.
- `git diff --name-only`
- `git status -sb`

Verificaciones no ejecutadas o no completadas:
- No se ejecuto build ni pruebas en Docker porque el usuario pidio no tocar contenedores en esta tanda de cambios.

### 2026-06-17 - Retorno a ventanas y mensajes temporales

Que se hizo:
- Se ajusto el cierre del formulario de editar proceso para volver a la ventana `Procesos`.
- Se ajusto el guardado de editar proceso para volver a la ventana `Procesos`.
- Se ajusto el cierre del formulario de editar usuario para volver a la ventana `Usuarios`.
- Se ajusto el guardado de editar usuario para volver a la ventana `Usuarios`.
- Se agrego autolimpieza de mensajes de error/exito despues de 5 segundos.
- Se movieron los mensajes a un aviso flotante para que se vean aunque haya una ventana modal abierta.

Que falta:
- Validar visualmente en navegador despues del reinicio/recarga manual del frontend.

Archivos modificados:
- `frontend/app/globals.css`
- `frontend/components/production/production-dashboard.tsx`
- `TASK_Produccion.md`

Puntos para integrar luego con inventario:
- Sin cambios; no se implemento logica de inventario.

Docker:
- Sin cambios requeridos.
- No se reiniciaron contenedores ni se ejecuto Docker.

Verificaciones ejecutadas:
- `rg` confirmo los estados de retorno a ventanas, cierre de formularios, temporizador de 5 segundos y `toastStack`.
- `git diff --name-only`
- `git status -sb`

Verificaciones no ejecutadas o no completadas:
- No se ejecuto build ni pruebas en Docker porque el usuario no pidio reiniciar/ejecutar contenedores.

### 2026-06-17 - Roles, datos completos de usuario y eliminacion de etapas

Que se hizo:
- Se agrego boton `Eliminar etapa` en crear/editar proceso.
- `Eliminar etapa` queda deshabilitado cuando solo existe una etapa, para evitar procesos sin etapas.
- Se agregaron los roles del sistema:
  - `Jefe de producción`
  - `Admin`
  - `Jefe de inventario`
- Se cambio el rol sembrado de admin a `Admin`.
- Se ajusto el bypass de permisos de produccion para aceptar `admin` y `Admin`.
- Se quitaron los checkbutton de activo del formulario de usuario.
- El formulario de usuario ahora pide:
  - Usuario
  - Nombre
  - Apellido
  - Correo
  - Contrasena
  - Repetir contrasena
  - Rol
- Se valida en frontend y backend que las contrasenas coincidan.
- Se agregaron campos `first_name`, `last_name` y `email` al modelo `auth_users`.
- Se agrego actualizacion automatica de desarrollo para agregar esas columnas si la tabla ya existe.
- En la vista de usuarios se muestran opciones para editar, desactivar y eliminar.
- Se agrego endpoint `POST /api/auth/users/{user_id}/deactivate`.
- Se impide desde UI y backend desactivar la propia sesion.

Que falta:
- Reiniciar manualmente la API para que se apliquen las columnas nuevas en la base local mediante `AUTO_CREATE_TABLES=true`.
- Crear migraciones Alembic reales para estos cambios de usuarios cuando se formalice el esquema.
- Definir permisos reales de `Jefe de producción` y `Jefe de inventario` cuando se implementen sus pantallas operativas.

Archivos modificados:
- `backend/app/main.py`
- `backend/modules/auth/models.py`
- `backend/modules/auth/router.py`
- `backend/modules/auth/schemas.py`
- `backend/modules/auth/service.py`
- `backend/modules/production/router.py`
- `frontend/components/production/production-dashboard.tsx`
- `frontend/lib/auth-api.ts`
- `TASK_Produccion.md`

Puntos para integrar luego con inventario:
- Se creo el rol `Jefe de inventario`, pero no se implemento logica de inventario.
- Los permisos reales de inventario deben asignarse cuando exista el modulo operativo de inventario.

Docker:
- Sin cambios en archivos Docker.
- No se reiniciaron contenedores ni se ejecuto Docker.

Verificaciones ejecutadas:
- `rg` confirmo roles del sistema, campos nuevos de usuario, confirmacion de contrasena, endpoint de desactivar y boton `Eliminar etapa`.
- `rg` confirmo que el formulario de usuario ya no tiene checkbutton de activo; `is_active` solo queda para mostrar estado y bloquear acciones.
- `git diff --name-only`

Verificaciones no ejecutadas o no completadas:
- No se ejecuto build ni pruebas en Docker porque no se pidio reiniciar/ejecutar contenedores.

### 2026-06-29 - Produccion separada de mantenimientos y flujo con Inventario

Que se hizo:
- Se separo el uso de `/produccion` como ventana operativa y `/mantenimientos` como ventana de configuracion de procesos/usuarios.
- La ventana operativa de Produccion ahora crea una orden en estado `PENDIENTE_INVENTARIO`.
- El sistema calcula la materia prima total requerida con la cantidad a fabricar y la cantidad por unidad del proceso.
- Se agrego el paso `Aprobar salida` para que Inventario descuente materia prima antes de iniciar.
- Se agrego el paso `Iniciar produccion` solo cuando los materiales ya estan aprobados.
- Las etapas productivas se habilitan solo en estado `EN_PROCESO`.
- Al terminar la ultima etapa, la orden queda en `PENDIENTE_RECEPCION` y no ingresa automaticamente producto terminado.
- Se agrego `Recibir en Inventario` para registrar el ingreso final y dejar la orden en `RECIBIDA`.
- Se agregaron endpoints para aprobar materiales, iniciar orden y recibir producto terminado.
- Se actualizaron los estados, fechas y tipos del flujo de produccion.
- Se agregaron columnas de compatibilidad en arranque para `requested_at`, `materials_approved_at` y `received_at`.

Que falta:
- Crear la bandeja visual definitiva de Inventario para aprobar solicitudes y recibir terminado desde `/inventario`.
- Implementar el formato imprimible de acta cuando el usuario envie el diseno.
- Modelar documentos/actas como entidad propia si se necesita auditoria formal.
- Cargar procesos de ejemplo mas fieles a los documentos: cadenas, monedas, medallas y casting, con sus etapas y controles.
- Validar visualmente el flujo completo en navegador con datos reales.

Archivos modificados:
- `backend/app/main.py`
- `backend/modules/auth/dependencies.py`
- `backend/modules/auth/service.py`
- `backend/modules/production/models.py`
- `backend/modules/production/repository.py`
- `backend/modules/production/router.py`
- `backend/modules/production/schemas.py`
- `backend/modules/production/service.py`
- `frontend/components/production/production-dashboard.tsx`
- `frontend/lib/production-api.ts`
- `frontend/types/production/index.ts`
- `TASK_Produccion.md`

Puntos para integrar luego con inventario:
- Las solicitudes `PENDIENTE_INVENTARIO` deben mostrarse como trabajo propio de Inventario.
- Las ordenes `PENDIENTE_RECEPCION` deben mostrarse en productos terminados para registrar ingreso.
- La impresion parcial debe generarse al aprobar salida y la impresion completa al recibir producto terminado.
- Los movimientos de inventario deben mantener referencia a la orden de produccion para abrir historial directo.

Docker:
- No se levanto Docker.
- `docker-compose ps` indico que `api`, `db` y `web` ya estaban arriba.

Verificaciones ejecutadas:
- `npm.cmd run build` paso correctamente.
- `git diff --check` no reporto errores de whitespace.
- `docker-compose ps` se uso solo para consultar estado.
- `docker-compose exec -T api python -B -c "... ast.parse ..."` valido sintaxis backend y devolvio `PY_AST_OK`; no se levanto ni reinicio Docker.

Verificaciones no ejecutadas o no completadas:
- `npm.cmd run lint` fallo por la configuracion actual de Next 16: `next lint` se interpreta como directorio `frontend/lint`.
- No se ejecuto prueba funcional backend contra base de datos ni reinicio de contenedores.
- No se hizo prueba manual en navegador.

### 2026-06-29 - Rutas faltantes del sidebar

Que se hizo:
- Se agregaron paginas base para las rutas del sidebar que caian en 404: `/reportes`, `/documentos` y `/seguridad`.
- Se agregaron titulos y subtitulos de barra superior para esas rutas.
- Se confirmo que el texto `Ir a produccion` venia de `not-found`, no de la pantalla de Produccion.

Que falta:
- Implementar la funcionalidad real de Reportes, Documentos y Seguridad cuando se defina su alcance.

Archivos modificados:
- `frontend/app/reportes/page.tsx`
- `frontend/app/documentos/page.tsx`
- `frontend/app/seguridad/page.tsx`
- `frontend/components/layout/app-shell.tsx`
- `TASK_Produccion.md`

Puntos para integrar luego con inventario:
- Documentos debera listar/imprimir actas de entrega de materia prima y recepcion de producto terminado.
- Reportes debera consumir datos de produccion e inventario cuando existan los endpoints finales.

Docker:
- No se levanto ni reinicio Docker.
- Si la app se ve desde el contenedor actual, puede requerir reconstruccion manual para tomar estas rutas nuevas.

Verificaciones ejecutadas:
- `npm.cmd run build` paso correctamente y listo las rutas `/documentos`, `/reportes` y `/seguridad`.

Verificaciones no ejecutadas o no completadas:
- No se valido en navegador ni se reinicio el contenedor web.

### 2026-06-17 - Ventana de credenciales simplificada

Que se hizo:
- Se simplifico la ventana emergente de credenciales al crear/restablecer usuario.
- La ventana ahora muestra solo:
  - `Usuario creado` o el titulo correspondiente.
  - Correo.
  - Contrasena temporal.
  - Rol.
- Se quito `Usuario generado` de esa ventana emergente.

Que falta:
- Validar visualmente en navegador luego de recargar el frontend.

Archivos modificados:
- `frontend/components/production/production-dashboard.tsx`
- `TASK_Produccion.md`

Puntos para integrar luego con inventario:
- Sin cambios; no se implemento logica de inventario.

Docker:
- Sin cambios en archivos Docker.
- No se reiniciaron contenedores ni se ejecuto Docker.

Verificaciones ejecutadas:
- `rg` confirmo que `Usuario generado` solo queda en la vista previa del usuario, no en la ventana de credenciales.
- `git diff --name-only`

Verificaciones no ejecutadas o no completadas:
- No se ejecuto build ni pruebas en Docker porque no se pidio reiniciar/ejecutar contenedores.

### 2026-06-17 - Estado de usuario junto al nombre

Que se hizo:
- Se movio el boton `Activar/Desactivar` al encabezado de cada tarjeta de usuario, al lado del nombre.
- `Desactivar` queda en rojo cuando el usuario esta activo.
- `Activar` queda en verde cuando el usuario esta inactivo.
- La tarjeta del usuario cambia a un color rojizo suave cuando esta inactivo.
- Se mantuvieron `Visualizar`, `Editar` y `Eliminar` como acciones inferiores de la tarjeta.

Que falta:
- Validar visualmente en navegador luego de recargar el frontend.

Archivos modificados:
- `frontend/app/globals.css`
- `frontend/components/production/production-dashboard.tsx`
- `TASK_Produccion.md`

Puntos para integrar luego con inventario:
- Sin cambios; no se implemento logica de inventario.

Docker:
- Sin cambios en archivos Docker.
- No se reiniciaron contenedores ni se ejecuto Docker.

Verificaciones ejecutadas:
- `rg` confirmo `userRowHeader`, `userRowInactive` y botones `Activar/Desactivar`.
- `git diff --name-only`

Verificaciones no ejecutadas o no completadas:
- No se ejecuto build ni pruebas en Docker porque no se pidio reiniciar/ejecutar contenedores.

### 2026-06-17 - Identificador de rol en correo generado

Que se hizo:
- Se agrego identificador del rol en el correo generado.
- El correo ahora queda con formato `usuario.identificador@dominio`.
- Identificadores actuales:
  - `Admin` -> `admin`
  - `Jefe de producción` -> `produccion`
  - `Jefe de inventario` -> `inventario`
- La validacion de duplicados considera el correo con identificador de rol.

Que falta:
- Validar visualmente y con API luego de recargar el backend.

Archivos modificados:
- `backend/modules/auth/service.py`
- `TASK_Produccion.md`

Puntos para integrar luego con inventario:
- Se dejo identificador `inventario` para el rol `Jefe de inventario`; no se implemento logica de inventario.

Docker:
- Sin cambios en archivos Docker.
- No se reiniciaron contenedores ni se ejecuto Docker.

Verificaciones ejecutadas:
- `rg` confirmo `ROLE_EMAIL_IDENTIFIERS`, generacion de correo con rol y validacion de duplicados.
- `git diff --name-only`

Verificaciones no ejecutadas o no completadas:
- No se ejecuto build ni pruebas en Docker porque no se pidio reiniciar/ejecutar contenedores.

### 2026-06-17 - Acciones rapidas de usuarios y credenciales temporales

Que se hizo:
- Se movieron `Editar`, `Activar/Desactivar` y `Eliminar` al listado de usuarios, junto a `Visualizar`.
- `Desactivar` se muestra en rojo cuando el usuario esta activo.
- `Activar` se muestra en verde cuando el usuario esta inactivo.
- `Eliminar` se mantiene en rojo.
- La vista previa de usuario queda como detalle y solo mantiene la accion `Restablecer contrasena`.
- La contrasena temporal no se muestra en el listado ni en la vista previa.
- La contrasena temporal se muestra en una ventana de credenciales cuando se crea el usuario o cuando se restablece desde la vista previa.

Que falta:
- Validar visualmente en navegador luego de recargar el frontend.

Archivos modificados:
- `frontend/app/globals.css`
- `frontend/components/production/production-dashboard.tsx`
- `TASK_Produccion.md`

Puntos para integrar luego con inventario:
- Sin cambios; no se implemento logica de inventario.

Docker:
- Sin cambios en archivos Docker.
- No se reiniciaron contenedores ni se ejecuto Docker.

Verificaciones ejecutadas:
- `rg` confirmo acciones rapidas en listado, `successText` para activar y `Restablecer contrasena` dentro de la vista previa.
- `git diff --name-only`

Verificaciones no ejecutadas o no completadas:
- No se ejecuto build ni pruebas en Docker porque no se pidio reiniciar/ejecutar contenedores.

### 2026-06-17 - Usuario generado y vista previa simplificada

Que se hizo:
- Se elimino el campo `Usuario` del formulario de usuario.
- El administrador ahora solo ingresa nombre, apellido y rol.
- El backend genera automaticamente el usuario desde nombre y apellido.
- El backend evita duplicados agregando sufijos numericos al usuario generado si hace falta.
- El correo se sigue generando automaticamente desde el usuario generado y el dominio del sistema.
- Al crear usuario se abre una ventana con usuario generado, correo generado y contrasena temporal.
- Al restablecer contrasena se abre la misma ventana de credenciales temporales.
- El listado de usuarios ahora muestra solo nombre y correo.
- La vista previa de usuario muestra usuario generado, correo generado, rol y estado.
- Las acciones editar, activar/desactivar, restablecer contrasena y eliminar quedan dentro de la vista previa.
- Se normalizan acentos al generar usuarios/correos para nombres en espanol.

Que falta:
- Validar visualmente en navegador luego de recargar el frontend.
- Definir el dominio real mediante `SYSTEM_EMAIL_DOMAIN` al pasar a produccion.

Archivos modificados:
- `backend/modules/auth/router.py`
- `backend/modules/auth/schemas.py`
- `backend/modules/auth/service.py`
- `frontend/components/production/production-dashboard.tsx`
- `frontend/lib/auth-api.ts`
- `TASK_Produccion.md`

Puntos para integrar luego con inventario:
- Sin cambios; no se implemento logica de inventario.

Docker:
- Sin cambios en archivos Docker.
- No se reiniciaron contenedores ni se ejecuto Docker.

Verificaciones ejecutadas:
- `rg` confirmo que el formulario ya no tiene campo visible de usuario.
- `rg` confirmo ventana de credenciales temporales, vista previa y acciones de usuarios.
- `git diff --name-only`

Verificaciones no ejecutadas o no completadas:
- No se ejecuto build ni pruebas en Docker porque no se pidio reiniciar/ejecutar contenedores.

### 2026-06-17 - Reubicacion de controles de etapas en proceso

Que se hizo:
- En la ventana de crear/editar proceso, los botones `Etapa` y `Eliminar etapa` se movieron a la parte superior del bloque de etapa.
- Las flechas para cambiar entre etapas se reubicaron a la mitad izquierda y derecha del formulario de etapa.
- Se ajusto el espaciado interno para que los campos no choquen con las flechas laterales.
- Se agrego ajuste responsive para que los controles de etapa se acomoden mejor en pantallas pequenas.

Que falta:
- Validar visualmente en navegador luego de la recarga manual del frontend.

Archivos modificados:
- `frontend/app/globals.css`
- `frontend/components/production/production-dashboard.tsx`
- `TASK_Produccion.md`

Puntos para integrar luego con inventario:
- Sin cambios; no se implemento logica de inventario.

Docker:
- Sin cambios.
- No se reiniciaron contenedores ni se ejecuto Docker.

Verificaciones ejecutadas:
- `rg` confirmo las clases `stageTopActions`, `stageContent` y flechas laterales en el formulario.
- `git diff -- frontend/components/production/production-dashboard.tsx frontend/app/globals.css`

Verificaciones no ejecutadas o no completadas:
- `npm.cmd run lint` no pudo ejecutarse porque `next` no esta instalado en `frontend/node_modules` local.
- No se ejecuto build ni pruebas en Docker porque no se pidio reiniciar/ejecutar contenedores.

### 2026-06-17 - Alineacion de linea superior con sidebar

Que se hizo:
- Se ajusto el padding del sidebar para que no desplace hacia abajo la linea horizontal.
- Se fijo la zona de marca del sidebar con `min-height: 64px`, igual que la barra superior.
- La linea debajo del perfil/titulo y la linea horizontal del sidebar ahora comparten la misma altura visual.

Que falta:
- Validar visualmente en navegador luego de la recarga manual del frontend.

Archivos modificados:
- `frontend/app/globals.css`
- `TASK_Produccion.md`

Puntos para integrar luego con inventario:
- Sin cambios; no se implemento logica de inventario.

Docker:
- Sin cambios.
- No se reiniciaron contenedores ni se ejecuto Docker.

Verificaciones ejecutadas:
- `rg` confirmo que sidebar y topbar usan la misma altura de referencia.

Verificaciones no ejecutadas o no completadas:
- No se ejecuto build ni pruebas en Docker porque no se pidio reiniciar/ejecutar contenedores.

### 2026-06-17 - Linea del sidebar a ancho completo

Que se hizo:
- Se quito el padding lateral del contenedor `sidebar` para que la linea horizontal de la marca llegue hasta el borde derecho.
- Se movio el padding interno a `brand` y `nav`, manteniendo el contenido alineado sin cortar la linea.
- La linea horizontal del sidebar ahora debe conectar visualmente con la linea debajo del titulo de pagina.

Que falta:
- Validar visualmente en navegador luego de la recarga manual del frontend.

Archivos modificados:
- `frontend/app/globals.css`
- `TASK_Produccion.md`

Puntos para integrar luego con inventario:
- Sin cambios; no se implemento logica de inventario.

Docker:
- Sin cambios.
- No se reiniciaron contenedores ni se ejecuto Docker.

Verificaciones ejecutadas:
- `rg` confirmo el nuevo reparto de padding entre `sidebar`, `brand` y `nav`.
- `git diff -- frontend/app/globals.css`

Verificaciones no ejecutadas o no completadas:
- No se ejecuto build ni pruebas en Docker porque no se pidio reiniciar/ejecutar contenedores.

### 2026-06-17 - Ventana vertical de credenciales de usuario

Que se hizo:
- Se ajusto la ventana emergente de usuario creado/restablecimiento para mostrar los datos en vertical.
- Ahora `Correo`, `Contrasena temporal` y `Rol` aparecen uno debajo del otro, sin usar la vista de dos columnas de la vista previa.

Que falta:
- Validar visualmente en navegador luego de la recarga manual del frontend.

Archivos modificados:
- `frontend/app/globals.css`
- `frontend/components/production/production-dashboard.tsx`
- `TASK_Produccion.md`

Puntos para integrar luego con inventario:
- Sin cambios; no se implemento logica de inventario.

Docker:
- Sin cambios.
- No se reiniciaron contenedores ni se ejecuto Docker.

Verificaciones ejecutadas:
- `rg` confirmo que `credentialsStack` esta definido en CSS y aplicado en la ventana de credenciales.
- `git diff -- frontend/components/production/production-dashboard.tsx frontend/app/globals.css`

Verificaciones no ejecutadas o no completadas:
- No se ejecuto build ni pruebas en Docker porque no se pidio reiniciar/ejecutar contenedores.

### 2026-06-17 - Correo generado, contrasena temporal y reactivacion de usuarios

Que se hizo:
- Se quito el campo correo del formulario de usuario.
- El correo ahora se genera automaticamente desde el usuario y `SYSTEM_EMAIL_DOMAIN`.
- Se agrego `SYSTEM_EMAIL_DOMAIN` con valor temporal `erp.local` hasta definir el dominio real de produccion.
- Se quitaron los campos de contrasena y repetir contrasena del formulario de usuario.
- La contrasena ahora se genera automaticamente en backend como contrasena temporal.
- Al crear usuario se devuelve y muestra la contrasena temporal generada.
- Se agrego opcion para restablecer contrasena desde la vista de usuarios.
- Restablecer contrasena genera una nueva contrasena temporal en backend y la muestra al admin.
- Se agrego opcion para reactivar usuarios inactivos.
- Se mejoro la vista previa/listado de usuarios con campos organizados: usuario, correo generado, rol y estado.
- Se corrigio el mensaje `[object Object]` en errores de API para mostrar detalles legibles de FastAPI.

Que falta:
- Definir el dominio real de correo del sistema cuando se compre y pasar `SYSTEM_EMAIL_DOMAIN` por entorno.
- Implementar flujo formal de cambio obligatorio de contrasena temporal cuando se construya seguridad avanzada.
- Validar visualmente en navegador luego del reinicio/recarga manual.

Archivos modificados:
- `backend/modules/config/settings.py`
- `backend/modules/auth/router.py`
- `backend/modules/auth/schemas.py`
- `backend/modules/auth/service.py`
- `frontend/app/globals.css`
- `frontend/components/production/production-dashboard.tsx`
- `frontend/lib/api.ts`
- `frontend/lib/auth-api.ts`
- `TASK_Produccion.md`

Puntos para integrar luego con inventario:
- Sin cambios; no se implemento logica de inventario.

Docker:
- Sin cambios en archivos Docker.
- No se reiniciaron contenedores ni se ejecuto Docker.

Verificaciones ejecutadas:
- `rg` confirmo endpoints de activar, desactivar y restablecer contrasena.
- `rg` confirmo que el formulario frontend ya no contiene campos de correo ni contrasena para usuario; el correo solo se muestra como generado.
- `git diff --name-only`

Verificaciones no ejecutadas o no completadas:
- No se ejecuto build ni pruebas en Docker porque no se pidio reiniciar/ejecutar contenedores.

### 2026-06-17 - Correccion de selector de tiempo sin dependencia externa

Que se hizo:
- Se corrigio el error `Module not found: Can't resolve '@radix-ui/react-select'` que aparecia en el contenedor web.
- Se quito el import de `@radix-ui/react-select` del formulario de produccion.
- Se reemplazo el selector Radix por un `<select>` nativo accesible con las mismas opciones de tiempo estimado.
- Se retiro `@radix-ui/react-select` de `frontend/package.json` y `frontend/package-lock.json`.
- Se eliminaron los estilos CSS que solo correspondian al selector Radix.

Que falta:
- Validar visualmente en navegador luego de que el frontend recargue el cambio.
- Si luego se quiere una libreria de UI, integrarla asegurando rebuild/instalacion dentro del contenedor Docker.

Archivos modificados:
- `frontend/app/globals.css`
- `frontend/components/production/production-dashboard.tsx`
- `frontend/package-lock.json`
- `frontend/package.json`
- `TASK_Produccion.md`

Puntos para integrar luego con inventario:
- Sin cambios; no se implemento logica de inventario.

Docker:
- Sin cambios en archivos Docker.
- No se reiniciaron contenedores ni se ejecuto Docker.
- El cambio evita depender de una libreria no instalada en el contenedor actual.

Verificaciones ejecutadas:
- `rg` confirmo que no quedan referencias a `@radix-ui/react-select`, `Select.*`, `ChevronDown` ni clases Radix.
- `npm.cmd run build` paso correctamente.

Verificaciones no ejecutadas o no completadas:
- No se reinicio Docker porque no fue solicitado.

### 2026-06-17 - Dashboard de procesos y usuarios

Que se hizo:
- Se creo la ruta `frontend/app/dashboard/page.tsx`.
- Se agrego `SystemDashboard` con datos reales de procesos y usuarios.
- El dashboard muestra metricas de:
  - Procesos creados.
  - Etapas con pesaje.
  - Usuarios totales.
  - Usuarios activos.
- Se agregaron paneles de procesos recientes, usuarios recientes, roles y tiempos de etapas.
- Se ajusto `AppShell` para que el titulo superior y el item activo del sidebar cambien segun la ruta.
- `/dashboard` ahora muestra titulo `Dashboard` y subtitulo `Resumen de procesos y usuarios`.
- `/produccion` mantiene `Mantenimientos del sistema`.
- Se agregaron estilos responsive para el grid y filas del dashboard.

Que falta:
- Validar visualmente en navegador luego de la recarga manual del frontend.
- Agregar mas metricas cuando existan procesos operativos reales, no solo mantenimientos.

Archivos modificados:
- `frontend/app/dashboard/page.tsx`
- `frontend/app/globals.css`
- `frontend/components/dashboard/system-dashboard.tsx`
- `frontend/components/layout/app-shell.tsx`
- `TASK_Produccion.md`

Puntos para integrar luego con inventario:
- Sin cambios; no se implemento logica de inventario.
- El dashboard no consume stock, almacenes, materiales ni movimientos.
- Cuando inventario exista, se podran agregar tarjetas de existencias criticas y movimientos recientes desde sus APIs.

Docker:
- Sin cambios.
- No se reiniciaron contenedores ni se ejecuto Docker.

Verificaciones ejecutadas:
- `rg` confirmo nueva ruta, componente dashboard, estilos y titulos dinamicos del shell.
- `npm.cmd run build` paso correctamente e incluyo la ruta `/dashboard`.

Verificaciones no ejecutadas o no completadas:
- No se reinicio Docker porque no fue solicitado.

### 2026-06-17 - Graficos visuales en dashboard

Que se hizo:
- Se agrego una franja visual al dashboard sin dependencias nuevas.
- Se agrego grafico tipo dona para usuarios activos/inactivos.
- Se agrego grafico de barras para comparar procesos por cantidad de etapas.
- Se agregaron barras compactas dentro del panel de roles.
- Se mantuvieron los datos reales de procesos y usuarios.
- Se agregaron estilos responsive para que los graficos no rompan el layout en pantallas pequenas.

Que falta:
- Validar visualmente en navegador luego de la recarga manual del frontend.
- Ajustar colores o densidad si el usuario prefiere otro estilo visual.

Archivos modificados:
- `frontend/app/globals.css`
- `frontend/components/dashboard/system-dashboard.tsx`
- `TASK_Produccion.md`

Puntos para integrar luego con inventario:
- Sin cambios; no se implemento logica de inventario.
- Los graficos aun no muestran datos de stock, materiales ni movimientos.

Docker:
- Sin cambios.
- No se reiniciaron contenedores ni se ejecuto Docker.

Verificaciones ejecutadas:
- `rg` confirmo `dashboardVisualGrid`, `donutChart`, `barChart` y barras de roles.
- `npm.cmd run build` fallo inicialmente por cache generada corrupta en `.next/dev/types`.
- Se limpio `frontend/.next` como cache generada de Next.
- `npm.cmd run build` paso correctamente despues de limpiar la cache.

Verificaciones no ejecutadas o no completadas:
- No se reinicio Docker porque no fue solicitado.

### 2026-06-17 - Dashboard compacto con scroll interno

Que se hizo:
- Se quito la tarjeta superior `Etapas con pesaje`.
- Se quito el panel `Tiempos de etapas`.
- Se quitaron calculos/imports asociados a tiempos y pesaje en el dashboard.
- El resumen superior queda con tres tarjetas: procesos, usuarios y usuarios activos.
- Los paneles de procesos, usuarios y roles quedan en tres columnas.
- Las listas internas del dashboard ahora tienen `max-height` y scroll vertical para no hacer crecer la pagina hacia abajo.
- Se redujo el alto de las filas del dashboard para que las ventanas/paneles ocupen menos espacio.

Que falta:
- Validar visualmente en navegador luego de la recarga manual del frontend.

Archivos modificados:
- `frontend/app/globals.css`
- `frontend/components/dashboard/system-dashboard.tsx`
- `TASK_Produccion.md`

Puntos para integrar luego con inventario:
- Sin cambios; no se implemento logica de inventario.

Docker:
- Sin cambios.
- No se reiniciaron contenedores ni se ejecuto Docker.

Verificaciones ejecutadas:
- `rg` confirmo que ya no quedan textos `Tiempos de etapas` ni `Etapas con pesaje` en el dashboard.
- `npm.cmd run build` paso correctamente.

Verificaciones no ejecutadas o no completadas:
- No se reinicio Docker porque no fue solicitado.

### 2026-06-17 - Tiempo estimado manual en minutos

Que se hizo:
- Se quito el selector de opciones para `Tiempo estimado`.
- Se dejo un ingreso manual numerico.
- El campo ahora indica `Tiempo estimado en minutos`.
- Se agrego placeholder `Ejemplo: 30`.
- Se elimino la lista interna de opciones predefinidas de tiempo.

Que falta:
- Validar visualmente en navegador luego de la recarga manual del frontend.

Archivos modificados:
- `frontend/components/production/production-dashboard.tsx`
- `TASK_Produccion.md`

Puntos para integrar luego con inventario:
- Sin cambios; no se implemento logica de inventario.

Docker:
- Sin cambios.
- No se reiniciaron contenedores ni se ejecuto Docker.

Verificaciones ejecutadas:
- `rg` confirmo `Tiempo estimado en minutos` y placeholder `Ejemplo: 30`.
- `npm.cmd run build` paso correctamente.

Verificaciones no ejecutadas o no completadas:
- No se reinicio Docker porque no fue solicitado.

### 2026-06-17 - Selector accesible de tiempo estimado

Que se hizo:
- Se cambio el texto `Tiempo de duracion` por `Tiempo estimado`.
- Se reemplazo el input numerico por un selector accesible basado en `@radix-ui/react-select`.
- Las opciones se muestran en minutos y horas equivalentes:
  - 5, 10, 15, 20, 30, 45 minutos.
  - 1 hora, 1 hora 30 minutos, 2, 3, 4, 6 y 8 horas.
- El valor se sigue guardando como minutos para mantener compatible el backend actual.
- Se agregaron estilos del selector al sistema visual del frontend.
- Se agrego `@radix-ui/react-select` a `frontend/package.json` y `frontend/package-lock.json`.

Que falta:
- Validar visualmente en navegador luego de la recarga manual del frontend.
- Decidir si luego se permitiran tiempos personalizados fuera de las opciones predefinidas.

Archivos modificados:
- `frontend/app/globals.css`
- `frontend/components/production/production-dashboard.tsx`
- `frontend/next-env.d.ts`
- `frontend/package-lock.json`
- `frontend/package.json`
- `TASK_Produccion.md`

Puntos para integrar luego con inventario:
- Sin cambios; no se implemento logica de inventario.

Docker:
- Sin cambios en archivos Docker.
- No se reiniciaron contenedores ni se ejecuto Docker.
- La nueva dependencia quedo en `package.json`/`package-lock.json` para instalarse con el flujo Docker normal.

Verificaciones ejecutadas:
- `npm.cmd install @radix-ui/react-select@2.2.6`
- `npm.cmd run build` inicialmente fallo por cache generada corrupta en `.next/dev/types/validator.ts`.
- Se limpio `frontend/.next` como cache generada de Next.
- `npm.cmd run build` paso correctamente despues de limpiar la cache.
- `npm.cmd audit --audit-level=moderate` reporto 2 vulnerabilidades moderadas heredadas de `next/postcss`; no se aplico `npm audit fix --force` porque propone un cambio rompedor de version.
- `rg` confirmo `Tiempo estimado`, `@radix-ui/react-select` y estilos del selector.

Verificaciones no ejecutadas o no completadas:
- `npm.cmd run lint` no es usable con esta version/configuracion porque `next lint` se interpreta como directorio `lint`.
- No se ejecuto build ni pruebas en Docker porque no se pidio reiniciar/ejecutar contenedores.

### 2026-06-17 - Listado de procesos sin panel derecho

Que se hizo:
- Se elimino el panel de detalle que aparecia a la derecha al abrir la ventana `Procesos`.
- La ventana `Procesos` ahora muestra solo el listado de procesos existentes con acciones.
- El nombre del proceso y el boton `Visualizar` abren la ventana dedicada de detalle.
- Se quitaron estado/memo y estilos que sostenian el panel derecho.

Que falta:
- Validar visualmente en navegador luego de la recarga manual del frontend.

Archivos modificados:
- `frontend/app/globals.css`
- `frontend/components/production/production-dashboard.tsx`
- `TASK_Produccion.md`

Puntos para integrar luego con inventario:
- Sin cambios; no se implemento logica de inventario.

Docker:
- Sin cambios.
- No se reiniciaron contenedores ni se ejecuto Docker.

Verificaciones ejecutadas:
- `rg` confirmo que no quedan referencias a `processDetail`, `selectedProcessId` ni `useMemo`.
- `npm.cmd run build` paso correctamente.

Verificaciones no ejecutadas o no completadas:
- No se ejecuto build ni pruebas en Docker porque no se pidio reiniciar/ejecutar contenedores.

### 2026-06-17 - Controles de etapa solo con iconos

Que se hizo:
- El boton de agregar etapa ahora muestra solo el icono `+`.
- El boton de eliminar etapa ahora muestra solo el icono de basurero.
- El boton de eliminar etapa ya no aparece en la etapa 1, aunque existan varias etapas.
- Eliminar etapa actua sobre la etapa actual y solo esta disponible desde la etapa 2 en adelante.
- Se agregaron `title` y `aria-label` a los botones de icono para conservar descripcion accesible.
- Se agrego estilo rojo al boton de basurero en formato icono.

Que falta:
- Validar visualmente en navegador luego de la recarga manual del frontend.

Archivos modificados:
- `frontend/app/globals.css`
- `frontend/components/production/production-dashboard.tsx`
- `TASK_Produccion.md`

Puntos para integrar luego con inventario:
- Sin cambios; no se implemento logica de inventario.

Docker:
- Sin cambios.
- No se reiniciaron contenedores ni se ejecuto Docker.

Verificaciones ejecutadas:
- `rg` confirmo que el basurero se renderiza solo con `selectedStageIndex > 0`.
- `rg` confirmo `dangerIconButton`, `title` y `aria-label` en los controles de etapa.

Verificaciones no ejecutadas o no completadas:
- No se ejecuto build ni pruebas en Docker porque no se pidio reiniciar/ejecutar contenedores.

### 2026-06-17 - Boton eliminar etapa solo desde segunda etapa

Que se hizo:
- `Eliminar etapa` ya no aparece cuando el proceso tiene una sola etapa.
- El boton aparece solo cuando hay dos o mas etapas.
- Se aplico estilo rojo al boton de eliminar etapa para diferenciarlo como accion destructiva.

Que falta:
- Validar visualmente en navegador luego de la recarga manual del frontend.

Archivos modificados:
- `frontend/app/globals.css`
- `frontend/components/production/production-dashboard.tsx`
- `TASK_Produccion.md`

Puntos para integrar luego con inventario:
- Sin cambios; no se implemento logica de inventario.

Docker:
- Sin cambios.
- No se reiniciaron contenedores ni se ejecuto Docker.

Verificaciones ejecutadas:
- `rg` confirmo que `Eliminar etapa` se renderiza solo con `form.stages.length > 1`.
- `rg` confirmo el estilo `.button.dangerText`.

Verificaciones no ejecutadas o no completadas:
- No se ejecuto build ni pruebas en Docker porque no se pidio reiniciar/ejecutar contenedores.

### 2026-06-17 - Titulo integrado en barra superior

Que se hizo:
- Se elimino el titulo duplicado `Mantenimientos del sistema` dentro del contenido.
- Se dejo `Mantenimientos del sistema` solo en la barra superior, integrado con el perfil.
- Se aumento el peso visual del titulo en la barra superior para que funcione como encabezado principal.

Que falta:
- Validar visualmente en navegador luego de la recarga del frontend.

Archivos modificados:
- `frontend/app/globals.css`
- `frontend/components/production/production-dashboard.tsx`
- `TASK_Produccion.md`

Puntos para integrar luego con inventario:
- Sin cambios; no se implemento logica de inventario.

Docker:
- Sin cambios requeridos.
- No se reiniciaron contenedores ni se ejecuto Docker.

Verificaciones ejecutadas:
- `rg` confirmo que `Mantenimientos del sistema` queda solo en `frontend/components/layout/app-shell.tsx`.
- `git diff --name-only`

Verificaciones no ejecutadas o no completadas:
- No se ejecuto build ni pruebas en Docker porque no se pidio reiniciar/ejecutar contenedores.
