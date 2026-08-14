import type {
  DiagramDocument,
  DiagramEntity,
  Edge,
  EdgeOptions,
  EdgeStylePart,
  GridPoint,
  Hsla,
  Vertex,
} from "../model/types";
import type { CommandTransaction, DocumentCommand } from "./types";

function snapshotHsla(colour: Hsla): Hsla {
  return [colour[0], colour[1], colour[2], colour[3]];
}

function snapshotGridPoint(point: GridPoint): GridPoint {
  return { x: point.x, y: point.y };
}

function snapshotEdgeStylePart(part: EdgeStylePart): EdgeStylePart {
  return part.side === undefined
    ? { name: part.name }
    : { name: part.name, side: part.side };
}

function snapshotEdgeOptions(options: EdgeOptions): EdgeOptions {
  return {
    labelAlignment: options.labelAlignment,
    labelPosition: options.labelPosition,
    offset: options.offset,
    curve: options.curve,
    radius: options.radius,
    angle: options.angle,
    shorten: {
      source: options.shorten.source,
      target: options.shorten.target,
    },
    level: options.level,
    colour: snapshotHsla(options.colour),
    shape: options.shape,
    edgeAlignment: {
      source: options.edgeAlignment.source,
      target: options.edgeAlignment.target,
    },
    style: {
      name: options.style.name,
      tail: snapshotEdgeStylePart(options.style.tail),
      body: snapshotEdgeStylePart(options.style.body),
      head: snapshotEdgeStylePart(options.style.head),
    },
  };
}

function snapshotVertex(vertex: Vertex): Vertex {
  return {
    kind: "vertex",
    id: vertex.id,
    x: vertex.x,
    y: vertex.y,
    label: vertex.label,
    labelColour: snapshotHsla(vertex.labelColour),
  };
}

function snapshotEdge(edge: Edge): Edge {
  return {
    kind: "edge",
    id: edge.id,
    sourceId: edge.sourceId,
    targetId: edge.targetId,
    label: edge.label,
    labelColour: snapshotHsla(edge.labelColour),
    options: snapshotEdgeOptions(edge.options),
  };
}

export function snapshotEntity(entity: DiagramEntity): DiagramEntity {
  return entity.kind === "vertex"
    ? snapshotVertex(entity)
    : snapshotEdge(entity);
}

export function snapshotDocument(document: DiagramDocument): DiagramDocument {
  return {
    schemaVersion: document.schemaVersion,
    id: document.id,
    title: document.title,
    vertices: document.vertices.map(snapshotVertex),
    edges: document.edges.map(snapshotEdge),
    macros: document.macros,
    preferredRenderer: document.preferredRenderer,
  };
}

export function snapshotCommand(command: DocumentCommand): DocumentCommand {
  switch (command.type) {
    case "add-entities":
      return {
        type: "add-entities",
        vertices: command.vertices.map(snapshotVertex),
        edges: command.edges.map(snapshotEdge),
      };
    case "remove-entities":
      return {
        type: "remove-entities",
        ids: [...command.ids],
        removed: command.removed.map(snapshotEntity),
      };
    case "move-vertices":
      return {
        type: "move-vertices",
        moves: command.moves.map(({ id, from, to }) => ({
          id,
          from: snapshotGridPoint(from),
          to: snapshotGridPoint(to),
        })),
      };
    case "update-entity":
      return {
        type: "update-entity",
        id: command.id,
        before: snapshotEntity(command.before),
        after: snapshotEntity(command.after),
      };
    case "replace-document":
      return {
        type: "replace-document",
        before: snapshotDocument(command.before),
        after: snapshotDocument(command.after),
      };
  }
}

export function snapshotTransaction(
  transaction: CommandTransaction,
): CommandTransaction {
  return {
    commands: transaction.commands.map(snapshotCommand),
    ...(transaction.mergeKey === undefined
      ? {}
      : { mergeKey: transaction.mergeKey }),
  };
}
