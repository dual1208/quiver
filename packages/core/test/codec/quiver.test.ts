import { readFileSync } from "node:fs";

import * as fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  BLACK_HSLA,
  CORE_SCHEMA_VERSION,
  DEFAULT_EDGE_OPTIONS,
  DocumentValidationError,
  createDeterministicIdFactory,
  decodeQuiverPayload,
  encodeQuiverPayload,
  encodeQuiverSelection,
  entityId,
  entityLevel,
  formatQuiverUrl,
  parseQuiverUrl,
  validateDocument,
  type DiagramDocument,
  type Edge,
  type EdgeOptions,
  type EntityId,
  type GridPoint,
  type Hsla,
  type Vertex,
} from "../../src/index";

const FIXTURE_NAMES = [
  "pullback",
  "adjunction",
  "higher-cell",
  "styles",
] as const;
const PROPERTY_RUNS = 500;

interface UpstreamFixture {
  readonly sourceUrl: string;
  readonly payload: string;
  readonly expected: Readonly<{ vertices: number; edges: number }>;
  readonly selectedLabels: readonly string[];
}

function fixture(name: (typeof FIXTURE_NAMES)[number]): UpstreamFixture {
  const url = new URL(
    `../../../test-fixtures/upstream/${name}.json`,
    import.meta.url,
  );
  return JSON.parse(readFileSync(url, "utf8")) as UpstreamFixture;
}

function payloadFor(value: unknown): string {
  return payloadForJson(JSON.stringify(value));
}

function payloadForJson(json: string): string {
  return Buffer.from(json, "utf8").toString("base64");
}

function wireValue(payload: string): unknown {
  return JSON.parse(Buffer.from(payload, "base64").toString("utf8")) as unknown;
}

function vertex(
  id: string,
  x: number,
  y: number,
  label = "",
  labelColour: Hsla = BLACK_HSLA,
): Vertex {
  return {
    kind: "vertex",
    id: entityId(id),
    x,
    y,
    label,
    labelColour,
  };
}

function edge(
  id: string,
  sourceId: EntityId,
  targetId: EntityId,
  label = "",
  options: EdgeOptions = DEFAULT_EDGE_OPTIONS,
  labelColour: Hsla = BLACK_HSLA,
): Edge {
  return {
    kind: "edge",
    id: entityId(id),
    sourceId,
    targetId,
    label,
    labelColour,
    options,
  };
}

function document(
  vertices: readonly Vertex[],
  edges: readonly Edge[] = [],
  preferredRenderer: "katex" | "typst" = "katex",
): DiagramDocument {
  return {
    schemaVersion: CORE_SCHEMA_VERSION,
    id: "codec-document",
    title: "Codec document",
    vertices,
    edges,
    macros: "",
    preferredRenderer,
  };
}

function decodeSuccess(
  payload: string,
  prefix = "decoded",
  origin?: GridPoint,
) {
  const result = decodeQuiverPayload(payload, {
    idFactory: createDeterministicIdFactory(prefix),
    documentId: "codec-document",
    title: "Codec document",
    ...(origin === undefined ? {} : { origin }),
  });
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`Expected decode success: ${result.diagnostics[0]?.code}`);
  }
  return result;
}

function entitySemantics(source: DiagramDocument): unknown {
  const references = new Map<EntityId, string>();
  source.vertices.forEach(({ id }, index) => references.set(id, `v${index}`));
  source.edges.forEach(({ id }, index) => references.set(id, `e${index}`));
  return {
    vertices: source.vertices.map(({ x, y, label, labelColour }) => ({
      x,
      y,
      label,
      labelColour,
    })),
    edges: source.edges.map(
      ({ id, sourceId, targetId, label, labelColour, options }) => ({
        source: references.get(sourceId),
        target: references.get(targetId),
        label,
        labelColour,
        options: {
          ...options,
          level: options.level ?? entityLevel(source, id),
        },
      }),
    ),
  };
}

describe("published Quiver v0 fixtures", () => {
  for (const name of FIXTURE_NAMES) {
    it(`decodes and semantically re-encodes the ${name} README link`, () => {
      const upstream = fixture(name);
      const rawPayload = upstream.sourceUrl.split("?q=")[1];

      expect(rawPayload).toBe(upstream.payload);
      const decoded = decodeSuccess(upstream.payload, `${name}-first`);
      expect(decoded.diagnostics).toEqual([]);
      expect(decoded.document.vertices).toHaveLength(
        upstream.expected.vertices,
      );
      expect(decoded.document.edges).toHaveLength(upstream.expected.edges);
      expect(validateDocument(decoded.document)).toEqual([]);

      const labels = [
        ...decoded.document.vertices,
        ...decoded.document.edges,
      ].map(({ label }) => label);
      for (const selectedLabel of upstream.selectedLabels) {
        expect(labels).toContain(selectedLabel);
      }

      const reencoded = encodeQuiverPayload(decoded.document);
      const roundTripped = decodeSuccess(reencoded, `${name}-second`);
      expect(roundTripped.diagnostics).toEqual([]);
      expect(entitySemantics(roundTripped.document)).toEqual(
        entitySemantics(decoded.document),
      );
    });
  }
});

describe("byte-safe base64 and URL compatibility", () => {
  it("matches the React Native TextEncoder and fatal TextDecoder runtime contract", () => {
    expect(typeof TextEncoder).toBe("function");
    expect(typeof TextDecoder).toBe("function");
    const bytes = new TextEncoder().encode("日本語 😀");
    expect(new TextDecoder("utf-8", { fatal: true }).decode(bytes)).toBe(
      "日本語 😀",
    );
    expect(() =>
      new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from([0xff])),
    ).toThrow();
  });

  it("round-trips TeX slashes, emoji, and Japanese through fatal UTF-8", () => {
    const source = document([
      vertex("v-tex", 0, 0, "\\alpha"),
      vertex("v-emoji", 1, 0, "😀"),
      vertex("v-japanese", 2, 0, "可換図式"),
    ]);

    const decoded = decodeSuccess(encodeQuiverPayload(source));

    expect(decoded.document.vertices.map(({ label }) => label)).toEqual([
      "\\alpha",
      "😀",
      "可換図式",
    ]);
  });

  it("does not require Buffer, atob, or btoa globals", () => {
    const names = ["Buffer", "atob", "btoa"] as const;
    const descriptors = new Map(
      names.map((name) => [
        name,
        Object.getOwnPropertyDescriptor(globalThis, name),
      ]),
    );

    try {
      for (const name of names) {
        Object.defineProperty(globalThis, name, {
          configurable: true,
          value: undefined,
          writable: true,
        });
      }
      const source = document([vertex("v-portable", 0, 0, "日本語 😀")]);
      const payload = encodeQuiverPayload(source);
      const decoded = decodeSuccess(payload, "portable");
      expect(decoded.document.vertices[0]?.label).toBe("日本語 😀");
    } finally {
      for (const name of names) {
        const descriptor = descriptors.get(name);
        if (descriptor === undefined) {
          Reflect.deleteProperty(globalThis, name);
        } else {
          Object.defineProperty(globalThis, name, descriptor);
        }
      }
    }
  });

  it("accepts valid unpadded standard base64", () => {
    const payload = encodeQuiverPayload(
      document([vertex("v-unpadded", 0, 0, "unpadded")]),
    ).replace(/=+$/, "");

    expect(decodeSuccess(payload).document.vertices[0]?.label).toBe("unpadded");
  });

  it("preserves a raw plus in a URL payload", () => {
    const payloadWithPlus = "WzAsMSxbMCwwLCI+Il1d";
    expect(payloadWithPlus).toContain("+");

    const link = parseQuiverUrl(`https://q.uiver.app/?q=${payloadWithPlus}`);

    expect(link.payload).toBe(payloadWithPlus);
    expect(decodeSuccess(link.payload ?? "").document.vertices[0]?.label).toBe(
      ">",
    );
  });

  it("lets raw query parameters override fragment parameters", () => {
    expect(
      parseQuiverUrl(
        "https://q.uiver.app/?q=query&r=typst&macros=%5Cnewcommand%7B%5Cfoo%7D%7BA+B%7D#q=fragment&r=katex&macros=fragment&macro_url=https%3A%2F%2Fexample.com%2Fm%3Fa%3D1%26b%3D2",
      ),
    ).toEqual({
      payload: "query",
      renderer: "typst",
      macros: "\\newcommand{\\foo}{A+B}",
      macroUrl: "https://example.com/m?a=1&b=2",
    });
  });

  it("prefers and preserves inline macros when formatting current Quiver links", () => {
    const inlineMacros = "  \\newcommand{\\foo}{A+B}  ";
    const source = {
      ...document([vertex("v-inline-macro", 0, 0, "\\foo")]),
      macros: inlineMacros,
    };
    const payload = encodeQuiverPayload(source);

    const formatted = formatQuiverUrl(source, {
      macroUrl: "https://example.com/fallback.tex",
    });

    expect(formatted).toBe(
      `https://q.uiver.app/#q=${payload}&macros=${encodeURIComponent(inlineMacros)}`,
    );
    expect(formatted).not.toContain("macro_url=");
    expect(parseQuiverUrl(formatted)).toEqual({
      payload,
      renderer: "katex",
      macros: inlineMacros,
      macroUrl: null,
    });
  });

  it("uses explicit macro options and omits blank macro sources", () => {
    const source = {
      ...document([vertex("v-explicit-macro", 0, 0, "A")]),
      macros: "\\newcommand{\\documentMacro}{D}",
    };
    const payload = encodeQuiverPayload(source);

    expect(
      formatQuiverUrl(source, {
        macros: "\\newcommand{\\optionMacro}{O}",
        macroUrl: "https://example.com/fallback.tex",
      }),
    ).toBe(
      `https://q.uiver.app/#q=${payload}&macros=%5Cnewcommand%7B%5CoptionMacro%7D%7BO%7D`,
    );
    expect(
      formatQuiverUrl(source, {
        macros: null,
        macroUrl: " https://example.com/macros.tex ",
      }),
    ).toBe(
      `https://q.uiver.app/#q=${payload}&macro_url=%20https%3A%2F%2Fexample.com%2Fmacros.tex%20`,
    );
    expect(
      formatQuiverUrl(source, { macros: " \n\t ", macroUrl: " \t " }),
    ).toBe(`https://q.uiver.app/#q=${payload}`);
  });

  it("formats canonical URLs and preserves renderer and macro metadata", () => {
    const empty = { ...document([]), macros: "document macros" };
    expect(
      formatQuiverUrl(empty, {
        renderer: "typst",
        macros: "option macros",
        macroUrl: "https://example.com/macros?a=1&b=2",
      }),
    ).toBe("https://q.uiver.app/");

    const source = document([vertex("v-url", 0, 0, "A")], [], "typst");
    const formatted = formatQuiverUrl(source, {
      macroUrl: "https://example.com/macros?a=1&b=2",
    });
    const payload = encodeQuiverPayload(source);
    expect(formatted).toBe(
      `https://q.uiver.app/#r=typst&q=${payload}&macro_url=https%3A%2F%2Fexample.com%2Fmacros%3Fa%3D1%26b%3D2`,
    );
    expect(parseQuiverUrl(formatted)).toEqual({
      payload,
      renderer: "typst",
      macros: null,
      macroUrl: "https://example.com/macros?a=1&b=2",
    });

    expect(
      formatQuiverUrl(document([vertex("v-katex", 0, 0, "A")])),
    ).not.toContain("r=katex");
  });
});

describe("legacy options and exact v0 defaults", () => {
  it("migrates length unless explicit shortening is present", () => {
    const decoded = decodeSuccess(
      payloadFor([
        0,
        2,
        [0, 0],
        [1, 0],
        [0, 1, "legacy", 0, { length: 70 }],
        [
          0,
          1,
          "explicit",
          0,
          {
            length: 50,
            shorten: { source: 10, target: 20 },
          },
        ],
      ]),
    );

    expect(decoded.document.edges[0]?.options.shorten).toEqual({
      source: 15,
      target: 15,
    });
    expect(decoded.document.edges[1]?.options.shorten).toEqual({
      source: 10,
      target: 20,
    });
  });

  it("re-encodes odd legacy lengths without invalid fractional shortening", () => {
    const decoded = decodeSuccess(
      payloadFor([0, 2, [0, 0], [1, 0], [0, 1, "odd", 0, { length: 99 }]]),
      "odd-length-first",
    );
    expect(decoded.document.edges[0]?.options.shorten).toEqual({
      source: 0.5,
      target: 0.5,
    });

    const reencoded = encodeQuiverPayload(decoded.document);

    expect(wireValue(reencoded)).toEqual([
      0,
      2,
      [0, 0],
      [1, 0],
      [0, 1, "odd", 0, { length: 99 }],
    ]);
    const roundTripped = decodeSuccess(reencoded, "odd-length-second");
    expect(roundTripped.diagnostics).toEqual([]);
    expect(roundTripped.document.edges[0]?.options.shorten).toEqual({
      source: 0.5,
      target: 0.5,
    });
  });

  it("uses explicit visual level before legacy body level before structure", () => {
    const decoded = decodeSuccess(
      payloadFor([
        0,
        2,
        [0, 0],
        [1, 0],
        [0, 1, "legacy", 0, { style: { body: { name: "dashed", level: 2 } } }],
        [
          0,
          1,
          "explicit",
          0,
          {
            level: 3,
            style: { body: { name: "dotted", level: 2 } },
          },
        ],
        [0, 1, "derived"],
        [0, 1, "explicit-default", 0, { level: 1 }],
      ]),
    );

    expect(decoded.document.edges.map(({ options }) => options.level)).toEqual([
      2,
      3,
      null,
      1,
    ]);
    expect(
      decoded.document.edges.map(({ options }) => options.style.body),
    ).toEqual([
      { name: "dashed" },
      { name: "dotted" },
      { name: "cell" },
      { name: "cell" },
    ]);
  });

  it("preserves special outer styles and endpoint alignment", () => {
    const decoded = decodeSuccess(
      payloadFor([
        0,
        2,
        [0, 0],
        [1, 0],
        [
          0,
          1,
          "",
          0,
          {
            edge_alignment: { source: false, target: true },
            style: { name: "adjunction" },
          },
        ],
        [0, 1, "", 0, { style: { name: "corner" } }],
        [0, 1, "", 0, { style: { name: "corner-inverse" } }],
      ]),
    );

    expect(
      decoded.document.edges.map(({ options }) => options.style.name),
    ).toEqual(["adjunction", "corner", "corner-inverse"]);
    expect(decoded.document.edges[0]?.options.edgeAlignment).toEqual({
      source: false,
      target: true,
    });
  });

  it("fills truncated arrays and normalizes blank-label-only fields", () => {
    const decoded = decodeSuccess(
      payloadFor([
        0,
        2,
        [0, 0],
        [1, 0, "B"],
        [0, 1],
        [0, 1, "", 2, {}, [120, 50, 50]],
      ]),
    );

    expect(decoded.document.vertices[0]).toEqual(
      expect.objectContaining({ label: "", labelColour: [0, 0, 0, 1] }),
    );
    expect(decoded.document.edges[0]).toEqual(
      expect.objectContaining({
        label: "",
        labelColour: [0, 0, 0, 1],
        options: DEFAULT_EDGE_OPTIONS,
      }),
    );
    expect(decoded.document.edges[1]).toEqual(
      expect.objectContaining({
        label: "",
        labelColour: [0, 0, 0, 1],
        options: expect.objectContaining({ labelAlignment: "left" }),
      }),
    );
  });
});

describe("bounded malformed input", () => {
  it("reports fatal invalid base64, UTF-8, JSON, size, depth, and cell limits", () => {
    const cases = [
      ["A", "invalid-base64"],
      ["/w==", "invalid-utf8"],
      [payloadForJson("[0,"), "invalid-json"],
      ["A".repeat(6_990_508), "payload-too-large"],
      [
        payloadForJson(`${"[".repeat(65)}0${"]".repeat(65)}`),
        "max-depth-exceeded",
      ],
      [
        payloadForJson(`[0,0,${"[],".repeat(50_001)}BROKEN]`),
        "cell-limit-exceeded",
      ],
    ] as const;

    for (const [payload, code] of cases) {
      const result = decodeQuiverPayload(payload, {
        idFactory: createDeterministicIdFactory(code),
      });
      expect(result.ok).toBe(false);
      expect(result.diagnostics[0]).toEqual(expect.objectContaining({ code }));
    }
  });

  it("does not count brackets inside JSON strings toward nesting", () => {
    const label = "[".repeat(100) + "]".repeat(100);
    expect(
      decodeSuccess(payloadFor([0, 1, [0, 0, label]])).document.vertices[0]
        ?.label,
    ).toBe(label);
  });

  it("reports original wire slots for truncated cells, unsafe numbers, colours, and indices", () => {
    const cases = [
      [payloadFor([0, 1, []]), "invalid-vertex", 0],
      [payloadFor([0, 0, [0]]), "invalid-edge", 0],
      [payloadFor([0, 1, [9_007_199_254_740_992, 0]]), "unsafe-integer", 0],
      [payloadForJson("[0,1,[1e400,0]]"), "invalid-number", 0],
      [payloadFor([0, 1, [0, 0, "A", [361, 0, 0]]]), "invalid-colour", 0],
      [payloadFor([0, 0, [0, 0]]), "invalid-endpoint-index", 0],
      [payloadFor([0, 2, [0, 0], [1, 0], [3, 1]]), "invalid-endpoint-index", 2],
      [
        payloadFor([0, 2, [0, 0], [1, 0], [-1, 1]]),
        "invalid-endpoint-index",
        2,
      ],
    ] as const;

    for (const [payload, code, wireCellIndex] of cases) {
      const result = decodeQuiverPayload(payload, {
        idFactory: createDeterministicIdFactory(code),
      });
      expect(result.ok).toBe(true);
      expect(result.diagnostics[0]).toEqual(
        expect.objectContaining({ code, wireCellIndex }),
      );
    }
  });

  it("keeps skipped wire slots so later references cannot be redirected", () => {
    const payload = payloadFor([0, 2, [0, 0], ["bad"], [0, 1], [0, 2]]);

    const first = decodeSuccess(payload, "slots-first");
    const second = decodeSuccess(payload, "slots-second");

    expect(first.document.vertices).toHaveLength(1);
    expect(first.document.edges).toHaveLength(0);
    expect(first.wireIndexToId).toEqual([
      entityId("slots-first-1"),
      null,
      null,
      null,
    ]);
    expect(
      first.diagnostics.map(({ code, wireCellIndex }) => [code, wireCellIndex]),
    ).toEqual([
      ["invalid-vertex", 1],
      ["missing-endpoint-cell", 2],
      ["missing-endpoint-cell", 3],
    ]);
    expect(
      second.diagnostics.map(({ code, wireCellIndex }) => [
        code,
        wireCellIndex,
      ]),
    ).toEqual(
      first.diagnostics.map(({ code, wireCellIndex }) => [code, wireCellIndex]),
    );
  });

  it("skips duplicate positions and retains their null mapping", () => {
    const result = decodeSuccess(
      payloadFor([0, 2, [0, 0, "first"], [0, 0, "duplicate"], [0, 1]]),
      "duplicate",
    );

    expect(result.document.vertices.map(({ label }) => label)).toEqual([
      "first",
    ]);
    expect(result.document.edges).toEqual([]);
    expect(result.wireIndexToId).toEqual([entityId("duplicate-1"), null, null]);
    expect(
      result.diagnostics.map(({ code, wireCellIndex }) => [
        code,
        wireCellIndex,
      ]),
    ).toEqual([
      ["duplicate-position", 1],
      ["missing-endpoint-cell", 2],
    ]);
  });

  it("extracts only own known option keys without prototype pollution", () => {
    const payload = payloadForJson(
      '[0,2,[0,0],[1,0],[0,1,"",0,{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"hasOwnProperty":null,"style":{"__proto__":{"name":"corner"},"name":"adjunction"}}]]',
    );

    const decoded = decodeSuccess(payload);

    expect(decoded.diagnostics).toEqual([]);
    expect(decoded.document.edges[0]?.options.style.name).toBe("adjunction");
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });
});

describe("canonical encoding and selections", () => {
  it("orders edges by structural level, translates vertices, and omits shape-specific options", () => {
    const first = vertex("v-first", 5, 8);
    const second = vertex("v-second", 7, 8);
    const third = vertex("v-third", 6, 9);
    const low = edge("e-low", first.id, second.id, "", {
      ...DEFAULT_EDGE_OPTIONS,
      curve: 2,
      radius: 9,
      angle: 45,
    });
    const loop = edge("e-loop", third.id, third.id, "", {
      ...DEFAULT_EDGE_OPTIONS,
      shape: "arc",
      curve: 7,
      radius: 5,
      angle: 30,
    });
    const high = edge("e-high", low.id, third.id);
    const source = document([first, second, third], [high, loop, low]);
    const before = structuredClone(source);

    const payload = encodeQuiverPayload(source);

    expect(wireValue(payload)).toEqual([
      0,
      3,
      [0, 0],
      [2, 0],
      [1, 1],
      [2, 2, "", 0, { radius: 5, angle: 30 }],
      [0, 1, "", 0, { curve: 2 }],
      [4, 2],
    ]);
    expect(source).toEqual(before);
  });

  it("uses exact trailing omissions and three-component opaque colours", () => {
    const first = vertex("v-first", 0, 0, "A", [120, 50, 40, 1]);
    const second = vertex("v-second", 1, 0);
    const labelled = edge(
      "e-labelled",
      first.id,
      second.id,
      "f",
      { ...DEFAULT_EDGE_OPTIONS, labelAlignment: "right" },
      [240, 60, 30, 1],
    );
    const blank = edge(
      "e-blank",
      first.id,
      second.id,
      "",
      { ...DEFAULT_EDGE_OPTIONS, labelAlignment: "over", offset: 2 },
      [30, 50, 50, 0.5],
    );

    expect(
      wireValue(
        encodeQuiverPayload(document([first, second], [labelled, blank])),
      ),
    ).toEqual([
      0,
      2,
      [0, 0, "A", [120, 50, 40]],
      [1, 0],
      [0, 1, "f", 2, {}, [240, 60, 30]],
      [0, 1, "", 0, { offset: 2 }],
    ]);
  });

  it("returns selected wire indices and includes the transitive endpoint closure", () => {
    const first = vertex("v-first", 4, 4, "A");
    const second = vertex("v-second", 5, 4, "B");
    const third = vertex("v-third", 6, 4, "C");
    const low = edge("e-low", first.id, second.id, "f");
    const high = edge("e-high", low.id, third.id, "α");
    const source = document([first, second, third], [high, low]);
    const before = structuredClone(source);

    const encoded = encodeQuiverSelection(source, [high.id]);

    expect(encoded.selectedWireIndices).toEqual([4]);
    expect(wireValue(encoded.payload)).toEqual([
      0,
      3,
      [0, 0, "A"],
      [1, 0, "B"],
      [2, 0, "C"],
      [0, 1, "f"],
      [3, 2, "α"],
    ]);
    const decoded = decodeSuccess(encoded.payload, "selection", {
      x: 10,
      y: -2,
    });
    expect(decoded.document.vertices.map(({ x, y }) => [x, y])).toEqual([
      [10, -2],
      [11, -2],
      [12, -2],
    ]);
    expect(
      encoded.selectedWireIndices.map((index) => decoded.wireIndexToId[index]),
    ).toEqual([decoded.document.edges[1]?.id]);
    expect(source).toEqual(before);
  });
});

describe("Quiver encoder wire domain", () => {
  function sourceWithOptions(options: EdgeOptions): DiagramDocument {
    const first = vertex("v-domain-first", 0, 0, "A", [360, 100, 100, 1]);
    const second = vertex("v-domain-second", 1, 0, "B", [0, 0, 0, 0.25]);
    return document(
      [first, second],
      [
        edge(
          "e-domain",
          first.id,
          second.id,
          "f",
          options,
          [360, 0, 100, 0.75],
        ),
      ],
    );
  }

  it("emits a decodable v0 payload for an empty document and selection", () => {
    const source = document([]);

    const payload = encodeQuiverPayload(source);
    const selection = encodeQuiverSelection(source, []);

    expect(wireValue(payload)).toEqual([0, 0]);
    expect(selection).toEqual({
      payload,
      selectedWireIndices: [],
    });
    const decoded = decodeSuccess(payload, "empty-wire");
    expect(decoded.diagnostics).toEqual([]);
    expect(decoded.document.vertices).toEqual([]);
    expect(decoded.document.edges).toEqual([]);
  });

  it("accepts inclusive v0 boundaries and always emits a cleanly decodable payload", () => {
    const sources = [
      sourceWithOptions({
        ...DEFAULT_EDGE_OPTIONS,
        labelPosition: 0,
        offset: Number.MIN_SAFE_INTEGER,
        curve: Number.MAX_SAFE_INTEGER,
        radius: Number.MIN_SAFE_INTEGER,
        angle: Number.MAX_SAFE_INTEGER,
        shorten: { source: 0, target: 100 },
        colour: [0, 100, 0, 0.5],
      }),
      sourceWithOptions({
        ...DEFAULT_EDGE_OPTIONS,
        labelPosition: 100,
        offset: Number.MAX_SAFE_INTEGER,
        curve: Number.MIN_SAFE_INTEGER,
        radius: Number.MAX_SAFE_INTEGER,
        angle: Number.MIN_SAFE_INTEGER,
        shorten: { source: 100, target: 0 },
        colour: [360, 0, 100, 1],
      }),
    ];

    for (const [index, source] of sources.entries()) {
      expect(validateDocument(source)).toEqual([]);
      const decoded = decodeSuccess(
        encodeQuiverPayload(source),
        `wire-boundary-${index}`,
      );
      expect(decoded.diagnostics).toEqual([]);
      expect(decoded.document.edges).toHaveLength(1);
    }
  });

  it.each([
    ["negative label position", { labelPosition: -1 }, "labelPosition"],
    ["fractional label position", { labelPosition: 50.5 }, "labelPosition"],
    ["oversized label position", { labelPosition: 101 }, "labelPosition"],
    ["fractional offset", { offset: 0.5 }, "offset"],
    ["unsafe offset", { offset: Number.MAX_SAFE_INTEGER + 1 }, "offset"],
    ["fractional curve", { curve: 0.5 }, "curve"],
    ["unsafe radius", { radius: Number.MAX_SAFE_INTEGER + 1 }, "radius"],
    ["fractional angle", { angle: -0.5 }, "angle"],
  ] as const)("rejects %s", (_name, change, property) => {
    const source = sourceWithOptions({ ...DEFAULT_EDGE_OPTIONS, ...change });
    expect(validateDocument(source)).toEqual([]);

    expect(() => encodeQuiverPayload(source)).toThrow(DocumentValidationError);
    try {
      encodeQuiverPayload(source);
    } catch (error) {
      expect((error as DocumentValidationError).diagnostics).toEqual([
        expect.objectContaining({
          code: "quiver-wire-number",
          entityId: entityId("e-domain"),
          path: `edges[0].options.${property}`,
        }),
      ]);
    }
  });

  it.each([
    ["vertex hue", [0.5, 0, 0, 1] as Hsla, "vertex"],
    ["edge-label saturation", [0, 50.5, 0, 1] as Hsla, "edge-label"],
    ["edge lightness", [0, 0, 99.5, 1] as Hsla, "edge"],
  ] as const)(
    "rejects a fractional %s colour component",
    (_name, colour, target) => {
      const first = vertex(
        "v-colour-first",
        0,
        0,
        "A",
        target === "vertex" ? colour : BLACK_HSLA,
      );
      const second = vertex("v-colour-second", 1, 0);
      const options = {
        ...DEFAULT_EDGE_OPTIONS,
        colour: target === "edge" ? colour : BLACK_HSLA,
      };
      const source = document(
        [first, second],
        [
          edge(
            "e-colour",
            first.id,
            second.id,
            "f",
            options,
            target === "edge-label" ? colour : BLACK_HSLA,
          ),
        ],
      );
      expect(validateDocument(source)).toEqual([]);

      expect(() => encodeQuiverPayload(source)).toThrow(
        DocumentValidationError,
      );
      try {
        encodeQuiverPayload(source);
      } catch (error) {
        expect((error as DocumentValidationError).diagnostics[0]).toEqual(
          expect.objectContaining({ code: "quiver-wire-colour" }),
        );
      }
    },
  );

  it.each([
    ["negative source", { source: -1, target: 0 }, "shorten.source"],
    [
      "unsafe target",
      { source: 0, target: Number.MAX_SAFE_INTEGER + 1 },
      "shorten.target",
    ],
    ["sum above 100", { source: 51, target: 50 }, "shorten"],
    ["asymmetric fractions", { source: 0.5, target: 1.5 }, "shorten"],
  ] as const)("rejects %s shortening", (_name, shorten, property) => {
    const source = sourceWithOptions({ ...DEFAULT_EDGE_OPTIONS, shorten });
    expect(validateDocument(source)).toEqual([]);

    expect(() => encodeQuiverPayload(source)).toThrow(DocumentValidationError);
    try {
      encodeQuiverPayload(source);
    } catch (error) {
      expect((error as DocumentValidationError).diagnostics).toEqual([
        expect.objectContaining({
          code: "quiver-wire-shorten",
          entityId: entityId("e-domain"),
          path: `edges[0].options.${property}`,
        }),
      ]);
    }
  });

  it("rejects coordinates whose normalized wire position is not a safe integer", () => {
    const source = document([
      vertex("v-coordinate-first", Number.MIN_SAFE_INTEGER, 0),
      vertex("v-coordinate-second", Number.MAX_SAFE_INTEGER, 0),
    ]);
    expect(validateDocument(source)).toEqual([]);

    expect(() => encodeQuiverPayload(source)).toThrow(DocumentValidationError);
    try {
      encodeQuiverPayload(source);
    } catch (error) {
      expect((error as DocumentValidationError).diagnostics).toEqual([
        expect.objectContaining({
          code: "quiver-wire-coordinate",
          entityId: entityId("v-coordinate-second"),
          path: "vertices[1].x",
        }),
      ]);
    }
  });

  it.each([
    ["a loop with the exported Bézier defaults", true, "bezier", "arc"],
    ["a non-loop stored as an arc", false, "arc", "bezier"],
  ] as const)(
    "rejects %s before its shape can change on export",
    (_name, loop, shape, requiredShape) => {
      const first = vertex("v-shape-first", 0, 0);
      const second = vertex("v-shape-second", 1, 0);
      const source = document(
        [first, second],
        [
          edge("e-shape", first.id, loop ? first.id : second.id, "", {
            ...DEFAULT_EDGE_OPTIONS,
            shape,
          }),
        ],
      );
      expect(validateDocument(source)).toEqual([]);

      expect(() => encodeQuiverPayload(source)).toThrow(
        DocumentValidationError,
      );
      try {
        encodeQuiverPayload(source);
      } catch (error) {
        expect((error as DocumentValidationError).diagnostics).toEqual([
          expect.objectContaining({
            code: "quiver-shape-mismatch",
            entityId: entityId("e-shape"),
            path: "edges[0].options.shape",
            message: expect.stringContaining(requiredShape),
          }),
        ]);
      }
    },
  );
});

describe("codec properties", () => {
  const labelArb = fc
    .array(fc.constantFrom("A", "x_y", "\\alpha", "日本語", "😀", "λ"), {
      minLength: 1,
      maxLength: 3,
    })
    .map((parts) => parts.join(" "));
  const colourArb = fc
    .tuple(
      fc.integer({ min: 0, max: 360 }),
      fc.integer({ min: 0, max: 100 }),
      fc.integer({ min: 0, max: 100 }),
      fc.constantFrom(0, 0.5, 1),
    )
    .map((colour) => colour as Hsla);
  const wireIntegerArb = fc.oneof(
    fc.integer({ min: -1_000, max: 1_000 }),
    fc.constant(Number.MIN_SAFE_INTEGER),
    fc.constant(Number.MAX_SAFE_INTEGER),
  );
  const shortenArb = fc.oneof(
    fc
      .integer({ min: 0, max: 100 })
      .chain((source) =>
        fc
          .integer({ min: 0, max: 100 - source })
          .map((target) => ({ source, target })),
      ),
    fc
      .integer({ min: 0, max: 100 })
      .filter((length) => length % 2 === 1)
      .map((length) => ({
        source: (100 - length) / 2,
        target: (100 - length) / 2,
      })),
  );
  const documentArb: fc.Arbitrary<DiagramDocument> = fc
    .tuple(
      fc.nat({ max: 1_000_000 }),
      labelArb,
      labelArb,
      labelArb,
      colourArb,
      colourArb,
      colourArb,
      fc.constantFrom("left", "centre", "right", "over" as const),
      fc.integer({ min: 0, max: 100 }),
      wireIntegerArb,
      wireIntegerArb,
      shortenArb,
      fc.constantFrom<number | null>(null, 2, 3, 4),
      fc.constantFrom("arrow", "adjunction", "corner", "corner-inverse"),
      fc.boolean(),
      fc.boolean(),
      fc.boolean(),
    )
    .map(
      ([
        nonce,
        firstLabel,
        secondLabel,
        edgeLabel,
        firstColour,
        secondColour,
        edgeColour,
        labelAlignment,
        labelPosition,
        curve,
        offset,
        shorten,
        level,
        styleName,
        sourceAlignment,
        targetAlignment,
        typst,
      ]) => {
        const first = vertex(`v-${nonce}-a`, 0, 0, firstLabel, firstColour);
        const second = vertex(`v-${nonce}-b`, 1, 0, secondLabel, secondColour);
        const options: EdgeOptions = {
          ...DEFAULT_EDGE_OPTIONS,
          labelAlignment,
          labelPosition,
          curve,
          offset,
          shorten,
          level,
          colour: edgeColour,
          edgeAlignment: {
            source: sourceAlignment,
            target: targetAlignment,
          },
          style: { ...DEFAULT_EDGE_OPTIONS.style, name: styleName },
        };
        return document(
          [first, second],
          [
            edge(
              `e-${nonce}`,
              first.id,
              second.id,
              edgeLabel,
              options,
              edgeColour,
            ),
          ],
          typst ? "typst" : "katex",
        );
      },
    );

  it("round-trips supported model values without mutation", () => {
    fc.assert(
      fc.property(documentArb, (source) => {
        expect(validateDocument(source)).toEqual([]);
        const before = structuredClone(source);
        const payload = encodeQuiverPayload(source);
        const decoded = decodeQuiverPayload(payload, {
          idFactory: createDeterministicIdFactory("property"),
        });
        expect(decoded.ok).toBe(true);
        if (!decoded.ok) {
          return;
        }
        expect(decoded.diagnostics).toEqual([]);
        expect(entitySemantics(decoded.document)).toEqual(
          entitySemantics(source),
        );
        expect(source).toEqual(before);
      }),
      { numRuns: PROPERTY_RUNS, seed: 0x51_56_30 },
    );
  });
});
