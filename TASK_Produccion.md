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
