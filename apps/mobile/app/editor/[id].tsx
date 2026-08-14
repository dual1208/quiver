import type { DiagramDocument } from "@quiver/core";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { diagramRepository } from "../../src/data";
import { DiagramEditorView } from "../../src/editor/DiagramEditorView";
import { useTheme } from "../../src/theme/ThemeProvider";

type LoadState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly document: DiagramDocument }
  | { readonly status: "error"; readonly message: string };

export default function EditorRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });

    void (async () => {
      try {
        const record =
          id === "new"
            ? await diagramRepository.createUntitled()
            : await diagramRepository.get(id);
        if (!active) {
          return;
        }
        if (record === null) {
          setState({ status: "error", message: "This diagram no longer exists." });
          return;
        }
        setState({ status: "ready", document: record.document });
        if (id === "new") {
          router.setParams({ id: record.document.id });
        }
      } catch (error) {
        if (active) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "Could not open the diagram.",
          });
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [id, reloadKey]);

  const save = useCallback((document: DiagramDocument) => {
    return diagramRepository.save(document).then(() => undefined);
  }, []);

  if (state.status === "ready") {
    return <DiagramEditorView initialDocument={state.document} onSave={save} />;
  }

  return (
    <View style={[styles.center, { backgroundColor: theme.colors.background }]}>
      {state.status === "loading" ? (
        <>
          <ActivityIndicator color={theme.colors.primary} size="large" />
          <Text style={[theme.typography.body, { color: theme.colors.textSecondary }]}>
            Opening diagram…
          </Text>
        </>
      ) : (
        <>
          <Text style={[theme.typography.title, { color: theme.colors.textPrimary }]}>
            Could not open diagram
          </Text>
          <Text style={[styles.message, theme.typography.body, { color: theme.colors.textSecondary }]}>
            {state.message}
          </Text>
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              onPress={() => setReloadKey((value) => value + 1)}
              style={[styles.button, { backgroundColor: theme.colors.primary }]}
            >
              <Text style={[theme.typography.bodyStrong, { color: theme.colors.onPrimary }]}>Retry</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.back()}
              style={[styles.button, { borderColor: theme.colors.border, borderWidth: 1 }]}
            >
              <Text style={[theme.typography.bodyStrong, { color: theme.colors.textPrimary }]}>Library</Text>
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: "row",
    gap: 10,
  },
  button: {
    borderRadius: 999,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  center: {
    alignItems: "center",
    flex: 1,
    gap: 16,
    justifyContent: "center",
    padding: 24,
  },
  message: {
    maxWidth: 420,
    textAlign: "center",
  },
});
