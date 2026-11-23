import { describe, it, expect } from "vitest";
import {
  createConnectionStabilizer,
  getConnectionVersion,
  sortConnectionsByIp,
} from "../../src/renderer/features/connections/lib/connectionTree.js";

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
        {
          id: "g1",
          type: "group",
          name: "G",
          expanded: false,
          items: [{ id: "c1", type: "connection", name: "a", host: "1.1.1.1" }],
        },
        { id: "c2", type: "connection", name: "b", host: "2.2.2.2" },
      ]),
    );
    const second = stabilize(
      rebuild([
        {
          id: "g1",
          type: "group",
          name: "G",
          expanded: false,
          items: [{ id: "c1", type: "connection", name: "a", host: "1.1.1.1" }],
        },
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
        {
          id: "g1",
          type: "group",
          name: "G",
          expanded: false,
          items: [{ id: "c1", type: "connection", name: "a", host: "1.1.1.1" }],
        },
        { id: "g2", type: "group", name: "H", expanded: false, items: [] },
      ]),
    );
    const second = stabilize(
      rebuild([
        {
          id: "g1",
          type: "group",
          name: "G",
          expanded: true,
          items: [{ id: "c1", type: "connection", name: "a", host: "1.1.1.1" }],
        },
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
        {
          id: "g1",
          type: "group",
          name: "G",
          expanded: false,
          items: [{ id: "c1", type: "connection", name: "a", host: "1.1.1.1" }],
        },
      ]),
    );
    const second = stabilize(
      rebuild([
        {
          id: "g1",
          type: "group",
          name: "G",
          expanded: false,
          items: [{ id: "c1", type: "connection", name: "a", host: "3.3.3.3" }],
        },
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
    const last = stabilize(
      rebuild([{ id: "c3", type: "connection", name: "c" }]),
    );

    expect(last).toHaveLength(1);
    expect(last[0].id).toBe("c3");
  });

  it("非数组输入原样返回", () => {
    const stabilize = createConnectionStabilizer();
    expect(stabilize(undefined)).toBeUndefined();
    expect(stabilize("x")).toBe("x");
  });

  it("pinned/tags/colorTag 变更会更新版本号与稳定化后的对象引用（即使时间戳相同）", () => {
    const stabilize = createConnectionStabilizer();
    const base = {
      id: "c1",
      type: "connection",
      name: "app",
      host: "10.0.0.1",
      updatedAt: "2026-01-01T00:00:00.000Z",
      pinned: false,
      tags: ["web"],
      colorTag: "#3b82f6",
    };

    const first = stabilize(rebuild([base]));
    const unchanged = stabilize(rebuild([{ ...base, tags: ["web"] }]));
    expect(unchanged[0]).toBe(first[0]);

    const pinChanged = stabilize(rebuild([{ ...base, pinned: true }]));
    expect(pinChanged[0]).not.toBe(first[0]);
    expect(getConnectionVersion({ ...base, pinned: true })).not.toBe(
      getConnectionVersion(base),
    );

    const tagChanged = stabilize(
      rebuild([{ ...base, pinned: true, tags: ["web", "prod"] }]),
    );
    expect(tagChanged[0]).not.toBe(pinChanged[0]);

    const colorChanged = stabilize(
      rebuild([
        { ...base, pinned: true, tags: ["web", "prod"], colorTag: "#ef4444" },
      ]),
    );
    expect(colorChanged[0]).not.toBe(tagChanged[0]);
  });

  it("sortConnectionsByIp 将置顶连接排在普通连接之前并保持分组优先", () => {
    const sorted = sortConnectionsByIp([
      {
        id: "c1",
        type: "connection",
        name: "a",
        host: "10.0.0.1",
        pinned: false,
      },
      {
        id: "c2",
        type: "connection",
        name: "b",
        host: "10.0.0.9",
        pinned: true,
      },
      { id: "g1", type: "group", name: "Group", items: [] },
    ]);
    expect(sorted.map((item) => item.id)).toEqual(["g1", "c2", "c1"]);
  });
});
