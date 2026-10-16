#!/bin/sh
set -eu

if [ -z "${MYSQL_EXPORTER_PASSWORD:-}" ]; then
  echo "MYSQL_EXPORTER_PASSWORD must be set" >&2
  exit 1
fi

escaped_password=$(printf '%s' "$MYSQL_EXPORTER_PASSWORD" | sed "s/'/''/g")

mysql \
  --host="$MYSQL_HOST" \
  --port="$MYSQL_PORT" \
  --user=root \
  --password="$MYSQL_ROOT_PASSWORD" \
  --execute="CREATE USER IF NOT EXISTS 'exporter'@'%' IDENTIFIED BY '${escaped_password}'; ALTER USER 'exporter'@'%' IDENTIFIED BY '${escaped_password}'; GRANT PROCESS, REPLICATION CLIENT, SELECT ON *.* TO 'exporter'@'%';"