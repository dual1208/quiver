# Quiver Native Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a strict, platform-neutral TypeScript core that can model, mutate, validate, import, and export Quiver diagrams without React Native dependencies.

**Architecture:** `@quiver/core` owns immutable document values, reversible commands, geometry, compatibility codecs, migrations, macros, and text exporters. Public imports go through `packages/core/src/index.ts`; tests use upstream examples as compatibility fixtures and never instantiate DOM types.

**Tech Stack:** Node.js 22.13+, npm workspaces, TypeScript 5.9 strict mode, Vitest 4, fast-check 4, Zod 4, `uuid`-compatible IDs supplied by an injected factory.

## Global Constraints

- The package must contain no `react`, `react-native`, Expo, DOM, filesystem, or network imports.
- Existing Quiver version-zero base64 payloads and `https://q.uiver.app/#q=` links remain compatible.
- Higher-cell dependencies are acyclic and capped at level four.
- Public functions return values or typed diagnostics; they never display UI or silently log.
- Inputs are capped before parsing: 5 MB documents, 50,000 entities, 64 dependency depth.
- All floating-point public results are finite; comparisons use the exported `EPSILON = 1e-6`.
- Tests are deterministic: no wall clock, locale, random UUID, or network dependency.

---

## Locked file map

```text
package.json                         workspace scripts and pinned toolchain
package-lock.json                    reproducible dependency graph
tsconfig.base.json                   strict shared compiler settings
vitest.workspace.ts                 workspace test projects
justfile                             thin human-facing CI recipes
packages/core/package.json           package exports and scripts
packages/core/tsconfig.json          core build configuration
packages/core/src/model/types.ts     document/entity/style value types
packages/core/src/model/defaults.ts  canonical default values
packages/core/src/model/validate.ts  structural and graph invariants
packages/core/src/model/ids.ts       injected ID factory and deterministic test IDs
packages/core/src/commands/types.ts  command and transaction contracts
packages/core/src/commands/basic.ts  create/update/delete/move commands
packages/core/src/commands/history.ts bounded undo/redo transaction history
packages/core/src/codec/base64.ts    byte-safe UTF-8 base64 primitives
packages/core/src/codec/quiver.ts    Quiver v0 array import/export and URL parsing
packages/core/src/codec/native.ts    versioned readable native JSON and migrations
packages/core/src/geometry/point.ts  vector and viewport primitives
packages/core/src/geometry/curve.ts  Bézier/arc evaluation and intersection
packages/core/src/geometry/arrow.ts  arrow path and hit geometry
packages/core/src/macros/parser.ts   bounded macro/colour definition parser
packages/core/src/import/tikz.ts     bounded TikZ-CD parser and diagnostics
packages/core/src/export/tikz.ts     TikZ-CD and standalone LaTeX exporter
packages/core/src/export/typst.ts    Fletcher/Typst exporter
packages/core/src/index.ts           only public package surface
packages/core/test/**                focused unit/property/golden tests
packages/test-fixtures/upstream/**   committed upstream compatibility fixtures
legacy-web/**                        original DOM application retained as a reference harness
```

### Task 1: Workspace and core test harness

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `vitest.workspace.ts`
- Create: `justfile`
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/src/index.ts`
- Create: `packages/core/test/smoke.test.ts`
- Rename: `src/` to `legacy-web/`
- Modify: `.gitignore`
- Modify: `Makefile`

**Interfaces:**
- Consumes: none.
- Produces: npm workspace `@quiver/core`; commands `npm run fmt`, `lint`, `typecheck`, `test`, `ci`; equivalent `just` recipes.

- [ ] **Step 1: Add the failing package smoke test**

```ts
import { describe, expect, it } from "vitest";
import { CORE_SCHEMA_VERSION } from "../src/index";

describe("@quiver/core", () => {
  it("exports schema version one", () => expect(CORE_SCHEMA_VERSION).toBe(1));
});
```

- [ ] **Step 2: Create the workspace manifests and strict compiler configuration**

Root scripts must run Prettier, ESLint, `tsc -b`, and Vitest without invoking nested shell logic. Use npm workspaces `apps/*` and `packages/*`, `engines.node: ">=22.13"`, and set `packageManager` to the exact npm version reported by `npm --version`. `tsconfig.base.json` must enable `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `useUnknownInCatchVariables`, and `verbatimModuleSyntax`.

Move the original DOM application from `src/` to `legacy-web/` with `git mv`. Update legacy Makefile paths
so `make legacy-serve` can still host it for fixture comparison, but make the default `make` target print
the `just`/npm entry points. No mobile bundle or workspace package imports from `legacy-web/`.

`packages/core/src/index.ts` begins with:

```ts
export const CORE_SCHEMA_VERSION = 1 as const;
```

- [ ] **Step 3: Add thin `just` recipes**

```just
set shell := ["bash", "-euo", "pipefail", "-c"]

bootstrap:
    npm ci

fmt:
    npm run fmt

lint:
    npm run lint

typecheck:
    npm run typecheck

test:
    npm test

check: fmt lint typecheck test

ci: check
```

- [ ] **Step 4: Verify the harness**

Run: `npm install && just ci`  
Expected: one passing smoke test, zero ESLint/TypeScript/Prettier errors.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json tsconfig.base.json vitest.workspace.ts justfile .gitignore Makefile legacy-web packages/core
git commit -m "build: establish Quiver Native workspace"
```

### Task 2: Canonical model and validation

**Files:**
- Create: `packages/core/src/model/types.ts`
- Create: `packages/core/src/model/defaults.ts`
- Create: `packages/core/src/model/ids.ts`
- Create: `packages/core/src/model/validate.ts`
- Create: `packages/core/test/model/validate.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `CORE_SCHEMA_VERSION`.
- Produces: `DiagramDocument`, `DiagramEntity`, `Vertex`, `Edge`, `EdgeOptions`, `Hsla`, `ValidationDiagnostic`, `validateDocument(document): readonly ValidationDiagnostic[]`, `assertValidDocument(document): DiagramDocument`, `entityLevel(document, id): number`.

- [ ] **Step 1: Write failing invariant tests**

Cover a valid two-vertex/one-edge document, duplicate vertex positions, a missing endpoint, a higher-cell dependency cycle, an edge above level four, invalid HSLA ranges, and non-finite numeric input. The missing endpoint assertion is:

```ts
expect(validateDocument({ ...valid, edges: [{ ...edge, targetId: "missing" }] }))
  .toContainEqual(expect.objectContaining({ code: "missing-endpoint", entityId: edge.id }));
```

- [ ] **Step 2: Define readonly discriminated types**

```ts
export type EntityId = string & { readonly __entityId: unique symbol };
export type Hsla = readonly [h: number, s: number, l: number, a: number];
export type LabelAlignment = "left" | "centre" | "right" | "over";
export type ArrowShape = "bezier" | "arc";
export interface GridPoint { readonly x: number; readonly y: number }

export interface Vertex {
  readonly kind: "vertex";
  readonly id: EntityId;
  readonly x: number;
  readonly y: number;
  readonly label: string;
  readonly labelColour: Hsla;
}

export interface EdgeStylePart {
  readonly name: string;
  readonly side?: "top" | "bottom";
}

export interface EdgeOptions {
  readonly labelAlignment: LabelAlignment;
  readonly labelPosition: number;
  readonly offset: number;
  readonly curve: number;
  readonly radius: number;
  readonly angle: number;
  readonly shorten: Readonly<{ source: number; target: number }>;
  readonly colour: Hsla;
  readonly shape: ArrowShape;
  readonly style: Readonly<{ tail: EdgeStylePart; body: EdgeStylePart; head: EdgeStylePart }>;
}

export interface Edge {
  readonly kind: "edge";
  readonly id: EntityId;
  readonly sourceId: EntityId;
  readonly targetId: EntityId;
  readonly label: string;
  readonly labelColour: Hsla;
  readonly options: EdgeOptions;
}

export interface DiagramDocument {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly title: string;
  readonly vertices: readonly Vertex[];
  readonly edges: readonly Edge[];
  readonly macros: string;
  readonly preferredRenderer: "katex" | "typst";
}
```

- [ ] **Step 3: Implement canonical defaults and validation**

Use black `[0, 0, 0, 1]`, left alignment, position 50, zero offset/curve, radius 0, angle 0, zero shortening, Bézier shape, and normal arrow tail/body/head as the canonical edge defaults. Validation walks dependencies with white/grey/black DFS marks and emits stable diagnostics sorted by entity order.

- [ ] **Step 4: Run focused and property checks**

Run: `npm test -w @quiver/core -- test/model/validate.test.ts`  
Expected: all invariant cases pass and input objects remain deeply equal to a pre-call clone.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/model packages/core/src/index.ts packages/core/test/model
git commit -m "feat(core): define validated diagram model"
```

### Task 3: Reversible commands and bounded history

**Files:**
- Create: `packages/core/src/commands/types.ts`
- Create: `packages/core/src/commands/basic.ts`
- Create: `packages/core/src/commands/history.ts`
- Create: `packages/core/test/commands/history.test.ts`
- Create: `packages/core/test/commands/properties.test.ts`
- Modify: `packages/core/src/index.ts`
- Modify: root `package.json`
- Modify: root `package-lock.json`

**Interfaces:**
- Consumes: validated `DiagramDocument` and entity types.
- Produces: `DocumentCommand`, `CommandTransaction`, `CommandError`, `createRemoveEntitiesCommand`,
  `applyCommand`, `invertCommand`, `HistoryState`, `createHistory(document, limit?)`,
  `commitTransaction`, `undo`, `redo`.

- [ ] **Step 1: Write failing example and property tests**

Install exact root dev dependency `fast-check@4.9.0` after the mobile workspace lockfile is integrated.
Generate valid documents constructively with fixed seeds (no filtered invalid cases). For every supported
command `c`, run at least 500 cases and assert:

```ts
const changed = applyCommand(document, c);
expect(applyCommand(changed, invertCommand(document, c))).toEqual(document);
```

Also assert new commits clear redo, consecutive `update-label` commands with the same `mergeKey` merge,
and the 201st transaction evicts the oldest at the default limit of 200.

- [ ] **Step 2: Define command unions with complete inverse data**

```ts
export type DocumentCommand =
  | { readonly type: "add-entities"; readonly vertices: readonly Vertex[]; readonly edges: readonly Edge[] }
  | { readonly type: "remove-entities"; readonly ids: readonly EntityId[]; readonly removed: readonly DiagramEntity[] }
  | { readonly type: "move-vertices"; readonly moves: readonly { id: EntityId; from: GridPoint; to: GridPoint }[] }
  | { readonly type: "update-entity"; readonly id: EntityId; readonly before: DiagramEntity; readonly after: DiagramEntity }
  | { readonly type: "replace-document"; readonly before: DiagramDocument; readonly after: DiagramDocument };

export interface CommandTransaction {
  readonly commands: readonly DocumentCommand[];
  readonly mergeKey?: string;
}
```

- [ ] **Step 3: Implement pure application, inversion, cascade deletion, and history**

Removing a vertex also removes every transitive dependent edge and records them in document order.
`createRemoveEntitiesCommand(document, ids)` is the one public cascade producer. Because the locked
`remove-entities` payload does not carry original array indices, `invertCommand(document, removeCommand)`
returns an exact `replace-document` inverse from the changed document back to `document`; it never guesses
insertion order. History entries retain precomputed forward and inverse transactions. Undo/redo are merge
barriers so a new same-key edit cannot merge across a timeline change.
Applying a command validates its preconditions and throws `CommandError` with codes `entity-exists`,
`entity-missing`, `position-occupied`, or `invalid-result`. History functions return new values and never
mutate prior documents or stacks.

- [ ] **Step 4: Run tests and mutation guard**

Run: `npm test -w @quiver/core -- test/commands`  
Expected: example/property tests pass for at least 500 generated cases.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/commands packages/core/src/index.ts packages/core/test/commands
git commit -m "feat(core): add reversible editor commands"
```

### Task 4: Quiver v0 codec and URL compatibility

**Files:**
- Create: `packages/core/src/codec/base64.ts`
- Create: `packages/core/src/codec/quiver.ts`
- Create: `packages/core/test/codec/quiver.test.ts`
- Create: `packages/test-fixtures/upstream/pullback.json`
- Create: `packages/test-fixtures/upstream/adjunction.json`
- Create: `packages/test-fixtures/upstream/higher-cell.json`
- Create: `packages/test-fixtures/upstream/styles.json`
- Modify: `packages/core/src/model/types.ts`
- Modify: `packages/core/src/model/defaults.ts`
- Modify: `packages/core/src/model/validate.ts`
- Modify: `packages/core/test/model/validate.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: model defaults, `assertValidDocument`, injected `IdFactory`.
- Produces: `decodeQuiverPayload(payload, options): DecodeResult`, `encodeQuiverPayload(document): string`,
  `encodeQuiverSelection(document, ids): EncodedQuiverSelection`, `parseQuiverUrl(text): QuiverLink`,
  `formatQuiverUrl(document, options): string`.

- [ ] **Step 1: Extract and lock upstream fixtures**

Copy the exact encoded payloads from the four README links into fixture JSON alongside the source URL,
expected vertex/edge counts, and selected labels. The fixtures are `pullback` (5 vertices/8 edges),
`adjunction` (2/3), `higher-cell` (4/11), and `styles` (16/9); do not regenerate their payloads from decoded
JSON. Tests must decode all four and re-encode to a semantically equal document.

- [ ] **Step 2: Write failing UTF-8, legacy, and malformed-input tests**

Cover `\\alpha`, emoji, Japanese text, unpadded base64, a raw `+` in a URL payload, query-over-fragment
precedence, current inline `macros` precedence over `macro_url`, a payload containing legacy `length`, a
payload containing `style.body.level`, explicit visual level precedence, special style names, endpoint
alignment, truncated arrays, forward/self/invalid indices, duplicate positions, safe-integer overflow,
prototype-shaped keys, invalid UTF-8, input over 5 MB, and nesting over 64. Assert diagnostics contain a
stable code and original wire cell index.

- [ ] **Step 3: Implement byte-safe base64 and URL parsing**

Implement byte-to-base64 and base64-to-byte loops inside core using the standard alphabet; do not rely on
Node `Buffer`, spread a multi-megabyte byte array into `String.fromCharCode`, or require ambient
`btoa`/`atob` globals. Encode/decode JSON with `TextEncoder` and
`TextDecoder("utf-8", { fatal: true })`. Pre-scan JSON text for nesting depth before `JSON.parse`, then
extract known keys into null-prototype option records using `Object.hasOwn`. Parse `q` from raw query and
fragment text so `+` is never converted to space; fragment parameters are read first and query parameters
override duplicates. Accept padded or valid unpadded standard base64.

- [ ] **Step 4: Implement exact v0 array defaults and migrations**

The exact wire grammar is `[0, vertexCount, ...vertices, ...edges]`, with vertices
`[x, y, label?, labelColour?]` and edges
`[sourceIndex, targetIndex, label?, alignment?, options?, labelColour?]`. Combined-array endpoint indices
must reference earlier wire cells. Vertices are emitted first in stored order; edges follow in ascending
derived structural level and stored order. Positions are translated so the minimum included vertex
coordinate is `(0,0)`. Trailing default array members are omitted exactly as upstream; blank-label
alignment and label colour are semantically irrelevant and omitted.

First extend the canonical edge model so the fixtures round-trip without loss: Quiver's wire defaults use
`radius: 3`, `edgeAlignment: { source: true, target: true }`, and outer `style.name: "arrow"`. Preserve a
nullable explicit visual `level` override separately from the structurally derived dependency level, and
preserve special outer style names including `adjunction`, `corner`, and `corner-inverse`. Validation must
bound visual levels and validate endpoint alignment/style records without conflating them with graph
level. Import precedence is explicit `options.level`, then legacy `style.body.level`, then the derived
structural level. Import validates and converts legacy `length` to symmetric `shorten` only when explicit
`shorten` is absent. Encoding computes its option delta against the edge's derived wire defaults, never
emits `shape`, omits radius/angle for Bézier and curve for arc, and never mutates the document.

Because `shape` is not representable on the wire, canonical export requires self-loops to be arcs and
non-loops to be Béziers. Before emitting, enforce every upstream wire domain even when the general native
model is more expressive: label position is a safe integer in `[0,100]`; integer wire geometry values are
safe integers; shortening and opaque HSLA components use accepted ranges/precision. A successful encoder
call must decode with no diagnostics and must never manufacture a payload upstream will skip. Preserve an
odd legacy `length` migration through a valid compatible representation or reject it explicitly rather
than emitting fractional `shorten` values that upstream rejects.
Apply the decoder envelope to every included full/selection closure before returning: at most 50,000 wire
cells and at most 5 MiB of UTF-8 JSON. Encode the JSON to bytes once, enforce the inclusive byte boundary,
then base64 those exact bytes; one-over-limit returns a typed `DocumentValidationError` without mutation.

`encodeQuiverSelection` includes the transitive endpoint closure and returns
`{ payload, selectedWireIndices }`, because v0 has no selection marker and a payload alone cannot
distinguish originally selected cells from included dependencies. Decoder results retain a stable
wire-index-to-created-ID mapping so callers can recover that selection. An explicit decode origin is added
only to vertex coordinates; collision probing remains a caller decision. Malformed skipped cells retain
their wire slots so later indices can never be silently redirected.

- [ ] **Step 5: Verify compatibility**

Run: `npm test -w @quiver/core -- test/codec/quiver.test.ts`  
Expected: all upstream fixtures decode, encode, and re-decode with semantic equality; empty documents
format as the bare canonical `https://q.uiver.app/` URL; malformed cases return typed diagnostics without
mutation or code execution. Formatting uses `https://q.uiver.app/#q=...`, omits the default KaTeX renderer,
and preserves `r=typst`/encoded inline `macros` or nonblank `macro_url` metadata without fetching it.
Inline definitions win when both sources are supplied, matching current upstream Quiver.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/codec packages/core/src/model packages/core/src/index.ts packages/core/test/model packages/core/test/codec packages/test-fixtures/upstream
git commit -m "feat(core): preserve Quiver link compatibility"
```

### Task 5: Native JSON schema and migrations

**Files:**
- Create: `packages/core/src/codec/native.ts`
- Create: `packages/core/src/codec/types.ts`
- Create: `packages/core/test/codec/native.test.ts`
- Create: `packages/test-fixtures/documents/native-schema-0.quiver.json`
- Create: `packages/test-fixtures/documents/native-schema-1.quiver.json`
- Modify: `packages/core/package.json`
- Modify: `package-lock.json`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `DiagramDocument`, `CORE_SCHEMA_VERSION`, model validation.
- Produces: `NATIVE_MEDIA_TYPE = "application/vnd.quiver.native+json"`, the `.quiver.json` extension,
  `encodeNativeDocument(document): string`, and `decodeNativeDocument(text): DecodeResult`.

Move Task 4's public `QuiverDiagnostic` and discriminated `DecodeResult` definitions to the neutral
`codec/types.ts` module without changing their names or shape. Native decode uses that exact result,
returns `wireIndexToId: []` on both branches, and omits `wireCellIndex` from native diagnostics. Keep the
schema migration function internal rather than exporting unvalidated `unknown`. App code injects only
`{ encode(document): string; decode(text): DecodeResult }`.

- [ ] **Step 1: Write failing canonicalization and limit tests**

Assert the complete canonical byte string: two-space indentation, exactly one terminal newline, model key
order at every nested level, stored array order, and no dependence on object insertion order. Construct an
explicit deep-copied DTO rather than stringifying the caller. Decode rejects duplicate keys, unsupported
future versions, 50,001 combined entities, non-finite numbers, unsafe coordinates, opening depth 65, and
input above 5 MiB in UTF-8 bytes while accepting the exact byte/depth/entity limits. Include ASCII and
emoji byte-boundary cases, escaped braces/quotes, prototype-shaped keys at every level, and `1e400`.
Migration from explicit schema `0` renames `name` to `title`, constructs a fresh schema-1 value, and rejects
records containing both names. Golden-test checked-in schema-0 and schema-1 `.quiver.json` fixtures.

- [ ] **Step 2: Implement schema-specific decoders**

Add exact production dependency `zod@4.4.3` to `packages/core`. Before `JSON.parse`, enforce the UTF-8 byte
limit and run one string/escape-aware lexical scanner that rejects duplicate object keys and opening depth
65 (root depth is 1). After parsing, require a plain root record and enforce the combined entity limit
before deep Zod traversal. Use strict Zod objects at every level, explicit finite checks for every number,
and safe-integer checks for coordinates. Do not merge or assign untrusted records. Run the ordered pure
`0 -> 1` migration, construct fresh readonly model values, and call `validateDocument`.

Map every failure to deterministic project-owned codes/messages/paths; never expose `ZodError` text.
Native preflight codes are `input-too-large`, `nesting-too-deep`, `invalid-json`,
`invalid-schema-version`, `unsupported-schema-version`, `entity-limit-exceeded`,
`invalid-native-document`, and `migration-conflict`; pass model-validation codes through unchanged.
Reuse Task 4's bounded-JSON preflight helper if available so the two codecs cannot diverge.

- [ ] **Step 3: Verify and commit**

Run: `npm test -w @quiver/core -- test/codec/native.test.ts`  
Expected: all canonical, migration, ownership, and adversarial limit cases pass. Include fixed-seed
fast-check properties with at least 500 runs for `decode(encode(document))`, byte-stable
`encode(decode(encoded))`, equivalent insertion orders, caller non-mutation, and nested alias separation.

```bash
git add packages/core/src/codec packages/core/test/codec/native.test.ts packages/test-fixtures/documents packages/core/package.json package-lock.json packages/core/src/index.ts
git commit -m "feat(core): add versioned native document codec"
```

### Task 6: Geometry primitives and curves

**Files:**
- Create: `packages/core/src/geometry/point.ts`
- Create: `packages/core/src/geometry/path.ts`
- Create: `packages/core/src/geometry/curve.ts`
- Create: `packages/core/test/geometry/point.test.ts`
- Create: `packages/core/test/geometry/curve.test.ts`
- Create: `packages/core/test/geometry/properties.test.ts`
- Create: `packages/test-fixtures/upstream/curve-goldens.json`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: finite numeric values.
- Produces: `EPSILON`, `GeometryError`, `Point`, `Size`, `Rect`, `Viewport`, `Curve`, `CurvePoint`,
  `PathCommand`, `BezierCurve`, `ArcCurve`, `RoundedRect`, `CurveRoundedRectRelation`,
  `documentToScreen`, `screenToDocument`.

All public curve geometry uses absolute document coordinates, x-right/y-down axes, radians, and positive
clockwise rotation. Keep continuous `Point` distinct from the model's integer `GridPoint`. `CurvePoint` is
`{ point, t, tangentAngle }`; a `Curve` exposes start/end/exact bounds/total length, point and tangent by
parameter, forward/inverse arc length, pure path commands, and rounded-rectangle relation. Path records are
renderer-neutral `move | line | quad | cubic | arc | close`; the arc record carries radii, x-axis rotation,
`largeArc`, `clockwise`, and endpoint so Skia can translate it without core importing Skia.

- [ ] **Step 1: Write failing vector/viewport/curve tests**

`legacy-web/tests/arrow.html` is only an interactive DOM lab, not a numeric test oracle. Extract checked-in
goldens directly from `legacy-web/curve.mjs`: quadratic `(0,0) -> (50,40) -> (100,0)` points/tangents and
lengths; its negative mirror; chord-64/radius-40 minor/major clockwise/counterclockwise arcs; straight,
tangent, contained/disjoint, translated/rotated, rounded/sharp-rectangle, and split-full-circle cases. Use
a local `expectPointClose` helper and add inverse viewport properties:

```text
quadratic p(.25)=(25,15), p(.5)=(50,20)
tangent(.25)=0.6747409422235527, tangent(.5)=0, tangent(.75)=-0.6747409422235527
length(.25)=29.233619379040814, length(.5)=54.84634704158012, total=109.79046158962747
minor clockwise arc midpoint=(32,-16), total=74.18361744012898
major clockwise arc midpoint=(32,-64), total=177.14379484705447
```

```ts
fc.assert(fc.property(viewportArb, pointArb, (viewport, point) => {
  expectPointClose(screenToDocument(viewport, documentToScreen(viewport, point)), point);
}));
```

With fixed-seed constructive generators and at least 1,000 runs, test transform equivariance,
endpoint/path agreement, finite outputs, exact bounds containment, reverse symmetry, monotone arc length,
forward/inverse consistency, and intersection points sorted by `t`, epsilon-unique, on-curve, and on the
boundary. Permanently regress upstream's non-monotone case `(0,0) -> (0.5,-500) -> (1,0)`, its duplicate
straight intersections, zero-width/nonzero-control out-and-back curve, invalid arcs, tangencies, huge
angles, negative dimensions, zero scale, and subdivision limits.

- [ ] **Step 2: Port immutable point and viewport math**

Replace upstream subclasses with readonly plain classes/value records. Every constructor validates inputs
and derived scalars, normalizes `-0`, and rejects overflow/NaN. `Rect` uses top-left x/y/width/height with
nonnegative dimensions plus `fromCenter`. Viewport conversion uses
`screen = document * scale + translation`; core requires a finite strictly positive scale because inverse
conversion is otherwise undefined.

- [ ] **Step 3: Port Bézier, arc, and rounded-rectangle algorithms**

Translate and correct the math in `legacy-web/curve.mjs` without DOM/SVG/Skia dependencies. Use general
quadratic `BezierCurve(start, control, end)` plus a symmetric factory. Build one deterministic bounded
adaptive de Casteljau table for each immutable Bézier using control-polygon-minus-chord flatness; sorted
`t` and cumulative positive lengths drive both `arcLengthAt` and `parameterAtLength`. Reject constant
curves and return a typed degenerate-tangent failure at cusps rather than NaN.

Canonical `ArcCurve` stores centre, positive radius, start angle, and signed sweep; its chord factory takes
`largeArc` and `clockwise`, rejects impossible chords, and supports full circles as two path arcs. Use
constant-time angle modulo, scale-aware epsilon clamping before square roots, positive intersection
tolerance, and deterministic segment caps.

Do not preserve upstream bugs or mixed local/world coordinates. Rounded-rectangle queries return exactly:

```ts
type CurveRoundedRectRelation =
  | { readonly kind: "intersections"; readonly points: readonly CurvePoint[] }
  | { readonly kind: "contained" }
  | { readonly kind: "disjoint" };
```

Never fabricate a containment point or deduplicate by object identity. Task 7—not generic geometry—owns
Quiver UI scale factors (`curve * 48`, `offset * 8`), degree conversion, loop-radius mapping, chord
thresholds, and the legacy self-loop nudge.

- [ ] **Step 4: Verify properties and commit**

Run: `npm test -w @quiver/core -- test/geometry`  
Expected: corrected upstream goldens plus at least 1,000 deterministic geometry properties pass; all
length/inverse/intersection work is finite, bounded, monotone, and coordinate-consistent.

```bash
git add packages/core/src/geometry packages/core/test/geometry packages/test-fixtures/upstream/curve-goldens.json packages/core/src/index.ts
git commit -m "feat(core): port deterministic diagram geometry"
```

### Task 7: Arrow layout and hit testing

**Files:**
- Create: `packages/core/src/geometry/arrow.ts`
- Create: `packages/core/src/geometry/spatial-index.ts`
- Create: `packages/core/test/geometry/arrow.test.ts`
- Create: `packages/core/test/geometry/hit-test.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: document entities, measured label/node bounds, curve primitives.
- Produces: `buildArrowGeometry(input): ArrowGeometry`, `buildSpatialIndex(items): SpatialIndex`, `hitTestPoint(index, point, tolerance): readonly HitResult[]`.

- [ ] **Step 1: Write failing arrow goldens**

Cover a straight arrow, curved parallel arrows, loop, shortened arrow, edge-to-edge higher cell, and every
tail/body/head family in the upstream styles fixture. Golden values include endpoints, curve commands,
label anchor/tangent, head/tail transforms, and bounds rounded to `1e-5`.

- [ ] **Step 2: Define render-independent geometry records**

```ts
export interface ArrowGeometry {
  readonly id: EntityId;
  readonly curve: Curve;
  readonly visibleRange: readonly [number, number];
  readonly labelAnchor: Point;
  readonly labelAngle: number;
  readonly pathCommands: readonly PathCommand[];
  readonly decorations: readonly ArrowDecoration[];
  readonly bounds: Rect;
}
```

- [ ] **Step 3: Port layout and add broad/exact hit testing**

Translate the math from `src/arrow.mjs`; replace SVG measurement with explicit `ShapeBounds` inputs.
Spatial index buckets are 128 document units. Query expands by tolerance, then exact tests compute distance
to vertices, sampled/analytically refined curve distance, labels, and ports. Results sort by visual z-order
then distance.

- [ ] **Step 4: Verify and commit**

Run: `npm test -w @quiver/core -- test/geometry/arrow.test.ts test/geometry/hit-test.test.ts`  
Expected: goldens pass and near-miss tests do not select outside expanded hit regions.

```bash
git add packages/core/src/geometry packages/core/test/geometry packages/core/src/index.ts
git commit -m "feat(core): add arrow layout and hit testing"
```

### Task 8: Macro and colour definition parser

**Files:**
- Create: `packages/core/src/macros/parser.ts`
- Create: `packages/core/test/macros/parser.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: macro source text up to 1 MB.
- Produces: `parseDefinitions(source): DefinitionParseResult`, including sanitized MathJax macros,
  colour map, and positional diagnostics.

- [ ] **Step 1: Write failing accepted/rejected definition tests**

Accept `\\newcommand`, starred variants, `\\renewcommand`, `\\DeclareMathOperator`, and `\\definecolor`
in `rgb`, `RGB`, `HTML`, and `gray`. Reject recursive replacement depth above 32, more than 2,000
definitions, JavaScript/HTML control sequences, invalid colour channels, and unmatched braces.

- [ ] **Step 2: Implement a bounded scanner and parser**

Use a character scanner with `{ offset, line, column }`, balanced-brace reader, command allowlist, and
explicit numeric parsers. Never evaluate input or build a regular expression from user text. Emit MathJax
macro records `{ [name]: [replacement, argumentCount] }` and normalized HSLA colours.

- [ ] **Step 3: Verify and commit**

Run: `npm test -w @quiver/core -- test/macros/parser.test.ts`  
Expected: accepted definitions normalize and rejected cases return exact diagnostic positions.

```bash
git add packages/core/src/macros packages/core/test/macros packages/core/src/index.ts
git commit -m "feat(core): parse bounded math definitions"
```

### Task 9: TikZ-CD importer

**Files:**
- Create: `packages/core/src/import/tikz.ts`
- Create: `packages/core/test/import/tikz.test.ts`
- Create: `packages/test-fixtures/upstream/import/*.tex`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: TikZ-CD source up to 5 MB, parsed definitions, injected ID factory.
- Produces: `importTikz(source, options): DecodeResult` with positional diagnostics and a validated document.

- [ ] **Step 1: Capture accepted legacy parser fixtures**

Commit the upstream `src/tests/parser.tex` cases as individually named fixtures and add hand-written cases
for `\\begin{tikzcd}` options, quoted labels, directions, loops, swap/sloped labels, colours, curve/shorten,
phantom higher cells, escaped ampersands, comments, and custom macros. Record the semantic entity values
created by the legacy parser.

- [ ] **Step 2: Write failing bounded and recovery tests**

Reject missing environment delimiters, grid dimension above 500x500, more than 50,000 cells, brace depth
above 64, numeric overflow, invalid direction, unknown endpoint reference, and input above 5 MB. For a bad
arrow after valid rows, return the valid independent vertices plus an error diagnostic; never return an
edge with a missing endpoint.

- [ ] **Step 3: Port the recursive-descent parser as a pure scanner**

Translate `src/parser.mjs` tokenization and option parsing while replacing DOM diagnostics with:

```ts
export interface SourceDiagnostic extends ValidationDiagnostic {
  readonly offset: number;
  readonly line: number;
  readonly column: number;
  readonly length: number;
}
```

The parser receives all limits and an ID factory, constructs canonical model values, resolves arrows only
after grid cells exist, validates the final dependency graph, and does not fetch macros or evaluate TeX.

- [ ] **Step 4: Verify fixtures and round trips**

Run: `npm test -w @quiver/core -- test/import/tikz.test.ts`  
Expected: all accepted legacy fixtures match semantic entities; malformed cases report stable positions;
`importTikz(exportTikz(document).data)` is semantically equal for all supported fixture features.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/import packages/core/test/import packages/test-fixtures/upstream/import packages/core/src/index.ts
git commit -m "feat(core): import bounded TikZ-CD diagrams"
```

### Task 10: TikZ-CD and Typst/Fletcher exporters

**Files:**
- Create: `packages/core/src/export/types.ts`
- Create: `packages/core/src/export/tikz.ts`
- Create: `packages/core/src/export/typst.ts`
- Create: `packages/core/test/export/tikz.test.ts`
- Create: `packages/core/test/export/typst.test.ts`
- Create: `packages/test-fixtures/upstream/expected/*.tex`
- Create: `packages/test-fixtures/upstream/expected/*.typ`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: validated document and `ExportOptions`.
- Produces: `exportTikz(document, options): TextExportResult`, `exportTypst(document, options): TextExportResult`; result contains `data`, sorted dependencies, and compatibility diagnostics.

- [ ] **Step 1: Capture upstream golden outputs**

Run the legacy exporter in a local browser harness for the four fixtures with stable settings and commit
normalized expected text. Strip only the host prefix from embedded return links; preserve all TeX/Typst
spacing and escaping.

- [ ] **Step 2: Write failing focused exporter tests**

Assert vertex grid layout, diagonal directions, loops, colours, label alignment, shortening, curves,
higher cells, `tikz-nfold` dependency emission, standalone document wrapping, and Fletcher syntax.

- [ ] **Step 3: Port exporters as pure functions**

Translate the relevant branches from `src/quiver.mjs`. Replace access to UI/settings/window with explicit
options, `formatQuiverUrl`, and derived geometry. Diagnostics use stable codes and never change output.

- [ ] **Step 4: Verify exact goldens and commit**

Run: `npm test -w @quiver/core -- test/export`  
Expected: fixture output matches exactly on LF line endings and repeated exports are byte-identical.

```bash
git add packages/core/src/export packages/core/test/export packages/test-fixtures/upstream/expected packages/core/src/index.ts
git commit -m "feat(core): port Quiver text exporters"
```

### Task 11: Core integration and quality gate

**Files:**
- Create: `packages/core/test/integration/roundtrip.test.ts`
- Create: `packages/core/README.md`
- Modify: `justfile`
- Modify: `package.json`

**Interfaces:**
- Consumes: all public core APIs.
- Produces: documented stable public surface and a clean core gate.

- [ ] **Step 1: Add end-to-end fixture tests**

For every upstream fixture: parse URL, decode, validate, apply add/move/update/undo/redo, copy/paste a
selection at a collision-free origin, encode native JSON, decode native JSON, export Quiver URL/TikZ/Typst,
re-import supported TikZ, and assert semantic/document validity at every boundary.

- [ ] **Step 2: Document the package boundary**

`packages/core/README.md` must show one complete decode-edit-export example and list every exported type
and function by module group. State explicitly that deep imports are unsupported.

- [ ] **Step 3: Run the clean gate twice**

Run: `npm ci && just ci && just ci`  
Expected: both gates pass; the second run changes no tracked file (`git status --short` is empty).

- [ ] **Step 4: Commit**

```bash
git add packages/core/test/integration packages/core/README.md justfile package.json package-lock.json
git commit -m "test(core): verify complete compatibility pipeline"
```
