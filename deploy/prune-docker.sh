#!/bin/sh
# Limpieza de sobras de Docker: capas de imagenes viejas de cada rebuild,
# containers parados, redes sin usar, cache de build. NO toca volumenes
# (los datos de postgres/backups/certs quedan intactos) ni imagenes en uso.
#
# Instalacion en el VPS (una vez), como el usuario que tiene el repo:
#   crontab -e
#   0 4 1 * * /ruta/al/repo/deploy/prune-docker.sh >> /var/log/erp-docker-prune.log 2>&1
set -eu

docker system prune -f
