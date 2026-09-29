#!/usr/bin/env bash
set -euo pipefail

cd /opt/the-bathany
source .env
db_id=$(docker compose --env-file .env -f deploy.hostinger.yaml ps -q db)
if [[ -z "$db_id" ]]; then
  echo "SQL Server is not running; backup failed" >&2
  exit 1
fi

stamp=$(date -u +%Y%m%dT%H%M%SZ)
file="Eshopper-$stamp.bak"
mkdir -p /opt/the-bathany-backups
chmod 700 /opt/the-bathany-backups
docker exec -u 0 "$db_id" mkdir -p /var/opt/mssql/backups
docker exec -u 0 "$db_id" chown mssql:mssql /var/opt/mssql/backups
docker exec "$db_id" /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "$SQL_SA_PASSWORD" -C -b -Q "
BACKUP DATABASE Eshopper TO DISK = N'/var/opt/mssql/backups/$file' WITH CHECKSUM, INIT;
RESTORE VERIFYONLY FROM DISK = N'/var/opt/mssql/backups/$file' WITH CHECKSUM;"
docker cp "$db_id:/var/opt/mssql/backups/$file" "/opt/the-bathany-backups/$file"
chmod 600 "/opt/the-bathany-backups/$file"
docker exec "$db_id" rm "/var/opt/mssql/backups/$file"
find /opt/the-bathany-backups -maxdepth 1 -type f -name 'Eshopper-*.bak' -mtime +7 -delete
echo "Database backup verified: $file"
