import { Stack } from "expo-router";
import { createContext, type PropsWithChildren } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

type BootstrapTheme = Readonly<{
  mode: "system";
}>;

type RepositoryBootstrap = Readonly<{
  status: "pending";
}>;

const bootstrapTheme: BootstrapTheme = { mode: "system" };
const repositoryBootstrap: RepositoryBootstrap = { status: "pending" };
const ThemeContext = createContext<BootstrapTheme>(bootstrapTheme);
const RepositoryContext =
  createContext<RepositoryBootstrap>(repositoryBootstrap);

function ThemeProvider({ children }: PropsWithChildren) {
  return (
    <ThemeContext.Provider value={bootstrapTheme}>
      {children}
    </ThemeContext.Provider>
  );
}

function RepositoryProvider({ children }: PropsWithChildren) {
  return (
    <RepositoryContext.Provider value={repositoryBootstrap}>
      {children}
    </RepositoryContext.Provider>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <RepositoryProvider>
            <Stack screenOptions={{ headerShown: false }} />
          </RepositoryProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
