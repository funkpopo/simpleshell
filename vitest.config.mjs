import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Node 环境的逻辑、文件持久化和检查工具测试；渲染层集成测试由 check 执行。
    include: ["tests/unit/**/*.test.js"],
    environment: "node",
    reporters: ["default"],
    watch: false,
  },
});
