export type EntityId = string & { readonly __entityId: unique symbol };
export type Hsla = readonly [h: number, s: number, l: number, a: number];
export type LabelAlignment = "left" | "centre" | "right" | "over";
export type ArrowShape = "bezier" | "arc";

export interface GridPoint {
  readonly x: number;
  readonly y: number;
}

export interface Vertex {
  readonly kind: "vertex";
  readonly id: EntityId;
  readonly x: number;
  readonly y: number;
  readonly label: string;
  readonly labelColour: Hsla;
}

export interface EdgeStylePart {
  readonly name: string;
  readonly side?: "top" | "bottom";
}

export interface EdgeOptions {
  readonly labelAlignment: LabelAlignment;
  readonly labelPosition: number;
  readonly offset: number;
  readonly curve: number;
  readonly radius: number;
  readonly angle: number;
  readonly shorten: Readonly<{ source: number; target: number }>;
  readonly colour: Hsla;
  readonly shape: ArrowShape;
  readonly style: Readonly<{
    tail: EdgeStylePart;
    body: EdgeStylePart;
    head: EdgeStylePart;
  }>;
}

export interface Edge {
  readonly kind: "edge";
  readonly id: EntityId;
  readonly sourceId: EntityId;
  readonly targetId: EntityId;
  readonly label: string;
  readonly labelColour: Hsla;
  readonly options: EdgeOptions;
}

export type DiagramEntity = Vertex | Edge;

export interface DiagramDocument {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly title: string;
  readonly vertices: readonly Vertex[];
  readonly edges: readonly Edge[];
  readonly macros: string;
  readonly preferredRenderer: "katex" | "typst";
}

export interface ValidationDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly entityId?: EntityId;
  readonly path?: string;
}
