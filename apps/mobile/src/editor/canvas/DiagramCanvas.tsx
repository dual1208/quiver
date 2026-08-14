import type { DiagramDocument, EntityId, GridPoint } from "@quiver/core";
import {
  Canvas,
  Circle,
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
import { useSharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useTheme } from "../../theme/ThemeProvider";
import {
  buildDiagramGeometry,
  clamp,
  clampViewportTranslation,
  connectionPreviewPath,
  DOCUMENT_GRID_SIZE,
  documentPointToWorldCenter,
  fitViewportToBounds,
  hitTestEntity,
  hitTestVertex,
  hslaToColor,
  MAX_VIEWPORT_SCALE,
  MIN_VIEWPORT_SCALE,
  screenToDocumentPoint,
  screenToWorldPoint,
  type DiagramGeometry,
  type WorldPoint,
} from "./geometry";

type Viewport = Readonly<{
  translateX: number;
  translateY: number;
  scale: number;
}>;

type CanvasSize = Readonly<{ width: number; height: number }>;

type ConnectionPreviewState = Readonly<{
  sourceId: EntityId;
  sourcePoint: GridPoint;
  start: WorldPoint;
  pointer: WorldPoint;
  targetPoint: GridPoint;
  moved: boolean;
}>;

export type DiagramCanvasProps = Readonly<{
  document: DiagramDocument;
  selectedIds: readonly EntityId[];
  onSelectionChange: (ids: readonly EntityId[]) => void;
  onBeginConnection: (point: GridPoint) => EntityId;
  onCompleteConnection: (sourceId: EntityId, point: GridPoint) => void;
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

function snappedPoint(point: GridPoint): GridPoint {
  return { x: Math.round(point.x), y: Math.round(point.y) };
}

function screenDistance(left: WorldPoint, right: WorldPoint): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function isBulletLabel(label: string): boolean {
  const trimmed = label.trim();
  return trimmed === "\\bullet" || trimmed === "bullet" || trimmed === "•";
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

function canvasColour(
  value: readonly [number, number, number, number],
  dark: boolean,
  darkFallback: string,
): string {
  return dark && value[1] <= 8 && value[2] <= 18 && value[3] > 0.5
    ? darkFallback
    : hslaToColor(value);
}

export const DiagramCanvas = forwardRef<
  DiagramCanvasHandle,
  DiagramCanvasProps
>(function DiagramCanvas(
  {
    document,
    selectedIds,
    onSelectionChange,
    onBeginConnection,
    onCompleteConnection,
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
  const [connectionPreview, setConnectionPreview] =
    useState<ConnectionPreviewState | null>(null);
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
  const connectionRef = useRef<ConnectionPreviewState | null>(null);
  const connectionSessionRef = useRef(0);
  const lastUpAt = useSharedValue(0);
  const lastUpX = useSharedValue(0);
  const lastUpY = useSharedValue(0);
  const connectionDownAt = useSharedValue(0);
  const connectionDownX = useSharedValue(0);
  const connectionDownY = useSharedValue(0);
  const connectionMode = useSharedValue(0);
  const connectionSession = useSharedValue(0);
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

  const documentPointFromScreen = useCallback((screen: WorldPoint) => {
    const current = viewportRef.current;
    return screenToDocumentPoint(
      screen,
      current.translateX,
      current.translateY,
      current.scale,
    );
  }, []);

  const setActiveConnection = useCallback(
    (next: ConnectionPreviewState | null) => {
      connectionRef.current = next;
      setConnectionPreview(next);
    },
    [],
  );

  const cancelActiveConnection = useCallback(
    (token: number) => {
      if (connectionSessionRef.current !== token) {
        return;
      }
      connectionSessionRef.current = 0;
      setActiveConnection(null);
    },
    [setActiveConnection],
  );

  const beginSecondContact = useCallback(
    (token: number, x: number, y: number) => {
      const screen = { x, y };
      const sourcePoint = snappedPoint(documentPointFromScreen(screen));
      const sourceId = onBeginConnection(sourcePoint);
      connectionSessionRef.current = token;
      setActiveConnection({
        sourceId,
        sourcePoint,
        start: screen,
        pointer: screen,
        targetPoint: sourcePoint,
        moved: false,
      });
    },
    [documentPointFromScreen, onBeginConnection, setActiveConnection],
  );

  const moveSecondContact = useCallback(
    (token: number, x: number, y: number) => {
      const active = connectionRef.current;
      if (active === null || connectionSessionRef.current !== token) {
        return;
      }
      const screen = { x, y };
      setActiveConnection({
        ...active,
        pointer: screen,
        targetPoint: snappedPoint(documentPointFromScreen(screen)),
        moved: active.moved || screenDistance(active.start, screen) > 8,
      });
    },
    [documentPointFromScreen, setActiveConnection],
  );

  const finishSecondContact = useCallback(
    (token: number, x: number, y: number) => {
      const active = connectionRef.current;
      if (active === null || connectionSessionRef.current !== token) {
        return;
      }
      const screen = { x, y };
      if (active.moved || screenDistance(active.start, screen) > 8) {
        onCompleteConnection(
          active.sourceId,
          snappedPoint(documentPointFromScreen(screen)),
        );
      }
      connectionSessionRef.current = 0;
      setActiveConnection(null);
    },
    [documentPointFromScreen, onCompleteConnection, setActiveConnection],
  );

  const connectionGesture = useMemo(
    () =>
      Gesture.Manual()
        .shouldCancelWhenOutside(false)
        .onTouchesDown((event, stateManager) => {
          "worklet";
          const touch = event.changedTouches[0];
          if (event.numberOfTouches !== 1 || touch === undefined) {
            const token = connectionSession.value;
            const wasActive = connectionMode.value === 2;
            connectionMode.value = 0;
            lastUpAt.value = 0;
            if (wasActive) {
              scheduleOnRN(cancelActiveConnection, token);
            }
            stateManager.fail();
            return;
          }

          const now = Date.now();
          const dx = touch.x - lastUpX.value;
          const dy = touch.y - lastUpY.value;
          const secondContact =
            lastUpAt.value > 0 &&
            now - lastUpAt.value <= 280 &&
            dx * dx + dy * dy <= 48 * 48;
          connectionDownAt.value = now;
          connectionDownX.value = touch.x;
          connectionDownY.value = touch.y;

          if (!secondContact) {
            connectionMode.value = 1;
            return;
          }

          lastUpAt.value = 0;
          connectionMode.value = 2;
          connectionSession.value += 1;
          stateManager.activate();
          scheduleOnRN(
            beginSecondContact,
            connectionSession.value,
            touch.x,
            touch.y,
          );
        })
        .onTouchesMove((event, stateManager) => {
          "worklet";
          const touch = event.changedTouches[0];
          if (event.numberOfTouches !== 1 || touch === undefined) {
            const token = connectionSession.value;
            const wasActive = connectionMode.value === 2;
            connectionMode.value = 0;
            lastUpAt.value = 0;
            if (wasActive) {
              scheduleOnRN(cancelActiveConnection, token);
            }
            stateManager.fail();
            return;
          }
          const dx = touch.x - connectionDownX.value;
          const dy = touch.y - connectionDownY.value;
          if (connectionMode.value === 1) {
            if (dx * dx + dy * dy > 8 * 8) {
              connectionMode.value = 0;
              lastUpAt.value = 0;
              stateManager.fail();
            }
            return;
          }
          if (connectionMode.value === 2) {
            scheduleOnRN(
              moveSecondContact,
              connectionSession.value,
              touch.x,
              touch.y,
            );
          }
        })
        .onTouchesUp((event, stateManager) => {
          "worklet";
          const touch = event.changedTouches[0];
          if (touch === undefined) {
            connectionMode.value = 0;
            stateManager.fail();
            return;
          }
          if (connectionMode.value === 2) {
            const token = connectionSession.value;
            connectionMode.value = 0;
            scheduleOnRN(finishSecondContact, token, touch.x, touch.y);
            stateManager.end();
            return;
          }

          const now = Date.now();
          const dx = touch.x - connectionDownX.value;
          const dy = touch.y - connectionDownY.value;
          const cleanFirstTap =
            connectionMode.value === 1 &&
            now - connectionDownAt.value <= 280 &&
            dx * dx + dy * dy <= 8 * 8;
          connectionMode.value = 0;
          if (cleanFirstTap) {
            lastUpAt.value = now;
            lastUpX.value = touch.x;
            lastUpY.value = touch.y;
          } else {
            lastUpAt.value = 0;
          }
          stateManager.fail();
        })
        .onTouchesCancelled((_event, stateManager) => {
          "worklet";
          const token = connectionSession.value;
          const wasActive = connectionMode.value === 2;
          connectionMode.value = 0;
          lastUpAt.value = 0;
          if (wasActive) {
            scheduleOnRN(cancelActiveConnection, token);
          }
          stateManager.fail();
        }),
    [
      beginSecondContact,
      cancelActiveConnection,
      connectionDownAt,
      connectionDownX,
      connectionDownY,
      connectionMode,
      connectionSession,
      finishSecondContact,
      lastUpAt,
      lastUpX,
      lastUpY,
      moveSecondContact,
    ],
  );

  const connectionVisual = useMemo(() => {
    if (connectionPreview === null) {
      return null;
    }
    const source = geometry.vertices.find(
      (vertex) => vertex.id === connectionPreview.sourceId,
    );
    const sourceCenter =
      source?.center ?? documentPointToWorldCenter(connectionPreview.sourcePoint);
    const pointer = screenToWorldPoint(
      connectionPreview.pointer,
      viewport.translateX,
      viewport.translateY,
      viewport.scale,
    );
    return {
      path: connectionPreviewPath(
        sourceCenter,
        source?.width === undefined ? 10 : source.width / 2,
        source?.height === undefined ? 10 : source.height / 2,
        pointer,
      ),
      targetCenter: documentPointToWorldCenter(connectionPreview.targetPoint),
    };
  }, [connectionPreview, geometry.vertices, viewport]);

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

  const vertexDrag = useMemo(
    () =>
      Gesture.Pan()
        .maxPointers(1)
        .minDistance(5)
        .runOnJS(true)
        .onBegin((event) => {
          if (
            connectionRef.current !== null ||
            geometryRef.current === null
          ) {
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
          if (connectionRef.current !== null) {
            dragRef.current = null;
            setDragPreview(null);
            return;
          }
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
          if (
            connectionRef.current === null &&
            drag !== null &&
            !samePoint(drag.origin, drag.preview)
          ) {
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
        Gesture.Exclusive(connectionGesture, vertexDrag, singleTap),
      ),
    [connectionGesture, pinch, singleTap, twoFingerPan, vertexDrag],
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
              >
                <DashPathEffect intervals={[8, 8]} phase={0} />
              </Path>

              {geometry.edges.map((edge) => {
                const selected = selectedSet.has(edge.id);
                const color = selected
                  ? theme.colors.selection
                  : canvasColour(
                      edge.edge.options.colour,
                      theme.mode === "dark",
                      theme.colors.textPrimary,
                    );
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
                          color={canvasColour(
                            edge.edge.labelColour,
                            theme.mode === "dark",
                            theme.colors.textPrimary,
                          )}
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

              {connectionVisual?.path === null ||
              connectionVisual === null ? null : (
                <Group>
                  <Circle
                    color={theme.colors.selection}
                    cx={connectionVisual.targetCenter.x}
                    cy={connectionVisual.targetCenter.y}
                    opacity={0.16}
                    r={18}
                  />
                  <Circle
                    color={theme.colors.selection}
                    cx={connectionVisual.targetCenter.x}
                    cy={connectionVisual.targetCenter.y}
                    opacity={0.78}
                    r={8}
                    strokeWidth={2}
                    style="stroke"
                  />
                  <Path
                    color={theme.colors.selection}
                    path={connectionVisual.path.path}
                    strokeCap="round"
                    strokeWidth={2.8}
                    style="stroke"
                  />
                  <Path
                    color={theme.colors.selection}
                    path={connectionVisual.path.arrowhead}
                    style="fill"
                  />
                </Group>
              )}

              {geometry.vertices.map((vertex) => {
                const selected = selectedSet.has(vertex.id);
                const bullet = isBulletLabel(vertex.vertex.label);
                return (
                  <Group key={vertex.id}>
                    {selected ? (
                      <RoundedRect
                        color={theme.colors.primarySurface}
                        height={vertex.height + 12}
                        r={12}
                        width={vertex.width + 12}
                        x={vertex.left - 6}
                        y={vertex.top - 6}
                      />
                    ) : null}
                    {bullet ? (
                      <Circle
                        color={canvasColour(
                          vertex.vertex.labelColour,
                          theme.mode === "dark",
                          theme.colors.textPrimary,
                        )}
                        cx={vertex.center.x}
                        cy={vertex.center.y}
                        r={5.5}
                      />
                    ) : vertex.label.length > 0 ? (
                      <SkiaText
                        color={canvasColour(
                          vertex.vertex.labelColour,
                          theme.mode === "dark",
                          theme.colors.textPrimary,
                        )}
                        font={vertexFont}
                        text={vertex.label}
                        x={vertex.labelX}
                        y={vertex.labelBaseline}
                      />
                    ) : (
                      <Circle
                        color={theme.colors.textSecondary}
                        cx={vertex.center.x}
                        cy={vertex.center.y}
                        r={8}
                        strokeWidth={1.5}
                        style="stroke"
                      />
                    )}
                    {selected ? (
                      <RoundedRect
                        color={theme.colors.selection}
                        height={vertex.height + 12}
                        r={12}
                        strokeWidth={2.4}
                        style="stroke"
                        width={vertex.width + 12}
                        x={vertex.left - 6}
                        y={vertex.top - 6}
                      />
                    ) : null}
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
