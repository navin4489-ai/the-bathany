#!/usr/bin/env bash
set -euo pipefail

cd /opt/the-bathany
set -a
# This file exists only on the VPS, with permissions 600; never commit it.
source .env
set +a

compose=(docker compose --env-file .env -f deploy.hostinger.yaml)
"${compose[@]}" up -d db
db_id=$("${compose[@]}" ps -q db)
if [[ -z "$db_id" ]]; then
  echo "SQL Server container did not start" >&2
  exit 1
fi

for attempt in {1..30}; do
  if docker exec "$db_id" /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "$SQL_SA_PASSWORD" -C -b -Q 'SELECT 1' -o /dev/null 2>/dev/null; then
    break
  fi
  if [[ $attempt == 30 ]]; then
    echo "SQL Server did not become ready" >&2
    exit 1
  fi
  sleep 5
done

if docker exec "$db_id" /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "$SQL_SA_PASSWORD" -C -h -1 -W -Q "SET NOCOUNT ON; SELECT CASE WHEN DB_ID('Eshopper') IS NULL THEN 1 ELSE 0 END" | grep -qx 1; then
  docker exec -i "$db_id" /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "$SQL_SA_PASSWORD" -C -b < apps/database/schema.sql
  docker exec -i "$db_id" /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "$SQL_SA_PASSWORD" -C -b < apps/database/seed.sql
fi

# App password is generated as hex on the VPS, so SQLCMD variable substitution is safe.
docker exec "$db_id" /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "$SQL_SA_PASSWORD" -C -b -v "AppPassword=$SQL_APP_PASSWORD" -Q "
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = 'bathany_app')
  CREATE LOGIN bathany_app WITH PASSWORD = N'\$(AppPassword)';
USE Eshopper;
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'bathany_app')
BEGIN
  CREATE USER bathany_app FOR LOGIN bathany_app;
  ALTER ROLE db_datareader ADD MEMBER bathany_app;
  ALTER ROLE db_datawriter ADD MEMBER bathany_app;
END"

"${compose[@]}" up -d --build app
