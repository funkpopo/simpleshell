import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // 默认使用 Node；renderer hook/composition 测试通过文件注释启用 jsdom。
    include: ["tests/unit/**/*.test.js"],
    environment: "node",
    reporters: ["default"],
    watch: false,
  },
});
