import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // 默认使用 Node；renderer hook/composition 测试通过文件注释启用 jsdom。
    include: ["tests/unit/**/*.test.js"],
    environment: "node",
    reporters: ["default"],
    watch: false,
    // 架构/无障碍等测试会解析整个源码树，并行运行时可能超过默认的 5 秒。
    testTimeout: 30000,
  },
});
