# ERP_joyeria

## Desarrollo con Docker

Requisitos:
- Docker Desktop instalado y ejecutandose.

Levantar API y base de datos:

```powershell
docker-compose up --build
```

Abrir la documentacion interactiva:

```text
http://localhost:8000/docs
```

Ver logs en tiempo real:

```powershell
docker-compose logs -f api
```

Apagar los contenedores:

```powershell
docker-compose down
```

El servicio `api` usa `--reload`, asi que los cambios en archivos Python se recargan automaticamente dentro del contenedor.

Notas:
- En Docker se usa PostgreSQL 16.
- `AUTO_CREATE_TABLES=true` crea tablas automaticamente solo para desarrollo local mientras no existan migraciones Alembic.
- La autenticacion JWT sigue pendiente; algunos endpoints protegidos aun dependen del placeholder de `get_current_user`.
- La finalizacion de produccion todavia espera integracion real del modulo de inventario.
