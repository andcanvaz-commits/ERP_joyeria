#!/bin/sh
# Firewall basico del VPS con ufw: solo SSH, HTTP y HTTPS quedan expuestos
# al exterior -- lo unico que Docker publica es nginx (80/443, ver el
# comentario al inicio de docker-compose.prod.yml). Correr UNA vez en el
# VPS, como root.
#
# Uso: sudo ./deploy/setup-firewall.sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "Corre esto como root (sudo ./deploy/setup-firewall.sh)." >&2
  exit 1
fi

if ! command -v ufw >/dev/null 2>&1; then
  apt-get update -y
  apt-get install -y ufw
fi

ufw default deny incoming
ufw default allow outgoing

# SSH explicito por numero de puerto (no depende de que el perfil "OpenSSH"
# de ufw este registrado): si cambiaste el puerto de sshd, ajusta esta linea
# ANTES de habilitar el firewall o te quedas afuera del servidor.
ufw allow 22/tcp comment 'SSH'
ufw allow 80/tcp comment 'HTTP (nginx, redirige a HTTPS)'
ufw allow 443/tcp comment 'HTTPS (nginx)'

ufw --force enable
ufw status verbose
