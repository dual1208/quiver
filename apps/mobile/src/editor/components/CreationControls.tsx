import { Pressable, StyleSheet, Text, View } from "react-native";
import type { LayoutClass } from "../../layout/useLayoutClass";
import { useTheme } from "../../theme/ThemeProvider";

type CreationButtonProps = Readonly<{
  testID: string;
  label: string;
  symbol: string;
  primary?: boolean;
  selected?: boolean;
  onPress: () => void;
}>;

export type CreationControlsProps = Readonly<{
  layoutClass: LayoutClass;
  onCreateVertex: () => void;
  onConnectSelection: () => void;
  onSelectMode: () => void;
  onFitToContent: () => void;
  selectionModeActive?: boolean;
}>;

function CreationButton({
  testID,
  label,
  symbol,
  primary = false,
  selected = false,
  onPress,
}: CreationButtonProps) {
  const theme = useTheme();
  const backgroundColor = primary
    ? theme.colors.primary
    : selected
      ? theme.colors.primarySurface
      : theme.colors.surface;
  const color = primary ? theme.colors.onPrimary : theme.colors.textPrimary;

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      hitSlop={4}
      onPress={onPress}
      style={[
        styles.control,
        {
          backgroundColor,
          borderColor:
            primary || selected ? theme.colors.primary : theme.colors.border,
          minHeight: theme.minimumTargetSize,
          minWidth: theme.minimumTargetSize,
          shadowColor: theme.colors.shadow,
        },
      ]}
      testID={testID}
    >
      <Text
        allowFontScaling
        maxFontSizeMultiplier={1.5}
        style={[styles.symbol, { color }]}
      >
        {symbol}
      </Text>
    </Pressable>
  );
}

export function CreationControls({
  layoutClass,
  onCreateVertex,
  onConnectSelection,
  onSelectMode,
  onFitToContent,
  selectionModeActive = false,
}: CreationControlsProps) {
  const theme = useTheme();
  const compact = layoutClass === "compact";

  return (
    <View
      accessibilityLabel={compact ? "Creation controls" : "Creation rail"}
      style={[
        compact ? styles.fab : styles.rail,
        {
          backgroundColor: compact
            ? theme.colors.surfaceElevated
            : theme.colors.surface,
          borderColor: theme.colors.border,
        },
      ]}
      testID={compact ? "creation-fab" : "creation-rail"}
    >
      <CreationButton
        label="Create vertex"
        onPress={onCreateVertex}
        primary
        symbol="＋"
        testID="canvas-create-vertex"
      />
      <CreationButton
        label="Connect selection"
        onPress={onConnectSelection}
        symbol="↗"
        testID="connect-selection"
      />
      <CreationButton
        label={
          selectionModeActive
            ? "Turn off multiple selection"
            : "Select multiple objects"
        }
        onPress={onSelectMode}
        selected={selectionModeActive}
        symbol="⌁"
        testID="selection-mode"
      />
      <CreationButton
        label="Fit diagram to canvas"
        onPress={onFitToContent}
        symbol="⌗"
        testID="fit-to-content"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  control: {
    alignItems: "center",
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 2,
    justifyContent: "center",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
  },
  fab: {
    alignItems: "center",
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    bottom: 18,
    flexDirection: "row",
    gap: 6,
    padding: 6,
    position: "absolute",
    right: 14,
    zIndex: 30,
  },
  rail: {
    alignItems: "center",
    borderRightWidth: StyleSheet.hairlineWidth,
    gap: 10,
    paddingHorizontal: 8,
    paddingVertical: 12,
    width: 64,
    zIndex: 10,
  },
  symbol: {
    fontSize: 20,
    fontWeight: "700",
    lineHeight: 24,
  },
});
