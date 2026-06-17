# TASK Inventario

## Registro de cambios

### 2026-06-17 - Preparacion de instrucciones Docker

Que se hizo:
- Se actualizo `PROMPT_AGENTE_INVENTARIO.md` para que el agente de inventario mantenga Docker actualizado cuando agregue dependencias, variables, puertos, servicios o comandos.
- Se dejo explicito que inventario puede tocar `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `requirements.txt` y `README.md` solo cuando su cambio lo requiera.
- Se agrego la obligacion de registrar en este TASK si Docker cambio o si no requirio cambios.

Que falta:
- Cuando se implemente inventario, actualizar este TASK con los cambios reales del modulo.
- Si inventario agrega dependencias o servicios, actualizar Docker y ejecutar `docker-compose config`.

Archivos modificados:
- `PROMPT_AGENTE_INVENTARIO.md`
- `TASK_Inventario.md`

Puntos para integrar luego con produccion:
- Inventario debera implementar el contrato `InventoryIntegrationPort` definido en `backend/modules/shared/contracts/inventory.py`.
- Inventario debera mantener Docker compatible para que produccion pueda probar la integracion.

Docker:
- Sin cambios tecnicos requeridos para inventario en esta sesion; solo se actualizaron instrucciones.

Verificaciones ejecutadas:
- `git status -sb`
- `git diff --name-only`

Verificaciones no ejecutadas o no completadas:
- No se ejecuto `docker-compose config` por este cambio de inventario porque no se modificaron archivos Docker.
