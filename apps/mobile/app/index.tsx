import { StyleSheet, Text, View } from "react-native";

export default function LibraryRoute() {
  return (
    <View style={styles.screen} testID="library-screen">
      <Text style={styles.title}>Quiver</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
  },
  title: {
    fontSize: 32,
    fontWeight: "600",
  },
});
