#!/bin/bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <dmg-directory> <app-name>" >&2
  exit 1
fi

DMG_DIR="$1"
APP_NAME="$2"
HELPER_SCRIPT="$(cd "$(dirname "$0")" && pwd)/Fix_And_Open_lich13CPA.command"

if [[ ! -d "${DMG_DIR}" ]]; then
  echo "DMG directory not found: ${DMG_DIR}" >&2
  exit 1
fi

if [[ ! -f "${HELPER_SCRIPT}" ]]; then
  echo "Helper script not found: ${HELPER_SCRIPT}" >&2
  exit 1
fi

chmod +x "${HELPER_SCRIPT}"

DMG_PATH="$(find "${DMG_DIR}" -maxdepth 1 -type f -name "${APP_NAME}_*.dmg" | head -n 1)"
if [[ -z "${DMG_PATH}" ]]; then
  echo "No DMG found for ${APP_NAME} in ${DMG_DIR}" >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
RW_DMG="${TMP_DIR}/${APP_NAME}-rw.dmg"
MOUNT_DIR="${TMP_DIR}/mount"
FINAL_DMG="${TMP_DIR}/$(basename "${DMG_PATH}")"

cleanup() {
  if mount | grep -q "on ${MOUNT_DIR} "; then
    hdiutil detach "${MOUNT_DIR}" -quiet || true
  fi
  rm -rf "${TMP_DIR}"
}
trap cleanup EXIT

mkdir -p "${MOUNT_DIR}"

hdiutil convert "${DMG_PATH}" -format UDRW -o "${RW_DMG}" -quiet
hdiutil attach "${RW_DMG}" -mountpoint "${MOUNT_DIR}" -nobrowse -quiet

cp "${HELPER_SCRIPT}" "${MOUNT_DIR}/Fix_And_Open_${APP_NAME}.command"
chmod +x "${MOUNT_DIR}/Fix_And_Open_${APP_NAME}.command"

cat > "${MOUNT_DIR}/README-If-macOS-blocks-launch.txt" <<EOF
If macOS blocks ${APP_NAME}, double-click:
Fix_And_Open_${APP_NAME}.command

The script will:
1. install or update ${APP_NAME}.app
2. remove the quarantine attribute
3. open the app
EOF

hdiutil detach "${MOUNT_DIR}" -quiet
hdiutil convert "${RW_DMG}" -format UDZO -imagekey zlib-level=9 -o "${FINAL_DMG}" -quiet
mv "${FINAL_DMG}" "${DMG_PATH}"
