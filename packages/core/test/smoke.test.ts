import { describe, expect, it } from "vitest";
import { CORE_SCHEMA_VERSION } from "../src/index";

describe("@quiver/core", () => {
  it("exports schema version one", () => expect(CORE_SCHEMA_VERSION).toBe(1));
});
