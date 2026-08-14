import { useWindowDimensions } from "react-native";

export type LayoutClass = "compact" | "regular";

export const REGULAR_LAYOUT_MIN_WIDTH = 720;

export function layoutClassForWidth(width: number): LayoutClass {
  return width >= REGULAR_LAYOUT_MIN_WIDTH ? "regular" : "compact";
}

export function useLayoutClass(): LayoutClass {
  const { width } = useWindowDimensions();
  return layoutClassForWidth(width);
}
