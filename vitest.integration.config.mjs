import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/integration/**/*.test.js"],
    environment: "node",
    setupFiles: ["tests/helpers/nativeEnvironment.js"],
    fileParallelism: false,
    testTimeout: 180000,
    hookTimeout: 30000,
    reporters: ["default"],
    watch: false,
  },
});
