import {
  CORE_SCHEMA_VERSION,
  assertValidDocument,
  decodeQuiverPayload,
  entityId,
  formatQuiverUrl,
  parseQuiverUrl,
  type DiagramDocument,
  type FormatQuiverUrlOptions,
} from "@quiver/core";
import {
  openDatabaseAsync,
  type SQLiteDatabase,
} from "expo-sqlite";

import { DiagramRepositoryError } from "./errors";
import {
  DEFAULT_DIAGRAM_DATABASE_NAME,
  initializeDiagramSchema,
} from "./schema";

export type DiagramSummary = Readonly<{
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  vertexCount: number;
  edgeCount: number;
}>;

export type DiagramRecord = Readonly<{
  document: DiagramDocument;
  createdAt: number;
  updatedAt: number;
}>;

export type DiagramRepositoryOptions = Readonly<{
  databaseName?: string;
  now?: () => number;
  openDatabase?: (databaseName: string) => Promise<SQLiteDatabase>;
}>;

type SummaryRow = Readonly<{
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  vertex_count: number;
  edge_count: number;
}>;

type StoredRow = SummaryRow &
  Readonly<{
    document_json: string;
    source_macro_url: string | null;
  }>;

type RandomIdRow = Readonly<{ value: string }>;
type TitleRow = Readonly<{ title: string }>;

type SqlConnection = Pick<
  SQLiteDatabase,
  "getAllAsync" | "getFirstAsync" | "runAsync"
>;

const selectStoredColumns = `
SELECT
  id,
  title,
  document_json,
  source_macro_url,
  vertex_count,
  edge_count,
  created_at,
  updated_at
FROM diagrams
`;

function summaryFromRow(row: SummaryRow): DiagramSummary {
  return Object.freeze({
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    vertexCount: row.vertex_count,
    edgeCount: row.edge_count,
  });
}

function assertDocumentEnvelope(
  value: unknown,
): asserts value is DiagramDocument {
  if (
    typeof value !== "object" ||
    value === null ||
    (value as Partial<DiagramDocument>).schemaVersion !== CORE_SCHEMA_VERSION ||
    typeof (value as Partial<DiagramDocument>).id !== "string" ||
    (value as Partial<DiagramDocument>).id === "" ||
    typeof (value as Partial<DiagramDocument>).title !== "string" ||
    !Array.isArray((value as Partial<DiagramDocument>).vertices) ||
    !Array.isArray((value as Partial<DiagramDocument>).edges) ||
    typeof (value as Partial<DiagramDocument>).macros !== "string" ||
    ((value as Partial<DiagramDocument>).preferredRenderer !== "katex" &&
      (value as Partial<DiagramDocument>).preferredRenderer !== "typst")
  ) {
    throw new Error("Invalid DiagramDocument envelope");
  }
}

function parseStoredDocument(row: StoredRow): DiagramDocument {
  try {
    const value: unknown = JSON.parse(row.document_json);
    assertDocumentEnvelope(value);
    assertValidDocument(value);
    if (value.id !== row.id || value.title !== row.title) {
      throw new Error("Stored document metadata does not match its JSON body");
    }
    return value;
  } catch (error) {
    throw new DiagramRepositoryError(
      "corrupt-document",
      `Stored diagram '${row.id}' is not a valid DiagramDocument`,
      { cause: error },
    );
  }
}

function serializeDocument(document: DiagramDocument): string {
  try {
    assertDocumentEnvelope(document);
    assertValidDocument(document);
    const body = JSON.stringify(document);
    if (body === undefined) {
      throw new Error("DiagramDocument could not be serialized");
    }
    return body;
  } catch (error) {
    throw new DiagramRepositoryError(
      "invalid-document",
      `Diagram '${String(document.id)}' is not valid and was not saved`,
      { cause: error },
    );
  }
}

function recordFromRow(row: StoredRow): DiagramRecord {
  return Object.freeze({
    document: parseStoredDocument(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function normalizedTitle(title: string): string {
  return title.normalize("NFC").toLowerCase();
}

export class DiagramRepository {
  readonly databaseName: string;

  private readonly now: () => number;
  private readonly openDatabase: (
    databaseName: string,
  ) => Promise<SQLiteDatabase>;
  private databasePromise: Promise<SQLiteDatabase> | null = null;
  private initializationPromise: Promise<SQLiteDatabase> | null = null;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(options: DiagramRepositoryOptions = {}) {
    this.databaseName = options.databaseName ?? DEFAULT_DIAGRAM_DATABASE_NAME;
    this.now = options.now ?? Date.now;
    this.openDatabase = options.openDatabase ?? openDatabaseAsync;
  }

  async initialize(): Promise<void> {
    await this.readyDatabase();
  }

  async createUntitled(title?: string): Promise<DiagramRecord> {
    return this.enqueueWrite(async (database) => {
      let storedRow: StoredRow | null = null;
      await database.withExclusiveTransactionAsync(async (transaction) => {
        const id = await this.generateDocumentId(transaction);
        const resolvedTitle =
          title ??
          (await this.findAvailableTitle(transaction, "Untitled diagram"));
        const document: DiagramDocument = {
          schemaVersion: CORE_SCHEMA_VERSION,
          id,
          title: resolvedTitle,
          vertices: [],
          edges: [],
          macros: "",
          preferredRenderer: "katex",
        };
        const body = serializeDocument(document);
        const timestamp = this.timestamp();
        await this.insertDocument(transaction, document, body, null, timestamp);
        storedRow = await this.requireStoredRow(transaction, id);
      });
      return recordFromRow(this.requireCapturedRow(storedRow));
    });
  }

  async listSummaries(): Promise<readonly DiagramSummary[]> {
    const database = await this.readyDatabase();
    const rows = await database.getAllAsync<SummaryRow>(`
SELECT id, title, vertex_count, edge_count, created_at, updated_at
FROM diagrams
ORDER BY updated_at DESC, id ASC
`);
    return Object.freeze(rows.map(summaryFromRow));
  }

  async get(id: string): Promise<DiagramRecord | null> {
    const database = await this.readyDatabase();
    const row = await this.findStoredRow(database, id);
    return row === null ? null : recordFromRow(row);
  }

  async save(document: DiagramDocument): Promise<DiagramRecord> {
    const body = serializeDocument(document);
    return this.enqueueWrite(async (database) => {
      let storedRow: StoredRow | null = null;
      await database.withExclusiveTransactionAsync(async (transaction) => {
        const timestamp = this.timestamp();
        await transaction.runAsync(
          `
INSERT INTO diagrams (
  id,
  title,
  document_json,
  source_macro_url,
  vertex_count,
  edge_count,
  created_at,
  updated_at
) VALUES (?, ?, ?, NULL, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  title = excluded.title,
  document_json = excluded.document_json,
  vertex_count = excluded.vertex_count,
  edge_count = excluded.edge_count,
  updated_at = MAX(excluded.updated_at, diagrams.updated_at + 1)
`,
          [
            document.id,
            document.title,
            body,
            document.vertices.length,
            document.edges.length,
            timestamp,
            timestamp,
          ],
        );
        storedRow = await this.requireStoredRow(transaction, document.id);
      });
      return recordFromRow(this.requireCapturedRow(storedRow));
    });
  }

  async delete(id: string): Promise<boolean> {
    return this.enqueueWrite(async (database) => {
      let changes = 0;
      await database.withExclusiveTransactionAsync(async (transaction) => {
        const result = await transaction.runAsync(
          "DELETE FROM diagrams WHERE id = ?",
          [id],
        );
        changes = result.changes;
      });
      return changes > 0;
    });
  }

  async duplicate(id: string, title?: string): Promise<DiagramRecord> {
    return this.enqueueWrite(async (database) => {
      let storedRow: StoredRow | null = null;
      await database.withExclusiveTransactionAsync(async (transaction) => {
        const sourceRow = await this.findStoredRow(transaction, id);
        if (sourceRow === null) {
          throw this.notFound(id);
        }
        const source = parseStoredDocument(sourceRow);
        const duplicateId = await this.generateDocumentId(transaction);
        const duplicateTitle =
          title ??
          (await this.findAvailableTitle(transaction, `${source.title} copy`));
        const duplicate: DiagramDocument = {
          ...source,
          id: duplicateId,
          title: duplicateTitle,
        };
        const body = serializeDocument(duplicate);
        const timestamp = this.timestamp();
        await this.insertDocument(
          transaction,
          duplicate,
          body,
          sourceRow.source_macro_url,
          timestamp,
        );
        storedRow = await this.requireStoredRow(transaction, duplicateId);
      });
      return recordFromRow(this.requireCapturedRow(storedRow));
    });
  }

  async importQuiverUrl(url: string, title?: string): Promise<DiagramRecord> {
    this.assertQuiverUrl(url);
    const link = parseQuiverUrl(url);

    return this.enqueueWrite(async (database) => {
      const id = await this.generateDocumentId(database);
      const importedTitle =
        title ?? (await this.findAvailableTitle(database, "Imported diagram"));
      let entityIndex = 0;
      const decoded = decodeQuiverPayload(link.payload ?? "", {
        idFactory: () => entityId(`${id}:entity:${entityIndex++}`),
        documentId: id,
        title: importedTitle,
        preferredRenderer: link.renderer,
      });
      if (!decoded.ok || decoded.diagnostics.length > 0) {
        throw new DiagramRepositoryError(
          "quiver-import-failed",
          "The Quiver URL contains a payload that could not be imported safely",
          { diagnostics: decoded.diagnostics },
        );
      }
      const document: DiagramDocument = {
        ...decoded.document,
        macros: link.macros ?? "",
      };
      const body = serializeDocument(document);
      const sourceMacroUrl =
        link.macros !== null && link.macros.trim() !== ""
          ? null
          : link.macroUrl;
      let storedRow: StoredRow | null = null;
      await database.withExclusiveTransactionAsync(async (transaction) => {
        const timestamp = this.timestamp();
        await this.insertDocument(
          transaction,
          document,
          body,
          sourceMacroUrl,
          timestamp,
        );
        storedRow = await this.requireStoredRow(transaction, id);
      });
      return recordFromRow(this.requireCapturedRow(storedRow));
    });
  }

  async exportQuiverUrl(
    id: string,
    options: FormatQuiverUrlOptions = {},
  ): Promise<string> {
    const database = await this.readyDatabase();
    const row = await this.findStoredRow(database, id);
    if (row === null) {
      throw this.notFound(id);
    }
    const document = parseStoredDocument(row);
    const macroUrl =
      options.macroUrl === undefined ? row.source_macro_url : options.macroUrl;
    return formatQuiverUrl(document, { ...options, macroUrl });
  }

  private async readyDatabase(): Promise<SQLiteDatabase> {
    if (this.initializationPromise !== null) {
      return this.initializationPromise;
    }
    const initialization = (async () => {
      const database = await this.openDatabaseOnce();
      await initializeDiagramSchema(database);
      return database;
    })();
    this.initializationPromise = initialization;
    try {
      return await initialization;
    } catch (error) {
      if (this.initializationPromise === initialization) {
        this.initializationPromise = null;
      }
      throw error;
    }
  }

  private openDatabaseOnce(): Promise<SQLiteDatabase> {
    if (this.databasePromise === null) {
      const attempt = this.openDatabase(this.databaseName);
      this.databasePromise = attempt;
      void attempt.catch(() => {
        if (this.databasePromise === attempt) {
          this.databasePromise = null;
        }
      });
    }
    return this.databasePromise;
  }

  private enqueueWrite<T>(
    operation: (database: SQLiteDatabase) => Promise<T>,
  ): Promise<T> {
    const result = this.writeQueue.then(async () => {
      const database = await this.readyDatabase();
      return operation(database);
    });
    this.writeQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private timestamp(): number {
    const value = this.now();
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new DiagramRepositoryError(
        "invalid-document",
        "The repository clock returned an invalid timestamp",
      );
    }
    return value;
  }

  private async generateDocumentId(connection: SqlConnection): Promise<string> {
    const row = await connection.getFirstAsync<RandomIdRow>(
      "SELECT lower(hex(randomblob(16))) AS value",
    );
    if (row === null || !/^[0-9a-f]{32}$/.test(row.value)) {
      throw new DiagramRepositoryError(
        "id-generation-failed",
        "SQLite could not generate a document identifier",
      );
    }
    return `diagram-${row.value}`;
  }

  private async findAvailableTitle(
    connection: SqlConnection,
    base: string,
  ): Promise<string> {
    const rows = await connection.getAllAsync<TitleRow>(
      "SELECT title FROM diagrams",
    );
    const existing = new Set(rows.map(({ title }) => normalizedTitle(title)));
    if (!existing.has(normalizedTitle(base))) {
      return base;
    }
    for (let suffix = 2; suffix < Number.MAX_SAFE_INTEGER; suffix += 1) {
      const candidate = `${base} ${suffix}`;
      if (!existing.has(normalizedTitle(candidate))) {
        return candidate;
      }
    }
    throw new DiagramRepositoryError(
      "invalid-document",
      `Could not allocate a title based on '${base}'`,
    );
  }

  private async insertDocument(
    connection: SqlConnection,
    document: DiagramDocument,
    body: string,
    sourceMacroUrl: string | null,
    timestamp: number,
  ): Promise<void> {
    await connection.runAsync(
      `
INSERT INTO diagrams (
  id,
  title,
  document_json,
  source_macro_url,
  vertex_count,
  edge_count,
  created_at,
  updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`,
      [
        document.id,
        document.title,
        body,
        sourceMacroUrl,
        document.vertices.length,
        document.edges.length,
        timestamp,
        timestamp,
      ],
    );
  }

  private async findStoredRow(
    connection: SqlConnection,
    id: string,
  ): Promise<StoredRow | null> {
    return connection.getFirstAsync<StoredRow>(
      `${selectStoredColumns} WHERE id = ?`,
      [id],
    );
  }

  private async requireStoredRow(
    connection: SqlConnection,
    id: string,
  ): Promise<StoredRow> {
    const row = await this.findStoredRow(connection, id);
    if (row === null) {
      throw this.notFound(id);
    }
    return row;
  }

  private requireCapturedRow(row: StoredRow | null): StoredRow {
    if (row === null) {
      throw new DiagramRepositoryError(
        "corrupt-document",
        "A committed diagram write could not be read back",
      );
    }
    return row;
  }

  private notFound(id: string): DiagramRepositoryError {
    return new DiagramRepositoryError(
      "document-not-found",
      `Diagram '${id}' does not exist`,
    );
  }

  private assertQuiverUrl(text: string): void {
    try {
      const url = new URL(text);
      if (
        (url.protocol !== "https:" && url.protocol !== "http:") ||
        url.hostname !== "q.uiver.app"
      ) {
        throw new Error("Unsupported Quiver URL origin");
      }
    } catch (error) {
      throw new DiagramRepositoryError(
        "invalid-quiver-url",
        "Expected an http(s) URL hosted at q.uiver.app",
        { cause: error },
      );
    }
  }
}

export function createDiagramRepository(
  options: DiagramRepositoryOptions = {},
): DiagramRepository {
  return new DiagramRepository(options);
}

export const diagramRepository = createDiagramRepository();
