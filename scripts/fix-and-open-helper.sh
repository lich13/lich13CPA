#!/bin/bash
set -euo pipefail

USER_APPS_DIR="${HOME}/Applications"
SYSTEM_APPS_DIR="/Applications"

log() {
  printf '%s\n' "$1"
}

helper_app_path() {
  cd "$(dirname "$0")/../.." && pwd
}

helper_app_name() {
  basename "$(helper_app_path)"
}

target_app_name() {
  local helper_name
  helper_name="$(helper_app_name)"
  printf '%s\n' "${helper_name#Fix_And_Open_}"
}

source_app_path() {
  local helper_path
  helper_path="$(helper_app_path)"
  printf '%s\n' "$(cd "$(dirname "${helper_path}")" && pwd)/$(target_app_name)"
}

pick_target_app() {
  local app_name
  app_name="$(target_app_name)"

  if [[ -d "${SYSTEM_APPS_DIR}/${app_name}" ]]; then
    printf '%s\n' "${SYSTEM_APPS_DIR}/${app_name}"
    return
  fi

  if [[ -w "${SYSTEM_APPS_DIR}" ]]; then
    printf '%s\n' "${SYSTEM_APPS_DIR}/${app_name}"
    return
  fi

  mkdir -p "${USER_APPS_DIR}"
  printf '%s\n' "${USER_APPS_DIR}/${app_name}"
}

TARGET_APP="$(pick_target_app)"
SOURCE_APP="$(source_app_path)"
APP_NAME="$(target_app_name)"

if [[ -d "${SOURCE_APP}" ]]; then
  if [[ ! -d "${TARGET_APP}" ]]; then
    log "Installing ${APP_NAME} to ${TARGET_APP}"
    ditto "${SOURCE_APP}" "${TARGET_APP}"
  else
    SOURCE_MTIME="$(stat -f %m "${SOURCE_APP}" 2>/dev/null || echo 0)"
    TARGET_MTIME="$(stat -f %m "${TARGET_APP}" 2>/dev/null || echo 0)"

    if [[ "${SOURCE_MTIME}" -gt "${TARGET_MTIME}" ]]; then
      log "Updating ${TARGET_APP}"
      rm -rf "${TARGET_APP}"
      ditto "${SOURCE_APP}" "${TARGET_APP}"
    fi
  fi
fi

if [[ ! -d "${TARGET_APP}" ]]; then
  osascript -e "display dialog \"没有找到 ${APP_NAME}。请先把应用拖到 Applications，或让 Fix & Open 助手和应用位于同一 DMG 中。\" buttons {\"OK\"} default button \"OK\" with icon caution"
  exit 1
fi

log "Removing quarantine attributes from ${TARGET_APP}"
xattr -dr com.apple.quarantine "${TARGET_APP}" 2>/dev/null || true
spctl --add --label "${APP_NAME}" "${TARGET_APP}" 2>/dev/null || true

log "Opening ${TARGET_APP}"
open "${TARGET_APP}"
