import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // 单测只覆盖纯逻辑模块，渲染层组件不在本套件范围内。
    include: ["tests/unit/**/*.test.js"],
    environment: "node",
    reporters: ["default"],
    watch: false,
  },
});
