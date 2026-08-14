import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "packages/core",
      {
        test: {
          name: "service-worker",
          include: ["test/service-worker-build.test.js"],
        },
      },
    ],
  },
});
