#!/bin/bash
set -euo pipefail

APP_NAME="lich13CPA.app"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE_APP="${SCRIPT_DIR}/${APP_NAME}"
USER_APPS_DIR="${HOME}/Applications"
SYSTEM_APPS_DIR="/Applications"

log() {
  printf '%s\n' "$1"
}

pick_target_app() {
  if [[ -d "${SYSTEM_APPS_DIR}/${APP_NAME}" ]]; then
    printf '%s\n' "${SYSTEM_APPS_DIR}/${APP_NAME}"
    return
  fi

  if [[ -w "${SYSTEM_APPS_DIR}" ]]; then
    printf '%s\n' "${SYSTEM_APPS_DIR}/${APP_NAME}"
    return
  fi

  mkdir -p "${USER_APPS_DIR}"
  printf '%s\n' "${USER_APPS_DIR}/${APP_NAME}"
}

TARGET_APP="$(pick_target_app)"

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
  osascript -e 'display dialog "没有找到 lich13CPA.app。请先把应用拖到 Applications 或与此脚本放在同一 DMG 中。" buttons {"OK"} default button "OK" with icon caution'
  exit 1
fi

log "Removing quarantine attributes from ${TARGET_APP}"
xattr -dr com.apple.quarantine "${TARGET_APP}" 2>/dev/null || true
spctl --add --label "lich13CPA" "${TARGET_APP}" 2>/dev/null || true

log "Opening ${TARGET_APP}"
open "${TARGET_APP}"

