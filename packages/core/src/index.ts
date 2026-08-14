export const CORE_SCHEMA_VERSION = 1 as const;

export { BLACK_HSLA, DEFAULT_EDGE_OPTIONS } from "./model/defaults";
export { createDeterministicIdFactory, entityId } from "./model/ids";
export {
  DocumentValidationError,
  assertValidDocument,
  entityLevel,
  validateDocument,
} from "./model/validate";
export type { IdFactory } from "./model/ids";
export type {
  ArrowShape,
  DiagramDocument,
  DiagramEntity,
  Edge,
  EdgeOptions,
  EdgeStylePart,
  EntityId,
  GridPoint,
  Hsla,
  LabelAlignment,
  ValidationDiagnostic,
  Vertex,
} from "./model/types";
