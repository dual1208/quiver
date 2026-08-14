import type { DiagramDocument } from "../model/types";
import { applyCommand, invertCommand } from "./basic";
import type { CommandTransaction, DocumentCommand } from "./types";

const DEFAULT_HISTORY_LIMIT = 200;

export interface HistoryEntry {
  readonly forward: CommandTransaction;
  readonly inverse: CommandTransaction;
}

export interface HistoryState {
  readonly document: DiagramDocument;
  readonly past: readonly HistoryEntry[];
  readonly future: readonly HistoryEntry[];
  readonly limit: number;
  readonly canMergeWithPrevious: boolean;
}

function applyTransaction(
  document: DiagramDocument,
  transaction: CommandTransaction,
): DiagramDocument {
  return transaction.commands.reduce(applyCommand, document);
}

function prepareEntry(
  document: DiagramDocument,
  transaction: CommandTransaction,
): readonly [document: DiagramDocument, entry: HistoryEntry] {
  let current = document;
  const inverseCommands: DocumentCommand[] = [];

  for (const command of transaction.commands) {
    const inverse = invertCommand(current, command);
    current = applyCommand(current, command);
    inverseCommands.unshift(inverse);
  }

  const forward: CommandTransaction = {
    commands: [...transaction.commands],
    ...(transaction.mergeKey === undefined
      ? {}
      : { mergeKey: transaction.mergeKey }),
  };
  return [
    current,
    {
      forward,
      inverse: { commands: inverseCommands },
    },
  ];
}

function retainNewest(
  entries: readonly HistoryEntry[],
  limit: number,
): readonly HistoryEntry[] {
  return limit === 0 ? [] : entries.slice(-limit);
}

export function createHistory(
  document: DiagramDocument,
  limit = DEFAULT_HISTORY_LIMIT,
): HistoryState {
  if (!Number.isInteger(limit) || limit < 0) {
    throw new RangeError("History limit must be a non-negative integer");
  }
  return {
    document,
    past: [],
    future: [],
    limit,
    canMergeWithPrevious: false,
  };
}

export function commitTransaction(
  state: HistoryState,
  transaction: CommandTransaction,
): HistoryState {
  if (transaction.commands.length === 0) {
    return state;
  }

  const [document, entry] = prepareEntry(state.document, transaction);
  const previous = state.past.at(-1);
  const shouldMerge =
    transaction.mergeKey !== undefined &&
    state.canMergeWithPrevious &&
    previous?.forward.mergeKey === transaction.mergeKey;

  let nextPast: readonly HistoryEntry[];
  if (shouldMerge && previous !== undefined) {
    const merged: HistoryEntry = {
      forward: {
        commands: [...previous.forward.commands, ...entry.forward.commands],
        mergeKey: transaction.mergeKey,
      },
      inverse: {
        commands: [...entry.inverse.commands, ...previous.inverse.commands],
      },
    };
    nextPast = [...state.past.slice(0, -1), merged];
  } else {
    nextPast = retainNewest([...state.past, entry], state.limit);
  }

  return {
    document,
    past: nextPast,
    future: [],
    limit: state.limit,
    canMergeWithPrevious: state.limit > 0,
  };
}

export function undo(state: HistoryState): HistoryState {
  const entry = state.past.at(-1);
  if (entry === undefined) {
    return state;
  }

  return {
    document: applyTransaction(state.document, entry.inverse),
    past: state.past.slice(0, -1),
    future: [...state.future, entry],
    limit: state.limit,
    canMergeWithPrevious: false,
  };
}

export function redo(state: HistoryState): HistoryState {
  const entry = state.future.at(-1);
  if (entry === undefined) {
    return state;
  }

  return {
    document: applyTransaction(state.document, entry.forward),
    past: retainNewest([...state.past, entry], state.limit),
    future: state.future.slice(0, -1),
    limit: state.limit,
    canMergeWithPrevious: false,
  };
}
