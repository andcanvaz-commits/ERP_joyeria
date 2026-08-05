# Deploy a produccion

Orden exacto para el primer despliegue en un VPS Ubuntu limpio, con el
dominio ya apuntando por DNS al servidor.

1. Instalar Docker + el plugin de Compose en el VPS.
2. Clonar el repo, `cd` a la raiz.
3. `cp .env.example .env` y completar con secretos reales (ver comentarios
   de cada variable en `.env.example`; `APP_ENV=production`).
4. `sudo ./deploy/setup-firewall.sh` — abre solo 22/80/443.
5. `./deploy/init-tls.sh tudominio.com tu-email@ejemplo.com` — emite el
   certificado TLS (el puerto 80 debe estar libre en este paso, nginx
   todavia no arranco).
6. `docker compose -f docker-compose.prod.yml --env-file .env up -d --build`
7. Verificar `https://tudominio.com` carga y el login funciona.
8. Renovacion automatica del certificado y limpieza mensual de Docker —
   agregar a `crontab -e`:
   ```
   0 3,15 * * * /ruta/al/repo/deploy/renew-tls.sh >> /var/log/erp-tls-renew.log 2>&1
   0 4 1 * * /ruta/al/repo/deploy/prune-docker.sh >> /var/log/erp-docker-prune.log 2>&1
   ```

## Uso de disco a largo plazo

- **Backups**: se auto-podan solos (`db-backup`, `BACKUP_RETENTION_DAYS` en `.env`).
- **Logs de containers**: acotados por servicio (10MB x 3 archivos, `x-logging`
  en `docker-compose.prod.yml`) — sin esto Docker no rota logs por defecto.
- **Imagenes/cache de rebuilds**: `deploy/prune-docker.sh` por cron mensual
  (no toca volumenes ni imagenes en uso).
- **Base de datos**: crecimiento lento y normal para este tipo de datos: si
  se importan muchas facturas XML, revisar el tamano de la tabla
  `inventory_movements` (guarda el archivo XML original en la fila) de vez
  en cuando con `du -sh` sobre el volumen `postgres_data` o una consulta de
  tamano de tabla en Postgres.
- No hay alerta automatica de disco lleno todavia — revisar `df -h` en el
  VPS de vez en cuando, o agregar monitoreo cuando el sistema ya este en
  uso real (mejor calibrar umbrales con datos reales que adivinar ahora).
