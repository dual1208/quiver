import type { SQLiteDatabase } from "expo-sqlite";

import { DiagramRepositoryError } from "./errors";

export const DEFAULT_DIAGRAM_DATABASE_NAME = "quiver-native.db";
export const DIAGRAM_SCHEMA_VERSION = 1;

const connectionPragmas = `
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
`;

const migrations: ReadonlyArray<
  Readonly<{ version: number; statements: string }>
> = [
  {
    version: 1,
    statements: `
CREATE TABLE IF NOT EXISTS diagrams (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  document_json TEXT NOT NULL,
  source_macro_url TEXT,
  vertex_count INTEGER NOT NULL CHECK (vertex_count >= 0),
  edge_count INTEGER NOT NULL CHECK (edge_count >= 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS diagrams_updated
  ON diagrams(updated_at DESC, id ASC);
`,
  },
];

type UserVersionRow = Readonly<{ user_version: number }>;

export async function initializeDiagramSchema(
  database: SQLiteDatabase,
): Promise<void> {
  await database.execAsync(connectionPragmas);
  const versionRow = await database.getFirstAsync<UserVersionRow>(
    "PRAGMA user_version",
  );
  const currentVersion = versionRow?.user_version ?? 0;

  if (!Number.isSafeInteger(currentVersion) || currentVersion < 0) {
    throw new DiagramRepositoryError(
      "database-version-unsupported",
      `Invalid diagram database version '${String(currentVersion)}'`,
    );
  }
  if (currentVersion > DIAGRAM_SCHEMA_VERSION) {
    throw new DiagramRepositoryError(
      "database-version-unsupported",
      `Diagram database version ${currentVersion} is newer than supported version ${DIAGRAM_SCHEMA_VERSION}`,
    );
  }

  for (const migration of migrations) {
    if (migration.version <= currentVersion) {
      continue;
    }
    await database.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.execAsync(`
PRAGMA busy_timeout = 5000;
${migration.statements}
PRAGMA user_version = ${migration.version};
`);
    });
  }
}
