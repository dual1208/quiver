import { describe, expect, it } from "vitest";
import {
  BLACK_HSLA,
  CORE_SCHEMA_VERSION,
  CommandError,
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
  type CommandErrorCode,
  type CommandTransaction,
  type DiagramDocument,
  type DocumentCommand,
  type Edge,
  type EntityId,
  type Vertex,
} from "../../src/index";

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

function writableVertex(id: string, x: number, y: number, label = id) {
  const labelColour: [number, number, number, number] = [0, 0, 0, 1];
  return {
    kind: "vertex" as const,
    id: entityId(id),
    x,
    y,
    label,
    labelColour,
  };
}

function writableEdge(id: string, sourceId: EntityId, targetId: EntityId) {
  const labelColour: [number, number, number, number] = [0, 0, 0, 1];
  const colour: [number, number, number, number] = [0, 0, 0, 1];
  return {
    kind: "edge" as const,
    id: entityId(id),
    sourceId,
    targetId,
    label: id,
    labelColour,
    options: {
      labelAlignment: "centre" as const,
      labelPosition: 50,
      offset: 0,
      curve: 0,
      radius: 0,
      angle: 0,
      shorten: { source: 0, target: 0 },
      colour,
      shape: "bezier" as const,
      style: {
        tail: { name: "none" },
        body: { name: "solid" },
        head: { name: "arrowhead", side: "top" as const },
      },
    },
  };
}

function writableDocument(
  vertices: ReturnType<typeof writableVertex>[],
  edges: ReturnType<typeof writableEdge>[] = [],
  id = "writable-document",
) {
  return {
    schemaVersion: CORE_SCHEMA_VERSION,
    id,
    title: id,
    vertices,
    edges,
    macros: "",
    preferredRenderer: "katex" as const,
  };
}

function document(
  vertices: readonly Vertex[],
  edges: readonly Edge[] = [],
  id = "commands-document",
): DiagramDocument {
  return {
    schemaVersion: CORE_SCHEMA_VERSION,
    id,
    title: id,
    vertices,
    edges,
    macros: "",
    preferredRenderer: "katex",
  };
}

function expectCommandError(
  action: () => unknown,
  code: CommandErrorCode,
): void {
  expect(action).toThrow(CommandError);
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(CommandError);
    expect((error as CommandError).code).toBe(code);
  }
}

function updateLabel(
  current: Vertex,
  label: string,
  mergeKey?: string,
): CommandTransaction {
  return {
    commands: [
      {
        type: "update-entity",
        id: current.id,
        before: current,
        after: { ...current, label },
      },
    ],
    ...(mergeKey === undefined ? {} : { mergeKey }),
  };
}

const a = vertex("v-a", 0, 0, "A");
const b = vertex("v-b", 1, 0, "B");
const c = vertex("v-c", 2, 0, "C");
const base = document([a, b, c]);

describe("document commands", () => {
  it("adds related entities and removes them again through its inverse", () => {
    const added = vertex("v-added", 3, 0);
    const arrow = edge("e-added", added.id, a.id);
    const command: DocumentCommand = {
      type: "add-entities",
      vertices: [added],
      edges: [arrow],
    };

    const changed = applyCommand(base, command);

    expect(changed.vertices).toEqual([...base.vertices, added]);
    expect(changed.edges).toEqual([arrow]);
    expect(validateDocument(changed)).toEqual([]);
    expect(applyCommand(changed, invertCommand(base, command))).toEqual(base);
  });

  it("maps add precondition failures to stable command errors", () => {
    expectCommandError(
      () =>
        applyCommand(base, {
          type: "add-entities",
          vertices: [{ ...a }, { ...a }],
          edges: [],
        }),
      "entity-exists",
    );
    expectCommandError(
      () =>
        applyCommand(base, {
          type: "add-entities",
          vertices: [vertex("v-occupied", b.x, b.y)],
          edges: [],
        }),
      "position-occupied",
    );
    expectCommandError(
      () =>
        applyCommand(base, {
          type: "add-entities",
          vertices: [],
          edges: [edge("e-missing", a.id, entityId("missing"))],
        }),
      "invalid-result",
    );
  });

  it("rejects an added level-five edge as an invalid result", () => {
    const level1 = edge("e-1", a.id, b.id);
    const level2 = edge("e-2", level1.id, c.id);
    const level3 = edge("e-3", level2.id, c.id);
    const level4 = edge("e-4", level3.id, c.id);
    const deep = document([a, b, c], [level1, level2, level3, level4]);

    expectCommandError(
      () =>
        applyCommand(deep, {
          type: "add-entities",
          vertices: [],
          edges: [edge("e-5", level4.id, c.id)],
        }),
      "invalid-result",
    );
  });

  it("cascades removal through reverse-ordered higher cells in document order", () => {
    const level1 = edge("e-level-1", a.id, b.id);
    const level2 = edge("e-level-2", level1.id, c.id);
    const level3 = edge("e-level-3", level2.id, c.id);
    const survivor = edge("e-survivor", b.id, c.id);
    const source = document(
      [a, b, c],
      [level3, survivor, level2, level1],
      "cascade",
    );

    const command = createRemoveEntitiesCommand(source, [a.id, a.id]);

    expect(command).toEqual({
      type: "remove-entities",
      ids: [a.id, a.id],
      removed: [a, level3, level2, level1],
    });
    const changed = applyCommand(source, command);
    expect(changed).toEqual(document([b, c], [survivor], "cascade"));
    const inverse = invertCommand(source, command);
    expect(inverse).toEqual({
      type: "replace-document",
      before: changed,
      after: source,
    });
    expect(applyCommand(changed, inverse)).toEqual(source);
  });

  it("cascades shared dependencies and can remove only a higher edge", () => {
    const first = edge("e-first", a.id, b.id);
    const second = edge("e-second", b.id, c.id);
    const shared = edge("e-shared", first.id, second.id);
    const dependent = edge("e-dependent", shared.id, c.id);
    const source = document([a, b, c], [dependent, shared, first, second]);

    expect(createRemoveEntitiesCommand(source, [a.id, b.id]).removed).toEqual([
      a,
      b,
      dependent,
      shared,
      first,
      second,
    ]);
    expect(createRemoveEntitiesCommand(source, [shared.id]).removed).toEqual([
      dependent,
      shared,
    ]);
  });

  it("rejects missing roots and malformed removal payloads", () => {
    const arrow = edge("e-arrow", a.id, b.id);
    const source = document([a, b], [arrow]);

    expectCommandError(
      () => createRemoveEntitiesCommand(source, [entityId("missing")]),
      "entity-missing",
    );
    expectCommandError(
      () =>
        applyCommand(source, {
          type: "remove-entities",
          ids: [a.id],
          removed: [a],
        }),
      "invalid-result",
    );
    expectCommandError(
      () =>
        applyCommand(source, {
          type: "remove-entities",
          ids: [a.id],
          removed: [arrow, a],
        }),
      "invalid-result",
    );
  });

  it("moves vertices simultaneously so swaps remain valid", () => {
    const command: DocumentCommand = {
      type: "move-vertices",
      moves: [
        { id: a.id, from: { x: 0, y: 0 }, to: { x: 1, y: 0 } },
        { id: b.id, from: { x: 1, y: 0 }, to: { x: 0, y: 0 } },
      ],
    };

    const changed = applyCommand(base, command);
    expect(changed.vertices.slice(0, 2)).toEqual([
      { ...a, x: 1 },
      { ...b, x: 0 },
    ]);
    expect(applyCommand(changed, invertCommand(base, command))).toEqual(base);
  });

  it("validates move targets, stale origins, duplicate entries, and collisions", () => {
    expectCommandError(
      () =>
        applyCommand(base, {
          type: "move-vertices",
          moves: [
            {
              id: entityId("missing"),
              from: { x: 0, y: 0 },
              to: { x: 5, y: 5 },
            },
          ],
        }),
      "entity-missing",
    );
    expectCommandError(
      () =>
        applyCommand(base, {
          type: "move-vertices",
          moves: [{ id: a.id, from: { x: 9, y: 9 }, to: { x: 5, y: 5 } }],
        }),
      "invalid-result",
    );
    expectCommandError(
      () =>
        applyCommand(base, {
          type: "move-vertices",
          moves: [
            { id: a.id, from: { x: 0, y: 0 }, to: { x: 4, y: 0 } },
            { id: a.id, from: { x: 0, y: 0 }, to: { x: 5, y: 0 } },
          ],
        }),
      "invalid-result",
    );
    expectCommandError(
      () =>
        applyCommand(base, {
          type: "move-vertices",
          moves: [{ id: a.id, from: { x: 0, y: 0 }, to: { x: 2, y: 0 } }],
        }),
      "position-occupied",
    );
  });

  it("updates an entity in place and swaps before/after for inversion", () => {
    const after = { ...b, label: "updated" };
    const command: DocumentCommand = {
      type: "update-entity",
      id: b.id,
      before: { ...b },
      after,
    };

    const changed = applyCommand(base, command);
    expect(changed.vertices).toEqual([a, after, c]);
    expect(invertCommand(base, command)).toEqual({
      type: "update-entity",
      id: b.id,
      before: after,
      after: command.before,
    });
    expect(applyCommand(changed, invertCommand(base, command))).toEqual(base);
  });

  it("maps update precondition and result failures deterministically", () => {
    expectCommandError(
      () =>
        applyCommand(base, {
          type: "update-entity",
          id: entityId("missing"),
          before: a,
          after: a,
        }),
      "entity-missing",
    );
    expectCommandError(
      () =>
        applyCommand(base, {
          type: "update-entity",
          id: a.id,
          before: { ...a, label: "stale" },
          after: { ...a, label: "next" },
        }),
      "invalid-result",
    );
    expectCommandError(
      () =>
        applyCommand(base, {
          type: "update-entity",
          id: a.id,
          before: a,
          after: { ...a, x: b.x, y: b.y },
        }),
      "position-occupied",
    );
    expectCommandError(
      () =>
        applyCommand(base, {
          type: "update-entity",
          id: a.id,
          before: a,
          after: { ...a, labelColour: [361, 0, 0, 1] },
        }),
      "invalid-result",
    );
    expectCommandError(
      () =>
        applyCommand(base, {
          type: "update-entity",
          id: a.id,
          before: a,
          after: edge("same-id-edge", a.id, b.id),
        }),
      "invalid-result",
    );
  });

  it("replaces a structurally matching document and rejects stale or invalid replacements", () => {
    const replacement = { ...base, id: "replacement", title: "Replacement" };
    const command: DocumentCommand = {
      type: "replace-document",
      before: structuredClone(base),
      after: replacement,
    };

    expect(applyCommand(base, command)).toEqual(replacement);
    expect(applyCommand(base, command)).not.toBe(replacement);
    expect(applyCommand(replacement, invertCommand(base, command))).toEqual(
      base,
    );
    expectCommandError(
      () => applyCommand({ ...base, title: "stale" }, command),
      "invalid-result",
    );
    expectCommandError(
      () =>
        applyCommand(base, {
          type: "replace-document",
          before: base,
          after: { ...base, vertices: [a, { ...b, x: a.x, y: a.y }] },
        }),
      "position-occupied",
    );
  });

  it("does not mutate command or document inputs", () => {
    const command: DocumentCommand = {
      type: "move-vertices",
      moves: [{ id: a.id, from: { x: 0, y: 0 }, to: { x: 10, y: 10 } }],
    };
    const beforeDocument = structuredClone(base);
    const beforeCommand = structuredClone(command);

    const changed = applyCommand(base, command);
    invertCommand(base, command);

    expect(base).toEqual(beforeDocument);
    expect(command).toEqual(beforeCommand);
    expect(changed).not.toBe(base);
  });

  it("owns source and add-entity values after direct application", () => {
    const sourceVertex = writableVertex("v-source", 0, 0, "Source");
    const source = writableDocument([sourceVertex]);
    const added = writableVertex("v-added-owned", 1, 0, "Added");
    const arrow = writableEdge("e-added-owned", added.id, sourceVertex.id);
    const command = {
      type: "add-entities" as const,
      vertices: [added],
      edges: [arrow],
    };

    const changed = applyCommand(source, command);
    const expected = structuredClone(changed);

    sourceVertex.label = "mutated source";
    sourceVertex.labelColour[0] = 180;
    source.vertices.push(writableVertex("v-late", 2, 0));
    added.label = "mutated add";
    added.labelColour[1] = 50;
    arrow.label = "mutated edge";
    arrow.options.shorten.source = 12;
    arrow.options.colour[2] = 30;
    arrow.options.style.head.name = "mutated head";
    command.vertices.length = 0;
    command.edges.length = 0;

    expect(sourceVertex.label).toBe("mutated source");
    expect(added.label).toBe("mutated add");
    expect(changed).toEqual(expected);
  });

  it("owns update payloads and their precomputed inverse", () => {
    const before = writableVertex("v-update-owned", 0, 0, "Before");
    const source = writableDocument([before]);
    const after = writableVertex("v-update-owned", 0, 0, "After");
    after.labelColour[0] = 20;
    const command = {
      type: "update-entity" as const,
      id: before.id,
      before,
      after,
    };

    const changed = applyCommand(source, command);
    const inverse = invertCommand(source, command);
    const expectedChanged = structuredClone(changed);
    const expectedInverse = structuredClone(inverse);

    before.label = "mutated before";
    before.labelColour[0] = 120;
    after.label = "mutated after";
    after.labelColour[0] = 220;

    expect(changed).toEqual(expectedChanged);
    expect(inverse).toEqual(expectedInverse);
  });

  it("owns replacement documents and exact replacement inverses", () => {
    const sourceVertex = writableVertex("v-replace-source", 0, 0, "Source");
    const source = writableDocument([sourceVertex], [], "replace-source");
    const replacementVertex = writableVertex(
      "v-replacement",
      1,
      0,
      "Replacement",
    );
    const replacement = writableDocument(
      [replacementVertex],
      [],
      "replacement",
    );
    const command = {
      type: "replace-document" as const,
      before: source,
      after: replacement,
    };

    const changed = applyCommand(source, command);
    const inverse = invertCommand(source, command);
    const expectedChanged = structuredClone(changed);
    const expectedInverse = structuredClone(inverse);

    source.title = "mutated source title";
    sourceVertex.label = "mutated source vertex";
    replacement.title = "mutated replacement title";
    replacementVertex.label = "mutated replacement vertex";
    replacementVertex.labelColour[3] = 0.5;

    expect(changed).toEqual(expectedChanged);
    expect(inverse).toEqual(expectedInverse);
  });

  it("owns removal payloads and move points returned by command helpers", () => {
    const left = writableVertex("v-owned-left", 0, 0, "Left");
    const right = writableVertex("v-owned-right", 1, 0, "Right");
    const arrow = writableEdge("e-owned-arrow", left.id, right.id);
    const source = writableDocument([left, right], [arrow]);
    const removal = createRemoveEntitiesCommand(source, [left.id]);
    const from = { x: 0, y: 0 };
    const to = { x: 4, y: 5 };
    const move = {
      type: "move-vertices" as const,
      moves: [{ id: left.id, from, to }],
    };
    const inverse = invertCommand(source, move);
    const expectedRemoval = structuredClone(removal);
    const expectedInverse = structuredClone(inverse);

    left.label = "mutated left";
    left.labelColour[0] = 90;
    arrow.options.style.body.name = "mutated body";
    from.x = 99;
    to.y = 99;

    expect(removal).toEqual(expectedRemoval);
    expect(inverse).toEqual(expectedInverse);
  });
});

describe("bounded history", () => {
  it("commits multi-command transactions atomically and undoes in reverse order", () => {
    const added = vertex("v-new", 4, 0);
    const transaction: CommandTransaction = {
      commands: [
        { type: "add-entities", vertices: [added], edges: [] },
        {
          type: "update-entity",
          id: added.id,
          before: added,
          after: { ...added, label: "New label" },
        },
      ],
    };

    const committed = commitTransaction(createHistory(base), transaction);
    expect(committed.document.vertices.at(-1)?.label).toBe("New label");
    expect(undo(committed).document).toEqual(base);
    expect(redo(undo(committed)).document).toEqual(committed.document);

    const before = createHistory(base);
    expectCommandError(
      () =>
        commitTransaction(before, {
          commands: [
            { type: "add-entities", vertices: [added], edges: [] },
            {
              type: "move-vertices",
              moves: [
                {
                  id: added.id,
                  from: { x: 999, y: 999 },
                  to: { x: 5, y: 5 },
                },
              ],
            },
          ],
        }),
      "invalid-result",
    );
    expect(before.document).toEqual(base);
    expect(before.document).not.toBe(base);
    expect(before.past).toEqual([]);
  });

  it("merges consecutive same-key label updates into one undo entry", () => {
    const initial = createHistory(base);
    const first = commitTransaction(initial, updateLabel(a, "A1", "label:v-a"));
    const currentA = first.document.vertices[0]!;
    const second = commitTransaction(
      first,
      updateLabel(currentA, "A2", "label:v-a"),
    );

    expect(second.past).toHaveLength(1);
    expect(second.document.vertices[0]?.label).toBe("A2");
    expect(undo(second).document).toEqual(base);
    expect(redo(undo(second)).document).toEqual(second.document);
  });

  it("does not merge different keys, across undo, or across redo", () => {
    const first = commitTransaction(
      createHistory(base),
      updateLabel(a, "A1", "label:v-a"),
    );
    const firstA = first.document.vertices[0]!;
    const different = commitTransaction(
      first,
      updateLabel(firstA, "A2", "different"),
    );
    expect(different.past).toHaveLength(2);

    const afterUndo = undo(different);
    const undoBarrier = commitTransaction(
      afterUndo,
      updateLabel(afterUndo.document.vertices[0]!, "A3", "label:v-a"),
    );
    expect(undoBarrier.past).toHaveLength(2);
    expect(undo(undoBarrier).document.vertices[0]?.label).toBe("A1");
    expect(undoBarrier.future).toEqual([]);

    const redone = redo(undo(different));
    const redoBarrier = commitTransaction(
      redone,
      updateLabel(redone.document.vertices[0]!, "A4", "different"),
    );
    expect(redoBarrier.past).toHaveLength(3);
    expect(undo(redoBarrier).document.vertices[0]?.label).toBe("A2");
  });

  it("treats empty transactions and unavailable timeline actions as identity no-ops", () => {
    const initial = createHistory(base);
    expect(undo(initial)).toBe(initial);
    expect(redo(initial)).toBe(initial);

    const committed = commitTransaction(initial, updateLabel(a, "A1"));
    const afterUndo = undo(committed);
    expect(commitTransaction(afterUndo, { commands: [] })).toBe(afterUndo);
    expect(afterUndo.future).toHaveLength(1);
  });

  it("validates history limits and honors zero and one", () => {
    for (const limit of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => createHistory(base, limit)).toThrow(RangeError);
    }

    const zero = commitTransaction(
      createHistory(base, 0),
      updateLabel(a, "A1"),
    );
    expect(zero.document.vertices[0]?.label).toBe("A1");
    expect(zero.past).toEqual([]);
    expect(undo(zero)).toBe(zero);

    const oneFirst = commitTransaction(
      createHistory(base, 1),
      updateLabel(a, "A1"),
    );
    const oneSecond = commitTransaction(
      oneFirst,
      updateLabel(oneFirst.document.vertices[0]!, "A2"),
    );
    expect(oneSecond.past).toHaveLength(1);
    expect(undo(oneSecond).document.vertices[0]?.label).toBe("A1");
  });

  it("evicts the oldest entry when the 201st default transaction commits", () => {
    let history = createHistory(base);
    for (let index = 1; index <= 201; index += 1) {
      history = commitTransaction(
        history,
        updateLabel(history.document.vertices[0]!, `A${index}`),
      );
    }

    expect(history.limit).toBe(200);
    expect(history.past).toHaveLength(200);
    for (let index = 0; index < 200; index += 1) {
      history = undo(history);
    }
    expect(history.document.vertices[0]?.label).toBe("A1");
  });

  it("merges at a full limit without evicting another entry", () => {
    const first = commitTransaction(
      createHistory(base, 1),
      updateLabel(a, "A1", "label:v-a"),
    );
    const merged = commitTransaction(
      first,
      updateLabel(first.document.vertices[0]!, "A2", "label:v-a"),
    );

    expect(merged.past).toHaveLength(1);
    expect(undo(merged).document).toEqual(base);
  });

  it("returns new history values without mutating prior documents or stacks", () => {
    const initial = createHistory(base);
    const initialSnapshot = structuredClone(initial);
    const committed = commitTransaction(initial, updateLabel(a, "A1"));
    const committedSnapshot = structuredClone(committed);
    const undone = undo(committed);
    const redone = redo(undone);

    expect(initial).toEqual(initialSnapshot);
    expect(committed).toEqual(committedSnapshot);
    expect(committed).not.toBe(initial);
    expect(undone).not.toBe(committed);
    expect(redone).not.toBe(undone);
  });

  it("owns the initial document without freezing caller values", () => {
    const first = writableVertex("v-history-first", 0, 0, "First");
    const second = writableVertex("v-history-second", 1, 0, "Second");
    const arrow = writableEdge("e-history", first.id, second.id);
    const source = writableDocument([first, second], [arrow]);
    const history = createHistory(source);
    const expected = structuredClone(history);

    source.title = "mutated title";
    source.vertices.length = 0;
    first.label = "mutated first";
    first.labelColour[0] = 180;
    arrow.label = "mutated arrow";
    arrow.labelColour[1] = 40;
    arrow.options.shorten.target = 10;
    arrow.options.colour[2] = 25;
    arrow.options.style.tail.name = "mutated tail";

    expect(source.title).toBe("mutated title");
    expect(arrow.options.style.tail.name).toBe("mutated tail");
    expect(history).toEqual(expected);
  });

  it("owns committed forward and inverse data across undo and redo", () => {
    const before = writableVertex("v-committed", 0, 0, "Before");
    const source = writableDocument([before]);
    const after = writableVertex("v-committed", 0, 0, "After");
    after.labelColour[0] = 45;
    const update = {
      type: "update-entity" as const,
      id: before.id,
      before,
      after,
    };
    const commands = [update];
    const transaction = { commands, mergeKey: "owned-update" };
    const initial = createHistory(source);
    const expectedInitial = structuredClone(initial);
    const committed = commitTransaction(initial, transaction);
    const expectedCommitted = structuredClone(committed);

    before.label = "mutated before commit input";
    before.labelColour[0] = 145;
    after.label = "mutated after commit input";
    after.labelColour[0] = 245;
    update.id = entityId("mutated-id");
    transaction.mergeKey = "mutated-key";
    commands.length = 0;

    expect(initial).toEqual(expectedInitial);
    expect(committed).toEqual(expectedCommitted);

    const undone = undo(committed);
    const expectedUndone = structuredClone(undone);

    before.label = "mutated again after undo";
    after.label = "mutated again after undo";
    commands.push(update);

    expect(undone).toEqual(expectedUndone);
    expect(undone.document).toEqual(expectedInitial.document);
    expect(redo(undone).document).toEqual(expectedCommitted.document);
    expect(committed).toEqual(expectedCommitted);
  });
});
