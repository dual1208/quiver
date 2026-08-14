import type { EdgeOptions, Hsla } from "./types";

export const BLACK_HSLA: Hsla = Object.freeze([0, 0, 0, 1]);

export const DEFAULT_EDGE_OPTIONS: EdgeOptions = Object.freeze({
  labelAlignment: "left",
  labelPosition: 50,
  offset: 0,
  curve: 0,
  radius: 0,
  angle: 0,
  shorten: Object.freeze({ source: 0, target: 0 }),
  colour: BLACK_HSLA,
  shape: "bezier",
  style: Object.freeze({
    tail: Object.freeze({ name: "none" }),
    body: Object.freeze({ name: "cell" }),
    head: Object.freeze({ name: "arrowhead" }),
  }),
});
