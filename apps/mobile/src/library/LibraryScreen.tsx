import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLayoutClass } from "../layout/useLayoutClass";
import { useTheme } from "../theme/ThemeProvider";
import { DocumentCard, type LibraryDocumentSummary } from "./DocumentCard";

export type LibraryScreenProps = Readonly<{
  documents: readonly LibraryDocumentSummary[];
  onNewDocument: () => void;
  onImportDocument: () => void;
  onOpenDocument: (id: string) => void;
  onDocumentActions: (id: string) => void;
}>;

type LibraryActionProps = Readonly<{
  testID: string;
  label: string;
  title: string;
  primary?: boolean;
  onPress: () => void;
}>;

function LibraryAction({
  testID,
  label,
  title,
  primary = false,
  onPress,
}: LibraryActionProps) {
  const theme = useTheme();
  const backgroundColor = primary ? theme.colors.primary : theme.colors.surface;
  const color = primary ? theme.colors.onPrimary : theme.colors.textPrimary;

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={[
        styles.action,
        {
          backgroundColor,
          borderColor: primary ? theme.colors.primary : theme.colors.border,
          minHeight: theme.minimumTargetSize,
        },
      ]}
      testID={testID}
    >
      <Text
        allowFontScaling
        maxFontSizeMultiplier={1.8}
        style={[theme.typography.bodyStrong, { color }]}
      >
        {title}
      </Text>
    </Pressable>
  );
}

function QuiverMark() {
  const theme = useTheme();

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.mark, { backgroundColor: theme.colors.textPrimary }]}
    >
      <Text style={[styles.markText, { color: theme.colors.surface }]}>q↓</Text>
    </View>
  );
}

function EmptyLibrary() {
  const theme = useTheme();

  return (
    <View
      style={[
        styles.empty,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
        },
      ]}
      testID="library-empty-state"
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.emptyDiagram, { backgroundColor: theme.colors.canvas }]}
      >
        <View
          style={[styles.emptyEdge, { backgroundColor: theme.colors.primary }]}
        />
        <View
          style={[
            styles.emptyNode,
            styles.emptyNodeStart,
            {
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.primary,
            },
          ]}
        />
        <View
          style={[
            styles.emptyNode,
            styles.emptyNodeEnd,
            {
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.selection,
            },
          ]}
        />
      </View>
      <Text
        allowFontScaling
        maxFontSizeMultiplier={1.8}
        style={[theme.typography.title, { color: theme.colors.textPrimary }]}
      >
        A clear canvas is ready
      </Text>
      <Text
        allowFontScaling
        maxFontSizeMultiplier={1.8}
        style={[
          styles.emptyBody,
          theme.typography.body,
          { color: theme.colors.textSecondary },
        ]}
      >
        Create a diagram from scratch or import an existing Quiver link.
      </Text>
    </View>
  );
}

export function LibraryScreen({
  documents,
  onNewDocument,
  onImportDocument,
  onOpenDocument,
  onDocumentActions,
}: LibraryScreenProps) {
  const theme = useTheme();
  const layoutClass = useLayoutClass();
  const hasDocuments = documents.length > 0;

  return (
    <SafeAreaView
      edges={["top", "right", "bottom", "left"]}
      style={[styles.safeArea, { backgroundColor: theme.colors.background }]}
      testID="library-screen"
    >
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          layoutClass === "regular"
            ? styles.regularContent
            : styles.compactContent,
        ]}
      >
        <View style={styles.header}>
          <View style={styles.identity}>
            <QuiverMark />
            <View style={styles.headingCopy}>
              <Text
                allowFontScaling
                maxFontSizeMultiplier={1.8}
                style={[
                  theme.typography.eyebrow,
                  { color: theme.colors.primary },
                ]}
              >
                Quiver
              </Text>
              <Text
                allowFontScaling
                maxFontSizeMultiplier={1.8}
                style={[
                  theme.typography.display,
                  { color: theme.colors.textPrimary },
                ]}
                testID="library-title"
              >
                Your diagrams
              </Text>
            </View>
          </View>
          <Text
            allowFontScaling
            maxFontSizeMultiplier={1.8}
            style={[
              styles.subtitle,
              theme.typography.body,
              { color: theme.colors.textSecondary },
            ]}
          >
            Private by default, available offline, and ready wherever you think.
          </Text>
          <View style={styles.actions}>
            <LibraryAction
              label="Create a new diagram"
              onPress={onNewDocument}
              primary
              testID="new-document"
              title="＋ New diagram"
            />
            <LibraryAction
              label="Import a diagram"
              onPress={onImportDocument}
              testID="import-document"
              title="Import"
            />
          </View>
        </View>
        {hasDocuments ? (
          <View style={styles.grid} testID="document-grid">
            {documents.map((document) => (
              <DocumentCard
                document={document}
                key={document.id}
                layoutClass={layoutClass}
                onActions={onDocumentActions}
                onOpen={onOpenDocument}
              />
            ))}
          </View>
        ) : (
          <EmptyLibrary />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  action: {
    alignItems: "center",
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  compactContent: {
    paddingHorizontal: 18,
  },
  empty: {
    alignItems: "center",
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 10,
    padding: 24,
  },
  emptyBody: {
    maxWidth: 440,
    textAlign: "center",
  },
  emptyDiagram: {
    borderRadius: 18,
    height: 116,
    marginBottom: 6,
    position: "relative",
    width: 196,
  },
  emptyEdge: {
    height: 3,
    left: 52,
    opacity: 0.7,
    position: "absolute",
    top: 56,
    transform: [{ rotate: "-14deg" }],
    width: 94,
  },
  emptyNode: {
    borderRadius: 999,
    borderWidth: 3,
    height: 34,
    position: "absolute",
    width: 34,
  },
  emptyNodeEnd: {
    right: 30,
    top: 26,
  },
  emptyNodeStart: {
    bottom: 22,
    left: 28,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 16,
  },
  header: {
    gap: 14,
    paddingBottom: 24,
    paddingTop: 10,
  },
  headingCopy: {
    flex: 1,
    gap: 2,
  },
  identity: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
  },
  mark: {
    alignItems: "center",
    borderRadius: 14,
    height: 52,
    justifyContent: "center",
    width: 52,
  },
  markText: {
    fontSize: 25,
    fontWeight: "800",
    lineHeight: 29,
  },
  regularContent: {
    alignSelf: "center",
    maxWidth: 1180,
    paddingHorizontal: 32,
    width: "100%",
  },
  safeArea: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: 32,
  },
  subtitle: {
    maxWidth: 620,
  },
});
