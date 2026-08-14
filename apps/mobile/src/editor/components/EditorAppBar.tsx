import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "../../theme/ThemeProvider";

type AppBarButtonProps = Readonly<{
  testID: string;
  label: string;
  symbol: string;
  disabled?: boolean;
  onPress: () => void;
}>;

export type EditorAppBarProps = Readonly<{
  title: string;
  canUndo: boolean;
  canRedo: boolean;
  onBack: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onShare: () => void;
  onOverflow: () => void;
}>;

function AppBarButton({
  testID,
  label,
  symbol,
  disabled = false,
  onPress,
}: AppBarButtonProps) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={4}
      onPress={onPress}
      style={[
        styles.action,
        {
          minHeight: theme.minimumTargetSize,
          minWidth: theme.minimumTargetSize,
        },
        disabled ? styles.disabled : null,
      ]}
      testID={testID}
    >
      <Text
        allowFontScaling
        maxFontSizeMultiplier={1.5}
        style={[styles.actionText, { color: theme.colors.textPrimary }]}
      >
        {symbol}
      </Text>
    </Pressable>
  );
}

export function EditorAppBar({
  title,
  canUndo,
  canRedo,
  onBack,
  onUndo,
  onRedo,
  onShare,
  onOverflow,
}: EditorAppBarProps) {
  const theme = useTheme();

  return (
    <View
      accessibilityRole="toolbar"
      style={[
        styles.bar,
        {
          backgroundColor: theme.colors.surface,
          borderBottomColor: theme.colors.border,
        },
      ]}
      testID="editor-app-bar"
    >
      <AppBarButton
        label="Back to library"
        onPress={onBack}
        symbol="‹"
        testID="back-to-library"
      />
      <Text
        allowFontScaling
        maxFontSizeMultiplier={1.8}
        numberOfLines={1}
        style={[
          styles.title,
          theme.typography.title,
          { color: theme.colors.textPrimary },
        ]}
        testID="editor-title"
      >
        {title}
      </Text>
      <View style={styles.actions}>
        <AppBarButton
          disabled={!canUndo}
          label="Undo"
          onPress={onUndo}
          symbol="↶"
          testID="undo"
        />
        <AppBarButton
          disabled={!canRedo}
          label="Redo"
          onPress={onRedo}
          symbol="↷"
          testID="redo"
        />
        <AppBarButton
          label="Share or export"
          onPress={onShare}
          symbol="↗"
          testID="share-export"
        />
        <AppBarButton
          label="More editor actions"
          onPress={onOverflow}
          symbol="•••"
          testID="editor-overflow"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  action: {
    alignItems: "center",
    justifyContent: "center",
  },
  actionText: {
    fontSize: 22,
    fontWeight: "600",
    lineHeight: 26,
  },
  actions: {
    alignItems: "center",
    flexDirection: "row",
    gap: 2,
  },
  bar: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    zIndex: 20,
  },
  disabled: {
    opacity: 0.34,
  },
  title: {
    flex: 1,
  },
});
