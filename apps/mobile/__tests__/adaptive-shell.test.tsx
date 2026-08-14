import {
  act,
  fireEvent,
  isHiddenFromAccessibility,
  render,
  screen,
} from "@testing-library/react-native";
import EditorRoute from "../app/editor/[id]";
import {
  Pressable,
  StyleSheet,
  Text,
  useColorScheme,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { EditorScreen } from "../src/editor/EditorScreen";
import {
  layoutClassForWidth,
  useLayoutClass,
} from "../src/layout/useLayoutClass";
import { LibraryScreen } from "../src/library/LibraryScreen";
import { ThemeProvider } from "../src/theme/ThemeProvider";
import {
  darkTheme,
  lightTheme,
  minimumTargetForPlatform,
} from "../src/theme/tokens";

jest.mock("react-native/Libraries/Utilities/useWindowDimensions", () => ({
  __esModule: true,
  default: jest.fn(),
}));
jest.mock("react-native/Libraries/Utilities/useColorScheme", () => ({
  __esModule: true,
  default: jest.fn(),
}));

const mockUseWindowDimensions = useWindowDimensions as jest.MockedFunction<
  typeof useWindowDimensions
>;
const mockUseColorScheme = useColorScheme as jest.MockedFunction<
  typeof useColorScheme
>;

const safeAreaMetrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, right: 0, bottom: 34, left: 0 },
};

function setWindow(width: number, height: number, fontScale = 1.25) {
  mockUseWindowDimensions.mockReturnValue({
    width,
    height,
    scale: 3,
    fontScale,
  });
}

function LayoutProbe() {
  return <Text testID="layout-class">{useLayoutClass()}</Text>;
}

function relativeLuminance(hex: string): number {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)
    ?.map((channel) => Number.parseInt(channel, 16) / 255);
  if (channels === undefined || channels.length !== 3) {
    throw new Error(`Expected a six-digit hex colour, received ${hex}`);
  }
  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

function compositedContrast(
  foreground: string,
  background: string,
  opacity: number,
): number {
  const channels = (hex: string) =>
    hex
      .slice(1)
      .match(/.{2}/g)
      ?.map((channel) => Number.parseInt(channel, 16) / 255);
  const foregroundChannels = channels(foreground);
  const backgroundChannels = channels(background);
  if (
    foregroundChannels === undefined ||
    backgroundChannels === undefined ||
    foregroundChannels.length !== 3 ||
    backgroundChannels.length !== 3
  ) {
    throw new Error("Expected two six-digit hex colours");
  }
  const composite = foregroundChannels.map(
    (channel, index) =>
      channel * opacity + (backgroundChannels[index] ?? 0) * (1 - opacity),
  );
  const luminance = (rgb: readonly number[]) => {
    const [red, green, blue] = rgb.map((channel) =>
      channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
    );
    return red! * 0.2126 + green! * 0.7152 + blue! * 0.0722;
  };
  const first = luminance(composite);
  const second = luminance(backgroundChannels);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function contrastRatio(foreground: string, background: string): number {
  const first = relativeLuminance(foreground);
  const second = relativeLuminance(background);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

function editorCallbacks() {
  return {
    onBack: jest.fn(),
    onUndo: jest.fn(),
    onRedo: jest.fn(),
    onShare: jest.fn(),
    onOverflow: jest.fn(),
    onCreateVertex: jest.fn(),
    onConnectSelection: jest.fn(),
    onSelectMode: jest.fn(),
    onFitToContent: jest.fn(),
  };
}

async function renderEditor(width: number, height: number) {
  setWindow(width, height);
  const callbacks = editorCallbacks();
  const rendered = await render(
    <SafeAreaProvider initialMetrics={safeAreaMetrics}>
      <ThemeProvider>
        <EditorScreen
          title="Naturality square"
          canvas={<View testID="test-canvas" />}
          inspector={<Text>Selection properties</Text>}
          selectionState={{ kind: "vertex", count: 2 }}
          canUndo
          canRedo
          {...callbacks}
        />
      </ThemeProvider>
    </SafeAreaProvider>,
  );
  return { callbacks, ...rendered };
}

function responderEvent(
  previousY: number,
  currentY: number,
  timestamp: number,
) {
  return {
    nativeEvent: { touches: [{ pageX: 20, pageY: currentY }] },
    touchHistory: {
      indexOfSingleActiveTouch: 0,
      mostRecentTimeStamp: timestamp,
      numberActiveTouches: 1,
      touchBank: [
        {
          currentPageX: 20,
          currentPageY: currentY,
          currentTimeStamp: timestamp,
          previousPageX: 20,
          previousPageY: previousY,
          previousTimeStamp: timestamp - 1,
          startPageX: 20,
          startPageY: 500,
          startTimeStamp: 1,
          touchActive: true,
        },
      ],
    },
  };
}

async function dragInspectorBy(dy: number, sheetHeight = 600) {
  const sheet = screen.getByTestId("editor-bottom-sheet");
  const handle = screen.getByTestId("inspector-drag-handle");
  const dragRegion = screen.queryByTestId("inspector-drag-region");
  await fireEvent(sheet, "layout", {
    nativeEvent: {
      layout: { height: sheetHeight, width: 390, x: 0, y: 0 },
    },
  });

  expect(dragRegion).not.toBeNull();
  if (dragRegion === null) {
    return handle;
  }
  expect(dragRegion.props.onResponderGrant).toEqual(expect.any(Function));
  expect(dragRegion.props.onResponderMove).toEqual(expect.any(Function));
  expect(dragRegion.props.onResponderRelease).toEqual(expect.any(Function));
  const grant = responderEvent(500, 500, 1);
  const move = responderEvent(500, 500 + dy, 2);
  await act(async () => {
    dragRegion.props.onResponderGrant(grant);
    dragRegion.props.onResponderMove(move);
    dragRegion.props.onResponderRelease(move);
  });
  return handle;
}

describe("adaptive layout contract", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseColorScheme.mockReturnValue("light");
  });

  it("switches from compact to regular at exactly 720 dp", async () => {
    expect(layoutClassForWidth(719)).toBe("compact");
    expect(layoutClassForWidth(720)).toBe("regular");

    setWindow(390, 844);
    await render(<LayoutProbe />);
    expect(screen.getByTestId("layout-class")).toHaveTextContent("compact");
  });

  it("keeps required semantic text pairs at WCAG AA in light and dark modes", () => {
    const pairs = [
      [lightTheme.colors.textPrimary, lightTheme.colors.background],
      [lightTheme.colors.textSecondary, lightTheme.colors.background],
      [lightTheme.colors.onPrimary, lightTheme.colors.primary],
      [lightTheme.colors.error, lightTheme.colors.surface],
      [darkTheme.colors.textPrimary, darkTheme.colors.background],
      [darkTheme.colors.textSecondary, darkTheme.colors.background],
      [darkTheme.colors.onPrimary, darkTheme.colors.primary],
      [darkTheme.colors.error, darkTheme.colors.surface],
    ] as const;

    for (const [foreground, background] of pairs) {
      expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("composites the rendered handle cue at 3:1 non-text contrast in both themes", async () => {
    for (const mode of ["light", "dark"] as const) {
      mockUseColorScheme.mockReturnValue(mode);
      const rendered = await renderEditor(390, 844);
      const cue = screen.queryByTestId("inspector-handle-cue");
      expect(cue).not.toBeNull();
      if (cue === null) {
        await rendered.unmount();
        continue;
      }
      const style = StyleSheet.flatten(cue.props.style);
      expect(typeof style.backgroundColor).toBe("string");
      expect(typeof style.opacity).toBe("number");
      const surface = mode === "light" ? lightTheme : darkTheme;
      expect(
        compositedContrast(
          style.backgroundColor as string,
          surface.colors.surface,
          style.opacity as number,
        ),
      ).toBeGreaterThanOrEqual(3);
      await rendered.unmount();
    }
  });

  it("selects 44 point iOS and 48 dp Android minimum targets", () => {
    expect(minimumTargetForPlatform("ios")).toBe(44);
    expect(minimumTargetForPlatform("android")).toBe(48);
    expect(minimumTargetForPlatform("web")).toBe(48);
  });
});

describe("editor shell", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the compact canvas, bottom sheet, FAB, and stable actions", async () => {
    const { callbacks } = await renderEditor(390, 844);

    expect(screen.getByTestId("editor-canvas-slot")).toBeOnTheScreen();
    expect(screen.getByTestId("test-canvas")).toBeOnTheScreen();
    expect(screen.getByTestId("editor-bottom-sheet")).toBeOnTheScreen();
    expect(screen.getByTestId("creation-fab")).toBeOnTheScreen();
    expect(screen.queryByTestId("editor-side-inspector")).toBeNull();
    expect(screen.queryByTestId("creation-rail")).toBeNull();

    for (const testID of [
      "back-to-library",
      "undo",
      "redo",
      "share-export",
      "editor-overflow",
    ]) {
      expect(screen.getByTestId(testID)).toBeOnTheScreen();
    }

    await fireEvent.press(screen.getByTestId("back-to-library"));
    await fireEvent.press(screen.getByTestId("undo"));
    await fireEvent.press(screen.getByTestId("redo"));
    await fireEvent.press(screen.getByTestId("share-export"));
    await fireEvent.press(screen.getByTestId("editor-overflow"));
    await fireEvent.press(screen.getByTestId("canvas-create-vertex"));
    await fireEvent.press(screen.getByTestId("connect-selection"));
    await fireEvent.press(screen.getByTestId("selection-mode"));
    await fireEvent.press(screen.getByTestId("fit-to-content"));

    expect(callbacks.onBack).toHaveBeenCalledTimes(1);
    expect(callbacks.onUndo).toHaveBeenCalledTimes(1);
    expect(callbacks.onRedo).toHaveBeenCalledTimes(1);
    expect(callbacks.onShare).toHaveBeenCalledTimes(1);
    expect(callbacks.onOverflow).toHaveBeenCalledTimes(1);
    expect(callbacks.onCreateVertex).toHaveBeenCalledTimes(1);
    expect(callbacks.onConnectSelection).toHaveBeenCalledTimes(1);
    expect(callbacks.onSelectMode).toHaveBeenCalledTimes(1);
    expect(callbacks.onFitToContent).toHaveBeenCalledTimes(1);
  });

  it("exposes collapsed, half, and full compact inspector snap points", async () => {
    await renderEditor(390, 844);
    const handle = screen.getByTestId("inspector-drag-handle");

    expect(handle).toHaveStyle({ minHeight: 44 });
    expect(handle).toHaveAccessibilityValue({ text: "Half height" });
    await fireEvent(handle, "accessibilityAction", {
      nativeEvent: { actionName: "increment" },
    });
    expect(handle).toHaveAccessibilityValue({ text: "Full height" });
    await fireEvent(handle, "accessibilityAction", {
      nativeEvent: { actionName: "decrement" },
    });
    expect(handle).toHaveAccessibilityValue({ text: "Half height" });
    await fireEvent.press(handle);
    expect(handle).toHaveAccessibilityValue({ text: "Full height" });
    await fireEvent.press(handle);
    expect(handle).toHaveAccessibilityValue({ text: "Collapsed" });
  });

  it("snaps real upward and downward handle drags to the nearest sheet point", async () => {
    await renderEditor(390, 844);
    let handle = screen.getByTestId("inspector-drag-handle");
    expect(handle).toHaveAccessibilityValue({ text: "Half height" });

    handle = await dragInspectorBy(-260);
    expect(handle).toHaveAccessibilityValue({ text: "Full height" });

    handle = await dragInspectorBy(280);
    expect(handle).toHaveAccessibilityValue({ text: "Half height" });

    handle = await dragInspectorBy(400);
    expect(handle).toHaveAccessibilityValue({ text: "Collapsed" });
  });

  it("uses deterministic nearest boundaries and clamps compact drag extremes", async () => {
    await renderEditor(390, 844);

    let handle = await dragInspectorBy(-149);
    expect(handle).toHaveAccessibilityValue({ text: "Half height" });
    handle = await dragInspectorBy(-150);
    expect(handle).toHaveAccessibilityValue({ text: "Full height" });
    handle = await dragInspectorBy(-10_000);
    expect(handle).toHaveAccessibilityValue({ text: "Full height" });

    await fireEvent(handle, "accessibilityAction", {
      nativeEvent: { actionName: "decrement" },
    });
    expect(handle).toHaveAccessibilityValue({ text: "Half height" });
    handle = await dragInspectorBy(104);
    expect(handle).toHaveAccessibilityValue({ text: "Half height" });
    handle = await dragInspectorBy(105);
    expect(handle).toHaveAccessibilityValue({ text: "Collapsed" });
    handle = await dragInspectorBy(10_000);
    expect(handle).toHaveAccessibilityValue({ text: "Collapsed" });
  });

  it("keeps large-font inspector state mounted but inaccessible and inert when collapsed", async () => {
    setWindow(390, 844, 3.2);
    const onHiddenAction = jest.fn();
    await render(
      <SafeAreaProvider initialMetrics={safeAreaMetrics}>
        <ThemeProvider>
          <EditorScreen
            title="Naturality square"
            canvas={<View testID="test-canvas" />}
            inspector={
              <Pressable
                accessibilityLabel="Hidden inspector action"
                accessibilityRole="button"
                onPress={onHiddenAction}
                testID="hidden-inspector-action"
              >
                <Text allowFontScaling maxFontSizeMultiplier={3.2}>
                  Large inspector action
                </Text>
              </Pressable>
            }
            selectionState={{ kind: "vertex", count: 2 }}
            {...editorCallbacks()}
          />
        </ThemeProvider>
      </SafeAreaProvider>,
    );

    const handle = screen.getByTestId("inspector-drag-handle");
    const hiddenAction = screen.getByTestId("hidden-inspector-action");
    expect(
      screen.getByRole("button", { name: "Hidden inspector action" }),
    ).toBe(hiddenAction);
    expect(isHiddenFromAccessibility(hiddenAction)).toBe(false);

    await fireEvent.press(handle);
    await fireEvent.press(handle);
    expect(handle).toHaveAccessibilityValue({ text: "Collapsed" });

    expect(hiddenAction).toBeOnTheScreen();
    expect(isHiddenFromAccessibility(hiddenAction)).toBe(true);
    expect(
      screen.queryByRole("button", { name: "Hidden inspector action" }),
    ).toBeNull();
    await fireEvent.press(hiddenAction);
    expect(onHiddenAction).not.toHaveBeenCalled();

    const collapsibleContent = screen.queryByTestId(
      "inspector-collapsible-content",
      { includeHiddenElements: true },
    );
    expect(collapsibleContent).not.toBeNull();
    expect(collapsibleContent?.props.accessibilityElementsHidden).toBe(true);
    expect(collapsibleContent?.props.importantForAccessibility).toBe(
      "no-hide-descendants",
    );
    expect(collapsibleContent?.props.pointerEvents).toBe("none");
  });

  it.each([
    [1024, 320],
    [1366, 380],
  ])(
    "renders a %i dp regular shell with a %i dp side inspector",
    async (width, inspectorWidth) => {
      await renderEditor(width, 1024);

      expect(screen.getByTestId("editor-side-inspector")).toHaveStyle({
        width: inspectorWidth,
      });
      expect(screen.getByTestId("creation-rail")).toBeOnTheScreen();
      expect(screen.getByTestId("editor-canvas-slot")).toBeOnTheScreen();
      expect(screen.queryByTestId("editor-bottom-sheet")).toBeNull();
      expect(screen.queryByTestId("creation-fab")).toBeNull();
    },
  );

  it("uses platform minimum targets and scalable app-bar typography", async () => {
    await renderEditor(390, 844);

    expect(screen.getByTestId("undo")).toHaveStyle({
      minHeight: 44,
      minWidth: 44,
    });
    expect(screen.getByTestId("editor-title").props.allowFontScaling).toBe(
      true,
    );
    expect(
      screen.getByTestId("editor-title").props.maxFontSizeMultiplier,
    ).toBeGreaterThanOrEqual(1.5);
    expect(screen.getByText("2 vertices selected")).toBeOnTheScreen();
  });
});

describe("library shell", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setWindow(390, 844);
  });

  it("renders polished empty-state creation and import actions", async () => {
    const onNewDocument = jest.fn();
    const onImportDocument = jest.fn();

    await render(
      <SafeAreaProvider initialMetrics={safeAreaMetrics}>
        <ThemeProvider>
          <LibraryScreen
            documents={[]}
            onDocumentActions={jest.fn()}
            onImportDocument={onImportDocument}
            onNewDocument={onNewDocument}
            onOpenDocument={jest.fn()}
          />
        </ThemeProvider>
      </SafeAreaProvider>,
    );

    expect(screen.getByTestId("library-screen")).toBeOnTheScreen();
    expect(screen.getByText("Your diagrams")).toBeOnTheScreen();
    expect(screen.getByTestId("library-empty-state")).toBeOnTheScreen();
    expect(screen.getByTestId("new-document")).toHaveAccessibleName(
      "Create a new diagram",
    );
    expect(screen.getByTestId("import-document")).toHaveAccessibleName(
      "Import a diagram",
    );

    await fireEvent.press(screen.getByTestId("new-document"));
    await fireEvent.press(screen.getByTestId("import-document"));
    expect(onNewDocument).toHaveBeenCalledTimes(1);
    expect(onImportDocument).toHaveBeenCalledTimes(1);
  });

  it("renders accessible document cards and forwards document identities", async () => {
    const onOpenDocument = jest.fn();
    const onDocumentActions = jest.fn();

    await render(
      <SafeAreaProvider initialMetrics={safeAreaMetrics}>
        <ThemeProvider>
          <LibraryScreen
            documents={[
              {
                id: "naturality",
                title: "Naturality square",
                updatedLabel: "Edited 12 minutes ago",
                detail: "4 objects · 4 arrows",
              },
              {
                id: "adjunction",
                title: "Adjunction",
                updatedLabel: "Edited yesterday",
                detail: "6 objects · 7 arrows",
              },
            ]}
            onDocumentActions={onDocumentActions}
            onImportDocument={jest.fn()}
            onNewDocument={jest.fn()}
            onOpenDocument={onOpenDocument}
          />
        </ThemeProvider>
      </SafeAreaProvider>,
    );

    expect(screen.queryByTestId("library-empty-state")).toBeNull();
    expect(screen.getByText("Naturality square")).toBeOnTheScreen();
    expect(screen.getByText("4 objects · 4 arrows")).toBeOnTheScreen();
    expect(screen.getByTestId("document-card-naturality")).toHaveAccessibleName(
      "Open Naturality square, Edited 12 minutes ago",
    );

    await fireEvent.press(screen.getByTestId("document-card-naturality"));
    await fireEvent.press(screen.getByTestId("document-actions-naturality"));
    expect(onOpenDocument).toHaveBeenCalledWith("naturality");
    expect(onDocumentActions).toHaveBeenCalledWith("naturality");
  });

  it("keeps library controls at the platform minimum and allows font scaling", async () => {
    await render(
      <SafeAreaProvider initialMetrics={safeAreaMetrics}>
        <ThemeProvider>
          <LibraryScreen
            documents={[]}
            onDocumentActions={jest.fn()}
            onImportDocument={jest.fn()}
            onNewDocument={jest.fn()}
            onOpenDocument={jest.fn()}
          />
        </ThemeProvider>
      </SafeAreaProvider>,
    );

    expect(screen.getByTestId("new-document")).toHaveStyle({ minHeight: 44 });
    expect(screen.getByTestId("library-title").props.allowFontScaling).toBe(
      true,
    );
    expect(
      screen.getByTestId("library-title").props.maxFontSizeMultiplier,
    ).toBeGreaterThanOrEqual(1.5);
  });
});

describe("editor route", () => {
  it("exposes the production canvas and lab action IDs without document logic", async () => {
    setWindow(390, 844);

    await render(
      <SafeAreaProvider initialMetrics={safeAreaMetrics}>
        <ThemeProvider>
          <EditorRoute />
        </ThemeProvider>
      </SafeAreaProvider>,
    );

    expect(screen.getByTestId("editor-canvas")).toBeOnTheScreen();
    expect(screen.getByTestId("canvas-create-vertex")).toBeEnabled();
    expect(screen.getByTestId("connect-selection")).toBeEnabled();
    expect(screen.getByTestId("undo")).toBeEnabled();
    expect(screen.getByTestId("redo")).toBeEnabled();
    expect(screen.getByTestId("share-export")).toBeEnabled();
  });
});
