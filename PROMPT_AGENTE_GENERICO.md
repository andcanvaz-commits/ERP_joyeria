# Prompt generico para agentes de desarrollo

Lee primero `claude.md` completo y respeta todas sus reglas tecnicas, de arquitectura, seguridad y separacion modular.

Antes de modificar archivos, revisa la estructura actual del proyecto, el estado de git y los archivos `TASK_*.md` existentes para entender el trabajo previo y los puntos de integracion pendientes.

## Contexto

Este ERP debe desarrollarse de forma modular. Cada agente debe trabajar solo en el modulo asignado y evitar mezclar responsabilidades con otros modulos.

Modulos principales:
- `auth`
- `users`
- `security`
- `production`
- `inventory`
- `documents`
- `reports`
- `dashboard`
- `shared`
- `database`
- `config`

## Modulo asignado

El modulo asignado debe salir del mensaje actual del usuario. Si el usuario dice "trabaja en inventario", "modulo de produccion", "continua reportes" o una frase equivalente, ese sera el modulo activo de la sesion.

Si el usuario no indica un modulo de forma clara, no implementes cambios de codigo todavia. Primero revisa contexto y pregunta cual modulo debe trabajarse.

Nombres validos de modulo:
- `auth`
- `users`
- `security`
- `production`
- `inventory`
- `documents`
- `reports`
- `dashboard`
- `shared`
- `database`
- `config`

Equivalencias aceptadas:
- "produccion" = `production`
- "inventario" = `inventory`
- "usuarios" = `users`
- "seguridad" = `security`
- "documentos" = `documents`
- "reportes" = `reports`
- "tablero" o "panel" = `dashboard`
- "base de datos" = `database`
- "configuracion" = `config`
- "autenticacion" o "login" = `auth`

## Rutas de trabajo por modulo

Usa estas rutas sin modificar este archivo:

| Modulo | Backend | Frontend | TASK |
| --- | --- | --- | --- |
| `auth` | `backend/modules/auth` | `frontend/app/login` | `TASK_Auth.md` |
| `users` | `backend/modules/users` | `frontend/app/usuarios` | `TASK_Usuarios.md` |
| `security` | `backend/modules/security` | `frontend/app/seguridad` | `TASK_Seguridad.md` |
| `production` | `backend/modules/production` | `frontend/app/produccion`, `frontend/components/production`, `frontend/types/production` | `TASK_Produccion.md` |
| `inventory` | `backend/modules/inventory` | `frontend/app/inventario`, `frontend/components/inventory`, `frontend/types/inventory` | `TASK_Inventario.md` |
| `documents` | `backend/modules/documents` | `frontend/app/documentos` | `TASK_Documentos.md` |
| `reports` | `backend/modules/reports` | `frontend/app/reportes` | `TASK_Reportes.md` |
| `dashboard` | `backend/modules/dashboard` | `frontend/app/dashboard` | `TASK_Dashboard.md` |
| `database` | `backend/modules/database` | no aplica | `TASK_Database.md` |
| `config` | `backend/modules/config` | no aplica | `TASK_Config.md` |
| `shared` | `backend/modules/shared`, `frontend/components/shared`, `frontend/types/shared` | `frontend/components/shared`, `frontend/types/shared` | `TASK_Shared.md` |

Si el archivo TASK del modulo activo no existe, crealo antes de implementar cambios con este formato base:

```md
# TASK del modulo activo

## Registro de cambios
```

Archivos o carpetas permitidos:
- Las rutas del modulo activo segun la tabla anterior.
- `shared` solo si necesitas contratos, interfaces o tipos compartidos.
- `documents` solo si aplica directamente al modulo asignado.
- `security` o `auth` solo si el modulo requiere permisos o dependencias de autenticacion.
- El archivo TASK del modulo activo.

No trabajes en otros modulos salvo que el usuario lo autorice explicitamente.

## Reglas de aislamiento

- No sobrescribas archivos de otros modulos.
- No coloques logica del modulo asignado dentro de otro modulo.
- No coloques logica de otros modulos dentro del modulo asignado.
- Si necesitas integrarte con otro modulo, usa contratos, interfaces, puertos o DTOs en `shared`.
- Antes de modificar `shared`, verifica que el cambio no rompa contratos existentes ni bloquee la integracion futura.
- No implementes logica de otro modulo aunque parezca necesaria; deja el punto de integracion documentado.

## Reglas del dominio

- No quemes procesos de joyeria en codigo.
- No quemes etapas de fabricacion en codigo.
- Todo proceso y etapa debe venir desde datos configurables.
- Produccion no debe exigir empleado responsable obligatorio; se asocia al usuario autenticado.
- Inventario debe modificar stock mediante movimientos historicos, nunca con actualizaciones directas sin trazabilidad.
- Todo endpoint sensible debe prepararse para validar JWT y permisos.
- Usa validaciones con Pydantic y acceso a datos mediante servicios/repositorios.
- No concatenes SQL con datos del usuario.

## Registro de trabajo

Despues de cada cambio relevante, actualiza el archivo TASK del modulo activo con:
- que se hizo
- que falta
- que archivos se modificaron
- que puntos deben integrarse luego con otros modulos

Si el cambio toca `shared`, documenta:
- por que fue necesario
- que contrato se agrego o modifico
- que modulo lo consume
- que modulo debera implementarlo despues

## Flujo de trabajo esperado

1. Lee `claude.md`.
2. Identifica el modulo activo desde el mensaje del usuario.
3. Lee el archivo TASK del modulo activo.
4. Lee los `TASK_*.md` de modulos con los que debas integrarte.
5. Revisa la estructura actual antes de editar.
6. Define o confirma los limites del modulo.
7. Implementa cambios pequenos y coherentes.
8. Actualiza el archivo TASK del modulo activo.
9. Verifica que no haya logica cruzada entre modulos.
10. Ejecuta pruebas o validaciones disponibles.
11. Al final, resume solo lo realizado y cualquier verificacion que no pudo ejecutarse.

## Reglas especificas para produccion e inventario

Cuando el modulo activo sea `production`:
- Lee `TASK_Inventario.md` si existe.
- No edites `backend/modules/inventory`, `frontend/app/inventario`, `frontend/components/inventory` ni `frontend/types/inventory`.
- Toda comunicacion con inventario debe pasar por contratos en `shared`.

Cuando el modulo activo sea `inventory`:
- Lee `TASK_Produccion.md` si existe.
- No edites `backend/modules/production`, `frontend/app/produccion`, `frontend/components/production` ni `frontend/types/production`.
- Revisa `backend/modules/shared/contracts/inventory.py` antes de crear o cambiar integraciones con produccion.
- Toda actualizacion de stock debe prepararse para movimientos historicos; no implementes cambios directos de stock sin trazabilidad.

## Prompt corto para iniciar sesion

Lee `claude.md` y `PROMPT_AGENTE_GENERICO.md`. Identifica el modulo activo desde mi solicitud de esta sesion. Trabaja solo en las rutas permitidas para ese modulo. Revisa su archivo `TASK_*.md` y los `TASK_*.md` relacionados antes de editar. No mezcles logica entre modulos; usa `shared` unicamente para contratos o interfaces de integracion. Actualiza el TASK del modulo activo despues de cada cambio relevante.
