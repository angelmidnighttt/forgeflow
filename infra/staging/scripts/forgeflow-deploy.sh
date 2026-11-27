#!/usr/bin/env bash
# The only command the CI deploy key can run: its authorized_keys line is
#   restrict,command="/usr/local/bin/forgeflow-deploy" ssh-ed25519 …
# (bootstrap.sh installs this file there). The workflow sends
#   deploy <commit-sha> <registry-user>
# with a registry token on stdin; anything else is refused.
set -euo pipefail

root=${FORGEFLOW_ROOT:-/opt/forgeflow}

refuse() {
  echo "refused: $*" >&2
  exit 2
}

read -r -a words <<< "${SSH_ORIGINAL_COMMAND:-}"
[[ ${#words[@]} -eq 3 && ${words[0]} == deploy ]] ||
  refuse "expected 'deploy <commit-sha> <registry-user>'"
version=${words[1]}
registry_user=${words[2]}
[[ $version =~ ^[0-9a-f]{40}$ ]] || refuse "not a full commit SHA: $version"
[[ $registry_user =~ ^[A-Za-z0-9][A-Za-z0-9-]*(\[bot\])?$ ]] || refuse 'bad registry user'

# One deploy at a time, including one started by hand.
exec 9> "$root/deploy.lock"
flock 9

# The workflow's GITHUB_TOKEN, which expires with the job: used for this pull in a throwaway
# Docker config, so it is never stored on the server.
IFS= read -r token || true
DOCKER_CONFIG=$(mktemp -d)
export DOCKER_CONFIG
trap 'rm -rf "$DOCKER_CONFIG"' EXIT
if [[ -n ${token:-} ]]; then
  printf '%s' "$token" | docker login ghcr.io --username "$registry_user" --password-stdin > /dev/null
fi
unset token

git -C "$root/repo" fetch --quiet origin
git -C "$root/repo" checkout --quiet --detach "$version"

# Keep going when CI cancels the job or the connection drops: stopping halfway through would leave
# a half-switched release. The full log stays in deploy.log.
trap '' HUP PIPE
bash "$root/repo/infra/staging/scripts/deploy.sh" "$version" 2>&1 |
  tee --output-error=warn-nopipe -a "$root/deploy.log"
