import {
  type DimensionValue,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useCallback, useState, type ReactNode } from "react";
import type { LayoutClass } from "../../layout/useLayoutClass";
import { useTheme } from "../../theme/ThemeProvider";

export type EditorSelectionState = Readonly<{
  kind: "none" | "vertex" | "edge" | "mixed";
  count: number;
}>;

type CompactSnapPoint = "collapsed" | "half" | "full";

type InspectorContainerProps = Readonly<{
  layoutClass: LayoutClass;
  selectionState: EditorSelectionState;
  children: ReactNode;
}>;

const compactHeights: Record<CompactSnapPoint, DimensionValue> = {
  collapsed: 92,
  half: "50%",
  full: "100%",
};

const snapLabels: Record<CompactSnapPoint, string> = {
  collapsed: "Collapsed",
  half: "Half height",
  full: "Full height",
};

function advanceSnapPoint(current: CompactSnapPoint): CompactSnapPoint {
  if (current === "collapsed") {
    return "half";
  }
  return current === "half" ? "full" : "collapsed";
}

function adjustSnapPoint(
  current: CompactSnapPoint,
  direction: "increment" | "decrement",
): CompactSnapPoint {
  const points: readonly CompactSnapPoint[] = ["collapsed", "half", "full"];
  const currentIndex = points.indexOf(current);
  const offset = direction === "increment" ? 1 : -1;
  const nextIndex = Math.min(Math.max(currentIndex + offset, 0), 2);
  return points[nextIndex];
}

function selectionLabel(selection: EditorSelectionState): string {
  if (selection.kind === "none" || selection.count === 0) {
    return "No selection";
  }
  if (selection.kind === "vertex") {
    return selection.count === 1
      ? "Vertex selected"
      : `${selection.count} vertices selected`;
  }
  if (selection.kind === "edge") {
    return selection.count === 1
      ? "Edge selected"
      : `${selection.count} edges selected`;
  }
  return `${selection.count} items selected`;
}

export function InspectorContainer({
  layoutClass,
  selectionState,
  children,
}: InspectorContainerProps) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const [snapPoint, setSnapPoint] = useState<CompactSnapPoint>("half");
  const compact = layoutClass === "compact";
  const inspectorWidth = width > 1200 ? 380 : 320;
  const cycleSnapPoint = useCallback(() => {
    setSnapPoint((current) => advanceSnapPoint(current));
  }, []);
  const onAccessibilityAction = useCallback(
    (event: { nativeEvent: { actionName: string } }) => {
      const direction = event.nativeEvent.actionName;
      if (direction !== "increment" && direction !== "decrement") {
        return;
      }
      setSnapPoint((current) => adjustSnapPoint(current, direction));
    },
    [],
  );

  return (
    <View
      style={[
        styles.inspector,
        compact ? styles.compact : styles.regular,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
        },
        compact
          ? { height: compactHeights[snapPoint] }
          : { width: inspectorWidth },
      ]}
      testID={compact ? "editor-bottom-sheet" : "editor-side-inspector"}
    >
      {compact ? (
        <Pressable
          accessibilityActions={[
            { name: "increment", label: "Expand inspector" },
            { name: "decrement", label: "Collapse inspector" },
          ]}
          accessibilityLabel="Inspector size"
          accessibilityRole="adjustable"
          accessibilityValue={{ text: snapLabels[snapPoint] }}
          onAccessibilityAction={onAccessibilityAction}
          onPress={cycleSnapPoint}
          style={[styles.handleTarget, { minHeight: theme.minimumTargetSize }]}
          testID="inspector-drag-handle"
        >
          <View
            style={[
              styles.handle,
              { backgroundColor: theme.colors.textSecondary },
            ]}
          />
        </Pressable>
      ) : null}
      <View style={styles.heading}>
        <Text
          allowFontScaling
          maxFontSizeMultiplier={1.8}
          style={[
            theme.typography.eyebrow,
            { color: theme.colors.textSecondary },
          ]}
        >
          Inspector
        </Text>
        <Text
          allowFontScaling
          maxFontSizeMultiplier={1.8}
          style={[theme.typography.title, { color: theme.colors.textPrimary }]}
        >
          {selectionLabel(selectionState)}
        </Text>
      </View>
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  compact: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: StyleSheet.hairlineWidth,
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.12,
    shadowRadius: 22,
    zIndex: 20,
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  handle: {
    borderRadius: 999,
    height: 5,
    opacity: 0.44,
    width: 42,
  },
  handleTarget: {
    alignItems: "center",
    justifyContent: "center",
  },
  heading: {
    gap: 3,
    paddingBottom: 12,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  inspector: {
    overflow: "hidden",
  },
  regular: {
    borderLeftWidth: StyleSheet.hairlineWidth,
    flexShrink: 0,
  },
});
