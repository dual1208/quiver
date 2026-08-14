import type { EntityId } from "./types";

export type IdFactory = () => EntityId;

export function entityId(value: string): EntityId {
  return value as EntityId;
}

export function createDeterministicIdFactory(prefix = "entity"): IdFactory {
  let sequence = 0;
  return () => {
    sequence += 1;
    return entityId(`${prefix}-${sequence}`);
  };
}
