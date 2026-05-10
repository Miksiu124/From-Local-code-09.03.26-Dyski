#!/usr/bin/env bash
# Wspolna lista plikow docker compose dla VPS: wolumen klastra Postgres (use3566349)
# i opcjonalnie LGTM (Grafana/Tempo/Loki) - ta sama logika co deploy-vps.sh / deploy-vps.ps1.
#
# Zrodla (pozniejsze nadpisuje wczesniejsze tylko dla flag bool):
#   - .env i .env.vps: VPS_USE_POSTGRES_CLUSTER, VPS_USE_LGTM
#   - .env: linia COMPOSE_FILE=... (jak dopisuje vps-up-prod.sh) - jesli zawiera use3566349 / lgtm.yml
#   - jesli istnieje .env.lgtm, dokladamy docker-compose.lgtm.yml (spojny stos obserwowalnosci)
#
# Uzycie z katalogu glownego ContentManager:
#   SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
#   # shellcheck source=compose-vps-files.sh
#   source "$SCRIPT_DIR/compose-vps-files.sh"
#   set_compose_vps_files "$@"
#   docker compose $COMPOSE_FILES up -d

set_compose_vps_files() {
  local use_lgtm_flag=false
  local use_cluster=false
  for a in "$@"; do
    [[ "$a" == "--lgtm" ]] && use_lgtm_flag=true
  done

  COMPOSE_FILES="-f docker-compose.yml -f docker-compose.vps.yml"

  _bool_env() {
    case "$(echo "$1" | tr '[:upper:]' '[:lower:]' | tr -d ' \r\n')" in
      1|true|yes|on) return 0 ;;
      *) return 1 ;;
    esac
  }

  _get_key() {
    local key="$1" f="$2" line val
    [[ ! -f "$f" ]] && return 1
    line=$(grep -E "^[[:space:]]*${key}=" "$f" 2>/dev/null | head -1) || return 1
    val="${line#*=}"
    val="${val%%$'\r'}"
    val="${val#\"}"
    val="${val%\"}"
    val="${val#\'}"
    val="${val%\'}"
    echo "$val"
  }

  _ingest_file() {
    local f="$1"
    [[ ! -f "$f" ]] && return 0
    if grep -qE "^[[:space:]]*COMPOSE_FILE=.*use3566349" "$f" 2>/dev/null; then
      use_cluster=true
    fi
    if grep -qE "^[[:space:]]*COMPOSE_FILE=.*docker-compose\.lgtm\.yml" "$f" 2>/dev/null; then
      use_lgtm_flag=true
    fi
    local v
    v=$(_get_key VPS_USE_POSTGRES_CLUSTER "$f") || true
    if _bool_env "${v:-0}"; then
      use_cluster=true
    fi
    v=$(_get_key VPS_USE_LGTM "$f") || true
    if _bool_env "${v:-0}"; then
      use_lgtm_flag=true
    fi
  }

  _ingest_file ".env"
  _ingest_file ".env.vps"

  if [[ "$use_cluster" == true ]]; then
    COMPOSE_FILES="$COMPOSE_FILES -f docker-compose.use3566349.yml"
  fi
  if [[ "$use_lgtm_flag" == true ]] || [[ -f .env.lgtm ]]; then
    if [[ ! "$COMPOSE_FILES" == *"docker-compose.lgtm.yml"* ]]; then
      COMPOSE_FILES="$COMPOSE_FILES -f docker-compose.lgtm.yml"
    fi
  fi
}
