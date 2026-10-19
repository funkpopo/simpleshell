import { describe, it, expect } from "vitest";
import { createConnectionStabilizer } from "../../src/renderer/features/connections/lib/connectionTree.js";

// 模拟 ConnectionList 的 filteredItems 计算：dedupe/sort 每次都重建节点对象
const rebuild = (items) =>
  items.map((item) =>
    item.type === "group"
      ? { ...item, items: (item.items || []).map((c) => ({ ...c })) }
      : { ...item },
  );

describe("createConnectionStabilizer", () => {
  it("内容未变化时复用对象身份", () => {
    const stabilize = createConnectionStabilizer();
    const first = stabilize(
      rebuild([
        { id: "g1", type: "group", name: "G", expanded: false, items: [
          { id: "c1", type: "connection", name: "a", host: "1.1.1.1" },
        ] },
        { id: "c2", type: "connection", name: "b", host: "2.2.2.2" },
      ]),
    );
    const second = stabilize(
      rebuild([
        { id: "g1", type: "group", name: "G", expanded: false, items: [
          { id: "c1", type: "connection", name: "a", host: "1.1.1.1" },
        ] },
        { id: "c2", type: "connection", name: "b", host: "2.2.2.2" },
      ]),
    );

    expect(second[0]).toBe(first[0]);
    expect(second[0].items[0]).toBe(first[0].items[0]);
    expect(second[1]).toBe(first[1]);
  });

  it("分组展开/收起只改变该分组身份，子项与兄弟节点身份保持不变", () => {
    const stabilize = createConnectionStabilizer();
    const first = stabilize(
      rebuild([
        { id: "g1", type: "group", name: "G", expanded: false, items: [
          { id: "c1", type: "connection", name: "a", host: "1.1.1.1" },
        ] },
        { id: "g2", type: "group", name: "H", expanded: false, items: [] },
      ]),
    );
    const second = stabilize(
      rebuild([
        { id: "g1", type: "group", name: "G", expanded: true, items: [
          { id: "c1", type: "connection", name: "a", host: "1.1.1.1" },
        ] },
        { id: "g2", type: "group", name: "H", expanded: false, items: [] },
      ]),
    );

    expect(second[0]).not.toBe(first[0]);
    expect(second[0].expanded).toBe(true);
    // 子项身份稳定，memo 行可跳过重渲染
    expect(second[0].items[0]).toBe(first[0].items[0]);
    // 兄弟分组身份不变
    expect(second[1]).toBe(first[1]);
  });

  it("子项内容变化时分组与子项身份都更新", () => {
    const stabilize = createConnectionStabilizer();
    const first = stabilize(
      rebuild([
        { id: "g1", type: "group", name: "G", expanded: false, items: [
          { id: "c1", type: "connection", name: "a", host: "1.1.1.1" },
        ] },
      ]),
    );
    const second = stabilize(
      rebuild([
        { id: "g1", type: "group", name: "G", expanded: false, items: [
          { id: "c1", type: "connection", name: "a", host: "3.3.3.3" },
        ] },
      ]),
    );

    expect(second[0]).not.toBe(first[0]);
    expect(second[0].items[0]).not.toBe(first[0].items[0]);
    expect(second[0].items[0].host).toBe("3.3.3.3");
  });

  it("已删除节点的缓存会被清理", () => {
    const stabilize = createConnectionStabilizer();
    stabilize(rebuild([{ id: "c1", type: "connection", name: "a" }]));
    stabilize(rebuild([{ id: "c2", type: "connection", name: "b" }]));
    const last = stabilize(rebuild([{ id: "c3", type: "connection", name: "c" }]));

    expect(last).toHaveLength(1);
    expect(last[0].id).toBe("c3");
  });

  it("非数组输入原样返回", () => {
    const stabilize = createConnectionStabilizer();
    expect(stabilize(undefined)).toBeUndefined();
    expect(stabilize("x")).toBe("x");
  });
});
