# TASK Produccion

## Registro de cambios

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
