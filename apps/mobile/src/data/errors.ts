import type { QuiverDiagnostic } from "@quiver/core";

export type DiagramRepositoryErrorCode =
  | "corrupt-document"
  | "database-version-unsupported"
  | "document-not-found"
  | "id-generation-failed"
  | "invalid-document"
  | "invalid-quiver-url"
  | "quiver-import-failed";

export class DiagramRepositoryError extends Error {
  readonly code: DiagramRepositoryErrorCode;
  readonly diagnostics: readonly QuiverDiagnostic[];

  constructor(
    code: DiagramRepositoryErrorCode,
    message: string,
    options: Readonly<{
      cause?: unknown;
      diagnostics?: readonly QuiverDiagnostic[];
    }> = {},
  ) {
    super(
      message,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "DiagramRepositoryError";
    this.code = code;
    this.diagnostics = Object.freeze([...(options.diagnostics ?? [])]);
  }
}
