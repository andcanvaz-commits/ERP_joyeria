# Operación en producción

Estado del despliegue y procedimientos operativos. Escrito para retomarlo en
frío, sin haber estado en la sesión donde se desplegó.

> **Este archivo es público.** No lleva contraseñas, secretos ni IPs. Todo eso
> vive en el `.env` del VPS, que está en `.gitignore` y nunca se sube.

## 1. Qué está desplegado

| | |
|---|---|
| Dominio | `fenixglobal.online` (Hostinger, DNS ya propagado) |
| VPS | Ubuntu con Docker + plugin de Compose |
| Repo en el VPS | `~/ERP_joyeria` (rama `main`) |
| Stack | `docker-compose.prod.yml` — db, api, web, nginx, db-backup |
| TLS | Let's Encrypt, renovación automática por cron |
| Respaldos | `db-backup` cada 24 h en `~/ERP_joyeria/backups/`, retención 30 días |

Lo único expuesto al exterior es nginx (80/443). Postgres y la API no publican
puertos: se hablan por la red interna de Docker. El firewall (`ufw`) solo deja
pasar 22, 80 y 443.

**La base se desplegó vacía a propósito**, con `SEED_ON_STARTUP=false`: solo
existe el admin y las unidades de medida. Los datos reales entran después con el
procedimiento de la sección 4.

## 2. Comandos del día a día

Todos desde `~/ERP_joyeria` en el VPS.

```bash
# Estado de los servicios
docker compose -f docker-compose.prod.yml ps

# Logs
docker compose -f docker-compose.prod.yml logs -f api
docker compose -f docker-compose.prod.yml logs --tail 50 nginx

# Desplegar cambios nuevos (tras un git push desde desarrollo)
git pull
docker compose -f docker-compose.prod.yml --env-file .env up -d --build

# Reiniciar solo la API
docker compose -f docker-compose.prod.yml --env-file .env up -d --force-recreate api

# Revisar disco
df -h
du -sh backups/
```

Las migraciones de Alembic se aplican solas: el contenedor `api` corre
`alembic upgrade head` antes de arrancar uvicorn.

## 3. Recuperar el acceso de admin

Si se pierde la contraseña del administrador:

```bash
cd ~/ERP_joyeria
sed -i 's|^SEED_ADMIN_PASSWORD=.*|SEED_ADMIN_PASSWORD=LA_NUEVA|' .env
sed -i 's|^SEED_ADMIN_RESET_ON_BOOT=.*|SEED_ADMIN_RESET_ON_BOOT=true|' .env
docker compose -f docker-compose.prod.yml --env-file .env up -d --force-recreate api

# probar el login, y DESPUÉS volver a apagarlo:
sed -i 's|^SEED_ADMIN_RESET_ON_BOOT=.*|SEED_ADMIN_RESET_ON_BOOT=false|' .env
docker compose -f docker-compose.prod.yml --env-file .env up -d --force-recreate api
```

**El segundo bloque no es opcional.** Con `SEED_ADMIN_RESET_ON_BOOT=true`, cada
reinicio del contenedor revierte la contraseña a la del `.env` y se pierde
cualquier cambio hecho desde la app.

La contraseña debe tener al menos 8 caracteres, con una letra y un número
(`validate_password_strength` en `backend/modules/auth/service.py`).

## 4. Subir la base de datos de desarrollo a producción

El caso: el ERP se desplegó vacío y los datos reales están en otra computadora.

### 4.1 Antes de nada: igualar la revisión de Alembic

**Este es el paso que puede arruinar la carga.** Si las dos bases están en
migraciones distintas, el dump traerá columnas que del otro lado no existen (o
al revés) y el restore falla a medias, que es peor que fallar del todo.

```bash
# En la máquina de origen
docker compose exec api alembic current

# En el VPS
cd ~/ERP_joyeria
docker compose -f docker-compose.prod.yml exec api alembic current
```

Las dos deben imprimir la **misma revisión**. Si no coinciden, actualiza el lado
atrasado (`git pull` y recrear el contenedor) y vuelve a comparar.

### 4.2 Generar el dump en la máquina de origen

```bash
docker exec erp_joyeria-db-1 pg_dump -U erp_joyeria -d erp_joyeria \
  -F c --exclude-table=alembic_version -f /tmp/erp.dump

docker cp erp_joyeria-db-1:/tmp/erp.dump ./erp.dump
```

`--exclude-table=alembic_version` importa: si esa tabla viaja, pisa la revisión
del VPS y Alembic pierde la noción de en qué migración está.

### 4.3 Subirlo al VPS

```bash
scp erp.dump usuario@fenixglobal.online:/tmp/
```

### 4.4 Respaldar producción antes de tocarla

```bash
cd ~/ERP_joyeria
docker compose -f docker-compose.prod.yml exec db \
  pg_dump -U erp_joyeria -d erp_joyeria -F c -f /tmp/pre_restore.dump
docker compose -f docker-compose.prod.yml cp db:/tmp/pre_restore.dump ./backups/
```

Si algo sale mal, este archivo es la vuelta atrás.

### 4.5 Restaurar

```bash
docker compose -f docker-compose.prod.yml cp /tmp/erp.dump db:/tmp/
docker compose -f docker-compose.prod.yml exec db \
  pg_restore -U erp_joyeria -d erp_joyeria --data-only --disable-triggers /tmp/erp.dump
```

- `--data-only`: no recrea tablas, solo inserta filas. El esquema ya existe
  porque Alembic lo creó al desplegar.
- `--disable-triggers`: evita que las llaves foráneas se quejen por el orden de
  inserción.

### 4.6 Conflicto esperado con los usuarios

El VPS ya tiene un `admin` creado por la siembra, y el dump trae los usuarios de
la otra base. `pg_restore` intentará insertarlos y chocará por el `username`
único.

No es grave y la salida lo dice fila por fila. Dos salidas:

- **Conservar los usuarios del dump**: vaciar `auth_users` en el VPS antes de
  restaurar (`TRUNCATE auth_users CASCADE`) y usar las credenciales de la otra
  base.
- **Conservar el admin del VPS**: excluir la tabla del dump con
  `--exclude-table=auth_users` en el `pg_dump` del paso 4.2.

### 4.7 Verificar

```bash
docker compose -f docker-compose.prod.yml exec db psql -U erp_joyeria -d erp_joyeria \
  -c "select 'items' t, count(*) from inventory_items
      union all select 'movimientos', count(*) from inventory_movements
      union all select 'ordenes', count(*) from production_runs
      union all select 'procesos', count(*) from production_processes;"
```

Compara los conteos con los de la base de origen. Después entra a la app y
revisa que el inventario y las órdenes se vean bien.

## 5. Cosas que ya mordieron

Documentadas para no repetirlas.

**Los scripts de `deploy/` sin bit de ejecución.** Estaban en git como `100644`
y `sudo ./deploy/script.sh` fallaba con `command not found` — así reporta sudo un
archivo no ejecutable, no con "permission denied". Arreglado en el commit
`7b64075`. Si vuelve a aparecer: `chmod +x deploy/*.sh`.

**Contraseña de Postgres con símbolos.** `POSTGRES_PASSWORD` se interpola dentro
de `DATABASE_URL`; un `/`, `+`, `@` o `:` parte la URL y la API no conecta.
Generarla solo alfanumérica: `openssl rand -hex 24`.

**El `.env` tiene que existir antes de `init-tls.sh`.** El script llama a
`docker compose`, que resuelve las variables del compose de producción. Sin
`.env`, falla con errores de interpolación antes de contactar a Let's Encrypt
(no gasta intentos del límite de 5/hora).

**La API se reinicia en bucle = el `.env` está mal.** Es a propósito:
`Settings._enforce_production_hardening` rompe el arranque si los secretos JWT
son débiles o iguales entre sí, si falta `CORS_ORIGINS`, `ALLOWED_HOSTS` o
`SEED_ADMIN_PASSWORD`, o si `ENABLE_DOCS=true`. El log dice cuál es. **No se
esquiva poniendo `APP_ENV=development`**: eso apaga la validación y deja el
sistema abierto.

**El puerto 80 debe estar libre para `init-tls.sh`.** Certbot levanta su propio
servidor ahí (`--standalone`) porque nginx todavía no existe. Verificar con
`sudo ss -lntp | grep :80`.

**Desarrollo en Windows: el dev server no ve los cambios.** El bind mount no
propaga eventos de filesystem al contenedor y el watcher de Turbopack no los ve;
`next dev` sigue sirviendo los chunks viejos. Tras tocar frontend:
`docker-compose restart web`. Está documentado en `docker-compose.yml`.

**502 tras un deploy: nginx quedó con la IP vieja de `web`/`api`.** nginx
resuelve el nombre del servicio a una IP de Docker una sola vez, al arrancar.
Si `web` o `api` se recrean (`up -d --build`) sin recrear `nginx`, esos
contenedores obtienen una IP interna nueva y nginx sigue apuntando a la
vieja — `connect() failed (111: Connection refused) while connecting to
upstream` en sus logs. Pasa porque el deploy normal del punto 2 no toca
nginx. Arreglo:

```bash
docker compose -f docker-compose.prod.yml restart nginx
```

## 6. Mantenimiento programado

En el `crontab` del VPS:

```
0 3,15 * * * /root/ERP_joyeria/deploy/renew-tls.sh >> /var/log/erp-tls-renew.log 2>&1
0 4 1 * * /root/ERP_joyeria/deploy/prune-docker.sh >> /var/log/erp-docker-prune.log 2>&1
```

- **Renovación TLS**: dos veces al día. `certbot renew` no hace nada hasta que
  faltan menos de 30 días para el vencimiento; correrlo seguido es seguro. Los
  certificados de Let's Encrypt duran 90 días.
- **Limpieza de Docker**: mensual, borra imágenes y caché de builds viejos. No
  toca volúmenes ni imágenes en uso.

Probar la renovación a mano en cualquier momento:

```bash
sudo /root/ERP_joyeria/deploy/renew-tls.sh
```

Si imprime `Certificado sin cambios (todavia no toca renovar)`, la cadena
completa funciona.

Ver cuándo vence el certificado, desde cualquier máquina:

```bash
echo | openssl s_client -servername fenixglobal.online -connect fenixglobal.online:443 2>/dev/null \
  | openssl x509 -noout -dates
```
