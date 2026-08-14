import {
  BLACK_HSLA,
  DEFAULT_EDGE_OPTIONS,
  commitTransaction,
  createHistory,
  createRemoveEntitiesCommand,
  entityId,
  redo,
  undo,
  type DiagramDocument,
  type DiagramEntity,
  type Edge,
  type EntityId,
  type GridPoint,
  type HistoryState,
  type Vertex,
} from "@quiver/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const GRID_STEP = 1;

function nextEntityId(prefix: "vertex" | "edge"): EntityId {
  const random = Math.random().toString(36).slice(2, 9);
  return entityId(`${prefix}-${Date.now().toString(36)}-${random}`);
}

function snappedPoint(point: GridPoint): GridPoint {
  return {
    x: Math.round(point.x / GRID_STEP) * GRID_STEP,
    y: Math.round(point.y / GRID_STEP) * GRID_STEP,
  };
}

function freePoint(document: DiagramDocument, requested: GridPoint): GridPoint {
  const origin = snappedPoint(requested);
  const occupied = new Set(
    document.vertices.map(({ x, y }) => `${x}:${y}`),
  );
  if (!occupied.has(`${origin.x}:${origin.y}`)) {
    return origin;
  }

  for (let radius = 1; radius < 128; radius += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      for (const dy of [-radius, radius]) {
        const candidate = { x: origin.x + dx, y: origin.y + dy };
        if (!occupied.has(`${candidate.x}:${candidate.y}`)) {
          return candidate;
        }
      }
    }
    for (let dy = -radius + 1; dy < radius; dy += 1) {
      for (const dx of [-radius, radius]) {
        const candidate = { x: origin.x + dx, y: origin.y + dy };
        if (!occupied.has(`${candidate.x}:${candidate.y}`)) {
          return candidate;
        }
      }
    }
  }
  return { x: origin.x + 128, y: origin.y };
}

function entityInDocument(
  document: DiagramDocument,
  id: EntityId,
): DiagramEntity | undefined {
  return (
    document.vertices.find((vertex) => vertex.id === id) ??
    document.edges.find((edge) => edge.id === id)
  );
}

function vertexAt(
  document: DiagramDocument,
  point: GridPoint,
): Vertex | undefined {
  return document.vertices.find(
    (vertex) => vertex.x === point.x && vertex.y === point.y,
  );
}

function newVertex(id: EntityId, point: GridPoint): Vertex {
  return {
    kind: "vertex",
    id,
    x: point.x,
    y: point.y,
    label: "\\bullet",
    labelColour: BLACK_HSLA,
  };
}

export type DiagramEditor = Readonly<{
  document: DiagramDocument;
  selectedIds: readonly EntityId[];
  selectedEntities: readonly DiagramEntity[];
  canUndo: boolean;
  canRedo: boolean;
  select: (ids: readonly EntityId[]) => void;
  toggleSelection: (id: EntityId) => void;
  clearSelection: () => void;
  createVertex: (point: GridPoint) => EntityId;
  beginConnection: (point: GridPoint) => EntityId;
  completeConnection: (sourceId: EntityId, point: GridPoint) => EntityId | null;
  moveVertex: (id: EntityId, point: GridPoint) => void;
  connectSelection: () => EntityId | null;
  updateEntityLabel: (id: EntityId, label: string) => void;
  updateTitle: (title: string) => void;
  deleteSelection: () => void;
  undo: () => void;
  redo: () => void;
}>;

export function useDiagramEditor(initialDocument: DiagramDocument): DiagramEditor {
  const [history, setHistory] = useState<HistoryState>(() =>
    createHistory(initialDocument),
  );
  const historyRef = useRef(history);
  const [selectedIds, setSelectedIds] = useState<readonly EntityId[]>([]);

  useEffect(() => {
    const next = createHistory(initialDocument);
    historyRef.current = next;
    setHistory(next);
    setSelectedIds([]);
  }, [initialDocument.id]);

  const replaceHistory = useCallback((next: HistoryState) => {
    historyRef.current = next;
    setHistory(next);
  }, []);

  const commit = useCallback(
    (commands: Parameters<typeof commitTransaction>[1]["commands"], mergeKey?: string) => {
      const next = commitTransaction(historyRef.current, {
        commands,
        ...(mergeKey === undefined ? {} : { mergeKey }),
      });
      replaceHistory(next);
    },
    [replaceHistory],
  );

  const select = useCallback((ids: readonly EntityId[]) => {
    const unique = [...new Set(ids)];
    setSelectedIds(unique);
  }, []);

  const toggleSelection = useCallback((id: EntityId) => {
    setSelectedIds((current) =>
      current.includes(id)
        ? current.filter((selected) => selected !== id)
        : [...current, id],
    );
  }, []);

  const clearSelection = useCallback(() => setSelectedIds([]), []);

  const createVertex = useCallback(
    (requested: GridPoint): EntityId => {
      const document = historyRef.current.document;
      const point = freePoint(document, requested);
      const id = nextEntityId("vertex");
      const vertex = newVertex(id, point);
      commit([{ type: "add-entities", vertices: [vertex], edges: [] }]);
      setSelectedIds([id]);
      return id;
    },
    [commit],
  );

  const beginConnection = useCallback(
    (requested: GridPoint): EntityId => {
      const document = historyRef.current.document;
      const point = snappedPoint(requested);
      const existing = vertexAt(document, point);
      if (existing !== undefined) {
        setSelectedIds([existing.id]);
        return existing.id;
      }

      const id = nextEntityId("vertex");
      commit([
        {
          type: "add-entities",
          vertices: [newVertex(id, point)],
          edges: [],
        },
      ]);
      setSelectedIds([id]);
      return id;
    },
    [commit],
  );

  const completeConnection = useCallback(
    (sourceId: EntityId, requested: GridPoint): EntityId | null => {
      const document = historyRef.current.document;
      const source = document.vertices.find((vertex) => vertex.id === sourceId);
      if (source === undefined) {
        return null;
      }

      const point = snappedPoint(requested);
      const existingTarget = vertexAt(document, point);
      const targetId = existingTarget?.id ?? nextEntityId("vertex");
      const edgeId = nextEntityId("edge");
      const edge: Edge = {
        kind: "edge",
        id: edgeId,
        sourceId,
        targetId,
        label: "",
        labelColour: BLACK_HSLA,
        options: {
          ...DEFAULT_EDGE_OPTIONS,
          shape: sourceId === targetId ? "arc" : "bezier",
        },
      };
      commit([
        {
          type: "add-entities",
          vertices:
            existingTarget === undefined ? [newVertex(targetId, point)] : [],
          edges: [edge],
        },
      ]);
      setSelectedIds([edgeId]);
      return edgeId;
    },
    [commit],
  );

  const moveVertex = useCallback(
    (id: EntityId, requested: GridPoint) => {
      const document = historyRef.current.document;
      const vertex = document.vertices.find((item) => item.id === id);
      if (vertex === undefined) {
        return;
      }
      const point = snappedPoint(requested);
      if (vertex.x === point.x && vertex.y === point.y) {
        return;
      }
      const occupied = document.vertices.some(
        (item) => item.id !== id && item.x === point.x && item.y === point.y,
      );
      if (occupied) {
        return;
      }
      commit(
        [
          {
            type: "move-vertices",
            moves: [
              {
                id,
                from: { x: vertex.x, y: vertex.y },
                to: point,
              },
            ],
          },
        ],
        `move:${id}`,
      );
    },
    [commit],
  );

  const connectSelection = useCallback((): EntityId | null => {
    const document = historyRef.current.document;
    const vertices = selectedIds
      .map((id) => document.vertices.find((vertex) => vertex.id === id))
      .filter((vertex): vertex is Vertex => vertex !== undefined);
    if (vertices.length !== 2) {
      return null;
    }
    const id = nextEntityId("edge");
    const edge: Edge = {
      kind: "edge",
      id,
      sourceId: vertices[0]!.id,
      targetId: vertices[1]!.id,
      label: "",
      labelColour: BLACK_HSLA,
      options: DEFAULT_EDGE_OPTIONS,
    };
    commit([{ type: "add-entities", vertices: [], edges: [edge] }]);
    setSelectedIds([id]);
    return id;
  }, [commit, selectedIds]);

  const updateEntityLabel = useCallback(
    (id: EntityId, label: string) => {
      const document = historyRef.current.document;
      const before = entityInDocument(document, id);
      if (before === undefined || before.label === label) {
        return;
      }
      commit(
        [
          {
            type: "update-entity",
            id,
            before,
            after: { ...before, label },
          },
        ],
        `label:${id}`,
      );
    },
    [commit],
  );

  const updateTitle = useCallback(
    (title: string) => {
      const document = historyRef.current.document;
      if (document.title === title) {
        return;
      }
      commit(
        [
          {
            type: "replace-document",
            before: document,
            after: { ...document, title },
          },
        ],
        "document-title",
      );
    },
    [commit],
  );

  const deleteSelection = useCallback(() => {
    if (selectedIds.length === 0) {
      return;
    }
    const document = historyRef.current.document;
    commit([createRemoveEntitiesCommand(document, selectedIds)]);
    setSelectedIds([]);
  }, [commit, selectedIds]);

  const performUndo = useCallback(() => {
    replaceHistory(undo(historyRef.current));
    setSelectedIds([]);
  }, [replaceHistory]);

  const performRedo = useCallback(() => {
    replaceHistory(redo(historyRef.current));
    setSelectedIds([]);
  }, [replaceHistory]);

  const selectedEntities = useMemo(
    () =>
      selectedIds
        .map((id) => entityInDocument(history.document, id))
        .filter((entity): entity is DiagramEntity => entity !== undefined),
    [history.document, selectedIds],
  );

  return {
    document: history.document,
    selectedIds,
    selectedEntities,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    select,
    toggleSelection,
    clearSelection,
    createVertex,
    beginConnection,
    completeConnection,
    moveVertex,
    connectSelection,
    updateEntityLabel,
    updateTitle,
    deleteSelection,
    undo: performUndo,
    redo: performRedo,
  };
}
