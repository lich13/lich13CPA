#!/bin/bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <dmg-directory> <app-name>" >&2
  exit 1
fi

DMG_DIR="$1"
APP_NAME="$2"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HELPER_APPLESCRIPT="${SCRIPT_DIR}/fix-and-open-helper.applescript"
HELPER_SHELL_SCRIPT="${SCRIPT_DIR}/fix-and-open-helper.sh"
HELPER_APP_NAME="Fix_And_Open_${APP_NAME}.app"

if [[ ! -d "${DMG_DIR}" ]]; then
  echo "DMG directory not found: ${DMG_DIR}" >&2
  exit 1
fi

if [[ ! -f "${HELPER_APPLESCRIPT}" ]]; then
  echo "Helper AppleScript not found: ${HELPER_APPLESCRIPT}" >&2
  exit 1
fi

if [[ ! -f "${HELPER_SHELL_SCRIPT}" ]]; then
  echo "Helper shell script not found: ${HELPER_SHELL_SCRIPT}" >&2
  exit 1
fi

DMG_PATH="$(find "${DMG_DIR}" -maxdepth 1 -type f -name "${APP_NAME}_*.dmg" | head -n 1)"
if [[ -z "${DMG_PATH}" ]]; then
  echo "No DMG found for ${APP_NAME} in ${DMG_DIR}" >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
RW_DMG="${TMP_DIR}/${APP_NAME}-rw.dmg"
MOUNT_DIR="${TMP_DIR}/mount"
FINAL_DMG="${TMP_DIR}/$(basename "${DMG_PATH}")"
HELPER_BUILD_DIR="${TMP_DIR}/${HELPER_APP_NAME}"

cleanup() {
  if mount | grep -q "on ${MOUNT_DIR} "; then
    hdiutil detach "${MOUNT_DIR}" -quiet || true
  fi
  rm -rf "${TMP_DIR}"
}
trap cleanup EXIT

mkdir -p "${MOUNT_DIR}"

chmod +x "${HELPER_SHELL_SCRIPT}"
osacompile -o "${HELPER_BUILD_DIR}" "${HELPER_APPLESCRIPT}"
cp "${HELPER_SHELL_SCRIPT}" "${HELPER_BUILD_DIR}/Contents/Resources/fix_and_open.sh"
chmod +x "${HELPER_BUILD_DIR}/Contents/Resources/fix_and_open.sh"
codesign --force --deep --sign - "${HELPER_BUILD_DIR}" >/dev/null

hdiutil convert "${DMG_PATH}" -format UDRW -o "${RW_DMG}" -quiet
hdiutil attach "${RW_DMG}" -mountpoint "${MOUNT_DIR}" -nobrowse -quiet

cp -R "${HELPER_BUILD_DIR}" "${MOUNT_DIR}/${HELPER_APP_NAME}"

cat > "${MOUNT_DIR}/README-If-macOS-blocks-launch.txt" <<EOF
If macOS blocks ${APP_NAME}, open:
${HELPER_APP_NAME}

What the helper app does:
1. install or update ${APP_NAME}.app
2. remove the quarantine attribute
3. open the app

Important:
- On unsigned builds, macOS may also block the helper app once.
- If that happens, go to System Settings -> Privacy & Security and click "Open Anyway" for ${HELPER_APP_NAME}.
EOF

hdiutil detach "${MOUNT_DIR}" -quiet
hdiutil convert "${RW_DMG}" -format UDZO -imagekey zlib-level=9 -o "${FINAL_DMG}" -quiet
mv "${FINAL_DMG}" "${DMG_PATH}"
