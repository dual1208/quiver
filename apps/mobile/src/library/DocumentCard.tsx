import { useCallback } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { LayoutClass } from "../layout/useLayoutClass";
import { useTheme } from "../theme/ThemeProvider";

export type LibraryDocumentSummary = Readonly<{
  id: string;
  title: string;
  updatedLabel: string;
  detail: string;
}>;

export type DocumentCardProps = Readonly<{
  document: LibraryDocumentSummary;
  layoutClass: LayoutClass;
  onOpen: (id: string) => void;
  onActions: (id: string) => void;
}>;

export function DocumentCard({
  document,
  layoutClass,
  onOpen,
  onActions,
}: DocumentCardProps) {
  const theme = useTheme();
  const openDocument = useCallback(() => {
    onOpen(document.id);
  }, [document.id, onOpen]);
  const openActions = useCallback(() => {
    onActions(document.id);
  }, [document.id, onActions]);

  return (
    <View
      style={[
        styles.card,
        layoutClass === "regular" ? styles.regularCard : styles.compactCard,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          shadowColor: theme.colors.shadow,
        },
      ]}
    >
      <Pressable
        accessibilityLabel={`Open ${document.title}, ${document.updatedLabel}`}
        accessibilityRole="button"
        onPress={openDocument}
        style={styles.openTarget}
        testID={`document-card-${document.id}`}
      >
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.preview, { backgroundColor: theme.colors.canvas }]}
        >
          <View
            style={[
              styles.previewEdge,
              { backgroundColor: theme.colors.primary },
            ]}
          />
          <View
            style={[
              styles.previewNode,
              styles.previewNodeStart,
              {
                backgroundColor: theme.colors.surface,
                borderColor: theme.colors.primary,
              },
            ]}
          />
          <View
            style={[
              styles.previewNode,
              styles.previewNodeEnd,
              {
                backgroundColor: theme.colors.surface,
                borderColor: theme.colors.selection,
              },
            ]}
          />
        </View>
        <View style={styles.copy}>
          <Text
            allowFontScaling
            maxFontSizeMultiplier={1.8}
            numberOfLines={2}
            style={[
              theme.typography.title,
              { color: theme.colors.textPrimary },
            ]}
          >
            {document.title}
          </Text>
          <Text
            allowFontScaling
            maxFontSizeMultiplier={1.8}
            style={[
              theme.typography.body,
              { color: theme.colors.textSecondary },
            ]}
          >
            {document.detail}
          </Text>
          <Text
            allowFontScaling
            maxFontSizeMultiplier={1.8}
            style={[styles.updated, { color: theme.colors.textSecondary }]}
          >
            {document.updatedLabel}
          </Text>
        </View>
      </Pressable>
      <Pressable
        accessibilityLabel={`More actions for ${document.title}`}
        accessibilityRole="button"
        hitSlop={6}
        onPress={openActions}
        style={[
          styles.more,
          {
            minHeight: theme.minimumTargetSize,
            minWidth: theme.minimumTargetSize,
          },
        ]}
        testID={`document-actions-${document.id}`}
      >
        <Text
          allowFontScaling
          maxFontSizeMultiplier={1.5}
          style={[styles.moreText, { color: theme.colors.textSecondary }]}
        >
          •••
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 2,
    overflow: "hidden",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.07,
    shadowRadius: 18,
  },
  compactCard: {
    width: "100%",
  },
  copy: {
    flex: 1,
    gap: 3,
    padding: 16,
  },
  more: {
    alignItems: "center",
    bottom: 4,
    justifyContent: "center",
    position: "absolute",
    right: 4,
  },
  moreText: {
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: 1,
  },
  openTarget: {
    flex: 1,
  },
  preview: {
    height: 126,
    overflow: "hidden",
    position: "relative",
  },
  previewEdge: {
    height: 3,
    left: "26%",
    opacity: 0.62,
    position: "absolute",
    top: "51%",
    transform: [{ rotate: "-12deg" }],
    width: "50%",
  },
  previewNode: {
    borderRadius: 999,
    borderWidth: 3,
    height: 32,
    position: "absolute",
    width: 32,
  },
  previewNodeEnd: {
    right: "19%",
    top: "29%",
  },
  previewNodeStart: {
    bottom: "24%",
    left: "18%",
  },
  regularCard: {
    flexBasis: 280,
    flexGrow: 1,
    maxWidth: 380,
    minWidth: 260,
  },
  updated: {
    fontSize: 13,
    lineHeight: 19,
    marginRight: 42,
  },
});
