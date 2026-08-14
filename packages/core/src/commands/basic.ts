import { validateDocument } from "../model/validate";
import type {
  DiagramDocument,
  DiagramEntity,
  Edge,
  EntityId,
  Vertex,
} from "../model/types";
import { snapshotCommand, snapshotDocument } from "./snapshot";
import { CommandError, type DocumentCommand } from "./types";

function structuralEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (left === null || right === null) {
    return false;
  }
  if (typeof left !== "object" || typeof right !== "object") {
    return false;
  }
  if (Array.isArray(left) !== Array.isArray(right)) {
    return false;
  }

  const leftRecord = left as Readonly<Record<string, unknown>>;
  const rightRecord = right as Readonly<Record<string, unknown>>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  return leftKeys.every(
    (key) =>
      Object.hasOwn(rightRecord, key) &&
      structuralEqual(leftRecord[key], rightRecord[key]),
  );
}

function allEntities(document: DiagramDocument): readonly DiagramEntity[] {
  return [...document.vertices, ...document.edges];
}

function assertValidResult(document: DiagramDocument): DiagramDocument {
  const diagnostics = validateDocument(document);
  if (diagnostics.length === 0) {
    return document;
  }

  const code = diagnostics.some(
    ({ code: itemCode }) => itemCode === "duplicate-position",
  )
    ? "position-occupied"
    : "invalid-result";
  throw new CommandError(code, diagnostics);
}

function applyAddEntities(
  document: DiagramDocument,
  command: Extract<DocumentCommand, { readonly type: "add-entities" }>,
): DiagramDocument {
  const knownIds = new Set(allEntities(document).map(({ id }) => id));
  for (const entity of [...command.vertices, ...command.edges]) {
    if (knownIds.has(entity.id)) {
      throw new CommandError("entity-exists");
    }
    knownIds.add(entity.id);
  }

  return assertValidResult({
    ...document,
    vertices: [...document.vertices, ...command.vertices],
    edges: [...document.edges, ...command.edges],
  });
}

function removalIds(
  document: DiagramDocument,
  roots: readonly EntityId[],
): ReadonlySet<EntityId> {
  const existingIds = new Set(allEntities(document).map(({ id }) => id));
  for (const id of roots) {
    if (!existingIds.has(id)) {
      throw new CommandError("entity-missing");
    }
  }

  const dependents = new Map<EntityId, Edge[]>();
  for (const edge of document.edges) {
    for (const endpointId of [edge.sourceId, edge.targetId]) {
      const endpointDependents = dependents.get(endpointId);
      if (endpointDependents === undefined) {
        dependents.set(endpointId, [edge]);
      } else {
        endpointDependents.push(edge);
      }
    }
  }

  const ids = new Set(roots);
  const queue = [...ids];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    for (const edge of dependents.get(queue[cursor]!) ?? []) {
      if (!ids.has(edge.id)) {
        ids.add(edge.id);
        queue.push(edge.id);
      }
    }
  }
  return ids;
}

function createOwnedRemoveEntitiesCommand(
  document: DiagramDocument,
  ids: readonly EntityId[],
): Extract<DocumentCommand, { readonly type: "remove-entities" }> {
  const closure = removalIds(document, ids);
  return {
    type: "remove-entities",
    ids: [...ids],
    removed: allEntities(document).filter(({ id }) => closure.has(id)),
  };
}

export function createRemoveEntitiesCommand(
  document: DiagramDocument,
  ids: readonly EntityId[],
): Extract<DocumentCommand, { readonly type: "remove-entities" }> {
  return createOwnedRemoveEntitiesCommand(snapshotDocument(document), [...ids]);
}

function applyRemoveEntities(
  document: DiagramDocument,
  command: Extract<DocumentCommand, { readonly type: "remove-entities" }>,
): DiagramDocument {
  const expected = createOwnedRemoveEntitiesCommand(document, command.ids);
  if (!structuralEqual(command.removed, expected.removed)) {
    throw new CommandError("invalid-result");
  }

  const removedIds = new Set(expected.removed.map(({ id }) => id));
  return assertValidResult({
    ...document,
    vertices: document.vertices.filter(({ id }) => !removedIds.has(id)),
    edges: document.edges.filter(({ id }) => !removedIds.has(id)),
  });
}

function vertexById(
  document: DiagramDocument,
  id: EntityId,
): Vertex | undefined {
  return document.vertices.find((vertex) => vertex.id === id);
}

function applyMoveVertices(
  document: DiagramDocument,
  command: Extract<DocumentCommand, { readonly type: "move-vertices" }>,
): DiagramDocument {
  for (const { id } of command.moves) {
    if (vertexById(document, id) === undefined) {
      throw new CommandError("entity-missing");
    }
  }

  const movesById = new Map<EntityId, (typeof command.moves)[number]>();
  for (const move of command.moves) {
    if (movesById.has(move.id)) {
      throw new CommandError("invalid-result");
    }
    const current = vertexById(document, move.id)!;
    if (current.x !== move.from.x || current.y !== move.from.y) {
      throw new CommandError("invalid-result");
    }
    movesById.set(move.id, move);
  }

  const vertices = document.vertices.map((vertex) => {
    const move = movesById.get(vertex.id);
    return move === undefined
      ? vertex
      : { ...vertex, x: move.to.x, y: move.to.y };
  });
  return assertValidResult({ ...document, vertices });
}

function entityOccurrences(
  document: DiagramDocument,
  id: EntityId,
): readonly DiagramEntity[] {
  return allEntities(document).filter((entity) => entity.id === id);
}

function applyUpdateEntity(
  document: DiagramDocument,
  command: Extract<DocumentCommand, { readonly type: "update-entity" }>,
): DiagramDocument {
  const matches = entityOccurrences(document, command.id);
  if (matches.length === 0) {
    throw new CommandError("entity-missing");
  }
  const current = matches[0]!;
  if (
    matches.length !== 1 ||
    command.before.id !== command.id ||
    command.after.id !== command.id ||
    command.before.kind !== current.kind ||
    command.after.kind !== current.kind ||
    !structuralEqual(current, command.before)
  ) {
    throw new CommandError("invalid-result");
  }

  const updated =
    current.kind === "vertex"
      ? {
          ...document,
          vertices: document.vertices.map((vertex) =>
            vertex.id === command.id ? (command.after as Vertex) : vertex,
          ),
        }
      : {
          ...document,
          edges: document.edges.map((edge) =>
            edge.id === command.id ? (command.after as Edge) : edge,
          ),
        };
  return assertValidResult(updated);
}

function applyReplaceDocument(
  document: DiagramDocument,
  command: Extract<DocumentCommand, { readonly type: "replace-document" }>,
): DiagramDocument {
  if (!structuralEqual(document, command.before)) {
    throw new CommandError("invalid-result");
  }
  return assertValidResult(command.after);
}

function applyOwnedCommand(
  document: DiagramDocument,
  command: DocumentCommand,
): DiagramDocument {
  switch (command.type) {
    case "add-entities":
      return applyAddEntities(document, command);
    case "remove-entities":
      return applyRemoveEntities(document, command);
    case "move-vertices":
      return applyMoveVertices(document, command);
    case "update-entity":
      return applyUpdateEntity(document, command);
    case "replace-document":
      return applyReplaceDocument(document, command);
  }
}

function invertOwnedCommand(
  document: DiagramDocument,
  command: DocumentCommand,
): DocumentCommand {
  const changed = applyOwnedCommand(document, command);
  switch (command.type) {
    case "add-entities":
      return createOwnedRemoveEntitiesCommand(changed, [
        ...command.vertices.map(({ id }) => id),
        ...command.edges.map(({ id }) => id),
      ]);
    case "remove-entities":
      return {
        type: "replace-document",
        before: changed,
        after: document,
      };
    case "move-vertices":
      return {
        type: "move-vertices",
        moves: command.moves.map(({ id, from, to }) => ({
          id,
          from: to,
          to: from,
        })),
      };
    case "update-entity":
      return {
        type: "update-entity",
        id: command.id,
        before: command.after,
        after: command.before,
      };
    case "replace-document":
      return {
        type: "replace-document",
        before: changed,
        after: document,
      };
  }
}

export function applyCommand(
  document: DiagramDocument,
  command: DocumentCommand,
): DiagramDocument {
  return applyOwnedCommand(
    snapshotDocument(document),
    snapshotCommand(command),
  );
}

export function invertCommand(
  document: DiagramDocument,
  command: DocumentCommand,
): DocumentCommand {
  return invertOwnedCommand(
    snapshotDocument(document),
    snapshotCommand(command),
  );
}
