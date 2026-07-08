#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env"
OUTPUT_FILE="${ROOT_DIR}/infrastructure/emqx/auth-built-in-db-bootstrap.csv"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing .env file at ${ENV_FILE}" >&2
  exit 1
fi

read_env_value() {
  local key="$1"
  local line

  line="$(grep -E "^${key}=" "${ENV_FILE}" | tail -n 1 || true)"
  if [[ -z "${line}" ]]; then
    return 1
  fi

  local value="${line#*=}"
  value="${value%$'\r'}"
  value="${value%\"}"
  value="${value#\"}"
  value="${value%\'}"
  value="${value#\'}"
  printf '%s' "${value}"
}

MQTT_USERNAME="$(read_env_value MQTT_PILOT_USERNAME || true)"
MQTT_PASSWORD="$(read_env_value MQTT_PILOT_PASSWORD || true)"

if [[ -z "${MQTT_USERNAME}" ]]; then
  echo "MQTT_PILOT_USERNAME is missing in .env" >&2
  exit 1
fi

if [[ -z "${MQTT_PASSWORD}" ]]; then
  echo "MQTT_PILOT_PASSWORD is missing in .env" >&2
  exit 1
fi

if [[ "${MQTT_USERNAME}" == *","* || "${MQTT_PASSWORD}" == *","* ]]; then
  echo "MQTT username/password must not contain commas for the EMQX bootstrap CSV." >&2
  exit 1
fi

mkdir -p "$(dirname "${OUTPUT_FILE}")"
umask 077
{
  echo "user_id,password,is_superuser"
  printf '%s,%s,false\n' "${MQTT_USERNAME}" "${MQTT_PASSWORD}"
} > "${OUTPUT_FILE}"

chmod 644 "${OUTPUT_FILE}"
echo "Rendered EMQX MQTT user bootstrap file: ${OUTPUT_FILE}"
echo "No secret value was printed. Recreate EMQX to apply it."
