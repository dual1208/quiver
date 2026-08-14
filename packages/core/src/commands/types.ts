import type {
  DiagramDocument,
  DiagramEntity,
  Edge,
  EntityId,
  GridPoint,
  ValidationDiagnostic,
  Vertex,
} from "../model/types";

export type CommandErrorCode =
  "entity-exists" | "entity-missing" | "position-occupied" | "invalid-result";

const COMMAND_ERROR_MESSAGES: Readonly<Record<CommandErrorCode, string>> = {
  "entity-exists": "A command entity already exists in the document",
  "entity-missing": "A command target does not exist in the document",
  "position-occupied": "A command would occupy an existing grid position",
  "invalid-result": "The command precondition or resulting document is invalid",
};

export class CommandError extends Error {
  readonly code: CommandErrorCode;
  readonly diagnostics?: readonly ValidationDiagnostic[];

  constructor(
    code: CommandErrorCode,
    diagnostics?: readonly ValidationDiagnostic[],
  ) {
    super(COMMAND_ERROR_MESSAGES[code]);
    this.name = "CommandError";
    this.code = code;
    if (diagnostics !== undefined) {
      this.diagnostics = Object.freeze([...diagnostics]);
    }
  }
}

export type DocumentCommand =
  | {
      readonly type: "add-entities";
      readonly vertices: readonly Vertex[];
      readonly edges: readonly Edge[];
    }
  | {
      readonly type: "remove-entities";
      readonly ids: readonly EntityId[];
      readonly removed: readonly DiagramEntity[];
    }
  | {
      readonly type: "move-vertices";
      readonly moves: readonly {
        readonly id: EntityId;
        readonly from: GridPoint;
        readonly to: GridPoint;
      }[];
    }
  | {
      readonly type: "update-entity";
      readonly id: EntityId;
      readonly before: DiagramEntity;
      readonly after: DiagramEntity;
    }
  | {
      readonly type: "replace-document";
      readonly before: DiagramDocument;
      readonly after: DiagramDocument;
    };

export interface CommandTransaction {
  readonly commands: readonly DocumentCommand[];
  readonly mergeKey?: string;
}
