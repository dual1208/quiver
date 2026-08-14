import {
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  type LayoutChangeEvent,
  useWindowDimensions,
  View,
} from "react-native";
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
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

const COLLAPSED_HEIGHT = 92;
const DRAG_ACTIVATION_DISTANCE = 4;

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

function compactOffsetForSnapPoint(
  snapPoint: CompactSnapPoint,
  sheetHeight: number,
): number {
  const collapsedOffset = Math.max(sheetHeight - COLLAPSED_HEIGHT, 0);
  if (snapPoint === "full") {
    return 0;
  }
  return snapPoint === "half"
    ? Math.min(sheetHeight / 2, collapsedOffset)
    : collapsedOffset;
}

function boundedCompactOffset(offset: number, sheetHeight: number): number {
  return Math.min(
    Math.max(offset, 0),
    compactOffsetForSnapPoint("collapsed", sheetHeight),
  );
}

function nearestCompactSnapPoint(
  offset: number,
  sheetHeight: number,
): CompactSnapPoint {
  const points: readonly CompactSnapPoint[] = ["full", "half", "collapsed"];
  let nearest = points[0];
  let nearestDistance = Math.abs(
    offset - compactOffsetForSnapPoint(nearest, sheetHeight),
  );
  for (const candidate of points.slice(1)) {
    const distance = Math.abs(
      offset - compactOffsetForSnapPoint(candidate, sheetHeight),
    );
    if (distance < nearestDistance) {
      nearest = candidate;
      nearestDistance = distance;
    }
  }
  return nearest;
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
  const { height, width } = useWindowDimensions();
  const [snapPoint, setSnapPoint] = useState<CompactSnapPoint>("half");
  const snapPointRef = useRef<CompactSnapPoint>("half");
  const sheetHeightRef = useRef(height);
  const initialOffset = compactOffsetForSnapPoint("half", height);
  const [compactOffset] = useState(() => new Animated.Value(initialOffset));
  const compactOffsetRef = useRef(initialOffset);
  const dragActiveRef = useRef(false);
  const dragDyRef = useRef(0);
  const dragStartOffsetRef = useRef(initialOffset);
  const compact = layoutClass === "compact";
  const inspectorCollapsed = compact && snapPoint === "collapsed";
  const inspectorWidth = width > 1200 ? 380 : 320;
  const setCompactOffset = useCallback(
    (offset: number) => {
      compactOffsetRef.current = offset;
      compactOffset.setValue(offset);
    },
    [compactOffset],
  );
  const commitSnapPoint = useCallback(
    (next: CompactSnapPoint) => {
      snapPointRef.current = next;
      setSnapPoint(next);
      setCompactOffset(compactOffsetForSnapPoint(next, sheetHeightRef.current));
    },
    [setCompactOffset],
  );
  const cycleSnapPoint = useCallback(() => {
    commitSnapPoint(advanceSnapPoint(snapPointRef.current));
  }, [commitSnapPoint]);
  const onAccessibilityAction = useCallback(
    (event: { nativeEvent: { actionName: string } }) => {
      const direction = event.nativeEvent.actionName;
      if (direction !== "increment" && direction !== "decrement") {
        return;
      }
      commitSnapPoint(adjustSnapPoint(snapPointRef.current, direction));
    },
    [commitSnapPoint],
  );
  const finishDrag = useCallback(
    (dy: number) => {
      const height = sheetHeightRef.current;
      const offset = boundedCompactOffset(
        dragStartOffsetRef.current + dy,
        height,
      );
      dragActiveRef.current = false;
      dragDyRef.current = 0;
      commitSnapPoint(nearestCompactSnapPoint(offset, height));
    },
    [commitSnapPoint],
  );
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_, gesture) =>
          Math.abs(gesture.dy) >= DRAG_ACTIVATION_DISTANCE &&
          Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderGrant: () => {
          dragActiveRef.current = true;
          dragDyRef.current = 0;
          dragStartOffsetRef.current = compactOffsetRef.current;
        },
        onPanResponderMove: (_, gesture) => {
          dragDyRef.current = gesture.dy;
          setCompactOffset(
            boundedCompactOffset(
              dragStartOffsetRef.current + gesture.dy,
              sheetHeightRef.current,
            ),
          );
        },
        onPanResponderRelease: (_, gesture) => finishDrag(gesture.dy),
        onPanResponderTerminate: (_, gesture) => finishDrag(gesture.dy),
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true,
      }),
    [finishDrag, setCompactOffset],
  );
  const onCompactLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const nextHeight = event.nativeEvent.layout.height;
      if (nextHeight <= 0) {
        return;
      }
      sheetHeightRef.current = nextHeight;
      const snapOffset = compactOffsetForSnapPoint(
        snapPointRef.current,
        nextHeight,
      );
      if (dragActiveRef.current) {
        dragStartOffsetRef.current = snapOffset;
        setCompactOffset(
          boundedCompactOffset(snapOffset + dragDyRef.current, nextHeight),
        );
        return;
      }
      setCompactOffset(snapOffset);
    },
    [setCompactOffset],
  );

  return (
    <Animated.View
      onLayout={compact ? onCompactLayout : undefined}
      style={[
        styles.inspector,
        compact ? styles.compact : styles.regular,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
        },
        compact
          ? { transform: [{ translateY: compactOffset }] }
          : { width: inspectorWidth },
      ]}
      testID={compact ? "editor-bottom-sheet" : "editor-side-inspector"}
    >
      {compact ? (
        <View
          {...panResponder.panHandlers}
          collapsable={false}
          testID="inspector-drag-region"
        >
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
            style={[
              styles.handleTarget,
              { minHeight: theme.minimumTargetSize },
            ]}
            testID="inspector-drag-handle"
          >
            <View
              style={[
                styles.handle,
                { backgroundColor: theme.colors.textSecondary },
              ]}
              testID="inspector-handle-cue"
            />
          </Pressable>
        </View>
      ) : null}
      <View
        accessibilityElementsHidden={inspectorCollapsed}
        importantForAccessibility={
          inspectorCollapsed ? "no-hide-descendants" : "auto"
        }
        pointerEvents={inspectorCollapsed ? "none" : "auto"}
        style={[
          styles.collapsibleContent,
          inspectorCollapsed ? styles.collapsedContent : null,
        ]}
        testID="inspector-collapsible-content"
      >
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
            style={[
              theme.typography.title,
              { color: theme.colors.textPrimary },
            ]}
          >
            {selectionLabel(selectionState)}
          </Text>
        </View>
        <View style={styles.content}>{children}</View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  collapsedContent: {
    opacity: 0,
  },
  collapsibleContent: {
    flex: 1,
  },
  compact: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: StyleSheet.hairlineWidth,
    bottom: 0,
    height: "100%",
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
    opacity: 0.7,
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
