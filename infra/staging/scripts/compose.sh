#!/usr/bin/env bash
# `docker compose` for this server's ForgeFlow, with its project, settings and deployed version:
#   forgeflow-compose ps
#   forgeflow-compose logs -f --since 1h api
#   forgeflow-compose exec postgres psql -U forgeflow
# (bootstrap.sh links it as /usr/local/bin/forgeflow-compose.)
set -euo pipefail

root=${FORGEFLOW_ROOT:-/opt/forgeflow}
staging_dir=$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)

# deploy.sh sets the version it deploys; otherwise use the one running now.
if [[ -z ${FORGEFLOW_VERSION:-} && -f $root/deployed-version ]]; then
  FORGEFLOW_VERSION=$(<"$root/deployed-version")
fi
export FORGEFLOW_VERSION=${FORGEFLOW_VERSION:-none}

exec docker compose --project-name "${FORGEFLOW_PROJECT:-forgeflow}" \
  --env-file "$root/.env" -f "$staging_dir/compose.yml" "$@"
