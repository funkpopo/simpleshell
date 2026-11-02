import { defineConfig } from "vitest/config";

// Benchmarks compare each migration phase with docs/perf/baseline.json.
export default defineConfig({
  test: {
    include: ["tests/perf/**/*.perf.test.js"],
    environment: "node",
    setupFiles: ["tests/helpers/nativeEnvironment.js"],
    fileParallelism: false,
    testTimeout: 600000,
    hookTimeout: 60000,
    reporters: ["default"],
    watch: false,
  },
});
