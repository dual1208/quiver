import type { DiagramEntity, EntityId } from "@quiver/core";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useTheme } from "../../theme/ThemeProvider";

type SelectionInspectorProps = Readonly<{
  title: string;
  selectedEntities: readonly DiagramEntity[];
  onTitleChange: (title: string) => void;
  onLabelChange: (id: EntityId, label: string) => void;
  onDelete: () => void;
}>;

export function SelectionInspector({
  title,
  selectedEntities,
  onTitleChange,
  onLabelChange,
  onDelete,
}: SelectionInspectorProps) {
  const theme = useTheme();
  const selected = selectedEntities.length === 1 ? selectedEntities[0] : null;

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.field}>
        <Text
          allowFontScaling
          style={[theme.typography.eyebrow, { color: theme.colors.textSecondary }]}
        >
          Diagram name
        </Text>
        <TextInput
          accessibilityLabel="Diagram name"
          autoCapitalize="sentences"
          maxLength={160}
          onChangeText={onTitleChange}
          placeholder="Untitled diagram"
          placeholderTextColor={theme.colors.textSecondary}
          returnKeyType="done"
          selectTextOnFocus
          style={[
            styles.input,
            theme.typography.body,
            {
              backgroundColor: theme.colors.surfaceElevated,
              borderColor: theme.colors.border,
              color: theme.colors.textPrimary,
              minHeight: theme.minimumTargetSize,
            },
          ]}
          value={title}
        />
      </View>

      {selected === null ? (
        <View
          style={[
            styles.notice,
            { backgroundColor: theme.colors.primarySurface },
          ]}
        >
          <Text
            allowFontScaling
            style={[theme.typography.body, { color: theme.colors.textPrimary }]}
          >
            {selectedEntities.length > 1
              ? `${selectedEntities.length} items selected. Tap Connect to make an arrow between two objects.`
              : "Tap an object or arrow to edit it. Double-tap the canvas to add an object."}
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.field}>
            <Text
              allowFontScaling
              style={[
                theme.typography.eyebrow,
                { color: theme.colors.textSecondary },
              ]}
            >
              {selected.kind === "vertex" ? "Object label" : "Arrow label"}
            </Text>
            <TextInput
              accessibilityLabel={`${selected.kind} label`}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={4_096}
              multiline
              onChangeText={(label) => onLabelChange(selected.id, label)}
              placeholder={selected.kind === "vertex" ? "Object" : "Optional label"}
              placeholderTextColor={theme.colors.textSecondary}
              style={[
                styles.input,
                styles.labelInput,
                theme.typography.body,
                {
                  backgroundColor: theme.colors.surfaceElevated,
                  borderColor: theme.colors.border,
                  color: theme.colors.textPrimary,
                  minHeight: theme.minimumTargetSize,
                },
              ]}
              value={selected.label}
            />
            <Text
              allowFontScaling
              style={[styles.helper, { color: theme.colors.textSecondary }]}
            >
              LaTeX labels are preserved when you share a Quiver link.
            </Text>
          </View>
        </>
      )}

      {selectedEntities.length > 0 ? (
        <Pressable
          accessibilityLabel={`Delete ${selectedEntities.length === 1 ? "selected item" : "selected items"}`}
          accessibilityRole="button"
          onPress={onDelete}
          style={[
            styles.deleteButton,
            {
              borderColor: theme.colors.error,
              minHeight: theme.minimumTargetSize,
            },
          ]}
        >
          <Text
            allowFontScaling
            style={[theme.typography.bodyStrong, { color: theme.colors.error }]}
          >
            Delete {selectedEntities.length === 1 ? "item" : "items"}
          </Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 18,
    paddingBottom: 24,
  },
  deleteButton: {
    alignItems: "center",
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  field: {
    gap: 7,
  },
  helper: {
    fontSize: 12,
    lineHeight: 17,
  },
  input: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 13,
    paddingVertical: 10,
  },
  labelInput: {
    maxHeight: 160,
    minHeight: 72,
    textAlignVertical: "top",
  },
  notice: {
    borderRadius: 14,
    padding: 14,
  },
});
