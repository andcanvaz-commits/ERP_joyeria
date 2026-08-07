#!/bin/sh
# Renovacion del certificado TLS. Pensado para correr por cron (nginx ya
# esta arriba en este punto, asi que certbot valida el dominio via webroot
# -- escribe el archivo de reto en el volumen compartido que nginx sirve en
# /.well-known/acme-challenge/, sin pisar el puerto 80). certbot renew no
# hace nada si el cert todavia no esta por vencer, asi que correr esto
# seguido (2 veces al dia) es seguro.
#
# Instalacion en el VPS (una vez), como el usuario que tiene el repo:
#   crontab -e
#   0 3,15 * * * /ruta/al/repo/deploy/renew-tls.sh >> /var/log/erp-tls-renew.log 2>&1
set -eu

cd "$(dirname "$0")/.."

DOMAIN=$(grep -m1 '^DOMAIN=' .env | cut -d= -f2-)
if [ -z "$DOMAIN" ]; then
  echo "DOMAIN vacio en .env, no se puede renovar." >&2
  exit 1
fi

BEFORE=$(md5sum ./nginx/certs/fullchain.pem 2>/dev/null | cut -d' ' -f1 || echo "")

docker compose -f docker-compose.prod.yml run --rm certbot \
  renew --webroot -w /var/www/certbot --quiet

docker compose -f docker-compose.prod.yml run --rm --entrypoint sh certbot -c \
  "cp /etc/letsencrypt/live/$DOMAIN/fullchain.pem /nginx-certs/fullchain.pem && \
   cp /etc/letsencrypt/live/$DOMAIN/privkey.pem /nginx-certs/privkey.pem"

AFTER=$(md5sum ./nginx/certs/fullchain.pem 2>/dev/null | cut -d' ' -f1 || echo "")

if [ "$BEFORE" != "$AFTER" ]; then
  echo "Certificado renovado, recargando nginx."
  docker compose -f docker-compose.prod.yml exec nginx nginx -s reload
else
  echo "Certificado sin cambios (todavia no toca renovar)."
fi
