import { createContext, type PropsWithChildren, useContext } from "react";
import { useColorScheme } from "react-native";
import { darkTheme, lightTheme, type ThemeTokens } from "./tokens";

const ThemeContext = createContext<ThemeTokens>(lightTheme);

export function ThemeProvider({ children }: PropsWithChildren) {
  const colorScheme = useColorScheme();
  const theme = colorScheme === "dark" ? darkTheme : lightTheme;

  return (
    <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeTokens {
  return useContext(ThemeContext);
}
