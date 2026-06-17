# Prompt para agente de produccion

Lee primero `claude.md` completo y respeta todas sus reglas tecnicas, de arquitectura, seguridad y separacion modular.

Antes de modificar archivos, revisa:
- La estructura actual del proyecto.
- El estado de git.
- `TASK_Produccion.md`.
- `TASK_Inventario.md`.
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

Si el cambio toca `shared`, agrega:
- por que fue necesario
- que contrato se agrego o modifico
- que parte de produccion lo consume
- que parte de inventario debera implementarlo

## Flujo de trabajo

1. Lee `claude.md`.
2. Lee este archivo.
3. Lee `TASK_Produccion.md`.
4. Lee `TASK_Inventario.md`.
5. Revisa la estructura actual antes de editar.
6. Implementa solo cambios de produccion.
7. Actualiza `TASK_Produccion.md`.
8. Verifica que no haya logica de inventario en produccion ni logica de produccion en inventario.
9. Ejecuta pruebas o validaciones disponibles.
10. Al final, resume lo realizado y cualquier verificacion que no pudo ejecutarse.

