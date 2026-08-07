# ERP_joyeria

Sistema ERP web para joyería: producción, inventario, merma, reportes y seguridad.
La arquitectura real y las reglas operativas están en `CLAUDE.md`.
La especificación funcional original está en `docs/ESPECIFICACION_FUNCIONAL.md`.

## Estructura del repositorio

```text
backend/            API FastAPI (modelos, servicios, endpoints, migraciones Alembic)
frontend/           Aplicación web Next.js
nginx/              Configuración de Nginx para producción
docs/               Documentación: especificaciones, planes y ejemplos
docs/agentes/       Prompts y tareas históricas usadas con agentes de IA
docker-compose.yml  Stack de desarrollo (API, web, PostgreSQL)
Dockerfile          Imagen de la API (el contexto de build es la raíz del repo)
requirements.txt    Dependencias Python de la API
alembic.ini         Configuración de migraciones
CLAUDE.md           Arquitectura real, comandos y reglas de dominio vigentes
```

## Desarrollo con Docker

Requisitos:
- Docker Desktop instalado y ejecutandose.

Configurar secretos (una vez):

```powershell
copy .env.example .env
```

Edita `.env` y define `POSTGRES_PASSWORD`, `JWT_SECRET_KEY` y `JWT_REFRESH_SECRET_KEY` con valores fuertes.
Genera secretos con:

```powershell
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

El archivo `.env` esta en `.gitignore` y no debe subirse al repo.

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

Cuenta admin sembrada en el primer arranque:

- Usuario: valor de `SEED_ADMIN_USERNAME` (por defecto `admin`).
- Contrasena: valor de `SEED_ADMIN_PASSWORD`. Si lo dejas vacio, la API genera
  una contrasena aleatoria y la imprime UNA sola vez en los logs al crear el usuario:

```powershell
docker-compose logs api | Select-String "contrasena generada"
```

Cambia esa contrasena tras el primer inicio de sesion. En arranques posteriores
la contrasena del admin no se sobrescribe.

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
