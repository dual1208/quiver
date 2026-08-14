import type { DiagramDocument, EntityId, GridPoint } from "@quiver/core";
import {
  Canvas,
  DashPathEffect,
  Group,
  matchFont,
  Path,
  RoundedRect,
  Text as SkiaText,
} from "@shopify/react-native-skia";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  StyleSheet,
  Text,
  type LayoutChangeEvent,
  type StyleProp,
  View,
  type ViewStyle,
} from "react-native";
import {
  Gesture,
  GestureDetector,
} from "react-native-gesture-handler";
import { useTheme } from "../../theme/ThemeProvider";
import {
  buildDiagramGeometry,
  clamp,
  clampViewportTranslation,
  DOCUMENT_GRID_SIZE,
  fitViewportToBounds,
  hitTestEntity,
  hitTestVertex,
  hslaToColor,
  MAX_VIEWPORT_SCALE,
  MIN_VIEWPORT_SCALE,
  screenToDocumentPoint,
  type DiagramGeometry,
} from "./geometry";

type Viewport = Readonly<{
  translateX: number;
  translateY: number;
  scale: number;
}>;

type CanvasSize = Readonly<{ width: number; height: number }>;

export type DiagramCanvasProps = Readonly<{
  document: DiagramDocument;
  selectedIds: readonly EntityId[];
  onSelectionChange: (ids: readonly EntityId[]) => void;
  onCreateVertex: (point: GridPoint) => void;
  onMoveVertex: (id: EntityId, point: GridPoint) => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}>;

export type DiagramCanvasHandle = Readonly<{
  fitToContent: (options?: { readonly animated?: boolean }) => void;
  documentPointAtCenter: () => GridPoint;
}>;

function samePoint(left: GridPoint, right: GridPoint): boolean {
  return left.x === right.x && left.y === right.y;
}

function isDashedBody(name: string): boolean {
  return name.includes("dash") || name.includes("dot");
}

function hasVisibleBody(name: string): boolean {
  return name !== "none" && name !== "invisible";
}

function hasArrowhead(name: string): boolean {
  return name !== "none" && name !== "invisible";
}

export const DiagramCanvas = forwardRef<
  DiagramCanvasHandle,
  DiagramCanvasProps
>(function DiagramCanvas(
  {
    document,
    selectedIds,
    onSelectionChange,
    onCreateVertex,
    onMoveVertex,
    style,
    testID = "diagram-canvas",
  },
  ref,
) {
  const theme = useTheme();
  const vertexFont = useMemo(
    () => matchFont({ fontSize: 16, fontWeight: "600" }),
    [],
  );
  const edgeFont = useMemo(
    () => matchFont({ fontSize: 14, fontWeight: "500" }),
    [],
  );
  const [size, setSize] = useState<CanvasSize>({ width: 0, height: 0 });
  const [viewport, setViewportState] = useState<Viewport>({
    translateX: 0,
    translateY: 0,
    scale: 1,
  });
  const [dragPreview, setDragPreview] = useState<{
    readonly id: EntityId;
    readonly point: GridPoint;
  } | null>(null);
  const viewportRef = useRef(viewport);
  const sizeRef = useRef(size);
  const geometryRef = useRef<DiagramGeometry | null>(null);
  const didPlaceViewportRef = useRef(false);
  const dragRef = useRef<{
    id: EntityId;
    origin: GridPoint;
    preview: GridPoint;
  } | null>(null);
  const panLastRef = useRef({ x: 0, y: 0 });
  const pinchLastScaleRef = useRef(1);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const geometry = useMemo(
    () =>
      buildDiagramGeometry(
        document,
        (label) => vertexFont.measureText(label).width,
        (label) => edgeFont.measureText(label).width,
        dragPreview,
      ),
    [document, dragPreview, edgeFont, vertexFont],
  );
  geometryRef.current = geometry;

  const setViewport = useCallback((next: Viewport) => {
    viewportRef.current = next;
    setViewportState(next);
  }, []);

  const boundedViewport = useCallback((candidate: Viewport): Viewport => {
    const currentSize = sizeRef.current;
    const currentGeometry = geometryRef.current;
    if (
      currentGeometry === null ||
      currentSize.width <= 0 ||
      currentSize.height <= 0
    ) {
      return candidate;
    }
    const translation = clampViewportTranslation(
      candidate.translateX,
      candidate.translateY,
      candidate.scale,
      currentSize.width,
      currentSize.height,
      currentGeometry.bounds,
    );
    return { ...candidate, translateX: translation.x, translateY: translation.y };
  }, []);

  const fitToContent = useCallback(() => {
    const currentSize = sizeRef.current;
    const currentGeometry = geometryRef.current;
    if (
      currentGeometry === null ||
      currentSize.width <= 0 ||
      currentSize.height <= 0
    ) {
      return;
    }
    setViewport(
      fitViewportToBounds(
        currentGeometry.bounds,
        currentSize.width,
        currentSize.height,
      ),
    );
  }, [setViewport]);

  useImperativeHandle(
    ref,
    () => ({
      fitToContent: () => fitToContent(),
      documentPointAtCenter: () => {
        const current = viewportRef.current;
        const currentSize = sizeRef.current;
        return screenToDocumentPoint(
          { x: currentSize.width / 2, y: currentSize.height / 2 },
          current.translateX,
          current.translateY,
          current.scale,
        );
      },
    }),
    [fitToContent],
  );

  useEffect(() => {
    if (
      !didPlaceViewportRef.current &&
      size.width > 0 &&
      size.height > 0
    ) {
      didPlaceViewportRef.current = true;
      fitToContent();
    }
  }, [fitToContent, size.height, size.width]);

  const onLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const next = {
        width: event.nativeEvent.layout.width,
        height: event.nativeEvent.layout.height,
      };
      const previous = sizeRef.current;
      sizeRef.current = next;
      setSize(next);
      if (previous.width > 0 && previous.height > 0) {
        const current = viewportRef.current;
        setViewport({
          ...current,
          translateX: current.translateX + (next.width - previous.width) / 2,
          translateY: current.translateY + (next.height - previous.height) / 2,
        });
      }
    },
    [setViewport],
  );

  const singleTap = useMemo(
    () =>
      Gesture.Tap()
        .maxDuration(260)
        .runOnJS(true)
        .onEnd((event, success) => {
          if (!success || geometryRef.current === null) {
            return;
          }
          const current = viewportRef.current;
          const hit = hitTestEntity(
            geometryRef.current,
            { x: event.x, y: event.y },
            current.translateX,
            current.translateY,
            current.scale,
            7,
          );
          onSelectionChange(hit === null ? [] : [hit]);
        }),
    [onSelectionChange],
  );

  const doubleTap = useMemo(
    () =>
      Gesture.Tap()
        .numberOfTaps(2)
        .maxDelay(280)
        .runOnJS(true)
        .onEnd((event, success) => {
          if (!success || geometryRef.current === null) {
            return;
          }
          const current = viewportRef.current;
          const hit = hitTestEntity(
            geometryRef.current,
            { x: event.x, y: event.y },
            current.translateX,
            current.translateY,
            current.scale,
            5,
          );
          if (hit === null) {
            onCreateVertex(
              screenToDocumentPoint(
                { x: event.x, y: event.y },
                current.translateX,
                current.translateY,
                current.scale,
              ),
            );
          }
        }),
    [onCreateVertex],
  );

  const vertexDrag = useMemo(
    () =>
      Gesture.Pan()
        .maxPointers(1)
        .minDistance(5)
        .runOnJS(true)
        .onBegin((event) => {
          if (geometryRef.current === null) {
            dragRef.current = null;
            return;
          }
          const current = viewportRef.current;
          const hit = hitTestVertex(
            geometryRef.current,
            { x: event.x, y: event.y },
            current.translateX,
            current.translateY,
            current.scale,
            8,
          );
          if (hit === null) {
            dragRef.current = null;
            return;
          }
          const origin = { x: hit.vertex.x, y: hit.vertex.y };
          dragRef.current = { id: hit.id, origin, preview: origin };
          onSelectionChange([hit.id]);
        })
        .onUpdate((event) => {
          const drag = dragRef.current;
          if (drag === null) {
            return;
          }
          const scale = Math.max(MIN_VIEWPORT_SCALE, viewportRef.current.scale);
          const point = {
            x: Math.round(
              drag.origin.x + event.translationX / scale / DOCUMENT_GRID_SIZE,
            ),
            y: Math.round(
              drag.origin.y + event.translationY / scale / DOCUMENT_GRID_SIZE,
            ),
          };
          if (!samePoint(point, drag.preview)) {
            drag.preview = point;
            setDragPreview({ id: drag.id, point });
          }
        })
        .onFinalize(() => {
          const drag = dragRef.current;
          dragRef.current = null;
          setDragPreview(null);
          if (drag !== null && !samePoint(drag.origin, drag.preview)) {
            onMoveVertex(drag.id, drag.preview);
          }
        }),
    [onMoveVertex, onSelectionChange],
  );

  const twoFingerPan = useMemo(
    () =>
      Gesture.Pan()
        .minPointers(2)
        .runOnJS(true)
        .onStart(() => {
          panLastRef.current = { x: 0, y: 0 };
        })
        .onUpdate((event) => {
          const last = panLastRef.current;
          const current = viewportRef.current;
          panLastRef.current = {
            x: event.translationX,
            y: event.translationY,
          };
          setViewport({
            ...current,
            translateX: current.translateX + event.translationX - last.x,
            translateY: current.translateY + event.translationY - last.y,
          });
        })
        .onFinalize(() => {
          setViewport(boundedViewport(viewportRef.current));
        }),
    [boundedViewport, setViewport],
  );

  const pinch = useMemo(
    () =>
      Gesture.Pinch()
        .runOnJS(true)
        .onStart(() => {
          pinchLastScaleRef.current = 1;
        })
        .onUpdate((event) => {
          const current = viewportRef.current;
          const previousGestureScale = Math.max(
            0.001,
            pinchLastScaleRef.current,
          );
          const ratio = event.scale / previousGestureScale;
          pinchLastScaleRef.current = event.scale;
          const nextScale = clamp(
            current.scale * ratio,
            MIN_VIEWPORT_SCALE,
            MAX_VIEWPORT_SCALE,
          );
          const appliedRatio = nextScale / current.scale;
          setViewport({
            scale: nextScale,
            translateX:
              event.focalX - (event.focalX - current.translateX) * appliedRatio,
            translateY:
              event.focalY - (event.focalY - current.translateY) * appliedRatio,
          });
        })
        .onFinalize(() => {
          setViewport(boundedViewport(viewportRef.current));
        }),
    [boundedViewport, setViewport],
  );

  const gesture = useMemo(
    () =>
      Gesture.Simultaneous(
        twoFingerPan,
        pinch,
        Gesture.Exclusive(vertexDrag, doubleTap, singleTap),
      ),
    [doubleTap, pinch, singleTap, twoFingerPan, vertexDrag],
  );

  return (
    <View
      accessibilityLabel="Diagram canvas. Double tap to add an object. Pinch to zoom and use two fingers to pan."
      onLayout={onLayout}
      style={[styles.root, { backgroundColor: theme.colors.canvas }, style]}
      testID={testID}
    >
      <GestureDetector gesture={gesture}>
        <View collapsable={false} style={StyleSheet.absoluteFill}>
          <Canvas style={StyleSheet.absoluteFill}>
            <Group
              transform={[
                { translateX: viewport.translateX },
                { translateY: viewport.translateY },
                { scale: viewport.scale },
              ]}
            >
              <Path
                color={theme.colors.grid}
                opacity={0.72}
                path={geometry.gridPath}
                strokeWidth={1}
                style="stroke"
              />
              <Path
                color={theme.colors.grid}
                opacity={0.95}
                path={geometry.axisPath}
                strokeWidth={1.5}
                style="stroke"
              />

              {geometry.edges.map((edge) => {
                const selected = selectedSet.has(edge.id);
                const color = selected
                  ? theme.colors.selection
                  : hslaToColor(edge.edge.options.colour);
                const bodyName = edge.edge.options.style.body.name;
                const headName = edge.edge.options.style.head.name;
                return (
                  <Group key={edge.id}>
                    {hasVisibleBody(bodyName) ? (
                      <Path
                        color={color}
                        path={edge.path}
                        strokeCap="round"
                        strokeJoin="round"
                        strokeWidth={selected ? 3.4 : 2.2}
                        style="stroke"
                      >
                        {isDashedBody(bodyName) ? (
                          <DashPathEffect intervals={[10, 7]} phase={0} />
                        ) : null}
                      </Path>
                    ) : null}
                    {hasArrowhead(headName) ? (
                      <Path color={color} path={edge.arrowhead} style="fill" />
                    ) : null}
                    {edge.label.length > 0 ? (
                      <Group>
                        <RoundedRect
                          color={theme.colors.surface}
                          height={edge.labelHeight}
                          opacity={0.94}
                          r={7}
                          width={edge.labelWidth}
                          x={edge.labelX}
                          y={edge.labelPoint.y - edge.labelHeight / 2}
                        />
                        <SkiaText
                          color={hslaToColor(edge.edge.labelColour)}
                          font={edgeFont}
                          text={edge.label}
                          x={edge.labelX + 6}
                          y={edge.labelBaseline}
                        />
                      </Group>
                    ) : null}
                  </Group>
                );
              })}

              {geometry.vertices.map((vertex) => {
                const selected = selectedSet.has(vertex.id);
                return (
                  <Group key={vertex.id}>
                    <RoundedRect
                      color={
                        selected
                          ? theme.colors.primarySurface
                          : theme.colors.surface
                      }
                      height={vertex.height}
                      r={12}
                      width={vertex.width}
                      x={vertex.left}
                      y={vertex.top}
                    />
                    <RoundedRect
                      color={
                        selected
                          ? theme.colors.selection
                          : theme.colors.textSecondary
                      }
                      height={vertex.height}
                      r={12}
                      strokeWidth={selected ? 3.2 : 1.6}
                      style="stroke"
                      width={vertex.width}
                      x={vertex.left}
                      y={vertex.top}
                    />
                    <SkiaText
                      color={hslaToColor(vertex.vertex.labelColour)}
                      font={vertexFont}
                      text={vertex.label}
                      x={vertex.labelX}
                      y={vertex.labelBaseline}
                    />
                  </Group>
                );
              })}
            </Group>
          </Canvas>
        </View>
      </GestureDetector>

      {document.vertices.length === 0 ? (
        <View pointerEvents="none" style={styles.emptyHint}>
          <View
            style={[
              styles.emptyCard,
              {
                backgroundColor: theme.colors.surface,
                borderColor: theme.colors.border,
              },
            ]}
          >
            <Text style={[theme.typography.bodyStrong, { color: theme.colors.textPrimary }]}>Double-tap to place an object</Text>
            <Text style={[theme.typography.body, { color: theme.colors.textSecondary }]}>Pinch to zoom · two fingers to pan</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  emptyCard: {
    alignItems: "center",
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 3,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  emptyHint: {
    alignItems: "center",
    bottom: 0,
    justifyContent: "center",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  root: {
    flex: 1,
    minHeight: 0,
    minWidth: 0,
    overflow: "hidden",
    position: "relative",
  },
});
