#!/bin/sh
set -eu

if [ -n "${RAILWAY_SERVICE_ID:-}" ] && [ "${RAILWAY_VOLUME_MOUNT_PATH:-}" != /data ]; then
  echo 'Вершина потребує постійного тому Railway з точкою монтування /data.' >&2
  exit 1
fi

if [ "$(id -u)" -eq 0 ]; then
  chown node:node /data
  chmod 0700 /data
  exec setpriv --reuid=node --regid=node --init-groups --no-new-privs "$@"
fi

exec "$@"
