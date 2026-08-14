# Quiver Native product and architecture design

**Status:** Approved for implementation under the product-decision delegation in the initiating request  
**Date:** 2026-08-13  
**Working branch:** `react-native-rewrite`

## 1. Outcome

Quiver Native is an offline-first React Native editor for commutative and pasting diagrams on iPhone,
iPad, Android phones, and Android tablets. It preserves the web Quiver document semantics and export
quality while replacing the DOM editor with a native, GPU-rendered canvas and a gesture system designed
for direct manipulation on touchscreens.

The release is complete when the fork contains a reproducible app and CI system, the core editing and
import/export flows pass automated tests, and signed/development builds are installed and smoke-tested
on the four physical devices attached to this Mac mini.

## 2. Product decisions

The initiating request delegates product decisions and asks work to continue unattended. The following
decisions are therefore binding for the first release.

- Product name: **Quiver Native**. The in-app short name remains **Quiver**.
- Application identifiers: `app.quiver.native` on Apple platforms and `app.quiver.native` on Android.
- Platforms: iOS/iPadOS 16.4+ and Android 7+ (API 24+), matching Expo SDK 57's stable support envelope.
- Framework: Expo SDK 57 on React Native 0.86, React 19.2, Hermes, and the New Architecture.
- Rendering: React Native Skia, with React Native views only for controls, accessibility overlays, and
  text entry.
- Gestures: React Native Gesture Handler and Reanimated. Continuous viewport and drag updates stay on
  the UI thread; document mutations are committed at gesture boundaries.
- Storage: local documents and autosave by default. No account, analytics, advertising, or cloud sync.
- Compatibility: import and export existing Quiver base64 URLs; export TikZ-CD and Typst. The fork's
  upstream web source remains available in Git history and as compatibility fixtures, not as the app UI.
- Distribution for this goal: locally signed/development builds installed on the four lab devices.
  App Store and Play Store publication are outside this release.
- Orientation: tablets support portrait and landscape; phones support both but open portrait-first.
- Theme: system light/dark with a high-contrast canvas. Existing diagram colours remain document data.

## 3. Scope

### Included

- A document library with new, rename, duplicate, delete, import, share, and automatic recovery.
- An infinite snap grid with adaptive spacing and a visible origin.
- Create, select, multi-select, move, relabel, duplicate, and delete vertices.
- Create, reconnect, relabel, and style edges, including loops and higher cells up to Quiver's current
  level-four usability limit.
- Arrow tail/body/head styles, colour, curve/radius/offset, shortening, label alignment, and level.
- Undo/redo, clipboard operations, diagram transforms, fit-to-content, and reset view.
- Import from a Quiver URL, encoded payload, clipboard text, or supported file.
- Export/share as Quiver URL, TikZ-CD, standalone LaTeX, Typst/Fletcher, PNG, SVG, and app document JSON.
- Offline math labels and custom macro definitions.
- Hardware keyboard shortcuts, pointer/trackpad input, Apple Pencil and Android stylus input.
- VoiceOver/TalkBack descriptions and actions for document elements.
- Unit, property, component, rendering-golden, and physical-device smoke tests.
- A repository-scoped GitHub Actions self-hosted runner on this Mac mini and deterministic local `just`
  recipes for the same checks.

### Deliberately excluded

- User accounts, collaboration, cloud storage, comments, telemetry, and server-side rendering.
- Arbitrary freehand drawing. Pencil/stylus input manipulates diagram objects rather than creating ink.
- Automatic mathematical proof checking or semantic validation of commutativity.
- Store submission, production certificates, and public release management.
- A new interchange format that would break existing Quiver links.

## 4. Considered approaches

### A. Native Skia canvas and portable TypeScript core — selected

The diagram model, geometry, serializers, command history, and exporters become platform-neutral
TypeScript. Skia renders one GPU canvas; native gesture recognizers drive a viewport transform and direct
manipulation. This has the highest initial porting cost but gives predictable multitouch, scalable
rendering, testable domain logic, and one cross-platform product.

### B. React Native shell around the existing web editor

Embedding the current app in a WebView would preserve features quickly, but two-finger gesture
arbitration, Pencil/stylus semantics, focus, accessibility, text selection, and large-diagram performance
would remain constrained by a browser inside a native shell. It is acceptable only as a short-lived
reference harness, not as the shipped editor.

### C. Separate SwiftUI and Jetpack Compose applications

Two native applications offer maximum platform-specific control but duplicate the renderer, input state
machine, accessibility layer, and test surface. Shared Kotlin/Swift or C++ cores would introduce another
boundary without eliminating UI duplication. This is not justified for a focused editor maintained by a
small team.

## 5. Experience architecture

### Document library

The library is the launch surface. It displays recent documents as preview cards, recovers the last open
document after an interrupted session, and exposes import through a prominent action. Destructive delete
is recoverable from a local trash collection for 30 days. A fresh install includes three read-only sample
diagrams that can be duplicated.

### Editor shell

The editor has four stable regions:

1. A top app bar with back/library, title, undo, redo, share/export, and overflow actions.
2. The infinite diagram canvas, which owns the remaining space.
3. A contextual inspector: a persistent trailing panel on regular-width tablets and a draggable bottom
   sheet on compact-width phones.
4. A compact creation rail on tablets or floating creation button on phones for explicit vertex/edge
   creation, selection mode, and fit-to-content.

The canvas remains usable while the inspector is open. Insets from the inspector are included in
fit-to-content and viewport centring.

### Inspector

The inspector is selection-driven. It shows label editing first, then only properties shared by the
selection. Mixed values display an indeterminate state. Changes preview immediately and merge into one
undo command until editing ends. Edge styles use visual thumbnails and meaningful text labels rather
than exposing implementation names.

## 6. Native-feeling input model

All interactive targets meet a 44-point iOS and 48-dp Android minimum hit region. Visual shapes may be
smaller than their hit regions. Native touch slop is respected before an interaction commits.

| Input | Empty canvas | Vertex or edge | Inspector/control |
|---|---|---|---|
| One-finger/stylus tap | Clear selection; reveal insertion cursor | Select; second tap opens label edit | Activate control |
| Double tap | Create a vertex and open label edit | Open label edit | Native control behaviour |
| One-finger/stylus drag | Lasso after crossing slop | Move selection; drag an exposed port to connect/reconnect | Native control behaviour |
| Long press | Open create/paste context menu | Add/remove from selection and expose actions | Native control behaviour |
| Two-finger pan | Pan viewport | Pan viewport without changing selection | Scroll native sheet/panel |
| Pinch | Zoom continuously around the gesture focal point | Same | Disabled inside controls |
| Mouse/trackpad | Click/lasso; wheel pans; modified wheel/trackpad pinch zooms | Drag or connect using ports | Desktop-like hover and controls |
| Hardware keyboard | Navigate grid and use Quiver-compatible shortcuts | Edit/manipulate selection | Standard text and focus handling |

Gesture arbitration rules:

- A second contact cancels an uncommitted one-finger canvas action and hands the unchanged state to the
  simultaneous pan/pinch recognizers. The viewport origin is rebased at transition, preventing jumps.
- A drag that begins inside an element's expanded body moves it. A drag that begins on a visible endpoint
  port connects or reconnects it. Ports appear on selection or Pencil/stylus hover where supported.
- Direct dragging previews unsnapped motion; nearby grid or alignment candidates produce a light haptic
  tick and a guide. Release commits the snapped result. Holding the platform secondary modifier disables
  snapping for pointer/keyboard input.
- Pinch scale is clamped to 0.18x–4x with rubber-band resistance outside the range and a short spring back
  on release. Grid density changes by powers of two so it never flickers at subpixel spacing.
- Pan and zoom never enter the document undo history. Object transforms do.
- A gesture may emit at most one success/error haptic per state transition; continuous movement never
  produces repeated vibration.
- Pencil/stylus wins element manipulation when it is down. Concurrent fingers remain available for
  viewport movement, allowing “Pencil edits, hand navigates” on tablets.
- System back, edge-swipe navigation, text-selection gestures, and accessibility gestures take precedence
  over the canvas recognizers.

## 7. Technical architecture

The repository becomes an npm workspace while retaining the original `src/` tree as `legacy-web/` test
input during the port. The shipped app never loads `legacy-web/`.

```text
apps/mobile
  app/                 Expo Router screens and navigation
  src/editor/          editor composition and gesture coordinator
  src/components/      controls, sheets, accessibility overlays
  src/platform/        sharing, files, clipboard, haptics, device capabilities
packages/core
  src/model/           immutable document entities and invariants
  src/commands/        reversible mutations and transaction merging
  src/geometry/        curves, intersections, hit testing, layout, viewport math
  src/codec/           native JSON and Quiver base64 compatibility
  src/export/          TikZ-CD, standalone LaTeX, Typst/Fletcher, SVG
  src/macros/          validated macro and colour definitions
packages/renderer
  src/scene/           pure render-scene construction from model + viewport
  src/skia/            Skia components and cached drawing resources
  src/math/            offline MathJax worker, SVG/path cache, metrics
packages/test-fixtures
  upstream/            known Quiver payloads and expected exports
  documents/           representative native documents
scripts
  ci/                  machine and runner setup
  devices/             inventory, build, install, launch, and smoke orchestration
```

Every package exposes a narrow public entry point and has no dependency on a sibling's internals.
`packages/core` has no React Native imports. `packages/renderer` may depend on core but does not mutate
documents. `apps/mobile` owns orchestration and platform effects.

### Domain model

`DiagramDocument` contains metadata, ordered vertices, ordered edges, macro definitions, and a schema
version. Entity IDs are stable UUIDs. A `Vertex` has an integer grid position, raw math label, label
colour, and optional presentation metadata. An `Edge` references source and target entity IDs; sources
and targets may be vertices or lower-level edges. Its derived level must equal one plus the maximum
endpoint level and may not exceed four.

Documents are validated at import and before persistence. Invalid references, cycles in higher-cell
dependencies, duplicate occupied vertex positions, non-finite geometry, and unsupported option types
are rejected with a structured diagnostic. The importer may recover independent valid cells but never
silently changes a valid value.

### Commands and state

The authoritative document lives in a small external store with selector-based subscriptions. All
mutations are typed commands with `apply`, `invert`, and merge metadata. Gesture previews live in
Reanimated shared values and a transient overlay; the final command is dispatched once on release.
Undo retains 200 transactions per document and is not persisted across app launches. Autosave persists
the resulting document, not the command log.

Selection, viewport, open inspector section, and insertion cursor are session state. Only the last
viewport per document is persisted. Render components subscribe to scene slices so editing a label does
not rebuild unrelated geometry.

### Renderer

The renderer builds a deterministic scene graph in this order: adaptive grid, selection/lasso guides,
edges from low to high dimension, vertices, labels, connection ports, then transient gesture overlays.
Geometry is expressed in document coordinates and transformed once at the canvas root.

Arrow curves and endpoint intersections are ports of the upstream algorithms with typed value objects and
golden tests. Hit testing uses broad-phase spatial indexing followed by exact curve/shape distance tests.
The spatial index is rebuilt incrementally for changed entities.

Math labels are rendered offline by one hidden, sandboxed local WebView worker containing pinned MathJax
assets. It accepts a batched, versioned message protocol and returns sanitized SVG plus exact bounds.
Skia parses and caches those SVGs by `(source, macrosHash, colour, scaleBucket)`. Raw label text appears
immediately while the first render is pending; cached math replaces it without changing the document.
Worker failure keeps the raw label visible and surfaces one non-blocking diagnostic.

PNG uses an offscreen Skia surface at user-selected scale. SVG export uses the deterministic scene and
math SVG fragments rather than rasterizing the canvas.

## 8. Compatibility and files

The native schema is readable JSON with a media type of `application/vnd.quiver.native+json` and a
`.quiver.json` extension. Schema migrations are pure, ordered functions with fixture coverage.

The compatibility codec exactly accepts Quiver's current version-zero array payload, including legacy
`length` conversion, edge-level migration, colours, label alignment, higher cells, macro URL, and renderer
selection. Compatibility export emits a URL that opens on `https://q.uiver.app/`; native-only metadata is
excluded. Round trips are compared semantically rather than by insignificant JSON key order.

Imports are size-limited to 5 MB and macro downloads to 1 MB. Macro URLs require HTTPS except for local
development. Network content is treated as text, parsed with explicit limits, and never executed.

## 9. Persistence and recovery

Expo SQLite stores document metadata, versioned JSON blobs, previews, and trash timestamps. A write-ahead
log and transactions protect autosaves. The editor debounces autosave by 350 ms after a committed command
and flushes when backgrounding or leaving the editor. The previous valid blob remains until the next
write commits.

On launch, the app validates the latest blob. If it is corrupt, it opens the preceding recovery snapshot
and explains what happened. A rolling snapshot is retained after every 25 commands and before import.
Documents remain available without network access.

## 10. Error handling

- User-correctable import/export errors appear in a sheet with a plain-language summary, source location
  when known, and a copyable technical detail section.
- Recoverable renderer/math failures keep the editor interactive and show raw labels or simplified arrow
  bodies.
- Persistence failures keep the document dirty in memory, retry with bounded backoff while foregrounded,
  and display a persistent “Not saved” indicator.
- Programmer invariant failures are caught at the editor boundary, written to an on-device rotating log,
  and offer document export before returning to the library.
- CI scripts fail fast with explicit missing-device identifiers and preserve build logs, screenshots, and
  test results as artifacts.

No error report leaves the device automatically.

## 11. Accessibility

The Skia canvas has an overlaid accessibility tree containing visible or selected entities. Each element
announces type, label, endpoints for edges, selection state, and grid position. Custom actions include
select, edit label, connect, move by grid step, and delete. Focused entities receive a high-contrast
visible ring. Dynamic Type affects application chrome and inspectors; diagram math preserves document
scale but supports viewport zoom. Reduce Motion replaces springs with short linear transitions. Haptics
obey platform settings.

Hardware keyboard focus never becomes trapped in the canvas. Common Quiver shortcuts are preserved where
they do not conflict with system conventions; Command/Ctrl-Z, Shift-Command/Ctrl-Z, copy/paste, delete,
escape, arrows, space, enter, and tab receive explicit automated coverage.

## 12. Performance budgets

- One-finger drag, pan, and pinch maintain 60 fps on all four lab devices and 120 fps where display and
  OS permit; the 95th-percentile UI-frame time must remain below 16.7 ms during the standard 100-node /
  180-edge fixture.
- A committed simple command reaches the rendered scene within 50 ms at the 95th percentile.
- Cold launch to interactive library is under 2 seconds on each lab device.
- Opening the standard fixture is under 750 ms after SQLite read.
- Memory remains below 300 MB for the standard fixture and does not grow by more than 10 MB across 50
  repeated open/close cycles.
- Import, export, and renderer outputs are deterministic for identical inputs.

Performance evidence is captured on physical devices; simulator/emulator results are not accepted for
these budgets.

## 13. Test strategy

1. Core unit tests cover model invariants, commands/inverses, migrations, codecs, exporters, macros, and
   geometry edge cases.
2. Property tests generate valid documents and assert command inversion, codec round trips, finite
   geometry, and deterministic exports.
3. Golden fixtures cover published Quiver examples, loops, parallel arrows, styles, higher cells,
   Unicode, malformed inputs, and legacy options.
4. Component tests cover library/editor state, inspector mixed values, error states, and accessibility
   actions.
5. Rendering goldens compare deterministic scene descriptions; a smaller physical-device visual set
   captures screenshots for human review without relying on cross-GPU pixel identity.
6. Native integration tests exercise SQLite recovery, clipboard/share adapters, file import, and math
   worker batching.
7. Physical-device smoke tests create a document, add two labelled vertices, connect and style an edge,
   pan/pinch, undo/redo, export a Quiver URL, background/relaunch, and verify recovery.

Tests use stable accessibility IDs instead of screen coordinates. Device workflows retain one screenshot
per major step and capture platform logs on failure.

## 14. CI and lab topology

GitHub-hosted CI runs formatting, lint, TypeScript, core/component tests, dependency validation, and
Android compile checks on pull requests. A repository-scoped self-hosted GitHub Actions runner on this
Apple-silicon Mac mini runs signed Apple builds and the physical-device matrix. It is installed as a
user `launchd` service and labelled `self-hosted`, `macOS`, `ARM64`, and `quiver-lab`.

The physical matrix uses exact identifiers recorded in an uncommitted/local lab inventory:

- iPad Air 13-inch (M2): CoreDevice `EF7A9A29-939C-56D7-BC62-2AF09D48C724`.
- iPhone 15: CoreDevice `CAB0ED1D-913E-5EB9-8737-5E6D3888907F`.
- Android tablet OPD2415: adb serial `4de5967c`.
- Android phone OnePlus 6: adb serial `ee6c6a88`.

The iPhone is currently paired but offline; the workflow reports it as unavailable rather than silently
substituting a simulator. The goal remains open until it reconnects and passes installation and smoke.

Device jobs are serialized under one GitHub Actions concurrency group and guarded by a local filesystem
lock. Each run performs inventory validation, clean build, install/upgrade, launch, smoke, log capture,
and artifact upload. No simulator or emulator is created or selected. Secrets and Apple team/profile
details remain in the runner environment or keychain and never enter repository files or workflow logs.

The repository `justfile` is the human-facing entry point. Its thin recipes delegate to package, Gradle,
Xcode, and device scripts: `bootstrap`, `fmt`, `lint`, `typecheck`, `test`, `build-ios`, `build-android`,
`device-inventory`, `device-smoke`, `check`, and `ci`.

## 15. Security and privacy

The app requests no sensitive permissions. File and clipboard reads occur only after a user action.
Shared URLs contain the diagram by design and the share preview states that plainly. Imported JSON and
base64 are validated with depth/count/size limits. WebView navigation and network access are disabled for
the bundled math worker; its bridge accepts only the versioned render protocol and sanitizes returned
SVG. Native logs redact document labels and payloads by default.

GitHub Actions from untrusted forks never run on the self-hosted runner. The physical-device workflow is
limited to trusted branches or explicit maintainers' dispatches.

## 16. Definition of done

- The GitHub fork and upstream remotes are correct, and the rewrite branch is pushed.
- The app is a native React Native/Skia implementation; no editor WebView loads the legacy application.
- All included editor, persistence, compatibility, export, accessibility, and adaptive-layout flows work.
- `just ci` passes from a clean checkout on the Mac mini.
- Hosted checks and the self-hosted workflow are committed and syntax-validated.
- The repository runner is online as a service with trusted-branch restrictions.
- Builds are installed and the standard smoke flow passes on the named iPhone, iPad, Android phone, and
  Android tablet.
- Verification artifacts identify app version, commit, OS, model, device identifier, and pass/fail result.
- An independent final code/product review has no unresolved blocking or high-severity findings.

## 17. Primary references

- [Expo SDK 57 support matrix](https://docs.expo.dev/versions/latest/)
- [React Native stable release policy](https://reactnative.dev/releases/)
- [React Native New Architecture](https://reactnative.dev/architecture/landing-page)
- [React Native Gesture Handler](https://docs.swmansion.com/react-native-gesture-handler/)
- [React Native Skia canvas](https://shopify.github.io/react-native-skia/docs/canvas/overview/)
- [GitHub self-hosted runner management](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners)

