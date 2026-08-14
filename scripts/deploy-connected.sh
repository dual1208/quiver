#!/usr/bin/env bash

set -Eeuo pipefail
IFS=$'\n\t'

readonly APPLE_IPAD_ID="EF7A9A29-939C-56D7-BC62-2AF09D48C724"
readonly APPLE_IPHONE_ID="CAB0ED1D-913E-5EB9-8737-5E6D3888907F"
readonly ANDROID_TABLET_ID="4de5967c"
readonly ANDROID_PHONE_ID="ee6c6a88"
readonly APPLE_BUNDLE_ID="app.quiver.mobile"
readonly ANDROID_PACKAGE="app.quiver.mobile"
readonly ANDROID_NDK_VERSION="27.1.12297006"
readonly MIN_FREE_GIB="${QUIVER_DEPLOY_MIN_FREE_GIB:-10}"

REPOSITORY_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
readonly REPOSITORY_ROOT
DEPLOY_KEY="${GITHUB_RUN_ID:-local-$(date -u +%Y%m%dT%H%M%SZ)}-${GITHUB_RUN_ATTEMPT:-1}"
readonly DEPLOY_KEY
readonly ARTIFACT_DIR="${QUIVER_DEPLOY_ARTIFACT_DIR:-${REPOSITORY_ROOT}/artifacts/device-deploy/${DEPLOY_KEY}}"
readonly WORK_DIR="${QUIVER_DEPLOY_WORK_DIR:-${REPOSITORY_ROOT}/artifacts/_work/device-deploy/${DEPLOY_KEY}}"
readonly LOG_DIR="${ARTIFACT_DIR}/logs"
readonly LOCK_FILE="${QUIVER_DEPLOY_LOCK_FILE:-${HOME}/Library/Caches/quiver-native/device-deploy.lock}"

DEPLOY_STATUS="failed"
LOCK_HELD=0
TEMP_DIR=""

die() {
  printf 'deploy-connected: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "required command is unavailable: $1"
}

cleanup() {
  local exit_code=$?

  if [[ -n "${TEMP_DIR}" && -d "${TEMP_DIR}" ]]; then
    for temporary_file in \
      "${TEMP_DIR}/apple-devices.json" \
      "${TEMP_DIR}/apple-devices.log" \
      "${TEMP_DIR}/adb-devices.txt"; do
      if [[ -f "${temporary_file}" ]]; then
        /bin/unlink "${temporary_file}"
      fi
    done
    /bin/rmdir "${TEMP_DIR}" 2>/dev/null || true
  fi

  if (( LOCK_HELD == 1 )) && [[ -f "${LOCK_FILE}" ]]; then
    local lock_owner
    lock_owner="$(<"${LOCK_FILE}")"
    if [[ "${lock_owner}" == "$$" ]]; then
      /bin/unlink "${LOCK_FILE}"
    fi
  fi

  if [[ -d "${ARTIFACT_DIR}" ]]; then
    printf '%s\n' "${DEPLOY_STATUS}" >"${ARTIFACT_DIR}/status.txt"
  fi

  return "${exit_code}"
}

trap cleanup EXIT

acquire_deploy_lock() {
  /bin/mkdir -p "$(dirname "${LOCK_FILE}")"
  if ! /usr/bin/shlock -p "$$" -f "${LOCK_FILE}"; then
    die "another physical-device deployment owns ${LOCK_FILE}"
  fi
  LOCK_HELD=1
}

check_host() {
  [[ "$(uname -s)" == "Darwin" ]] || die "deployment requires macOS"
  [[ "$(uname -m)" == "arm64" ]] || die "deployment requires Apple Silicon (arm64)"
  [[ "${MIN_FREE_GIB}" =~ ^[0-9]+$ ]] || die "QUIVER_DEPLOY_MIN_FREE_GIB must be a nonnegative integer"

  for command_name in adb ditto git jq npm pod shlock xcodebuild xcrun; do
    require_command "${command_name}"
  done

  local free_kib required_kib
  free_kib="$(df -Pk "${REPOSITORY_ROOT}" | awk 'NR == 2 { print $4 }')"
  required_kib=$((MIN_FREE_GIB * 1024 * 1024))
  if (( free_kib < required_kib )); then
    die "insufficient disk space: at least ${MIN_FREE_GIB} GiB must be free before native builds"
  fi

  APPLE_TEAM_ID="${APPLE_TEAM_ID_VAR:-${APPLE_TEAM_ID:-}}"
  [[ "${APPLE_TEAM_ID}" =~ ^[A-Z0-9]{10}$ ]] || die "APPLE_TEAM_ID must be supplied as a 10-character GitHub secret or variable"

  local android_sdk
  android_sdk="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}"
  [[ -n "${android_sdk}" && -d "${android_sdk}" ]] || die "ANDROID_SDK_ROOT or ANDROID_HOME must identify the Android SDK"
  export ANDROID_SDK_ROOT="${android_sdk}"

  if [[ -x "/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home/bin/java" ]]; then
    export JAVA_HOME="/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home"
  fi
  [[ -x "${JAVA_HOME:-}/bin/java" ]] || die "a JDK 17 installation is required"
  "${JAVA_HOME}/bin/java" -version 2>&1 | head -n 1 | grep -Eq 'version "17\.' \
    || die "JAVA_HOME must select JDK 17"
}

apple_device_ready() {
  local alias=$1
  local identifier=$2
  local inventory_file=$3

  if ! jq -e --arg identifier "${identifier}" '
    .info.outcome == "success"
    and ([.result.devices[] | select(.identifier == $identifier)] | length == 1)
  ' "${inventory_file}" >/dev/null; then
    die "required Apple device is missing: ${alias} (${identifier})"
  fi

  if ! jq -e --arg identifier "${identifier}" '
    .result.devices[]
    | select(.identifier == $identifier)
    | .connectionProperties.pairingState == "paired"
      and .connectionProperties.tunnelState == "connected"
      and .deviceProperties.developerModeStatus == "enabled"
      and .deviceProperties.ddiServicesAvailable == true
  ' "${inventory_file}" >/dev/null; then
    die "required Apple device is not deployable (connect, unlock, enable Developer Mode, and mount device support): ${alias} (${identifier})"
  fi

  printf 'Apple target ready: %s (%s)\n' "${alias}" "${identifier}"
}

android_device_state() {
  local identifier=$1
  local inventory_file=$2

  awk -v identifier="${identifier}" '
    $0 == "List of devices attached" { after_header = 1; next }
    after_header && $1 == identifier { count += 1; state = $2 }
    END {
      if (count == 1) {
        print state
      } else if (count > 1) {
        print "duplicate"
      }
    }
  ' "${inventory_file}"
}

android_device_ready() {
  local alias=$1
  local identifier=$2
  local inventory_file=$3
  local state

  state="$(android_device_state "${identifier}" "${inventory_file}")"
  [[ -n "${state}" ]] || die "required Android device is missing: ${alias} (${identifier})"
  [[ "${state}" == "device" ]] || die "required Android device is not authorized and online: ${alias} (${identifier}), state=${state}"
  printf 'Android target ready: %s (%s)\n' "${alias}" "${identifier}"
}

preflight_devices() {
  local apple_inventory="${TEMP_DIR}/apple-devices.json"
  local apple_log="${TEMP_DIR}/apple-devices.log"
  local adb_inventory="${TEMP_DIR}/adb-devices.txt"

  # A direct capability probe brings an idle wired CoreDevice tunnel online.
  # Inventory alone can report a healthy iPhone as disconnected until this call.
  for identifier in "${APPLE_IPAD_ID}" "${APPLE_IPHONE_ID}"; do
    xcrun devicectl device info apps \
      --device "${identifier}" \
      --timeout 30 >/dev/null 2>&1 \
      || die "required Apple device could not start developer services: ${identifier}"
  done

  if ! xcrun devicectl list devices \
    --timeout 20 \
    --quiet \
    --json-output "${apple_inventory}" \
    --log-output "${apple_log}"; then
    die "CoreDevice inventory failed; inspect the local devicectl log"
  fi

  apple_device_ready "iPad" "${APPLE_IPAD_ID}" "${apple_inventory}"
  apple_device_ready "iPhone" "${APPLE_IPHONE_ID}" "${apple_inventory}"

  if ! adb devices -l >"${adb_inventory}" 2>&1; then
    die "ADB inventory failed"
  fi
  android_device_ready "Android tablet" "${ANDROID_TABLET_ID}" "${adb_inventory}"
  android_device_ready "Android phone" "${ANDROID_PHONE_ID}" "${adb_inventory}"
}

ensure_android_ndk() {
  local ndk_directory="${ANDROID_SDK_ROOT}/ndk/${ANDROID_NDK_VERSION}"
  if [[ -d "${ndk_directory}" ]]; then
    return
  fi

  require_command sdkmanager
  printf 'Installing required Android NDK %s\n' "${ANDROID_NDK_VERSION}"
  sdkmanager "ndk;${ANDROID_NDK_VERSION}" 2>&1 | tee "${LOG_DIR}/android-ndk.log"
  [[ -d "${ndk_directory}" ]] || die "Android NDK installation did not produce ${ndk_directory}"
}

generate_native_projects() {
  unset APP_VARIANT

  printf 'Installing locked JavaScript dependencies\n'
  npm ci 2>&1 | tee "${LOG_DIR}/npm-ci.log"

  printf 'Generating production native projects\n'
  npm run prebuild -w @quiver/mobile -- \
    --platform all \
    --clean \
    --no-install 2>&1 | tee "${LOG_DIR}/expo-prebuild.log"

  [[ -f "${REPOSITORY_ROOT}/apps/mobile/ios/Quiver.xcworkspace/contents.xcworkspacedata" ]] || die "Expo did not generate Quiver.xcworkspace"
  [[ -x "${REPOSITORY_ROOT}/apps/mobile/android/gradlew" ]] || die "Expo did not generate the Android Gradle wrapper"
  grep -Fq "PRODUCT_BUNDLE_IDENTIFIER = ${APPLE_BUNDLE_ID};" \
    "${REPOSITORY_ROOT}/apps/mobile/ios/Quiver.xcodeproj/project.pbxproj" \
    || die "generated iOS project does not use ${APPLE_BUNDLE_ID}"
  grep -Eq "applicationId ['\"]${ANDROID_PACKAGE}['\"]" \
    "${REPOSITORY_ROOT}/apps/mobile/android/app/build.gradle" \
    || die "generated Android project does not use ${ANDROID_PACKAGE}"

  printf 'Installing iOS pods\n'
  (
    cd "${REPOSITORY_ROOT}/apps/mobile/ios"
    pod install 2>&1 | tee "${LOG_DIR}/pod-install.log"
  )
}

build_ios() {
  local derived_data="${WORK_DIR}/ios-derived-data"
  local app_bundle="${derived_data}/Build/Products/Release-iphoneos/Quiver.app"
  local preserved_zip="${ARTIFACT_DIR}/Quiver-ios-release.zip"

  printf 'Building one automatically signed iOS Release app\n'
  xcodebuild \
    -workspace "${REPOSITORY_ROOT}/apps/mobile/ios/Quiver.xcworkspace" \
    -scheme Quiver \
    -configuration Release \
    -sdk iphoneos \
    -destination 'generic/platform=iOS' \
    -derivedDataPath "${derived_data}" \
    -allowProvisioningUpdates \
    -allowProvisioningDeviceRegistration \
    CODE_SIGN_STYLE=Automatic \
    DEVELOPMENT_TEAM="${APPLE_TEAM_ID}" \
    build 2>&1 | tee "${LOG_DIR}/xcodebuild.log"

  [[ -d "${app_bundle}" ]] || die "iOS build completed without ${app_bundle}"
  /usr/bin/ditto -c -k --sequesterRsrc --keepParent "${app_bundle}" "${preserved_zip}"
  IOS_APP_BUNDLE="${app_bundle}"
}

build_android() {
  local apk_source="${REPOSITORY_ROOT}/apps/mobile/android/app/build/outputs/apk/release/app-release.apk"
  local apk_artifact="${ARTIFACT_DIR}/Quiver-android-release.apk"

  printf 'Building one Android Release APK\n'
  (
    cd "${REPOSITORY_ROOT}/apps/mobile/android"
    ./gradlew \
      --no-daemon \
      -PreactNativeArchitectures=arm64-v8a \
      :app:assembleRelease 2>&1 | tee "${LOG_DIR}/gradle-assemble-release.log"
  )

  [[ -f "${apk_source}" ]] || die "Android build completed without ${apk_source}"
  /bin/cp "${apk_source}" "${apk_artifact}"
  ANDROID_APK="${apk_artifact}"
}

deploy_apple_device() {
  local alias=$1
  local identifier=$2

  printf 'Installing iOS Release app on %s (%s)\n' "${alias}" "${identifier}"
  xcrun devicectl device install app \
    --device "${identifier}" \
    "${IOS_APP_BUNDLE}" \
    --timeout 180 2>&1 | tee "${LOG_DIR}/install-${alias}.log"

  printf 'Launching iOS Release app on %s (%s)\n' "${alias}" "${identifier}"
  xcrun devicectl device process launch \
    --device "${identifier}" \
    --terminate-existing \
    "${APPLE_BUNDLE_ID}" \
    --timeout 60 2>&1 | tee "${LOG_DIR}/launch-${alias}.log"
}

deploy_android_device() {
  local alias=$1
  local identifier=$2
  local component

  printf 'Installing Android Release app on %s (%s)\n' "${alias}" "${identifier}"
  adb -s "${identifier}" install -r "${ANDROID_APK}" 2>&1 | tee "${LOG_DIR}/install-${alias}.log"

  component="$(adb -s "${identifier}" shell cmd package resolve-activity --brief "${ANDROID_PACKAGE}" | tr -d '\r' | tail -n 1)"
  [[ "${component}" == "${ANDROID_PACKAGE}/"* ]] || die "could not resolve the Quiver launcher activity on ${alias} (${identifier})"

  printf 'Launching Android Release app on %s (%s)\n' "${alias}" "${identifier}"
  adb -s "${identifier}" shell am force-stop "${ANDROID_PACKAGE}"
  adb -s "${identifier}" shell am start -W -n "${component}" 2>&1 | tee "${LOG_DIR}/launch-${alias}.log"
}

write_manifest() {
  jq -n \
    --arg commit "$(git -C "${REPOSITORY_ROOT}" rev-parse HEAD)" \
    --arg bundleIdentifier "${APPLE_BUNDLE_ID}" \
    --arg androidPackage "${ANDROID_PACKAGE}" \
    --arg iosArtifact "Quiver-ios-release.zip" \
    --arg androidArtifact "Quiver-android-release.apk" \
    --arg appleIpad "${APPLE_IPAD_ID}" \
    --arg appleIphone "${APPLE_IPHONE_ID}" \
    --arg androidTablet "${ANDROID_TABLET_ID}" \
    --arg androidPhone "${ANDROID_PHONE_ID}" \
    '{
      schemaVersion: 1,
      commit: $commit,
      ios: {
        artifact: $iosArtifact,
        bundleIdentifier: $bundleIdentifier,
        targets: [$appleIpad, $appleIphone]
      },
      android: {
        artifact: $androidArtifact,
        package: $androidPackage,
        targets: [$androidTablet, $androidPhone]
      }
    }' >"${ARTIFACT_DIR}/manifest.json"
}

main() {
  /bin/mkdir -p "${ARTIFACT_DIR}" "${WORK_DIR}" "${LOG_DIR}"
  TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/quiver-device-deploy.XXXXXX")"

  acquire_deploy_lock
  check_host
  preflight_devices
  ensure_android_ndk
  generate_native_projects

  # Both artifacts must exist before the first physical device is changed.
  build_ios
  build_android
  write_manifest

  deploy_apple_device "ipad" "${APPLE_IPAD_ID}"
  deploy_apple_device "iphone" "${APPLE_IPHONE_ID}"
  deploy_android_device "android-tablet" "${ANDROID_TABLET_ID}"
  deploy_android_device "android-phone" "${ANDROID_PHONE_ID}"

  DEPLOY_STATUS="succeeded"
  printf 'Deployment complete; preserved artifacts are in %s\n' "${ARTIFACT_DIR}"
}

main "$@"
