import type {
  DiagramDocument,
  DiagramEntity,
  Edge,
  EntityId,
  Hsla,
  ValidationDiagnostic,
  Vertex,
} from "./types";

const MAX_ENTITY_LEVEL = 4;

type VisitMark = "white" | "grey" | "black";
type ReportDiagnostic = (
  occurrence: EntityOccurrence,
  code: string,
  message: string,
  path: string,
) => void;

interface EntityOccurrenceBase<T extends DiagramEntity> {
  readonly entity: T;
  readonly entityOrder: number;
  readonly path: string;
}

type VertexOccurrence = EntityOccurrenceBase<Vertex>;
type EdgeOccurrence = EntityOccurrenceBase<Edge>;
type EntityOccurrence = VertexOccurrence | EdgeOccurrence;

interface DocumentOccurrences {
  readonly vertices: readonly VertexOccurrence[];
  readonly edges: readonly EdgeOccurrence[];
  readonly all: readonly EntityOccurrence[];
}

interface VisitFrame {
  readonly occurrence: EdgeOccurrence;
  nextEndpointIndex: number;
  maximumEndpointLevel: number;
  hasValidDependencies: boolean;
  awaiting?: EdgeOccurrence;
}

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

function documentOccurrences(document: DiagramDocument): DocumentOccurrences {
  const vertices: readonly VertexOccurrence[] = document.vertices.map(
    (entity, index) => ({
      entity,
      entityOrder: index,
      path: `vertices[${index}]`,
    }),
  );
  const edges: readonly EdgeOccurrence[] = document.edges.map(
    (entity, index) => ({
      entity,
      entityOrder: document.vertices.length + index,
      path: `edges[${index}]`,
    }),
  );
  return { vertices, edges, all: [...vertices, ...edges] };
}

function isEdgeOccurrence(
  occurrence: EntityOccurrence,
): occurrence is EdgeOccurrence {
  return occurrence.entity.kind === "edge";
}

function diagnostic(
  occurrence: EntityOccurrence,
  code: string,
  message: string,
  path: string,
): ValidationDiagnostic {
  return Object.freeze({
    code,
    message,
    entityId: occurrence.entity.id,
    path,
  });
}

function duplicateIdDiagnostic(
  occurrence: EntityOccurrence,
): ValidationDiagnostic {
  return diagnostic(
    occurrence,
    "duplicate-id",
    `Entity ID '${occurrence.entity.id}' is used more than once`,
    `${occurrence.path}.id`,
  );
}

function deriveEntityLevels(
  occurrences: DocumentOccurrences,
  report?: ReportDiagnostic,
): ReadonlyMap<EntityOccurrence, number> {
  const occurrenceById = new Map<EntityId, EntityOccurrence>();
  for (const occurrence of occurrences.all) {
    if (!occurrenceById.has(occurrence.entity.id)) {
      occurrenceById.set(occurrence.entity.id, occurrence);
    }
  }

  const occurrenceMarks = new Map<EdgeOccurrence, VisitMark>(
    occurrences.edges.map((occurrence) => [occurrence, "white"] as const),
  );
  const levels = new Map<EntityOccurrence, number>();
  for (const occurrence of occurrences.vertices) {
    levels.set(occurrence, 0);
  }

  for (const root of occurrences.edges) {
    if ((occurrenceMarks.get(root) ?? "white") !== "white") {
      continue;
    }

    occurrenceMarks.set(root, "grey");
    const stack: VisitFrame[] = [
      {
        occurrence: root,
        nextEndpointIndex: 0,
        maximumEndpointLevel: 0,
        hasValidDependencies: true,
      },
    ];

    while (stack.length > 0) {
      const frame = stack.at(-1)!;
      const edge = frame.occurrence.entity;

      if (frame.awaiting !== undefined) {
        const endpointLevel = levels.get(frame.awaiting);
        if (endpointLevel === undefined) {
          frame.hasValidDependencies = false;
        } else {
          frame.maximumEndpointLevel = Math.max(
            frame.maximumEndpointLevel,
            endpointLevel,
          );
        }
        delete frame.awaiting;
        continue;
      }

      if (frame.nextEndpointIndex < 2) {
        const property =
          frame.nextEndpointIndex === 0 ? "sourceId" : "targetId";
        frame.nextEndpointIndex += 1;
        const endpointId = edge[property];
        const endpoint = occurrenceById.get(endpointId);
        if (endpoint === undefined) {
          report?.(
            frame.occurrence,
            "missing-endpoint",
            `Edge '${edge.id}' references missing ${property} '${endpointId}'`,
            `${frame.occurrence.path}.${property}`,
          );
          frame.hasValidDependencies = false;
          continue;
        }

        if (!isEdgeOccurrence(endpoint)) {
          frame.maximumEndpointLevel = Math.max(frame.maximumEndpointLevel, 0);
          continue;
        }

        const endpointMark = occurrenceMarks.get(endpoint) ?? "white";
        if (endpointMark === "grey") {
          report?.(
            endpoint,
            "dependency-cycle",
            `Edge '${endpoint.entity.id}' participates in a dependency cycle`,
            endpoint.path,
          );
          frame.hasValidDependencies = false;
          continue;
        }
        if (endpointMark === "black") {
          const endpointLevel = levels.get(endpoint);
          if (endpointLevel === undefined) {
            frame.hasValidDependencies = false;
          } else {
            frame.maximumEndpointLevel = Math.max(
              frame.maximumEndpointLevel,
              endpointLevel,
            );
          }
          continue;
        }

        occurrenceMarks.set(endpoint, "grey");
        frame.awaiting = endpoint;
        stack.push({
          occurrence: endpoint,
          nextEndpointIndex: 0,
          maximumEndpointLevel: 0,
          hasValidDependencies: true,
        });
        continue;
      }

      occurrenceMarks.set(frame.occurrence, "black");
      if (frame.hasValidDependencies) {
        const level = frame.maximumEndpointLevel + 1;
        levels.set(frame.occurrence, level);
        if (level > MAX_ENTITY_LEVEL) {
          report?.(
            frame.occurrence,
            "level-exceeded",
            `Edge '${edge.id}' has derived level ${level}; maximum is ${MAX_ENTITY_LEVEL}`,
            frame.occurrence.path,
          );
        }
      }
      stack.pop();
    }
  }

  return levels;
}

export function validateDocument(
  document: DiagramDocument,
): readonly ValidationDiagnostic[] {
  const occurrences = documentOccurrences(document);
  const orderedDiagnostics: OrderedDiagnostic[] = [];
  let sequence = 0;

  const report: ReportDiagnostic = (occurrence, code, message, path) => {
    orderedDiagnostics.push({
      diagnostic: diagnostic(occurrence, code, message, path),
      entityOrder: occurrence.entityOrder,
      sequence,
    });
    sequence += 1;
  };

  const firstOccurrenceById = new Map<EntityId, EntityOccurrence>();
  for (const occurrence of occurrences.all) {
    if (firstOccurrenceById.has(occurrence.entity.id)) {
      report(
        occurrence,
        "duplicate-id",
        `Entity ID '${occurrence.entity.id}' is used more than once`,
        `${occurrence.path}.id`,
      );
    } else {
      firstOccurrenceById.set(occurrence.entity.id, occurrence);
    }
  }

  const occupiedPositions = new Map<string, EntityId>();
  for (const occurrence of occurrences.vertices) {
    const vertex = occurrence.entity;
    const numericCoordinates = [
      ["x", vertex.x],
      ["y", vertex.y],
    ] as const;
    let hasValidPosition = true;
    for (const [property, value] of numericCoordinates) {
      if (!isFiniteNumber(value)) {
        report(
          occurrence,
          "non-finite-number",
          `Vertex '${vertex.id}' has a non-finite ${property} coordinate`,
          `${occurrence.path}.${property}`,
        );
        hasValidPosition = false;
      } else if (!Number.isInteger(value)) {
        report(
          occurrence,
          "invalid-grid-position",
          `Vertex '${vertex.id}' has a non-integer ${property} coordinate`,
          `${occurrence.path}.${property}`,
        );
        hasValidPosition = false;
      }
    }

    if (hasValidPosition) {
      const positionKey = JSON.stringify([vertex.x, vertex.y]);
      if (occupiedPositions.has(positionKey)) {
        report(
          occurrence,
          "duplicate-position",
          `Vertex '${vertex.id}' occupies an existing grid position (${vertex.x}, ${vertex.y})`,
          occurrence.path,
        );
      } else {
        occupiedPositions.set(positionKey, vertex.id);
      }
    }

    if (!isValidHsla(vertex.labelColour)) {
      report(
        occurrence,
        "invalid-colour",
        `Vertex '${vertex.id}' has an invalid label colour`,
        `${occurrence.path}.labelColour`,
      );
    }
  }

  for (const occurrence of occurrences.edges) {
    const edge = occurrence.entity;
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
          occurrence,
          "non-finite-number",
          `Edge '${edge.id}' has a non-finite ${property} option`,
          `${occurrence.path}.options.${property}`,
        );
      }
    }

    if (!isValidHsla(edge.labelColour)) {
      report(
        occurrence,
        "invalid-colour",
        `Edge '${edge.id}' has an invalid label colour`,
        `${occurrence.path}.labelColour`,
      );
    }
    if (!isValidHsla(edge.options.colour)) {
      report(
        occurrence,
        "invalid-colour",
        `Edge '${edge.id}' has an invalid arrow colour`,
        `${occurrence.path}.options.colour`,
      );
    }
  }

  deriveEntityLevels(occurrences, report);

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
  const occurrences = documentOccurrences(document);
  const matches = occurrences.all.filter(
    (occurrence) => occurrence.entity.id === id,
  );
  if (matches.length === 0) {
    throw new DocumentValidationError([
      Object.freeze({
        code: "entity-missing",
        message: `Entity '${id}' does not exist`,
        entityId: id,
        path: "id",
      }),
    ]);
  }
  if (matches.length > 1) {
    throw new DocumentValidationError(
      matches.slice(1).map(duplicateIdDiagnostic),
    );
  }

  const selected = matches[0]!;
  const graphDiagnostics: OrderedDiagnostic[] = [];
  let sequence = 0;
  const levels = deriveEntityLevels(
    occurrences,
    (occurrence, code, message, path) => {
      graphDiagnostics.push({
        diagnostic: diagnostic(occurrence, code, message, path),
        entityOrder: occurrence.entityOrder,
        sequence,
      });
      sequence += 1;
    },
  );
  const level = levels.get(selected);
  if (level === undefined) {
    graphDiagnostics.sort(
      (left, right) =>
        left.entityOrder - right.entityOrder || left.sequence - right.sequence,
    );
    throw new DocumentValidationError(
      graphDiagnostics.length > 0
        ? graphDiagnostics.map(({ diagnostic: item }) => item)
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
