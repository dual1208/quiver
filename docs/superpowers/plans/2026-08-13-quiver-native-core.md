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

**Interfaces:**
- Consumes: validated `DiagramDocument` and entity types.
- Produces: `DocumentCommand`, `CommandTransaction`, `applyCommand`, `invertCommand`, `HistoryState`, `createHistory(document, limit?)`, `commitTransaction`, `undo`, `redo`.

- [ ] **Step 1: Write failing example and property tests**

Generate valid documents with fast-check. For every supported command `c`, assert:

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
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: model defaults, `assertValidDocument`, injected `IdFactory`.
- Produces: `decodeQuiverPayload(payload, options): DecodeResult`, `encodeQuiverPayload(document): string`, `encodeQuiverSelection(document, ids): string`, `parseQuiverUrl(text): QuiverLink`, `formatQuiverUrl(document, options): string`.

- [ ] **Step 1: Extract and lock upstream fixtures**

Copy the encoded payloads from the README screenshot links into fixture JSON alongside their expected
vertex/edge counts and selected labels. Tests must decode all four and re-encode to a semantically equal
document.

- [ ] **Step 2: Write failing UTF-8, legacy, and malformed-input tests**

Cover `\\alpha`, emoji, Japanese text, a payload containing legacy `length`, a payload containing
`style.body.level`, truncated arrays, invalid indices, duplicate positions, prototype-shaped keys, input
over 5 MB, and nesting over 64. Assert diagnostics contain a code and cell index.

- [ ] **Step 3: Implement byte-safe base64 and URL parsing**

```ts
export function encodeUtf8Base64(value: unknown): string {
  const json = JSON.stringify(value);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
```

Provide the inverse using `atob`, `Uint8Array`, `TextDecoder("utf-8", { fatal: true })`, and a JSON
reviver that creates null-prototype option records. React Native's base64 polyfill is supplied by the app;
the core tests install the same standards-compatible global.

- [ ] **Step 4: Implement exact v0 array defaults and migrations**

Vertices are emitted first in stored order; edges follow in ascending derived level and stored order.
Positions are translated so the minimum selected vertex coordinate is `(0,0)`. Trailing default array
members are omitted exactly as upstream. Import converts `length` to symmetric `shorten` unless an
explicit `shorten` exists, and moves legacy `style.body.level` into derived dependency validation.
`encodeQuiverSelection` includes the transitive endpoint dependencies needed to paste selected edges,
preserves selected entities as a separate returned ID list, and translates pasted vertices by an explicit
origin supplied to `decodeQuiverPayload` so collision handling remains a caller decision.

- [ ] **Step 5: Verify compatibility**

Run: `npm test -w @quiver/core -- test/codec/quiver.test.ts`  
Expected: all upstream fixtures decode, encode, and re-decode with semantic equality; malformed cases
return typed diagnostics without mutation or code execution.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/codec packages/core/src/index.ts packages/core/test/codec packages/test-fixtures/upstream
git commit -m "feat(core): preserve Quiver link compatibility"
```

### Task 5: Native JSON schema and migrations

**Files:**
- Create: `packages/core/src/codec/native.ts`
- Create: `packages/core/test/codec/native.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `DiagramDocument`, `CORE_SCHEMA_VERSION`, model validation.
- Produces: `NATIVE_MEDIA_TYPE`, `encodeNativeDocument(document): string`, `decodeNativeDocument(text, options): DecodeResult`, `migrateNativeValue(value): unknown`.

- [ ] **Step 1: Write failing canonicalization and limit tests**

Assert pretty-printed output ends in one newline, keys use model order, decode rejects unsupported future
versions, 50,001 entities, non-finite numbers, and a 5 MB+ string, and migration from the explicit test
schema `0` renames `name` to `title`.

- [ ] **Step 2: Implement schema-specific decoders**

Use Zod only at the untrusted JSON boundary. Parse into unknown, run the ordered `0 -> 1` migration, then
construct readonly model values and call `validateDocument`. Return `{ ok: true, document, diagnostics }`
or `{ ok: false, diagnostics }`; never expose a thrown Zod error.

- [ ] **Step 3: Verify and commit**

Run: `npm test -w @quiver/core -- test/codec/native.test.ts`  
Expected: all canonical, migration, and limit cases pass.

```bash
git add packages/core/src/codec/native.ts packages/core/test/codec/native.test.ts packages/core/src/index.ts
git commit -m "feat(core): add versioned native document codec"
```

### Task 6: Geometry primitives and curves

**Files:**
- Create: `packages/core/src/geometry/point.ts`
- Create: `packages/core/src/geometry/curve.ts`
- Create: `packages/core/test/geometry/point.test.ts`
- Create: `packages/core/test/geometry/curve.test.ts`
- Create: `packages/core/test/geometry/properties.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: finite numeric values.
- Produces: `Point`, `Size`, `Rect`, `Viewport`, `CurvePoint`, `BezierCurve`, `ArcCurve`, `RoundedRect`, `documentToScreen`, `screenToDocument`.

- [ ] **Step 1: Write failing vector/viewport/curve tests**

Port the numeric expectations from `src/tests/arrow.html` and add inverse viewport properties:

```ts
fc.assert(fc.property(viewportArb, pointArb, (viewport, point) => {
  expect(screenToDocument(viewport, documentToScreen(viewport, point))).toApproximatelyEqual(point);
}));
```

Test straight, positive/negative Bézier, minor/major arc, rounded-rectangle intersections, containment,
arc-length monotonicity, and clamping outside path length.

- [ ] **Step 2: Port immutable point and viewport math**

Replace upstream subclasses with readonly plain classes/value records. Every constructor calls
`assertFinite`. Viewport conversion uses `screen = document * scale + translation`, with scale constrained
by the caller rather than silently clamped in core.

- [ ] **Step 3: Port Bézier, arc, and rounded-rectangle algorithms**

Translate `src/curve.mjs` without DOM or SVG path dependencies. Curve render methods return path command
records (`move`, `line`, `quad`, `cubic`, `arc`) consumed by renderers/exporters. Preserve `EPSILON` and
the upstream containment semantics.

- [ ] **Step 4: Verify properties and commit**

Run: `npm test -w @quiver/core -- test/geometry`  
Expected: all upstream examples and 1,000 finite random viewport round trips pass.

```bash
git add packages/core/src/geometry packages/core/test/geometry packages/core/src/index.ts
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
