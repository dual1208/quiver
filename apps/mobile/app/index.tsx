import * as Clipboard from "expo-clipboard";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { diagramRepository, type DiagramSummary } from "../src/data";
import { LibraryScreen } from "../src/library/LibraryScreen";
import { useTheme } from "../src/theme/ThemeProvider";

function displayUpdated(timestamp: string): string {
  const value = new Date(timestamp);
  if (Number.isNaN(value.getTime())) {
    return "Saved locally";
  }
  return `Updated ${value.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(value.getFullYear() === new Date().getFullYear()
      ? {}
      : { year: "numeric" as const }),
  })}`;
}

export default function LibraryRoute() {
  const theme = useTheme();
  const [documents, setDocuments] = useState<readonly DiagramSummary[]>([]);
  const [importVisible, setImportVisible] = useState(false);
  const [importText, setImportText] = useState("");
  const [importing, setImporting] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setDocuments(await diagramRepository.listSummaries());
    } catch (error) {
      Alert.alert(
        "Could not open your library",
        error instanceof Error ? error.message : "Please try again.",
      );
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const openNewDocument = useCallback(() => {
    void diagramRepository
      .createUntitled()
      .then(({ document }) => {
        router.push({ pathname: "/editor/[id]", params: { id: document.id } });
      })
      .catch((error: unknown) => {
        Alert.alert(
          "Could not create diagram",
          error instanceof Error ? error.message : "Please try again.",
        );
      });
  }, []);

  const openDocument = useCallback((id: string) => {
    router.push({ pathname: "/editor/[id]", params: { id } });
  }, []);

  const openImport = useCallback(() => {
    setImportVisible(true);
    void Clipboard.getStringAsync().then((text) => {
      if (text.includes("q.uiver.app") || text.includes("#q=")) {
        setImportText(text);
      }
    });
  }, []);

  const importDocument = useCallback(() => {
    const value = importText.trim();
    if (value === "" || importing) {
      return;
    }
    setImporting(true);
    void diagramRepository
      .importQuiverUrl(value)
      .then(({ document }) => {
        setImporting(false);
        setImportVisible(false);
        setImportText("");
        router.push({ pathname: "/editor/[id]", params: { id: document.id } });
      })
      .catch((error: unknown) => {
        setImporting(false);
        Alert.alert(
          "Could not import link",
          error instanceof Error ? error.message : "Paste a valid Quiver link and try again.",
        );
      });
  }, [importText, importing]);

  const documentActions = useCallback(
    (id: string) => {
      const document = documents.find((item) => item.id === id);
      Alert.alert(document?.title ?? "Diagram", undefined, [
        {
          text: "Duplicate",
          onPress: () => {
            void diagramRepository.duplicate(id).then(({ document: copy }) => {
              void refresh();
              router.push({ pathname: "/editor/[id]", params: { id: copy.id } });
            });
          },
        },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void diagramRepository.delete(id).then(() => refresh());
          },
        },
        { text: "Cancel", style: "cancel" },
      ]);
    },
    [documents, refresh],
  );

  return (
    <>
      <LibraryScreen
        documents={documents.map((document) => ({
          id: document.id,
          title: document.title || "Untitled diagram",
          updatedLabel: displayUpdated(document.updatedAt),
          detail: `${document.vertexCount} ${document.vertexCount === 1 ? "object" : "objects"} · ${document.edgeCount} ${document.edgeCount === 1 ? "arrow" : "arrows"}`,
        }))}
        onDocumentActions={documentActions}
        onImportDocument={openImport}
        onNewDocument={openNewDocument}
        onOpenDocument={openDocument}
      />
      <Modal
        animationType="fade"
        onRequestClose={() => setImportVisible(false)}
        presentationStyle="overFullScreen"
        transparent
        visible={importVisible}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={[styles.scrim, { backgroundColor: theme.colors.shadow + "99" }]}
        >
          <View
            style={[
              styles.dialog,
              { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
            ]}
          >
            <Text style={[theme.typography.title, { color: theme.colors.textPrimary }]}>Import Quiver link</Text>
            <Text style={[theme.typography.body, { color: theme.colors.textSecondary }]}>Paste a q.uiver.app link. Your imported diagram stays on this device.</Text>
            <TextInput
              accessibilityLabel="Quiver link"
              autoCapitalize="none"
              autoCorrect={false}
              multiline
              onChangeText={setImportText}
              placeholder="https://q.uiver.app/#q=…"
              placeholderTextColor={theme.colors.textSecondary}
              style={[
                styles.importInput,
                theme.typography.body,
                {
                  backgroundColor: theme.colors.surfaceElevated,
                  borderColor: theme.colors.border,
                  color: theme.colors.textPrimary,
                },
              ]}
              value={importText}
            />
            <View style={styles.dialogActions}>
              <Pressable
                accessibilityRole="button"
                onPress={() => setImportVisible(false)}
                style={[styles.dialogButton, { minHeight: theme.minimumTargetSize }]}
              >
                <Text style={[theme.typography.bodyStrong, { color: theme.colors.textPrimary }]}>Cancel</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={importText.trim() === "" || importing}
                onPress={importDocument}
                style={[
                  styles.dialogButton,
                  { backgroundColor: theme.colors.primary, minHeight: theme.minimumTargetSize },
                  importText.trim() === "" || importing ? styles.disabled : null,
                ]}
              >
                <Text style={[theme.typography.bodyStrong, { color: theme.colors.onPrimary }]}>{importing ? "Importing…" : "Import"}</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  dialog: {
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 14,
    maxWidth: 560,
    padding: 22,
    width: "90%",
  },
  dialogActions: {
    flexDirection: "row",
    gap: 8,
    justifyContent: "flex-end",
  },
  dialogButton: {
    alignItems: "center",
    borderRadius: 999,
    justifyContent: "center",
    minWidth: 96,
    paddingHorizontal: 18,
  },
  disabled: {
    opacity: 0.45,
  },
  importInput: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 116,
    padding: 13,
    textAlignVertical: "top",
  },
  scrim: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    padding: 20,
  },
});
