#!/bin/sh
# Reports a deployment to ForgeFlow from any CI (GitLab CI, Jenkins, a shell script…), for
# pipelines that do not use GitHub Deployments. Needs only sh and curl.
#
#   FORGEFLOW_URL=https://forgeflow.example.com FORGEFLOW_TOKEN=ffp_…
#
#   id=$(report-deployment.sh start --environment production --version v1.4.0 \
#          --sha "$COMMIT_SHA" --ref main --url "$JOB_URL")
#   … deploy …
#   report-deployment.sh finish "$id" --status success --environment-url https://app.example.com
#
# `start` prints the deployment id. Its Idempotency-Key comes from the CI run when one is known
# (GITHUB_RUN_ID, CI_JOB_ID, BUILD_TAG…) or from --key, so a retried call never reports twice.
# The project is the one of the API token (created on the project's page in ForgeFlow).
set -eu

usage() {
  sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//' >&2
  exit 2
}

: "${FORGEFLOW_URL:?set FORGEFLOW_URL to the ForgeFlow address}"
: "${FORGEFLOW_TOKEN:?set FORGEFLOW_TOKEN to an API token of the project}"
[ $# -ge 1 ] || usage
command=$1
shift

deployment_id=
if [ "$command" = finish ]; then
  [ $# -ge 1 ] || usage
  deployment_id=$1
  shift
fi

# The JSON string of $1 (backslashes, quotes and control characters escaped).
json_string() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/\t/\\t/g' | tr -d '\n\r' |
    sed -e 's/^/"/' -e 's/$/"/'
}

fields=
add() {
  [ -n "$2" ] || return 0
  fields="${fields:+$fields,}\"$1\":$(json_string "$2")"
}

key=
while [ $# -gt 0 ]; do
  [ $# -ge 2 ] || usage
  case $1 in
    --environment) add environment "$2" ;;
    --status) add status "$2" ;;
    --version) add version "$2" ;;
    --sha) add sha "$2" ;;
    --ref) add ref "$2" ;;
    --url) add url "$2" ;;
    --environment-url) add environmentUrl "$2" ;;
    --description) add description "$2" ;;
    --creator) add creator "$2" ;;
    --key) key=$2 ;;
    *) usage ;;
  esac
  shift 2
done

api="${FORGEFLOW_URL%/}/api/v1/deployments"

case $command in
  start)
    if [ -z "$key" ]; then
      run="${GITHUB_RUN_ID:+gh-$GITHUB_RUN_ID-${GITHUB_RUN_ATTEMPT:-1}-${GITHUB_JOB:-job}}"
      run="${run:-${CI_JOB_ID:+gitlab-$CI_JOB_ID}}"
      run="${run:-${BUILD_TAG:+jenkins-$BUILD_TAG}}"
      key="${run:-local-$(date +%s)-$$}"
    fi
    key=$(printf '%s' "$key" | tr -c 'A-Za-z0-9._:-' '-')
    response=$(curl --fail-with-body --silent --show-error --retry 3 --retry-all-errors \
      -X POST "$api" \
      -H "Authorization: Bearer $FORGEFLOW_TOKEN" \
      -H "Idempotency-Key: $key" \
      -H 'Content-Type: application/json' \
      --data "{$fields}")
    ;;
  finish)
    response=$(curl --fail-with-body --silent --show-error --retry 3 --retry-all-errors \
      -X PATCH "$api/$deployment_id" \
      -H "Authorization: Bearer $FORGEFLOW_TOKEN" \
      -H 'Content-Type: application/json' \
      --data "{$fields}")
    ;;
  *) usage ;;
esac

# {"data":{"id":"<uuid>",…}}: print the deployment id.
printf '%s' "$response" | sed -n 's/^{"data":{"id":"\([0-9a-f-]*\)".*/\1/p'
