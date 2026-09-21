// 同步输入分组的纯函数工具。
// 分组结构: { groupId, color, members: [tabId, ...] }
// 分组状态本体由 appReducer（AppContext）持有，本模块不再维护
// 模块级可变单例，所有操作都接收并返回新的分组数组。

// 分组颜色轮换表（仅本模块内部使用）
const DEFAULT_COLORS = [
  "#ff0000", // 红
  "#ff9300", // 橙
  "#fffb0d", // 黄
  "#00ff00", // 绿
  "#00eeff", // 青
  "#0532ff", // 蓝
  "#cc00ff", // 紫
  "#ff8585", // 粉
  "#ffce85", // 浅橙
  "#e7ff85", // 浅绿
];

export function findGroupByTab(syncGroups, tabId) {
  return syncGroups.find((g) => g.members.includes(tabId));
}

// 创建新分组：分配最小未占用编号与对应颜色，返回 { groups, group }
export function createSyncGroup(syncGroups) {
  // 计算最小未被占用编号N
  const usedNumbers = syncGroups
    .map((g) => parseInt(g.groupId.replace("G", ""), 10))
    .filter((n) => !Number.isNaN(n))
    .sort((a, b) => a - b);
  let N = 1;
  for (let i = 0; i < usedNumbers.length; i++) {
    if (usedNumbers[i] !== i + 1) {
      N = i + 1;
      break;
    }
    N = usedNumbers.length + 1;
  }
  const color = DEFAULT_COLORS[(N - 1) % DEFAULT_COLORS.length];
  const group = { groupId: `G${N}`, color, members: [] };
  return { groups: [...syncGroups, group], group };
}

// 将 tabId 加入指定分组，同时从其他分组中移除该 tabId。
// 未受影响的分组保持原有引用，便于 memo 比较器做引用相等判断。
export function addTabToSyncGroup(syncGroups, tabId, groupId) {
  return syncGroups.map((g) => {
    if (g.groupId === groupId) {
      if (g.members.includes(tabId)) {
        return g;
      }
      return { ...g, members: [...g.members, tabId] };
    }
    if (g.members.includes(tabId)) {
      return { ...g, members: g.members.filter((id) => id !== tabId) };
    }
    return g;
  });
}

// 将 tabId 从所有分组中移除，并自动清理无成员分组
export function removeTabFromSyncGroups(syncGroups, tabId) {
  const next = syncGroups.map((g) =>
    g.members.includes(tabId)
      ? { ...g, members: g.members.filter((id) => id !== tabId) }
      : g,
  );
  return next.filter((g) => g.members.length > 0);
}
