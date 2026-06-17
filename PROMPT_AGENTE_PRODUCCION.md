# Prompt para agente de produccion

Lee primero `claude.md` completo y respeta todas sus reglas tecnicas, de arquitectura, seguridad y separacion modular.

Antes de modificar archivos, revisa:
- La estructura actual del proyecto.
- El estado de git.
- `TASK_Produccion.md`.
- `TASK_Inventario.md`.
- `SKILL.md` si vas a crear o modificar frontend.
- `backend/modules/shared/contracts/inventory.py`.

## Objetivo

Trabaja unicamente en el modulo de produccion. El modulo debe quedar preparado para integrarse luego con inventario mediante contratos, interfaces o servicios definidos en `shared`.

No implementes logica de inventario.

## Rutas permitidas

Puedes trabajar solo en:
- `backend/modules/production`
- `frontend/app/produccion`
- `frontend/components/production`
- `frontend/types/production`
- `backend/modules/auth` solo si es necesario para usuario autenticado.
- `backend/modules/security` solo si es necesario para permisos de produccion.
- `backend/modules/shared` solo si necesitas contratos, interfaces, puertos o DTOs compartidos.
- `frontend/components/shared` solo si necesitas UI compartida.
- `frontend/types/shared` solo si necesitas tipos compartidos.
- `frontend/components/ui`, `frontend/components/layout`, `frontend/hooks` y `frontend/lib` solo si necesitas piezas frontend compartidas alineadas con `SKILL.md`.
- `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `requirements.txt` y `README.md` solo si el cambio de produccion requiere ajustar Docker, dependencias, variables, puertos o comandos.
- `TASK_Produccion.md`

No edites estas rutas salvo autorizacion explicita del usuario:
- `backend/modules/inventory`
- `frontend/app/inventario`
- `frontend/components/inventory`
- `frontend/types/inventory`
- `TASK_Inventario.md`, excepto para leerlo.

## Reglas de frontera con inventario

- No sobrescribas archivos del modulo `inventory`.
- No coloques logica de produccion dentro de `inventory`.
- No coloques logica de inventario dentro de `production`.
- Produccion no debe actualizar stock directamente.
- Produccion no debe crear movimientos de inventario directamente.
- Si produccion necesita validar stock, reservar materiales o finalizar ingreso de producto terminado, debe hacerlo mediante contratos en `shared`.
- Antes de modificar `shared`, verifica que no rompa la futura implementacion de inventario.
- Si cambias `shared`, documenta el motivo en `TASK_Produccion.md`.

## Reglas del dominio de produccion

- No quemes nombres de procesos de joyeria en codigo.
- No quemes etapas de fabricacion en codigo.
- Todo proceso debe salir desde datos configurables.
- Toda etapa debe salir desde datos configurables.
- La orden de produccion no debe tener empleado responsable obligatorio.
- La orden de produccion debe asociarse al usuario autenticado que la crea e inicia.
- Al crear una orden, las etapas del proceso deben copiarse como snapshot historico de la orden.
- Los estados de orden base son: BORRADOR, PENDIENTE, EN_PROCESO, PAUSADA, FINALIZADA y CANCELADA.
- Usa Pydantic para validar entradas.
- Usa servicios para reglas de negocio.
- Usa repositorios o capa de acceso a datos para persistencia.
- No concatenes SQL con datos del usuario.
- Prepara endpoints sensibles para JWT y permisos.

## Contrato con inventario

Revisa antes de empezar:
- `backend/modules/shared/contracts/inventory.py`

Produccion debe consumir inventario mediante:
- `check_material_availability`: consultar disponibilidad sin mutar stock.
- `reserve_materials_for_production`: solicitar reserva de materiales si inventario implementa reservas.
- `commit_finished_production`: notificar finalizacion para que inventario registre movimientos historicos.

Produccion no debe implementar esos comportamientos dentro del modulo de inventario.

## Registro obligatorio

Despues de cada cambio relevante, actualiza `TASK_Produccion.md` con:
- que se hizo
- que falta
- que archivos se modificaron
- que puntos deben integrarse luego con inventario
- que cambios se hicieron o faltan en Docker si aplica
- que reglas de `SKILL.md` se aplicaron si hubo frontend

Si el cambio toca `shared`, agrega:
- por que fue necesario
- que contrato se agrego o modifico
- que parte de produccion lo consume
- que parte de inventario debera implementarlo

## Frontend y diseno global

Todo frontend de produccion debe usar `SKILL.md` como fuente comun de diseno y funcionalidad.

Antes de tocar frontend:
- Lee `SKILL.md` completo.
- Revisa si ya existe un componente compartido para layout, tablas, filtros, badges, estados vacios, carga, errores, dialogs, drawers o toasts.
- Usa `frontend/components/shared`, `frontend/components/ui` o `frontend/components/layout` para piezas reutilizables por produccion e inventario.
- Usa `frontend/components/production` solo para comportamiento especifico de produccion.
- Mantener nombres, estados visuales, densidad, formularios, tablas y acciones consistentes con inventario.
- No hardcodear procesos, etapas, materiales o categorias de joyeria en la UI; deben venir como datos.

Si creas un componente compartido, documenta en `TASK_Produccion.md`:
- por que es compartido
- que parte de produccion lo usa
- que parte de inventario deberia reutilizarlo luego

## Docker y ejecucion compartida

Produccion debe seguir siendo ejecutable por Docker para que otros compañeros puedan probar el modulo.

Actualiza Docker cuando el cambio lo requiera:
- Si agregas una dependencia Python, actualiza `requirements.txt`.
- Si agregas variables de entorno, actualiza `docker-compose.yml` y `README.md`.
- Si cambias comando de arranque, puerto o forma de iniciar la API, actualiza `Dockerfile`, `docker-compose.yml` y `README.md`.
- Si agregas archivos que no deben copiarse a la imagen, actualiza `.dockerignore`.
- Si no hace falta tocar Docker, deja constancia en `TASK_Produccion.md` como "Docker: sin cambios requeridos".

Verificaciones minimas:
- Ejecuta `docker-compose config` si modificaste Docker.
- Ejecuta `docker-compose up --build` si es razonable para la sesion; si no, documenta por que no se ejecuto.
- Registra en `TASK_Produccion.md` las verificaciones Docker ejecutadas y no ejecutadas.

## Flujo de trabajo

1. Lee `claude.md`.
2. Lee este archivo.
3. Lee `TASK_Produccion.md`.
4. Lee `TASK_Inventario.md`.
5. Lee `SKILL.md` si la sesion incluye frontend.
6. Revisa la estructura actual antes de editar.
7. Implementa solo cambios de produccion.
8. Actualiza `TASK_Produccion.md`.
9. Actualiza Docker si el cambio de produccion agrego dependencias, variables, puertos, servicios o comandos.
10. Verifica que no haya logica de inventario en produccion ni logica de produccion en inventario.
11. Ejecuta pruebas o validaciones disponibles, incluyendo `docker-compose config` si tocaste Docker.
12. Al final, resume lo realizado y cualquier verificacion que no pudo ejecutarse.
