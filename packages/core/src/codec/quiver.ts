import {
  Base64DecodeError,
  base64DecodedLength,
  decodeStandardBase64,
  encodeStandardBase64,
} from "./base64";
import { BLACK_HSLA, DEFAULT_EDGE_OPTIONS } from "../model/defaults";
import type { IdFactory } from "../model/ids";
import type {
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
} from "../model/types";
import {
  DocumentValidationError,
  assertValidDocument,
  validateDocument,
} from "../model/validate";

const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024;
const MAX_JSON_DEPTH = 64;
const MAX_WIRE_CELLS = 50_000;
const MAX_ENTITY_LEVEL = 4;
const CANONICAL_URL = "https://q.uiver.app/";

type UnknownRecord = Record<string, unknown>;

export interface QuiverDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly wireCellIndex?: number;
  readonly path?: string;
}

export interface DecodeQuiverOptions {
  readonly idFactory: IdFactory;
  readonly documentId?: string;
  readonly title?: string;
  readonly origin?: GridPoint;
  readonly preferredRenderer?: "katex" | "typst";
}

export type DecodeResult =
  | {
      readonly ok: true;
      readonly document: DiagramDocument;
      readonly diagnostics: readonly QuiverDiagnostic[];
      readonly wireIndexToId: readonly (EntityId | null)[];
    }
  | {
      readonly ok: false;
      readonly diagnostics: readonly QuiverDiagnostic[];
      readonly wireIndexToId: readonly (EntityId | null)[];
    };

export interface EncodedQuiverSelection {
  readonly payload: string;
  readonly selectedWireIndices: readonly number[];
}

export interface QuiverLink {
  readonly payload: string | null;
  readonly renderer: "katex" | "typst";
  readonly macros: string | null;
  readonly macroUrl: string | null;
}

export interface FormatQuiverUrlOptions {
  readonly renderer?: "katex" | "typst";
  readonly macros?: string | null;
  readonly macroUrl?: string | null;
}

class CellDecodeError extends Error {
  readonly code: string;
  readonly path?: string;

  constructor(code: string, message: string, path?: string) {
    super(message);
    this.name = "CellDecodeError";
    this.code = code;
    if (path !== undefined) {
      this.path = path;
    }
  }
}

class FatalDecodeError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "FatalDecodeError";
    this.code = code;
  }
}

function frozenDiagnostic(
  code: string,
  message: string,
  wireCellIndex?: number,
  path?: string,
): QuiverDiagnostic {
  return Object.freeze({
    code,
    message,
    ...(wireCellIndex === undefined ? {} : { wireCellIndex }),
    ...(path === undefined ? {} : { path }),
  });
}

function failure(code: string, message: string): DecodeResult {
  return Object.freeze({
    ok: false,
    diagnostics: Object.freeze([frozenDiagnostic(code, message)]),
    wireIndexToId: Object.freeze([]),
  });
}

function isObjectRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function knownKeys(
  source: UnknownRecord,
  keys: readonly string[],
): UnknownRecord {
  const result = Object.create(null) as UnknownRecord;
  for (const key of keys) {
    if (Object.hasOwn(source, key)) {
      result[key] = source[key];
    }
  }
  return result;
}

function expectRecord(
  value: unknown,
  code: string,
  path: string,
): UnknownRecord {
  if (!isObjectRecord(value)) {
    throw new CellDecodeError(code, `Expected an object at ${path}`, path);
  }
  return value;
}

function readFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new CellDecodeError(
      "invalid-number",
      `Expected a finite number at ${path}`,
      path,
    );
  }
  return value;
}

function readSafeInteger(value: unknown, path: string): number {
  const number = readFiniteNumber(value, path);
  if (!Number.isInteger(number)) {
    throw new CellDecodeError(
      "invalid-number",
      `Expected an integer at ${path}`,
      path,
    );
  }
  if (!Number.isSafeInteger(number)) {
    throw new CellDecodeError(
      "unsafe-integer",
      `Expected a safe integer at ${path}`,
      path,
    );
  }
  return number;
}

function readNatural(value: unknown, path: string): number {
  const number = readSafeInteger(value, path);
  if (number < 0) {
    throw new CellDecodeError(
      "invalid-number",
      `Expected a non-negative integer at ${path}`,
      path,
    );
  }
  return number;
}

function readBoundedNatural(
  value: unknown,
  path: string,
  maximum: number,
): number {
  const number = readNatural(value, path);
  if (number > maximum) {
    throw new CellDecodeError(
      "invalid-number",
      `Expected ${path} to be at most ${maximum}`,
      path,
    );
  }
  return number;
}

function readString(value: unknown, path: string): string {
  if (typeof value !== "string") {
    throw new CellDecodeError(
      "invalid-label",
      `Expected a string at ${path}`,
      path,
    );
  }
  return value;
}

function readColour(value: unknown, path: string): Hsla {
  if (!Array.isArray(value) || value.length < 3 || value.length > 4) {
    throw new CellDecodeError(
      "invalid-colour",
      `Expected an HSLA array at ${path}`,
      path,
    );
  }
  const hue = readNatural(value[0], `${path}[0]`);
  const saturation = readNatural(value[1], `${path}[1]`);
  const lightness = readNatural(value[2], `${path}[2]`);
  const alpha =
    value.length === 4 ? readFiniteNumber(value[3], `${path}[3]`) : 1;
  if (
    hue > 360 ||
    saturation > 100 ||
    lightness > 100 ||
    alpha < 0 ||
    alpha > 1
  ) {
    throw new CellDecodeError(
      "invalid-colour",
      `HSLA component is outside its range at ${path}`,
      path,
    );
  }
  return [hue, saturation, lightness, alpha];
}

function copyColour(colour: Hsla): Hsla {
  return [colour[0], colour[1], colour[2], colour[3]];
}

function readStylePart(
  value: unknown,
  fallback: EdgeStylePart,
  path: string,
): EdgeStylePart {
  if (value === undefined) {
    return fallback.side === undefined
      ? { name: fallback.name }
      : { name: fallback.name, side: fallback.side };
  }
  const part = knownKeys(expectRecord(value, "invalid-option", path), [
    "name",
    "side",
  ]);
  const name =
    part.name === undefined
      ? fallback.name
      : readString(part.name, `${path}.name`);
  if (
    part.side !== undefined &&
    part.side !== "top" &&
    part.side !== "bottom"
  ) {
    throw new CellDecodeError(
      "invalid-option",
      `Invalid style side at ${path}.side`,
      `${path}.side`,
    );
  }
  const side = part.side ?? fallback.side;
  return side === undefined ? { name } : { name, side };
}

function readVisualLevel(value: unknown, path: string): number {
  const level = readNatural(value, path);
  if (level < 1 || level > MAX_ENTITY_LEVEL) {
    throw new CellDecodeError(
      "invalid-visual-level",
      `Visual level must be between 1 and ${MAX_ENTITY_LEVEL}`,
      path,
    );
  }
  return level;
}

function readEdgeOptions(
  value: unknown,
  loop: boolean,
  path: string,
): EdgeOptions {
  const options = knownKeys(expectRecord(value, "invalid-options", path), [
    "label_position",
    "offset",
    "curve",
    "radius",
    "angle",
    "shorten",
    "length",
    "level",
    "shape",
    "colour",
    "edge_alignment",
    "style",
  ]);

  const labelPosition =
    options.label_position === undefined
      ? DEFAULT_EDGE_OPTIONS.labelPosition
      : readBoundedNatural(
          options.label_position,
          `${path}.label_position`,
          100,
        );
  const offset =
    options.offset === undefined
      ? DEFAULT_EDGE_OPTIONS.offset
      : readSafeInteger(options.offset, `${path}.offset`);
  const curve =
    options.curve === undefined
      ? DEFAULT_EDGE_OPTIONS.curve
      : readSafeInteger(options.curve, `${path}.curve`);
  const radius =
    options.radius === undefined
      ? DEFAULT_EDGE_OPTIONS.radius
      : readSafeInteger(options.radius, `${path}.radius`);
  const angle =
    options.angle === undefined
      ? DEFAULT_EDGE_OPTIONS.angle
      : readSafeInteger(options.angle, `${path}.angle`);

  let migratedLength: number | undefined;
  if (options.length !== undefined) {
    migratedLength = readBoundedNatural(options.length, `${path}.length`, 100);
  }

  let shorten: Readonly<{ source: number; target: number }>;
  if (options.shorten !== undefined) {
    const shortenRecord = knownKeys(
      expectRecord(options.shorten, "invalid-option", `${path}.shorten`),
      ["source", "target"],
    );
    const source =
      shortenRecord.source === undefined
        ? 0
        : readNatural(shortenRecord.source, `${path}.shorten.source`);
    const target =
      shortenRecord.target === undefined
        ? 0
        : readNatural(shortenRecord.target, `${path}.shorten.target`);
    if (source + target > 100) {
      throw new CellDecodeError(
        "invalid-option",
        `Shortening exceeds 100 at ${path}.shorten`,
        `${path}.shorten`,
      );
    }
    shorten = { source, target };
  } else if (migratedLength !== undefined) {
    const amount = (100 - migratedLength) / 2;
    shorten = { source: amount, target: amount };
  } else {
    shorten = { source: 0, target: 0 };
  }

  let legacyLevel: number | undefined;
  let styleRecord: UnknownRecord | undefined;
  if (options.style !== undefined) {
    styleRecord = knownKeys(
      expectRecord(options.style, "invalid-option", `${path}.style`),
      ["name", "tail", "body", "head"],
    );
    if (styleRecord.body !== undefined) {
      const rawBody = expectRecord(
        styleRecord.body,
        "invalid-option",
        `${path}.style.body`,
      );
      if (Object.hasOwn(rawBody, "level")) {
        legacyLevel = readVisualLevel(
          rawBody.level,
          `${path}.style.body.level`,
        );
      }
    }
  }
  const explicitLevel =
    options.level === undefined
      ? undefined
      : readVisualLevel(options.level, `${path}.level`);

  let shape: "bezier" | "arc" = loop ? "arc" : "bezier";
  if (options.shape !== undefined) {
    if (options.shape !== "bezier" && options.shape !== "arc") {
      throw new CellDecodeError(
        "invalid-option",
        `Invalid arrow shape at ${path}.shape`,
        `${path}.shape`,
      );
    }
    shape = options.shape;
  }

  const colour =
    options.colour === undefined
      ? copyColour(BLACK_HSLA)
      : readColour(options.colour, `${path}.colour`);

  let edgeAlignment: Readonly<{ source: boolean; target: boolean }> = {
    source: true,
    target: true,
  };
  if (options.edge_alignment !== undefined) {
    const alignment = knownKeys(
      expectRecord(
        options.edge_alignment,
        "invalid-option",
        `${path}.edge_alignment`,
      ),
      ["source", "target"],
    );
    for (const endpoint of ["source", "target"] as const) {
      if (
        alignment[endpoint] !== undefined &&
        typeof alignment[endpoint] !== "boolean"
      ) {
        throw new CellDecodeError(
          "invalid-option",
          `Invalid endpoint alignment at ${path}.edge_alignment.${endpoint}`,
          `${path}.edge_alignment.${endpoint}`,
        );
      }
    }
    edgeAlignment = {
      source: (alignment.source as boolean | undefined) ?? true,
      target: (alignment.target as boolean | undefined) ?? true,
    };
  }

  const styleName =
    styleRecord?.name === undefined
      ? DEFAULT_EDGE_OPTIONS.style.name
      : readString(styleRecord.name, `${path}.style.name`);
  const tail = readStylePart(
    styleRecord?.tail,
    DEFAULT_EDGE_OPTIONS.style.tail,
    `${path}.style.tail`,
  );
  const body = readStylePart(
    styleRecord?.body,
    DEFAULT_EDGE_OPTIONS.style.body,
    `${path}.style.body`,
  );
  const head = readStylePart(
    styleRecord?.head,
    DEFAULT_EDGE_OPTIONS.style.head,
    `${path}.style.head`,
  );

  return {
    labelAlignment: DEFAULT_EDGE_OPTIONS.labelAlignment,
    labelPosition,
    offset,
    curve,
    radius,
    angle,
    shorten,
    level: explicitLevel ?? legacyLevel ?? null,
    colour,
    shape,
    edgeAlignment,
    style: { name: styleName, tail, body, head },
  };
}

function scanJsonLimits(text: string): void {
  let depth = 0;
  let inString = false;
  let escaped = false;
  let topLevelCommas = 0;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === "[" || character === "{") {
      depth += 1;
      if (depth > MAX_JSON_DEPTH) {
        throw new FatalDecodeError(
          "max-depth-exceeded",
          `JSON nesting exceeds ${MAX_JSON_DEPTH}`,
        );
      }
      continue;
    }
    if (character === "]" || character === "}") {
      depth -= 1;
      continue;
    }
    if (character === "," && depth === 1) {
      topLevelCommas += 1;
      if (topLevelCommas - 1 > MAX_WIRE_CELLS) {
        throw new FatalDecodeError(
          "cell-limit-exceeded",
          `Wire cell count exceeds ${MAX_WIRE_CELLS}`,
        );
      }
    }
  }
}

function emptyDocument(options: DecodeQuiverOptions): DiagramDocument {
  return {
    schemaVersion: 1,
    id: options.documentId ?? "imported-quiver",
    title: options.title ?? "Imported Quiver",
    vertices: [],
    edges: [],
    macros: "",
    preferredRenderer: options.preferredRenderer ?? "katex",
  };
}

function decodeWireValue(
  input: unknown,
  options: DecodeQuiverOptions,
): DecodeResult {
  if (!Array.isArray(input) || input.length < 2) {
    return failure("invalid-wire-format", "Expected a Quiver v0 root array");
  }
  const version = input[0];
  if (!Number.isSafeInteger(version) || (version as number) < 0) {
    return failure("invalid-version", "Expected a non-negative safe version");
  }
  if (version !== 0) {
    return failure(
      "unsupported-version",
      `Unsupported Quiver version '${version}'`,
    );
  }
  const vertexCount = input[1];
  if (!Number.isSafeInteger(vertexCount) || (vertexCount as number) < 0) {
    return failure(
      "invalid-vertex-count",
      "Expected a non-negative vertex count",
    );
  }
  const cells = input.slice(2);
  if (cells.length > MAX_WIRE_CELLS) {
    return failure(
      "cell-limit-exceeded",
      `Wire cell count exceeds ${MAX_WIRE_CELLS}`,
    );
  }
  if ((vertexCount as number) > cells.length) {
    return failure(
      "invalid-vertex-count",
      "Vertex count exceeds the available wire cells",
    );
  }

  const origin = options.origin ?? { x: 0, y: 0 };
  if (!Number.isSafeInteger(origin.x) || !Number.isSafeInteger(origin.y)) {
    return failure(
      "invalid-origin",
      "Decode origin must use safe integer coordinates",
    );
  }

  const vertices: Vertex[] = [];
  const edges: Edge[] = [];
  const diagnostics: QuiverDiagnostic[] = [];
  const wireIndexToId: (EntityId | null)[] = [];
  const wireLevels: (number | null)[] = [];
  const occupiedPositions = new Set<string>();
  const usedIds = new Set<EntityId>();

  const reportCellError = (error: unknown, wireCellIndex: number): void => {
    const cellError =
      error instanceof CellDecodeError
        ? error
        : new CellDecodeError("invalid-cell", "Invalid wire cell");
    diagnostics.push(
      frozenDiagnostic(
        cellError.code,
        cellError.message,
        wireCellIndex,
        cellError.path,
      ),
    );
    wireIndexToId.push(null);
    wireLevels.push(null);
  };

  for (
    let wireCellIndex = 0;
    wireCellIndex < cells.length;
    wireCellIndex += 1
  ) {
    const value = cells[wireCellIndex];
    try {
      if (!Array.isArray(value)) {
        throw new CellDecodeError(
          "invalid-cell",
          "Expected a wire cell array",
          `cells[${wireCellIndex}]`,
        );
      }

      if (wireCellIndex < (vertexCount as number)) {
        if (value.length < 2 || value.length > 4) {
          throw new CellDecodeError(
            "invalid-vertex",
            "Vertex arrays must contain between two and four members",
            `cells[${wireCellIndex}]`,
          );
        }
        const wireX = readNatural(value[0], `cells[${wireCellIndex}][0]`);
        const wireY = readNatural(value[1], `cells[${wireCellIndex}][1]`);
        const x = wireX + origin.x;
        const y = wireY + origin.y;
        if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) {
          throw new CellDecodeError(
            "unsafe-integer",
            "Vertex coordinate plus origin exceeds the safe integer range",
            `cells[${wireCellIndex}]`,
          );
        }
        const label =
          value.length >= 3
            ? readString(value[2], `cells[${wireCellIndex}][2]`)
            : "";
        const decodedLabelColour =
          value.length >= 4
            ? readColour(value[3], `cells[${wireCellIndex}][3]`)
            : copyColour(BLACK_HSLA);
        const labelColour =
          label === "" ? copyColour(BLACK_HSLA) : decodedLabelColour;
        const positionKey = JSON.stringify([x, y]);
        if (occupiedPositions.has(positionKey)) {
          throw new CellDecodeError(
            "duplicate-position",
            `Vertex position (${x}, ${y}) is already occupied`,
            `cells[${wireCellIndex}]`,
          );
        }
        const id = options.idFactory();
        if (usedIds.has(id)) {
          throw new CellDecodeError(
            "duplicate-id",
            `ID factory returned duplicate entity ID '${id}'`,
            `cells[${wireCellIndex}]`,
          );
        }
        const created: Vertex = {
          kind: "vertex",
          id,
          x,
          y,
          label,
          labelColour,
        };
        vertices.push(created);
        occupiedPositions.add(positionKey);
        usedIds.add(id);
        wireIndexToId.push(id);
        wireLevels.push(0);
        continue;
      }

      if (value.length < 2 || value.length > 6) {
        throw new CellDecodeError(
          "invalid-edge",
          "Edge arrays must contain between two and six members",
          `cells[${wireCellIndex}]`,
        );
      }
      const endpointIndices = [value[0], value[1]].map((endpoint, index) => {
        if (
          !Number.isSafeInteger(endpoint) ||
          (endpoint as number) < 0 ||
          (endpoint as number) >= wireCellIndex
        ) {
          throw new CellDecodeError(
            "invalid-endpoint-index",
            "Endpoint index must be a non-negative earlier wire cell",
            `cells[${wireCellIndex}][${index}]`,
          );
        }
        return endpoint as number;
      });
      const sourceIndex = endpointIndices[0]!;
      const targetIndex = endpointIndices[1]!;
      const sourceId = wireIndexToId[sourceIndex];
      const targetId = wireIndexToId[targetIndex];
      const sourceLevel = wireLevels[sourceIndex];
      const targetLevel = wireLevels[targetIndex];
      if (
        sourceId === undefined ||
        sourceId === null ||
        targetId === undefined ||
        targetId === null ||
        sourceLevel === undefined ||
        sourceLevel === null ||
        targetLevel === undefined ||
        targetLevel === null
      ) {
        throw new CellDecodeError(
          "missing-endpoint-cell",
          "Endpoint refers to a skipped malformed wire cell",
          `cells[${wireCellIndex}]`,
        );
      }
      const derivedLevel = Math.max(sourceLevel, targetLevel) + 1;
      if (derivedLevel > MAX_ENTITY_LEVEL) {
        throw new CellDecodeError(
          "level-exceeded",
          `Derived edge level ${derivedLevel} exceeds ${MAX_ENTITY_LEVEL}`,
          `cells[${wireCellIndex}]`,
        );
      }
      const label =
        value.length >= 3
          ? readString(value[2], `cells[${wireCellIndex}][2]`)
          : "";
      const alignmentIndex =
        value.length >= 4
          ? readBoundedNatural(value[3], `cells[${wireCellIndex}][3]`, 3)
          : 0;
      const decodedOptions = readEdgeOptions(
        value.length >= 5 ? value[4] : {},
        sourceId === targetId,
        `cells[${wireCellIndex}][4]`,
      );
      const decodedLabelColour =
        value.length >= 6
          ? readColour(value[5], `cells[${wireCellIndex}][5]`)
          : copyColour(BLACK_HSLA);
      const alignments: readonly LabelAlignment[] = [
        "left",
        "centre",
        "right",
        "over",
      ];
      const id = options.idFactory();
      if (usedIds.has(id)) {
        throw new CellDecodeError(
          "duplicate-id",
          `ID factory returned duplicate entity ID '${id}'`,
          `cells[${wireCellIndex}]`,
        );
      }
      const created: Edge = {
        kind: "edge",
        id,
        sourceId,
        targetId,
        label,
        labelColour: label === "" ? copyColour(BLACK_HSLA) : decodedLabelColour,
        options: {
          ...decodedOptions,
          labelAlignment: label === "" ? "left" : alignments[alignmentIndex]!,
        },
      };
      edges.push(created);
      usedIds.add(id);
      wireIndexToId.push(id);
      wireLevels.push(derivedLevel);
    } catch (error) {
      reportCellError(error, wireCellIndex);
    }
  }

  const document: DiagramDocument = {
    ...emptyDocument(options),
    vertices,
    edges,
  };
  const unexpectedDiagnostics = validateDocument(document);
  if (unexpectedDiagnostics.length > 0) {
    const wireIndexById = new Map<EntityId, number>();
    wireIndexToId.forEach((id, index) => {
      if (id !== null) {
        wireIndexById.set(id, index);
      }
    });
    for (const item of unexpectedDiagnostics) {
      diagnostics.push(
        frozenDiagnostic(
          item.code,
          item.message,
          item.entityId === undefined
            ? undefined
            : wireIndexById.get(item.entityId),
          item.path,
        ),
      );
    }
  }

  return Object.freeze({
    ok: true,
    document,
    diagnostics: Object.freeze(diagnostics),
    wireIndexToId: Object.freeze(wireIndexToId),
  });
}

export function decodeQuiverPayload(
  payload: string,
  options: DecodeQuiverOptions,
): DecodeResult {
  if (payload === "") {
    return Object.freeze({
      ok: true,
      document: emptyDocument(options),
      diagnostics: Object.freeze([]),
      wireIndexToId: Object.freeze([]),
    });
  }

  let bytes: Uint8Array;
  try {
    const decodedLength = base64DecodedLength(payload);
    if (decodedLength > MAX_PAYLOAD_BYTES) {
      return failure(
        "payload-too-large",
        `Decoded payload exceeds ${MAX_PAYLOAD_BYTES} bytes`,
      );
    }
    bytes = decodeStandardBase64(payload);
  } catch (error) {
    if (error instanceof Base64DecodeError) {
      return failure("invalid-base64", "Payload is not valid standard base64");
    }
    return failure("invalid-base64", "Payload could not be decoded");
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return failure("invalid-utf8", "Payload is not valid UTF-8");
  }
  if (text === "") {
    return Object.freeze({
      ok: true,
      document: emptyDocument(options),
      diagnostics: Object.freeze([]),
      wireIndexToId: Object.freeze([]),
    });
  }

  try {
    scanJsonLimits(text);
  } catch (error) {
    if (error instanceof FatalDecodeError) {
      return failure(error.code, error.message);
    }
    return failure("invalid-json", "Payload JSON could not be scanned");
  }

  let input: unknown;
  try {
    input = JSON.parse(text) as unknown;
  } catch {
    return failure("invalid-json", "Payload is not valid JSON");
  }
  return decodeWireValue(input, options);
}

function colourEquals(left: Hsla, right: Hsla): boolean {
  return (
    left[0] === right[0] &&
    left[1] === right[1] &&
    left[2] === right[2] &&
    left[3] === right[3]
  );
}

function wireColour(colour: Hsla): readonly number[] {
  return colour[3] === 1
    ? [colour[0], colour[1], colour[2]]
    : [colour[0], colour[1], colour[2], colour[3]];
}

function encodingDiagnostic(
  code: string,
  message: string,
  entityId: EntityId,
  path: string,
): ValidationDiagnostic {
  return Object.freeze({ code, message, entityId, path });
}

function isWireColour(colour: Hsla): boolean {
  return (
    Number.isSafeInteger(colour[0]) &&
    colour[0] >= 0 &&
    colour[0] <= 360 &&
    Number.isSafeInteger(colour[1]) &&
    colour[1] >= 0 &&
    colour[1] <= 100 &&
    Number.isSafeInteger(colour[2]) &&
    colour[2] >= 0 &&
    colour[2] <= 100 &&
    Number.isFinite(colour[3]) &&
    colour[3] >= 0 &&
    colour[3] <= 1
  );
}

function legacyLengthForShorten(
  shorten: Readonly<{ source: number; target: number }>,
): number | null {
  if (
    shorten.source !== shorten.target ||
    shorten.source < 0 ||
    !Number.isFinite(shorten.source)
  ) {
    return null;
  }
  const length = 100 - shorten.source - shorten.target;
  return Number.isSafeInteger(length) && length >= 0 && length <= 100
    ? length
    : null;
}

function isExplicitWireShorten(
  shorten: Readonly<{ source: number; target: number }>,
): boolean {
  return (
    Number.isSafeInteger(shorten.source) &&
    shorten.source >= 0 &&
    Number.isSafeInteger(shorten.target) &&
    shorten.target >= 0 &&
    shorten.source + shorten.target <= 100
  );
}

function assertQuiverEncodable(
  document: DiagramDocument,
  vertices: readonly Vertex[],
  edges: readonly Edge[],
  minimumX: number,
  minimumY: number,
): void {
  const diagnostics: ValidationDiagnostic[] = [];
  const vertexIndexById = new Map(
    document.vertices.map(({ id }, index) => [id, index] as const),
  );
  const edgeIndexById = new Map(
    document.edges.map(({ id }, index) => [id, index] as const),
  );

  for (const vertex of vertices) {
    const vertexIndex = vertexIndexById.get(vertex.id)!;
    for (const [property, normalized] of [
      ["x", vertex.x - minimumX],
      ["y", vertex.y - minimumY],
    ] as const) {
      if (!Number.isSafeInteger(normalized) || normalized < 0) {
        diagnostics.push(
          encodingDiagnostic(
            "quiver-wire-coordinate",
            `Vertex '${vertex.id}' has a coordinate outside the Quiver v0 wire domain`,
            vertex.id,
            `vertices[${vertexIndex}].${property}`,
          ),
        );
      }
    }
    if (!isWireColour(vertex.labelColour)) {
      diagnostics.push(
        encodingDiagnostic(
          "quiver-wire-colour",
          `Vertex '${vertex.id}' has a label colour outside the Quiver v0 wire domain`,
          vertex.id,
          `vertices[${vertexIndex}].labelColour`,
        ),
      );
    }
  }

  for (const edge of edges) {
    const edgeIndex = edgeIndexById.get(edge.id)!;
    const optionPath = `edges[${edgeIndex}].options`;
    const requiredShape = edge.sourceId === edge.targetId ? "arc" : "bezier";
    if (edge.options.shape !== requiredShape) {
      diagnostics.push(
        encodingDiagnostic(
          "quiver-shape-mismatch",
          `Edge '${edge.id}' must use ${requiredShape} shape for its endpoints`,
          edge.id,
          `${optionPath}.shape`,
        ),
      );
    }
    const boundedNumbers = [
      ["labelPosition", edge.options.labelPosition, 0, 100],
      [
        "offset",
        edge.options.offset,
        Number.MIN_SAFE_INTEGER,
        Number.MAX_SAFE_INTEGER,
      ],
      [
        "curve",
        edge.options.curve,
        Number.MIN_SAFE_INTEGER,
        Number.MAX_SAFE_INTEGER,
      ],
      [
        "radius",
        edge.options.radius,
        Number.MIN_SAFE_INTEGER,
        Number.MAX_SAFE_INTEGER,
      ],
      [
        "angle",
        edge.options.angle,
        Number.MIN_SAFE_INTEGER,
        Number.MAX_SAFE_INTEGER,
      ],
    ] as const;
    for (const [property, value, minimum, maximum] of boundedNumbers) {
      if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
        diagnostics.push(
          encodingDiagnostic(
            "quiver-wire-number",
            `Edge '${edge.id}' has a ${property} value outside the Quiver v0 wire domain`,
            edge.id,
            `${optionPath}.${property}`,
          ),
        );
      }
    }

    const { shorten } = edge.options;
    if (
      !isExplicitWireShorten(shorten) &&
      legacyLengthForShorten(shorten) === null
    ) {
      let path = `${optionPath}.shorten`;
      if (
        shorten.source < 0 ||
        (Number.isInteger(shorten.source) &&
          !Number.isSafeInteger(shorten.source))
      ) {
        path = `${optionPath}.shorten.source`;
      } else if (
        shorten.target < 0 ||
        (Number.isInteger(shorten.target) &&
          !Number.isSafeInteger(shorten.target))
      ) {
        path = `${optionPath}.shorten.target`;
      }
      diagnostics.push(
        encodingDiagnostic(
          "quiver-wire-shorten",
          `Edge '${edge.id}' has shortening outside the Quiver v0 wire domain`,
          edge.id,
          path,
        ),
      );
    }

    for (const [colour, path, description] of [
      [edge.labelColour, `edges[${edgeIndex}].labelColour`, "label"],
      [edge.options.colour, `${optionPath}.colour`, "arrow"],
    ] as const) {
      if (!isWireColour(colour)) {
        diagnostics.push(
          encodingDiagnostic(
            "quiver-wire-colour",
            `Edge '${edge.id}' has a ${description} colour outside the Quiver v0 wire domain`,
            edge.id,
            path,
          ),
        );
      }
    }
  }

  if (diagnostics.length > 0) {
    throw new DocumentValidationError(diagnostics);
  }
}

function deriveLevels(
  document: DiagramDocument,
): ReadonlyMap<EntityId, number> {
  const levels = new Map<EntityId, number>();
  for (const vertex of document.vertices) {
    levels.set(vertex.id, 0);
  }
  const unresolved = new Set(document.edges.map((_, index) => index));
  while (unresolved.size > 0) {
    let progressed = false;
    for (const index of unresolved) {
      const edge = document.edges[index]!;
      const sourceLevel = levels.get(edge.sourceId);
      const targetLevel = levels.get(edge.targetId);
      if (sourceLevel === undefined || targetLevel === undefined) {
        continue;
      }
      levels.set(edge.id, Math.max(sourceLevel, targetLevel) + 1);
      unresolved.delete(index);
      progressed = true;
    }
    if (!progressed) {
      throw new DocumentValidationError([
        {
          code: "level-unavailable",
          message: "Could not derive all edge levels for encoding",
        },
      ]);
    }
  }
  return levels;
}

function stylePartDelta(
  part: EdgeStylePart,
  fallback: EdgeStylePart,
): UnknownRecord {
  const delta: UnknownRecord = {};
  if (part.name !== fallback.name) {
    delta.name = part.name;
  }
  if (part.side !== fallback.side && part.side !== undefined) {
    delta.side = part.side;
  }
  return delta;
}

function edgeOptionDelta(edge: Edge, structuralLevel: number): UnknownRecord {
  const { options } = edge;
  const delta: UnknownRecord = {};
  if (options.labelPosition !== DEFAULT_EDGE_OPTIONS.labelPosition) {
    delta.label_position = options.labelPosition;
  }
  if (options.offset !== DEFAULT_EDGE_OPTIONS.offset) {
    delta.offset = options.offset;
  }
  if (
    options.shape === "bezier" &&
    options.curve !== DEFAULT_EDGE_OPTIONS.curve
  ) {
    delta.curve = options.curve;
  }
  if (
    options.shape === "arc" &&
    options.radius !== DEFAULT_EDGE_OPTIONS.radius
  ) {
    delta.radius = options.radius;
  }
  if (options.shape === "arc" && options.angle !== DEFAULT_EDGE_OPTIONS.angle) {
    delta.angle = options.angle;
  }

  if (isExplicitWireShorten(options.shorten)) {
    const shorten: UnknownRecord = {};
    if (options.shorten.source !== DEFAULT_EDGE_OPTIONS.shorten.source) {
      shorten.source = options.shorten.source;
    }
    if (options.shorten.target !== DEFAULT_EDGE_OPTIONS.shorten.target) {
      shorten.target = options.shorten.target;
    }
    if (Object.keys(shorten).length > 0) {
      delta.shorten = shorten;
    }
  } else {
    const length = legacyLengthForShorten(options.shorten);
    if (length !== null) {
      delta.length = length;
    }
  }

  const visualLevel = options.level ?? structuralLevel;
  if (visualLevel !== structuralLevel) {
    delta.level = visualLevel;
  }
  if (!colourEquals(options.colour, BLACK_HSLA)) {
    delta.colour = wireColour(options.colour);
  }

  const alignment: UnknownRecord = {};
  if (options.edgeAlignment.source !== true) {
    alignment.source = options.edgeAlignment.source;
  }
  if (options.edgeAlignment.target !== true) {
    alignment.target = options.edgeAlignment.target;
  }
  if (Object.keys(alignment).length > 0) {
    delta.edge_alignment = alignment;
  }

  const style: UnknownRecord = {};
  if (options.style.name !== DEFAULT_EDGE_OPTIONS.style.name) {
    style.name = options.style.name;
  }
  for (const partName of ["tail", "body", "head"] as const) {
    const part = stylePartDelta(
      options.style[partName],
      DEFAULT_EDGE_OPTIONS.style[partName],
    );
    if (Object.keys(part).length > 0) {
      style[partName] = part;
    }
  }
  if (Object.keys(style).length > 0) {
    delta.style = style;
  }
  return delta;
}

function orderedSelection(
  document: DiagramDocument,
  included: ReadonlySet<EntityId>,
  levels: ReadonlyMap<EntityId, number>,
): readonly [vertices: readonly Vertex[], edges: readonly Edge[]] {
  const vertices = document.vertices.filter(({ id }) => included.has(id));
  const edges = document.edges
    .map((edge, storedIndex) => ({ edge, storedIndex }))
    .filter(({ edge }) => included.has(edge.id))
    .sort(
      (left, right) =>
        levels.get(left.edge.id)! - levels.get(right.edge.id)! ||
        left.storedIndex - right.storedIndex,
    )
    .map(({ edge }) => edge);
  return [vertices, edges];
}

function encodeIncluded(
  document: DiagramDocument,
  included: ReadonlySet<EntityId>,
  selected: ReadonlySet<EntityId>,
): EncodedQuiverSelection {
  if (included.size > MAX_WIRE_CELLS) {
    throw new DocumentValidationError([
      Object.freeze({
        code: "quiver-cell-limit",
        message: `Quiver v0 export has ${included.size} cells; maximum is ${MAX_WIRE_CELLS}`,
        path: "wire.cells",
      }),
    ]);
  }
  const levels = deriveLevels(document);
  const [vertices, edges] = orderedSelection(document, included, levels);
  let minimumX = Number.POSITIVE_INFINITY;
  let minimumY = Number.POSITIVE_INFINITY;
  for (const vertex of vertices) {
    minimumX = Math.min(minimumX, vertex.x);
    minimumY = Math.min(minimumY, vertex.y);
  }
  assertQuiverEncodable(document, vertices, edges, minimumX, minimumY);

  const cells: unknown[][] = [];
  const wireIndexById = new Map<EntityId, number>();
  for (const vertex of vertices) {
    wireIndexById.set(vertex.id, cells.length);
    const cell: unknown[] = [vertex.x - minimumX, vertex.y - minimumY];
    if (vertex.label !== "") {
      cell.push(vertex.label);
      if (!colourEquals(vertex.labelColour, BLACK_HSLA)) {
        cell.push(wireColour(vertex.labelColour));
      }
    }
    cells.push(cell);
  }

  const alignmentIndices: Readonly<Record<LabelAlignment, number>> = {
    left: 0,
    centre: 1,
    right: 2,
    over: 3,
  };
  for (const edge of edges) {
    const sourceIndex = wireIndexById.get(edge.sourceId);
    const targetIndex = wireIndexById.get(edge.targetId);
    if (sourceIndex === undefined || targetIndex === undefined) {
      throw new DocumentValidationError([
        {
          code: "selection-not-closed",
          message: `Selection is missing an endpoint of edge '${edge.id}'`,
          entityId: edge.id,
        },
      ]);
    }
    const cell: unknown[] = [sourceIndex, targetIndex];
    const delta = edgeOptionDelta(edge, levels.get(edge.id)!);
    const hasOptions = Object.keys(delta).length > 0;
    const label = edge.label;
    const alignment =
      label === "" ? 0 : alignmentIndices[edge.options.labelAlignment];
    const hasLabelColour =
      label !== "" && !colourEquals(edge.labelColour, BLACK_HSLA);
    if (label !== "" || alignment !== 0 || hasOptions || hasLabelColour) {
      cell.push(label);
    }
    if (alignment !== 0 || hasOptions || hasLabelColour) {
      cell.push(alignment);
    }
    if (hasOptions || hasLabelColour) {
      cell.push(delta);
    }
    if (hasLabelColour) {
      cell.push(wireColour(edge.labelColour));
    }
    wireIndexById.set(edge.id, cells.length);
    cells.push(cell);
  }

  const selectedWireIndices = [...wireIndexById.entries()]
    .filter(([id]) => selected.has(id))
    .map(([, index]) => index)
    .sort((left, right) => left - right);
  const json = JSON.stringify([0, vertices.length, ...cells]);
  const bytes = new TextEncoder().encode(json);
  if (bytes.length > MAX_PAYLOAD_BYTES) {
    throw new DocumentValidationError([
      Object.freeze({
        code: "quiver-payload-too-large",
        message: `Quiver v0 export is ${bytes.length} bytes; maximum is ${MAX_PAYLOAD_BYTES}`,
        path: "wire.payload",
      }),
    ]);
  }
  const payload = encodeStandardBase64(bytes);
  return {
    payload,
    selectedWireIndices: Object.freeze(selectedWireIndices),
  };
}

function allEntities(document: DiagramDocument): readonly DiagramEntity[] {
  return [...document.vertices, ...document.edges];
}

export function encodeQuiverPayload(document: DiagramDocument): string {
  assertValidDocument(document);
  const ids = new Set(allEntities(document).map(({ id }) => id));
  return encodeIncluded(document, ids, ids).payload;
}

export function encodeQuiverSelection(
  document: DiagramDocument,
  ids: readonly EntityId[],
): EncodedQuiverSelection {
  assertValidDocument(document);
  const entityById = new Map(
    allEntities(document).map((entity) => [entity.id, entity] as const),
  );
  const selected = new Set<EntityId>();
  for (const [index, id] of ids.entries()) {
    if (!entityById.has(id)) {
      throw new DocumentValidationError([
        {
          code: "entity-missing",
          message: `Selected entity '${id}' does not exist`,
          entityId: id,
          path: `ids[${index}]`,
        },
      ]);
    }
    selected.add(id);
  }

  const included = new Set(selected);
  const pending = [...selected];
  while (pending.length > 0) {
    const id = pending.pop()!;
    const entity = entityById.get(id)!;
    if (entity.kind !== "edge") {
      continue;
    }
    for (const endpointId of [entity.sourceId, entity.targetId]) {
      if (!included.has(endpointId)) {
        included.add(endpointId);
        pending.push(endpointId);
      }
    }
  }
  return encodeIncluded(document, included, selected);
}

function decodeUrlComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function addRawParameters(target: Map<string, string>, text: string): void {
  if (text === "") {
    return;
  }
  for (const segment of text.split("&")) {
    const separator = segment.indexOf("=");
    const rawKey = separator === -1 ? segment : segment.slice(0, separator);
    const rawValue = separator === -1 ? "" : segment.slice(separator + 1);
    target.set(decodeUrlComponent(rawKey), decodeUrlComponent(rawValue));
  }
}

export function parseQuiverUrl(text: string): QuiverLink {
  const fragmentIndex = text.indexOf("#");
  const fragment = fragmentIndex === -1 ? "" : text.slice(fragmentIndex + 1);
  const beforeFragment =
    fragmentIndex === -1 ? text : text.slice(0, fragmentIndex);
  const queryIndex = beforeFragment.indexOf("?");
  const query = queryIndex === -1 ? "" : beforeFragment.slice(queryIndex + 1);
  const parameters = new Map<string, string>();
  addRawParameters(parameters, fragment);
  addRawParameters(parameters, query);

  const renderer = parameters.get("r") === "typst" ? "typst" : "katex";
  return {
    payload: parameters.get("q") ?? null,
    renderer,
    macros: parameters.get("macros") ?? null,
    macroUrl: parameters.get("macro_url") ?? null,
  };
}

export function formatQuiverUrl(
  document: DiagramDocument,
  options: FormatQuiverUrlOptions = {},
): string {
  assertValidDocument(document);
  if (document.vertices.length === 0 && document.edges.length === 0) {
    return CANONICAL_URL;
  }
  const renderer = options.renderer ?? document.preferredRenderer;
  const parameters: string[] = [];
  if (renderer === "typst") {
    parameters.push("r=typst");
  }
  parameters.push(`q=${encodeQuiverPayload(document)}`);
  const macros =
    options.macros === undefined ? document.macros : options.macros;
  if (macros !== null && macros.trim() !== "") {
    parameters.push(`macros=${encodeURIComponent(macros)}`);
  } else if (
    options.macroUrl !== undefined &&
    options.macroUrl !== null &&
    options.macroUrl.trim() !== ""
  ) {
    parameters.push(`macro_url=${encodeURIComponent(options.macroUrl)}`);
  }
  return `${CANONICAL_URL}#${parameters.join("&")}`;
}
