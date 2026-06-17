# Prompt para agente de inventario

Lee primero `claude.md` completo y respeta todas sus reglas tecnicas, de arquitectura, seguridad y separacion modular.

Antes de modificar archivos, revisa:
- La estructura actual del proyecto.
- El estado de git.
- `TASK_Inventario.md`.
- `TASK_Produccion.md`.
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

Si el cambio toca `shared`, agrega:
- por que fue necesario
- que contrato se agrego o modifico
- que parte de inventario lo implementa
- que parte de produccion lo consumira

## Flujo de trabajo

1. Lee `claude.md`.
2. Lee este archivo.
3. Lee `TASK_Inventario.md`.
4. Lee `TASK_Produccion.md`.
5. Revisa la estructura actual antes de editar.
6. Implementa solo cambios de inventario.
7. Actualiza `TASK_Inventario.md`.
8. Verifica que no haya logica de produccion en inventario ni logica de inventario en produccion.
9. Ejecuta pruebas o validaciones disponibles.
10. Al final, resume lo realizado y cualquier verificacion que no pudo ejecutarse.

