#!/usr/bin/env bash
# Deploys one version of ForgeFlow on this server: pulls its images, lets the api's database role
# log in, applies migrations, then replaces the running containers (every service of compose.yml
# outside the "jobs" profile: api, worker, web, Caddy…). It stops at the first failure, so a
# failed migration leaves the previous version serving.
#
# Usage: deploy.sh <commit-sha>
# CI runs it through forgeflow-deploy.sh, which checks the repository out at that commit first.
# Run it by hand (as deploy, from that checkout) to retry a deploy.
set -euo pipefail

export FORGEFLOW_VERSION=${1:?usage: deploy.sh <commit-sha>}
root=${FORGEFLOW_ROOT:-/opt/forgeflow}
scripts=$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")
# Work from a directory deploy can read: run by hand through runuser from root's home, the
# working directory stays /root, and docker compose fails with "stat .: permission denied".
cd "$root"

compose() { bash "$scripts/compose.sh" "$@"; }
step() { printf '==> %s\n' "$*"; }

step "Pulling the images of $FORGEFLOW_VERSION"
# A commit's images never change: pulled only when missing, so deploying again (after editing
# .env) needs no registry login. PostgreSQL and Caddy follow their tags, for their fixes.
compose pull --quiet --policy missing api web
compose pull --quiet postgres caddy

step 'Starting PostgreSQL'
compose up --detach --wait postgres

step "Letting the api's database role log in"
compose run --rm app-role

step 'Applying migrations'
compose run --rm migrate

step "Switching to $FORGEFLOW_VERSION"
compose up --detach --wait --wait-timeout 180 --remove-orphans
printf '%s\n' "$FORGEFLOW_VERSION" > "$root/deployed-version"

# ForgeFlow images of earlier versions stay a week, for a quick rollback; after that a rollback
# pulls them again from the registry.
for app in api web; do
  docker image prune --all --force --filter 'until=168h' \
    --filter "label=org.opencontainers.image.title=forgeflow-$app" > /dev/null
done
step "Deployed $FORGEFLOW_VERSION"
