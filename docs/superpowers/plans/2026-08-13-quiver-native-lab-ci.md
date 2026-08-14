# Quiver Native Lab CI and Installation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make this Mac mini a secure repository-scoped GitHub Actions runner, reproducibly build Quiver Native, exercise the four exact physical devices, retain evidence, and leave the verified app installed on each device.

**Architecture:** A typed Python `quiver-lab` CLI owns device discovery, subprocess execution, locking, artifacts, and result manifests. Thin `just` recipes and GitHub workflows invoke the same CLI. Android UI smoke uses Maestro over ADB; Apple UI smoke uses a standalone XCUITest bundle on physical devices. Exact device identifiers come from a gitignored local inventory.

**Tech Stack:** Python 3.13 via `uv`, pytest, GitHub Actions self-hosted ARM64 runner as a user launchd service, Xcode 26.6/`xcodebuild`/`devicectl`, CocoaPods 1.17.0, XcodeGen, Android SDK/Gradle/JDK 17, ADB, Maestro 2.8, `gh`, `jq`, `just`.

## Global Constraints

- Physical targets are exact: iPad CoreDevice `EF7A9A29-939C-56D7-BC62-2AF09D48C724`, iPhone CoreDevice `CAB0ED1D-913E-5EB9-8737-5E6D3888907F`, Android tablet serial `4de5967c`, Android phone serial `ee6c6a88`.
- A paired-but-offline target is a failed/blocked matrix entry; no simulator, emulator, or alternate device is substituted.
- Lab jobs are serialized by both GitHub concurrency and a local non-blocking filesystem lock.
- Pull requests from forks never execute on the self-hosted runner.
- Runner registration tokens, Apple credentials, profile metadata, full hardware UDIDs, and device-local
  data are never printed, committed, or included in uploaded artifacts. Signed `.app` bundles and raw
  `.xcresult` files necessarily contain a profile or destination identifier; retain them only in a
  mode-0700 local run directory and upload allowlisted sanitized summaries/attachments instead.
- Every device result records commit, app version, bundle ID, model, OS, identifier, build hash, start/end time, and pass/fail stage.
- Final installation is a signed standalone development/release-like build that launches without Metro.
- Scripts are idempotent and preserve successful artifacts; retries are explicit and bounded.

---

## Locked file map

```text
lab/devices.example.json                     committed inventory schema/example
lab/devices.local.json                       exact local inventory, gitignored
scripts/lab/pyproject.toml                   uv project and CLI entry point
scripts/lab/src/quiver_lab/config.py         typed inventory/environment loading
scripts/lab/src/quiver_lab/process.py        redacted subprocess execution
scripts/lab/src/quiver_lab/inventory.py      CoreDevice/ADB discovery and matching
scripts/lab/src/quiver_lab/artifacts.py      run directories, JSON manifest, logs
scripts/lab/src/quiver_lab/android.py        build/install/launch/Maestro orchestration
scripts/lab/src/quiver_lab/apple.py          prebuild/sign/build/install/XCUITest orchestration
scripts/lab/src/quiver_lab/cli.py             command-line surface
scripts/lab/tests/**                          parser/command/artifact tests
device-tests/maestro/smoke.yaml              Android physical UI flow
device-tests/ios/project.yml                 generated XCUITest project definition
device-tests/ios/QuiverSmokeTests.swift      Apple physical UI flow/screenshots
scripts/ci/setup-mac-mini.sh                 prerequisite audit/install hints
scripts/ci/install-github-runner.sh          repository runner registration/service
.github/workflows/ci.yml                     hosted trusted-independent checks
.github/workflows/lab-devices.yml            self-hosted physical matrix
.github/actions/setup-project/action.yml      shared deterministic project bootstrap
artifacts/                                   gitignored local run evidence
```

### Task 1: Typed lab inventory and evidence foundation

**Files:**
- Create: `scripts/lab/pyproject.toml`
- Create: `scripts/lab/src/quiver_lab/config.py`
- Create: `scripts/lab/src/quiver_lab/process.py`
- Create: `scripts/lab/src/quiver_lab/inventory.py`
- Create: `scripts/lab/src/quiver_lab/artifacts.py`
- Create: `scripts/lab/src/quiver_lab/cli.py`
- Create: `scripts/lab/tests/test_inventory.py`
- Create: `scripts/lab/tests/test_process.py`
- Create: `scripts/lab/tests/test_artifacts.py`
- Create: `lab/devices.example.json`
- Create: `lab/devices.local.json`
- Modify: `.gitignore`
- Modify: `justfile`

**Interfaces:**
- Consumes: `xcrun devicectl ... --json-output`, `adb devices -l`, local inventory.
- Produces: `uv run quiver-lab inventory --strict --json`, typed `LabConfig`, `Device`, `RunArtifacts`, redacted `run_checked`.

- [ ] **Step 1: Write failing JSON and ADB parser tests**

Fixture tests cover connected/paired/offline CoreDevice states, two ADB devices, unauthorized/offline ADB,
duplicate aliases, wrong model, missing identifier, and extra unconfigured hardware. Strict mode succeeds
only when all configured targets are connected and model/platform match.

- [ ] **Step 2: Define the committed inventory schema and exact local file**

```json
{
  "schemaVersion": 1,
  "appleTeamId": "HPNQ87SHMK",
  "devices": [
    {"alias":"ipad","platform":"ios","id":"EF7A9A29-939C-56D7-BC62-2AF09D48C724","modelContains":"iPad Air 13-inch"},
    {"alias":"iphone","platform":"ios","id":"CAB0ED1D-913E-5EB9-8737-5E6D3888907F","modelContains":"iPhone 15"},
    {"alias":"android-tablet","platform":"android","id":"4de5967c","modelContains":"OPD2415"},
    {"alias":"android-phone","platform":"android","id":"ee6c6a88","modelContains":"ONEPLUS_A6000"}
  ]
}
```

Commit the same structure in `devices.example.json` with clearly synthetic IDs/team. Ignore
`lab/devices.local.json`, `artifacts/`, derived data, APKs, `.app`, results, and runner work directories.

- [ ] **Step 3: Implement typed discovery without shell parsing shortcuts**

`inventory.py` creates a temporary JSON path, calls `devicectl` with `--json-output`, parses the supported
JSON object, and removes the temporary file in `finally`. ADB parsing uses whitespace fields and `key:value`
properties. `process.py` accepts argument arrays only, streams output to an artifact log, redacts configured
patterns, records duration/exit code, and raises `ProcessFailure` with the log path.

- [ ] **Step 4: Implement atomic evidence manifests and locking**

Each run lives at `artifacts/<UTC timestamp>-<short sha>/`. Write `manifest.json.tmp`, fsync, then rename.
Use `fcntl.flock(LOCK_EX | LOCK_NB)` on `/Users/xie/Library/Caches/quiver-native/lab.lock`; report the active
PID instead of waiting. Manifest stage values are `inventory`, `build`, `install`, `launch`, `smoke`,
`performance`, `complete`.

- [ ] **Step 5: Verify and commit**

Run: `uv run --project scripts/lab pytest scripts/lab/tests -q && uv run --project scripts/lab quiver-lab inventory --json`  
Expected now: parser/tests pass; live output identifies three currently reachable devices and reports the
paired iPhone as unavailable without substituting another target.

```bash
git add scripts/lab lab/devices.example.json .gitignore justfile
git commit -m "build(lab): add typed physical device inventory"
```

### Task 2: Reproducible Android build, install, launch, and smoke

**Files:**
- Create: `scripts/lab/src/quiver_lab/android.py`
- Create: `scripts/lab/tests/test_android.py`
- Create: `device-tests/maestro/smoke.yaml`
- Modify: `scripts/lab/src/quiver_lab/process.py`
- Modify: `scripts/lab/tests/test_process.py`
- Modify: `scripts/lab/src/quiver_lab/cli.py`
- Modify: `justfile`

**Interfaces:**
- Consumes: configured Android targets, generated native project, Gradle, ADB, Maestro.
- Produces: `quiver-lab android build|install|smoke|all --device <alias>`, one standalone release-like APK hash shared across Android devices.

- [ ] **Step 1: Write failing command-construction and device-guard tests**

Assert every ADB call includes `-s <serial>`, install uses `install -r -t`, clean-state smoke uses
`pm clear app.quiver.native`, launch uses `am start -W`, Maestro receives `--udid`, build selects JDK 17,
and no command is launched for offline/unauthorized/model-mismatched devices. Resolve canonical executable
paths for npm, JDK 17, aapt2, and Maestro at preflight before mutation; validate the generated Gradle wrapper
as a regular nonsymlink executable immediately after prebuild.

Every subprocess has an action-specific wall-clock deadline, TERM/kill escalation for its process group,
fixed-size streaming into a complete mode-0600 redacted log, and a bounded in-memory output. Timeout or
output overflow fails closed. Tests include a silent hang, TERM-resistant child, huge newline-free output,
and a secret split across read chunks.

- [ ] **Step 2: Implement deterministic Android build**

Run root `npm ci`, math asset build, Expo clean prebuild for Android, then:

```text
apps/mobile/android/gradlew --no-daemon --stacktrace :app:assembleRelease
```

Set `JAVA_HOME` to the validated JDK 17 path and `ORG_GRADLE_PROJECT_org.gradle.java.home` consistently.
The release-like local flavor uses the checked-in/debug keystore only for lab distribution, embeds the JS
bundle, disables Metro, and outputs `apps/mobile/android/app/build/outputs/apk/release/app-release.apk`.
Before Gradle, reject/remove only that exact generated APK so a stale same-commit output cannot masquerade
as fresh. Require one uncontradicted `BUILD SUCCESSFUL` claim and a newly created regular output; reject
`BUILD FAILED` even with exit zero. After prebuild and before Gradle, embed canonical
`assets/quiver-build.json` containing the requested commit and verify exactly one byte-identical entry in
the resulting ZIP. Hash the APK with SHA-256 and record package/version via fail-closed whole-output
`aapt2 dump badging` parsing.

Publish the APK as a read-only no-overwrite copy in the protected run. Reuse takes the prior run's final
producer `manifest.json`, not an arbitrary APK: read canonical nonsymlink bytes once, require a coherent
passing fresh-build schema/commit/hash/package/version, copy and hash-lock both manifest and APK into the
consumer run, then revalidate the embedded commit and metadata. Bind path-consuming external tools to an
already-open validated APK descriptor where supported so a swap-and-restore pathname race cannot change
the inspected or installed bytes.

- [ ] **Step 3: Implement exact-device install and launch**

Before install, query OS/model/ABI/battery/storage with exact whole-output grammars: reject duplicate,
shadow, impossible, or failure claims; require battery in `[0,100]`; and compare the normalized model fact
to the already guarded physical target. Install with `adb -s SERIAL install -r -t APK`, require one
uncontradicted success, and verify canonical `pm path` plus package version. Pull the installed base APK to
a protected temporary file, require its SHA-256 to equal the validated build hash, record that digest, and
remove the raw pull. This end-to-end check is mandatory even when a descriptor path is used for install.
Require expected-silent force-stop/log-clear outputs to be empty, launch the main activity with
`am start -W`, require one canonical `Status: ok` and `TotalTime`, resolve one positive PID, and scan a
PID-filtered 500-line logcat under a wall-clock deadline for fatal exceptions.

- [ ] **Step 4: Write the cross-device Maestro flow**

```yaml
appId: app.quiver.native
---
- launchApp:
    clearState: true
- assertVisible:
    id: "library-screen"
- tapOn:
    id: "new-document"
- assertVisible:
    id: "editor-canvas"
- tapOn:
    id: "canvas-create-vertex"
- inputText: "A"
- pressKey: Enter
- tapOn:
    id: "canvas-create-vertex"
- inputText: "B"
- pressKey: Enter
- tapOn:
    id: "connect-selection"
- assertVisible: "1 edge"
- tapOn:
    id: "undo"
- assertVisible: "0 edges"
- tapOn:
    id: "redo"
- assertVisible: "1 edge"
- tapOn:
    id: "share-export"
- assertVisible: "Quiver URL"
- takeScreenshot: "android-export"
```

If canvas actions require deterministic positions, the app exposes accessibility buttons only in the lab
build variant; they call production action factories and remain hidden from normal layout/accessibility.
Run Maestro 2.8 with `--format JUNIT --output REPORT` and a fresh protected test-output directory. Passing
smoke requires a regular nonsymlink JUnit report with at least one executed test and zero
failures/errors/skips plus exactly one retained `android-export.png`; record paths and SHA-256 values. An
exit-zero no-op or empty output directory fails.

- [ ] **Step 5: Verify both connected Android targets and commit**

Run:

```bash
uv run --project scripts/lab quiver-lab android all --device android-tablet
uv run --project scripts/lab quiver-lab android all --device android-phone --build-manifest /absolute/path/to/tablet/run/manifest.json
```

Expected: identical local and pulled-installed APK hashes, installed package/version verified, both Maestro
JUnit flows pass, and hashed screenshots/logs are recorded per device. A passing `all` manifest must itself
be accepted as a coherent producer for the second device.

```bash
git add scripts/lab/src/quiver_lab/android.py scripts/lab/src/quiver_lab/process.py scripts/lab/tests/test_android.py scripts/lab/tests/test_process.py scripts/lab/src/quiver_lab/cli.py device-tests/maestro justfile
git commit -m "build(lab): verify Android physical devices"
```

### Task 3: Reproducible Apple signing, install, launch, and XCUITest

**Files:**
- Create: `scripts/lab/src/quiver_lab/apple.py`
- Create: `scripts/lab/tests/test_apple.py`
- Create: `apps/mobile/Podfile.lock`
- Create: `device-tests/ios/project.yml`
- Create: `device-tests/ios/QuiverSmokeTests.swift`
- Modify: `scripts/lab/src/quiver_lab/inventory.py`
- Modify: `scripts/lab/tests/test_inventory.py`
- Modify: `scripts/lab/src/quiver_lab/cli.py`
- Modify: `justfile`

**Interfaces:**
- Consumes: Apple team/codesigning identity, CocoaPods, XcodeGen, generated iOS project, paired CoreDevice
  UUIDs plus the guarded physical records' hardware UDIDs.
- Produces: `quiver-lab apple build|install|smoke|all --device <alias>`, signed standalone `.app`, `.xcresult`, screenshots.

- [ ] **Step 1: Write failing signing/destination/guard tests**

Assert build verifies exactly one valid Apple Development identity containing team `HPNQ87SHMK` without
logging identity/profile text and uses `generic/platform=iOS` for the final shared app build. Extend
inventory parsing to retain each CoreDevice record's `hardwareProperties.udid`, `reality`, boot/pairing and
tunnel state, developer-mode state, and `ddiServicesAvailable`; list inventory does not contain lock state.
Keep the hardware UDID in a `repr=False` field and register it for command redaction immediately.

Choose a capability-based exact-target guard because Xcode 26.6's list-record tunnel/DDI values can remain
stale while direct device operations succeed. Before any mutation, require the configured
alias/platform/CoreDevice UUID/model, physical reality, booted and paired state, and enabled Developer
Mode. Then query `device info lockState` and `device info ddiServices --no-auto-mount-ddis`, requiring valid
version-3 success envelopes, `passcodeRequired == false`, `unlockedSinceBoot == true`, and usable compatible
DDI services. Finally require a harmless bundle-filtered `device info apps` capability probe. Only after
these checks may code mount a DDI or mutate the device. Fixture stale disconnected/unavailable list flags
with successful and failed direct probes. Use the CoreDevice UUID only for `devicectl`; use the same guarded
record's hardware UDID only for physical `xcodebuild -destination 'platform=iOS,id=HARDWARE_UDID'` with a
bounded destination timeout. Never substitute a simulator or another physical device.

- [ ] **Step 2: Implement clean prebuild and signed standalone app build**

Run math assets and `APP_VARIANT=lab expo prebuild --clean --platform ios --no-install`. Restore the
committed canonical `apps/mobile/Podfile.lock` into the generated `ios` directory and run
`pod install --deployment`; any resolution that would modify the lock fails review instead of silently
updating it. Preserve `APP_VARIANT=lab` through the native build so the embedded app exposes
`extra.labSmoke=true`, then:

```text
xcodebuild -workspace apps/mobile/ios/Quiver.xcworkspace -scheme Quiver \
  -configuration Release -destination generic/platform=iOS \
  -derivedDataPath artifacts/.../ios-derived \
  DEVELOPMENT_TEAM=HPNQ87SHMK CODE_SIGN_STYLE=Automatic \
  -allowProvisioningUpdates -allowProvisioningDeviceRegistration build
```

Require exactly one top-level `Quiver.xcworkspace`, then require workspace name `Quiver` and scheme
`Quiver` from `xcodebuild -workspace ... -list -json`; extra Pod schemes are allowed. Resolve the built app
from `xcodebuild -showBuildSettings -json` using `TARGET_BUILD_DIR` plus `WRAPPER_NAME`, never a guessed
path. A generic shared build is accepted only if its decoded development profile contains both configured
physical hardware UDIDs. If either is absent, perform bounded disposable automatic-signing builds against
each already-guarded exact physical destination to register/refresh provisioning, then produce one new
final generic build and revalidate that its profile covers both. Never install those intermediate apps or
claim them as the shared artifact.

Verify the `.app` with `codesign --verify --deep --strict`. Decode entitlements and
`embedded.mobileprovision` only in mode-0600 temporary files; validate identifier/team relationships,
expiry, `get-task-allow`, and target-device coverage, but retain no parsed raw entitlements, certificate
data, profile UUID/name, or UDID outside the protected local run. Subprocess support must provide a
suppressed-output/allowlisted-summary mode for `security`, profile, and signing commands; ordinary string
redaction is insufficient for secrets discovered only in output. Hash the final signed bundle from sorted
relative paths plus entry type, executable mode, symlink target, size, and file bytes, including
`_CodeSignature` and the profile. The hash proves one artifact reused across devices; it is not claimed
reproducible across separately signed builds.

- [ ] **Step 3: Implement CoreDevice installation and launch**

Use `devicectl device install app --device CORE_UUID --quiet --timeout 120 --json-output result.json APP`,
then separately verify the installed version with `devicectl device info apps --device CORE_UUID
--include-all-apps --bundle-id app.quiver.native --json-output apps.json`. Launch with
`devicectl device process launch --terminate-existing --activate --device CORE_UUID --quiet --timeout 30
--json-output launch.json app.quiver.native`; the bundle identifier must be the final argument so later
options cannot become app arguments. Parse the Xcode 26 version-3 envelope, requiring
`info.jsonVersion == 3`, successful `info.outcome`/the exact expected `info.commandType`, and object
`result`; do not confuse JSON version with the separate tool `info.version`. App queries use `result.apps`
and process queries use `result.runningProcesses`. Treat raw JSON as secure temporary input and retain only
allowlisted, redacted summaries. Save bounded console/system logs; do not attach an interactive debugger.

- [ ] **Step 4: Define the standalone physical XCUITest bundle**

`project.yml` generates a standalone `bundle.ui-testing` target `QuiverSmokeTests` with bundle ID
`app.quiver.native.smoke-tests`, iOS 16.4, `USES_XCTRUNNER=YES`, `SUPPORTED_PLATFORMS=iphoneos`, device
families 1/2, generated Info.plist, no `TEST_TARGET_NAME`, and no Quiver target dependency. Supply signing
team/style only through local `xcodebuild` overrides, never committed YAML. The Swift test launches the
already-installed app by bundle identifier with an app-owned deterministic lab-reset launch argument,
performs the same library → new document → two labelled vertices → edge → undo/redo → export →
terminate/relaunch flow, waits with predicates rather than sleeps, and attaches
`XCUIScreen.main.screenshot()` at each major stage. Do not replace missing accessibility actions with
coordinate or text fallbacks.

Core launch snippet:

```swift
let app = XCUIApplication(bundleIdentifier: "app.quiver.native")
app.launch()
XCTAssertTrue(app.otherElements["library-screen"].waitForExistence(timeout: 15))
```

- [ ] **Step 5: Build/run UI tests on each exact physical destination**

Generate into the protected run-owned artifact directory with
`xcodegen generate --spec device-tests/ios/project.yml --project RUN/device-tests-ios`; never generate an
unignored project beside the committed spec. Then run the generated project with the guarded hardware
destination, unique derived/result paths, automatic signing overrides,
`-parallel-testing-enabled NO`, bounded test timeouts, and `-only-testing:QuiverSmokeTests`. Parse
`xcresulttool get test-results summary --path RESULT.xcresult`, requiring `result == "Passed"`, zero
failures, at least one passed test, and the expected guarded physical destination; fixture the actual Xcode
26.6 array-shaped `devicesAndConfigurations`/`testFailures` output. Export with
`xcresulttool export attachments --path RESULT.xcresult --output-path DIR` and capture bounded console logs
with `xcresulttool get log --path RESULT.xcresult --type console`. Keep the raw `.xcresult` local and upload
only scrubbed summaries plus reviewed screenshots.

- [ ] **Step 6: Verify reachable iPad and commit**

Run: `uv run --project scripts/lab quiver-lab apple all --device ipad`  
Expected after the app exposes `new-document`, `editor-canvas`, `canvas-create-vertex`,
`connect-selection`, `undo`, `redo`, `share-export`, and the lab-reset launch contract: the signed lab app
installs and launches on the iPad, physical XCUITest passes, and `.xcresult` plus screenshots are retained.
Until those action IDs exist, unit/injected tests and read-only tool resolution must pass, but full live
XCUITest acceptance remains explicitly deferred rather than replaced with a weaker smoke flow.

```bash
git add apps/mobile/Podfile.lock scripts/lab/src/quiver_lab/apple.py scripts/lab/src/quiver_lab/inventory.py scripts/lab/tests/test_apple.py scripts/lab/tests/test_inventory.py scripts/lab/src/quiver_lab/cli.py device-tests/ios justfile
git commit -m "build(lab): verify Apple physical devices"
```

### Task 4: Performance evidence and four-device matrix command

**Files:**
- Create: `scripts/lab/src/quiver_lab/performance.py`
- Create: `scripts/lab/src/quiver_lab/matrix.py`
- Create: `scripts/lab/tests/test_matrix.py`
- Modify: `scripts/lab/src/quiver_lab/cli.py`
- Modify: `justfile`

**Interfaces:**
- Consumes: per-platform build/install/smoke functions and artifact manifests.
- Produces: `quiver-lab matrix --strict`, frame/launch/memory summaries, top-level `matrix.json`/JUnit.

- [ ] **Step 1: Write failing resume/failure/summary tests**

Assert platform build occurs once then reuses an identical hash, each target has independent stages,
`--resume RUN` skips only verified stages with matching commit/hash, one failure does not erase other
results, strict exit is nonzero unless all four complete, JUnit has one testcase per device, and secrets/
document labels are absent from serialized evidence.

- [ ] **Step 2: Add bounded performance capture**

Android captures launch `am start -W`, `dumpsys gfxinfo app.quiver.native reset`/post-flow frame histogram,
and `dumpsys meminfo`. Apple captures launch/interaction signposts through an ETTrace/instruments template
available on Xcode 26 and summarizes UI frame duration/memory with `xctrace export`. Performance collection
failure is recorded separately but fails the release matrix because budgets are part of the product spec.

- [ ] **Step 3: Implement serial matrix orchestration**

Order is inventory, shared Android build, Android tablet/phone, shared Apple build, iPad/iPhone, aggregate.
The matrix writes its manifest after every stage, catches typed failures per device, and exits only after
all reachable targets have evidence. Final strict success requires 95th percentile UI frames below 16.7
ms on the standard fixture, launch below 2 seconds, memory below 300 MB, and all smoke flows passing.

- [ ] **Step 4: Verify current partial matrix and commit**

Run: `uv run --project scripts/lab quiver-lab matrix --strict`  
Expected until the iPhone reconnects: Android phone/tablet and iPad complete; iPhone is explicitly
unavailable; overall exit is nonzero and the resumable run path is printed.

```bash
git add scripts/lab/src/quiver_lab scripts/lab/tests/test_matrix.py justfile
git commit -m "test(lab): aggregate physical product evidence"
```

### Task 5: Hosted CI and protected self-hosted workflow

**Files:**
- Create: `.github/actions/setup-project/action.yml`
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/lab-devices.yml`
- Create: `scripts/ci/validate-workflows.sh`
- Modify: `justfile`

**Interfaces:**
- Consumes: repository checks and `quiver-lab matrix`.
- Produces: hosted pull-request CI and trusted, serialized physical-device CI.

- [ ] **Step 1: Add local workflow syntax/security assertions**

The validator parses YAML and fails if a self-hosted job is reachable from `pull_request`/
`pull_request_target`, lacks `contents: read`, lacks a 120-minute timeout/concurrency, persists credentials,
or executes interpolated PR-controlled strings. It also fails on unpinned third-party actions; first-party
GitHub actions are pinned to audited major tags or commit SHAs per repository policy.

- [ ] **Step 2: Create hosted CI**

`ci.yml` triggers on pull requests and pushes to `master`/`react-native-rewrite`, uses Ubuntu for
format/lint/type/core/mobile tests and Android compile, and a GitHub-hosted macOS job for unsigned/native
generation checks if account capacity permits. It runs `npm ci`, cached `uv sync --locked`, `just ci`, and
uploads test reports only on failure.

- [ ] **Step 3: Create trusted lab workflow**

`lab-devices.yml` triggers only on `workflow_dispatch` and pushes to the protected
`react-native-rewrite`/`master` branches in `dual1208/quiver`. The job has:

```yaml
runs-on: [self-hosted, macOS, ARM64, quiver-lab]
permissions:
  contents: read
timeout-minutes: 120
concurrency:
  group: quiver-native-physical-lab
  cancel-in-progress: false
```

It checks out with `persist-credentials: false`, validates the actor/repository/event before any project
script, runs strict inventory then matrix, and uploads only redacted artifacts. No repository secret is
exposed to fork code.

- [ ] **Step 4: Validate and commit**

Run: `scripts/ci/validate-workflows.sh && actionlint .github/workflows/*.yml`  
Expected: zero syntax/security findings.

```bash
git add .github scripts/ci/validate-workflows.sh justfile
git commit -m "ci: add hosted and protected device workflows"
```

### Task 6: Mac mini prerequisite audit and GitHub runner service

**Files:**
- Create: `scripts/ci/setup-mac-mini.sh`
- Create: `scripts/ci/install-github-runner.sh`
- Create: `docs/lab-runner.md`

**Interfaces:**
- Consumes: `gh` authenticated as repository admin, Homebrew, explicit runner path.
- Produces: online runner named `quiver-mac-mini`, labels `self-hosted,macOS,ARM64,quiver-lab`, boot-persistent user launchd service.

- [ ] **Step 1: Implement idempotent prerequisite audit**

Audit exact commands/versions and install only missing packages explicitly required by the plans:
`cocoapods` 1.17.x, `xcodegen`, `xcbeautify`, `actionlint`, `uv`, `openjdk@17`, Android SDK tools, Maestro,
Node 22+, Xcode 26.6, `gh`, `jq`, and `just`. Validate Xcode license/first launch, one codesigning identity
for team `HPNQ87SHMK`, Android SDK licenses, local inventory permissions `0600`, and available disk above
30 GB. The script supports `--audit` (no changes) and `--install` (Homebrew changes), with no password or
credential arguments.

- [ ] **Step 2: Implement secret-safe runner installation**

Use the explicit directory `/Users/xie/actions-runners/dual1208-quiver`. Resolve the latest ARM64 runner
release from GitHub's official API, download/check its published checksum, extract only into that empty or
recognized runner directory, request a short-lived token into a shell variable with:

```bash
runner_token="$(gh api --method POST repos/dual1208/quiver/actions/runners/registration-token --jq .token)"
```

Disable xtrace around the variable, pass it to unattended `config.sh` with URL
`https://github.com/dual1208/quiver`, name `quiver-mac-mini`, labels `quiver-lab`, work directory `_work`,
and `--replace`; unset it immediately. Run `svc.sh install` and `svc.sh start` as the logged-in user.

- [ ] **Step 3: Install and verify the service**

Run:

```bash
scripts/ci/setup-mac-mini.sh --audit
scripts/ci/setup-mac-mini.sh --install
scripts/ci/install-github-runner.sh
gh api repos/dual1208/quiver/actions/runners --jq '.runners[] | select(.name=="quiver-mac-mini") | {name,status,busy,labels:[.labels[].name]}'
```

Expected: one `online`, non-busy runner with all four required labels; `svc.sh status` reports its launchd
service started. No token appears in terminal output or runner diagnostics.

- [ ] **Step 4: Document recovery and commit**

`docs/lab-runner.md` records audit, start/stop/status, safe re-registration, runner removal through GitHub,
device reconnect expectations, artifact paths, and the trusted-trigger threat model. It contains no local
token, certificate, provisioning profile, or device content.

```bash
git add scripts/ci/setup-mac-mini.sh scripts/ci/install-github-runner.sh docs/lab-runner.md
git commit -m "ops: register Mac mini physical lab runner"
```

### Task 7: Execute CI, complete the four-device matrix, and leave builds installed

**Files:**
- Create: `docs/verification/latest-device-matrix.md`
- Modify only if failures expose a verified defect: affected source/tests/scripts from earlier tasks.

**Interfaces:**
- Consumes: complete repository, online runner, all four connected physical devices.
- Produces: passing local/remote CI, installed app on each target, final evidence summary.

- [ ] **Step 1: Run clean repository CI**

Run: `npm ci && uv sync --project scripts/lab --locked && just ci`  
Expected: formatting, lint, types, core/renderer/mobile tests, Expo Doctor, and native generation/build checks
all pass from a clean checkout.

- [ ] **Step 2: Push branch and dispatch lab workflow**

Push `react-native-rewrite`, dispatch `lab-devices.yml` with `gh workflow run`, capture its run ID, and watch
with `gh run watch --exit-status`. If the iPhone is offline, retain the failed inventory run and resume only
after the exact target becomes connected; never edit the matrix to omit it.

- [ ] **Step 3: Run/resume strict local matrix with all four targets**

Run: `uv run --project scripts/lab quiver-lab matrix --strict` or `--resume <run>` after reconnect.  
Expected: build, install, launch, smoke, and performance stages pass for ipad, iphone, android-tablet, and
android-phone with exact IDs and shared per-platform hashes.

- [ ] **Step 4: Reinstall final standalone builds after destructive smoke cleanup**

Run `quiver-lab apple install` for iPad/iPhone and `quiver-lab android install` for tablet/phone without
clear-state or uninstall, launch each once, and verify installed package version/hash. This ensures the
product remains installed even if the test runner removed/replaced data during smoke.

- [ ] **Step 5: Review evidence and write the verification summary**

The summary table links local artifact paths and GitHub run URL, and records commit, version, model, OS,
identifier suffix, build hash prefix, smoke result, frame p95, launch time, and memory for each target.
Redact full personal device names from committed prose while retaining configured aliases and public model.

- [ ] **Step 6: Commit final evidence document**

```bash
git add docs/verification/latest-device-matrix.md
git commit -m "docs: record four-device product verification"
```
