export const CORE_SCHEMA_VERSION = 1 as const;

export { BLACK_HSLA, DEFAULT_EDGE_OPTIONS } from "./model/defaults";
export { createDeterministicIdFactory, entityId } from "./model/ids";
export {
  applyCommand,
  createRemoveEntitiesCommand,
  invertCommand,
} from "./commands/basic";
export {
  commitTransaction,
  createHistory,
  redo,
  undo,
} from "./commands/history";
export { CommandError } from "./commands/types";
export {
  DocumentValidationError,
  assertValidDocument,
  entityLevel,
  validateDocument,
} from "./model/validate";
export {
  decodeQuiverPayload,
  encodeQuiverPayload,
  encodeQuiverSelection,
  formatQuiverUrl,
  parseQuiverUrl,
} from "./codec/quiver";
export type { IdFactory } from "./model/ids";
export type {
  DecodeQuiverOptions,
  DecodeResult,
  EncodedQuiverSelection,
  FormatQuiverUrlOptions,
  QuiverDiagnostic,
  QuiverLink,
} from "./codec/quiver";
export type { HistoryEntry, HistoryState } from "./commands/history";
export type {
  CommandErrorCode,
  CommandTransaction,
  DocumentCommand,
} from "./commands/types";
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
