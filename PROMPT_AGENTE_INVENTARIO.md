# Prompt para agente de inventario

Lee primero `claude.md` completo y respeta todas sus reglas tecnicas, de arquitectura, seguridad y separacion modular.

Antes de modificar archivos, revisa:
- La estructura actual del proyecto.
- El estado de git.
- `TASK_Inventario.md`.
- `TASK_Produccion.md`.
- `SKILL.md` si vas a crear o modificar frontend.
- `backend/modules/shared/contracts/inventory.py`.

## Objetivo

Trabaja unicamente en el modulo de inventario. El modulo debe quedar preparado para integrarse luego con produccion mediante contratos, interfaces o servicios definidos en `shared`.

No implementes logica de produccion.

## Rutas permitidas

Puedes trabajar solo en:
- `backend/modules/inventory`
- `frontend/app/inventario`
- `frontend/components/inventory`
- `frontend/types/inventory`
- `backend/modules/documents` solo si aplica directamente a documentos de inventario.
- `backend/modules/shared` solo si necesitas contratos, interfaces, puertos o DTOs compartidos.
- `frontend/components/shared` solo si necesitas UI compartida.
- `frontend/types/shared` solo si necesitas tipos compartidos.
- `frontend/components/ui`, `frontend/components/layout`, `frontend/hooks` y `frontend/lib` solo si necesitas piezas frontend compartidas alineadas con `SKILL.md`.
- `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `requirements.txt` y `README.md` solo si el cambio de inventario requiere ajustar Docker, dependencias, variables, puertos o comandos.
- `TASK_Inventario.md`

No edites estas rutas salvo autorizacion explicita del usuario:
- `backend/modules/production`
- `frontend/app/produccion`
- `frontend/components/production`
- `frontend/types/production`
- `TASK_Produccion.md`, excepto para leerlo.

## Reglas de frontera con produccion

- No sobrescribas archivos del modulo `production`.
- No coloques logica de inventario dentro de `production`.
- No coloques logica de produccion dentro de `inventory`.
- Si inventario necesita datos de produccion, usa contratos en `shared`.
- Antes de modificar `shared`, verifica que no rompa el contrato existente con produccion.
- Si cambias `shared`, documenta el motivo en `TASK_Inventario.md`.

## Reglas del dominio de inventario

- Todo cambio de stock debe realizarse mediante movimientos historicos.
- No actualices stock directamente sin registrar movimiento.
- Los movimientos minimos a considerar son: entrada, salida, ajuste positivo, ajuste negativo, consumo de produccion, ingreso de produccion y merma.
- El inventario debe separar materia prima, productos en proceso y productos terminados.
- El inventario debe poder responder a produccion si hay stock suficiente sin mutar stock.
- El inventario debe ser quien implemente los movimientos reales cuando produccion finalice una orden.
- No quemes procesos ni etapas de joyeria en inventario.
- Usa Pydantic para validar entradas.
- Usa servicios para reglas de negocio.
- Usa repositorios o capa de acceso a datos para persistencia.
- No concatenes SQL con datos del usuario.
- Prepara endpoints sensibles para JWT y permisos.

## Contrato con produccion

Revisa antes de empezar:
- `backend/modules/shared/contracts/inventory.py`

Produccion espera integrarse mediante:
- `check_material_availability`: consultar disponibilidad sin mutar stock.
- `reserve_materials_for_production`: reservar materiales si inventario implementa reservas.
- `commit_finished_production`: registrar movimientos historicos cuando una orden termine.

Inventario debe implementar esos comportamientos desde su propio modulo, sin mover logica a produccion.

## Registro obligatorio

Despues de cada cambio relevante, actualiza `TASK_Inventario.md` con:
- que se hizo
- que falta
- que archivos se modificaron
- que puntos deben integrarse luego con produccion
- que cambios se hicieron o faltan en Docker si aplica
- que reglas de `SKILL.md` se aplicaron si hubo frontend

Si el cambio toca `shared`, agrega:
- por que fue necesario
- que contrato se agrego o modifico
- que parte de inventario lo implementa
- que parte de produccion lo consumira

## Frontend y diseno global

Todo frontend de inventario debe usar `SKILL.md` como fuente comun de diseno y funcionalidad.

Antes de tocar frontend:
- Lee `SKILL.md` completo.
- Revisa si ya existe un componente compartido para layout, tablas, filtros, badges, estados vacios, carga, errores, dialogs, drawers o toasts.
- Usa `frontend/components/shared`, `frontend/components/ui` o `frontend/components/layout` para piezas reutilizables por inventario y produccion.
- Usa `frontend/components/inventory` solo para comportamiento especifico de inventario.
- Mantener nombres, estados visuales, densidad, formularios, tablas y acciones consistentes con produccion.
- No hardcodear procesos, etapas, materiales o categorias de joyeria en la UI; deben venir como datos.

Si creas un componente compartido, documenta en `TASK_Inventario.md`:
- por que es compartido
- que parte de inventario lo usa
- que parte de produccion deberia reutilizarlo luego

## Docker y ejecucion compartida

Inventario debe mantener el proyecto ejecutable por Docker para que produccion y otros compañeros puedan probar integraciones.

Actualiza Docker cuando el cambio lo requiera:
- Si agregas una dependencia Python, actualiza `requirements.txt`.
- Si agregas variables de entorno, actualiza `docker-compose.yml` y `README.md`.
- Si agregas servicios de infraestructura para inventario, agregalos a `docker-compose.yml` sin romper `api` ni `db`.
- Si cambias comando de arranque, puerto o forma de iniciar la API, actualiza `Dockerfile`, `docker-compose.yml` y `README.md`.
- Si agregas archivos que no deben copiarse a la imagen, actualiza `.dockerignore`.
- Si no hace falta tocar Docker, deja constancia en `TASK_Inventario.md` como "Docker: sin cambios requeridos".

Verificaciones minimas:
- Ejecuta `docker-compose config` si modificaste Docker.
- Ejecuta `docker-compose up --build` si es razonable para la sesion; si no, documenta por que no se ejecuto.
- Registra en `TASK_Inventario.md` las verificaciones Docker ejecutadas y no ejecutadas.

## Flujo de trabajo

1. Lee `claude.md`.
2. Lee este archivo.
3. Lee `TASK_Inventario.md`.
4. Lee `TASK_Produccion.md`.
5. Lee `SKILL.md` si la sesion incluye frontend.
6. Revisa la estructura actual antes de editar.
7. Implementa solo cambios de inventario.
8. Actualiza `TASK_Inventario.md`.
9. Actualiza Docker si el cambio de inventario agrego dependencias, variables, puertos, servicios o comandos.
10. Verifica que no haya logica de produccion en inventario ni logica de inventario en produccion.
11. Ejecuta pruebas o validaciones disponibles, incluyendo `docker-compose config` si tocaste Docker.
12. Al final, resume lo realizado y cualquier verificacion que no pudo ejecutarse.
