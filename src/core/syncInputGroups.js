// 全局同步输入分组状态管理
// 分组结构: { groupId, color, members: [tabId, ...] }

const DEFAULT_COLORS = [
  '#ff0000', // 红
  '#ff9300', // 橙
  '#fffb0d', // 黄
  '#00ff00', // 绿
  '#00eeff', // 青
  '#0532ff', // 蓝
  '#cc00ff', // 紫
  '#ff8585', // 粉
  '#ffce85', // 浅橙
  '#e7ff85', // 浅绿
];

let syncGroups = [];
let groupCounter = 1;

function getGroups() {
  return syncGroups;
}

function findGroupByTab(tabId) {
  return syncGroups.find(g => g.members.includes(tabId));
}

function addGroup() {
  // 计算最小未被占用编号N
  const usedNumbers = syncGroups.map(g => parseInt(g.groupId.replace('G', ''), 10)).sort((a, b) => a - b);
  let N = 1;
  for (let i = 0; i < usedNumbers.length; i++) {
    if (usedNumbers[i] !== i + 1) {
      N = i + 1;
      break;
    }
    N = usedNumbers.length + 1;
  }
  const color = DEFAULT_COLORS[(N - 1) % DEFAULT_COLORS.length];
  const groupId = `G${N}`;
  const group = { groupId, color, members: [] };
  syncGroups.push(group);
  return group;
}

function removeGroup(groupId) {
  syncGroups = syncGroups.filter(g => g.groupId !== groupId);
}

function addTabToGroup(tabId, groupId) {
  // 先移除tabId在其他分组中的记录
  syncGroups.forEach(g => {
    g.members = g.members.filter(id => id !== tabId);
  });
  const group = syncGroups.find(g => g.groupId === groupId);
  if (group && !group.members.includes(tabId)) {
    group.members.push(tabId);
  }
}

function removeTabFromGroup(tabId) {
  syncGroups.forEach(g => {
    g.members = g.members.filter(id => id !== tabId);
  });
  // 自动清理无成员分组
  syncGroups = syncGroups.filter(g => g.members.length > 0);
}

function getGroupById(groupId) {
  return syncGroups.find(g => g.groupId === groupId);
}

function resetGroups() {
  syncGroups = [];
  groupCounter = 1;
}

module.exports = {
  getGroups,
  findGroupByTab,
  addGroup,
  removeGroup,
  addTabToGroup,
  removeTabFromGroup,
  getGroupById,
  resetGroups,
  DEFAULT_COLORS,
}; 