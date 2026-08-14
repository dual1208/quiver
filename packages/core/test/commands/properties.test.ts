import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  BLACK_HSLA,
  CORE_SCHEMA_VERSION,
  DEFAULT_EDGE_OPTIONS,
  applyCommand,
  commitTransaction,
  createHistory,
  createRemoveEntitiesCommand,
  entityId,
  invertCommand,
  redo,
  undo,
  validateDocument,
  type CommandTransaction,
  type DiagramDocument,
  type DocumentCommand,
  type Edge,
  type EntityId,
  type Vertex,
} from "../../src/index";

const RUNS = 500;

function vertex(id: string, x: number, y: number, label = id): Vertex {
  return {
    kind: "vertex",
    id: entityId(id),
    x,
    y,
    label,
    labelColour: BLACK_HSLA,
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

const pointArb = fc.tuple(
  fc.integer({ min: -20, max: 20 }),
  fc.integer({ min: -20, max: 20 }),
);

const validDocumentArb: fc.Arbitrary<DiagramDocument> = fc
  .tuple(
    fc.uniqueArray(pointArb, {
      minLength: 1,
      maxLength: 6,
      selector: ([x, y]) => `${x},${y}`,
    }),
    fc.array(fc.tuple(fc.nat(), fc.nat()), { maxLength: 8 }),
    fc.integer({ min: 0, max: 1_000_000 }),
  )
  .map(([points, edgeSeeds, nonce]) => {
    const vertices = points.map(([x, y], index) =>
      vertex(`v-${nonce}-${index}`, x, y),
    );
    const entities: { id: EntityId; level: number }[] = vertices.map(
      ({ id }) => ({ id, level: 0 }),
    );
    const edges: Edge[] = [];

    for (const [index, [sourceSeed, targetSeed]] of edgeSeeds.entries()) {
      const candidates = entities.filter(({ level }) => level <= 3);
      const source = candidates[sourceSeed % candidates.length]!;
      const target = candidates[targetSeed % candidates.length]!;
      const next = edge(`e-${nonce}-${index}`, source.id, target.id);
      const level = Math.max(source.level, target.level) + 1;
      edges.push(next);
      entities.push({ id: next.id, level });
    }

    return {
      schemaVersion: CORE_SCHEMA_VERSION,
      id: `document-${nonce}`,
      title: `Document ${nonce}`,
      vertices,
      edges,
      macros: "",
      preferredRenderer: nonce % 2 === 0 ? "katex" : "typst",
    };
  });

function exactRemovalClosure(
  document: DiagramDocument,
  roots: readonly EntityId[],
): readonly (Vertex | Edge)[] {
  const removedIds = new Set(roots);
  let changed = true;
  while (changed) {
    changed = false;
    for (const candidate of document.edges) {
      if (
        !removedIds.has(candidate.id) &&
        (removedIds.has(candidate.sourceId) ||
          removedIds.has(candidate.targetId))
      ) {
        removedIds.add(candidate.id);
        changed = true;
      }
    }
  }
  return [...document.vertices, ...document.edges].filter(({ id }) =>
    removedIds.has(id),
  );
}

function assertRoundTrip(
  document: DiagramDocument,
  command: DocumentCommand,
): void {
  expect(validateDocument(document)).toEqual([]);
  const documentBefore = structuredClone(document);
  const commandBefore = structuredClone(command);

  const changed = applyCommand(document, command);
  const changedBefore = structuredClone(changed);
  const inverse = invertCommand(document, command);
  const inverseBefore = structuredClone(inverse);
  const restored = applyCommand(changed, inverse);

  expect(validateDocument(changed)).toEqual([]);
  expect(restored).toEqual(document);
  expect(document).toEqual(documentBefore);
  expect(command).toEqual(commandBefore);
  expect(changed).toEqual(changedBefore);
  expect(inverse).toEqual(inverseBefore);
}

describe("command inverse properties", () => {
  it("round-trips 500 constructive add-entities commands at seed 0xadd500", () => {
    fc.assert(
      fc.property(validDocumentArb, fc.nat(), (document, nonce) => {
        const occupied = new Set(
          document.vertices.map(({ x, y }) => `${x},${y}`),
        );
        let x = 100 + (nonce % 1000);
        while (occupied.has(`${x},100`)) x += 1;
        const added = vertex(`added-v-${nonce}`, x, 100);
        const addedEdge = edge(
          `added-e-${nonce}`,
          added.id,
          document.vertices[0]!.id,
        );
        assertRoundTrip(document, {
          type: "add-entities",
          vertices: [added],
          edges: [addedEdge],
        });
      }),
      { numRuns: RUNS, seed: 0xadd500 },
    );
  });

  it("round-trips 500 constructive remove-entities commands at seed 0x0e5001", () => {
    fc.assert(
      fc.property(validDocumentArb, fc.nat(), (document, selector) => {
        const entities = [...document.vertices, ...document.edges];
        const root = entities[selector % entities.length]!.id;
        const command: DocumentCommand = {
          type: "remove-entities",
          ids: [root],
          removed: exactRemovalClosure(document, [root]),
        };
        expect(createRemoveEntitiesCommand(document, [root])).toEqual(command);
        assertRoundTrip(document, command);
      }),
      { numRuns: RUNS, seed: 0x0e5001 },
    );
  });

  it("round-trips 500 constructive move-vertices commands at seed 0x00500e", () => {
    fc.assert(
      fc.property(
        validDocumentArb,
        fc.integer({ min: 50, max: 500 }),
        (document, delta) => {
          const moves = document.vertices.map(({ id, x, y }) => ({
            id,
            from: { x, y },
            to: { x: x + delta, y: y + delta },
          }));
          assertRoundTrip(document, { type: "move-vertices", moves });
        },
      ),
      { numRuns: RUNS, seed: 0x00500e },
    );
  });

  it("round-trips 500 constructive update-entity commands at seed 0x0d500e", () => {
    fc.assert(
      fc.property(validDocumentArb, fc.nat(), (document, selector) => {
        const entities = [...document.vertices, ...document.edges];
        const before = entities[selector % entities.length]!;
        const after = { ...before, label: `${before.label}-${selector}` };
        assertRoundTrip(document, {
          type: "update-entity",
          id: before.id,
          before,
          after,
        });
      }),
      { numRuns: RUNS, seed: 0x0d500e },
    );
  });

  it("round-trips 500 constructive replace-document commands at seed 0x0e500d", () => {
    fc.assert(
      fc.property(validDocumentArb, validDocumentArb, (before, after) => {
        assertRoundTrip(before, {
          type: "replace-document",
          before,
          after,
        });
      }),
      { numRuns: RUNS, seed: 0x0e500d },
    );
  });
});

describe("history properties", () => {
  it("undoes and redoes 500 bounded constructive command sequences at seed 0x1500e0", () => {
    const descriptorsArb = fc.array(
      fc.record(
        { vertex: fc.nat(), label: fc.string({ maxLength: 12 }) },
        { noNullPrototype: true },
      ),
      { minLength: 1, maxLength: 25 },
    );

    fc.assert(
      fc.property(validDocumentArb, descriptorsArb, (document, descriptors) => {
        let history = createHistory(document, 25);
        for (const descriptor of descriptors) {
          const before =
            history.document.vertices[
              descriptor.vertex % history.document.vertices.length
            ]!;
          const transaction: CommandTransaction = {
            commands: [
              {
                type: "update-entity",
                id: before.id,
                before,
                after: { ...before, label: descriptor.label },
              },
            ],
          };
          history = commitTransaction(history, transaction);
          expect(validateDocument(history.document)).toEqual([]);
        }
        const finalDocument = history.document;
        const retained = history.past.length;

        for (let index = 0; index < retained; index += 1)
          history = undo(history);
        expect(history.document).toEqual(document);
        for (let index = 0; index < retained; index += 1)
          history = redo(history);
        expect(history.document).toEqual(finalDocument);
      }),
      { numRuns: RUNS, seed: 0x1500e0 },
    );
  });
});
