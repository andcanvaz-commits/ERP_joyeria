#!/bin/sh
# Primera emision del certificado TLS (Let's Encrypt). Correr UNA vez, ANTES
# de "docker compose -f docker-compose.prod.yml up": nginx todavia no puede
# arrancar porque no hay certs con los que arrancar, asi que certbot usa su
# propio servidor temporal (--standalone) en el puerto 80 -- el puerto 80
# debe estar libre (nada mas escuchando) al correr esto.
#
# Uso, desde la raiz del repo en el VPS:
#   ./deploy/init-tls.sh tudominio.com tu-email@ejemplo.com
set -eu

DOMAIN="${1:?uso: init-tls.sh <dominio> <email>}"
EMAIL="${2:?uso: init-tls.sh <dominio> <email>}"

cd "$(dirname "$0")/.."

docker compose -f docker-compose.prod.yml run --rm -p 80:80 certbot \
  certonly --standalone \
  --non-interactive --agree-tos --no-eff-email \
  --email "$EMAIL" \
  -d "$DOMAIN"

docker compose -f docker-compose.prod.yml run --rm --entrypoint sh certbot -c \
  "cp /etc/letsencrypt/live/$DOMAIN/fullchain.pem /nginx-certs/fullchain.pem && \
   cp /etc/letsencrypt/live/$DOMAIN/privkey.pem /nginx-certs/privkey.pem && \
   cp /etc/letsencrypt/live/$DOMAIN/chain.pem /nginx-certs/chain.pem"

echo ""
echo "Certificado listo en ./nginx/certs/."
echo "Ahora: docker compose -f docker-compose.prod.yml --env-file .env up -d --build"
echo "Y despues, para renovacion automatica: crontab -e y agregar la linea de deploy/renew-tls.sh (ver ese archivo)."
