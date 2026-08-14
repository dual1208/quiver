import { describe, expect, it } from "vitest";
import {
  BLACK_HSLA,
  CORE_SCHEMA_VERSION,
  DEFAULT_EDGE_OPTIONS,
  DocumentValidationError,
  assertValidDocument,
  createDeterministicIdFactory,
  entityId,
  entityLevel,
  validateDocument,
  type DiagramDocument,
  type Edge,
  type EntityId,
  type Hsla,
  type Vertex,
} from "../../src/index";

function vertex(
  id: string,
  x: number,
  y: number,
  labelColour: Hsla = BLACK_HSLA,
): Vertex {
  return {
    kind: "vertex",
    id: entityId(id),
    x,
    y,
    label: id,
    labelColour,
  };
}

function edge(id: string, sourceId: EntityId, targetId: EntityId): Edge {
  return {
    kind: "edge",
    id: entityId(id),
    sourceId,
    targetId,
    label: id,
    labelColour: BLACK_HSLA,
    options: DEFAULT_EDGE_OPTIONS,
  };
}

const source = vertex("v-source", 0, 0);
const target = vertex("v-target", 1, 0);
const arrow = edge("e-arrow", source.id, target.id);
const valid: DiagramDocument = {
  schemaVersion: CORE_SCHEMA_VERSION,
  id: "valid-document",
  title: "Valid",
  vertices: [source, target],
  edges: [arrow],
  macros: "",
  preferredRenderer: "katex",
};

describe("canonical model values", () => {
  it("provides the canonical basic-arrow defaults", () => {
    expect(DEFAULT_EDGE_OPTIONS).toEqual({
      labelAlignment: "left",
      labelPosition: 50,
      offset: 0,
      curve: 0,
      radius: 0,
      angle: 0,
      shorten: { source: 0, target: 0 },
      colour: [0, 0, 0, 1],
      shape: "bezier",
      style: {
        tail: { name: "none" },
        body: { name: "cell" },
        head: { name: "arrowhead" },
      },
    });
  });

  it("creates deterministic IDs through an injected factory", () => {
    const nextId = createDeterministicIdFactory("test");

    expect([nextId(), nextId(), nextId()]).toEqual([
      "test-1",
      "test-2",
      "test-3",
    ]);
  });
});

describe("validateDocument", () => {
  it("accepts a valid two-vertex one-edge diagram without mutating it", () => {
    const before = JSON.parse(JSON.stringify(valid)) as unknown;

    expect(validateDocument(valid)).toEqual([]);
    expect(valid).toEqual(before);
    expect(assertValidDocument(valid)).toBe(valid);
  });

  it("derives public entity levels from endpoint dependencies", () => {
    expect(entityLevel(valid, source.id)).toBe(0);
    expect(entityLevel(valid, arrow.id)).toBe(1);
  });

  it("reports the later vertex at an occupied grid position", () => {
    const duplicate = vertex("v-duplicate", source.x, source.y);

    expect(
      validateDocument({ ...valid, vertices: [...valid.vertices, duplicate] }),
    ).toContainEqual(
      expect.objectContaining({
        code: "duplicate-position",
        entityId: duplicate.id,
      }),
    );
  });

  it("reports an edge whose endpoint does not exist", () => {
    expect(
      validateDocument({
        ...valid,
        edges: [{ ...arrow, targetId: entityId("missing") }],
      }),
    ).toContainEqual(
      expect.objectContaining({ code: "missing-endpoint", entityId: arrow.id }),
    );
  });

  it("reports a cycle between higher-cell dependencies", () => {
    const firstId = entityId("e-cycle-first");
    const secondId = entityId("e-cycle-second");
    const first = edge("e-cycle-first", secondId, source.id);
    const second = edge("e-cycle-second", firstId, target.id);
    const document = { ...valid, edges: [first, second] };

    expect(validateDocument(document)).toContainEqual(
      expect.objectContaining({
        code: "dependency-cycle",
        entityId: first.id,
      }),
    );
    expect(() => entityLevel(document, first.id)).toThrow(
      DocumentValidationError,
    );
  });

  it("reports an edge whose derived level exceeds four", () => {
    const edges: Edge[] = [];
    let dependencyId = source.id;
    for (let level = 1; level <= 5; level += 1) {
      const next = edge(`e-level-${level}`, dependencyId, target.id);
      edges.push(next);
      dependencyId = next.id;
    }
    const document = { ...valid, edges };

    expect(entityLevel(document, edges[3]!.id)).toBe(4);
    expect(entityLevel(document, edges[4]!.id)).toBe(5);
    expect(validateDocument(document)).toContainEqual(
      expect.objectContaining({
        code: "level-exceeded",
        entityId: edges[4]!.id,
      }),
    );
  });

  it("reports invalid vertex, label, and edge HSLA ranges", () => {
    const invalidVertex = vertex("v-colour", 2, 0, [361, 0, 0, 1]);
    const invalidLabelEdge: Edge = {
      ...arrow,
      id: entityId("e-label-colour"),
      labelColour: [0, 101, 0, 1],
    };
    const invalidEdgeColour: Edge = {
      ...arrow,
      id: entityId("e-edge-colour"),
      options: { ...arrow.options, colour: [0, 0, 0, 1.01] },
    };
    const document = {
      ...valid,
      vertices: [...valid.vertices, invalidVertex],
      edges: [invalidLabelEdge, invalidEdgeColour],
    };

    expect(validateDocument(document)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "invalid-colour",
          entityId: invalidVertex.id,
        }),
        expect.objectContaining({
          code: "invalid-colour",
          entityId: invalidLabelEdge.id,
        }),
        expect.objectContaining({
          code: "invalid-colour",
          entityId: invalidEdgeColour.id,
        }),
      ]),
    );
  });

  it("reports non-finite vertex and edge geometry", () => {
    const invalidVertex = vertex("v-infinite", Number.POSITIVE_INFINITY, 0);
    const invalidEdge: Edge = {
      ...arrow,
      id: entityId("e-nan"),
      options: { ...arrow.options, curve: Number.NaN },
    };
    const document = {
      ...valid,
      vertices: [...valid.vertices, invalidVertex],
      edges: [invalidEdge],
    };

    expect(validateDocument(document)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "non-finite-number",
          entityId: invalidVertex.id,
          path: "vertices[2].x",
        }),
        expect.objectContaining({
          code: "non-finite-number",
          entityId: invalidEdge.id,
          path: "edges[0].options.curve",
        }),
      ]),
    );
  });

  it("returns stable diagnostics sorted by document entity order", () => {
    const invalidSource: Vertex = { ...source, labelColour: [361, 0, 0, 1] };
    const duplicate = vertex("v-duplicate", source.x, source.y);
    const missingEndpoint: Edge = { ...arrow, targetId: entityId("missing") };
    const nonFinite: Edge = {
      ...edge("e-non-finite", source.id, target.id),
      options: { ...arrow.options, offset: Number.NEGATIVE_INFINITY },
    };
    const document = {
      ...valid,
      vertices: [invalidSource, duplicate, target],
      edges: [missingEndpoint, nonFinite],
    };

    const first = validateDocument(document);
    const second = validateDocument(document);

    expect(second).toEqual(first);
    expect(
      first.map(({ code, entityId: diagnosticEntityId }) => [
        code,
        diagnosticEntityId,
      ]),
    ).toEqual([
      ["invalid-colour", invalidSource.id],
      ["duplicate-position", duplicate.id],
      ["missing-endpoint", missingEndpoint.id],
      ["non-finite-number", nonFinite.id],
    ]);
  });

  it("throws typed diagnostics when assertion validation fails", () => {
    const invalid = {
      ...valid,
      edges: [{ ...arrow, sourceId: entityId("missing") }],
    };

    expect(() => assertValidDocument(invalid)).toThrow(DocumentValidationError);
    try {
      assertValidDocument(invalid);
    } catch (error) {
      expect(error).toBeInstanceOf(DocumentValidationError);
      expect((error as DocumentValidationError).diagnostics).toContainEqual(
        expect.objectContaining({
          code: "missing-endpoint",
          entityId: arrow.id,
        }),
      );
    }
  });
});
