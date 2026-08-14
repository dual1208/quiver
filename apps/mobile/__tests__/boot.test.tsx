import { render, screen } from "@testing-library/react-native";
import LibraryRoute from "../app/index";

it("opens the document library", async () => {
  await render(<LibraryRoute />);
  expect(screen.getByTestId("library-screen")).toBeOnTheScreen();
  expect(screen.getByText("Quiver")).toBeOnTheScreen();
});
