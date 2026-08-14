import { router } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { EditorScreen } from "../../src/editor/EditorScreen";
import { useTheme } from "../../src/theme/ThemeProvider";

function noOp() {}

function returnToLibrary() {
  router.back();
}

function CanvasPlaceholder() {
  const theme = useTheme();

  return (
    <View
      accessibilityLabel="Empty diagram canvas"
      style={[styles.canvas, { backgroundColor: theme.colors.canvas }]}
      testID="editor-canvas"
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[
          styles.originHorizontal,
          { backgroundColor: theme.colors.grid },
        ]}
      />
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.originVertical, { backgroundColor: theme.colors.grid }]}
      />
      <View
        style={[
          styles.canvasHint,
          {
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.border,
          },
        ]}
      >
        <Text
          allowFontScaling
          maxFontSizeMultiplier={1.8}
          style={[
            theme.typography.bodyStrong,
            { color: theme.colors.textPrimary },
          ]}
        >
          Double-tap to place an object
        </Text>
        <Text
          allowFontScaling
          maxFontSizeMultiplier={1.8}
          style={[theme.typography.body, { color: theme.colors.textSecondary }]}
        >
          Pinch to zoom · two fingers to pan
        </Text>
      </View>
    </View>
  );
}

function InspectorPlaceholder() {
  const theme = useTheme();

  return (
    <View style={styles.inspectorContent}>
      <Text
        allowFontScaling
        maxFontSizeMultiplier={1.8}
        style={[theme.typography.body, { color: theme.colors.textSecondary }]}
      >
        Select an object or arrow to edit its label and appearance.
      </Text>
    </View>
  );
}

export default function EditorRoute() {
  return (
    <EditorScreen
      canRedo
      canUndo
      canvas={<CanvasPlaceholder />}
      inspector={<InspectorPlaceholder />}
      onBack={returnToLibrary}
      onConnectSelection={noOp}
      onCreateVertex={noOp}
      onFitToContent={noOp}
      onOverflow={noOp}
      onRedo={noOp}
      onSelectMode={noOp}
      onShare={noOp}
      onUndo={noOp}
      selectionState={{ kind: "none", count: 0 }}
      title="Untitled diagram"
    />
  );
}

const styles = StyleSheet.create({
  canvas: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    overflow: "hidden",
    position: "relative",
  },
  canvasHint: {
    alignItems: "center",
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 4,
    maxWidth: 360,
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  inspectorContent: {
    paddingTop: 4,
  },
  originHorizontal: {
    height: StyleSheet.hairlineWidth,
    left: 0,
    position: "absolute",
    right: 0,
    top: "50%",
  },
  originVertical: {
    bottom: 0,
    left: "50%",
    position: "absolute",
    top: 0,
    width: StyleSheet.hairlineWidth,
  },
});
