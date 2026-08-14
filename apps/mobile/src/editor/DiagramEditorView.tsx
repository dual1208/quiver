import { formatQuiverUrl, type DiagramDocument, type EntityId } from "@quiver/core";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Share } from "react-native";
import { DiagramCanvas, type DiagramCanvasHandle } from "./canvas";
import { SelectionInspector } from "./components/SelectionInspector";
import { EditorScreen } from "./EditorScreen";
import { useDiagramEditor } from "./useDiagramEditor";

type DiagramEditorViewProps = Readonly<{
  initialDocument: DiagramDocument;
  onSave: (document: DiagramDocument) => void | Promise<void>;
}>;

function selectionKind(
  document: DiagramDocument,
  selectedIds: readonly EntityId[],
): "none" | "vertex" | "edge" | "mixed" {
  if (selectedIds.length === 0) {
    return "none";
  }
  const vertexIds = new Set(document.vertices.map(({ id }) => id));
  const edgeIds = new Set(document.edges.map(({ id }) => id));
  const hasVertex = selectedIds.some((id) => vertexIds.has(id));
  const hasEdge = selectedIds.some((id) => edgeIds.has(id));
  return hasVertex && hasEdge ? "mixed" : hasVertex ? "vertex" : "edge";
}

function selectionKey(ids: readonly EntityId[]): string {
  return [...ids].sort().join("|");
}

export function DiagramEditorView({
  initialDocument,
  onSave,
}: DiagramEditorViewProps) {
  const editor = useDiagramEditor(initialDocument);
  const canvasRef = useRef<DiagramCanvasHandle>(null);
  const latestDocumentRef = useRef(editor.document);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaveErrorRef = useRef<unknown>(null);
  const [multiSelect, setMultiSelect] = useState(false);

  useEffect(() => {
    latestDocumentRef.current = editor.document;
    if (saveTimerRef.current !== null) {
      clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      void Promise.resolve(onSave(editor.document)).then(
        () => {
          lastSaveErrorRef.current = null;
        },
        (error: unknown) => {
          lastSaveErrorRef.current = error;
        },
      );
    }, 220);
    return () => {
      if (saveTimerRef.current !== null) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, [editor.document, onSave]);

  const createVertexAt = useCallback(
    (point: { x: number; y: number }) => {
      editor.createVertex(point);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    },
    [editor],
  );

  const createVertexAtCenter = useCallback(() => {
    const point = canvasRef.current?.documentPointAtCenter() ?? { x: 0, y: 0 };
    createVertexAt(point);
  }, [createVertexAt]);

  const handleCanvasSelection = useCallback(
    (ids: readonly EntityId[]) => {
      if (multiSelect && ids.length === 1) {
        editor.toggleSelection(ids[0]!);
        void Haptics.selectionAsync();
        return;
      }
      editor.select(ids);
    },
    [editor, multiSelect],
  );

  const connectSelection = useCallback(() => {
    if (editor.connectSelection() === null) {
      Alert.alert(
        "Select two objects",
        "Turn on selection mode, tap two objects, then tap Connect.",
      );
      return;
    }
    setMultiSelect(false);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [editor]);

  const toggleSelectionMode = useCallback(() => {
    setMultiSelect((active) => !active);
    void Haptics.selectionAsync();
  }, []);

  const saveAndBack = useCallback(() => {
    if (saveTimerRef.current !== null) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    void Promise.resolve(onSave(latestDocumentRef.current)).then(
      () => {
        lastSaveErrorRef.current = null;
        router.back();
      },
      (error: unknown) => {
        lastSaveErrorRef.current = error;
        Alert.alert(
          "Could not save diagram",
          error instanceof Error ? error.message : "Please try again.",
        );
      },
    );
  }, [onSave]);

  const shareDiagram = useCallback(() => {
    const url = formatQuiverUrl(editor.document);
    void Share.share({
      message: `${editor.document.title}\n${url}`,
      title: editor.document.title,
      url,
    });
  }, [editor.document]);

  const copyLink = useCallback(() => {
    const url = formatQuiverUrl(editor.document);
    void Clipboard.setStringAsync(url).then(() => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    });
  }, [editor.document]);

  const openMoreActions = useCallback(() => {
    Alert.alert(editor.document.title || "Untitled diagram", undefined, [
      { text: "Copy Quiver link", onPress: copyLink },
      { text: "Cancel", style: "cancel" },
    ]);
  }, [copyLink, editor.document.title]);

  const state = useMemo(
    () => ({
      kind: selectionKind(editor.document, editor.selectedIds),
      count: editor.selectedIds.length,
    }),
    [editor.document, editor.selectedIds],
  );

  return (
    <EditorScreen
      canRedo={editor.canRedo}
      canUndo={editor.canUndo}
      canvas={
        <DiagramCanvas
          document={editor.document}
          onCreateVertex={createVertexAt}
          onMoveVertex={editor.moveVertex}
          onSelectionChange={handleCanvasSelection}
          ref={canvasRef}
          selectedIds={editor.selectedIds}
          testID="editor-canvas"
        />
      }
      inspector={
        <SelectionInspector
          key={`${editor.document.id}:${selectionKey(editor.selectedIds)}`}
          onDelete={editor.deleteSelection}
          onLabelChange={editor.updateEntityLabel}
          onTitleChange={editor.updateTitle}
          selectedEntities={editor.selectedEntities}
          title={editor.document.title}
        />
      }
      onBack={saveAndBack}
      onConnectSelection={connectSelection}
      onCreateVertex={createVertexAtCenter}
      onFitToContent={() => canvasRef.current?.fitToContent({ animated: true })}
      onOverflow={openMoreActions}
      onRedo={editor.redo}
      onSelectMode={toggleSelectionMode}
      onShare={shareDiagram}
      onUndo={editor.undo}
      selectionState={state}
      selectionModeActive={multiSelect}
      title={editor.document.title || "Untitled diagram"}
    />
  );
}
