import { Stack } from "expo-router";
import { createContext, type PropsWithChildren } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ThemeProvider } from "../src/theme/ThemeProvider";

type RepositoryBootstrap = Readonly<{
  status: "pending";
}>;

const repositoryBootstrap: RepositoryBootstrap = { status: "pending" };
const RepositoryContext =
  createContext<RepositoryBootstrap>(repositoryBootstrap);

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
