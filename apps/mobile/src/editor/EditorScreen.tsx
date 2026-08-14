import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLayoutClass } from "../layout/useLayoutClass";
import { useTheme } from "../theme/ThemeProvider";
import {
  CreationControls,
  type CreationControlsProps,
} from "./components/CreationControls";
import {
  EditorAppBar,
  type EditorAppBarProps,
} from "./components/EditorAppBar";
import {
  InspectorContainer,
  type EditorSelectionState,
} from "./components/InspectorContainer";

export type EditorScreenProps = Readonly<{
  title: string;
  canvas: ReactNode;
  inspector: ReactNode;
  selectionState: EditorSelectionState;
  canUndo?: boolean;
  canRedo?: boolean;
}> &
  Pick<
    EditorAppBarProps,
    "onBack" | "onUndo" | "onRedo" | "onShare" | "onOverflow"
  > &
  Pick<
    CreationControlsProps,
    "onCreateVertex" | "onConnectSelection" | "onSelectMode" | "onFitToContent"
  >;

export function EditorScreen({
  title,
  canvas,
  inspector,
  selectionState,
  canUndo = false,
  canRedo = false,
  onBack,
  onUndo,
  onRedo,
  onShare,
  onOverflow,
  onCreateVertex,
  onConnectSelection,
  onSelectMode,
  onFitToContent,
}: EditorScreenProps) {
  const theme = useTheme();
  const layoutClass = useLayoutClass();
  const regular = layoutClass === "regular";

  return (
    <SafeAreaView
      edges={["top", "right", "bottom", "left"]}
      style={[styles.safeArea, { backgroundColor: theme.colors.surface }]}
      testID="editor-screen"
    >
      <EditorAppBar
        canRedo={canRedo}
        canUndo={canUndo}
        onBack={onBack}
        onOverflow={onOverflow}
        onRedo={onRedo}
        onShare={onShare}
        onUndo={onUndo}
        title={title}
      />
      <View
        style={[
          styles.body,
          regular ? styles.regularBody : styles.compactBody,
          { backgroundColor: theme.colors.canvas },
        ]}
      >
        {regular ? (
          <CreationControls
            layoutClass={layoutClass}
            onConnectSelection={onConnectSelection}
            onCreateVertex={onCreateVertex}
            onFitToContent={onFitToContent}
            onSelectMode={onSelectMode}
          />
        ) : null}
        <View
          accessibilityLabel="Diagram canvas"
          style={styles.canvas}
          testID="editor-canvas-slot"
        >
          {canvas}
        </View>
        <InspectorContainer
          layoutClass={layoutClass}
          selectionState={selectionState}
        >
          {inspector}
        </InspectorContainer>
        {regular ? null : (
          <CreationControls
            layoutClass={layoutClass}
            onConnectSelection={onConnectSelection}
            onCreateVertex={onCreateVertex}
            onFitToContent={onFitToContent}
            onSelectMode={onSelectMode}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    minHeight: 0,
    overflow: "hidden",
  },
  canvas: {
    flex: 1,
    minHeight: 0,
    minWidth: 0,
  },
  compactBody: {
    position: "relative",
  },
  regularBody: {
    flexDirection: "row",
  },
  safeArea: {
    flex: 1,
  },
});
