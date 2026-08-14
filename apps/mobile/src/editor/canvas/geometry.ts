import type {
  DiagramDocument,
  Edge,
  EntityId,
  GridPoint,
  Hsla,
  Vertex,
} from "@quiver/core";

export const DOCUMENT_GRID_SIZE = 96;
export const MIN_VIEWPORT_SCALE = 0.18;
export const MAX_VIEWPORT_SCALE = 4;

const VERTEX_MIN_WIDTH = 28;
const VERTEX_HEIGHT = 34;
const VERTEX_HORIZONTAL_PADDING = 18;
const MAX_VERTEX_LABEL_CHARACTERS = 30;
const MAX_EDGE_LABEL_CHARACTERS = 38;
const EDGE_CURVE_UNIT = 13;
const EDGE_HIT_SLOP = 14;

export interface WorldPoint {
  readonly x: number;
  readonly y: number;
}

export interface WorldBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export interface VertexGeometry {
  readonly id: EntityId;
  readonly vertex: Vertex;
  readonly center: WorldPoint;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly label: string;
  readonly labelX: number;
  readonly labelBaseline: number;
}

export interface EdgeGeometry {
  readonly id: EntityId;
  readonly edge: Edge;
  readonly path: string;
  readonly arrowhead: string;
  readonly label: string;
  readonly labelPoint: WorldPoint;
  readonly labelX: number;
  readonly labelBaseline: number;
  readonly labelWidth: number;
  readonly labelHeight: number;
  readonly samples: readonly WorldPoint[];
  readonly level: number;
}

export interface DiagramGeometry {
  readonly vertices: readonly VertexGeometry[];
  readonly edges: readonly EdgeGeometry[];
  readonly bounds: WorldBounds;
  readonly gridPath: string;
  readonly axisPath: string;
}

interface MutableBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface EndpointGeometry {
  readonly point: WorldPoint;
  readonly halfWidth: number;
  readonly halfHeight: number;
}

interface DragPreview {
  readonly id: EntityId;
  readonly point: GridPoint;
}

type TextMeasurer = (label: string) => number;

function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

export function clamp(value: number, minimum: number, maximum: number): number {
  "worklet";
  return Math.min(maximum, Math.max(minimum, value));
}

function displayLabel(label: string): string {
  const trimmed = label.trim();
  if (trimmed === "\\bullet" || trimmed === "bullet") {
    return "•";
  }
  return trimmed;
}

function compactLabel(label: string, maximumCharacters: number): string {
  const characters = Array.from(displayLabel(label));
  if (characters.length === 0) {
    return "";
  }
  if (characters.length <= maximumCharacters) {
    return characters.join("");
  }
  return `${characters.slice(0, maximumCharacters - 1).join("")}…`;
}

function svgNumber(value: number): string {
  return finite(value).toFixed(2);
}

function point(x: number, y: number): WorldPoint {
  return { x: finite(x), y: finite(y) };
}

function subtract(a: WorldPoint, b: WorldPoint): WorldPoint {
  return point(a.x - b.x, a.y - b.y);
}

function add(a: WorldPoint, b: WorldPoint): WorldPoint {
  return point(a.x + b.x, a.y + b.y);
}

function multiply(value: WorldPoint, scalar: number): WorldPoint {
  return point(value.x * scalar, value.y * scalar);
}

function magnitude(value: WorldPoint): number {
  return Math.hypot(value.x, value.y);
}

function normalized(value: WorldPoint): WorldPoint {
  const length = magnitude(value);
  return length > 1e-6 ? point(value.x / length, value.y / length) : point(1, 0);
}

function perpendicular(value: WorldPoint): WorldPoint {
  return point(-value.y, value.x);
}

function endpointDistance(
  endpoint: EndpointGeometry,
  direction: WorldPoint,
): number {
  const horizontal =
    Math.abs(direction.x) > 1e-6
      ? endpoint.halfWidth / Math.abs(direction.x)
      : Number.POSITIVE_INFINITY;
  const vertical =
    Math.abs(direction.y) > 1e-6
      ? endpoint.halfHeight / Math.abs(direction.y)
      : Number.POSITIVE_INFINITY;
  return Math.min(horizontal, vertical);
}

function quadraticPoint(
  start: WorldPoint,
  control: WorldPoint,
  end: WorldPoint,
  t: number,
): WorldPoint {
  const inverse = 1 - t;
  return point(
    inverse * inverse * start.x + 2 * inverse * t * control.x + t * t * end.x,
    inverse * inverse * start.y + 2 * inverse * t * control.y + t * t * end.y,
  );
}

function cubicPoint(
  start: WorldPoint,
  control1: WorldPoint,
  control2: WorldPoint,
  end: WorldPoint,
  t: number,
): WorldPoint {
  const inverse = 1 - t;
  return point(
    inverse ** 3 * start.x +
      3 * inverse * inverse * t * control1.x +
      3 * inverse * t * t * control2.x +
      t ** 3 * end.x,
    inverse ** 3 * start.y +
      3 * inverse * inverse * t * control1.y +
      3 * inverse * t * t * control2.y +
      t ** 3 * end.y,
  );
}

function arrowheadPath(tip: WorldPoint, tangent: WorldPoint): string {
  const direction = normalized(tangent);
  const normal = perpendicular(direction);
  const base = add(tip, multiply(direction, -14));
  const left = add(base, multiply(normal, 7));
  const right = add(base, multiply(normal, -7));
  return `M ${svgNumber(tip.x)} ${svgNumber(tip.y)} L ${svgNumber(left.x)} ${svgNumber(left.y)} L ${svgNumber(right.x)} ${svgNumber(right.y)} Z`;
}

function edgeLabelOffset(edge: Edge, tangent: WorldPoint): WorldPoint {
  if (edge.options.labelAlignment === "centre" || edge.options.labelAlignment === "over") {
    return point(0, 0);
  }
  const side = edge.options.labelAlignment === "left" ? -1 : 1;
  return multiply(perpendicular(normalized(tangent)), side * 18);
}

function includePoint(bounds: MutableBounds, value: WorldPoint, padding = 0): void {
  bounds.minX = Math.min(bounds.minX, value.x - padding);
  bounds.minY = Math.min(bounds.minY, value.y - padding);
  bounds.maxX = Math.max(bounds.maxX, value.x + padding);
  bounds.maxY = Math.max(bounds.maxY, value.y + padding);
}

function finishBounds(bounds: MutableBounds): WorldBounds {
  if (!Number.isFinite(bounds.minX)) {
    return {
      minX: -DOCUMENT_GRID_SIZE * 2,
      minY: -DOCUMENT_GRID_SIZE * 2,
      maxX: DOCUMENT_GRID_SIZE * 2,
      maxY: DOCUMENT_GRID_SIZE * 2,
    };
  }
  const padding = DOCUMENT_GRID_SIZE * 0.75;
  return {
    minX: bounds.minX - padding,
    minY: bounds.minY - padding,
    maxX: bounds.maxX + padding,
    maxY: bounds.maxY + padding,
  };
}

function gridPaths(bounds: WorldBounds): {
  readonly gridPath: string;
  readonly axisPath: string;
} {
  const horizontalSpan = Math.max(1, (bounds.maxX - bounds.minX) / DOCUMENT_GRID_SIZE);
  const verticalSpan = Math.max(1, (bounds.maxY - bounds.minY) / DOCUMENT_GRID_SIZE);
  const maximumSpan = Math.max(horizontalSpan, verticalSpan);
  const stridePower = Math.max(0, Math.ceil(Math.log2(maximumSpan / 180)));
  const stride = DOCUMENT_GRID_SIZE * 2 ** stridePower;
  const padding = stride * 10;
  const minX = Math.floor((bounds.minX - padding) / stride) * stride;
  const maxX = Math.ceil((bounds.maxX + padding) / stride) * stride;
  const minY = Math.floor((bounds.minY - padding) / stride) * stride;
  const maxY = Math.ceil((bounds.maxY + padding) / stride) * stride;
  const grid: string[] = [];

  for (let x = minX; x <= maxX + stride / 2; x += stride) {
    const segment = `M ${svgNumber(x)} ${svgNumber(minY)} L ${svgNumber(x)} ${svgNumber(maxY)}`;
    grid.push(segment);
  }
  for (let y = minY; y <= maxY + stride / 2; y += stride) {
    const segment = `M ${svgNumber(minX)} ${svgNumber(y)} L ${svgNumber(maxX)} ${svgNumber(y)}`;
    grid.push(segment);
  }
  return { gridPath: grid.join(" "), axisPath: "" };
}

function edgeLevel(
  edge: Edge,
  edgeById: ReadonlyMap<EntityId, Edge>,
  memo: Map<EntityId, number>,
  visiting: Set<EntityId>,
): number {
  const cached = memo.get(edge.id);
  if (cached !== undefined) {
    return cached;
  }
  if (visiting.has(edge.id)) {
    return 1;
  }
  visiting.add(edge.id);
  const source = edgeById.get(edge.sourceId);
  const target = edgeById.get(edge.targetId);
  const level =
    1 +
    Math.max(
      source === undefined ? 0 : edgeLevel(source, edgeById, memo, visiting),
      target === undefined ? 0 : edgeLevel(target, edgeById, memo, visiting),
    );
  visiting.delete(edge.id);
  const bounded = clamp(level, 1, 4);
  memo.set(edge.id, bounded);
  return bounded;
}

function regularEdgeGeometry(
  edge: Edge,
  source: EndpointGeometry,
  target: EndpointGeometry,
  measureEdgeLabel: TextMeasurer,
  level: number,
): EdgeGeometry {
  const centerDelta = subtract(target.point, source.point);
  const centerDirection = normalized(centerDelta);
  const normal = perpendicular(centerDirection);
  const curve = finite(edge.options.curve) * EDGE_CURVE_UNIT;
  const offset = finite(edge.options.offset) * 4;
  const control = add(
    multiply(add(source.point, target.point), 0.5),
    multiply(normal, curve + offset),
  );
  const startDirection = normalized(subtract(control, source.point));
  const endDirection = normalized(subtract(target.point, control));
  const startInset =
    endpointDistance(source, startDirection) + Math.max(0, finite(edge.options.shorten.source)) * 2;
  const endInset =
    endpointDistance(target, multiply(endDirection, -1)) +
    Math.max(0, finite(edge.options.shorten.target)) * 2;
  const start = add(source.point, multiply(startDirection, startInset));
  const end = add(target.point, multiply(endDirection, -endInset));
  const samples = Array.from({ length: 25 }, (_, index) =>
    quadraticPoint(start, control, end, index / 24),
  );
  const labelT = clamp(finite(edge.options.labelPosition, 50) / 100, 0.08, 0.92);
  const rawLabelPoint = quadraticPoint(start, control, end, labelT);
  const tangent = add(
    multiply(subtract(control, start), 2 * (1 - labelT)),
    multiply(subtract(end, control), 2 * labelT),
  );
  const labelPoint = add(rawLabelPoint, edgeLabelOffset(edge, tangent));
  const label = edge.label.trim().length > 0 ? compactLabel(edge.label, MAX_EDGE_LABEL_CHARACTERS) : "";
  const labelWidth = label.length > 0 ? Math.max(18, measureEdgeLabel(label) + 12) : 0;
  const labelHeight = label.length > 0 ? 25 : 0;

  return {
    id: edge.id,
    edge,
    path: `M ${svgNumber(start.x)} ${svgNumber(start.y)} Q ${svgNumber(control.x)} ${svgNumber(control.y)} ${svgNumber(end.x)} ${svgNumber(end.y)}`,
    arrowhead: arrowheadPath(end, subtract(end, control)),
    label,
    labelPoint,
    labelX: labelPoint.x - labelWidth / 2,
    labelBaseline: labelPoint.y + 5,
    labelWidth,
    labelHeight,
    samples,
    level,
  };
}

function loopEdgeGeometry(
  edge: Edge,
  endpoint: EndpointGeometry,
  measureEdgeLabel: TextMeasurer,
  level: number,
): EdgeGeometry {
  const loopRadius =
    Math.max(endpoint.halfWidth, endpoint.halfHeight) +
    34 +
    Math.max(0, finite(edge.options.radius)) * 3;
  const start = point(
    endpoint.point.x + endpoint.halfWidth * 0.72,
    endpoint.point.y - endpoint.halfHeight * 0.7,
  );
  const end = point(
    endpoint.point.x - endpoint.halfWidth * 0.72,
    endpoint.point.y - endpoint.halfHeight * 0.7,
  );
  const control1 = point(endpoint.point.x + loopRadius, endpoint.point.y - loopRadius);
  const control2 = point(endpoint.point.x - loopRadius, endpoint.point.y - loopRadius);
  const samples = Array.from({ length: 33 }, (_, index) =>
    cubicPoint(start, control1, control2, end, index / 32),
  );
  const rawLabelPoint = cubicPoint(start, control1, control2, end, 0.5);
  const label = edge.label.trim().length > 0 ? compactLabel(edge.label, MAX_EDGE_LABEL_CHARACTERS) : "";
  const labelWidth = label.length > 0 ? Math.max(18, measureEdgeLabel(label) + 12) : 0;
  const labelHeight = label.length > 0 ? 25 : 0;
  const labelPoint = point(rawLabelPoint.x, rawLabelPoint.y - 11);

  return {
    id: edge.id,
    edge,
    path: `M ${svgNumber(start.x)} ${svgNumber(start.y)} C ${svgNumber(control1.x)} ${svgNumber(control1.y)} ${svgNumber(control2.x)} ${svgNumber(control2.y)} ${svgNumber(end.x)} ${svgNumber(end.y)}`,
    arrowhead: arrowheadPath(end, subtract(end, control2)),
    label,
    labelPoint,
    labelX: labelPoint.x - labelWidth / 2,
    labelBaseline: labelPoint.y + 5,
    labelWidth,
    labelHeight,
    samples,
    level,
  };
}

export function buildDiagramGeometry(
  document: DiagramDocument,
  measureVertexLabel: TextMeasurer,
  measureEdgeLabel: TextMeasurer,
  dragPreview: DragPreview | null,
): DiagramGeometry {
  const vertexById = new Map<EntityId, VertexGeometry>();
  const vertices: VertexGeometry[] = [];

  for (const vertex of document.vertices) {
    const preview = dragPreview?.id === vertex.id ? dragPreview.point : vertex;
    if (!Number.isFinite(preview.x) || !Number.isFinite(preview.y)) {
      continue;
    }
    const label = compactLabel(vertex.label, MAX_VERTEX_LABEL_CHARACTERS);
    const pointObject = label === "•";
    const width = pointObject
      ? 18
      : Math.max(
          VERTEX_MIN_WIDTH,
          measureVertexLabel(label) + VERTEX_HORIZONTAL_PADDING,
        );
    const height = pointObject ? 18 : VERTEX_HEIGHT;
    // Quiver coordinates name cells. Objects live at the centre of those cells;
    // integer multiples of the grid size are the cell boundaries/corners.
    const center = documentPointToWorldCenter(preview);
    const geometry: VertexGeometry = {
      id: vertex.id,
      vertex,
      center,
      left: center.x - width / 2,
      top: center.y - height / 2,
      width,
      height,
      label,
      labelX: center.x - measureVertexLabel(label) / 2,
      labelBaseline: center.y + 6,
    };
    vertices.push(geometry);
    vertexById.set(vertex.id, geometry);
  }

  const edgeById = new Map(document.edges.map((edge) => [edge.id, edge] as const));
  const edgeGeometryById = new Map<EntityId, EdgeGeometry>();
  const levelById = new Map<EntityId, number>();
  const resolving = new Set<EntityId>();

  const endpointFor = (id: EntityId): EndpointGeometry | null => {
    const vertex = vertexById.get(id);
    if (vertex !== undefined) {
      return {
        point: vertex.center,
        halfWidth: vertex.width / 2,
        halfHeight: vertex.height / 2,
      };
    }
    const edge = resolveEdge(id);
    if (edge === null) {
      return null;
    }
    return { point: edge.labelPoint, halfWidth: 9, halfHeight: 9 };
  };

  const resolveEdge = (id: EntityId): EdgeGeometry | null => {
    const cached = edgeGeometryById.get(id);
    if (cached !== undefined) {
      return cached;
    }
    const edge = edgeById.get(id);
    if (edge === undefined || resolving.has(id)) {
      return null;
    }
    resolving.add(id);
    const source = endpointFor(edge.sourceId);
    const target = endpointFor(edge.targetId);
    resolving.delete(id);
    if (source === null || target === null) {
      return null;
    }
    const level = edgeLevel(edge, edgeById, levelById, new Set());
    const geometry =
      edge.sourceId === edge.targetId
        ? loopEdgeGeometry(edge, source, measureEdgeLabel, level)
        : regularEdgeGeometry(edge, source, target, measureEdgeLabel, level);
    edgeGeometryById.set(id, geometry);
    return geometry;
  };

  for (const edge of document.edges) {
    resolveEdge(edge.id);
  }
  const edges = Array.from(edgeGeometryById.values()).sort(
    (left, right) => left.level - right.level,
  );

  const mutableBounds: MutableBounds = {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  };
  for (const vertex of vertices) {
    includePoint(mutableBounds, point(vertex.left, vertex.top));
    includePoint(
      mutableBounds,
      point(vertex.left + vertex.width, vertex.top + vertex.height),
    );
  }
  for (const edge of edges) {
    for (const sample of edge.samples) {
      includePoint(mutableBounds, sample, 8);
    }
    if (edge.label.length > 0) {
      includePoint(
        mutableBounds,
        point(edge.labelX, edge.labelPoint.y - edge.labelHeight / 2),
      );
      includePoint(
        mutableBounds,
        point(edge.labelX + edge.labelWidth, edge.labelPoint.y + edge.labelHeight / 2),
      );
    }
  }
  const bounds = finishBounds(mutableBounds);
  const paths = gridPaths(bounds);
  return { vertices, edges, bounds, ...paths };
}

function distanceToSegment(
  value: WorldPoint,
  start: WorldPoint,
  end: WorldPoint,
): number {
  const segment = subtract(end, start);
  const lengthSquared = segment.x * segment.x + segment.y * segment.y;
  if (lengthSquared < 1e-6) {
    return magnitude(subtract(value, start));
  }
  const projection = clamp(
    ((value.x - start.x) * segment.x + (value.y - start.y) * segment.y) /
      lengthSquared,
    0,
    1,
  );
  return magnitude(subtract(value, add(start, multiply(segment, projection))));
}

export function screenToDocumentPoint(
  screen: WorldPoint,
  translateX: number,
  translateY: number,
  scale: number,
): GridPoint {
  const safeScale = Number.isFinite(scale) && scale > 1e-6 ? scale : 1;
  return {
    x:
      finite((screen.x - finite(translateX)) / safeScale / DOCUMENT_GRID_SIZE) -
      0.5,
    y:
      finite((screen.y - finite(translateY)) / safeScale / DOCUMENT_GRID_SIZE) -
      0.5,
  };
}

export function screenToWorldPoint(
  screen: WorldPoint,
  translateX: number,
  translateY: number,
  scale: number,
): WorldPoint {
  const safeScale = Number.isFinite(scale) && scale > 1e-6 ? scale : 1;
  return point(
    (screen.x - finite(translateX)) / safeScale,
    (screen.y - finite(translateY)) / safeScale,
  );
}

export function documentPointToWorldCenter(value: GridPoint): WorldPoint {
  return point(
    (finite(value.x) + 0.5) * DOCUMENT_GRID_SIZE,
    (finite(value.y) + 0.5) * DOCUMENT_GRID_SIZE,
  );
}

export function connectionPreviewPath(
  sourceCenter: WorldPoint,
  sourceHalfWidth: number,
  sourceHalfHeight: number,
  pointer: WorldPoint,
): Readonly<{ path: string; arrowhead: string }> | null {
  const delta = subtract(pointer, sourceCenter);
  if (magnitude(delta) < 8) {
    return null;
  }
  const direction = normalized(delta);
  const source: EndpointGeometry = {
    point: sourceCenter,
    halfWidth: Math.max(0, finite(sourceHalfWidth)),
    halfHeight: Math.max(0, finite(sourceHalfHeight)),
  };
  const start = add(
    sourceCenter,
    multiply(direction, endpointDistance(source, direction)),
  );
  return {
    path: `M ${svgNumber(start.x)} ${svgNumber(start.y)} L ${svgNumber(pointer.x)} ${svgNumber(pointer.y)}`,
    arrowhead: arrowheadPath(pointer, delta),
  };
}

export function hitTestVertex(
  geometry: DiagramGeometry,
  screen: WorldPoint,
  translateX: number,
  translateY: number,
  scale: number,
  screenPadding: number,
): VertexGeometry | null {
  const safeScale = Math.max(MIN_VIEWPORT_SCALE, finite(scale, 1));
  const world = point(
    (screen.x - translateX) / safeScale,
    (screen.y - translateY) / safeScale,
  );
  const padding = screenPadding / safeScale;
  for (let index = geometry.vertices.length - 1; index >= 0; index -= 1) {
    const vertex = geometry.vertices[index]!;
    if (
      world.x >= vertex.left - padding &&
      world.x <= vertex.left + vertex.width + padding &&
      world.y >= vertex.top - padding &&
      world.y <= vertex.top + vertex.height + padding
    ) {
      return vertex;
    }
  }
  return null;
}

export function hitTestEntity(
  geometry: DiagramGeometry,
  screen: WorldPoint,
  translateX: number,
  translateY: number,
  scale: number,
  screenPadding: number,
): EntityId | null {
  const vertex = hitTestVertex(
    geometry,
    screen,
    translateX,
    translateY,
    scale,
    screenPadding,
  );
  if (vertex !== null) {
    return vertex.id;
  }

  const safeScale = Math.max(MIN_VIEWPORT_SCALE, finite(scale, 1));
  const world = point(
    (screen.x - translateX) / safeScale,
    (screen.y - translateY) / safeScale,
  );
  const threshold = (EDGE_HIT_SLOP + screenPadding / 2) / safeScale;
  for (let edgeIndex = geometry.edges.length - 1; edgeIndex >= 0; edgeIndex -= 1) {
    const edge = geometry.edges[edgeIndex]!;
    if (
      edge.label.length > 0 &&
      world.x >= edge.labelX - threshold &&
      world.x <= edge.labelX + edge.labelWidth + threshold &&
      world.y >= edge.labelPoint.y - edge.labelHeight / 2 - threshold &&
      world.y <= edge.labelPoint.y + edge.labelHeight / 2 + threshold
    ) {
      return edge.id;
    }
    for (let index = 1; index < edge.samples.length; index += 1) {
      if (
        distanceToSegment(world, edge.samples[index - 1]!, edge.samples[index]!) <=
        threshold
      ) {
        return edge.id;
      }
    }
  }
  return null;
}

export function fitViewportToBounds(
  bounds: WorldBounds,
  width: number,
  height: number,
): { readonly translateX: number; readonly translateY: number; readonly scale: number } {
  const safeWidth = Math.max(1, finite(width, 1));
  const safeHeight = Math.max(1, finite(height, 1));
  const contentWidth = Math.max(DOCUMENT_GRID_SIZE, bounds.maxX - bounds.minX);
  const contentHeight = Math.max(DOCUMENT_GRID_SIZE, bounds.maxY - bounds.minY);
  const padding = Math.min(88, Math.max(28, Math.min(safeWidth, safeHeight) * 0.12));
  const scale = clamp(
    Math.min(
      (safeWidth - padding * 2) / contentWidth,
      (safeHeight - padding * 2) / contentHeight,
      1.35,
    ),
    MIN_VIEWPORT_SCALE,
    MAX_VIEWPORT_SCALE,
  );
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  return {
    translateX: finite(safeWidth / 2 - centerX * scale),
    translateY: finite(safeHeight / 2 - centerY * scale),
    scale,
  };
}

export function clampViewportTranslation(
  candidateX: number,
  candidateY: number,
  scale: number,
  width: number,
  height: number,
  bounds: WorldBounds,
): WorldPoint {
  "worklet";
  const safeScale = Math.max(MIN_VIEWPORT_SCALE, Math.min(MAX_VIEWPORT_SCALE, scale));
  const overscroll = 120;
  const minimumX = width - bounds.maxX * safeScale - overscroll;
  const maximumX = -bounds.minX * safeScale + overscroll;
  const minimumY = height - bounds.maxY * safeScale - overscroll;
  const maximumY = -bounds.minY * safeScale + overscroll;
  return {
    x: clamp(candidateX, Math.min(minimumX, maximumX), Math.max(minimumX, maximumX)),
    y: clamp(candidateY, Math.min(minimumY, maximumY), Math.max(minimumY, maximumY)),
  };
}

export function rubberBand(value: number, minimum: number, maximum: number): number {
  "worklet";
  if (value < minimum) {
    return minimum - (minimum - value) * 0.22;
  }
  if (value > maximum) {
    return maximum + (value - maximum) * 0.22;
  }
  return value;
}

export function hslaToColor(value: Hsla): string {
  const hue = clamp(finite(value[0]), 0, 360);
  const saturation = clamp(finite(value[1]), 0, 100);
  const lightness = clamp(finite(value[2]), 0, 100);
  const alpha = clamp(finite(value[3], 1), 0, 1);
  return `hsla(${hue}, ${saturation}%, ${lightness}%, ${alpha})`;
}
