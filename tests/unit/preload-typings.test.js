import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { collectPreloadSources } from "../../scripts/lib/preload-sources.js";
import {
  inspectPreload,
  getPreloadTypeDiagnostics,
} from "../../scripts/check-preload-typings.js";

const source = collectPreloadSources();

describe("preload AST contract checks", () => {
  it("resolves factory methods and rejects missing factories or duplicate API keys", () => {
    const result = inspectPreload(`
      function createCommands() { return {
        /** @returns {boolean} */ ready: () => true,
      }; }
      contextBridge.exposeInMainWorld("exampleAPI", {
        ...createCommands(), ...createCommands(), ...missingFactory(),
      });
    `);
    expect(result.methodCount).toBe(2);
    expect(result.problems).toHaveLength(2);
    expect(result.problems.join(" ")).toContain("duplicate API method ready");
    expect(result.problems.join(" ")).toContain("non-recursive object factory");
  });
  it("检查实际 API，并包含换行后的 invoke 调用", () => {
    const result = inspectPreload(source);
    expect(result.problems).toEqual([]);
    expect(result.apis).toHaveLength(5);
    expect(result.methodCount).toBeGreaterThan(0);
    expect(result.invokeCount).toBeGreaterThan(0);
    expect(result.dynamicInvokeCount).toBe(0);
  });

  it("数组、注释、嵌套调用与模板插值不改变实参数量", () => {
    const result = inspectPreload(
      [
        "// ipcRenderer.invoke(IPC_REQUEST_CHANNELS.DOES_NOT_EXIST)",
        'const text = "ipcRenderer.invoke(fake)";',
        "ipcRenderer",
        "  .invoke(IPC_REQUEST_CHANNELS.TERMINAL_SAVE_CONNECTIONS,",
        '["a", ...items, { name: `host-${name}`, extra: fn(1, 2) }]);',
        "ipcRenderer.invoke(IPC_REQUEST_CHANNELS.TERMINAL_COMMAND,",
        "  command /* commas, braces } and parentheses ) */);",
      ].join("\n"),
    );
    expect(result.problems).toEqual([]);
    expect(result.invokeCount).toBe(2);
  });

  it("缺参、多参和不存在的静态通道都会报错", () => {
    const result = inspectPreload(`
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.TERMINAL_COMMAND);
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.TERMINAL_COMMAND, command, extra);
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.DOES_NOT_EXIST);
    `);
    expect(result.problems).toHaveLength(3);
    expect(result.problems[0]).toContain(
      "0 argument(s) outside schema bounds [1, 1]",
    );
    expect(result.problems[1]).toContain(
      "2 argument(s) outside schema bounds [1, 1]",
    );
    expect(result.problems[2]).toContain("unknown request channel");
  });

  it("可选参数按 schema 上下界检查", () => {
    const result = inspectPreload(`
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.COMMAND_HISTORY_GET_SUGGESTIONS, input);
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.COMMAND_HISTORY_GET_SUGGESTIONS, input, 10);
    `);
    expect(result.problems).toEqual([]);
  });

  it("对象方法、默认参数和不带括号的箭头函数均可解析", () => {
    const result = inspectPreload(`
      contextBridge.exposeInMainWorld("exampleAPI", {
        /** @param {string} [value] @returns {string} */
        method(value = "default") { return value; },
        /** @param {string} value @returns {string} */
        arrow: value => value,
      });
    `);
    expect(result.problems).toEqual([]);
    expect(result.methodCount).toBe(2);
  });

  it("相邻重复文档、缺失文档和参数改名都不能静默通过", () => {
    const result = inspectPreload(`
      contextBridge.exposeInMainWorld("exampleAPI", {
        /** @param {string} value @returns {string} */
        /** @param {string} value @returns {string} */
        duplicate: (value) => value,
        missing: () => {},
        /** @param {string} staleName @returns {string} */
        renamed: (value) => value,
      });
    `);
    expect(result.problems).toHaveLength(3);
    expect(result.problems[0]).toContain("exactly one JSDoc block, got 2");
    expect(result.problems[1]).toContain("exactly one JSDoc block, got 0");
    expect(result.problems[2]).toContain("@param names/order");
  });

  it("拒绝用通配类型和 Function 掩盖契约", () => {
    const result = inspectPreload(`
      contextBridge.exposeInMainWorld("exampleAPI", {
        /** @param {Function} callback @returns {Promise<*>} */
        method: (callback) => Promise.resolve(callback()),
      });
    `);
    expect(result.problems).toHaveLength(2);
  });

  it("不能确定展开实参数量时明确报错，动态通道单独计数", () => {
    const result = inspectPreload(`
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.TERMINAL_COMMAND, ...args);
      ipcRenderer.invoke(channel, payload);
    `);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]).toContain("spread arguments have unknown arity");
    expect(result.invokeCount).toBe(0);
    expect(result.dynamicInvokeCount).toBe(1);
  });
});

describe("preload JSDoc implementation type checking", () => {
  it("实际实现通过编译器检查", () => {
    expect(getPreloadTypeDiagnostics()).toEqual([]);
  }, 15000);

  it("把同步 boolean 注释改成 Promise 会失败", () => {
    const apiPath = fileURLToPath(
      new URL("../../src/preload/api/terminal.js", import.meta.url),
    );
    const original = fs.readFileSync(apiPath, "utf8");
    const changed = original.replace(
      /@returns \{boolean\}(\s*\*\/\s*sendToProcess:)/,
      "@returns {Promise<boolean>}$1",
    );
    expect(changed).not.toBe(original);
    const diagnostics = getPreloadTypeDiagnostics(changed, apiPath);
    expect(
      diagnostics.some(
        (d) =>
          d.code === 2322 && String(d.messageText).includes("Promise<boolean>"),
      ),
    ).toBe(true);
  }, 15000);
});
