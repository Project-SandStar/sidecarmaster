# shellcheck shell=bash disable=SC2034
# config.sh - sidecarmaster stack on a Docker host. Read by lib.sh. Copy to config.sh and edit.
NAME=sidecarmaster
SSH_HOST=my-docker-host
STACK_DIR='C:\sidecar-deploy\sidecarmaster'
COMPOSE_PROJECT=sidecarmaster
COMPOSE_FILE=docker-compose.yml
NET_CT=sidecarmaster-net   # network owner (<stack>-net): app, netbird and caddy use network_mode container:sidecarmaster-net
APP_CT=sidecarmaster-sidecarmaster-1
NETBIRD_CT=sidecarmaster-sidecarmaster-netbird-1
CADDY_CT=sidecarmaster-sidecarmaster-caddy-1
EXTRA_CTS=""
IMAGE=sidecarmaster
DOCKERFILE=Dockerfile
BUILD_CONTEXT=.
HEALTH_PORT=3010
HEALTH_PATH=/api/health
HEALTH_TIMEOUT=300
ENV_FILE=sidecarmaster.env
REQUIRED_ENV="SM_ADMIN_USERNAME SM_ADMIN_PASSWORD SM_SECRET_KEY"
ENTRYPOINT_FILES="docker/netbird-entrypoint.sh docker/caddy-entrypoint.sh"
STATUS_IMAGES="sidecarmaster sidecar-caddy netbirdio/netbird"
SETTINGS_URL="http://my-docker-host:3010/settings"
