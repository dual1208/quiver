import type {
  DiagramDocument,
  DiagramEntity,
  Edge,
  EntityId,
  Hsla,
  ValidationDiagnostic,
} from "./types";

const MAX_ENTITY_LEVEL = 4;

type VisitMark = "white" | "grey" | "black";
type ReportDiagnostic = (
  entity: DiagramEntity,
  code: string,
  message: string,
  path: string,
) => void;

interface OrderedDiagnostic {
  readonly diagnostic: ValidationDiagnostic;
  readonly entityOrder: number;
  readonly sequence: number;
}

export class DocumentValidationError extends Error {
  readonly diagnostics: readonly ValidationDiagnostic[];

  constructor(diagnostics: readonly ValidationDiagnostic[]) {
    super(
      diagnostics.length === 1
        ? `Diagram document validation failed: ${diagnostics[0]!.message}`
        : `Diagram document validation failed with ${diagnostics.length} diagnostics`,
    );
    this.name = "DocumentValidationError";
    this.diagnostics = Object.freeze([...diagnostics]);
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isValidHsla(value: unknown): value is Hsla {
  if (!Array.isArray(value) || value.length !== 4) {
    return false;
  }

  const components: readonly unknown[] = value;
  const [hue, saturation, lightness, alpha] = components;
  return (
    isFiniteNumber(hue) &&
    hue >= 0 &&
    hue <= 360 &&
    isFiniteNumber(saturation) &&
    saturation >= 0 &&
    saturation <= 100 &&
    isFiniteNumber(lightness) &&
    lightness >= 0 &&
    lightness <= 100 &&
    isFiniteNumber(alpha) &&
    alpha >= 0 &&
    alpha <= 1
  );
}

function deriveEntityLevels(
  document: DiagramDocument,
  report?: ReportDiagnostic,
): ReadonlyMap<EntityId, number> {
  const entities: readonly DiagramEntity[] = [
    ...document.vertices,
    ...document.edges,
  ];
  const entityById = new Map<EntityId, DiagramEntity>();
  for (const entity of entities) {
    if (!entityById.has(entity.id)) {
      entityById.set(entity.id, entity);
    }
  }

  const edgeIndices = new Map(
    document.edges.map((edge, index) => [edge, index] as const),
  );
  const marks = new Map<Edge, VisitMark>(
    document.edges.map((edge) => [edge, "white"] as const),
  );
  const levels = new Map<EntityId, number>();
  for (const vertex of document.vertices) {
    if (!levels.has(vertex.id)) {
      levels.set(vertex.id, 0);
    }
  }

  const visit = (edge: Edge): number | null => {
    const mark = marks.get(edge) ?? "white";
    const edgeIndex = edgeIndices.get(edge) ?? 0;
    if (mark === "black") {
      return levels.get(edge.id) ?? null;
    }
    if (mark === "grey") {
      report?.(
        edge,
        "dependency-cycle",
        `Edge '${edge.id}' participates in a dependency cycle`,
        `edges[${edgeIndex}]`,
      );
      return null;
    }

    marks.set(edge, "grey");
    let maximumEndpointLevel = 0;
    let hasValidDependencies = true;
    const endpoints = [
      ["sourceId", edge.sourceId],
      ["targetId", edge.targetId],
    ] as const;

    for (const [property, endpointId] of endpoints) {
      const endpoint = entityById.get(endpointId);
      if (endpoint === undefined) {
        report?.(
          edge,
          "missing-endpoint",
          `Edge '${edge.id}' references missing ${property} '${endpointId}'`,
          `edges[${edgeIndex}].${property}`,
        );
        hasValidDependencies = false;
        continue;
      }

      const endpointLevel = endpoint.kind === "vertex" ? 0 : visit(endpoint);
      if (endpointLevel === null) {
        hasValidDependencies = false;
      } else {
        maximumEndpointLevel = Math.max(maximumEndpointLevel, endpointLevel);
      }
    }

    marks.set(edge, "black");
    if (!hasValidDependencies) {
      return null;
    }

    const level = maximumEndpointLevel + 1;
    levels.set(edge.id, level);
    if (level > MAX_ENTITY_LEVEL) {
      report?.(
        edge,
        "level-exceeded",
        `Edge '${edge.id}' has derived level ${level}; maximum is ${MAX_ENTITY_LEVEL}`,
        `edges[${edgeIndex}]`,
      );
    }
    return level;
  };

  for (const edge of document.edges) {
    visit(edge);
  }

  return levels;
}

export function validateDocument(
  document: DiagramDocument,
): readonly ValidationDiagnostic[] {
  const entities: readonly DiagramEntity[] = [
    ...document.vertices,
    ...document.edges,
  ];
  const entityOrders = new Map(
    entities.map((entity, index) => [entity, index] as const),
  );
  const orderedDiagnostics: OrderedDiagnostic[] = [];
  let sequence = 0;

  const report: ReportDiagnostic = (entity, code, message, path) => {
    orderedDiagnostics.push({
      diagnostic: Object.freeze({ code, message, entityId: entity.id, path }),
      entityOrder: entityOrders.get(entity) ?? entities.length,
      sequence,
    });
    sequence += 1;
  };

  const firstEntityById = new Map<EntityId, DiagramEntity>();
  for (const [index, entity] of entities.entries()) {
    if (firstEntityById.has(entity.id)) {
      const collection = entity.kind === "vertex" ? "vertices" : "edges";
      const collectionIndex =
        entity.kind === "vertex" ? index : index - document.vertices.length;
      report(
        entity,
        "duplicate-id",
        `Entity ID '${entity.id}' is used more than once`,
        `${collection}[${collectionIndex}].id`,
      );
    } else {
      firstEntityById.set(entity.id, entity);
    }
  }

  const occupiedPositions = new Map<string, EntityId>();
  for (const [index, vertex] of document.vertices.entries()) {
    const numericCoordinates = [
      ["x", vertex.x],
      ["y", vertex.y],
    ] as const;
    let hasValidPosition = true;
    for (const [property, value] of numericCoordinates) {
      if (!isFiniteNumber(value)) {
        report(
          vertex,
          "non-finite-number",
          `Vertex '${vertex.id}' has a non-finite ${property} coordinate`,
          `vertices[${index}].${property}`,
        );
        hasValidPosition = false;
      } else if (!Number.isInteger(value)) {
        report(
          vertex,
          "invalid-grid-position",
          `Vertex '${vertex.id}' has a non-integer ${property} coordinate`,
          `vertices[${index}].${property}`,
        );
        hasValidPosition = false;
      }
    }

    if (hasValidPosition) {
      const positionKey = JSON.stringify([vertex.x, vertex.y]);
      if (occupiedPositions.has(positionKey)) {
        report(
          vertex,
          "duplicate-position",
          `Vertex '${vertex.id}' occupies an existing grid position (${vertex.x}, ${vertex.y})`,
          `vertices[${index}]`,
        );
      } else {
        occupiedPositions.set(positionKey, vertex.id);
      }
    }

    if (!isValidHsla(vertex.labelColour)) {
      report(
        vertex,
        "invalid-colour",
        `Vertex '${vertex.id}' has an invalid label colour`,
        `vertices[${index}].labelColour`,
      );
    }
  }

  for (const [index, edge] of document.edges.entries()) {
    const numericOptions = [
      ["labelPosition", edge.options.labelPosition],
      ["offset", edge.options.offset],
      ["curve", edge.options.curve],
      ["radius", edge.options.radius],
      ["angle", edge.options.angle],
      ["shorten.source", edge.options.shorten.source],
      ["shorten.target", edge.options.shorten.target],
    ] as const;
    for (const [property, value] of numericOptions) {
      if (!isFiniteNumber(value)) {
        report(
          edge,
          "non-finite-number",
          `Edge '${edge.id}' has a non-finite ${property} option`,
          `edges[${index}].options.${property}`,
        );
      }
    }

    if (!isValidHsla(edge.labelColour)) {
      report(
        edge,
        "invalid-colour",
        `Edge '${edge.id}' has an invalid label colour`,
        `edges[${index}].labelColour`,
      );
    }
    if (!isValidHsla(edge.options.colour)) {
      report(
        edge,
        "invalid-colour",
        `Edge '${edge.id}' has an invalid arrow colour`,
        `edges[${index}].options.colour`,
      );
    }
  }

  deriveEntityLevels(document, report);

  orderedDiagnostics.sort(
    (left, right) =>
      left.entityOrder - right.entityOrder || left.sequence - right.sequence,
  );
  return Object.freeze(orderedDiagnostics.map(({ diagnostic }) => diagnostic));
}

export function assertValidDocument(
  document: DiagramDocument,
): DiagramDocument {
  const diagnostics = validateDocument(document);
  if (diagnostics.length > 0) {
    throw new DocumentValidationError(diagnostics);
  }
  return document;
}

export function entityLevel(document: DiagramDocument, id: EntityId): number {
  const entity = [...document.vertices, ...document.edges].find(
    (candidate) => candidate.id === id,
  );
  if (entity === undefined) {
    throw new DocumentValidationError([
      Object.freeze({
        code: "entity-missing",
        message: `Entity '${id}' does not exist`,
        entityId: id,
        path: "id",
      }),
    ]);
  }

  const graphDiagnostics: ValidationDiagnostic[] = [];
  const levels = deriveEntityLevels(
    document,
    (diagnosticEntity, code, message, path) => {
      graphDiagnostics.push(
        Object.freeze({ code, message, entityId: diagnosticEntity.id, path }),
      );
    },
  );
  const level = levels.get(entity.id);
  if (level === undefined) {
    throw new DocumentValidationError(
      graphDiagnostics.length > 0
        ? graphDiagnostics
        : [
            Object.freeze({
              code: "level-unavailable",
              message: `Entity '${id}' has no derivable level`,
              entityId: id,
              path: "id",
            }),
          ],
    );
  }
  return level;
}
