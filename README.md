# ERP_joyeria

## Desarrollo con Docker

Requisitos:
- Docker Desktop instalado y ejecutandose.

Levantar frontend, API y base de datos:

```powershell
docker-compose up --build
```

Abrir el frontend:

```text
http://localhost:3000
http://localhost:3000/login
http://localhost:3000/produccion
```

Cuentas locales sembradas por Docker:

```text
admin / Admin123!
```

Permisos:
- `admin`: accede a mantenimiento de produccion y crea procesos con etapas.

Abrir la documentacion interactiva de la API:

```text
http://localhost:8000/docs
```

Ver logs en tiempo real:

```powershell
docker-compose logs -f api
docker-compose logs -f web
```

Apagar los contenedores:

```powershell
docker-compose down
```

Los servicios `api` y `web` usan modo desarrollo con recarga automatica dentro de Docker.

Notas:
- En Docker se usa PostgreSQL 16.
- El frontend usa Next.js y se expone en el puerto 3000.
- `AUTO_CREATE_TABLES=true` crea tablas automaticamente solo para desarrollo local mientras no existan migraciones Alembic.
- El login usa JWT y usuarios locales sembrados en PostgreSQL para desarrollo.
- `DEV_AUTH_ENABLED=false` mantiene activo el flujo real de login.
- El mantenimiento de produccion solo crea procesos y etapas. La ejecucion operativa y la integracion con inventario se implementaran despues.
