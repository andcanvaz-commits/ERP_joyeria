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
http://localhost:3000/produccion
```

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
- La autenticacion JWT sigue pendiente; algunos endpoints protegidos aun dependen del placeholder de `get_current_user`.
- La finalizacion de produccion todavia espera integracion real del modulo de inventario.
