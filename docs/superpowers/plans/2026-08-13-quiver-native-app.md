# Quiver Native Application Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the adaptive iOS/iPadOS/Android Quiver editor with a GPU canvas, UI-thread multitouch, offline documents, math labels, import/export, and accessibility.

**Architecture:** An Expo SDK 57 app orchestrates `@quiver/core`, a small Zustand session store, SQLite document persistence, and `@quiver/renderer`. Skia owns diagram pixels; React Native owns chrome, text input, accessibility overlays, and platform effects. Gesture previews use Reanimated shared values and commit one core transaction on release.

**Tech Stack:** Expo SDK 57.0.12, React Native 0.86.2, React 19.2.3, Expo Router, TypeScript strict mode, Hermes/New Architecture, Expo-compatible React Native Skia 2.6.2, Gesture Handler 2.32.0, Reanimated 4.5.1, Zustand 5, Expo SQLite, React Native WebView, bundled MathJax, Jest Expo, React Native Testing Library 14.

## Global Constraints

- Minimum iOS/iPadOS is 16.4 and minimum Android is API 24; bundle/application ID is `app.quiver.native`.
- No editor WebView may load or display `legacy-web`; the only WebView is a hidden, network-disabled local math worker.
- The app works offline after install and makes no telemetry, account, ad, or background-network request.
- Continuous pan, pinch, and drag updates remain on the UI thread and do not dispatch document mutations.
- Touch hit regions are at least 44 points on Apple and 48 dp on Android.
- Tablet and phone layouts are adaptive and support portrait and landscape.
- The app must remain functional when math rendering fails by showing raw label source.
- UI tests address elements by stable accessibility/test IDs, never screen coordinates.
- No simulator or emulator is created or used for the product verification required by this plan.

---

## Locked file map

```text
apps/mobile/app.config.ts                       Expo identifiers, plugins, platform floors
apps/mobile/app/_layout.tsx                     providers and root stack
apps/mobile/app/index.tsx                       document library route
apps/mobile/app/editor/[id].tsx                 editor route
apps/mobile/src/library/**                      library presentation and actions
apps/mobile/src/editor/EditorScreen.tsx         adaptive editor composition
apps/mobile/src/editor/session.ts               Zustand vanilla session store
apps/mobile/src/editor/gestures/**              UI-thread gesture state machine
apps/mobile/src/editor/components/**            app bar, creation rail, inspector, label editor
apps/mobile/src/persistence/**                  SQLite schema/repository/recovery
apps/mobile/src/platform/**                     clipboard/files/share/haptics/logs
apps/mobile/src/accessibility/**                canvas semantic overlay and keyboard mapping
apps/mobile/assets/math/**                      bundled MathJax browser assets
packages/renderer/src/scene/**                  deterministic render-scene construction
packages/renderer/src/skia/**                   canvas drawing components and caches
packages/renderer/src/math/**                   worker protocol and SVG sanitization
packages/renderer/test/**                       scene and protocol tests
apps/mobile/__tests__/**                        component/integration tests
```

### Task 1: Expo application scaffold and native configuration

**Files:**
- Create: `apps/mobile/package.json`
- Create: `apps/mobile/app.config.ts`
- Create: `apps/mobile/tsconfig.json`
- Create: `apps/mobile/babel.config.js`
- Create: `apps/mobile/metro.config.js`
- Create: `apps/mobile/jest.config.js`
- Create: `apps/mobile/jest.setup.ts`
- Create: `apps/mobile/app/_layout.tsx`
- Create: `apps/mobile/app/index.tsx`
- Create: `apps/mobile/__tests__/boot.test.tsx`
- Modify: root `package.json`
- Modify: `justfile`

**Interfaces:**
- Consumes: npm workspace and `@quiver/core` from the core plan.
- Produces: Expo app workspace `@quiver/mobile`, root route with `testID="library-screen"`, native projects generated reproducibly by `npm run prebuild -w @quiver/mobile`.

- [ ] **Step 1: Generate SDK 57 base and install SDK-compatible native libraries**

Run from a temporary directory, then move the generated application files into `apps/mobile` so the
command cannot overwrite root files:

```bash
npx create-expo-app@latest quiver-mobile-seed --template default@sdk-57
npx expo install expo-router expo-sqlite expo-file-system expo-sharing expo-clipboard expo-haptics \
  expo-document-picker expo-status-bar react-native-safe-area-context react-native-screens \
  react-native-webview react-native-gesture-handler react-native-reanimated \
  @shopify/react-native-skia expo-build-properties
npm install zustand@5.0.15
```

Copy only generated app/config/assets files, express dependencies in `apps/mobile/package.json`, then run
one root `npm install` to produce the canonical lockfile. Remove the seed directory after its contents are
accounted for.

- [ ] **Step 2: Write the failing boot test**

```tsx
import { render, screen } from "@testing-library/react-native";
import LibraryRoute from "../app/index";

it("opens the document library", async () => {
  await render(<LibraryRoute />);
  expect(screen.getByTestId("library-screen")).toBeOnTheScreen();
  expect(screen.getByText("Quiver")).toBeOnTheScreen();
});
```

- [ ] **Step 3: Configure the app and root providers**

`app.config.ts` keeps internal `name: "Quiver"` in every variant, sets slug `quiver-native`, scheme
`quiver`, both identifiers `app.quiver.native`, `orientation: "default"`, and iPad support. The
`expo-build-properties` plugin sets iOS deployment target `16.4` and Android min SDK `24`. Do not set
`newArchEnabled`: React Native 0.86 is New-Architecture-only and Expo's generated project owns that flag.
Explicit Android permissions are `INTERNET` (only for user-initiated macro import) and `VIBRATE`; block
inherited `READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE`, and `SYSTEM_ALERT_WINDOW` because documents
use the system picker/app storage and the release needs no overlay permission. An explicit
`APP_VARIANT=lab` changes only the iOS `CFBundleDisplayName` and Android `app_name` to `Quiver Lab` with a
typed config mod, and sets compile-time `extra.labSmoke=true`; it retains internal name, scheme, generated
`Quiver` workspace/scheme, and `app.quiver.native` so physical drivers exercise the final identity. Other
variants set it false. `_layout.tsx` wraps the stack in
`GestureHandlerRootView`, `SafeAreaProvider`, theme provider, and repository provider.

- [ ] **Step 4: Verify JavaScript and native generation**

Run:

```bash
npm test -w @quiver/mobile -- --runInBand __tests__/boot.test.tsx
npm run typecheck -w @quiver/mobile
npm run prebuild -w @quiver/mobile -- --clean --no-install
npx expo-doctor@latest apps/mobile
```

Expected: boot test and typecheck pass; `ios/` and `android/` generate with the exact identifiers and no
Expo Doctor dependency error. CocoaPods is a separately-audited Mac mini prerequisite. Verify both
production and lab prebuilds keep `Quiver.xcodeproj`/`Quiver.xcscheme`, generated New Architecture on,
correct platform floors/permissions, and only the display name difference. Generated native directories
remain ignored and reproducible. Add the reviewed Skia install script to root npm `allowScripts` at the
exact locked version; do not enable arbitrary dependency scripts.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile package.json package-lock.json justfile .gitignore
git commit -m "feat(mobile): scaffold Expo native application"
```

### Task 2: Theme, adaptive library, and editor shell

**Files:**
- Create: `apps/mobile/src/theme/tokens.ts`
- Create: `apps/mobile/src/theme/ThemeProvider.tsx`
- Create: `apps/mobile/src/layout/useLayoutClass.ts`
- Create: `apps/mobile/src/library/LibraryScreen.tsx`
- Create: `apps/mobile/src/library/DocumentCard.tsx`
- Create: `apps/mobile/src/editor/EditorScreen.tsx`
- Create: `apps/mobile/src/editor/components/EditorAppBar.tsx`
- Create: `apps/mobile/src/editor/components/InspectorContainer.tsx`
- Create: `apps/mobile/src/editor/components/CreationControls.tsx`
- Create: `apps/mobile/app/editor/[id].tsx`
- Create: `apps/mobile/__tests__/adaptive-shell.test.tsx`
- Modify: `apps/mobile/app/index.tsx`

**Interfaces:**
- Consumes: root providers/router.
- Produces: `LayoutClass = "compact" | "regular"`, `useLayoutClass()`, adaptive library and editor regions with stable IDs.

- [ ] **Step 1: Write failing compact/regular layout tests**

Mock `useWindowDimensions` at 390x844 and 1366x1024. Compact must render `editor-bottom-sheet` and
`creation-fab`; regular must render `editor-side-inspector` and `creation-rail`. Both render
`editor-canvas-slot` and all app bar actions.

- [ ] **Step 2: Define semantic tokens and layout breakpoint**

Use an 720-dp width breakpoint. Tokens include canvas/background/surface/primary/selection/error colours,
4/8/12/16/24 spacing, 44/48 minimum targets selected by platform, and typography that respects font
scaling. Dark and light values must meet WCAG AA for application text.

- [ ] **Step 3: Build shell components with behavior-free slots**

The editor screen accepts `canvas`, `inspector`, app-bar action callbacks, and selection state. The phone
sheet has collapsed/half/full snap points; the tablet panel is 320 dp and becomes 380 dp above 1200 dp.
No document logic belongs in these components.

- [ ] **Step 4: Test and commit**

Run: `npm test -w @quiver/mobile -- --runInBand __tests__/adaptive-shell.test.tsx`  
Expected: both layout classes and target-size assertions pass.

```bash
git add apps/mobile/app apps/mobile/src/theme apps/mobile/src/layout apps/mobile/src/library apps/mobile/src/editor apps/mobile/__tests__/adaptive-shell.test.tsx
git commit -m "feat(mobile): add adaptive library and editor shell"
```

### Task 3: SQLite documents, trash, autosave, and recovery

**Files:**
- Create: `apps/mobile/src/persistence/schema.ts`
- Create: `apps/mobile/src/persistence/sqliteAdapter.ts`
- Create: `apps/mobile/src/persistence/DocumentRepository.ts`
- Create: `apps/mobile/src/persistence/RepositoryProvider.tsx`
- Create: `apps/mobile/src/persistence/documentStore.ts`
- Create: `apps/mobile/src/persistence/useDocuments.ts`
- Create: `apps/mobile/src/persistence/autosave.ts`
- Create: `apps/mobile/__tests__/persistence/sqliteAdapter.test.ts`
- Create: `apps/mobile/__tests__/persistence/repository.test.ts`
- Create: `apps/mobile/__tests__/persistence/autosave.test.ts`
- Modify: `apps/mobile/src/library/LibraryScreen.tsx`
- Modify: `apps/mobile/app/_layout.tsx`
- Modify: `apps/mobile/app/index.tsx`

**Interfaces:**
- Consumes: core native codec and `DiagramDocument`.
- Produces: `DocumentRepository` methods `initialize`, `list`, `read`, `create`, `save`, `rename`, `duplicate`, `trash`, `restore`, `purgeExpired`, `snapshot`; `createAutosaveController`.

Core Task 5 is a hard production dependency. Tests may inject a `NativeDocumentCodec`, but mobile must not
duplicate native JSON parsing or ship production wiring until core exports `encodeNativeDocument`,
`decodeNativeDocument`, and their final diagnostic/result types.

- [ ] **Step 1: Write failing repository and recovery tests**

Use an injected adapter backed in Jest by Node's built-in `node:sqlite` `DatabaseSync(":memory:")`; Expo's
server shim is a no-op and is not a database test double. Assert optimistic revision conflicts, CRUD order
by `updated_at DESC, id ASC`, NFC/case-insensitive unique duplicate titles (`Title copy`, then
`Title copy 2`), trash invisibility and restore, inclusive 30-day purge, denormalized counts, metadata-only
viewport save, last-open cleanup, explicit five-snapshot retention, corrupt latest-body fallback through
newest valid snapshot, typed unrecoverable corruption, post-commit notification, and complete rollback on
write/snapshot failure. Capture injected time once per operation.

- [ ] **Step 2: Implement the versioned WAL schema**

```sql
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  preview BLOB,
  viewport TEXT,
  vertex_count INTEGER NOT NULL,
  edge_count INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  trashed_at INTEGER
);
CREATE TABLE IF NOT EXISTS snapshots (
  document_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (document_id, revision)
);
CREATE TABLE IF NOT EXISTS app_state (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS documents_active_updated
  ON documents(trashed_at, updated_at DESC, id ASC);
PRAGMA user_version = 1;
```

Reject future schema versions. Set WAL outside a transaction. The production adapter wraps Expo 57
`withExclusiveTransactionAsync`, executes every transactional query through its callback `tx`, sets
`busy_timeout = 5000` on that connection before the first write, never nests transactions, and serializes
repository writes through a JS promise queue. Bind all values; only static DDL may use `execAsync`.
The injected `SqliteAdapter` exposes `exec`, `run`, `first`, `all`, and `transaction(work(tx))` with the same
contract in production and Jest.

Keep only the five highest snapshot revisions. `save` requires `expectedRevision`, validates/encodes before
opening the transaction, updates with `WHERE id = ? AND revision = ?`, and returns the new revision or a
typed conflict. `rename` changes the encoded document and metadata together; `duplicate` decodes, assigns a
new ID/title, re-encodes, and starts at revision zero. Snapshotting a save is atomic with it via
`snapshot: "before" | "after" | "none"`. `read` never overwrites a corrupt latest body: return typed
`current`, `recovered`, or `corrupt` results while scanning snapshots newest first. Explicitly delete
snapshots before purged documents and clear matching `last_open_document_id` app state in the same
transaction. Notify subscribers once only after commit. Database time, ID generation, and codec are
injected in tests.

- [ ] **Step 3: Implement autosave state machine**

`createAutosaveController({ delayMs: 350, save })` exposes `markDirty(document)`, async `flush()`,
`setForeground(active)`, `getSnapshot()`, `subscribe(listener)`, and `dispose()`, with
`saved | dirty | saving | failed`. Keep one save in flight and use generation numbers so stale completions
cannot mark newer data saved. Ordinary mutations coalesce to the newest document, but exact snapshot
boundary generations remain ordered. Make three total attempts: initial, then after 1 second and 4 seconds;
status is `failed` during backoff. A new mutation cancels retry timing and restarts its 350 ms debounce.
`flush()` cancels timers, awaits the in-flight save, drains the newest pending generation, and rejects if
that save fails. Backgrounding pauses retry timers but retains dirty state; an explicit background flush
still attempts once, and foregrounding resumes the remaining retry. Dispose cancels timers/listeners but
does not abort an in-flight transaction or silently discard dirty data. Treat only AppState `active` as
foreground, and do not leave/dispose a dirty editor unless flush succeeds or the UI retains the session and
shows “Not saved”. Test exact fake-timer boundaries, mutation during save, stale completion, flush failure,
foreground pause/resume, disposal, and snapshot barriers.

- [ ] **Step 4: Connect the library and verify**

Keep `LibraryScreen` presentational. Replace the placeholder provider in `_layout.tsx`, wire the repository
at `app/index.tsx`, and keep one stable repository/store instance in context. Implement the document list
store outside React and consume it with `useSyncExternalStore`; coalesce refreshes, discard stale async
responses, and map raw timestamps/counts into `LibraryDocumentSummary` only at the hook/route boundary.
Component tests inject the repository/store and never initialize Expo SQLite.

Run: `npm test -w @quiver/mobile -- --runInBand __tests__/persistence`  
Expected: real-SQL CRUD/revision/rollback/recovery, provider subscription isolation, and all autosave race/
fake-timer cases pass.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/app/_layout.tsx apps/mobile/app/index.tsx apps/mobile/src/persistence apps/mobile/src/library apps/mobile/__tests__/persistence
git commit -m "feat(mobile): persist and recover local diagrams"
```

### Task 4: Editor session store and selection transactions

**Files:**
- Create: `apps/mobile/src/editor/session.ts`
- Create: `apps/mobile/src/editor/EditorSessionProvider.tsx`
- Create: `apps/mobile/src/editor/useEditorSelector.ts`
- Create: `apps/mobile/__tests__/editor/session.test.ts`
- Modify: `apps/mobile/src/editor/EditorScreen.tsx`

**Interfaces:**
- Consumes: core history/commands, repository autosave.
- Produces: `EditorSessionState`, `EditorSessionActions`, `createEditorSession`, selectors for document, selection, viewport, inspector, history capability, and save status.

- [ ] **Step 1: Write failing state and subscription tests**

Assert select/extend/toggle/clear, cascade delete, undo/redo, transaction merging, viewport persistence without
history, dirty autosave after document commands only, and that a selector for vertex A is not notified by
a label update to unrelated vertex B. Assert the exact 25th committed document is queued as an atomic
`snapshot: "after"` save, and replace/import queues the exact prior body as `snapshot: "before"` with the
replacement; neither may snapshot an older debounced row. Viewport changes use a metadata-only save and do
not create a document revision or snapshot.

- [ ] **Step 2: Define the store contract**

```ts
export interface EditorSessionState {
  readonly history: HistoryState;
  readonly selectedIds: ReadonlySet<EntityId>;
  readonly viewport: Viewport;
  readonly insertionPoint: Point | null;
  readonly inspector: "closed" | "peek" | "open";
  readonly saveStatus: "saved" | "dirty" | "saving" | "failed";
}

export interface EditorSessionActions {
  dispatch(transaction: CommandTransaction): void;
  undo(): void;
  redo(): void;
  setSelection(ids: Iterable<EntityId>): void;
  setViewport(viewport: Viewport): void;
  setInsertionPoint(point: Point | null): void;
  setInspector(value: EditorSessionState["inspector"]): void;
}
```

- [ ] **Step 3: Implement vanilla Zustand store**

Keep actions outside state snapshots, use shallow/identity-aware selectors, freeze documents in development,
and expose transient gesture preview through a separate Reanimated controller rather than Zustand. Count
committed command transactions and send the exact boundary document through the serialized autosave queue
as an atomic `save(..., { snapshot: "after" })` every 25 transactions. Replacement/import atomically saves
the new document with `snapshot: "before"` for the prior body. Never call `snapshot(id)` independently at a
debounce boundary; viewport-only changes do not increment the counter and use metadata-only persistence.

- [ ] **Step 4: Verify and commit**

Run: `npm test -w @quiver/mobile -- --runInBand __tests__/editor/session.test.ts`  
Expected: state, history, autosave, and subscription isolation cases pass.

```bash
git add apps/mobile/src/editor apps/mobile/__tests__/editor/session.test.ts
git commit -m "feat(mobile): add transactional editor session"
```

### Task 5: Deterministic render scene and Skia canvas

**Files:**
- Create: `packages/renderer/package.json`
- Create: `packages/renderer/tsconfig.json`
- Create: `packages/renderer/src/scene/types.ts`
- Create: `packages/renderer/src/scene/buildScene.ts`
- Create: `packages/renderer/src/skia/DiagramCanvas.tsx`
- Create: `packages/renderer/src/skia/GridLayer.tsx`
- Create: `packages/renderer/src/skia/EdgeLayer.tsx`
- Create: `packages/renderer/src/skia/VertexLayer.tsx`
- Create: `packages/renderer/src/skia/OverlayLayer.tsx`
- Create: `packages/renderer/src/index.ts`
- Create: `packages/renderer/test/scene.test.ts`
- Create: `apps/mobile/src/editor/CanvasHost.tsx`
- Modify: root workspace/test configuration

**Interfaces:**
- Consumes: core document, arrow geometry, viewport, selection, measured label bounds.
- Produces: `RenderScene`, `buildScene(input): RenderScene`, `DiagramCanvas`, `CanvasHandle.snapshot(scale)`.

- [ ] **Step 1: Write failing deterministic scene tests**

For empty, pullback, loop, parallel-arrow, and higher-cell fixtures, snapshot the ordered primitives and
bounds. Assert order is grid, low-to-high edges, vertices, labels, ports, transient overlays; the same input
object produces deeply equal output.

- [ ] **Step 2: Define scene primitives**

```ts
export interface RenderScene {
  readonly documentBounds: Rect | null;
  readonly grid: GridPrimitive;
  readonly edges: readonly EdgePrimitive[];
  readonly vertices: readonly VertexPrimitive[];
  readonly labels: readonly LabelPrimitive[];
  readonly ports: readonly PortPrimitive[];
  readonly overlays: readonly OverlayPrimitive[];
}
```

Primitives contain data and path commands, not Skia objects. Scene construction memoizes by entity value,
label metrics key, and viewport scale bucket.

- [ ] **Step 3: Implement Skia layers and root transform**

One `Canvas` contains a root matrix derived from Reanimated shared viewport values. Grid spacing changes by
powers of two when projected base cells leave 24–96 px. Nodes and edges use expanded transparent hit
geometry only in core hit testing, never extra visible strokes. Add test IDs to the RN wrapper, not Skia
children.

- [ ] **Step 4: Verify scene and canvas component**

Run:

```bash
npm test -w @quiver/renderer
npm test -w @quiver/mobile -- --runInBand --testPathPattern=CanvasHost
```

Expected: scene goldens pass and CanvasHost renders empty/loading/failure states without a native crash.

- [ ] **Step 5: Commit**

```bash
git add packages/renderer apps/mobile/src/editor/CanvasHost.tsx package.json package-lock.json vitest.workspace.ts
git commit -m "feat(renderer): draw deterministic native diagram canvas"
```

### Task 6: Offline math worker and Skia SVG cache

**Files:**
- Create: `packages/renderer/src/math/protocol.ts`
- Create: `packages/renderer/src/math/sanitizeSvg.ts`
- Create: `packages/renderer/src/math/MathCache.ts`
- Create: `packages/renderer/test/math/protocol.test.ts`
- Create: `packages/renderer/test/math/sanitizeSvg.test.ts`
- Create: `apps/mobile/src/editor/math/MathWorker.tsx`
- Create: `apps/mobile/src/editor/math/MathWorkerProvider.tsx`
- Create: `apps/mobile/scripts/build-math-assets.mjs`
- Create: `apps/mobile/assets/math/worker.html`
- Modify: `apps/mobile/package.json`
- Modify: `packages/renderer/src/skia/DiagramCanvas.tsx`

**Interfaces:**
- Consumes: raw label, parsed macros, colour, scale bucket.
- Produces: version-one worker messages, `MathLabelMetrics`, sanitized SVG, bounded LRU `MathCache`, `renderLabels(requests): Promise<results>`.

- [ ] **Step 1: Write failing protocol/sanitizer/cache tests**

Assert request IDs correlate out-of-order batches, timeout after 2 seconds, maximum batch 100, SVG rejects
scripts/events/external URLs/foreignObject, only local path/group/text/style attributes remain, cache key
includes source/macros/colour/scale, and LRU evicts above 32 MB estimated bytes.

- [ ] **Step 2: Define the versioned bridge**

```ts
export type MathWorkerRequest = {
  readonly version: 1;
  readonly type: "render";
  readonly requestId: string;
  readonly labels: readonly { key: string; source: string; macros: MacroMap; colour: string }[];
};

export type MathWorkerResponse = {
  readonly version: 1;
  readonly type: "render-result";
  readonly requestId: string;
  readonly results: readonly { key: string; svg?: string; width: number; height: number; error?: string }[];
};
```

- [ ] **Step 3: Bundle and isolate MathJax**

The build script copies the pinned browser SVG component into `assets/math` and hashes inputs so reruns are
idempotent. `worker.html` sets a restrictive CSP (`default-src 'none'; script-src 'self'; style-src
'unsafe-inline'; img-src data:`), never navigates, disables links, batches `MathJax.tex2svgPromise`, and
posts only protocol responses. The RN WebView sets `originWhitelist={[]}`, disables storage, windows,
media, and navigation, and is 1x1/offscreen with accessibility hidden.

- [ ] **Step 4: Integrate fallback and cache**

Until metrics arrive or on error, `DiagramCanvas` renders source text with a system math-capable font and
conservative bounds. Successful sanitized SVG replaces it from cache. A failed key is negatively cached
for the session and returns one diagnostic.

- [ ] **Step 5: Verify offline behavior and commit**

Run: `npm run build:math -w @quiver/mobile && npm test -w @quiver/renderer && npm test -w @quiver/mobile -- --runInBand --testPathPattern=MathWorker`  
Expected: no network fixture is needed; protocol, sanitizer, timeout, cache, and fallback cases pass.

```bash
git add packages/renderer apps/mobile/src/editor/math apps/mobile/scripts apps/mobile/assets/math apps/mobile/package.json package-lock.json
git commit -m "feat(renderer): render offline math labels"
```

### Task 7: Multitouch viewport and direct manipulation state machine

**Files:**
- Create: `apps/mobile/src/editor/gestures/types.ts`
- Create: `apps/mobile/src/editor/gestures/coordinator.ts`
- Create: `apps/mobile/src/editor/gestures/useCanvasGestures.ts`
- Create: `apps/mobile/src/editor/gestures/snapping.ts`
- Create: `apps/mobile/src/editor/gestures/GestureOverlay.tsx`
- Create: `apps/mobile/__tests__/gestures/coordinator.test.ts`
- Create: `apps/mobile/__tests__/gestures/snapping.test.ts`
- Modify: `apps/mobile/src/editor/CanvasHost.tsx`

**Interfaces:**
- Consumes: hit tester, editor session actions, Reanimated shared viewport/preview values, platform haptics.
- Produces: `GestureCoordinator`, `useCanvasGestures(input)`, `SnapResult`, transient preview values.

- [ ] **Step 1: Write failing event-sequence tests**

Feed platform-independent contact events and assert: single tap selection; double tap create; body drag move;
port drag connect; lasso; two-finger pan; focal-point pinch; second contact cancels uncommitted one-finger
work with no viewport jump; stylus manipulation plus finger navigation; system cancel reverts preview; one
transaction and at most one haptic on release.

- [ ] **Step 2: Define explicit coordinator states**

```ts
export type InteractionState =
  | { readonly type: "idle" }
  | { readonly type: "pending-tap"; readonly contact: Contact; readonly hit: HitResult | null }
  | { readonly type: "dragging-selection"; readonly origin: Point; readonly ids: readonly EntityId[] }
  | { readonly type: "connecting"; readonly sourceId: EntityId; readonly endpoint: "source" | "target" | "new" }
  | { readonly type: "lasso"; readonly origin: Point }
  | { readonly type: "viewport"; readonly contacts: readonly Contact[]; readonly baseline: Viewport };
```

Events are `down`, `move`, `up`, `cancel`, and `timeout`; outputs are preview operations, haptic intents,
and optional final transactions. The pure coordinator never imports Gesture Handler.

- [ ] **Step 3: Implement UI-thread recognizers and arbitration**

Use Gesture Handler 2.32's declarative API: simultaneous `Gesture.Pan()` + `Gesture.Pinch()` for two
contacts, `Gesture.Exclusive`/`Gesture.Race` for tap/double-tap/long-press and one-contact pan, and a manual
gesture for activation based on hit/port. Rebase focal translation when contact count changes.
Clamp 0.18x–4x with rubber-band preview and Reanimated spring back. Call JS only for final transaction,
selection, context menu, and accessibility announcement.

- [ ] **Step 4: Implement snapping**

Grid snap rounds document positions; alignment snap queries nearby vertices within 8 screen pixels after
viewport conversion. The result includes guides and `changedCandidate` so haptics fire once per candidate.
Pointer secondary modifier bypasses snapping.

- [ ] **Step 5: Verify and commit**

Run: `npm test -w @quiver/mobile -- --runInBand __tests__/gestures`  
Expected: all deterministic event sequences, focal-point invariants, and haptic limits pass.

```bash
git add apps/mobile/src/editor/gestures apps/mobile/src/editor/CanvasHost.tsx apps/mobile/__tests__/gestures
git commit -m "feat(mobile): add native multitouch editor gestures"
```

### Task 8: Editing flows and contextual inspector

**Files:**
- Create: `apps/mobile/src/editor/actions/editorActions.ts`
- Create: `apps/mobile/src/editor/components/LabelEditor.tsx`
- Create: `apps/mobile/src/editor/components/SelectionInspector.tsx`
- Create: `apps/mobile/src/editor/components/EdgeStyleInspector.tsx`
- Create: `apps/mobile/src/editor/components/ColourControl.tsx`
- Create: `apps/mobile/src/editor/components/ContextActions.tsx`
- Create: `apps/mobile/src/editor/components/MacrosSheet.tsx`
- Create: `apps/mobile/src/platform/fetchMacroSource.ts`
- Create: `apps/mobile/__tests__/editor/editing-flows.test.tsx`
- Create: `apps/mobile/__tests__/editor/inspector.test.tsx`
- Create: `apps/mobile/__tests__/editor/macros.test.tsx`
- Modify: `apps/mobile/src/editor/EditorScreen.tsx`

**Interfaces:**
- Consumes: editor session, core commands/defaults, gesture outputs.
- Produces: create/move/connect/reconnect/duplicate/delete/transform actions and inspector controls with merged transactions.

- [ ] **Step 1: Write failing editing-flow tests**

Cover double-tap vertex creation and focused label input, drag empty-to-empty creating two vertices and an
edge, connect existing entities, reconnect source/target, loop creation, edge-to-edge higher cell, cascade
delete, duplicate selection, copy/cut/paste with transitive dependencies and collision-free offset,
horizontal/vertical flip, rotate, fit-to-content, reset view, multi-selection mixed inspector values,
continuous slider merge, undo/redo, and maximum-level rejection.

- [ ] **Step 2: Implement action factories**

Action functions accept a document plus explicit IDs/points/options and return a `CommandTransaction` or
typed action diagnostic. Entity IDs come from the injected session ID factory. Empty-to-empty connection
uses one atomic `add-entities` command so undo removes all three entities.
Copy uses `encodeQuiverSelection`; cut copies before a cascade delete; paste probes successive diagonal grid
offsets until no vertex collides and selects the newly inserted IDs. Diagram transforms affect vertices in
one transaction. Fit/reset change viewport only and never enter history.

- [ ] **Step 3: Build native inspectors**

The label input preserves raw math source and submits on blur/Enter. Selection inspector computes shared
values; mixed values use an accessible `Mixed` state. Edge controls expose visual style buttons, labelled
sliders with exact values, alignment segmented control, colour presets/custom HSLA, and level readout.
Slider `onChange` previews and `onSlidingComplete` commits one merge-keyed transaction.

- [ ] **Step 4: Add explicit macro editing and user-initiated HTTPS import**

The macros sheet edits local source, shows parser diagnostics by line/column, and commits valid definitions
as one document transaction. “Import from URL” accepts HTTPS only, performs one foreground fetch after the
tap, follows at most three HTTPS redirects, caps response headers/body at 1 MB, times out after 10 seconds,
never sends credentials/referrer, previews changes, and requires confirmation before replacing macros.
Tests cover offline failure, timeout, redirect downgrade, oversize body, invalid definitions, cancellation,
and successful colour/macro preview.

- [ ] **Step 5: Verify and commit**

Run: `npm test -w @quiver/mobile -- --runInBand __tests__/editor/editing-flows.test.tsx __tests__/editor/inspector.test.tsx __tests__/editor/macros.test.tsx`  
Expected: every included edit is transactional, undoable, and accessible by label.

```bash
git add apps/mobile/src/editor apps/mobile/__tests__/editor
git commit -m "feat(mobile): complete native diagram editing flows"
```

### Task 9: Import, export, files, clipboard, and sharing

**Files:**
- Create: `apps/mobile/src/platform/clipboard.ts`
- Create: `apps/mobile/src/platform/documents.ts`
- Create: `apps/mobile/src/platform/share.ts`
- Create: `apps/mobile/src/editor/components/ImportSheet.tsx`
- Create: `apps/mobile/src/editor/components/ExportSheet.tsx`
- Create: `packages/renderer/src/export/svg.ts`
- Create: `apps/mobile/__tests__/platform/import-export.test.tsx`
- Modify: `apps/mobile/src/library/LibraryScreen.tsx`
- Modify: `apps/mobile/src/editor/EditorScreen.tsx`

**Interfaces:**
- Consumes: core codecs/text exporters, renderer snapshot/SVG export, Expo platform modules.
- Produces: user-driven import and Quiver URL/TikZ/standalone LaTeX/Typst/PNG/SVG/native JSON export.

- [ ] **Step 1: Write failing adapter and UI tests**

Mock platform modules and test import from URL/payload/clipboard/file, MIME/extension selection, 5 MB limit,
diagnostic sheet, export format copy/share/save, PNG scale 1x/2x/3x, SVG math fragments, and cancellation
without state mutation.

- [ ] **Step 2: Implement narrow platform adapters**

Each adapter receives its Expo implementation as a dependency in tests and returns discriminated success,
cancel, or error. Clipboard reads happen only inside the paste action. File picker accepts plain text,
`.json`, `.quiver.json`, and `.tex`; unsupported content returns a diagnostic and remains unopened. Text
detection tries a Quiver URL/payload, native JSON, then `importTikz` only when a TikZ-CD environment is
present; it never guesses Typst import because the upstream product does not define that round trip.

- [ ] **Step 3: Build import/export sheets**

Import previews title/entity counts/diagnostics before replacement or new-document creation. Export defaults
to Quiver URL for Share, remembers the last textual format per device, displays compatibility warnings,
and never embeds local-only metadata into a web URL.

- [ ] **Step 4: Verify and commit**

Run: `npm test -w @quiver/mobile -- --runInBand __tests__/platform/import-export.test.tsx && npm test -w @quiver/renderer -- test/export`  
Expected: all formats and cancel/error paths pass without network access.

```bash
git add apps/mobile/src/platform apps/mobile/src/editor apps/mobile/src/library apps/mobile/__tests__/platform packages/renderer/src/export packages/renderer/test/export
git commit -m "feat(mobile): import and share native diagrams"
```

### Task 10: Accessibility and hardware input

**Files:**
- Create: `apps/mobile/src/accessibility/CanvasAccessibilityTree.tsx`
- Create: `apps/mobile/src/accessibility/descriptions.ts`
- Create: `apps/mobile/src/accessibility/actions.ts`
- Create: `apps/mobile/src/editor/keyboard/shortcuts.ts`
- Create: `apps/mobile/src/editor/keyboard/useEditorKeyboard.ts`
- Create: `apps/mobile/__tests__/accessibility/canvas.test.tsx`
- Create: `apps/mobile/__tests__/keyboard/shortcuts.test.ts`
- Modify: `apps/mobile/src/editor/CanvasHost.tsx`

**Interfaces:**
- Consumes: visible scene bounds, selected entities, editor action factories.
- Produces: accessible overlays/actions and normalized keyboard shortcuts.

- [ ] **Step 1: Write failing semantic and shortcut tests**

Assert vertex announces label/grid/selection, edge announces label/source/target/level/style, offscreen
unselected items are excluded, selected offscreen items remain reachable, actions edit/connect/move/delete,
and focus ring tracks accessibility focus. Cover Command/Ctrl-Z, redo variants, copy/paste, delete,
Escape, arrows, Space, Enter, Tab, plus system-conflict exclusions.

- [ ] **Step 2: Implement bounded semantic overlay**

Overlay transparent RN views at visible entity bounds with minimum target sizes and the same root viewport
transform. At most 250 unselected visible elements are exposed; selected elements are always exposed.
Actions dispatch the same action factories as touch. Reduce Motion is read from `AccessibilityInfo` and
passed to animation helpers.

- [ ] **Step 3: Implement keyboard normalization**

Map platform key/modifier events to semantic commands. Text inputs consume printable keys and standard
editing combinations; Escape/submit pass through intentionally. Canvas focus navigation uses grid positions
and never traps Tab.

- [ ] **Step 4: Verify and commit**

Run: `npm test -w @quiver/mobile -- --runInBand __tests__/accessibility __tests__/keyboard`  
Expected: semantic actions, announcements, target sizes, focus behavior, and shortcuts pass.

```bash
git add apps/mobile/src/accessibility apps/mobile/src/editor/keyboard apps/mobile/src/editor/CanvasHost.tsx apps/mobile/__tests__/accessibility apps/mobile/__tests__/keyboard
git commit -m "feat(mobile): make canvas accessible and keyboard complete"
```

### Task 11: Recovery boundary, local logs, samples, and app gate

**Files:**
- Create: `apps/mobile/src/platform/LocalLog.ts`
- Create: `apps/mobile/src/editor/EditorErrorBoundary.tsx`
- Create: `apps/mobile/src/library/sampleDocuments.ts`
- Create: `apps/mobile/__tests__/integration/product-flow.test.tsx`
- Create: `apps/mobile/README.md`
- Modify: `apps/mobile/src/editor/EditorScreen.tsx`
- Modify: `apps/mobile/src/library/LibraryScreen.tsx`
- Modify: `justfile`

**Interfaces:**
- Consumes: complete app features.
- Produces: three duplicable samples, rotating redacted local log, recover/export error boundary, repeatable app quality gate.

- [ ] **Step 1: Write failing recovery and product-flow tests**

Assert renderer invariant error shows recover/export/library actions, logs code/stack/app version but not
labels or payloads, log rotation at 256 KB with three files, first launch seeds Pullback/Adjunction/Higher
Cell samples once, and the standard product flow survives background/relaunch with document equality.

- [ ] **Step 2: Implement safe recovery and samples**

The error boundary retains the last valid encoded document in memory, offers native JSON export, and only
returns to the library after explicit action. Samples decode committed upstream fixtures and receive fresh
document IDs only when duplicated.

- [ ] **Step 3: Run the complete app gate twice**

Run:

```bash
npm run lint -w @quiver/mobile
npm run typecheck -w @quiver/mobile
npm test -w @quiver/mobile -- --runInBand
npm test -w @quiver/renderer
npx expo-doctor@latest apps/mobile
npx expo export --platform all --output-dir /tmp/quiver-native-export
```

Expected: all checks pass twice, the export contains iOS/Android bundles, and `git status --short` reports
no generated tracked changes.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src apps/mobile/__tests__ apps/mobile/README.md justfile
git commit -m "test(mobile): verify complete offline product flow"
```
