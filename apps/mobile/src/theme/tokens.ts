import { Platform, type TextStyle } from "react-native";

export type ThemeMode = "light" | "dark";

export type ThemeColors = Readonly<{
  background: string;
  canvas: string;
  surface: string;
  surfaceElevated: string;
  primary: string;
  primarySurface: string;
  onPrimary: string;
  textPrimary: string;
  textSecondary: string;
  selection: string;
  error: string;
  border: string;
  grid: string;
  shadow: string;
}>;

export type ThemeTokens = Readonly<{
  mode: ThemeMode;
  colors: ThemeColors;
  spacing: typeof spacing;
  radii: Readonly<{
    small: number;
    medium: number;
    large: number;
    round: number;
  }>;
  typography: Readonly<{
    eyebrow: TextStyle;
    body: TextStyle;
    bodyStrong: TextStyle;
    title: TextStyle;
    display: TextStyle;
  }>;
  minimumTargetSize: number;
}>;

export const spacing = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 24,
} as const;

const radii = {
  small: 10,
  medium: 16,
  large: 24,
  round: 999,
} as const;

const typography = {
  eyebrow: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.8,
    lineHeight: 16,
    textTransform: "uppercase",
  },
  body: {
    fontSize: 16,
    fontWeight: "400",
    lineHeight: 23,
  },
  bodyStrong: {
    fontSize: 16,
    fontWeight: "600",
    lineHeight: 23,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    letterSpacing: -0.2,
    lineHeight: 26,
  },
  display: {
    fontSize: 34,
    fontWeight: "800",
    letterSpacing: -1,
    lineHeight: 40,
  },
} as const satisfies ThemeTokens["typography"];

export function minimumTargetForPlatform(platform: string): number {
  return platform === "ios" ? 44 : 48;
}

const minimumTargetSize = minimumTargetForPlatform(Platform.OS);

export const lightTheme: ThemeTokens = {
  mode: "light",
  colors: {
    background: "#F5F6FA",
    canvas: "#FBFCFF",
    surface: "#FFFFFF",
    surfaceElevated: "#EEF1F7",
    primary: "#3154C9",
    primarySurface: "#E5EAFF",
    onPrimary: "#FFFFFF",
    textPrimary: "#171A23",
    textSecondary: "#555D70",
    selection: "#6741D9",
    error: "#A9271E",
    border: "#D9DEEA",
    grid: "#E0E4ED",
    shadow: "#151927",
  },
  spacing,
  radii,
  typography,
  minimumTargetSize,
};

export const darkTheme: ThemeTokens = {
  mode: "dark",
  colors: {
    background: "#0E1118",
    canvas: "#111620",
    surface: "#191E2A",
    surfaceElevated: "#222938",
    primary: "#AFC0FF",
    primarySurface: "#29375F",
    onPrimary: "#11172A",
    textPrimary: "#F7F8FC",
    textSecondary: "#BBC3D4",
    selection: "#CBB5FF",
    error: "#FFB4AB",
    border: "#343D50",
    grid: "#283142",
    shadow: "#000000",
  },
  spacing,
  radii,
  typography,
  minimumTargetSize,
};
