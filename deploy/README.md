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
8. Renovacion automatica del certificado — agregar a `crontab -e`:
   ```
   0 3,15 * * * /ruta/al/repo/deploy/renew-tls.sh >> /var/log/erp-tls-renew.log 2>&1
   ```

Los backups de PostgreSQL ya corren solos (servicio `db-backup` del
compose, dump diario en `./backups/`, retencion configurable con
`BACKUP_RETENTION_DAYS` en `.env`).
