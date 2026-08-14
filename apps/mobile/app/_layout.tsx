import { Stack } from "expo-router";
import { type PropsWithChildren, useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ThemeProvider } from "../src/theme/ThemeProvider";
import { diagramRepository } from "../src/data";

function RepositoryProvider({ children }: PropsWithChildren) {
  useEffect(() => {
    void diagramRepository.initialize().catch(() => {
      // Routes surface actionable repository errors where the user can retry.
    });
  }, []);
  return children;
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
